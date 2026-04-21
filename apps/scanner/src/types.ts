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
}

export interface ProductFamily {
  baseName: string;
  sizes: MlccProduct[];
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
}

export interface CartItem {
  product: MlccProduct;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  storeId: string | null;
}
