import { TransientFailure } from "../contracts/errors.ts";

function previewExpired() {
  return new TransientFailure("DATABASE_UNAVAILABLE", "The preview deadline expired. Retry the preview.");
}

/** One monotonic budget across all stages, including pool acquisition. */
export class RequestDeadline {
  private readonly end: number;
  readonly signal: AbortSignal;

  constructor(ms: number, private readonly expired: () => TransientFailure, caller?: AbortSignal) {
    this.end = performance.now() + ms;
    const timeout = AbortSignal.timeout(ms);
    this.signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
  }

  hasTime(ms: number): boolean {
    return !this.signal.aborted && this.end - performance.now() > ms;
  }

  remaining() {
    const ms = Math.floor(this.end - performance.now());
    if (ms < 1 || this.signal.aborted) throw this.expired();
    return ms;
  }

  wait<T>(work: Promise<T>, onExpiry?: () => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        onExpiry?.();
        reject(this.expired());
      };
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
      work.then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
    });
  }
}

export class PreviewDeadline extends RequestDeadline {
  constructor(ms = 10_000) { super(ms, previewExpired); }
}

export function searchDeadline(caller?: AbortSignal): RequestDeadline {
  return new RequestDeadline(5_000, () => new TransientFailure(
    "ADDRESS_PROVIDER_UNAVAILABLE", "Address search was interrupted or timed out. Retry shortly.",
  ), caller);
}
