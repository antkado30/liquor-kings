/**
 * add-guard pins (2026-08-05). The $3,349.50 party-bucket line and the
 * "3 more fifths of Jack" scenario must both trip a plain-words confirm;
 * a normal add must never nag.
 */
import { describe, expect, it } from "vitest";
import { addGuardVerdict, BIG_LINE_QTY, BIG_LINE_DOLLARS } from "./add-guard";

const base = { name: "JACK DANIELS OLD 7 BLACK", unitPrice: 25.44 };

describe("addGuardVerdict", () => {
  it("a normal fresh add never nags", () => {
    expect(addGuardVerdict({ ...base, addQty: 3, existingQty: 0, unitPrice: 25.44 })).toBe(null);
  });

  it("the Jack scenario: 3 more when 3 already in cart → duplicate confirm with totals", () => {
    const v = addGuardVerdict({ ...base, addQty: 3, existingQty: 3, unitPrice: 25.44 });
    expect(v?.kind).toBe("duplicate");
    expect(v?.resultingQty).toBe(6);
    expect(v?.message).toContain("already have 3");
    expect(v?.message).toContain("6 total");
  });

  it("the party-bucket scenario: 150 units trips the big-line wire", () => {
    const v = addGuardVerdict({ name: "99 ASSORTED PARTY BUCKET", addQty: 150, existingQty: 0, unitPrice: 22.33 });
    expect(v?.kind).toBe("big_line");
    expect(v?.message).toContain("150");
    expect(v?.message).toContain("$3349.50");
  });

  it("dollar wire fires even at low quantity (3 × $200 bottle ≥ $500)", () => {
    const v = addGuardVerdict({ name: "CLASE AZUL REPOSADO", addQty: 3, existingQty: 0, unitPrice: 200 });
    expect(v?.kind).toBe("big_line");
  });

  it("qty wire fires without a price (unknown unitPrice)", () => {
    const v = addGuardVerdict({ name: "MOHAWK 80 PL", addQty: BIG_LINE_QTY, existingQty: 0, unitPrice: null });
    expect(v?.kind).toBe("big_line");
    expect(v?.message).not.toContain("$");
  });

  it("both wires at once → one combined confirm", () => {
    const v = addGuardVerdict({ ...base, addQty: 48, existingQty: 6, unitPrice: 25.44 });
    expect(v?.kind).toBe("duplicate_and_big");
    expect(v?.resultingQty).toBe(54);
  });

  it("boundary honesty: just under both wires stays silent", () => {
    const v = addGuardVerdict({
      name: "X",
      addQty: BIG_LINE_QTY - 1,
      existingQty: 0,
      unitPrice: (BIG_LINE_DOLLARS - 0.01) / (BIG_LINE_QTY - 1),
    });
    expect(v).toBe(null);
  });

  it("garbage quantities are treated as no-add", () => {
    expect(addGuardVerdict({ ...base, addQty: 0, existingQty: 3, unitPrice: 1 })).toBe(null);
    expect(addGuardVerdict({ ...base, addQty: NaN, existingQty: 3, unitPrice: 1 })).toBe(null);
  });
});
