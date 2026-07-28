/**
 * Saved-matches Settings section (2026-07-28, THE MOAT audit door).
 * Pins: rows render in the store's own language, forgetting is two-tap
 * (arm → confirm) and removes only that row, empty + error states are
 * calm, and "Keep" disarms without deleting anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SavedMatchesSection } from "./SavedMatchesSection";

const mockGet = vi.fn();
const mockForget = vi.fn();
vi.mock("../api/store-memory", () => ({
  getSavedMatches: (...a: unknown[]) => mockGet(...a),
  forgetSavedMatch: (...a: unknown[]) => mockForget(...a),
}));

const match = (over = {}) => ({
  phrase: "smirnoff",
  size_ml: 750,
  mlcc_code: "10022",
  product_name: "SMIRNOFF 80 PL",
  bottle_size_label: "750 ML",
  source: "card_swap",
  times_used: 3,
  updated_at: "2026-07-27T12:00:00Z",
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockForget.mockReset();
});

describe("SavedMatchesSection", () => {
  it("renders learned rows in the store's own language", async () => {
    mockGet.mockResolvedValue({
      ok: true,
      items: [match(), match({ phrase: "jack pint", size_ml: 375, product_name: "J DANIELS OLD 7 BLACK", bottle_size_label: "375 ML", mlcc_code: "22222", times_used: 0 })],
    });
    render(<SavedMatchesSection />);
    expect(await screen.findByText(/“smirnoff”/)).toBeTruthy();
    expect(screen.getByText(/SMIRNOFF 80 PL · 750 ML · used 3×/)).toBeTruthy();
    // A never-used row shows no counter noise.
    expect(screen.getByText(/J DANIELS OLD 7 BLACK · 375 ML$/)).toBeTruthy();
  });

  it("a delisted bottle renders by code, never a blank row", async () => {
    mockGet.mockResolvedValue({ ok: true, items: [match({ product_name: null, bottle_size_label: null })] });
    render(<SavedMatchesSection />);
    expect(await screen.findByText(/MLCC #10022/)).toBeTruthy();
  });

  it("forget is two-tap: trash arms, Forget deletes exactly that row", async () => {
    mockGet.mockResolvedValue({ ok: true, items: [match(), match({ phrase: "titos", mlcc_code: "33333", product_name: "TITOS HANDMADE VODKA" })] });
    mockForget.mockResolvedValue({ ok: true, deleted: true });
    render(<SavedMatchesSection />);
    await screen.findByText(/“smirnoff”/);

    fireEvent.click(screen.getByLabelText("Forget the saved match for smirnoff"));
    fireEvent.click(screen.getByText("Forget"));

    await waitFor(() => {
      expect(mockForget).toHaveBeenCalledWith("smirnoff", 750);
      expect(screen.queryByText(/“smirnoff”/)).toBeNull();
    });
    // The other row survives.
    expect(screen.getByText(/“titos”/)).toBeTruthy();
  });

  it("Keep disarms without calling the API", async () => {
    mockGet.mockResolvedValue({ ok: true, items: [match()] });
    render(<SavedMatchesSection />);
    await screen.findByText(/“smirnoff”/);

    fireEvent.click(screen.getByLabelText("Forget the saved match for smirnoff"));
    fireEvent.click(screen.getByText("Keep"));

    expect(mockForget).not.toHaveBeenCalled();
    expect(screen.getByText(/“smirnoff”/)).toBeTruthy();
  });

  it("empty state invites teaching; load errors are calm banners", async () => {
    mockGet.mockResolvedValue({ ok: true, items: [] });
    const { unmount } = render(<SavedMatchesSection />);
    expect(await screen.findByText(/Nothing learned yet/)).toBeTruthy();
    unmount();

    mockGet.mockResolvedValue({ ok: false, error: "network_error" });
    render(<SavedMatchesSection />);
    expect(await screen.findByText("network_error")).toBeTruthy();
  });
});
