export type StoreRow = { id: string; name: string | null };
export type Operator = { id: string; email: string | null };

export type RunSummaryTimestamps = {
  queued_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type RunSummaryRow = {
  run_id: string;
  cart_id?: string | null;
  status: string;
  failure_type?: string | null;
  failure_message?: string | null;
  retry_allowed?: boolean;
  retry_count?: number;
  operator_status?: string;
  actionable_next_step?: string;
  pending_manual_review?: boolean;
  manual_review_recommended?: boolean;
  has_evidence?: boolean;
  progress_stage?: string | null;
  timestamps?: RunSummaryTimestamps | null;
  /** From stored execution_run_attempts for this run (0 if none). */
  stored_attempt_count?: number;
  has_multiple_stored_attempts?: boolean;
  /** True only when two+ failed attempts share identical stored type+message. */
  repeated_same_stored_failure?: boolean;
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

/** Rows from `attempt_history.items` in the operator review bundle (stored execution attempts). */
export type ExecutionAttemptRow = {
  id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  failure_type?: string | null;
  failure_message?: string | null;
  progress_stage?: string | null;
  progress_message?: string | null;
  evidence_metadata?: {
    evidence_count?: number;
    evidence_kinds?: string[];
  } | null;
  worker_id?: string | null;
  created_at?: string;
  updated_at?: string;
};
