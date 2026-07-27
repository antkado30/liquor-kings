/**
 * LabelPacer — minimum display time for streamed progress labels
 * (2026-07-27, Tony 7/26: "it said reading your photo then something
 * else i couldnt catch it").
 *
 * The server can emit progress ticks faster than a human reads — e.g.
 * "Reading your photos…" replaced 300ms later by "Matching bottles…".
 * The pacer guarantees each shown label stays visible ≥ minMs before
 * the next replaces it. Intermediate ticks that arrive while one is
 * being held are collapsed to the LATEST (progress is monotonic — the
 * user cares where the work IS, not every hop it took).
 *
 * Pure + injectable clock/timer so tests run on fake time.
 */
export class LabelPacer {
  private lastShownAt = -Infinity;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly show: (label: string) => void,
    private readonly minMs: number = 1200,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Offer a new label. Shows immediately if the current one has had its
      time; otherwise holds it (latest wins) until the window elapses. */
  push(label: string): void {
    const elapsed = this.now() - this.lastShownAt;
    if (elapsed >= this.minMs) {
      this.display(label);
      return;
    }
    this.pending = label;
    if (this.timer == null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.pending != null) {
          const next = this.pending;
          this.pending = null;
          this.display(next);
        }
      }, this.minMs - elapsed);
    }
  }

  /** Stop everything (ask finished/failed) — never show a stale label
      after the answer has landed. */
  reset(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
    this.lastShownAt = -Infinity;
  }

  private display(label: string): void {
    this.lastShownAt = this.now();
    this.show(label);
  }
}
