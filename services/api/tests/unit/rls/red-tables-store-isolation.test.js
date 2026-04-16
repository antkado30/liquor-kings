import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveMigrationPath() {
  const filename = "20260410180000_enable_rls_stores_store_users_bottles.sql";
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "supabase", "migrations", filename);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `Could not find supabase/migrations/${filename} walking up from ${__dirname}`,
  );
}

const migrationPath = resolveMigrationPath();

describe("RLS migration: stores, store_users, bottles (RED → store isolation)", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("migration file exists and is SQL", () => {
    expect(sql.length).toBeGreaterThan(500);
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("enables RLS only on store_users, stores, and bottles (not mlcc_items)", () => {
    expect(sql).toContain("ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE public.bottles ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/ALTER TABLE public\.mlcc_items ENABLE ROW LEVEL SECURITY/i);
  });

  it("defines store-membership policies for each table (SELECT + mutating where applicable)", () => {
    expect(sql).toContain("CREATE POLICY stores_select_by_store_membership");
    expect(sql).toContain("CREATE POLICY stores_update_by_store_membership");
    expect(sql).toContain("CREATE POLICY stores_delete_by_store_membership");

    expect(sql).toContain("CREATE POLICY store_users_select_by_store_membership");
    expect(sql).toContain("CREATE POLICY store_users_insert_by_store_membership");
    expect(sql).toContain("CREATE POLICY store_users_update_by_store_membership");
    expect(sql).toContain("CREATE POLICY store_users_delete_by_store_membership");

    expect(sql).toContain("CREATE POLICY bottles_select_by_store_membership");
    expect(sql).toContain("CREATE POLICY bottles_insert_by_store_membership");
    expect(sql).toContain("CREATE POLICY bottles_update_by_store_membership");
    expect(sql).toContain("CREATE POLICY bottles_delete_by_store_membership");
  });

  it("uses the same auth.uid + store_users membership pattern as existing cart/inventory RLS", () => {
    expect(sql).toMatch(/su\.user_id\s*=\s*auth\.uid\s*\(\s*\)/);
    expect(sql).toMatch(/su\.is_active\s*=\s*TRUE/);
    expect(sql).toContain("FROM public.store_users su");
  });

  it("does not DROP unrelated policies (only *_by_store_membership on these tables)", () => {
    const drops = sql.match(/DROP POLICY IF EXISTS/g) ?? [];
    expect(drops.length).toBeGreaterThanOrEqual(11);
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS carts_/);
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS cart_items_/);
  });
});

/**
 * Live cross-store isolation (Store A JWT cannot read Store B rows) requires
 * two authenticated Supabase users and a real project URL. Run manually after
 * applying the migration, e.g.:
 *
 *   supabase db push   # or apply migration on staging
 *   # As user A (JWT): .from('bottles').select().eq('store_id', STORE_B_ID) → expect []
 *   # As user A: .from('bottles').select().eq('store_id', STORE_A_ID) → expect rows
 *
 * Or re-run sql/rls_audit_query.sql and confirm stores / store_users / bottles
 * show rls_enabled=true, policy_count>=1, risk_band=GREEN.
 */
