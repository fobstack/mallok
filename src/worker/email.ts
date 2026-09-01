/**
 * Email delivery via Resend's HTTP API (docs/PLUGIN_API.md §7.6).
 *
 * `sendEmail` is an internal function boundary, not a provider layer
 * (docs/ARCHITECTURE.md §17): Resend is the one implementation, called with
 * plain `fetch`. Every send is recorded as a job first, so a failure is
 * retried by the cron with exponential backoff instead of being lost.
 */

import {
  completeJob,
  dueJobs,
  enqueueJob,
  failJob,
  findPluginState,
  type JobRow,
} from '../db/queries.js';
import type { EmailMessage } from '../plugins/types.js';
import type { Env } from './env.js';
import { decryptSecret } from './secrets.js';

const RESEND_URL = 'https://api.resend.com/emails';
/** Sends attempted per cron tick, so one minute's work stays bounded. */
const SENDS_PER_TICK = 5;

/** What an email job carries; the key is re-read at send time, never stored. */
interface EmailJobPayload {
  readonly pluginId: string;
  readonly from: string;
  readonly message: EmailMessage;
}

/**
 * Queues a message and tries to deliver it right away. The job survives an
 * immediate failure; the cron retries it (docs/ARCHITECTURE.md §13).
 * Returns the job id.
 */
export async function queueEmail(
  env: Env,
  ctx: ExecutionContext,
  pluginId: string,
  from: string,
  message: EmailMessage,
): Promise<string> {
  const now = new Date();
  const payload: EmailJobPayload = { pluginId, from, message };
  const jobId = await enqueueJob(
    env.DB,
    'email',
    payload,
    now.toISOString(),
    now.toISOString(),
  );
  ctx.waitUntil(attemptJob(env, jobId));
  return jobId;
}

async function attemptJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare('SELECT * FROM job WHERE id = ?')
    .bind(jobId)
    .first<JobRow>();
  if (job === null) {
    return;
  }
  await attempt(env, job, new Date());
}

/** How long a claimed job may sit before the cron rescues it. */
const STUCK_CLAIM_MS = 10 * 60 * 1000;

/** Cron entry point: retries every due email job, bounded per tick. */
export async function processEmailJobs(env: Env): Promise<number> {
  const now = new Date();
  // Rescue jobs whose claiming isolate died mid-send.
  await env.DB.prepare(
    "UPDATE job SET status = 'pending' WHERE status = 'running' AND updated_at < ?",
  )
    .bind(new Date(now.getTime() - STUCK_CLAIM_MS).toISOString())
    .run();
  const jobs = await dueJobs(
    env.DB,
    'email',
    now.toISOString(),
    SENDS_PER_TICK,
  );
  let sent = 0;
  for (const job of jobs) {
    if (await attempt(env, job, now)) {
      sent++;
    }
  }
  return sent;
}

async function attempt(env: Env, job: JobRow, now: Date): Promise<boolean> {
  // Claim atomically: the immediate post-submit attempt and the cron may
  // race for the same job, and an email must never be sent twice.
  const claim = await env.DB.prepare(
    "UPDATE job SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(now.toISOString(), job.id)
    .run();
  if (claim.meta.changes !== 1) {
    return false;
  }

  let payload: EmailJobPayload;
  try {
    payload = JSON.parse(job.payload) as EmailJobPayload;
  } catch {
    await failJob(env.DB, job, 'Unreadable payload.', now);
    return false;
  }

  const state = await findPluginState(env.DB, payload.pluginId);
  const stored = parseSecrets(state?.secrets ?? '{}').resend_api_key;
  const key =
    stored === undefined
      ? null
      : await decryptSecret(
          env.MALLOK_SECRET,
          payload.pluginId,
          'resend_api_key',
          stored,
        );
  if (key === null) {
    await failJob(env.DB, job, 'No usable Resend API key is configured.', now);
    return false;
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.message.to],
        subject: payload.message.subject,
        html: payload.message.html,
        text: payload.message.text,
        ...(payload.message.replyTo === undefined
          ? {}
          : { reply_to: payload.message.replyTo }),
      }),
    });
    if (!response.ok) {
      // The body may describe the failure but may also echo addresses; keep
      // only the status.
      await failJob(env.DB, job, `Resend responded ${response.status}.`, now);
      return false;
    }
    await completeJob(env.DB, job.id, now.toISOString());
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network failure.';
    await failJob(env.DB, job, message, now);
    return false;
  }
}

function parseSecrets(json: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        out[name] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}
