/**
 * Live progress emissions from askAssistant (2026-07-26).
 *
 * Pins the four laws of the feature:
 *   1. Events fire at the real moments (start → tool → model) in order.
 *   2. Photo asks announce themselves honestly (1 photo vs N photos).
 *   3. FAIL-SOFT: a throwing onProgress can NEVER break the ask.
 *   4. No onProgress → identical behavior to before (no-op emitter).
 *
 * The Anthropic SDK is mocked per-test with a scripted turn sequence; tool
 * execution runs the REAL runTool path. Tests use either an unknown tool
 * (honest error result, no DB) or resolve_bottles against a throwing
 * supabase (label fires BEFORE the tool runs; the loop survives).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: createMock };
    }
  },
}));

import { askAssistant, progressLabelForTool } from "../src/lib/assistant.js";

const endTurn = (text = "done") => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text }],
});

const toolTurn = (name, input = {}) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu-1", name, input }],
});

// A supabase stand-in whose every method throws — proves the tool label is
// emitted BEFORE the tool executes and that a tool blow-up stays contained.
const throwingSupabase = new Proxy(
  {},
  {
    get() {
      throw new Error("no DB in this test");
    },
  },
);

const TINY_JPEG = `data:image/jpeg;base64,${"A".repeat(96)}`;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  createMock.mockReset();
});

describe("askAssistant live progress", () => {
  it("emits start → tool → model in order, then returns the answer", async () => {
    createMock
      .mockResolvedValueOnce(toolTurn("definitely_not_a_tool"))
      .mockResolvedValueOnce(endTurn("here you go"));

    const events = [];
    const result = await askAssistant({
      question: "big ask",
      onProgress: (e) => events.push(e),
    });

    expect(result.answer).toBe("here you go");
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe("start");
    expect(events[0].label).toBe("Thinking…");
    const toolIdx = kinds.indexOf("tool");
    const modelIdx = kinds.indexOf("model");
    expect(toolIdx).toBeGreaterThan(0);
    expect(modelIdx).toBeGreaterThan(toolIdx);
    expect(events[modelIdx].label).toBe("Putting the answer together…");
    // Every emitted event carries a human label (heartbeats are route-level).
    for (const e of events) expect(typeof e.label).toBe("string");
  });

  it("announces one photo in the singular", async () => {
    createMock.mockResolvedValueOnce(endTurn());
    const events = [];
    await askAssistant({
      question: "",
      imageDataUris: [TINY_JPEG],
      onProgress: (e) => events.push(e),
    });
    expect(events[0]).toMatchObject({ kind: "start", label: "Reading your photo…" });
  });

  it("announces N photos in the plural with the real count", async () => {
    createMock.mockResolvedValueOnce(endTurn());
    const events = [];
    await askAssistant({
      question: "add these",
      imageDataUris: [TINY_JPEG, TINY_JPEG, TINY_JPEG],
      onProgress: (e) => events.push(e),
    });
    expect(events[0]).toMatchObject({ kind: "start", label: "Reading your 3 photos…" });
  });

  it("FAIL-SOFT: a throwing onProgress never breaks the ask", async () => {
    createMock
      .mockResolvedValueOnce(toolTurn("definitely_not_a_tool"))
      .mockResolvedValueOnce(endTurn("survived"));

    const result = await askAssistant({
      question: "big ask",
      onProgress: () => {
        throw new Error("broken client callback");
      },
    });
    expect(result.answer).toBe("survived");
  });

  it("no onProgress → same behavior as before (no emitter, same answer)", async () => {
    createMock.mockResolvedValueOnce(endTurn("plain"));
    const result = await askAssistant({ question: "hi" });
    expect(result.answer).toBe("plain");
    expect(result.toolCalls).toEqual([]);
  });

  it("resolve_bottles tool label fires BEFORE the tool runs (throwing DB stays contained)", async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ name: `bottle ${i}` }));
    createMock
      .mockResolvedValueOnce(toolTurn("resolve_bottles", { items }))
      .mockResolvedValueOnce(endTurn("still alive"));

    const events = [];
    const result = await askAssistant({
      question: "add all of these",
      supabase: throwingSupabase,
      onProgress: (e) => events.push(e),
    });

    expect(result.answer).toBe("still alive");
    const toolEvt = events.find((e) => e.kind === "tool");
    expect(toolEvt.label).toBe("Matching 45 lines to MLCC bottles…");
    // The tool itself blew up on the throwing DB — contained as an error
    // tool_result, never an exception out of askAssistant.
    expect(result.toolCalls[0].result.error).toMatch(/threw/);
  });
});

describe("progressLabelForTool", () => {
  it("gives every named tool real copy — never the fallback", () => {
    const named = [
      "query_catalog",
      "query_rules",
      "price_quote",
      "query_order_history",
      "query_inventory",
      "teach_bottle_memory",
      "list_bottle_memory",
      "forget_bottle_memory",
      "check_order_quantity",
      "validate_cart",
    ];
    for (const name of named) {
      const label = progressLabelForTool(name, {});
      expect(label).not.toBe("Working…");
      expect(label.length).toBeGreaterThan(5);
    }
  });

  it("resolve_bottles counts the lines (plural) and goes singular for one", () => {
    expect(
      progressLabelForTool("resolve_bottles", { items: new Array(87).fill({}) }),
    ).toBe("Matching 87 lines to MLCC bottles…");
    expect(progressLabelForTool("resolve_bottles", { items: [{}] })).toBe(
      "Matching your bottle to an MLCC code…",
    );
  });

  it("unknown tools fall back to honest generic copy", () => {
    expect(progressLabelForTool("mystery_tool", {})).toBe("Working…");
  });
});
