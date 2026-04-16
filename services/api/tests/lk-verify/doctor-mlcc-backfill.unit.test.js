/**
 * DB-free unit tests for scripts/lk-verify/doctor-mlcc-backfill.mjs
 * (parsing, gates, and orchestration with stubbed psql).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { describe, it, expect } from "vitest";

import {
  runDoctorMlccBackfill,
  parseBucketSummaryLines,
  parseUpdateCount,
  extractBetweenMarkers,
  normalizeApplySql,
  isApplyConfirmationValid,
} from "../../../../scripts/lk-verify/doctor-mlcc-backfill.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** liquor-kings repo root (tests/lk-verify → tests → api → services → root) */
const repoRoot = path.resolve(__dirname, "../../../..");

const miniSqlFixture = `
-- PREVIEW_START
SELECT preview_only;
-- OPTIONAL PREVIEW DETAIL
SELECT detail_should_not_run_in_summary_path;
-- PREVIEW_END
-- APPLY_START
UPDATE fixture_should_never_run_in_dry_run;
-- APPLY_END
`;

function baseDeps(overrides = {}) {
  return {
    env: { PGHOST: "test-local" },
    repoRoot: "/virtual",
    existsSync: () => true,
    readFileSync: () => miniSqlFixture,
    quiet: true,
    ...overrides,
  };
}

describe("doctor-mlcc-backfill (unit)", () => {
  describe("parseBucketSummaryLines", () => {
    it("extracts can_backfill, ambiguous, and no_match from fake psql -At output", () => {
      const stdout = [
        "can_backfill|12",
        "ambiguous|3",
        "no_match|40",
        "(3 rows)",
      ].join("\n");
      expect(parseBucketSummaryLines(stdout)).toEqual({
        can_backfill: 12,
        ambiguous: 3,
        no_match: 40,
      });
    });
  });

  describe("parseUpdateCount", () => {
    it("reads UPDATE n from combined psql output", () => {
      expect(parseUpdateCount("NOTICE: foo\nUPDATE 7\n")).toBe(7);
      expect(parseUpdateCount("no update here")).toBeNull();
    });
  });

  describe("isApplyConfirmationValid", () => {
    it("accepts only the exact staging token", () => {
      expect(isApplyConfirmationValid("MLCC_BACKFILL_STAGING")).toBe(true);
      expect(isApplyConfirmationValid("mlcc_backfill_staging")).toBe(false);
      expect(isApplyConfirmationValid("MLCC_BACKFILL_STAGING ")).toBe(false);
    });
  });

  describe("dry-run default (preview-only)", () => {
    it("runs preview summary only when APPLY_BACKFILL is unset; no apply SQL executed", async () => {
      const calls = [];
      const runPsql = (sql, opts) => {
        calls.push({ sql, opts: { ...opts } });
        expect(opts?.tuplesPipe).toBe(true);
        expect(opts?.singleTransaction).toBeFalsy();
        return {
          ok: true,
          status: 0,
          stdout: "can_backfill|1\nambiguous|0\nno_match|0\n",
          stderr: "",
        };
      };

      const r = await runDoctorMlccBackfill({
        ...baseDeps({ env: { PGHOST: "x" } }),
        runPsql,
      });

      expect(r.exitCode).toBe(0);
      expect(r.mode).toBe("dry-run");
      expect(r.preview).toEqual({
        can_backfill: 1,
        ambiguous: 0,
        no_match: 0,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain("preview_only");
      expect(calls[0].sql).not.toContain("detail_should_not_run_in_summary_path");
      expect(calls[0].sql).not.toMatch(/UPDATE/i);
    });
  });

  describe("apply gate (APPLY_BACKFILL must be exactly 1)", () => {
    it("treats APPLY_BACKFILL values other than '1' as dry-run (no apply path)", async () => {
      for (const val of [undefined, "", "0", "true", "yes"]) {
        const calls = [];
        const runPsql = (sql, opts) => {
          calls.push({ sql, opts });
          return {
            ok: true,
            status: 0,
            stdout: "can_backfill|0\nambiguous|0\nno_match|0\n",
            stderr: "",
          };
        };
        const env = { PGHOST: "x" };
        if (val !== undefined) env.APPLY_BACKFILL = val;

        const r = await runDoctorMlccBackfill({
          ...baseDeps({ env, promptApply: async () => "MLCC_BACKFILL_STAGING" }),
          runPsql,
        });

        expect(r.mode).toBe("dry-run");
        expect(calls).toHaveLength(1);
        expect(calls[0].opts.singleTransaction).toBeFalsy();
      }
    });
  });

  describe("confirmation gate", () => {
    it("aborts apply when confirmation is not exactly MLCC_BACKFILL_STAGING (no apply psql)", async () => {
      const calls = [];
      const runPsql = (sql, opts) => {
        calls.push({ sql, opts });
        return {
          ok: true,
          status: 0,
          stdout: "can_backfill|2\nambiguous|0\nno_match|1\n",
          stderr: "",
        };
      };

      const r = await runDoctorMlccBackfill({
        ...baseDeps({
          env: { PGHOST: "x", APPLY_BACKFILL: "1" },
          promptApply: async () => "WRONG_TOKEN",
        }),
        runPsql,
      });

      expect(r.exitCode).toBe(2);
      expect(r.mode).toBe("apply-aborted");
      expect(calls).toHaveLength(1);
      expect(calls[0].opts.tuplesPipe).toBe(true);
    });
  });

  describe("happy apply flow", () => {
    it("preview → confirm → apply in transaction → post-apply preview", async () => {
      let step = 0;
      const calls = [];
      const runPsql = (sql, opts) => {
        calls.push({ sql, opts: { ...opts } });
        if (opts?.tuplesPipe) {
          step += 1;
          if (step === 1) {
            return {
              ok: true,
              status: 0,
              stdout: "can_backfill|10\nambiguous|2\nno_match|1\n",
              stderr: "",
            };
          }
          if (step === 2) {
            return {
              ok: true,
              status: 0,
              stdout: "can_backfill|0\nambiguous|2\nno_match|1\n",
              stderr: "",
            };
          }
        }
        if (opts?.singleTransaction) {
          return {
            ok: true,
            status: 0,
            stdout: "",
            stderr: "UPDATE 10\n",
          };
        }
        return { ok: false, status: 1, stdout: "", stderr: "unexpected" };
      };

      const r = await runDoctorMlccBackfill({
        ...baseDeps({
          env: { PGHOST: "x", APPLY_BACKFILL: "1" },
          promptApply: async () => "MLCC_BACKFILL_STAGING",
        }),
        runPsql,
      });

      expect(r.exitCode).toBe(0);
      expect(r.mode).toBe("apply-done");
      expect(r.updatedRows).toBe(10);
      expect(r.preview).toEqual({
        can_backfill: 10,
        ambiguous: 2,
        no_match: 1,
      });
      expect(r.postPreview).toEqual({
        can_backfill: 0,
        ambiguous: 2,
        no_match: 1,
      });

      expect(calls).toHaveLength(3);
      expect(calls[0].opts).toEqual({ tuplesPipe: true });
      expect(calls[1].opts).toEqual({ singleTransaction: true });
      expect(calls[2].opts).toEqual({ tuplesPipe: true });
      expect(calls[0].sql).toContain("preview_only");
      expect(calls[1].sql).toMatch(/UPDATE\s+fixture_should_never_run_in_dry_run/i);
    });
  });

  describe("safety semantics (writes only from APPLY section)", () => {
    it("dry-run never invokes psql with singleTransaction (no write batch)", async () => {
      const calls = [];
      const runPsql = (sql, opts) => {
        calls.push({ sql, opts });
        return {
          ok: true,
          status: 0,
          stdout: "can_backfill|0\nambiguous|0\nno_match|0\n",
          stderr: "",
        };
      };
      await runDoctorMlccBackfill({
        ...baseDeps({ env: { PGHOST: "x" } }),
        runPsql,
      });
      expect(calls.every((c) => !c.opts?.singleTransaction)).toBe(true);
    });

    it("executable apply SQL is only the APPLY marker block (real repo file contains UPDATE bottles)", () => {
      const sqlPath = path.join(
        repoRoot,
        "sql",
        "mlcc_backfill_preview_and_apply.sql",
      );
      const full = fs.readFileSync(sqlPath, "utf8");
      const applyBlock = extractBetweenMarkers(
        full,
        "-- APPLY_START",
        "-- APPLY_END",
      );
      const applySql = normalizeApplySql(applyBlock);
      expect(applySql).toMatch(/UPDATE\s+public\.bottles/i);
      expect(applySql).toMatch(/SET\s+mlcc_item_id/i);
      expect(applySql).not.toMatch(/PREVIEW_START/i);
    });
  });
});
