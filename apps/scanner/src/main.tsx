import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry, Sentry } from "./lib/sentry";

initSentry();

/**
 * Global error boundary fallback. Shows the user something useful when
 * React tree crashes (e.g. an unhandled promise rejection in a render
 * cycle or a thrown error in a component lifecycle):
 *   - A clear apology + recovery action ("Reload scanner")
 *   - A "try again" softer action that re-renders the tree without a
 *     full page reload (resetError) — preserves the auth session and
 *     in-progress cart state if the error was localized
 *   - The underlying error message in a collapsible details block for
 *     anyone debugging (helps when a user texts you a screenshot)
 *
 * The error itself is also forwarded to Sentry by the wrapping
 * Sentry.ErrorBoundary, so we get telemetry in addition to UX.
 */
function ErrorFallback({
  error,
  resetError,
}: {
  error: unknown;
  resetError?: () => void;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "An unexpected error occurred.";
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0b0d12",
        color: "#fff",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          background: "#15181f",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          The scanner hit a problem
        </h1>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
          Try the recovery options below. If this keeps happening, send a
          screenshot to support and we'll fix it.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {typeof resetError === "function" ? (
            <button
              type="button"
              onClick={() => resetError()}
              style={{
                flex: 1,
                background: "rgba(255, 255, 255, 0.1)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 14px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                minWidth: 120,
              }}
            >
              Try again
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              flex: 1,
              background: "#3a82f7",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              minWidth: 140,
            }}
          >
            Reload scanner
          </button>
        </div>
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 12, opacity: 0.6, cursor: "pointer" }}>
            Technical details
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 10,
              background: "#0b0d12",
              borderRadius: 6,
              fontSize: 11,
              color: "#ff9a9a",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {message}
          </pre>
        </details>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <ErrorFallback error={error} resetError={resetError} />
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
