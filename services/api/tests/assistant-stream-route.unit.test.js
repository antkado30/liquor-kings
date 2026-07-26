/**
 * POST /assistant/ask streaming contract (2026-07-26, live progress).
 *
 * Pins the route-level laws:
 *   1. stream:true → NDJSON: immediate start line, forwarded progress
 *      lines, and a {type:"final"} line carrying the exact old 200 body.
 *   2. stream absent → plain JSON, byte-identical behavior to before.
 *   3. Config problem (no API key) → clean 503 JSON even with stream:true
 *      (never a half-open stream).
 *   4. An ask that throws mid-stream → {type:"error"} line, response ends
 *      cleanly (HTTP status stays 200 — it was already committed).
 *   5. Missing question/image → 400, streaming or not.
 *
 * lib/assistant.js is mocked; supertest drives a real express app.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { askMock } = vi.hoisted(() => ({ askMock: vi.fn() }));

vi.mock("../src/lib/assistant.js", () => ({
  askAssistant: askMock,
  resolveOrderList: vi.fn(),
}));

import assistantRouter from "../src/routes/assistant.routes.js";

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/assistant", assistantRouter);
  return app;
}

function ndjsonLines(text) {
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}

const FINAL_BODY = {
  answer: "here you go",
  toolCalls: [],
  model: "test-model",
  iterations: 2,
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  askMock.mockReset();
});

describe("POST /assistant/ask — streaming contract", () => {
  it("stream:true → NDJSON with start, forwarded progress, and the final result", async () => {
    askMock.mockImplementation(async ({ onProgress }) => {
      onProgress({ kind: "start", label: "Reading your 2 photos…" });
      onProgress({ kind: "tool", tool: "resolve_bottles", label: "Matching 40 lines to MLCC bottles…" });
      return FINAL_BODY;
    });

    const res = await request(buildApp())
      .post("/assistant/ask")
      .send({ question: "add all of these", stream: true });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);

    const lines = ndjsonLines(res.text);
    expect(lines[0]).toMatchObject({ type: "progress", kind: "start" });
    expect(lines).toContainEqual({
      type: "progress",
      kind: "tool",
      tool: "resolve_bottles",
      label: "Matching 40 lines to MLCC bottles…",
    });
    const final = lines[lines.length - 1];
    expect(final).toEqual({ type: "final", ...FINAL_BODY });
    // The lib was handed a REAL callback, not undefined.
    expect(typeof askMock.mock.calls[0][0].onProgress).toBe("function");
  });

  it("stream absent → plain JSON exactly as before (no NDJSON, no onProgress)", async () => {
    askMock.mockResolvedValue(FINAL_BODY);

    const res = await request(buildApp())
      .post("/assistant/ask")
      .send({ question: "quick one" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual(FINAL_BODY);
    expect(askMock.mock.calls[0][0].onProgress).toBeUndefined();
  });

  it("no API key + stream:true → clean 503 JSON, never a half-open stream", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const res = await request(buildApp())
      .post("/assistant/ask")
      .send({ question: "hi", stream: true });

    expect(res.status).toBe(503);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("ask throws mid-stream → typed error line, stream ends cleanly", async () => {
    askMock.mockImplementation(async ({ onProgress }) => {
      onProgress({ kind: "start", label: "Thinking…" });
      throw new Error("anthropic exploded");
    });

    const res = await request(buildApp())
      .post("/assistant/ask")
      .send({ question: "boom", stream: true });

    expect(res.status).toBe(200); // committed before the throw — by design
    const lines = ndjsonLines(res.text);
    const last = lines[lines.length - 1];
    expect(last.type).toBe("error");
    expect(last.error).toMatch(/anthropic exploded/);
  });

  it("missing question and images → 400 regardless of stream flag", async () => {
    const res = await request(buildApp())
      .post("/assistant/ask")
      .send({ stream: true });
    expect(res.status).toBe(400);
    expect(askMock).not.toHaveBeenCalled();
  });
});
