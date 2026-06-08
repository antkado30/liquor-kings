import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { BottomTabBar } from "./components/BottomTabBar";
import { CartProvider } from "./hooks/useCart";
// ScannerPage is the home/landing screen — keep it EAGER so first paint is
// instant. Every other route is lazy-loaded (code-split) so the initial JS
// bundle stays small, then prefetched on idle so tab taps still feel instant.
import { ScannerPage } from "./pages/ScannerPage";

const BrowsePage = lazy(() =>
  import("./pages/BrowsePage").then((m) => ({ default: m.BrowsePage })),
);
const CartPage = lazy(() =>
  import("./pages/CartPage").then((m) => ({ default: m.CartPage })),
);
const MorePage = lazy(() =>
  import("./pages/MorePage").then((m) => ({ default: m.MorePage })),
);
const OrderDetailPage = lazy(() =>
  import("./pages/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })),
);
const OrdersPage = lazy(() =>
  import("./pages/OrdersPage").then((m) => ({ default: m.OrdersPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TemplatesPage = lazy(() =>
  import("./pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })),
);
const AssistantPage = lazy(() =>
  import("./pages/AssistantPage").then((m) => ({ default: m.AssistantPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Warm the lazy route chunks once the home screen has settled, so the FIRST
 * tap on any tab is instant (the chunk is already in the browser cache)
 * while keeping the initial download small. Runs during idle time so it
 * never competes with the home screen's own work.
 */
function RoutePrefetcher() {
  useEffect(() => {
    const w = window as IdleWindow;
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = schedule(() => {
      void import("./pages/BrowsePage");
      void import("./pages/OrdersPage");
      void import("./pages/TemplatesPage");
      void import("./pages/MorePage");
      void import("./pages/CartPage");
      void import("./pages/SettingsPage");
      void import("./pages/OrderDetailPage");
      void import("./pages/AssistantPage");
      void import("./pages/InventoryPage");
    });
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);
  return null;
}

export default function App() {
  // AuthGate runs FIRST (before CartProvider/Router) so we never attempt to
  // load cart state or hit authenticated APIs before the user has a session.
  // This prevents the old "scanner throws on every API call" UX from the
  // dev-bearer era — if you're not signed in, you only see the login screen.
  return (
    <AuthGate>
      <CartProvider>
        <BrowserRouter basename="/scanner">
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<ScannerPage />} />
              <Route path="/cart" element={<CartPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
              <Route path="/browse" element={<BrowsePage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <RoutePrefetcher />
          {/*
            Bottom tab bar — fixed-position primary nav (task #90).
            Renders alongside every route under the BrowserRouter. The
            tab bar handles its own active-route detection via
            useLocation, so it doesn't need per-page wiring.
          */}
          <BottomTabBar />
        </BrowserRouter>
      </CartProvider>
    </AuthGate>
  );
}
