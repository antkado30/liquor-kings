import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry, Sentry } from "./lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 20, color: "#fff" }}>Something went wrong. Please refresh.</div>
      }
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
