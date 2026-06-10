export class DuplicateSuppressor {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  shouldAccept(id: string, now = Date.now()): boolean {
    this.cleanup(now);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now + this.ttlMs);
    return true;
  }

  private cleanup(now: number): void {
    for (const [id, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(id);
    }
  }
}
