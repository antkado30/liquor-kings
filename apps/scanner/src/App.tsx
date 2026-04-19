import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CartProvider } from "./hooks/useCart";
import { CartPage } from "./pages/CartPage";
import { ScannerPage } from "./pages/ScannerPage";

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter basename="/scanner">
        <Routes>
          <Route path="/" element={<ScannerPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </CartProvider>
  );
}
