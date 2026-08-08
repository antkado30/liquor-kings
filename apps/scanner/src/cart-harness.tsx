/**
 * CART PAGE HARNESS (2026-07-26, diagnostic only — NEVER shipped).
 * Seeds a fat multi-ADA cart, renders the real CartPage + BottomTabBar
 * (same shells as App), so Playwright can measure the page-mode layout:
 * no horizontal overflow, tab bar VISIBLE, sticky Check footer fully
 * above the tab bar, last cart line reachable.
 */
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { CartPage } from "./pages/CartPage";
import { BottomTabBar } from "./components/BottomTabBar";
import { CartProvider } from "./hooks/useCart";
import { ActiveOrderProvider } from "./hooks/useActiveOrder";
import "./index.css";

const prod = (
  code: string,
  name: string,
  ada: string,
  adaName: string,
  ml: number,
  price: number,
) => ({
  id: `id-${code}`,
  code,
  name,
  ada_number: ada,
  ada_name: adaName,
  bottle_size_ml: ml,
  bottle_size_label: `${ml} ML`,
  case_size: 12,
  licensee_price: price,
  base_price: price,
  min_shelf_price: price + 3,
  proof: 80,
  container: ml <= 375 ? "PL" : "GL",
  pack_count: null,
  family_key: `fam-${code}`,
});

const LINES = [
  { product: prod("26243", "CAROLANS IRISH CREAM LIQ (IRE)", "141", "GENERAL WINE & LIQUOR", 750, 16.11), quantity: 3 },
  { product: prod("11434", "DEWAR'S WHITE LABEL", "141", "GENERAL WINE & LIQUOR", 375, 11.02), quantity: 6 },
  { product: prod("22946", "JOHNNIE WALKER RED LABEL", "141", "GENERAL WINE & LIQUOR", 750, 21.2), quantity: 2 },
  { product: prod("30528", "SKREWBALL PEANUT BUTTER WHISKY", "221", "NWS MICHIGAN", 750, 25.44), quantity: 4 },
  { product: prod("19981", "BLUE CHAIR BAY COCONUT CREAM", "221", "NWS MICHIGAN", 750, 19.99), quantity: 2 },
  { product: prod("10022", "SMIRNOFF 80 PL", "221", "NWS MICHIGAN", 50, 0.81), quantity: 48 },
  { product: prod("14846", "BACARDI SUPERIOR (P R) PL", "321", "IMPERIAL BEVERAGE", 200, 14.5), quantity: 6 },
  { product: prod("29975", "PLATINUM 7X PL", "321", "IMPERIAL BEVERAGE", 1750, 12.99), quantity: 6 },
  { product: prod("12345", "EAGLE RARE VINTAGE-17 YR", "321", "IMPERIAL BEVERAGE", 750, 381.69), quantity: 1 },
  { product: prod("17851", "STOLICHNAYA VANIL", "321", "IMPERIAL BEVERAGE", 1000, 17.85), quantity: 3 },
];

localStorage.setItem(
  "lk-scanner-cart-v1",
  JSON.stringify({ version: 1, lines: LINES, updatedAt: "2026-07-26T12:00:00Z" }),
);

function Harness() {
  return (
    <CartProvider>
      <MemoryRouter initialEntries={["/cart"]}>
        <ActiveOrderProvider>
          <CartPage />
          <BottomTabBar />
        </ActiveOrderProvider>
      </MemoryRouter>
    </CartProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
