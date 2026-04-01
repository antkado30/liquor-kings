const FAILURE_GUIDANCE: Record<string, string> = {
  CODE_MISMATCH:
    "Do not rely on blind retry. Review bottle / MLCC mapping and cart identity before re-queueing.",
  OUT_OF_STOCK:
    "Review inventory and cart lines; adjust stock or remove items as appropriate.",
  QUANTITY_RULE_VIOLATION:
    "Fix quantity or rule configuration; retry is unlikely to succeed until data is corrected.",
  MLCC_UI_CHANGE:
    "MLCC automation UI/login/page flow may not match expectations (includes login and selector issues). Use MLCC-specific context below when present; check evidence.",
  NETWORK_ERROR:
    "Often transient — retry may be appropriate when the system shows retry_allowed. For MLCC browser workers, distinguish transport errors from login/runtime using context below.",
  UNKNOWN:
    "Investigate evidence and logs; treat as manual review until root cause is clear.",
};

export function failureGuidanceText(failureType: string | null | undefined): string {
  if (!failureType) return "";
  return FAILURE_GUIDANCE[failureType] ?? FAILURE_GUIDANCE.UNKNOWN;
}
