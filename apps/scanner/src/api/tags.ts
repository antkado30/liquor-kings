/**
 * Tags API client (task #22, 2026-06-02). Fetches printable HTML
 * shelf tags. The server returns a full HTML page; we open it in a
 * new tab/window which triggers the browser print dialog.
 */
import { getAuthBearer } from "../lib/supabase";

const BASE = "/tags";

export type PrintTagsResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/**
 * Fetch printable HTML for one or more MLCC codes. Returns the raw
 * HTML so the caller can open a new window with the print payload.
 *
 * Why POST + read response (instead of just opening a GET URL):
 *   - Lets us send the auth header
 *   - Returns errors cleanly when a code isn't in the catalog
 *   - Supports batch printing (multiple codes per request)
 */
export async function fetchTagsHtml(codes: string[]): Promise<PrintTagsResult> {
  const bearer = await getAuthBearer();
  const storeId = import.meta.env.VITE_SCANNER_STORE_ID as string | undefined;
  if (!bearer || !storeId) {
    return { ok: false, error: "Scanner is not signed in" };
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Store-Id": storeId,
        "Content-Type": "application/json",
        Accept: "text/html, application/json",
      },
      body: JSON.stringify({ codes }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok && contentType.includes("text/html")) {
    const html = await res.text();
    return { ok: true, html };
  }
  let errorText: string;
  try {
    const json = (await res.json()) as { error?: string };
    errorText = json.error ?? `HTTP ${res.status}`;
  } catch {
    errorText = `HTTP ${res.status}`;
  }
  return { ok: false, error: errorText };
}

/*
  openAndPrintTagHtml was removed 2026-06-02 — window.open is blocked
  in iOS PWA standalone mode. Use TagPrintPreview (component) which
  embeds the HTML in an iframe inside the scanner UI and prints via
  iframe.contentWindow.print(). That path works in BOTH PWA and
  regular Safari.
*/
