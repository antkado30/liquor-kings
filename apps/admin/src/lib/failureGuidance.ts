const FAILURE_GUIDANCE: Record<string, string> = {
  CODE_MISMATCH:
    "Do not rely on blind retry. Review bottle / MLCC mapping and cart identity before re-queueing.",
  OUT_OF_STOCK:
    "Review inventory and cart lines; adjust stock or remove items as appropriate.",
  QUANTITY_RULE_VIOLATION:
    "Fix quantity or rule configuration; retry is unlikely to succeed until data is corrected.",
  MLCC_UI_CHANGE:
    "MLCC site or selectors may have changed — expect manual review; check automation evidence.",
  NETWORK_ERROR:
    "Often transient — retry may be appropriate when the system shows retry_allowed.",
  UNKNOWN:
    "Investigate evidence and logs; treat as manual review until root cause is clear.",
};

export function failureGuidanceText(failureType: string | null | undefined): string {
  if (!failureType) return "";
  return FAILURE_GUIDANCE[failureType] ?? FAILURE_GUIDANCE.UNKNOWN;
}
