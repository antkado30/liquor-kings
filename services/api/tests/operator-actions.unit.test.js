import { describe, expect, it } from "vitest";

describe("operator action model", () => {
  it("documents allowed actions for operator workflow", () => {
    const allowed = [
      "acknowledge",
      "mark_for_manual_review",
      "retry_now",
      "cancel",
      "resolve_without_retry",
    ];
    expect(allowed).toContain("retry_now");
    expect(allowed).toContain("cancel");
  });
});
