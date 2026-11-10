/** Marks a promise that had not settled when its grace period ended. */
export const STILL_PENDING = Symbol('stillPending');

/** Resolves with the promise's value, or `STILL_PENDING` once `ms` pass first. */
export function settleWithin<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof STILL_PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<typeof STILL_PENDING>((resolve) => {
    timer = setTimeout(() => resolve(STILL_PENDING), ms);
  });
  return Promise.race([promise, grace]).finally(() => clearTimeout(timer));
}
