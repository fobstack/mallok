/**
 * Handing a secret to a person, once, and knowing whether it arrived.
 *
 * There is exactly one of these, and both `mallok create` and `mallok
 * setup-key` use it. They each used to have their own arrangement, and each
 * had the same bug in it: the value was returned to a caller that printed it
 * *after* the ledger had already recorded a delivery. Anything in between — a
 * `SIGINT`, a full disk, an `EPIPE` from `mallok create | head -1` — leaves a
 * key that exists on the Worker and is known to nobody, on a site whose
 * ledger says it is finished. Cloudflare does not give a secret's value back,
 * so that site can never be set up and never be recovered.
 *
 * Two rules follow, and this file is where they are kept:
 *
 * - **the write is awaited**, so "delivered" means the stream accepted the
 *   bytes rather than that a function was called;
 * - **a failed write throws**, so the caller records nothing and the next run
 *   rotates.
 */

/** The part of a writable stream this needs. Narrow, so tests can supply one. */
export interface SecretStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

/**
 * Writes a secret to a stream and resolves only once it is accepted.
 *
 * `process.stdout.write` returns false when the buffer is full and reports a
 * failed write through its callback. Waiting for that callback is the whole
 * point: it is what makes a later "delivered" record a statement about the
 * world rather than about this function having been reached.
 */
export async function deliverSecret(
  stream: SecretStream,
  name: string,
  value: string,
): Promise<void> {
  const text =
    `\n${name} (needed once, and shown only here):\n` + `    ${value}\n`;
  await new Promise<void>((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
