/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Supabase Auth — public anon key + project URL. Both safe to ship in
  // the client bundle (RLS is what actually authorizes requests).
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // Store this scanner instance is bound to (V1 single-store deploy).
  readonly VITE_SCANNER_STORE_ID?: string;
  // Optional API base URL override (default: same-origin "").
  readonly VITE_SCANNER_API_BASE?: string;
  // Optional Bearer for the public POST /price-book/upc/:upc/confirm endpoint.
  readonly VITE_UPC_CONFIRM_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
