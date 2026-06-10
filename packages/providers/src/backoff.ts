export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  factor: number;
}

export class ExponentialBackoff {
  private attempt = 0;

  constructor(private readonly options: BackoffOptions = { baseMs: 500, maxMs: 30_000, factor: 2 }) {}

  nextDelayMs(): number {
    const delay = Math.min(this.options.maxMs, this.options.baseMs * this.options.factor ** this.attempt);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }
}
