/**
 * SavedMatchesSection (2026-07-28) — Settings audit door for THE MOAT.
 *
 * Every phrase this store has taught the resolver (resolve-card swaps,
 * chat teaching) listed in plain language: "smirnoff → SMIRNOFF 80 PL ·
 * 750 ML · used 3×" — with a two-tap forget (tap the trash, then
 * confirm inline; tapping anywhere else disarms). Read + forget only;
 * teaching happens where the work happens, never here.
 *
 * Fail-soft everywhere: memory is an enhancement — this section erroring
 * must never break Settings.
 */
import { useCallback, useEffect, useState } from "react";
import {
  forgetSavedMatch,
  getSavedMatches,
  type SavedMatch,
} from "../api/store-memory";
import { IconAlert, IconLoader, IconSparkles, IconTrash } from "./Icons";

/** Stable per-row key: phrase + size (the memory key itself). */
function rowKey(m: SavedMatch): string {
  return `${m.phrase}::${m.size_ml ?? -1}`;
}

function sizeLabel(m: SavedMatch): string | null {
  if (m.bottle_size_label) return m.bottle_size_label;
  if (m.size_ml != null) return `${m.size_ml} ML`;
  return null;
}

export function SavedMatchesSection() {
  const [items, setItems] = useState<SavedMatch[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** rowKey currently showing the inline confirm; null = none armed. */
  const [armed, setArmed] = useState<string | null>(null);
  /** rowKey currently mid-forget (spinner on that row). */
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await getSavedMatches();
    if (r.ok) {
      setItems(r.items);
    } else {
      setItems([]);
      setLoadError(r.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = useCallback(
    async (m: SavedMatch) => {
      const key = rowKey(m);
      setBusyKey(key);
      const r = await forgetSavedMatch(m.phrase, m.size_ml);
      setBusyKey(null);
      setArmed(null);
      if (r.ok) {
        setItems((prev) => (prev ?? []).filter((x) => rowKey(x) !== key));
      } else {
        setLoadError(r.error ?? "Could not forget that match — try again.");
      }
    },
    [],
  );

  return (
    <section className="settings-block" aria-labelledby="settings-savedm-title">
      <div className="settings-block__head">
        <span className="settings-block__icon" aria-hidden>
          <IconSparkles size={18} strokeWidth={1.75} />
        </span>
        <h2 id="settings-savedm-title" className="settings-block__title">
          Saved matches
        </h2>
      </div>

      <div className="settings-card">
        <p className="settings-card__desc">
          What the AI has learned from you — when you swap a match on a
          resolve card or teach it in chat, the phrase sticks here and pins
          that bottle next time. Forget anything it got wrong.
        </p>

        {items === null ? (
          <div className="settings-state settings-state--loading" role="status">
            <span className="settings-spinner" aria-hidden>
              <IconLoader size={16} strokeWidth={2} />
            </span>
            <div>
              <div className="settings-state__label">Loading saved matches</div>
            </div>
          </div>
        ) : (
          <>
            {loadError ? (
              <div className="banner banner-err settings-inline-msg" role="alert">
                <IconAlert size={16} strokeWidth={2} aria-hidden />
                {loadError}
              </div>
            ) : null}

            {items.length === 0 && !loadError ? (
              <p className="settings-card__desc muted small">
                Nothing learned yet. Swap a match on an AI resolve card and it
                will show up here.
              </p>
            ) : null}

            {items.length > 0 ? (
              <ul className="savedm-list">
                {items.map((m) => {
                  const key = rowKey(m);
                  const isArmed = armed === key;
                  const isBusy = busyKey === key;
                  const size = sizeLabel(m);
                  return (
                    <li key={key} className="savedm-row">
                      <div className="savedm-row__main">
                        <div className="savedm-row__phrase">
                          &ldquo;{m.phrase}&rdquo;
                          {m.size_ml != null ? (
                            <span className="savedm-row__phrase-size muted">
                              {" "}
                              @ {m.size_ml} ml
                            </span>
                          ) : null}
                        </div>
                        <div className="savedm-row__target muted small">
                          → {m.product_name ?? `MLCC #${m.mlcc_code}`}
                          {size ? ` · ${size}` : ""}
                          {m.times_used > 0 ? ` · used ${m.times_used}×` : ""}
                        </div>
                      </div>
                      {isArmed ? (
                        <div className="savedm-row__confirm">
                          <button
                            type="button"
                            className="settings-btn settings-btn--danger savedm-btn"
                            onClick={() => void forget(m)}
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <IconLoader size={14} strokeWidth={2} aria-hidden />
                            ) : (
                              "Forget"
                            )}
                          </button>
                          <button
                            type="button"
                            className="settings-btn settings-btn--ghost savedm-btn"
                            onClick={() => setArmed(null)}
                            disabled={isBusy}
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="savedm-row__trash"
                          aria-label={`Forget the saved match for ${m.phrase}`}
                          onClick={() => setArmed(key)}
                        >
                          <IconTrash size={16} strokeWidth={1.9} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
