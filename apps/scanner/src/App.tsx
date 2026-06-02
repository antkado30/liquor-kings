import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthGate } from "./components/AuthGate";
import { CartProvider } from "./hooks/useCart";
import { CartPage } from "./pages/CartPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ScannerPage } from "./pages/ScannerPage";

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthGate>
  );
}
