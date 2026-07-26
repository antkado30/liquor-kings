/**
 * Incremental NDJSON parser for streamed fetch bodies (2026-07-26,
 * assistant live progress).
 *
 * Feed it decoded text chunks as they arrive; it returns every COMPLETE
 * JSON line and buffers partial lines across chunk boundaries (a network
 * chunk can split a JSON object anywhere). Malformed lines are skipped,
 * never thrown — a garbled progress line must not kill the final answer
 * that follows it.
 */
export class NdjsonBuffer {
  private buf = "";

  /** Feed one decoded chunk; get back every complete parsed line. */
  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip a garbled line — never throw mid-stream
      }
    }
    return out;
  }

  /** Flush a trailing line that arrived without a final newline. */
  end(): unknown[] {
    const line = this.buf.trim();
    this.buf = "";
    if (!line) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  }
}
