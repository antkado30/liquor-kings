/**
 * ResolvedOrderCard tests (2026-07-24) — the GLANCEABILITY rebuild. Pins
 * Tony's ask ("u have to click on each one to actually figure that out which
 * gets really annoying"):
 *  1. The MATCHED bottle's name + size + price + code are visible AT REST —
 *     no tap/select interaction needed to see what matched.
 *  2. "You said:" receipt shows the verbatim raw line when present.
 *  3. size_mismatch renders a loud inline flag naming the requested size.
 *  4. case_intent prefills qty with suggested_qty (was DROPPED — "x case"
 *     showed qty 1) and shows the case note.
 *  5. Add uses the chosen candidate + the prefilled case qty.
 *  6. Swapping to another candidate retargets an untouched case qty to the
 *     new candidate's case_size (suggestion stays honest across swaps).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ResolvedOrderCard } from "./ResolvedOrderCard";
import type { ResolvedOrderLine, ResolvedCandidate } from "../api/assistant";
import type { CartContextValue } from "../hooks/useCart";

// Store memory (2026-07-24): the card fires learn-on-swap corrections
// fire-and-forget — mocked so tests capture the payload with no network.
vi.mock("../api/assistant", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, recordAssistantMemory: vi.fn().mockResolvedValue(undefined) };
});
import { recordAssistantMemory } from "../api/assistant";

const addItem = vi.fn();
const updateQuantity = vi.fn();
const cart = {
  items: [],
  addItem,
  updateQuantity,
} as unknown as CartContextValue;

function candidate(over: Partial<ResolvedCandidate> = {}): ResolvedCandidate {
  return {
    id: "id-1",
    code: "61102",
    name: "SMIRNOFF 80 PL",
    ada_number: "141",
    ada_name: "ADA",
    bottle_size_ml: 200,
    bottle_size_label: "200 ML",
    case_size: 24,
    licensee_price: 2.85,
    proof: 80,
    base_price: null,
    min_shelf_price: null,
    container: null,
    pack_count: null,
    ...over,
  };
}

function line(over: Partial<ResolvedOrderLine> = {}): ResolvedOrderLine {
  return {
    requested: { name: "Smirnoff", size: "half pint", qty: 2, raw: "Smirnoff half pint x2" },
    confidence: "high",
    best: candidate(),
    alternates: [],
    match_count: 1,
    ...over,
  };
}

beforeEach(() => {
  addItem.mockClear();
  updateQuantity.mockClear();
  vi.mocked(recordAssistantMemory).mockClear();
});

describe("ResolvedOrderCard — glanceability", () => {
  it("shows matched name + size + price + code AT REST (no interaction)", () => {
    render(<ResolvedOrderCard lines={[line()]} cart={cart} />);
    // All four facts visible without touching anything:
    expect(screen.getByText("SMIRNOFF 80 PL")).toBeTruthy();
    expect(screen.getByText("200 ML")).toBeTruthy();
    expect(screen.getByText("$2.85")).toBeTruthy();
    expect(screen.getByText("#61102")).toBeTruthy();
  });

  it('shows the verbatim "You said" receipt from requested.raw', () => {
    render(<ResolvedOrderCard lines={[line()]} cart={cart} />);
    expect(screen.getByText(/You said: Smirnoff half pint x2/)).toBeTruthy();
  });

  it("renders a LOUD size flag on size_mismatch naming the requested ml", () => {
    render(
      <ResolvedOrderCard
        lines={[
          line({
            confidence: "review",
            size_mismatch: true,
            requested_size_ml: 375,
            best: candidate({ bottle_size_label: "750 ML", bottle_size_ml: 750 }),
          }),
        ]}
        cart={cart}
      />,
    );
    expect(screen.getByText(/No 375 ml for this one/)).toBeTruthy();
    expect(screen.getByText(/this is 750 ML/)).toBeTruthy();
  });

  it("case_intent prefills qty with suggested_qty and shows the case note", () => {
    render(
      <ResolvedOrderCard
        lines={[
          line({
            requested: { name: "Tito's", size: null, qty: 1, raw: "Titos x case" },
            case_intent: true,
            suggested_qty: 12,
            best: candidate({ code: "7128", name: "TITO'S HANDMADE VODKA", case_size: 12 }),
          }),
        ]}
        cart={cart}
      />,
    );
    const qty = screen.getByLabelText(/Quantity for TITO'S HANDMADE VODKA/) as HTMLInputElement;
    expect(qty.value).toBe("12");
    expect(screen.getByText(/“Case” = 12 bottles/)).toBeTruthy();
  });

  it("Add to cart uses the chosen candidate + the prefilled case qty", () => {
    render(
      <ResolvedOrderCard
        lines={[
          line({
            case_intent: true,
            suggested_qty: 24,
            best: candidate({ case_size: 24 }),
          }),
        ]}
        cart={cart}
      />,
    );
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].code).toBe("61102");
    expect(addItem.mock.calls[0][1]).toBe(24);
  });

  it("swap retargets an UNTOUCHED case qty to the new candidate's case_size", () => {
    render(
      <ResolvedOrderCard
        lines={[
          line({
            case_intent: true,
            suggested_qty: 24,
            best: candidate({ case_size: 24 }),
            alternates: [
              candidate({ code: "85800", name: "SMIRNOFF 100", case_size: 48 }),
            ],
          }),
        ]}
        cart={cart}
      />,
    );
    const select = screen.getByLabelText(/Swap match for Smirnoff/);
    fireEvent.change(select, { target: { value: "1" } });
    const qty = screen.getByLabelText(/Quantity for SMIRNOFF 100/) as HTMLInputElement;
    expect(qty.value).toBe("48");
  });

  it("no-match line keeps the loud manual-search state", () => {
    render(
      <ResolvedOrderCard
        lines={[line({ best: null, alternates: [], confidence: "none", match_count: 0 })]}
        cart={cart}
      />,
    );
    expect(screen.getByText(/No match — search for it manually/)).toBeTruthy();
  });

  // ── Store memory (2026-07-24, the moat) ──────────────────────────────────
  it("a brand-absent line warns LOUDLY that it's likely not in the book (2026-07-25)", () => {
    render(<ResolvedOrderCard lines={[line({ brand_absent: true, confidence: "review" })]} cart={cart} />);
    expect(screen.getByText(/Likely NOT in the current MLCC book/)).toBeTruthy();
    expect(screen.getByText(/closest different product/)).toBeTruthy();
  });

  it("a remembered line wears the ★ remembered badge", () => {
    render(<ResolvedOrderCard lines={[line({ remembered: true })]} cart={cart} />);
    expect(screen.getByText("★ remembered")).toBeTruthy();
  });

  it("SWAP + add teaches the store's memory (learn-on-swap fires with the correction)", () => {
    render(
      <ResolvedOrderCard
        lines={[
          line({
            alternates: [candidate({ code: "29162", name: "THREE OLIVES CHERRY" })],
          }),
        ]}
        cart={cart}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Swap match for Smirnoff/), { target: { value: "1" } });
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(recordAssistantMemory).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordAssistantMemory).mock.calls[0][0]).toEqual([
      {
        name: "Smirnoff",
        size: "half pint",
        raw: "Smirnoff half pint x2",
        mlcc_code: "29162",
      },
    ]);
  });

  it("adding the resolver's own pick teaches NOTHING (no false learnings)", () => {
    render(<ResolvedOrderCard lines={[line()]} cart={cart} />);
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(recordAssistantMemory).not.toHaveBeenCalled();
  });

  // ── Size flip (2026-07-24) ───────────────────────────────────────────────
  const sizesLine = () =>
    line({
      sizes: [
        candidate({ code: "61099", name: "SMIRNOFF 80 PL", bottle_size_ml: 375, bottle_size_label: "375 ML", licensee_price: 4.5 }),
        candidate(), // the matched 200ml, code 61102
        candidate({ code: "61103", name: "SMIRNOFF 80", bottle_size_ml: 750, bottle_size_label: "750 ML", licensee_price: 9.99 }),
      ],
    });

  it("shows the size chip when the family has other sizes", () => {
    render(<ResolvedOrderCard lines={[sizesLine()]} cart={cart} />);
    expect(screen.getByText(/Switch size \(3 carried\)/)).toBeTruthy();
  });

  it("flipping size updates the truth line and adds the flipped SKU", () => {
    render(<ResolvedOrderCard lines={[sizesLine()]} cart={cart} />);
    fireEvent.change(screen.getByLabelText(/Switch size for Smirnoff/), { target: { value: "2" } });
    expect(screen.getByText("750 ML")).toBeTruthy(); // truth line flipped
    expect(screen.getByText("$9.99")).toBeTruthy();
    expect(screen.getByText("#61103")).toBeTruthy();
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(addItem.mock.calls[0][0].code).toBe("61103");
  });

  it("a SIZE flip never teaches the memory (spoken size wins)", () => {
    render(<ResolvedOrderCard lines={[sizesLine()]} cart={cart} />);
    fireEvent.change(screen.getByLabelText(/Switch size for Smirnoff/), { target: { value: "0" } });
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(addItem.mock.calls[0][0].code).toBe("61099"); // flipped SKU added…
    expect(recordAssistantMemory).not.toHaveBeenCalled(); // …but nothing learned
  });

  it("the done-state is a RECEIPT — qty × name · size, not a bare count (2026-07-24)", () => {
    render(
      <ResolvedOrderCard
        lines={[line({ case_intent: true, suggested_qty: 24, best: candidate({ case_size: 24 }) })]}
        cart={cart}
      />,
    );
    fireEvent.click(screen.getByText(/Add 1 to cart/));
    expect(screen.getByText(/Added 1 item to your cart:/)).toBeTruthy();
    expect(screen.getByText(/24× SMIRNOFF 80 PL · 200 ML/)).toBeTruthy();
    expect(screen.getByText(/Open Cart to review and validate/)).toBeTruthy();
  });
});
