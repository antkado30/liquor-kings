/**
 * OVERFLOW HARNESS (2026-07-27, diagnostic only — NEVER shipped).
 * Renders the real AssistantPage structure with a fat restored chat +
 * resolve card so Playwright can measure exactly which element forces
 * horizontal scroll on an iPhone-sized viewport.
 */
import { createRoot } from "react-dom/client";
import { AssistantChat } from "./components/AssistantChat";
import { IconSparkles } from "./components/Icons";
import type { ResolvedOrderLine } from "./api/assistant";
import "./index.css";

const cand = (
  code: string,
  name: string,
  ml: number,
  label: string,
  price: number,
) => ({
  id: `id-${code}`,
  code,
  name,
  size: label,
  ada_number: "141",
  ada_name: "GENERAL WINE & LIQUOR",
  bottle_size_ml: ml,
  bottle_size_label: label,
  case_size: 12,
  licensee_price: price,
  base_price: price,
  min_shelf_price: price + 3,
  proof: 80,
  container: ml <= 375 ? "PL" : "GL",
  pack_count: null,
  family_key: `fam-${name.slice(0, 6)}`,
});

const sizes = (name: string) =>
  [50, 100, 200, 375, 750, 1000, 1750].map((ml, i) =>
    cand(`${9000 + i}`, name, ml, `${ml} ML`, 9 + i * 4),
  );

const line = (
  said: string,
  name: string,
  price: number,
  extra?: Partial<ResolvedOrderLine>,
): ResolvedOrderLine => ({
  requested: { name: said, size: "750ml", qty: 3, raw: `${said} fifth x 3` },
  confidence: "high",
  best: cand("26243", name, 750, "750 ML", price),
  alternates: [
    cand("27763", "CAROLANS PEANUT BUTTER", 750, "750 ML", 18.4),
    cand("21646", "SHEEP DOG PEANUT BUTTER", 750, "750 ML", 15.2),
    cand("27788", "PEANUT BUTTER CUP WHISKEY", 750, "750 ML", 21.9),
    cand("31289", "VOLCAN REPOSADO", 750, "750 ML", 44.1),
  ],
  match_count: 5,
  sizes: sizes(name),
  ...extra,
});

const LINES: ResolvedOrderLine[] = [
  line("Carolans", "CAROLANS IRISH CREAM LIQ (IRE)", 16.11),
  line("Dewars white label pint", "DEWAR'S WHITE LABEL", 11.02),
  line("Johny walker red label", "JOHNNIE WALKER RED LABEL", 21.2),
  line("Skrewball", "SKREWBALL PEANUT BUTTER WHISKY", 25.44, {
    remembered: true,
    memory_note: "This is the store's own saved match for this phrase.",
  }),
  line("Blue chair rum coconut cream", "BLUE CHAIR BAY COCONUT CREAM", 19.99),
  line("Bacardi rum plastic", "BACARDI SUPERIOR (P R) PL", 14.5, {
    size_mismatch: true,
    requested_size_ml: 200,
    size_note:
      "No 200ml exists for this product — the match shown is a DIFFERENT size. You MUST tell the user plainly and ask which size they want.",
  }),
  line("Platinum 7x plastic 1/2 gallon", "PLATINUM 7X PL", 12.99, {
    case_intent: true,
    suggested_qty: 6,
    qty_note:
      'The line says "case" — one full case of this bottle is 6. Use 6 as the quantity unless the user corrects it.',
  }),
  line("Eagle rare 17", "EAGLE RARE VINTAGE-17 YR", 381.69, {
    brand_absent: true,
  }),
  line("Stoli vanilla", "STOLICHNAYA VANIL", 17.85),
  line("Smirnoff red white berry", "SMIRNOFF RED, WHITE & BERRY", 12.35),
];

const chat = {
  activeId: "harness-chat",
  chats: [
    {
      id: "harness-chat",
      title: "Add all of these to cart — no duplicates.",
      updatedAt: 1753600000000,
      messages: [
        {
          id: 1,
          role: "user",
          text: "Add all of these to cart — no duplicates.",
          photoCount: 3,
        },
        {
          id: 2,
          role: "assistant",
          text: "Everything's on the card — it flags the rows that need your eye. A few quick heads-up: the Blue Chair Bay cream line found 5 cream flavors (Mocha, Coconut, Key Lime, Mango, Pineapple) — the card shows them all at 3 each, confirm you want all five. Is the Smirnoff half-pint the plain 80-proof plastic, or a different style?",
          resolvedOrder: LINES,
        },
      ],
    },
  ],
};
localStorage.setItem("lk_assistant_chats_v1:nostore", JSON.stringify(chat));

const stubCart = {
  items: [],
  totalItems: 0,
  totalPrice: 0,
  addItem: () => {},
  removeItem: () => {},
  updateQty: () => {},
  clear: () => {},
} as unknown as Parameters<typeof AssistantChat>[0]["cart"];

function Harness() {
  return (
    <div className="page-shell assistant-page">
      <header className="assistant-page-header">
        <span className="assistant-page-icon" aria-hidden>
          <IconSparkles size={22} strokeWidth={1.9} />
        </span>
        <div className="assistant-page-header__copy">
          <h1 className="assistant-page-title">Assistant</h1>
          <p className="assistant-page-subtitle muted">
            Your catalog, orders, MLCC rules — plus photo questions.
          </p>
        </div>
        <button className="assistant-bulk-btn" type="button">
          Paste an order
        </button>
      </header>
      <AssistantChat cart={stubCart} layout="page" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
