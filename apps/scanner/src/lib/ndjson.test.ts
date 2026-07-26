/**
 * NdjsonBuffer — the streamed-progress line parser (2026-07-26).
 *
 * The stream can split a JSON object ANYWHERE (network chunking), and a
 * garbled line must never kill the final answer behind it. These pins hold
 * the parser to that.
 */
import { describe, it, expect } from "vitest";
import { NdjsonBuffer } from "./ndjson";

describe("NdjsonBuffer", () => {
  it("parses complete lines from a single chunk", () => {
    const b = new NdjsonBuffer();
    const out = b.push('{"a":1}\n{"b":2}\n');
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("buffers a line split across chunk boundaries", () => {
    const b = new NdjsonBuffer();
    expect(b.push('{"type":"prog')).toEqual([]);
    expect(b.push('ress","label":"Matching…"}\n')).toEqual([
      { type: "progress", label: "Matching…" },
    ]);
  });

  it("handles many lines and a trailing partial in one chunk", () => {
    const b = new NdjsonBuffer();
    const out = b.push('{"n":1}\n{"n":2}\n{"n":3');
    expect(out).toEqual([{ n: 1 }, { n: 2 }]);
    expect(b.push("}\n")).toEqual([{ n: 3 }]);
  });

  it("skips a garbled line without killing the lines after it", () => {
    const b = new NdjsonBuffer();
    const out = b.push('{"good":1}\nnot json at all\n{"good":2}\n');
    expect(out).toEqual([{ good: 1 }, { good: 2 }]);
  });

  it("end() flushes a final line that never got its newline", () => {
    const b = new NdjsonBuffer();
    expect(b.push('{"type":"final","answer":"hi"}')).toEqual([]);
    expect(b.end()).toEqual([{ type: "final", answer: "hi" }]);
  });

  it("end() on garbage or emptiness returns nothing and resets", () => {
    const b = new NdjsonBuffer();
    b.push("garbage without newline");
    expect(b.end()).toEqual([]);
    expect(b.end()).toEqual([]);
    // Ignores blank lines entirely.
    expect(b.push("\n\n\n")).toEqual([]);
  });
});
