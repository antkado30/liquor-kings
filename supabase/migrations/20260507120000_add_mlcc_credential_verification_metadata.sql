-- Add verification + status metadata columns for MLCC credentials.
-- Existing mlcc_username and mlcc_password_encrypted columns from foundational
-- migration are reused. mlcc_password_encrypted will store AES-256-GCM ciphertext
-- in the format: v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
-- Encrypt/decrypt MUST go through services/api/src/lib/credential-encryption.js.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS mlcc_credentials_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS mlcc_credentials_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS mlcc_credentials_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS mlcc_credentials_last_status text,
  ADD COLUMN IF NOT EXISTS mlcc_credentials_last_error_code text;

COMMENT ON COLUMN public.stores.mlcc_password_encrypted IS
  'AES-256-GCM ciphertext, format v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>. Key in LK_CREDENTIAL_ENCRYPTION_KEY env. Use services/api/src/lib/credential-encryption.js. NEVER store plaintext.';

COMMENT ON COLUMN public.stores.mlcc_credentials_updated_at IS
  'When the encrypted password was most recently saved (independent of stores.updated_at).';

COMMENT ON COLUMN public.stores.mlcc_credentials_verified_at IS
  'When credentials were most recently verified by a SUCCESSFUL Stage 1 login.';

COMMENT ON COLUMN public.stores.mlcc_credentials_last_verified_at IS
  'When credentials were most recently verify-attempted (regardless of result).';

COMMENT ON COLUMN public.stores.mlcc_credentials_last_status IS
  'Result of last verify attempt: success | invalid_credentials | captcha_required | timeout | network_error | security_violation | unknown_error';

COMMENT ON COLUMN public.stores.mlcc_credentials_last_error_code IS
  'Typed error code from Stage 1 if last verify failed (e.g. MILO_LOGIN_INVALID_CREDENTIALS).';
