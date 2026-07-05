/**
 * Web Push client orchestration (2026-07-05) — the device side of the
 * "order needs you" layer.
 *
 * iOS reality (the platform we live on): Web Push works ONLY when the app is
 * installed to the Home Screen (standalone) on iOS 16.4+, and the permission
 * prompt must come from a user gesture. getPushSupport() tells the UI which
 * world it's in so the copy can guide honestly instead of failing weirdly.
 *
 * The service worker (public/push-sw.js) is PUSH-ONLY — no fetch handler, no
 * caching — so registering it can never affect how the app loads.
 */
import {
  getPushConfig,
  removePushSubscription,
  savePushSubscription,
} from "../api/push";

export type PushSupport = "ok" | "needs_install" | "unsupported";

const SW_URL = `${import.meta.env.BASE_URL}push-sw.js`;

export function getPushSupport(): PushSupport {
  const supported =
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window;
  if (supported) return "ok";
  const isIos = /iphone|ipad|ipod/i.test(navigator?.userAgent ?? "");
  const standalone =
    (typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)")?.matches) ||
    (navigator as { standalone?: boolean }).standalone === true;
  // iOS Safari hides PushManager until the site runs installed. Installing
  // unlocks it — that's guidance, not a dead end.
  return isIos && !standalone ? "needs_install" : "unsupported";
}

export type PushState = {
  support: PushSupport;
  serverEnabled: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
};

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(SW_URL)) ?? null;
  } catch {
    return null;
  }
}

export async function getPushState(): Promise<PushState> {
  const support = getPushSupport();
  const cfg = await getPushConfig();
  const serverEnabled = cfg.ok && cfg.enabled;
  if (support !== "ok") {
    return { support, serverEnabled, permission: "unsupported", subscribed: false };
  }
  const reg = await getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return {
    support,
    serverEnabled,
    permission: Notification.permission,
    subscribed: Boolean(sub),
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

type Result = { ok: true } | { ok: false; error: string };

/** Must be called from a user gesture (button tap) — iOS requires it. */
export async function enablePush(): Promise<Result> {
  try {
    const support = getPushSupport();
    if (support === "needs_install") {
      return {
        ok: false,
        error:
          "Add Liquor Kings to your Home Screen first, then turn notifications on from inside the app.",
      };
    }
    if (support !== "ok") {
      return { ok: false, error: "This browser doesn't support notifications." };
    }

    const cfg = await getPushConfig();
    if (!cfg.ok) return cfg;
    if (!cfg.enabled || !cfg.publicKey) {
      return { ok: false, error: "Notifications aren't switched on for the server yet." };
    }

    const reg = await navigator.serviceWorker.register(SW_URL);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        error:
          "Notifications are blocked for Liquor Kings. Allow them in Settings, then try again.",
      };
    }

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) as BufferSource,
      }));

    const saved = await savePushSubscription(sub.toJSON());
    if (!saved.ok) {
      // Don't leave a half-enabled device: local subscription without the
      // server knowing about it would look "on" while never receiving.
      await sub.unsubscribe().catch(() => undefined);
      return saved;
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't turn notifications on.",
    };
  }
}

export async function disablePush(): Promise<Result> {
  try {
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint ?? null;
    if (sub) {
      await sub.unsubscribe().catch(() => undefined);
    }
    if (endpoint) {
      // Best-effort server cleanup; the server also self-prunes dead
      // endpoints (410 Gone) on its next send, so a miss here self-heals.
      await removePushSubscription(endpoint);
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Couldn't turn notifications off.",
    };
  }
}
