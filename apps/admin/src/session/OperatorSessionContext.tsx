import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deleteSession,
  getSession,
  parseJson,
  patchSessionStore,
  postSession,
} from "../api/operatorReview";
import type { FlashMsg, Operator, StoreRow } from "../operator-review/types";

type Bootstrap = "loading" | "ready";

type Ctx = {
  bootstrap: Bootstrap;
  authenticated: boolean;
  operator: Operator | null;
  stores: StoreRow[];
  currentStore: StoreRow | null;
  storeSelect: string;
  setStoreSelect: (id: string) => void;
  gateMsg: FlashMsg;
  shellMsg: FlashMsg;
  clearShellMsg: () => void;
  loadSession: () => Promise<void>;
  connect: (accessToken: string, preferredStoreId: string) => Promise<boolean>;
  logout: () => Promise<void>;
  applyStoreSwitch: () => Promise<boolean>;
  handleSessionFailure: (res: Response, body: Record<string, unknown>) => Promise<boolean>;
};

const OperatorSessionContext = createContext<Ctx | null>(null);

export function useOperatorSession(): Ctx {
  const v = useContext(OperatorSessionContext);
  if (!v) throw new Error("useOperatorSession must be used within OperatorSessionProvider");
  return v;
}

export function OperatorSessionProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap>("loading");
  const [authenticated, setAuthenticated] = useState(false);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [currentStore, setCurrentStore] = useState<StoreRow | null>(null);
  const [storeSelect, setStoreSelect] = useState("");
  const [gateMsg, setGateMsg] = useState<FlashMsg>({ type: "", text: "" });
  const [shellMsg, setShellMsg] = useState<FlashMsg>({ type: "", text: "" });

  const clearShellMsg = useCallback(() => setShellMsg({ type: "", text: "" }), []);

  const fullReset = useCallback(() => {
    setAuthenticated(false);
    setOperator(null);
    setStores([]);
    setCurrentStore(null);
    setStoreSelect("");
    setShellMsg({ type: "", text: "" });
  }, []);

  const handleSessionFailure = useCallback(
    async (res: Response, body: Record<string, unknown>): Promise<boolean> => {
      const code = body.code as string | undefined;
      if (
        res.status === 401 &&
        (code === "operator_session_required" || /session/i.test(String(body.error ?? "")))
      ) {
        // 2026-06-14 full-app sweep: deleteSession (fetchWithRetry) can
        // throw on a network error/timeout. This function is called from
        // loadRunsWithFilters/loadRunDetail/applyStoreSwitch — some of
        // those callers don't wrap the call in try/catch (applyStoreSwitch
        // doesn't), so an uncaught throw here would silently abort the
        // store-switch with no message. The cookie clear is best-effort —
        // we're resetting local state regardless.
        try {
          await deleteSession();
        } catch {
          /* best-effort cookie clear; local state reset below regardless */
        }
        fullReset();
        setGateMsg({
          type: "warn",
          text: String(body.error ?? "Your session expired. Sign in again."),
        });
        setShellMsg({
          type: "warn",
          text: String(body.error ?? "Your session expired. Sign in again."),
        });
        return true;
      }
      if (res.status === 403 && code === "operator_session_revoked") {
        try {
          await deleteSession();
        } catch {
          /* best-effort cookie clear; see above */
        }
        fullReset();
        const t = String(
          body.error ?? "Store access was revoked. Sign in again if you still have membership.",
        );
        setGateMsg({ type: "warn", text: t });
        setShellMsg({ type: "warn", text: t });
        return true;
      }
      return false;
    },
    [fullReset],
  );

  const loadSession = useCallback(async () => {
    try {
      const res = await getSession();
      const body = await parseJson(res);
      if (!res.ok) {
        fullReset();
        setGateMsg({ type: "error", text: String(body.error ?? "Could not read session.") });
        return;
      }
      if (!body.authenticated) {
        setAuthenticated(false);
        setOperator(null);
        setStores([]);
        setCurrentStore(null);
        if (body.reason === "invalid_or_expired" || body.reason === "membership_revoked") {
          const t = String(body.message ?? "Session is no longer valid.");
          setGateMsg({ type: "warn", text: t });
          setShellMsg({ type: "warn", text: t });
        } else {
          setGateMsg({ type: "", text: "" });
          setShellMsg({ type: "", text: "" });
        }
        return;
      }
      setAuthenticated(true);
      setOperator((body.operator as Operator) ?? null);
      setStores((body.stores as StoreRow[]) ?? []);
      const cs = body.current_store as StoreRow | undefined;
      const cid = body.current_store_id as string | undefined;
      setCurrentStore(cs ?? (cid ? { id: cid, name: null } : null));
      setStoreSelect(String(body.current_store_id ?? ""));
      setGateMsg({ type: "", text: "" });
      setShellMsg({ type: "", text: "" });
    } catch {
      fullReset();
      setGateMsg({ type: "error", text: "Network error while checking session." });
    } finally {
      setBootstrap("ready");
    }
  }, [fullReset]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const connect = useCallback(
    async (accessToken: string, preferredStoreId: string): Promise<boolean> => {
      setGateMsg({ type: "", text: "" });
      if (!accessToken.trim()) {
        setGateMsg({ type: "error", text: "Access token is required." });
        return false;
      }
      let res: Response;
      try {
        res = await postSession({
          accessToken: accessToken.trim(),
          storeId: preferredStoreId.trim() || null,
        });
      } catch (e) {
        // 2026-06-14 full-app sweep: postSession (fetchWithRetry) THROWS
        // after exhausting retries on a network error/timeout — this was
        // unguarded, so SignInView's onSignIn() (which has no catch around
        // `await connect(...)`) turned a network blip into an unhandled
        // promise rejection: the "Signing in..." button reset to idle via
        // its `finally`, but no error ever reached gateMsg. Same silent-
        // failure class as AUDIT #28 (loadSession), just one level deeper.
        setGateMsg({
          type: "error",
          text: `Network error while signing in: ${e instanceof Error ? e.message : String(e)}`,
        });
        return false;
      }
      const body = await parseJson(res);
      if (!res.ok) {
        setGateMsg({ type: "error", text: String(body.error ?? "Failed to create session.") });
        return false;
      }
      await loadSession();
      setShellMsg({ type: "success", text: "Operator session connected." });
      return true;
    },
    [loadSession],
  );

  const logout = useCallback(async () => {
    try {
      await deleteSession();
    } catch {
      // 2026-06-14 full-app sweep: deleteSession (fetchWithRetry) throws on
      // a network error after retries — previously unguarded, which made
      // "Sign out" silently no-op on a flaky connection (unhandled
      // rejection, button stuck, no message). Best-effort: clear local
      // session state regardless so the user is at least locally signed
      // out; loadSession() below will reconcile with the server once it's
      // reachable again.
    }
    fullReset();
    setGateMsg({ type: "success", text: "Signed out. Session cookie cleared." });
    setShellMsg({ type: "", text: "" });
    await loadSession();
  }, [fullReset, loadSession]);

  const applyStoreSwitch = useCallback(async (): Promise<boolean> => {
    if (!storeSelect) return false;
    clearShellMsg();
    let res: Response;
    try {
      res = await patchSessionStore(storeSelect);
    } catch (e) {
      // 2026-06-14 full-app sweep: same class as connect() above —
      // patchSessionStore throws on network error/timeout; previously
      // unguarded, leaving the store-switch action silently unresolved.
      setShellMsg({
        type: "error",
        text: `Network error while switching stores: ${e instanceof Error ? e.message : String(e)}`,
      });
      return false;
    }
    const body = await parseJson(res);
    if (!res.ok) {
      if (await handleSessionFailure(res, body)) return false;
      setShellMsg({ type: "error", text: String(body.error ?? "Failed to switch store.") });
      return false;
    }
    const cs = body.current_store as StoreRow | undefined;
    if (cs) setCurrentStore(cs);
    await loadSession();
    setShellMsg({ type: "success", text: "Store switched." });
    return true;
  }, [storeSelect, clearShellMsg, handleSessionFailure, loadSession]);

  const value = useMemo(
    () => ({
      bootstrap,
      authenticated,
      operator,
      stores,
      currentStore,
      storeSelect,
      setStoreSelect,
      gateMsg,
      shellMsg,
      clearShellMsg,
      loadSession,
      connect,
      logout,
      applyStoreSwitch,
      handleSessionFailure,
    }),
    [
      bootstrap,
      authenticated,
      operator,
      stores,
      currentStore,
      storeSelect,
      gateMsg,
      shellMsg,
      clearShellMsg,
      loadSession,
      connect,
      logout,
      applyStoreSwitch,
      handleSessionFailure,
    ],
  );

  return (
    <OperatorSessionContext.Provider value={value}>{children}</OperatorSessionContext.Provider>
  );
}
