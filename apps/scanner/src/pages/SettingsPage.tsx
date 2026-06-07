/**
 * Settings page (task #86, 2026-06-06).
 *
 * V1 settings = MLCC credential management. Future home for:
 *   - LK account email / password change
 *   - Store profile (name, address, license)
 *   - Order arming toggle (LK_ALLOW_ORDER_SUBMISSION per store)
 *   - Receipt printer config
 *   - Sign out
 *
 * For now: surface the same MlccCredentialsForm used in the
 * activation flow's failure state. Single field on V1 = the one that
 * actually breaks accounts in the wild (wrong MLCC password).
 */
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { MlccCredentialsForm } from "../components/MlccCredentialsForm";

export function SettingsPage() {
  const navigate = useNavigate();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={backBtnStyle}
          aria-label="Back"
        >
          ←
        </button>
        <h1 style={titleStyle}>Settings</h1>
      </header>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>MLCC connection</h2>
        <p style={blurbStyle}>
          Update the MILO username or password we use to place orders
          on your behalf. Leave a field blank to keep it the same.
        </p>
        <MlccCredentialsForm
          submitLabel="Save credentials"
          onSaved={(updatedAt) => setSavedAt(updatedAt)}
        />
        {savedAt ? (
          <div style={successStyle}>
            ✅ Saved. Next order or Validate will use the new credentials.
          </div>
        ) : null}
      </section>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
  padding: "16px 18px 80px",
  color: "#fff",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 18,
};

const backBtnStyle: React.CSSProperties = {
  background: "#1a1f29",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#fff",
  borderRadius: 10,
  width: 40,
  height: 40,
  fontSize: 20,
  fontWeight: 600,
  cursor: "pointer",
};

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  margin: 0,
};

const sectionStyle: React.CSSProperties = {
  background: "#11141b",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 14,
  padding: 18,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  margin: "0 0 6px",
};

const blurbStyle: React.CSSProperties = {
  fontSize: 13,
  color: "rgba(255,255,255,0.6)",
  margin: "0 0 16px",
  lineHeight: 1.5,
};

const successStyle: React.CSSProperties = {
  marginTop: 14,
  background: "rgba(50, 180, 120, 0.12)",
  border: "1px solid rgba(50, 180, 120, 0.35)",
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  color: "#a8e6c4",
};
