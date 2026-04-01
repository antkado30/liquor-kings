import type { ReactNode } from "react";
import { Msg } from "../operator-review/components/Msg";
import { useOperatorSession } from "../session/OperatorSessionContext";

export function AppShell({ children }: { children: ReactNode }) {
  const {
    bootstrap,
    authenticated,
    operator,
    currentStore,
    stores,
    storeSelect,
    setStoreSelect,
    shellMsg,
    clearShellMsg,
    logout,
    applyStoreSwitch,
  } = useOperatorSession();

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-title">
          <strong>Liquor Kings — Operator Review</strong>
          <div className="sub">
            Same-origin app under <code>/operator-review/app/</code>. Session and API routes unchanged on{" "}
            <code>/operator-review</code>.
          </div>
        </div>
      </header>

      <div className={`session-strip ${authenticated ? "" : "signed-out"}`}>
        {bootstrap === "loading" ? (
          <span className="session-strip-main">Checking session…</span>
        ) : authenticated ? (
          <div className="session-strip-inner">
            <div className="session-strip-main">
              <span>
                Signed in as{" "}
                <strong className="mono">{operator?.email ?? operator?.id ?? "operator"}</strong>
              </span>
              <span className="session-strip-sep" aria-hidden>
                ·
              </span>
              <span>
                Store:{" "}
                <span className="mono">
                  {currentStore ? `${currentStore.name ?? "(unnamed)"} · ${currentStore.id}` : "—"}
                </span>
              </span>
            </div>
            <div className="session-strip-actions">
              {stores.length > 1 ? (
                <>
                  <label className="inline-label">Switch</label>
                  <select
                    value={storeSelect}
                    onChange={(e) => {
                      clearShellMsg();
                      setStoreSelect(e.target.value);
                    }}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ?? s.id}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="secondary" onClick={() => void applyStoreSwitch()}>
                    Apply store
                  </button>
                </>
              ) : null}
              <button type="button" className="secondary" onClick={() => void logout()}>
                Logout
              </button>
            </div>
          </div>
        ) : (
          <span className="session-strip-main">Signed out — sign in below to triage runs.</span>
        )}
      </div>

      {authenticated && shellMsg.text ? (
        <div className="shell-flash">
          <Msg type={shellMsg.type} text={shellMsg.text} />
        </div>
      ) : null}

      <main className="app-main">{children}</main>
    </div>
  );
}
