import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  uploadRunArtifacts,
  ensureRunArtifactsBucket,
  formatUploadSummary,
  RUN_ARTIFACTS_BUCKET,
  __resetBucketMemoForTests,
} from "../src/lib/run-artifacts-storage.js";

/**
 * P0-2 (Order Day 2026-07-16 postmortem F5): artifacts must upload
 * off-machine at teardown, bounded and never-throwing, with the HAR
 * first in line so a budget expiry keeps the crown jewels.
 */

function makeSupabaseMock({ uploadError = null, createBucketError = null } = {}) {
  const calls = { createBucket: [], upload: [] };
  const supabase = {
    storage: {
      createBucket: async (name, opts) => {
        calls.createBucket.push({ name, opts });
        return { error: createBucketError };
      },
      from: (bucket) => ({
        upload: async (key, body, opts) => {
          calls.upload.push({ bucket, key, bytes: body.length, opts });
          return { error: uploadError };
        },
      }),
    },
  };
  return { supabase, calls };
}

async function makeRunDir() {
  const root = await mkdtemp(path.join(tmpdir(), "lk-artifacts-"));
  await writeFile(path.join(root, "actions.jsonl"), '{"step":"login"}\n');
  await writeFile(path.join(root, "01-products.png"), Buffer.alloc(64, 1));
  await mkdir(path.join(root, "stage5"), { recursive: true });
  await writeFile(path.join(root, "stage5", "03-final.png"), Buffer.alloc(32, 2));
  await writeFile(path.join(root, "network.har"), '{"log":{"entries":[]}}');
  return root;
}

beforeEach(() => {
  __resetBucketMemoForTests();
});

describe("uploadRunArtifacts", () => {
  it("uploads every file keyed <runId>/<relpath>, HAR first", async () => {
    const { supabase, calls } = makeSupabaseMock();
    const outputDir = await makeRunDir();
    const summary = await uploadRunArtifacts({
      supabase,
      runId: "run-123",
      outputDir,
    });

    expect(summary.uploaded).toBe(4);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBeNull();
    expect(summary.budgetExhausted).toBe(false);

    const keys = calls.upload.map((c) => c.key);
    // Priority: HAR absolutely first, actions.jsonl second.
    expect(keys[0]).toBe("run-123/network.har");
    expect(keys[1]).toBe("run-123/actions.jsonl");
    // Nested path is preserved with forward slashes.
    expect(keys).toContain("run-123/stage5/03-final.png");
    // All to the right bucket, all upsert (idempotent re-runs).
    expect(calls.upload.every((c) => c.bucket === RUN_ARTIFACTS_BUCKET)).toBe(true);
    expect(calls.upload.every((c) => c.opts.upsert === true)).toBe(true);
  });

  it("NEVER throws: upload errors are counted, firstError kept", async () => {
    const { supabase } = makeSupabaseMock({ uploadError: { message: "quota exceeded" } });
    const outputDir = await makeRunDir();
    const summary = await uploadRunArtifacts({ supabase, runId: "run-err", outputDir });
    expect(summary.uploaded).toBe(0);
    expect(summary.failed).toBe(4);
    expect(summary.firstError).toBe("quota exceeded");
  });

  it("skips oversized files without failing the rest", async () => {
    const { supabase, calls } = makeSupabaseMock();
    const outputDir = await makeRunDir();
    const summary = await uploadRunArtifacts({
      supabase,
      runId: "run-cap",
      outputDir,
      perFileMaxBytes: 40, // the two PNGs (64 + 32 bytes) — only the 64B one exceeds
    });
    expect(summary.skippedTooLarge).toBe(1);
    expect(summary.uploaded).toBe(3);
    expect(calls.upload.map((c) => c.key)).not.toContain("run-cap/01-products.png");
  });

  it("budget expiry stops the walk but keeps what it got — priority files went first", async () => {
    const { supabase, calls } = makeSupabaseMock();
    const outputDir = await makeRunDir();
    // Negative budget: expires after the FIRST iteration check passes once.
    const summary = await uploadRunArtifacts({
      supabase,
      runId: "run-budget",
      outputDir,
      budgetMs: -1,
    });
    expect(summary.budgetExhausted).toBe(true);
    expect(calls.upload.length).toBe(0);
    expect(summary.uploaded).toBe(0);
  });

  it("guards: missing client / runId / dir come back as skipped, not thrown", async () => {
    const { supabase } = makeSupabaseMock();
    expect((await uploadRunArtifacts({ runId: "x", outputDir: "/tmp" })).skipped).toBe(
      "no_supabase_client",
    );
    expect((await uploadRunArtifacts({ supabase, outputDir: "/tmp" })).skipped).toBe("no_run_id");
    expect((await uploadRunArtifacts({ supabase, runId: "x" })).skipped).toBe("no_output_dir");
    expect(
      (await uploadRunArtifacts({ supabase, runId: "x", outputDir: "/nope/never/exists" })).skipped,
    ).toBe("output_dir_missing");
  });
});

describe("ensureRunArtifactsBucket", () => {
  it("treats already-exists as success and memoizes per process", async () => {
    const { supabase, calls } = makeSupabaseMock({
      createBucketError: { message: "Bucket already exists" },
    });
    expect(await ensureRunArtifactsBucket(supabase)).toBe(true);
    expect(await ensureRunArtifactsBucket(supabase)).toBe(true);
    expect(calls.createBucket.length).toBe(1); // memoized after first success
    expect(calls.createBucket[0].opts.public).toBe(false); // PRIVATE bucket
  });
});

describe("formatUploadSummary", () => {
  it("one stable grep-able line", () => {
    const line = formatUploadSummary("run-9", {
      attempted: 5,
      uploaded: 4,
      failed: 1,
      skippedTooLarge: 0,
      bytesUploaded: 1024,
      budgetExhausted: false,
      skipped: null,
      firstError: "boom",
    });
    expect(line).toContain("[artifacts] run run-9");
    expect(line).toContain("uploaded 4/5");
    expect(line).toContain("failed 1 (boom)");
  });
});
