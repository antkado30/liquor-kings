import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { BottomTabBar } from "./components/BottomTabBar";
import { CartProvider } from "./hooks/useCart";
import { BrowsePage } from "./pages/BrowsePage";
import { CartPage } from "./pages/CartPage";
import { MorePage } from "./pages/MorePage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ScannerPage } from "./pages/ScannerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export default function App() {
  // AuthGate runs FIRST (before CartProvider/Router) so we never attempt to
  // load cart state or hit authenticated APIs before the user has a session.
  // This prevents the old "scanner throws on every API call" UX from the
  // dev-bearer era — if you're not signed in, you only see the login screen.
  return (
    <AuthGate>
      <CartProvider>
        <BrowserRouter basename="/scanner">
          <Routes>
            <Route path="/" element={<ScannerPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
