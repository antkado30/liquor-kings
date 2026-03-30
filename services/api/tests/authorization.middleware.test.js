import { describe, it, expect, afterEach } from "vitest";
import supabase from "../src/config/supabase.js";
import { resolveAuthenticatedStore } from "../src/middleware/resolve-store.middleware.js";

const STORE_A = "11111111-1111-1111-1111-111111111111";
const STORE_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockStoreUsersMemberships(memberships) {
  supabase.from = (table) => {
    if (table === "store_users") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: memberships, error: null }),
          }),
        }),
      };
    }

    if (table === "lk_system_diagnostics") {
      return {
        insert: async () => ({ error: null }),
      };
    }

    throw new Error(`Unexpected table mock: ${table}`);
  };
}

const originalAuthGetUser = supabase.auth.getUser;
const originalFrom = supabase.from;

afterEach(() => {
  supabase.auth.getUser = originalAuthGetUser;
  supabase.from = originalFrom;
});

describe("resolveAuthenticatedStore middleware", () => {
  it("user A same-store access works", async () => {
    supabase.auth.getUser = async () => ({
      data: { user: { id: USER_A } },
      error: null,
    });
    mockStoreUsersMemberships([{ store_id: STORE_A }]);

    const req = {
      headers: { authorization: "Bearer user-token" },
      path: "/cart",
    };
    const res = createRes();
    let calledNext = false;
    const next = () => {
      calledNext = true;
    };

    await resolveAuthenticatedStore(req, res, next);

    expect(calledNext).toBe(true);
    expect(req.auth_mode).toBe("user");
    expect(req.auth_user_id).toBe(USER_A);
    expect(req.store_id).toBe(STORE_A);
  });

  it("user A cross-store access fails", async () => {
    supabase.auth.getUser = async () => ({
      data: { user: { id: USER_A } },
      error: null,
    });
    mockStoreUsersMemberships([{ store_id: STORE_A }]);

    const req = {
      headers: {
        authorization: "Bearer user-token",
        "x-store-id": STORE_B,
      },
      path: "/cart",
    };
    const res = createRes();
    let calledNext = false;
    const next = () => {
      calledNext = true;
    };

    await resolveAuthenticatedStore(req, res, next);

    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not a member of specified store" });
  });
});
