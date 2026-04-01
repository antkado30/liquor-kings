export type StoreRow = { id: string; name: string | null };
export type Operator = { id: string; email: string | null };

export type RunSummaryRow = {
  run_id: string;
  cart_id?: string | null;
  status: string;
  failure_type?: string | null;
  retry_allowed?: boolean;
  operator_status?: string;
  actionable_next_step?: string;
  pending_manual_review?: boolean;
};

export type Summary = Record<string, unknown>;

export type OpAction = {
  action: string;
  created_at?: string;
  actor_id?: string | null;
  reason?: string | null;
  note?: string | null;
};

export type FlashKind = "error" | "success" | "warn" | "";

export type FlashMsg = { type: FlashKind; text: string };
