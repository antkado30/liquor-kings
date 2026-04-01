import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { ReviewLayout } from "./review/ReviewLayout";
import { ReviewQueueView } from "./review/ReviewQueueView";
import { ReviewRunDetailView } from "./review/ReviewRunDetailView";
import { adminPathBase } from "./review/pathUtils";
import { AppShell } from "./shell/AppShell";
import { SignInView } from "./shell/SignInView";
import { OperatorSessionProvider, useOperatorSession } from "./session/OperatorSessionContext";

const routerBasename = adminPathBase() || "/";

function AuthenticatedRoutes() {
  const { currentStore } = useOperatorSession();
  const remountKey = currentStore?.id ?? "store";

  return (
    <BrowserRouter basename={routerBasename}>
      <Routes>
        <Route path="/" element={<Navigate to="/review" replace />} />
        <Route element={<ReviewLayout remountKey={remountKey} />}>
          <Route path="review" element={<ReviewQueueView />} />
          <Route path="review/:runId" element={<ReviewRunDetailView />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function AppBody() {
  const { bootstrap, authenticated } = useOperatorSession();

  if (bootstrap === "loading") {
    return (
      <div className="card gate bootstrap-wait">
        <p className="muted" style={{ margin: 0 }}>
          Loading session state…
        </p>
      </div>
    );
  }

  if (!authenticated) {
    return <SignInView />;
  }

  return <AuthenticatedRoutes />;
}

export default function App() {
  return (
    <OperatorSessionProvider>
      <AppShell>
        <AppBody />
      </AppShell>
    </OperatorSessionProvider>
  );
}
