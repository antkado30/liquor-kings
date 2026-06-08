/**
 * CartDrawer — two-step Validate → Submit UX (Phase 1 Week 1 of V1 roadmap,
 * 2026-05-30).
 *
 * Mirrors MLCC's actual user flow:
 *   1. User reviews cart (with instant rule-engine feedback per line)
 *   2. Clicks "Validate against MLCC" → backend RPA runs Stages 1-4 → we
 *      surface MILO's live cart state (in-stock items, out-of-stock items,
 *      totals, ADA breakdown, validate messages)
 *   3. User can edit cart (any mutation invalidates the validate result
 *      and the Submit button locks again — they must re-validate)
 *   4. User clicks "Submit Order" → confirmation modal → RPA runs Stages
 *      1-5 → real checkout
 *
 * Two layers of validation, each serving a different purpose:
 *   - Instant rule-engine validation (validateCart from api/cart) — runs
 *     locally as the cart changes, surfaces split-case errors, 9L
 *     minimum-per-ADA, etc. WITHOUT hitting MILO. Catches obvious issues
 *     in 50ms. ALWAYS runs.
 *   - MLCC live validation (validate_only RPA run) — actually logs into
 *     MILO, adds items, runs MILO's real Validate. Sees real stock
 *     status, surfaces OOS items, MILO's own validation messages. Costs
 *     30-60s + a few pennies per run.
 *
 * Submit is GATED on (a) instant rule-engine clean AND (b) at least one
 * successful MLCC validate. This means a user can never accidentally
 * submit a cart that hasn't been confirmed against MLCC's live view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { validateCart, type CartValidationResult } from "../api/cart";
import {
  getRunSummary,
  isTerminalStatus,
  triggerMlccCartReset,
} from "../api/execution";
import {
  createOrderTemplate,
  listOrderTemplates,
  loadOrderTemplate,
  type OrderTemplate,
} from "../api/orderTemplates";
import { cartLineId, type CartContextValue } from "../hooks/useCart";
import { useSubmission } from "../hooks/useSubmission";
import type { BackgroundPreValidate } from "../hooks/useBackgroundPreValidate";
import { useHideTabBar } from "../hooks/useHideTabBar";
import { SubmitConfirmationModal } from "./SubmitConfirmationModal";
import {
  generateValidQuantities,
  getOrderingRuleDisplay,
} from "../lib/mlcc-ordering-rules";

function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/**
 * Compute "inferred OOS" — cart items the user added that did NOT show up
 * in MILO's ada_breakdown active items. Almost always means MILO demoted
 * them to its OOS section even though Stage 3 thought it added them.
 *
 * Used in two places:
 *   1. ValidateResultPanel — renders the list of likely-OOS items.
 *   2. CartDrawer parent — gates Submit on inferredOos.length === 0
 *      (otherwise we'd surface "MLCC says ready for checkout" + a list
 *      of OOS items in the same banner, which is incoherent).
 *
 * NOTE 2026-06-04 (#53 ships): the server now emits structured
 * `out_of_stock_items` with `reason: "oos_section" | "validate_demoted"`
 * directly. Use `getServerOosCodes` for the new authoritative source.
 * This function is retained as a *consistency check* — if the server
 * misses a demotion (parser regression, MILO UI change), the client
 * falls back to inferred and logs a divergence warning in dev.
 */
function computeInferredOos(
  cartItems: CartContextValue["items"],
  result: import("../api/execution").ValidateResult | null,
): CartContextValue["items"] {
  if (!result) return [];
  const adaBreakdown = Array.isArray(result.ada_breakdown) ? result.ada_breakdown : [];
  const adaActiveCodes = new Set<string>();
  for (const ada of adaBreakdown) {
    const items = Array.isArray((ada as { items?: unknown[] }).items)
      ? ((ada as { items: unknown[] }).items as unknown[])
      : [];
    for (const it of items) {
      const code = (it as { code?: unknown })?.code;
      if (typeof code === "string" && code) adaActiveCodes.add(code);
    }
  }
  /*
    Exclude items already in items_rejected (2026-06-01 fix for #61).
    Tony's Tito's 750ml false-OOS flake: Stage 3 timed out waiting for
    MILO's quick-add list to render → reported the item in
    items_rejected ("did not appear in quick add list"). Without this
    filter, the item ALSO appeared in inferredOos with the misleading
    "out of stock" label. Real cause is a Stage 3 timeout, not stock.
    The rejected list now owns the user-facing message for those rows.
  */
  const rejectedCodes = new Set<string>();
  const rejectedList = Array.isArray(result.items_rejected)
    ? result.items_rejected
    : [];
  for (const it of rejectedList) {
    const code = (it as { code?: unknown })?.code;
    if (typeof code === "string" && code) rejectedCodes.add(code);
  }
  return cartItems.filter(
    (line) =>
      !adaActiveCodes.has(line.product.code) &&
      !rejectedCodes.has(line.product.code),
  );
}

/**
 * Cart items the SERVER tagged as OOS via Stage 4's structured
 * out_of_stock_items list (task #53, 2026-06-04). Includes both:
 *   - oos_section: MILO put it in its dedicated OOS table
 *   - validate_demoted: Stage 3 saw it in cart, Stage 4 lost track
 *     after the validate click
 * Server-authoritative — the inferredOos computation is now a backstop
 * for the case where the server parser regresses.
 */
function getServerOosCodes(
  result: import("../api/execution").ValidateResult | null,
): Set<string> {
  if (!result) return new Set();
  const list = Array.isArray(result.out_of_stock_items)
    ? result.out_of_stock_items
    : [];
  const codes = new Set<string>();
  for (const it of list) {
    const code = (it as { code?: unknown })?.code;
    if (typeof code === "string" && code) codes.add(code);
  }
  return codes;
}

/*
  Recognize Stage 3 timeout rejections so the UI shows a recoverable
  "try re-validate" message instead of the hard "MLCC rejected this"
  language we use for genuine rule violations. The reason string is
  produced by add-items-to-cart.js (services/api/src/rpa/stages/) and
  is stable enough to pattern-match.
*/
function isStage3TimeoutRejection(reason: unknown): boolean {
  if (typeof reason !== "string") return false;
  return /quick add list|did not appear/i.test(reason);
}

/**
 * Stages the user sees during a validate_only RPA run. The `id` matches
 * the worker's `progress_stage` value reported via the heartbeat. The
 * `label` is user-facing copy (kept short and concrete — "Logging in"
 * not "Stage 1"). Order matters: the progress list checks indices left
 * to right.
 */
const RPA_STAGES_VALIDATE: ReadonlyArray<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
];

/**
 * Stages for a full submit run (Stages 1-5). Same shape as the validate
 * list with one extra step at the end.
 */
const RPA_STAGES_SUBMIT: ReadonlyArray<{ id: string; label: string }> = [
  { id: "rpa_login", label: "Logging into MLCC" },
  { id: "rpa_navigate", label: "Loading products page" },
  { id: "rpa_add_items", label: "Adding items to cart" },
  { id: "rpa_validate", label: "Validating cart" },
  { id: "rpa_checkout", label: "Submitting order" },
];

type CartDrawerProps = {
  cart: CartContextValue;
  onClose: () => void;
  onSubmit?: () => void;
  /**
   * Optional callback fired when the user taps a cart line's product
   * name (task #51, 2026-05-30 — Amazon-style sibling browsing). The
   * scanner page handles opening the ProductCard for that bottle's
   * family so the user can swap sizes / see other SKUs in the same
   * brand without re-scanning. If omitted, the line title is not
   * tappable and the drawer behaves the same as before.
   */
  onLineProductClick?: (product: import("../types").MlccProduct) => void;
  /**
   * Background pre-validate cache (task #47, 2026-06-02). When the
   * user taps Validate, useSubmission checks this cache first; on a
   * hit, the state machine skips straight to validateDone instead of
   * running the full sync+trigger+poll pipeline. Optional — without
   * it, the drawer falls back to the foreground-only flow.
   */
  preValidate?: BackgroundPreValidate;
  /**
   * Store identity for the pre-submit verification modal (task #89,
   * 2026-06-07). Optional — when missing, the modal still renders
   * with a generic "Your store" header. Source: /home/smart-cards
   * store_meta.store_name / liquor_license, surfaced via ScannerPage.
   */
  storeName?: string | null;
  storeLicense?: string | null;
};

export function CartDrawer({
  cart,
  onClose,
  onLineProductClick,
  preValidate,
  storeName,
  storeLicense,
}: CartDrawerProps) {
  /*
   * Hide the bottom tab bar while the drawer is open. Tony's
   * 2026-06-07 critical bug: the tab bar was covering the Submit
   * button at the bottom of the drawer so the user literally could
   * not reach it. This kills the overlap.
   */
  useHideTabBar();
  const {
    items,
    groupedByAda,
    totalCost,
    clearCart,
    incrementQuantity,
    decrementQuantity,
    removeItem,
    updateQuantity,
  } = cart;
  // Wire pre-validate cache into useSubmission so startValidate can
  // short-circuit on a fresh cached result (task #47, 2026-06-02).
  const submission = useSubmission(preValidate);
  const { state, startValidate, startSubmit, invalidateValidation, reset } = submission;

  // Compound "is the flow doing something async right now" flag. Used to
  // disable UI controls during sync / poll. Covers both validate and
  // submit phases.
  const isBusy =
    state.kind === "validateSyncing" ||
    state.kind === "validateStarting" ||
    state.kind === "validatePolling" ||
    state.kind === "submitStarting" ||
    state.kind === "submitPolling";

  // Inferred OOS for the current validate result. Empty when not in
  // validateDone state, or when MILO showed all cart items as active.
  // Used to gate Submit so we never offer "submit a cart that has
  // likely-OOS items in it".
  //
  // 2026-06-04 #53: server now emits structured out_of_stock_items
  // covering both oos_section and validate_demoted cases. Treat that as
  // authoritative. We still compute inferredOos as a backstop — if the
  // server misses an item (parser regression / MILO UI change), we
  // catch it client-side and warn in dev so the divergence is visible.
  const serverOosCodes =
    state.kind === "validateDone"
      ? getServerOosCodes(state.validateResult)
      : new Set<string>();
  const inferredOos =
    state.kind === "validateDone"
      ? computeInferredOos(items, state.validateResult)
      : [];

  // Has MLCC actually said this cart is OK? Only true when the last
  // validate ended succeeded AND MILO said canCheckout=true AND
  // there are no server-tagged OOS items AND no client-inferred OOS
  // items (the inferred check is a backstop against a server parser
  // regression — see getServerOosCodes comment above).
  const mlccValidatePassed =
    state.kind === "validateDone" &&
    state.finalStatus === "succeeded" &&
    state.validateResult?.can_checkout === true &&
    serverOosCodes.size === 0 &&
    inferredOos.length === 0;

  // Dev-only divergence warning: if the server says "no OOS" but the
  // client-side inferred-from-absence check finds some, that's a sign
  // the Stage 4 parser missed a demotion. Surfaces in browser console
  // so we catch parser regressions in real-world use.
  useEffect(() => {
    if (import.meta.env.DEV && state.kind === "validateDone") {
      if (serverOosCodes.size === 0 && inferredOos.length > 0) {
        console.warn(
          "[#53] Server reported no OOS but client inferred",
          inferredOos.length,
          "demoted items:",
          inferredOos.map((line) => line.product.code),
        );
      }
    }
  }, [state.kind, serverOosCodes.size, inferredOos.length]);

  const [isCheckingValidation, setIsCheckingValidation] = useState(false);
  const [validationResult, setValidationResult] = useState<CartValidationResult | null>(null);
  const validationRequestRef = useRef(0);

  /**
   * Confirmation gate before triggering the real RPA submit. Stage 5 is
   * triple-gated server-side, this is the UX-level "are you sure?"
   */
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  // ─── Instant rule-engine validation (unchanged from prior CartDrawer) ──
  //
  // Debounced 400ms after the cart changes. Surfaces split-case / quantity
  // errors per line and ADA 9L violations. Does NOT hit MILO.
  useEffect(() => {
    if (items.length === 0) {
      setIsCheckingValidation(false);
      setValidationResult(null);
      return;
    }
    const requestId = validationRequestRef.current + 1;
    validationRequestRef.current = requestId;
    const timer = window.setTimeout(() => {
      setIsCheckingValidation(true);
      void validateCart(items.map((line) => ({ code: line.product.code, quantity: line.quantity })))
        .then((result) => {
          if (validationRequestRef.current !== requestId) return;
          setValidationResult(result);
          setIsCheckingValidation(false);
        })
        .catch((error: unknown) => {
          if (validationRequestRef.current !== requestId) return;
          setValidationResult({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
          setIsCheckingValidation(false);
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [items]);

  // ─── Cart-mutation handlers that ALSO invalidate validate state ───────
  //
  // Whenever the user touches the cart, our validateDone state becomes
  // stale — the next submit MUST re-validate. invalidateValidation()
  // resets the submission state to idle so the Submit button locks again.
  const handleIncrement = (lineId: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    incrementQuantity(lineId);
  };
  const handleDecrement = (lineId: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    decrementQuantity(lineId);
  };
  const handleRemove = (code: string) => {
    if (state.kind === "validateDone") invalidateValidation();
    removeItem(code);
  };
  const handleUpdateQuantity = (code: string, qty: number) => {
    if (state.kind === "validateDone") invalidateValidation();
    updateQuantity(code, qty);
  };
  // handleClearCart used to be a separate "Clear scanner cart" button;
  // Tony's 2026-06-07 redesign combined it into "Clear cart" which
  // goes through the MLCC reset flow (which calls clearCart() locally
  // on success too). Kept here for reference / future use.
  void clearCart; // mark referenced
  void reset; // mark referenced

  /*
   * "Reset MLCC cart" handler (task #57, 2026-06-04). Fires the
   * cart_reset_only execution run that logs into MILO and clicks Clear
   * Cart server-side. Polls until terminal. Resolves the lie where
   * the local "Clear scanner cart" left MILO holding items.
   *
   * On success we ALSO clear the local cart, since after MILO is empty
   * there's no reason to keep local lines around.
   */
  const [mlccResetState, setMlccResetState] = useState<
    | { kind: "idle" }
    | { kind: "confirm" }
    | { kind: "running"; runId: string }
    | { kind: "done"; cleared: boolean; itemCount: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleMlccReset = async () => {
    setMlccResetState({ kind: "confirm" });
  };

  /*
   * Order template state (task #72, 2026-06-04 afternoon).
   *
   * Dad rebuilds his Thursday MLCC order from scratch every week even
   * though 80% of it is the same staples. Templates let him save the
   * weekly base order once and load it back as a starting point.
   *
   * UI states:
   *   templatesState.kind === "idle"       → buttons visible if user has any
   *   templatesState.kind === "loading"    → fetching list
   *   templatesState.kind === "loaded"     → list ready
   *   templatesState.kind === "saving"     → save modal open
   *   templatesState.kind === "loadingOne" → loading a specific template
   */
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  /*
   * Scheduling state (task #75). null = no schedule (manual loads only).
   * 0-6 = day-of-week. Default is "no schedule" so users opt in.
   */
  const [saveTemplateDow, setSaveTemplateDow] = useState<number | null>(null);
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateLoading, setTemplateLoading] = useState<string | null>(null);
  const [templateLoadResult, setTemplateLoadResult] = useState<{
    name: string;
    addedCount: number;
    missingCount: number;
  } | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // One-shot template fetch when the drawer opens.
  useEffect(() => {
    if (templatesLoaded) return;
    let cancelled = false;
    void listOrderTemplates().then((r) => {
      if (cancelled) return;
      if (r.ok) setTemplates(r.data);
      setTemplatesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [templatesLoaded]);

  const handleSaveTemplate = async () => {
    const name = saveTemplateName.trim();
    if (!name || items.length === 0) return;
    setSaveTemplateBusy(true);
    setTemplateError(null);
    const itemsPayload = items.map((line) => ({
      mlcc_code: line.product.code,
      quantity: line.quantity,
      name: line.product.name,
      bottle_size_ml: line.product.bottle_size_ml ?? undefined,
    }));
    const r = await createOrderTemplate({
      name,
      items: itemsPayload,
      schedule_dow: saveTemplateDow,
    });
    setSaveTemplateBusy(false);
    if (!r.ok) {
      setTemplateError(r.error);
      return;
    }
    setTemplates((cur) => [r.data, ...cur]);
    setShowSaveTemplate(false);
    setSaveTemplateName("");
    setSaveTemplateDow(null);
  };

  const handleLoadTemplate = async (templateId: string) => {
    setTemplateLoading(templateId);
    setTemplateError(null);
    const r = await loadOrderTemplate(templateId);
    setTemplateLoading(null);
    setShowTemplatePicker(false);
    if (!r.ok) {
      setTemplateError(r.error);
      return;
    }
    // Push each hydrated item into the cart. addItem merges duplicates,
    // so loading a template on top of an existing cart adds-quantity
    // instead of duplicating lines.
    for (const it of r.data.items) {
      cart.addItem(it.product, it.quantity);
    }
    setTemplateLoadResult({
      name: r.data.template.name,
      addedCount: r.data.items.length,
      missingCount: r.data.missingCodes.length,
    });
    // Auto-dismiss the success badge after 3s.
    setTimeout(() => {
      setTemplateLoadResult((cur) => (cur ? null : cur));
    }, 3000);
  };

  /*
   * Instant-feel version (task #71, 2026-06-04 afternoon).
   *
   * Old flow blocked the UI for 30-60s while the RPA cleared MILO. Tony
   * called it out — "should take an instant." MILO's site genuinely IS
   * slow, but the local cart can clear in 1ms. So:
   *   - Tap → confirm → IMMEDIATELY clear local cart + show "MLCC
   *     syncing" badge → user can keep working
   *   - RPA fires in background, polls silently
   *   - On success: badge auto-dismisses after 2s
   *   - On error: badge turns red with the message and stays until
   *     user dismisses (we still want them to know if it failed)
   *
   * The `running` state intentionally no longer disables the rest of
   * the UI — only the Reset button itself is disabled while a sync is
   * in flight, to prevent double-firing.
   */
  const confirmMlccReset = async () => {
    // Step 1: clear local IMMEDIATELY. User sees empty cart in <100ms.
    if (state.kind !== "idle") reset();
    clearCart();
    setMlccResetState({ kind: "running", runId: "" });

    // Step 2: kick off the RPA run.
    const trigger = await triggerMlccCartReset();
    if (!trigger.ok) {
      setMlccResetState({ kind: "error", message: trigger.error });
      return;
    }
    setMlccResetState({ kind: "running", runId: trigger.runId });

    // Step 3: poll quietly in the background. User can ignore us.
    const start = Date.now();
    const MAX_POLL_MS = 180_000;
    while (Date.now() - start < MAX_POLL_MS) {
      await new Promise((r) => setTimeout(r, 2000));
      const summary = await getRunSummary({ runId: trigger.runId });
      if (!summary.ok) continue;
      if (isTerminalStatus(summary.summary.status)) {
        if (summary.summary.status === "succeeded") {
          const evidence = (summary.summary as unknown as {
            evidence?: Array<{
              kind?: string;
              attributes?: { cleared?: boolean; itemCountBefore?: number };
            }>;
          }).evidence;
          const summaryEntry = (evidence ?? []).find(
            (e) => e?.kind === "cart_reset_summary",
          );
          const cleared = !!summaryEntry?.attributes?.cleared;
          const itemCount = summaryEntry?.attributes?.itemCountBefore ?? 0;
          setMlccResetState({ kind: "done", cleared, itemCount });
          // Auto-dismiss the success badge after 2s so it doesn't clutter.
          setTimeout(() => {
            setMlccResetState((cur) =>
              cur.kind === "done" ? { kind: "idle" } : cur,
            );
          }, 2000);
        } else {
          // Errors stick around until the user dismisses (they're real).
          setMlccResetState({
            kind: "error",
            message: `MLCC sync failed (status: ${summary.summary.status}). MILO may still have items — tap Reset to retry.`,
          });
        }
        return;
      }
    }
    setMlccResetState({
      kind: "error",
      message:
        "MLCC sync is taking longer than 3 minutes. Check Orders, or tap Reset to retry.",
    });
  };

  const hasDefinitiveValidationFailure =
    validationResult?.ok === true && validationResult.valid === false;
  // Validate is allowed only when rule-engine validation has cleared. We
  // don't want to waste an RPA run on a cart that obviously won't pass.
  const validateDisabled =
    isBusy || items.length === 0 || hasDefinitiveValidationFailure;
  // Submit is allowed only AFTER a successful MLCC validate, AND the
  // rule-engine is still clean (user hasn't edited the cart since).
  const submitDisabled = isBusy || !mlccValidatePassed || hasDefinitiveValidationFailure;

  // Cart-wide blockers shown above the validate button. Per-line errors
  // render inline on their cart line below.
  const validationBlockers = useMemo(() => {
    if (validationResult?.ok !== true || validationResult.valid !== false) return [];
    const cartCodes = new Set(items.map((line) => line.product.code));
    const blockers: string[] = validationResult.errors
      .filter((err) => {
        const codeStr = String(err.code);
        if (cartCodes.has(codeStr)) return false; // shown inline on the line
        if (codeStr.startsWith("ADA_")) return false; // adaBreakdown loop covers it
        return true;
      })
      .map((err) => err.reason)
      .filter((reason) => reason.trim().length > 0);
    for (const [adaNumber, info] of Object.entries(validationResult.adaBreakdown)) {
      if (info.meetsMinimum) continue;
      const matchedGroup = groupedByAda.find((group) => group.adaNumber === adaNumber);
      const adaName = matchedGroup?.adaName || `ADA ${adaNumber}`;
      const litersShort = Math.max(0, 9 - info.liters);
      blockers.push(`${adaName} is ${litersShort.toFixed(2)} L under the 9 L minimum.`);
    }
    return [...new Set(blockers)];
  }, [groupedByAda, validationResult, items]);

  const lineErrorFor = (code: string) =>
    validationResult?.ok === true
      ? validationResult.errors.find((err) => String(err.code) === code)
      : undefined;

  const handleClose = () => {
    if (isBusy) return;
    onClose();
  };

  const handleRetry = () => {
    reset();
  };

  // Map the worker's progress_stage value to the current "active" stage
  // index in our user-facing stage list. Returns -1 if the run hasn't
  // claimed/started yet (still in sync phase).
  const currentStageIndex = (s: typeof state): number => {
    let progressStage: string | null = null;
    if (s.kind === "validatePolling" || s.kind === "submitPolling") {
      progressStage = s.progressStage;
    }
    if (!progressStage) {
      // Pre-stage states map to "before stage 1" (no checkmarks yet).
      // Returning -1 means "the work hasn't reached any RPA stage".
      return -1;
    }
    const stages = s.kind === "submitPolling" ? RPA_STAGES_SUBMIT : RPA_STAGES_VALIDATE;
    const idx = stages.findIndex((st) => st.id === progressStage);
    return idx;
  };

  // Headline label for the progress panel.
  const progressHeadline = (s: typeof state): { title: string; sub?: string } => {
    if (s.kind === "validateSyncing")
      return { title: "Syncing cart to server", sub: `${s.itemsSynced} / ${s.itemsTotal} items` };
    if (s.kind === "validateStarting")
      return { title: "Validating against MLCC", sub: "Starting the RPA pipeline…" };
    if (s.kind === "validatePolling")
      return {
        title: "Validating against MLCC",
        sub: s.progressMessage ?? undefined,
      };
    if (s.kind === "submitStarting")
      return { title: "Submitting order to MLCC", sub: "Starting the RPA pipeline…" };
    if (s.kind === "submitPolling")
      return {
        title: "Submitting order to MLCC",
        sub: s.progressMessage ?? undefined,
      };
    return { title: "Working…" };
  };

  return (
    <div className="drawer-backdrop" onClick={handleClose} role="presentation">
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Cart">
        <div className="drawer-header">
          <h2>Cart</h2>
          <button type="button" className="drawer-close" onClick={handleClose} aria-label="Close cart" disabled={isBusy}>
            ×
          </button>
        </div>

        {/* ─── Cart contents (always visible unless in submit-done state) ─── */}
        {state.kind !== "submitDone" ? (
          <>
            {items.length === 0 ? (
              <p className="drawer-empty muted">Your cart is empty — scan items to add them</p>
            ) : (
              <div className="drawer-ada-groups">
                {groupedByAda.map((group) => {
                  const progressRatio = Math.min(group.liters / 9, 1);
                  const litersShort = Math.max(0, 9 - group.liters);
                  return (
                    <section key={group.adaNumber} className="drawer-ada-section">
                      <div className="drawer-ada-header">
                        <div className="drawer-ada-title">{group.adaName}</div>
                        <div className="drawer-ada-progress-text">
                          {group.liters.toFixed(2)} L / 9.00 L
                        </div>
                      </div>
                      <div className="drawer-ada-progress-track" aria-hidden="true">
                        <div
                          className={`drawer-ada-progress-fill ${group.meetsMinimum ? "is-met" : "is-short"}`}
                          style={{ width: `${progressRatio * 100}%` }}
                        />
                      </div>
                      {!group.meetsMinimum ? (
                        <p className="drawer-ada-needed">Need {litersShort.toFixed(2)} L more from this distributor</p>
                      ) : null}
                      <ul className="drawer-list">
                        {group.lines.map((line) => {
                          const unit = line.product.licensee_price ?? 0;
                          const lineTotal = unit * line.quantity;
                          const size =
                            line.product.bottle_size_label ?? `${line.product.bottle_size_ml ?? ""} ML`;
                          const lineId = cartLineId(line.product);
                          // Hoisted out of the qty-controls IIFE below so
                          // atMin can use it too. lineSmallestValid is what
                          // the `−` button bottoms out at (user must use
                          // trash icon to remove past that).
                          const lineRule = getOrderingRuleDisplay({
                            code: line.product.code,
                            bottle_size_ml: line.product.bottle_size_ml,
                            case_size: line.product.case_size,
                            ada_name: line.product.ada_name,
                          });
                          const lineValid = generateValidQuantities(lineRule);
                          const lineConstrained = lineValid.length > 0;
                          const lineSmallestValid = lineConstrained ? lineValid[0] : 1;
                          const atMin = line.quantity <= lineSmallestValid;
                          const lineError = lineErrorFor(line.product.code);
                          const suggestions = lineError?.suggestedAlternatives ?? [];
                          return (
                            <li key={lineId} className="drawer-line">
                              <div className="drawer-line-main">
                                {/*
                                  Title is tappable IF onLineProductClick is wired
                                  (task #51, 2026-05-30). Opens the ProductCard for
                                  this bottle's family — Amazon-style sibling
                                  browsing without re-scanning. Disabled during
                                  busy states so a tap mid-validate doesn't open
                                  a new modal layer over the progress UI.
                                */}
                                {onLineProductClick ? (
                                  <button
                                    type="button"
                                    className="drawer-line-title drawer-line-title--tappable"
                                    onClick={() => onLineProductClick(line.product)}
                                    disabled={isBusy}
                                  >
                                    {line.product.name}
                                  </button>
                                ) : (
                                  <div className="drawer-line-title">{line.product.name}</div>
                                )}
                                <div className="muted small">{size}</div>
                                <div className="drawer-line-controls">
                                  {/*
                                    Cart-line quantity controls (2026-05-31
                                    fix for #45). +/− snap to valid MLCC
                                    quantities via useCart's stepLineQuantity
                                    helper; tapping the qty number opens a
                                    native dropdown of all valid amounts so
                                    the user can jump to 240 without 20 taps.
                                  */}
                                  <div className="qty-stepper" role="group" aria-label="Quantity">
                                    <button
                                      type="button"
                                      className="qty-stepper__btn"
                                      aria-label="Decrease quantity"
                                      disabled={atMin || isBusy}
                                      onClick={() => handleDecrement(lineId)}
                                    >
                                      −
                                    </button>
                                    {lineConstrained ? (
                                      <div className="qty-picker-wrap qty-picker-wrap--cart" aria-live="polite">
                                        <span className="qty-picker-display">{line.quantity}</span>
                                        <select
                                          className="qty-picker-select"
                                          value={line.quantity}
                                          disabled={isBusy}
                                          onChange={(e) =>
                                            handleUpdateQuantity(
                                              line.product.code,
                                              Number(e.target.value),
                                            )
                                          }
                                          aria-label="Quantity (tap to choose from valid amounts)"
                                        >
                                          {/*
                                            Include the line's current qty as
                                            a "(not valid)" option if it's
                                            not in the valid list (e.g. a
                                            cart saved before this shipped).
                                            Lets the user see what they have
                                            without the select silently
                                            snapping to a different value.
                                          */}
                                          {!lineValid.includes(line.quantity) ? (
                                            <option value={line.quantity}>
                                              {line.quantity} (not valid)
                                            </option>
                                          ) : null}
                                          {lineValid.map((q) => (
                                            <option key={q} value={q}>
                                              {q} bottles
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : (
                                      <span className="qty-stepper__value" aria-live="polite">
                                        {line.quantity}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="qty-stepper__btn"
                                      aria-label="Increase quantity"
                                      disabled={isBusy}
                                      onClick={() => handleIncrement(lineId)}
                                    >
                                      +
                                    </button>
                                  </div>
                                  {/*
                                    Clean trash icon (task #52, 2026-05-30).
                                    Was: full-width red oval next to qty stepper that looked
                                    like an alarm button. Now: square icon button on the right
                                    edge with aria-label for screen readers + title tooltip.
                                  */}
                                  <button
                                    type="button"
                                    className="cart-line-remove-btn"
                                    disabled={isBusy}
                                    onClick={() => handleRemove(line.product.code)}
                                    aria-label={`Remove ${line.product.name} from cart`}
                                    title="Remove from cart"
                                  >
                                    <span aria-hidden>🗑️</span>
                                  </button>
                                </div>
                                {lineError ? (
                                  <div className="drawer-line-error" role="alert">
                                    <span className="drawer-line-error-text">{lineError.reason}</span>
                                    {suggestions.length > 0 ? (
                                      <div className="drawer-line-suggestions">
                                        <span className="muted small">Fix:</span>
                                        {suggestions.map((alt) => (
                                          <button
                                            key={alt}
                                            type="button"
                                            className="drawer-line-suggestion"
                                            disabled={isBusy}
                                            onClick={() => handleUpdateQuantity(line.product.code, alt)}
                                          >
                                            Set to {alt}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <div className="drawer-line-total">{money(lineTotal)}</div>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="drawer-ada-subtotal">
                        <span>ADA subtotal</span>
                        <strong>{money(group.subtotalCost)}</strong>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        ) : null}

        {/* ─── Rule-engine validation messages ────────────────────────────── */}
        {items.length > 0 && state.kind !== "submitDone" ? (
          <>
            {validationResult?.ok === false ? (
              <p className="drawer-validation-notice muted">
                Couldn&apos;t verify this cart right now ({validationResult.error}). You can still validate against MLCC.
              </p>
            ) : null}
            {hasDefinitiveValidationFailure ? (
              <ul className="drawer-validation-errors">
                {validationBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : null}
            <div className="drawer-total">
              <span>Total</span>
              <strong>{money(totalCost)}</strong>
            </div>
          </>
        ) : null}

        {/*
          Instant rule verdict during a validate run. The local rule-engine
          check already ran (debounced on cart change), so the moment the user
          taps Validate we can INSTANTLY confirm the cart passes MLCC's rules
          while the slower live MLCC availability check runs underneath. Turns
          the wait from a dead spinner into immediate positive feedback —
          Tony's "validate should feel instant" ask (2026-06-07).
        */}
        {isBusy &&
        (state.kind === "validateSyncing" ||
          state.kind === "validateStarting" ||
          state.kind === "validatePolling") &&
        validationResult?.ok &&
        validationResult.valid ? (
          <div className="banner banner-ok" style={{ marginBottom: 8 }}>
            ✓ Your cart passes MLCC rules — now confirming live availability
            with MLCC.
          </div>
        ) : null}

        {/* ─── Async progress (validate OR submit) ───────────────────────── */}
        {isBusy ? (
          <RpaProgressPanel
            headline={progressHeadline(state)}
            stages={
              state.kind === "submitStarting" || state.kind === "submitPolling"
                ? RPA_STAGES_SUBMIT
                : RPA_STAGES_VALIDATE
            }
            currentStageIndex={currentStageIndex(state)}
            preStage={
              state.kind === "validateSyncing" ||
              state.kind === "validateStarting" ||
              state.kind === "submitStarting"
            }
          />
        ) : null}

        {/* ─── Validate result panel (after successful MLCC validate) ────── */}
        {state.kind === "validateDone" && state.finalStatus === "succeeded" ? (
          <ValidateResultPanel
            result={state.validateResult}
            /*
              canCheckout for the BANNER is the AND of MILO's flag and
              our inferred-OOS check. When inferredOos is non-empty we
              want the warn-yellow banner + "review issues below"
              headline, not the green "ready for checkout" lie.
            */
            canCheckout={
              (state.validateResult?.can_checkout ?? null) === true &&
              serverOosCodes.size === 0 &&
              inferredOos.length === 0
            }
            cartItems={items}
          />
        ) : null}

        {state.kind === "validateDone" && state.finalStatus !== "succeeded" ? (
          <div className="banner banner-warn">
            MLCC validate finished as <strong>{state.finalStatus}</strong>. Review the cart and try again.
          </div>
        ) : null}

        {/* ─── Action buttons (idle / validateDone) ───────────────────────── */}
        {(state.kind === "idle" || state.kind === "validateDone") && items.length > 0 ? (
          <>
            {/*
              "Clear scanner cart" — clears LOCAL + LK server cart only.
              MILO's actual cart state lives in their session and won't
              empty until the next validate/submit run (Stage 3's auto-
              clear-cart pre-flight, task #9). The caption below tells
              the user this honestly. Bug found 2026-05-30: Tony hit
              "Clear cart" and MLCC still showed Tito's + Ciroc on the
              website — because we'd only ever cleared the scanner side.
              True MILO clear is task #56 (deferred — it costs an RPA
              run and most users don't actually need it between orders).
            */}
            {/*
              Order template controls (task #72). Shown above the
              Clear / Reset buttons so the "save this for next week"
              prompt sits next to the cart contents, not buried with
              destructive actions.
            */}
            {items.length > 0 ? (
              <button
                type="button"
                className="btn secondary btn-block"
                disabled={isBusy}
                onClick={() => {
                  // Pre-fill name with day-of-week (e.g. "Thursday order")
                  // — matches dad's actual weekly pattern.
                  const day = new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                  });
                  setSaveTemplateName(`${day} order`);
                  setShowSaveTemplate(true);
                }}
                style={{ marginBottom: 6 }}
              >
                Save as template
              </button>
            ) : null}
            {templates.length > 0 ? (
              <button
                type="button"
                className="btn secondary btn-block"
                disabled={isBusy || templateLoading !== null}
                onClick={() => setShowTemplatePicker(true)}
                style={{ marginBottom: 8 }}
              >
                Load saved template
                {templates.length > 1 ? ` (${templates.length})` : ""}
              </button>
            ) : null}
            {templateLoadResult ? (
              <p
                className="muted small"
                style={{
                  marginTop: 0,
                  marginBottom: 8,
                  textAlign: "center",
                  color: "#bbf7d0",
                }}
              >
                ✓ Loaded &quot;{templateLoadResult.name}&quot; — added{" "}
                {templateLoadResult.addedCount} items
                {templateLoadResult.missingCount > 0
                  ? `, skipped ${templateLoadResult.missingCount} no longer in MLCC catalog`
                  : ""}
              </p>
            ) : null}
            {templateError ? (
              <p
                className="muted small"
                style={{
                  marginTop: 0,
                  marginBottom: 8,
                  textAlign: "center",
                  color: "#fca5a5",
                }}
              >
                Template error: {templateError}
              </p>
            ) : null}
            {/*
              Single "Clear cart" button (2026-06-07, Tony's call).
              Tony was right that two buttons was confusing — the
              scanner cart and MILO cart are conceptually one thing to
              the user. handleMlccReset opens a confirm modal first,
              then runs the RPA clear, and clearCart() (local) is
              called on success. One button, one mental model, with a
              proper "are you sure" gate.
            */}
            <button
              type="button"
              className="btn secondary btn-block"
              disabled={mlccResetState.kind === "running"}
              onClick={() => void handleMlccReset()}
              style={{ marginBottom: 8 }}
            >
              {mlccResetState.kind === "running"
                ? "Clearing cart…"
                : "Clear cart"}
            </button>
            {mlccResetState.kind === "running" ? (
              <p className="muted small" style={{ marginTop: 0, marginBottom: 8, textAlign: "center" }}>
                Your cart is already empty. We&apos;re finishing up on MILO&apos;s
                side — keep working, this will finish on its own.
              </p>
            ) : null}
            {mlccResetState.kind === "done" ? (
              <p className="muted small" style={{ marginTop: 0, marginBottom: 8, textAlign: "center", color: "#bbf7d0" }}>
                ✓ MLCC cart {mlccResetState.cleared ? `emptied (${mlccResetState.itemCount} item${mlccResetState.itemCount === 1 ? "" : "s"})` : "was already empty"}
              </p>
            ) : null}
            {mlccResetState.kind === "error" ? (
              <div style={{ marginTop: 0, marginBottom: 8, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.12)", color: "#fca5a5", fontSize: 13 }}>
                {mlccResetState.message}
                <button
                  type="button"
                  onClick={() => setMlccResetState({ kind: "idle" })}
                  style={{ marginLeft: 8, background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer" }}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="btn secondary btn-block"
              disabled={validateDisabled}
              onClick={() => void startValidate(items)}
            >
              {isCheckingValidation
                ? "Checking…"
                : state.kind === "validateDone"
                ? "Re-validate against MLCC"
                : "Validate against MLCC"}
            </button>
            <button
              type="button"
              className="btn primary btn-block"
              disabled={submitDisabled}
              onClick={() => setConfirmSubmit(true)}
              title={
                !mlccValidatePassed
                  ? "Validate against MLCC first"
                  : undefined
              }
            >
              {mlccValidatePassed ? "Submit Order" : "Submit Order (validate first)"}
            </button>
          </>
        ) : null}

        {/* ─── Submit terminal states ─────────────────────────────────────── */}
        {state.kind === "submitDone" && state.finalStatus === "succeeded" ? (
          <>
            <div className="banner banner-ok">
              Order submitted to MILO. Check the Orders page for confirmation numbers.
            </div>
            <button
              type="button"
              className="btn primary btn-block"
              onClick={() => {
                reset();
                clearCart();
                onClose();
              }}
            >
              Done
            </button>
          </>
        ) : null}

        {state.kind === "submitDone" && state.finalStatus !== "succeeded" ? (
          <>
            <div className="banner banner-warn">
              Submit finished as {state.finalStatus}.{" "}
              {state.progressMessage ??
                (state.failureType ? `Failure type: ${state.failureType}` : "No further details were provided.")}
            </div>
            <button type="button" className="btn secondary btn-block" onClick={handleRetry}>
              Back to cart
            </button>
            <button type="button" className="btn btn-block" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}

        {state.kind === "error" ? (
          <>
            <div className="banner banner-err">{state.message}</div>
            <button type="button" className="btn secondary btn-block" onClick={handleRetry}>
              Back to cart
            </button>
            <button type="button" className="btn btn-block" onClick={onClose}>
              Close
            </button>
          </>
        ) : null}
      </div>

      {/* ─── Save template modal (task #72) ─────────── */}
      {showSaveTemplate ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Save cart as template"
          onClick={() => !saveTemplateBusy && setShowSaveTemplate(false)}
        >
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="confirm-title">Save as template?</h2>
            <p className="confirm-body">
              Save these {items.length} items as a reusable template you can
              load back into your cart next time.
            </p>
            <input
              type="text"
              className="search-bar-input"
              placeholder="Template name (e.g. Thursday order)"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              maxLength={80}
              autoFocus
              style={{ width: "100%", marginBottom: 12 }}
            />
            {/*
              Schedule picker (task #75). Optional — null means "manual
              load only." When set, the daily cron marks this template
              "ready to review" every matching day, and a banner shows
              up on the scanner home.
            */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>
                Auto-prepare this template every:
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`browse-chip${saveTemplateDow === null ? " browse-chip--active" : ""}`}
                  onClick={() => setSaveTemplateDow(null)}
                >
                  Never (manual)
                </button>
                {[
                  { dow: 0, label: "Sun" },
                  { dow: 1, label: "Mon" },
                  { dow: 2, label: "Tue" },
                  { dow: 3, label: "Wed" },
                  { dow: 4, label: "Thu" },
                  { dow: 5, label: "Fri" },
                  { dow: 6, label: "Sat" },
                ].map((d) => (
                  <button
                    key={d.dow}
                    type="button"
                    className={`browse-chip${saveTemplateDow === d.dow ? " browse-chip--active" : ""}`}
                    onClick={() => setSaveTemplateDow(d.dow)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {saveTemplateDow !== null ? (
                <p className="muted small" style={{ marginTop: 6, marginBottom: 0 }}>
                  Each{" "}
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ][saveTemplateDow]}{" "}
                  morning, you&apos;ll see a &quot;ready to review&quot; banner
                  on the scanner home with this template loaded.
                </p>
              ) : null}
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowSaveTemplate(false)}
                disabled={saveTemplateBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void handleSaveTemplate()}
                disabled={saveTemplateBusy || !saveTemplateName.trim()}
              >
                {saveTemplateBusy ? "Saving…" : "Save template"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Load template picker (task #72) ─────────── */}
      {showTemplatePicker ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Pick template to load"
          onClick={() => setShowTemplatePicker(false)}
        >
          <div
            className="confirm-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, maxHeight: "70vh", overflow: "auto" }}
          >
            <h2 className="confirm-title">Load saved template</h2>
            <p className="confirm-body" style={{ marginBottom: 12 }}>
              Items from the template will be added to your current cart.
              {items.length > 0
                ? " Existing cart items stay; quantities of overlapping codes add together."
                : ""}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {templates.map((tpl) => (
                <li
                  key={tpl.id}
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <strong style={{ fontSize: 15 }}>{tpl.name}</strong>
                    <span className="muted small">
                      {tpl.items.length} item{tpl.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="muted small" style={{ marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {tpl.last_loaded_at ? (
                      <span>Last used {new Date(tpl.last_loaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    ) : null}
                    {tpl.schedule_dow !== null ? (
                      <span style={{ color: "#c4b5fd" }}>
                        📅 Auto every{" "}
                        {[
                          "Sun",
                          "Mon",
                          "Tue",
                          "Wed",
                          "Thu",
                          "Fri",
                          "Sat",
                        ][tpl.schedule_dow]}
                      </span>
                    ) : null}
                    {tpl.needs_review ? (
                      <span style={{ color: "#bbf7d0" }}>● Ready to review</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void handleLoadTemplate(tpl.id)}
                    disabled={templateLoading !== null}
                    style={{ width: "100%" }}
                  >
                    {templateLoading === tpl.id ? "Loading…" : "Load into cart"}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn secondary btn-block"
              style={{ marginTop: 12 }}
              onClick={() => setShowTemplatePicker(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* ─── MLCC reset confirm modal (task #57) ─────────── */}
      {mlccResetState.kind === "confirm" ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm MLCC cart reset"
          onClick={() => setMlccResetState({ kind: "idle" })}
        >
          <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="confirm-title">Clear cart?</h2>
            <p className="confirm-body">
              This empties both your scanner cart AND your MILO cart.
              Runs a real session against MILO and clicks Clear Cart
              there — takes about 30-60 seconds. Once it&apos;s done
              the cart is empty on both sides. Can&apos;t be undone.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setMlccResetState({ kind: "idle" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void confirmMlccReset()}
              >
                Clear cart
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Pre-submit verification modal (task #89, 2026-06-07) ─────────────
        *
        * Discipline #3 of the LK Integrity Doctrine in action — pre-commit
        * verification with the FULL cart in plain English. Tony locked this
        * pattern on 2026-06-07: no opt-out, ever. The yes/no popup that used
        * to live here was insufficient — it added a tap but didn't catch
        * integrity bugs. The line-by-line summary catches them because the
        * user sees the actual order in their own language and can stop if
        * anything looks wrong (wrong UPC mapping, phantom cart from a
        * background pre-validate, vision picker picking the wrong bottle).
        */}
      {confirmSubmit ? (
        <SubmitConfirmationModal
          items={items}
          subtotal={totalCost}
          /*
           * validateResult only exists on a subset of SubmissionState
           * variants (validateDone, plus the in-flight submit states
           * that carry it forward). Type-narrow conservatively — if
           * we don't have it, the modal falls back to subtotal-only.
           * In practice this is null only when Submit is somehow
           * clicked without a successful Validate, which the UI
           * already gates against.
           */
          orderSummary={
            "validateResult" in state ? state.validateResult?.order_summary ?? null : null
          }
          storeName={storeName ?? null}
          storeLicense={storeLicense ?? null}
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={() => {
            setConfirmSubmit(false);
            void startSubmit();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Renders the live MILO cart state after a successful validate_only run.
 * Shows: in-stock count, out-of-stock items (full list), totals, validate
 * messages from MILO. This is the user's "here's what MILO sees" view
 * before they commit to submitting.
 *
 * Iteration 2 (2026-05-30): Tony found that MILO's actual OOS-section
 * items weren't being surfaced — Stage 3 incorrectly verifies them as
 * "added", Stage 4 doesn't populate out_of_stock_items, and the user
 * just saw a yellow banner with no explanation. Fix:
 *
 *   (a) Surface ada_breakdown.errors — MILO's actual error messages
 *       per ADA ("You must order at least nine liters from this
 *       distributor"). The most informative field we have.
 *   (b) Compute "inferred OOS" by diffing the user's local cart against
 *       ada_breakdown items. Anything the user added but MILO's active
 *       orders don't show is almost certainly in MILO's OOS section.
 *   (c) Show per-ADA progress against the 9L minimum so user can see
 *       which distributor is under.
 *
 * (b) is a stopgap until the proper Stage 3/4 OOS detection ships — but
 * it works with the data we already have.
 */
function ValidateResultPanel({
  result,
  canCheckout,
  cartItems,
}: {
  result: import("../api/execution").ValidateResult | null;
  canCheckout: boolean | null;
  cartItems: CartContextValue["items"];
}) {
  if (!result) {
    return (
      <div className="banner banner-warn">
        MLCC validate finished but no result data was returned. Re-validate to retry.
      </div>
    );
  }
  const oos = Array.isArray(result.out_of_stock_items) ? result.out_of_stock_items : [];
  const rejected = Array.isArray(result.items_rejected) ? result.items_rejected : [];
  const messages = Array.isArray(result.validate_messages) ? result.validate_messages : [];
  const errors = Array.isArray(result.validate_errors) ? result.validate_errors : [];
  const summary = result.order_summary ?? null;
  const adaBreakdown = Array.isArray(result.ada_breakdown) ? result.ada_breakdown : [];

  // Collect every error string MILO reported per ADA. These are the
  // human-readable messages MILO itself shows (e.g. "You must order at
  // least nine liters from this distributor"). De-duped.
  const milccErrors = new Set<string>();
  for (const ada of adaBreakdown) {
    const adaErrors = Array.isArray((ada as { errors?: unknown[] }).errors)
      ? ((ada as { errors: unknown[] }).errors as unknown[])
      : [];
    for (const e of adaErrors) {
      const s = typeof e === "string" ? e.trim() : "";
      // Filter junk: pure numbers, single chars (MILO sometimes echoes
      // the liter count alongside the message).
      if (s.length > 3 && !/^\d+(\.\d+)?$/.test(s)) milccErrors.add(s);
    }
  }
  const milccErrorList = [...milccErrors];

  // Inferred OOS — uses the shared helper so the panel and the parent
  // CartDrawer see the same list (parent uses it to gate Submit; we
  // use it here to render the "Likely out of stock" block).
  //
  // 2026-06-04 #53: after server-side validate_demoted detection,
  // anything Stage 4 lost track of already shows up in the `oos` list
  // above. Filter those codes out here so the same item doesn't
  // render twice. The inferred block stays visible ONLY when the
  // server missed something — a parser-regression alarm bell rather
  // than the primary signal.
  const serverOosCodeSet = getServerOosCodes(result);
  const inferredOos = computeInferredOos(cartItems, result).filter(
    (line) => !serverOosCodeSet.has(line.product.code),
  );

  // Per-ADA liter progress (only shown when at least one ADA is under).
  const adaProgress = adaBreakdown
    .filter((ada) => (ada as { meetsMinimum?: boolean }).meetsMinimum === false)
    .map((ada) => {
      const a = ada as {
        adaName?: string;
        adaNumber?: string;
        subtotalLiters?: number;
        meetsMinimum?: boolean;
      };
      return {
        name: a.adaName ?? `ADA ${a.adaNumber ?? "?"}`,
        liters: typeof a.subtotalLiters === "number" ? a.subtotalLiters : 0,
        shortBy: Math.max(0, 9 - (typeof a.subtotalLiters === "number" ? a.subtotalLiters : 0)),
      };
    });

  return (
    <div className={`banner ${canCheckout ? "banner-ok" : "banner-warn"}`}>
      <strong>
        {canCheckout
          ? "MLCC says: cart is ready for checkout."
          : "MLCC validate completed — review issues below before submitting."}
      </strong>
      {/*
        Note: do NOT use .drawer-validation-errors here. That class is
        hard-styled with color: #fecaca (light red) because it was built
        for the cart's rule-engine error list. On the green success
        banner, red bullets look broken. We use the
        .banner-content-list class (defined in index.css alongside this
        component) which inherits the banner's text color so success
        messages render in the right tone.
      */}
      {messages.length > 0 ? (
        <ul className="banner-content-list" style={{ marginTop: 8 }}>
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      {errors.length > 0 ? (
        <ul className="banner-content-list" style={{ marginTop: 8 }}>
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {oos.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Out of stock at MLCC ({oos.length} item{oos.length === 1 ? "" : "s"}):
          </div>
          {/* OOS items DO use the red error class — they're real problems */}
          <ul className="drawer-validation-errors">
            {oos.map((item, i) => (
              <li key={i}>
                {item.productName ?? item.code ?? "Unknown item"}
                {item.quantity ? ` × ${item.quantity}` : ""}
                {/*
                  Reason-tagged messages from #53 (2026-06-04):
                    - "oos_section": MILO put it in its dedicated OOS
                      section after the add. The cleanest signal.
                    - "validate_demoted": MILO accepted the add but
                      silently dropped the item by the time we hit
                      Validate. Less clear-cut — may be stock, may be
                      a transient MILO state.
                  Anything else falls back to the raw reason string
                  for forward-compat.
                */}
                {item.reason === "oos_section"
                  ? " — marked out-of-stock by MILO"
                  : item.reason === "validate_demoted"
                    ? " — dropped during MILO validate (likely out of stock)"
                    : item.reason
                      ? ` — ${item.reason}`
                      : ""}
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 6 }}>
            Remove these from your cart and re-validate to clear.
          </p>
        </>
      ) : null}
      {/*
        Items REJECTED by MLCC during Stage 3 add-to-cart. Different from
        OOS: MILO actively refused to add these (validation rule violation,
        unknown code, MILO-side error, etc.). Without this list the user
        sees a yellow 'review issues below' banner but no explanation of
        what's wrong. Added 2026-05-30 to close that UX gap.
      */}
      {rejected.length > 0 ? (
        <>
          {/*
            Split the rejected list into "timed out" vs "hard rejected"
            (2026-06-01 fix for #61). Tony's Tito's 750ml flake was
            ALWAYS a Stage 3 timeout — MILO was slow rendering the
            quick-add row, we gave up after 8s, the line ended up in
            items_rejected with a misleading "did not appear" reason.
            Treating that as a hard rejection scares the user; treating
            it as a transient flake lets them re-validate and move on.
            The 8s wait was bumped to 18s in the worker too — this UI
            split is the user-facing complement.
          */}
          {(() => {
            const rejectedTyped = rejected as Array<{
              code?: string;
              productName?: string;
              quantity?: number;
              reason?: string;
            }>;
            const timedOut = rejectedTyped.filter((r) =>
              isStage3TimeoutRejection(r.reason),
            );
            const hard = rejectedTyped.filter(
              (r) => !isStage3TimeoutRejection(r.reason),
            );
            return (
              <>
                {timedOut.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>
                      MLCC didn&apos;t finish adding ({timedOut.length} item
                      {timedOut.length === 1 ? "" : "s"}):
                    </div>
                    <ul className="banner-content-list">
                      {timedOut.map((it, i) => (
                        <li key={`to-${i}`}>
                          {it.productName ?? it.code ?? "Unknown item"}
                          {it.quantity ? ` × ${it.quantity}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="muted small" style={{ marginTop: 6 }}>
                      MLCC was slow responding for these. Tap{" "}
                      <strong>Re-validate against MLCC</strong> — it usually
                      goes through the second time.
                    </p>
                  </>
                ) : null}
                {hard.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>
                      Rejected by MLCC ({hard.length} item
                      {hard.length === 1 ? "" : "s"}):
                    </div>
                    <ul className="drawer-validation-errors">
                      {hard.map((it, i) => (
                        <li key={`h-${i}`}>
                          {it.productName ?? it.code ?? "Unknown item"}
                          {it.quantity ? ` × ${it.quantity}` : ""}
                          {it.reason ? ` — ${it.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="muted small" style={{ marginTop: 6 }}>
                      Remove these from your cart and re-validate to clear.
                    </p>
                  </>
                ) : null}
              </>
            );
          })()}
        </>
      ) : null}
      {/*
        Inferred OOS: items the user added that MILO's active orders don't
        show. Almost always means MILO put them in its own OOS section
        even though Stage 3 thought it added them. Stopgap until Stage
        3/4 OOS detection ships properly — but works with what we have.
      */}
      {inferredOos.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Likely out of stock at MLCC ({inferredOos.length} item{inferredOos.length === 1 ? "" : "s"}):
          </div>
          <ul className="drawer-validation-errors">
            {inferredOos.map((line) => (
              <li key={cartLineId(line.product)}>
                {line.product.name}
                {line.quantity ? ` × ${line.quantity}` : ""}
                {line.product.bottle_size_label
                  ? ` (${line.product.bottle_size_label})`
                  : ""}
              </li>
            ))}
          </ul>
          <p className="muted small" style={{ marginTop: 6 }}>
            MLCC accepted the order but didn&apos;t show these on the cart —
            usually means they&apos;re in MLCC&apos;s out-of-stock section. Remove
            them and re-validate.
          </p>
        </>
      ) : null}
      {/*
        Per-ADA progress for under-minimum cases. Shows distributor by
        name, current liters, and how many more they need. This is what
        the user actually needs to act on — "NWS Michigan needs 6.00 L
        more" is concrete; "ADA breakdown is short" is not.
      */}
      {adaProgress.length > 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            Distributors below 9 L minimum:
          </div>
          <ul className="banner-content-list">
            {adaProgress.map((ada) => (
              <li key={ada.name}>
                <strong>{ada.name}</strong>: {ada.liters.toFixed(2)} L / 9.00 L
                {" — needs "}
                <strong>{ada.shortBy.toFixed(2)} L</strong> more
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {/*
        Generic MILO error strings from ada_breakdown.errors. Only render
        if we haven't already covered them with the more-structured blocks
        above. (The 9L minimum message is implicit in adaProgress, so we
        hide it when adaProgress is non-empty.)
      */}
      {milccErrorList.length > 0 && adaProgress.length === 0 ? (
        <>
          <div style={{ marginTop: 12, fontWeight: 600 }}>
            MLCC reported:
          </div>
          <ul className="banner-content-list">
            {milccErrorList.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      ) : null}
      {summary ? (
        <div style={{ marginTop: 12 }}>
          <div>
            <span className="muted">MLCC subtotal: </span>
            <strong>{money(Number(summary.grossTotal ?? 0))}</strong>
          </div>
          <div>
            <span className="muted">Net total: </span>
            <strong>{money(Number(summary.netTotal ?? 0))}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stage-by-stage progress panel rendered during a Validate or Submit RPA
 * run. Replaces the boring "Validating against MLCC…" banner with a
 * checkable stage list so the user can see what's in flight, what's
 * done, and what's coming.
 *
 * Each stage is one row with:
 *   - icon: ✓ (done) / ⏳ (active, pulsing) / ○ (pending)
 *   - label
 *
 * Headline at top of the panel shows the overall operation + the worker's
 * latest progress_message (if it added any color).
 *
 * Why this matters: when MLCC takes 60-90s to respond, an unchanging
 * banner feels frozen even when the system is working hard. Visible
 * progress = perceived speed. The actual time is unchanged.
 */
function RpaProgressPanel({
  headline,
  stages,
  currentStageIndex,
  preStage,
}: {
  headline: { title: string; sub?: string };
  stages: ReadonlyArray<{ id: string; label: string }>;
  currentStageIndex: number;
  /**
   * True when the run hasn't reached any RPA stage yet (we're still
   * syncing the cart to the server or waiting for the worker to claim).
   * In this state all stages render as pending and we show a sub-line
   * explaining the wait.
   */
  preStage: boolean;
}) {
  return (
    <div className="rpa-progress" role="status" aria-live="polite">
      <div className="rpa-progress__headline">
        <strong>{headline.title}</strong>
        {headline.sub ? (
          <div className="rpa-progress__sub muted small">{headline.sub}</div>
        ) : null}
      </div>
      <ol className="rpa-progress__list">
        {stages.map((stage, idx) => {
          const status: "done" | "active" | "pending" = preStage
            ? "pending"
            : currentStageIndex < 0
              ? "pending"
              : idx < currentStageIndex
                ? "done"
                : idx === currentStageIndex
                  ? "active"
                  : "pending";
          return (
            <li
              key={stage.id}
              className={`rpa-progress__step rpa-progress__step--${status}`}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="rpa-progress__icon" aria-hidden>
                {status === "done" ? "✓" : status === "active" ? "●" : "○"}
              </span>
              <span className="rpa-progress__label">{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
