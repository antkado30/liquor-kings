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
  /**
   * Grid-sized (~360px WebP) thumbnail of the catalog photo. Served by
   * /browse since 2026-06-12 (quality mandate — the grid must never
   * decode multi-MB originals). NULL until the thumb backfill reaches
   * the code; always fall back to imageUrl.
   */
  imageThumbUrl?: string | null;
  /**
   * ISO date (YYYY-MM-DD) of the most recent MLCC price book that
   * contained this product. Stored by the price-book ingestor. Used
   * client-side (task #44) to flag products that haven't appeared in
   * a recent price book — those are likely discontinued. Null when
   * the column wasn't populated (older rows, manual seeds).
   */
  last_price_book_date?: string | null;
  /**
   * Server-side "active" flag. Defaults true. Reserved for future
   * use — today the ingestor never flips it to false, but the
   * /items/:code/family endpoint already filters on `is_active=true`,
   * so once we have a process for marking products inactive the
   * scanner respects it automatically.
   */
  is_active?: boolean;
  /**
   * Container material from the family engine ("glass" | "plastic" | …,
   * 2026-07-11). Rides size chip → cart line → confirm modal so nobody
   * orders glass and receives plastic (catalog-family-tree-plan §B).
   * Optional: endpoints that don't select the column omit it — the UI
   * then shows no label rather than guessing.
   */
  container?: string | null;
}

export interface ProductFamily {
  baseName: string;
  sizes: MlccProduct[];
  /**
   * True when this family spans more than one container material
   * (glass + plastic — 527 such families in the live catalog). Drives
   * the chip rule: in a mixed family EVERY chip carries its material
   * label; the label is never hidden (2026-07-01 decision).
   */
  mixedContainers?: boolean;
}

/**
 * One family card in grouped search results (/items/grouped, 2026-07-11).
 * Search "tito" → one card, all sizes; tap opens the ProductCard tree at
 * the representative's code. Combos are their own singleton cards.
 */
export interface FamilyGroup {
  familyKey: string;
  category: string | null;
  /** Clean family name for the card title (combo cards keep their real name). */
  baseName: string;
  /** Distinct codes in the family = number of size chips the tree will show. */
  sizeCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** Family spans glass + plastic — the card hints it, the chips prove it. */
  mixedContainers: boolean;
  isCombo: boolean;
  /** Full product row driving the thumbnail and the tap-through anchor. */
  representative: MlccProduct;
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
  /** Scanned UPC when the server returns `no_upc_data_found` (manual mapping flow). */
  upc?: string;
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
