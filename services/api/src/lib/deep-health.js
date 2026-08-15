/**
 * DEEP HEALTH (2026-08-13, launch-readiness sweep — Tony: "everything
 * has to work 100% of the time… take all the necessary precautions").
 *
 * /health answers "is the API process up?" — good for deploy probes,
 * useless for "is the SYSTEM healthy?". /health/deep answers the real
 * question with three checks and an HTTP status an uptime monitor can
 * alert on (200 all-good / 503 anything wrong → email):
 *
 *   db      — one cheap catalog head-count. Proves Supabase reachable
 *             AND the catalog is non-empty (an empty mlcc_items would
 *             make every screen quietly useless — that IS an outage).
 *   worker  — ops_heartbeats.worker_claim freshness. The worker's
 *             claim-next poll upserts it at most once/minute; stale
 *             > WORKER_STALE_MIN means Wednesday orders won't run.
 *   git_sha — rides along so the monitor's logs double as a deploy
 *             history.
 *
 * Fail-soft posture is DELIBERATELY INVERTED here: this endpoint's job
 * is to be loud. Any check failing → ok:false → 503.
 */

export const WORKER_STALE_MIN = 5;

/** Pure staleness verdict — pinned in tests. */
export function workerVerdict(lastAtIso, nowMs, staleMin = WORKER_STALE_MIN) {
  if (!lastAtIso) {
    return { ok: false, reason: "no heartbeat row yet", last_seen_at: null };
  }
  const t = Date.parse(lastAtIso);
  if (Number.isNaN(t)) {
    return { ok: false, reason: "unparseable heartbeat", last_seen_at: lastAtIso };
  }
  const ageMin = (nowMs - t) / 60_000;
  return {
    ok: ageMin <= staleMin,
    last_seen_at: lastAtIso,
    age_min: Math.round(ageMin * 10) / 10,
    ...(ageMin > staleMin ? { reason: `stale > ${staleMin} min` } : {}),
  };
}

export async function runDeepHealth(supabase, { nowMs = Date.now() } = {}) {
  const checks = {};

  // DB + catalog in one round trip.
  const t0 = Date.now();
  try {
    const { count, error } = await supabase
      .from("mlcc_items")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);
    if (error) {
      checks.db = { ok: false, error: error.message };
    } else {
      checks.db = {
        ok: (count ?? 0) > 0,
        active_items: count ?? 0,
        ms: Date.now() - t0,
        ...((count ?? 0) > 0 ? {} : { error: "catalog empty" }),
      };
    }
  } catch (e) {
    checks.db = { ok: false, error: e?.message ?? String(e) };
  }

  // Worker heartbeat.
  try {
    const { data, error } = await supabase
      .from("ops_heartbeats")
      .select("at")
      .eq("key", "worker_claim")
      .maybeSingle();
    if (error) {
      // Table missing (migration not applied) reads as NOT OK on purpose:
      // silent blindness is the failure mode this endpoint exists to kill.
      checks.worker = { ok: false, error: error.message };
    } else {
      checks.worker = workerVerdict(data?.at ?? null, nowMs);
    }
  } catch (e) {
    checks.worker = { ok: false, error: e?.message ?? String(e) };
  }

  const ok = Object.values(checks).every((c) => c.ok === true);
  return { ok, checks };
}

/*
 * Claim-next side: record the worker's pulse, throttled so the hot
 * claim path pays one tiny upsert per minute per API machine at most.
 * FAIL-SOFT (unlike the read side): a heartbeat write must never break
 * claiming real work.
 */
let lastBeatMs = 0;
const BEAT_MIN_INTERVAL_MS = 60_000;

export function __resetHeartbeatThrottle() {
  lastBeatMs = 0;
}

export async function recordWorkerClaimHeartbeat(supabase, workerId) {
  if (Date.now() - lastBeatMs < BEAT_MIN_INTERVAL_MS) return;
  lastBeatMs = Date.now();
  try {
    await supabase.from("ops_heartbeats").upsert(
      {
        key: "worker_claim",
        at: new Date().toISOString(),
        note: workerId ? String(workerId).slice(0, 80) : null,
      },
      { onConflict: "key" },
    );
  } catch {
    /* never block a claim on ops bookkeeping */
  }
}
