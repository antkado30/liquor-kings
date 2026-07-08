/**
 * run-final-push.unit.test.js — the builder decides what the store owner's
 * phone SAYS. Copy honesty is load-bearing (doctrine: never claim more than
 * we know), so every branch and every "never notify" case is pinned here.
 */
import { describe, it, expect } from "vitest";

import { buildRunFinalPush } from "./run-final-push.js";

const RUN_ID = "9c1c1a4e-1111-2222-3333-444455556666";
const STORE_ID = "e594fc3a-17b7-45d0-9dde-943ebbfa5391";

const validateEvidence = (attrs) => [
  { kind: "rpa_step", stage: "login", message: "x" },
  {
    kind: "validate_only_summary",
    stage: "validate_only_complete",
    attributes: attrs,
  },
];

/**
 * REAL prod row shape (2026-07-08 lesson): run_type lives at
 * payload_snapshot.metadata.run_type — NOT top-level. The first version of
 * this suite invented a flat shape, so 15 tests stayed green while prod
 * silently skipped every push. Fixtures now mirror the actual row.
 */
const baseRun = (over = {}, runType = "validate_only") => ({
  id: RUN_ID,
  store_id: STORE_ID,
  status: "succeeded",
  payload_snapshot: { metadata: { run_type: runType } },
  evidence: validateEvidence({ can_checkout: true, out_of_stock_items: [] }),
  ...over,
});

describe("buildRunFinalPush", () => {
  it("OOS bottles → 'N bottles need a decision' (plural), review-first copy", () => {
    const p = buildRunFinalPush(
      baseRun({
        evidence: validateEvidence({
          can_checkout: false,
          out_of_stock_items: [{ code: "1" }, { code: "2" }, { code: "3" }],
        }),
      }),
    );
    expect(p.title).toBe("3 bottles need a decision");
    expect(p.body).toMatch(/review/i);
    expect(p.tag).toBe(`lk-run-${RUN_ID}`);
    expect(p.data).toEqual({ run_id: RUN_ID, store_id: STORE_ID, kind: "needs_decision" });
  });

  it("exactly one OOS bottle → singular title", () => {
    const p = buildRunFinalPush(
      baseRun({
        evidence: validateEvidence({ can_checkout: false, out_of_stock_items: [{ code: "1" }] }),
      }),
    );
    expect(p.title).toBe("1 bottle needs a decision");
  });

  it("clean check with total → 'Cart checks out clean' + formatted money", () => {
    const p = buildRunFinalPush(
      baseRun({
        evidence: validateEvidence({
          can_checkout: true,
          out_of_stock_items: [],
          order_summary: { netTotal: 1234.5 },
        }),
      }),
    );
    expect(p.title).toBe("Cart checks out clean");
    expect(p.body).toContain("$1,234.50");
    expect(p.data.kind).toBe("check_clean");
  });

  it("clean check without a total still reads well", () => {
    const p = buildRunFinalPush(baseRun());
    expect(p.title).toBe("Cart checks out clean");
    expect(p.body).toBe("Validated — ready to place.");
  });

  it("succeeded but not checkout-ready and no OOS → honest 'needs a look'", () => {
    const p = buildRunFinalPush(
      baseRun({ evidence: validateEvidence({ can_checkout: false, out_of_stock_items: [] }) }),
    );
    expect(p.title).toBe("Check finished — needs a look");
    expect(p.data.kind).toBe("needs_review");
  });

  it("succeeded with NO validate evidence → generic, never invented detail", () => {
    const p = buildRunFinalPush(baseRun({ evidence: [] }));
    expect(p.title).toBe("Check finished");
    expect(p.data.kind).toBe("check_done");
  });

  it("accepts the rpa_step/validate_only_complete evidence variant", () => {
    const p = buildRunFinalPush(
      baseRun({
        evidence: [
          {
            kind: "rpa_step",
            stage: "validate_only_complete",
            attributes: { can_checkout: false, out_of_stock_items: [{ code: "9" }, { code: "8" }] },
          },
        ],
      }),
    );
    expect(p.title).toBe("2 bottles need a decision");
  });

  it("terminal failure → first sentence of the reason + one-tap retry", () => {
    const p = buildRunFinalPush(
      baseRun({
        status: "failed",
        error_message:
          "MILO validate timed out after 45 seconds. Second sentence with internals that should not appear.",
      }),
    );
    expect(p.title).toBe("Check couldn't finish");
    expect(p.body).toBe("MILO validate timed out after 45 seconds. Tap to retry.");
    expect(p.body).not.toMatch(/internals/);
  });

  it("failed with no message still explains itself in one human line", () => {
    const p = buildRunFinalPush(baseRun({ status: "failed", error_message: null }));
    expect(p.body).toBe("It hit a problem and stopped. Tap to retry.");
  });

  it("failed rpa_run gets order wording", () => {
    const p = buildRunFinalPush(
      baseRun({ status: "failed", error_message: "Checkout gate refused." }, "rpa_run"),
    );
    expect(p.title).toBe("Order run couldn't finish");
  });

  it("REAPED run notifies even with unknown run_type, and NEVER claims nothing was placed", () => {
    const p = buildRunFinalPush({
      id: RUN_ID,
      store_id: STORE_ID,
      status: "failed",
      failure_type: "LK_RUN_REAPED",
    });
    expect(p.title).toBe("A run stalled and was stopped");
    expect(p.body).toMatch(/review/i);
    expect(p.body).not.toMatch(/nothing was placed|no order/i);
    expect(p.data.kind).toBe("run_stalled");
  });

  it("order placed for real → confirmation count from the ADA-keyed object", () => {
    const p = buildRunFinalPush(
      baseRun(
        {
          evidence: [
            {
              kind: "rpa_run_summary",
              attributes: {
                mode: "submit",
                submitted: true,
                confirmation_numbers: { 141: "A100", 321: "C300" },
              },
            },
          ],
        },
        "rpa_run",
      ),
    );
    expect(p.title).toBe("Order placed");
    expect(p.body).toContain("2 orders");
    expect(p.data.kind).toBe("order_placed");
  });

  it("practice-downgraded rpa_run is honest: no real order was placed", () => {
    const p = buildRunFinalPush(
      baseRun(
        {
          evidence: [
            { kind: "rpa_run_summary", attributes: { mode: "submit", submitted: false, dry_run_reason: "env gate" } },
          ],
        },
        "rpa_run",
      ),
    );
    expect(p.title).toBe("Practice run finished");
    expect(p.body).toMatch(/No real order was placed/);
  });

  it("NEVER notifies: canceled, cart_reset_only, unknown types, malformed input", () => {
    expect(buildRunFinalPush(baseRun({ status: "canceled" }))).toBeNull();
    expect(buildRunFinalPush(baseRun({}, "cart_reset_only"))).toBeNull();
    expect(buildRunFinalPush(baseRun({ status: "failed" }, "cart_reset_only"))).toBeNull();
    expect(buildRunFinalPush(baseRun({}, "mystery_future_type"))).toBeNull();
    expect(buildRunFinalPush(null)).toBeNull();
    expect(buildRunFinalPush({})).toBeNull();
    // malformed evidence degrades to the generic copy, never a throw:
    expect(buildRunFinalPush(baseRun({ evidence: "not-an-array" })).title).toBe("Check finished");
    expect(buildRunFinalPush(baseRun({ evidence: [null, 42, { kind: "junk" }] })).title).toBe("Check finished");
  });

  it("REGRESSION 2026-07-08: run_type is read from payload_snapshot.metadata (the real row), plus legacy shapes", () => {
    // The exact prod shape that silently skipped: NO top-level run_type.
    const prodShape = buildRunFinalPush(baseRun());
    expect(prodShape).not.toBeNull();
    expect(prodShape.title).toBe("Cart checks out clean");

    // Legacy/future flat shape still honored.
    const flat = buildRunFinalPush({
      id: RUN_ID,
      store_id: STORE_ID,
      status: "succeeded",
      run_type: "validate_only",
      evidence: validateEvidence({ can_checkout: true, out_of_stock_items: [] }),
    });
    expect(flat).not.toBeNull();

    // Mid-level metadata shape honored too.
    const mid = buildRunFinalPush({
      id: RUN_ID,
      store_id: STORE_ID,
      status: "succeeded",
      metadata: { run_type: "validate_only" },
      evidence: validateEvidence({ can_checkout: true, out_of_stock_items: [] }),
    });
    expect(mid).not.toBeNull();

    // And a row with NO run_type anywhere stays silent (never guess).
    const none = buildRunFinalPush({
      id: RUN_ID,
      store_id: STORE_ID,
      status: "succeeded",
      evidence: [],
    });
    expect(none).toBeNull();
  });

  it("no emoji anywhere in any copy", () => {
    const runs = [
      baseRun(),
      baseRun({ status: "failed", error_message: "x." }),
      baseRun({ evidence: validateEvidence({ out_of_stock_items: [{ code: "1" }] }) }),
      { id: RUN_ID, store_id: STORE_ID, status: "failed", failure_type: "LK_RUN_REAPED" },
    ];
    for (const r of runs) {
      const p = buildRunFinalPush(r);
      expect(`${p.title} ${p.body}`).toMatch(/^[\x20-\x7E—…$]+$/);
    }
  });
});
