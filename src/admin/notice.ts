/**
 * The admin's one line of feedback that is not about a field: the last
 * failure, shown by the shell as a toast.
 *
 * A message is not server state, so it is not a query; it is the smallest
 * store React can subscribe to. `notify` may be called from anywhere — an
 * event handler, a mutation, a loader.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { ApiError } from './api.js';

let current = '';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reports something to the operator. */
export function notify(message: string): void {
  current = message;
  for (const listener of listeners) {
    listener();
  }
}

/** Clears the message once its toast is up, so the same one can show again. */
export function clearNotice(): void {
  notify('');
}

/** The message waiting to be shown, or an empty string. */
export function useNotice(): string {
  return useSyncExternalStore(subscribe, () => current);
}

/**
 * Says what went wrong when a query fails: the server's message when it
 * sent one, `fallback` otherwise. Once per failure, not once per render.
 */
export function useReportError(error: unknown, fallback: string): void {
  useEffect(() => {
    if (error !== null && error !== undefined) {
      notify(error instanceof ApiError ? error.message : fallback);
    }
  }, [error, fallback]);
}

/** The words for a failed request: the server's own, or `fallback`. */
export function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}
