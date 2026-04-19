import type { MlccProduct, ProductFamily } from "../types";

const BASE = "/price-book";

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapRow(row: Record<string, unknown>): MlccProduct {
  return {
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    brand_family: str(row.brand_family),
    category: str(row.category),
    ada_number: str(row.ada_number) ?? "",
    ada_name: str(row.ada_name) ?? "",
    proof: num(row.proof),
    bottle_size_label: str(row.bottle_size_label),
    bottle_size_ml: num(row.bottle_size_ml) != null ? Math.round(Number(row.bottle_size_ml)) : null,
    case_size: num(row.case_size) != null ? Math.round(Number(row.case_size)) : null,
    licensee_price: num(row.licensee_price),
    min_shelf_price: num(row.min_shelf_price),
    base_price: num(row.base_price),
    is_new_item: Boolean(row.is_new_item),
  };
}

export async function searchProducts(
  query: string,
  options?: { adaNumber?: string; limit?: number },
): Promise<MlccProduct[]> {
  const limit = options?.limit ?? 20;
  const params = new URLSearchParams();
  params.set("search", query);
  params.set("limit", String(limit));
  params.set("page", "1");
  if (options?.adaNumber) params.set("adaNumber", options.adaNumber);
  try {
    const res = await fetch(`${BASE}/items?${params.toString()}`, { credentials: "same-origin" });
    const data = (await res.json()) as { ok?: boolean; items?: unknown[] };
    if (!res.ok || !data.ok || !Array.isArray(data.items)) return [];
    return data.items.map((r) => mapRow(r as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getProductByUpc(upc: string): Promise<MlccProduct | null> {
  const u = upc.trim();
  if (!u) return null;
  try {
    const res = await fetch(`${BASE}/upc/${encodeURIComponent(u)}`, { credentials: "same-origin" });
    const data = (await res.json()) as { ok?: boolean; product?: unknown; error?: string };
    if (!res.ok || !data.ok || !data.product) return null;
    return mapRow(data.product as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function getProductByCode(mlccCode: string): Promise<MlccProduct | null> {
  const code = mlccCode.trim();
  if (!code) return null;
  const items = await searchProducts(code, { limit: 50 });
  const exact = items.find((i) => i.code === code);
  if (exact) return exact;
  if (/^\d+$/.test(code) && code.length >= 8) {
    const viaUpc = await getProductByUpc(code);
    if (viaUpc) return viaUpc;
  }
  return null;
}

function dedupeById(products: MlccProduct[]): MlccProduct[] {
  const seen = new Set<string>();
  const out: MlccProduct[] = [];
  for (const p of products) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export async function getProductFamily(mlccCode: string): Promise<ProductFamily | null> {
  const matched = await getProductByCode(mlccCode);
  if (!matched) return null;

  const searchKey = (matched.brand_family ?? matched.name).trim() || matched.name;
  const related = await searchProducts(searchKey, { limit: 100 });

  const bf = matched.brand_family;
  let sizes: MlccProduct[];
  if (bf) {
    sizes = related.filter((p) => p.brand_family === bf);
  } else {
    sizes = related.filter((p) => p.code === matched.code || p.name === matched.name);
  }

  if (!sizes.some((s) => s.id === matched.id)) {
    sizes = [matched, ...sizes];
  }

  sizes = dedupeById(sizes);
  sizes.sort((a, b) => (a.bottle_size_ml ?? 0) - (b.bottle_size_ml ?? 0));

  return {
    baseName: matched.name,
    sizes,
  };
}
