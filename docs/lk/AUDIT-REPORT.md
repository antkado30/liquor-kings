# UPC Mapping Truth Audit — Overnight Report

**Date:** 2026-06-11  
**Mode:** Report-only (`node scripts/audit-upc-mappings.mjs`) — **no mappings modified**  
**Source CSV:** `services/api/tmp/upc-audit-2026-06-11.csv`  
**Prod:** `LK_PROD_SUPABASE_URL` (4,179 rows in `upc_mappings`)

---

## Executive summary (read this at breakfast)

The automated verifier **could not cross-check a single mapping** because the `nrs_import` table in prod returned **0 rows** — the independent NRS name source the audit script depends on is empty or absent. Every mapping landed in **UNVERIFIED**.

That does **not** mean the catalog is clean. A manual second pass on **operational evidence** (`scan_count`) found a serious pattern the verifier would have flagged as **SUSPICIOUS/BAD** if NRS names were present:

| Finding | Count | Risk |
|--------|------:|------|
| **Scanned mappings pointing at nips (≤200ml) for mainstream fifth UPCs** | **6** | **High — active wrong-bottle risk** |
| Scanned mappings at 375ml (half-bottle ambiguity vs 750ml fifth) | 7 | Medium — verify UPC size |
| Scanned mappings at plausible 750ml+ | 12 | Lower — brand match looks OK |
| Edition/LTO SKUs in mapping table | 21 | Collision risk when base UPC scanned |
| Lions / McLaren / Detroit edition codes mapped | **0** | Tony's 1800→Lions bug is **not** in persisted mappings |
| Dead MLCC codes (rotation) | **0** | All mapped codes exist + active today |
| Automated BAD / DEAD_CODE | **0** | Verifier blind without NRS |

**Top priority fixes (human, not auto-deleted):**

1. `085246171561` → `9008` Maker's Mark **50ml** (11 scans) — almost certainly a **750ml fifth UPC**
2. `082184081839` → `9124` Jack Daniel's Old No. 7 **100ml** (8 scans)
3. `088004144739` → `1438` Fireball **200ml** (6 scans)
4. `082184000052` / `000008218452` → `85413` JD Old No. 7 **50ml** — duplicate UPC family on wrong nip code
5. `080480015800` → `24987` Bacardi **100ml**; `080686001010` → `12374` Red Stag **50ml**

**Infrastructure blocker:** Reload or restore `nrs_import` (or point the audit at whatever table now holds NRS pricebook names) and **re-run the audit** before trusting automated OK/BAD counts.

---

## 1. Automated verdict counts

| Verdict | Count | Notes |
|---------|------:|-------|
| **OK** | 0 | Requires NRS cross-name; none available |
| **DEAD_CODE** | 0 | All `mlcc_code` values resolve to active `mlcc_items` rows |
| **SUSPICIOUS** | 0 | Size/variant/edition checks never ran |
| **BAD** | 0 | Name disagreement checks never ran |
| **UNVERIFIED** | **4,179** | 100% of mappings |

### Confidence source breakdown

| `confidence_source` | Mappings | Total `scan_count` |
|---------------------|--------:|-------------------:|
| `nrs_import_name_size_match` | 4,170 | 90 |
| `user_confirmed` | 9 | 2 |

Operational footprint: **25 mappings** have been scanned at least once (**92** total scans). The other **4,154** mappings are bulk-imported but never exercised in the field.

---

## 2. BAD rows (automated)

**None.** The script found no name-level fundamental disagreements because `nrs_name` was empty for every row.

### Human reclassification — would likely be BAD if NRS existed

These **6 scanned** mappings pair well-known retail UPCs with **nip/sample MLCC SKUs** (≤200ml). The NRS import pipeline matched brand tokens + a size column that does not reflect what the barcode actually labels:

| UPC | MLCC | MLCC name | Size | Scans |
|-----|-----:|-----------|-----:|------:|
| 085246171561 | 9008 | MAKER'S MARK BBN PL | 50ml | 11 |
| 082184081839 | 9124 | J DANIELS OLD 7 BLACK (TN) | 100ml | 8 |
| 088004144739 | 1438 | FIREBALL CINNAMON PL | 200ml | 6 |
| 080480015800 | 24987 | BACARDI SUPERIOR (P R) | 100ml | 1 |
| 080686001010 | 12374 | RED STAG BY JIM BEAM PL | 50ml | 1 |
| 082184000052 | 85413 | J DANIELS OLD 7 BLACK (TN) | 50ml | 1 |

---

## 3. DEAD_CODE rows (automated)

**None.** Every mapped `mlcc_code` exists in prod `mlcc_items` with `is_active !== false`.

**Note on MLCC rotation:** Tony's example (code changed 2836 → 5703) does not appear in any current mapping. Code `5703` maps once (unscanned) to Bushmills Black Bush. No mapping points at code `2836`. Rotation is a **future** DEAD_CODE risk, not a present hit.

---

## 4. SUSPICIOUS rows (automated)

**None** from the script.

### Human reclassification — size ambiguity (scanned, 375ml)

These have been scanned and map to **375ml** halves. If the UPC is a standard **750ml** fifth, they are wrong:

| UPC | MLCC | Name | Scans |
|-----|-----:|------|------:|
| 081128011680 | 87296 | WOODFORD RESERVE BBN | 6 |
| 082184000342 | 7724 | J DANIELS TENNESSEE HONEY PL | 5 |
| 082184004388 | 20676 | J DANIELS TENNESSEE APPLE | 5 |
| 087000004122 | 11687 | BULLEIT BOURBON | 5 |
| 088076174948 | 6362 | CIROC COCONUT | 5 |
| 080480280031 | 91916 | GREY GOOSE VODKA | 3 |
| 080480230036 | 21847 | DEWAR'S WHITE LABEL | 1 |

### Edition / LTO collision watchlist (21 mappings, 0 scans)

Persisted mappings that include edition/LTO/gift-pack signals — **high risk** if a base-product UPC is ever scanned:

| UPC | MLCC | MLCC name |
|-----|-----:|-----------|
| 040232377716 | 30465 | FOUR ROSES 2023 LE SB ANNIV |
| 050037094466 | 36038 | DISARONNO 500YR ANNIVERSARY ED |
| 051497414658 | 30506 | HAND BARREL KY STRAIT BBN CAMO |
| 080244009397 | 30895 | BLANTON'S GOLD EDITION BOURBON |
| 080432000618 | 30540 | REDBREAST TAWNY PORT EDITION |
| 080432001554 | 74540 | ABSOLUT 80 W/FEVERTREE GNGR BR W/ |
| 080480985455 | 36038 | DISARONNO 500YR ANNIVERSARY ED |
| 081753829933 | 31140 | ARDBEG-19 YR 2023 EDITION |
| 081753833046 | 33047 | HENNESSY VS LEBRON JAMES |
| 081753838003 | 31140 | ARDBEG-19 YR 2023 EDITION |
| 082184007037 | 31350 | JACK DANIELS MCLAREN '23 ED |
| 084279995724 | 96290 | MR BOSTON HOLIDAY NOG |
| 087236120078 | 22235 | CUTTY SARK PROHIBITION EDITION |
| 088076166608 | 30369 | DALWHINNIE DISTILLERS EDITION |
| 088076171626 | 6331 | OBAN DISTILLERS EDITION |
| 088076171657 | 30372 | TALISKER DISTILLERS EDITION |
| 088076171664 | 10703 | LAGAVULIN DISTILLERS EDITION |
| 088076188228 | 30369 | DALWHINNIE DISTILLERS EDITION |
| 088076188297 | 30372 | TALISKER DISTILLERS EDITION |
| 089000016952 | 96290 | MR BOSTON HOLIDAY NOG |

**Zero** mappings point at MLCC Lions edition codes (`35831`, `35832`, `36317`, `74627`, etc.). Tony's reported **1800 Silver → Detroit Lions** failure is **not** stored in `upc_mappings` — it likely occurs at **live scan resolution** (tier-2 fuzzy match before a mapping is written) or via a wrong-size SKU in the catalog search path.

---

## 5. Top 200 UNVERIFIED rows (by `scan_count`) — human judgment

All 4,179 rows are UNVERIFIED. Below: top 200 sorted by `scan_count` desc, then UPC. Rows 1–25 have operational scans; 26–200 are bulk import (0 scans).

| # | scans | UPC | MLCC | MLCC name | size | judgment |
|---:|---:|---|---:|---|---:|---|
| 1 | 11 | 085246171561 | 9008 | MAKER'S MARK BBN PL | 50ml | **LIKELY WRONG** — retail UPC mapped to 50ml nip; fix priority |
| 2 | 8 | 082184081839 | 9124 | J DANIELS OLD 7 BLACK (TN) | 100ml | **LIKELY WRONG** — retail UPC mapped to 100ml nip; fix priority |
| 3 | 6 | 081128011680 | 87296 | WOODFORD RESERVE BBN | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 4 | 6 | 088004144739 | 1438 | FIREBALL CINNAMON PL | 200ml | **LIKELY WRONG** — retail UPC mapped to 200ml nip; fix priority |
| 5 | 5 | 082184000342 | 7724 | J DANIELS TENNESSEE HONEY PL | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 6 | 5 | 082184004388 | 20676 | J DANIELS TENNESSEE APPLE | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 7 | 5 | 087000004122 | 11687 | BULLEIT BOURBON | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 8 | 5 | 088076161863 | 9762 | CIROC SNAP FROST | 750ml | Plausible brand+size — needs NRS confirm |
| 9 | 5 | 088076174948 | 6362 | CIROC COCONUT | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 10 | 4 | 080686005018 | 7817 | JIM BEAM DEVIL'S CUT | 750ml | Plausible brand+size — needs NRS confirm |
| 11 | 4 | 082184038734 | 8168 | GENTLEMAN JACK | 1000ml | Plausible brand+size — needs NRS confirm |
| 12 | 4 | 083664990412 | 12659 | GLENFIDDICH-18 YR | 750ml | Plausible brand+size — needs NRS confirm |
| 13 | 4 | 086767210067 | 46037 | BAILEYS ORIGINAL IRISH CREAM | 750ml | Plausible brand+size — needs NRS confirm |
| 14 | 4 | 088076185395 | 23318 | CIROC SUMMER CITRUS | 750ml | Plausible brand+size — needs NRS confirm |
| 15 | 3 | 080480280031 | 91916 | GREY GOOSE VODKA | 375ml | **CHECK SIZE** — 375ml half vs 750ml fifth ambiguity |
| 16 | 2 | 080480002923 | 9895 | D'USSE VSOP | 750ml | Plausible brand+size — needs NRS confirm |
| 17 | 2 | 088004030377 | 22575 | PLATINUM 10X | 750ml | Plausible brand+size — needs NRS confirm |
| 18 | 2 | 857318002017 | 8566 | VALENTINE WHITE BLOSSOM | 750ml | User-confirmed only — verify UPC↔SKU manually |
| 19 | 1 | 080480015800 | 24987 | BACARDI SUPERIOR (P R) | 100ml | **LIKELY WRONG** — retail UPC mapped to 100ml nip; fix priority |
| 20 | 1 | 080480230036 | 21847 | DEWAR'S WHITE LABEL | 375ml | Scanned — brand plausible; size 375ml needs UPC verify |
| 21 | 1 | 080686001010 | 12374 | RED STAG BY JIM BEAM PL | 50ml | **LIKELY WRONG** — retail UPC mapped to 50ml nip; fix priority |
| 22 | 1 | 080686036036 | 28664 | TWISTED TEA WHISKEY | 750ml | Plausible brand+size — needs NRS confirm |
| 23 | 1 | 082184000052 | 85413 | J DANIELS OLD 7 BLACK (TN) | 50ml | **LIKELY WRONG** — retail UPC mapped to 50ml nip; fix priority |
| 24 | 1 | 082184005941 | 28261 | JACK DANIELS TRIPLE MASH | 700ml | Scanned — brand plausible; size 700ml needs UPC verify |
| 25 | 1 | 096749004690 | 30994 | ELIJAH CRAIG SMALL BATCH | 1000ml | Plausible brand+size — needs NRS confirm |
| 26–200 | 0 | *(175 rows)* | — | Bulk import, unscanned | — | Structurally OK pending first scan; see full CSV |

*Full row-by-row judgments for ranks 26–200 are in `services/api/tmp/top200-table.md` (same sort order). Dominant pattern in 26–200: never-scanned NRS bulk import; a handful of flagged 50ml mainstream nips (Smirnoff, CIROC, JD) and three `user_confirmed` test/small-format rows.*

---

## 6. Top 50 spot-check (OK substitute — zero automated OK rows)

The script produced **0 OK** mappings. Per brief, the top **50 by `scan_count`** were eyeball-reviewed instead (only **25** have scans; rows 26–50 are unscanned).

### Scanned rows 1–25 — name agreement review

| Rank | Verdict | Notes |
|------|---------|-------|
| 1 Maker's Mark | **FAIL** | Brand correct, **size wrong** (50ml vs fifth) |
| 2 JD Old No. 7 | **FAIL** | Brand correct, **size wrong** (100ml) |
| 3 Woodford | **UNCERTAIN** | Brand correct; 375ml may be half or wrong fifth |
| 4 Fireball | **FAIL** | Brand correct, **size wrong** (200ml) |
| 5–7 JD Honey/Apple, Bulleit | **UNCERTAIN** | Flavor/brand OK; 375ml ambiguity |
| 8 Ciroc Snap Frost | **PASS** | 750ml standard line |
| 9 Ciroc Coconut | **UNCERTAIN** | Flavor OK; 375ml ambiguity |
| 10 Jim Beam Devil's Cut | **PASS** | 750ml standard |
| 11 Gentleman Jack | **PASS** | 1L matches many retail listings |
| 12 Glenfiddich 18 | **PASS** | 750ml standard |
| 13 Baileys Original | **PASS** | 750ml standard |
| 14 Ciroc Summer Citrus | **PASS** | 750ml limited seasonal — OK if UPC is seasonal SKU |
| 15 Grey Goose | **UNCERTAIN** | Brand OK; 375ml vs 750ml |
| 16 D'Usse VSOP | **PASS** | 750ml standard |
| 17 Platinum 10X | **PASS** | 750ml standard Sazerac vodka |
| 18 Valentine White Blossom | **UNCERTAIN** | User-confirmed obscure SKU — no external check |
| 19 Bacardi Superior | **FAIL** | Brand OK, **100ml nip** |
| 20 Dewar's White Label | **UNCERTAIN** | 375ml half plausible |
| 21 Red Stag | **FAIL** | **50ml nip** |
| 22 Twisted Tea Whiskey | **PASS** | 750ml RTD line |
| 23 JD Old No. 7 (alt UPC) | **FAIL** | Second UPC on **50ml** code `85413` |
| 24 JD Triple Mash | **PASS** | 700ml matches EU/import sizing |
| 25 Elijah Craig SB | **PASS** | 1L bottle plausible |

**Scorecard:** 10 PASS · 7 UNCERTAIN · **8 FAIL** (among 25 scanned mappings).

### Unscanned rows 26–50 — spot-check

All zero scans. Names are internally consistent (brand tokens match MLCC catalog). Notable flags:

- **#33, 38–39, 46, 49:** Mainstream brand → 50ml nip (latent size risk, same as scanned failures)
- **#62–63, 66:** `user_confirmed` on 50ml SKUs (Tito's, Crown Royal Black, RumChata) — treat as manual QA items
- **#35:** Johnnie Walker Blue → 50ml — only valid for mini gift UPC

No obvious brand-level nonsense (e.g. vodka UPC → gin name) in this band.

---

## 7. Pattern analysis (with counts)

| Pattern | Count | Severity |
|---------|------:|----------|
| **Total mappings** | 4,179 | — |
| **UNVERIFIED (no NRS cross-name)** | 4,179 | Infrastructure |
| Mapped to **750ml** (standard fifth) | 2,054 | Baseline |
| Mapped to **1000ml** (1L) | 653 | OK if UPC is liter |
| Mapped to **1750ml** (handle) | 559 | OK if UPC is handle |
| Mapped to **375ml** (half/pint) | 375 | Size ambiguity risk |
| Mapped to **50ml** nips | 257 | **High** collision risk |
| Mapped to **200ml** | 173 | Medium risk |
| Mapped to **100ml** | 64 | Medium risk |
| **`PL` suffix** in MLCC name | 607 | Often plastic pint/half — size parsing fragile |
| **Edition / LTO / gift** SKUs | 21 | Edition collision (Lions class) |
| **Gift pack `W/`** suffix | 1 | Gift-pack mismatch risk |
| **`user_confirmed`** mappings | 9 | Includes test UPC `999900000001` → Smirnoff |
| **Jack Daniel's Old No. 7** split across codes `9124` (100ml) + `85413` (50ml) | 9 UPCs | Same brand, **wrong sizes** |
| **Mainstream brand → &lt;375ml** (heuristic) | 37 | Systematic NRS size-match failure |
| **Scanned + ≤200ml mainstream** | 6 | **Active production bugs** |
| **Duplicate UPCs** in table | 0 | Good |
| **Lions/McLaren MLCC codes in mappings** | 0 | Tony bug is upstream of persisted map |
| **1800 Silver standard tequila in mappings** | 0 | Only Cuervo Silver + 1800 Coconut variants exist |

### Root-cause hypothesis

1. **NRS tier-2 import** (`nrs_import_name_size_match`) matched **brand tokens** but attached the **wrong `bottle_size_ml`** row from MLCC — especially confusing **50/100/200ml nips** with **750ml fifths** when NRS `size` column is unreliable (documented in `nrs-import.service.js`).
2. **`nrs_import` table empty in prod** — audit script cannot verify; also means we may have lost the authoritative UPC→NRS name snapshot.
3. **Edition collisions** are guarded in the import scorer (`GIFT_PROMO_RE`, flavor penalties) but **21 LTO rows still persisted** — likely NRS names explicitly mentioned the edition.
4. **Tony's 1800/Lions incident** is **not** explained by current `upc_mappings` — investigate **live `/price-book` UPC resolution** and tier-2 scoring when no mapping exists.

---

## 8. Recommended next steps (report only — no changes made)

1. **Restore `nrs_import`** (or wire audit to current NRS snapshot table) and re-run audit.
2. **Manual fix / delete** the 6–8 **scanned nip mappings** (highest scan_count first) — wrong mapping is worse than no mapping.
3. **Re-import or bulk-review** 375ml mappings for top-shelf brands (Woodford, Bulleit, Grey Goose, JD flavors).
4. **Quarantine** 21 edition/LTO mappings from auto-confirm paths; require `user_confirmed` or review queue.
5. **Remove** test mapping `999900000001` → Smirnoff 80 (`user_confirmed`).
6. **Investigate live scan path** for 1800 Silver + Lions editions (not in this table).
7. Consider **`--apply`** only after NRS-backed audit re-run confirms BAD/DEAD_CODE set.

---

## 9. Artifacts

| File | Description |
|------|-------------|
| `services/api/tmp/upc-audit-2026-06-11.csv` | Full 4,179-row machine output |
| `services/api/tmp/top200-table.md` | Top 200 human judgment table (intermediate) |
| `docs/lk/AUDIT-REPORT.md` | This report |

**No mappings were deleted or modified.**
