export interface MlccProduct {
  id: string;
  code: string;
  name: string;
  brand_family: string | null;
  category: string | null;
  ada_number: string;
  ada_name: string;
  proof: number | null;
  bottle_size_label: string | null;
  bottle_size_ml: number | null;
  case_size: number | null;
  licensee_price: number | null;
  min_shelf_price: number | null;
  base_price: number | null;
  is_new_item: boolean;
  /** UPCitemdb product image when present (scanner UPC flows). */
  imageUrl?: string | null;
}

export interface ProductFamily {
  baseName: string;
  sizes: MlccProduct[];
}

export interface UpcCandidateScore {
  code: string;
  name: string;
  score: number;
  disqualified: boolean;
  reasons: string[];
}

export interface UpcLookupResponse {
  ok: boolean;
  product?: MlccProduct;
  matchMode?: "confident" | "ambiguous";
  needsUserConfirmation?: boolean;
  candidates?: MlccProduct[];
  upcProductName?: string;
  upcBrand?: string;
  message?: string;
  error?: string;
  productName?: string;
  /** Raw UPCitemdb / OFF product title when `productName` is cleaned for search. */
  upcProductNameRaw?: string;
  hint?: string;
  /** Server: category filter excluded all candidates; client showed unfiltered list. */
  confidenceWarning?: string;
  /** POST /upc/:upc/confirm: whether UPC was persisted on mlcc_items. */
  cached?: boolean;
  /** Confident UPC match cache tier from API. */
  cacheQuality?: "high" | "provisional";
  /** When present, lookup used `public.upc_mappings` (authoritative) vs scoring/cache. */
  source?: string;
  /** From `upc_mappings.confidence_source` when `source` is `upc_mappings`. */
  confidenceSource?: string;
  /** From `upc_mappings.scan_count` when `source` is `upc_mappings`. */
  scanCount?: number;
  /** Top candidate total score (0–100) from multi-signal UPC matching. */
  confidenceScore?: number;
  scoringBreakdown?: Record<string, string | number | null>;
  allCandidateScores?: UpcCandidateScore[];
}

export interface CartItem {
  product: MlccProduct;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  storeId: string | null;
}
