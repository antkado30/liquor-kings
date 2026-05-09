/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCANNER_DEV_BEARER?: string;
  readonly VITE_SCANNER_STORE_ID?: string;
  readonly VITE_SCANNER_API_BASE?: string;
  readonly VITE_UPC_CONFIRM_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
