import { TransientFailure } from "../contracts/errors.ts";

function expired() {
  return new TransientFailure("DATABASE_UNAVAILABLE", "The preview deadline expired. Retry the preview.");
}

/** One monotonic budget for a preview, including time spent waiting for the pool. */
export class PreviewDeadline {
  private readonly end: number;
  readonly signal: AbortSignal;

  constructor(ms = 10_000) {
    this.end = performance.now() + ms;
    this.signal = AbortSignal.timeout(ms);
  }

  remaining() {
    const ms = Math.floor(this.end - performance.now());
    if (ms < 1 || this.signal.aborted) throw expired();
    return ms;
  }

  wait<T>(work: Promise<T>, onExpiry?: () => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        onExpiry?.();
        reject(expired());
      };
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      work.then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
    });
  }
}
