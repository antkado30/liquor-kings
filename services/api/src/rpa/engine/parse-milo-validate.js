/**
 * parseMiloValidate — PURE parser that turns already-fetched MILO API JSON
 * (cart / inventory / validate / deliveryByRef) into the EXACT validate-result
 * shape validate-cart.js returns, so the engine can be a drop-in replacement
 * for the DOM-scraped validate result.
 *
 * Output fields (match validate-cart.js field names exactly):
 *   validated, validationMessages, adaOrders, outOfStockItems, orderSummary,
 *   deliveryDates, canCheckout
 *
 * No network, no side effects, no console. Never throws on malformed input —
 * returns validated:false.
 *
 * @param {object} args
 * @param {object} args.cart        GET /users/cart body.
 * @param {object[]} args.inventory PUT /inventory/check body (per-item stock).
 * @param {object} args.validate    GET /validate body.
 * @param {object} args.deliveryByRef { [referenceNumber]: { referenceNumber, name, deliveryDate, ... } }
 */
export function parseMiloValidate({ cart, inventory, validate, deliveryByRef } = {}) {
  try {
    const validated = validate?.success === true;

    const items = Array.isArray(cart?.items) ? cart.items : [];
    const invRows = Array.isArray(inventory) ? inventory : [];

    const invByCode = new Map();
    for (const r of invRows) {
      const c = r?.itemCode != null ? String(r.itemCode) : null;
      if (c) invByCode.set(c, r);
    }
    const cartByCode = new Map();
    for (const it of items) {
      const c = it?.product?.code != null ? String(it.product.code) : null;
      if (c) cartByCode.set(c, it);
    }

    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const sizeMlOf = (it) => num(it?.product?.sizeInMilliliters);

    // ── outOfStockItems ────────────────────────────────────────────────────
    // Confirmed OOS: inventory rows with available === false.
    // Safe bias: any ordered cart item MISSING from inventory is not assumed
    // in-stock — it's flagged needsRecheck:true (would rather re-check than
    // silently validate a stale cart).
    const outOfStockItems = [];
    for (const r of invRows) {
      if (r?.available !== false) continue;
      const code = r.itemCode != null ? String(r.itemCode) : null;
      const ci = code ? cartByCode.get(code) : null;
      outOfStockItems.push({
        code,
        name: ci?.product?.name ?? "",
        bottleSizeMl: sizeMlOf(ci),
        quantity: num(ci?.quantity) ?? num(r.quantity),
        adaName: ci?.product?.distributor?.name ?? "",
        reason: "oos_section",
        needsRecheck: false,
      });
    }
    for (const it of items) {
      const code = it?.product?.code != null ? String(it.product.code) : null;
      if (!code || invByCode.has(code)) continue;
      outOfStockItems.push({
        code,
        name: it?.product?.name ?? "",
        bottleSizeMl: sizeMlOf(it),
        quantity: num(it?.quantity),
        adaName: it?.product?.distributor?.name ?? "",
        reason: "needs_recheck",
        needsRecheck: true,
      });
    }

    // ── adaOrders (group cart items by distributor referenceNumber) ────────
    const groups = new Map();
    for (const it of items) {
      const ref = it?.product?.distributor?.referenceNumber != null ? String(it.product.distributor.referenceNumber) : "";
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(it);
    }
    const adaOrders = [];
    for (const [ref, groupItems] of groups) {
      let subtotalLiters = 0;
      let subtotalDollars = 0;
      const adaItems = groupItems.map((it) => {
        const qty = num(it?.quantity) ?? 0;
        const sizeMl = sizeMlOf(it) ?? 0;
        const liters = (qty * sizeMl) / 1000;
        subtotalLiters += liters;
        const lineTotal = num(it?.total) ?? 0;
        subtotalDollars += lineTotal;
        const code = it?.product?.code != null ? String(it.product.code) : null;
        return {
          code,
          name: it?.product?.name ?? "",
          bottleSizeMl: sizeMl ? sizeMl : null,
          quantity: qty,
          unitPrice: num(it?.product?.price),
          liters: Math.round(liters * 1000) / 1000,
          lineTotal: num(it?.total),
          quantityOrdered: num(it?.orderedQuantity),
          outOfStock: it?.available === false || (code ? invByCode.get(code)?.available === false : false),
        };
      });
      subtotalLiters = Math.round(subtotalLiters * 100) / 100;
      subtotalDollars = Math.round(subtotalDollars * 100) / 100;
      const delivery = deliveryByRef?.[ref] ?? null;
      adaOrders.push({
        adaNumber: ref,
        adaName: groupItems[0]?.product?.distributor?.name ?? "",
        deliveryDate: delivery?.deliveryDate ?? null,
        confirmationNumber: null,
        meetsMinimum: subtotalLiters >= 9,
        subtotalLiters,
        subtotalDollars,
        items: adaItems,
        errors: [],
      });
    }

    // ── orderSummary (from cart.taxes; discount negated to match ──────────
    // validate-cart's stored convention: gross - discount + tax = net,
    // discount stored negative, e.g. -94.68)
    const taxes = Array.isArray(cart?.taxes) ? cart.taxes : [];
    const taxByType = new Map();
    for (const t of taxes) if (t?.taxType) taxByType.set(t.taxType, t);
    const taxAmt = (type) => {
      const t = taxByType.get(type);
      return t && Number.isFinite(Number(t.taxAmt)) ? Number(t.taxAmt) : null;
    };
    const grossTotal = taxAmt("Gross Total") ?? num(cart?.total);
    const liquorTax = taxAmt("Liquor Tax");
    const discTaxAmt = taxAmt("Discount");
    const discount = discTaxAmt != null ? -discTaxAmt : null;
    const netTotal = taxAmt("Net Total");
    const orderSummary = { grossTotal, liquorTax, discount, netTotal };

    // ── deliveryDates ({141, 221, 321}) ───────────────────────────────────
    const deliveryDates = {
      "141": deliveryByRef?.["141"]?.deliveryDate ?? null,
      "221": deliveryByRef?.["221"]?.deliveryDate ?? null,
      "321": deliveryByRef?.["321"]?.deliveryDate ?? null,
    };

    // ── canCheckout ───────────────────────────────────────────────────────
    const canCheckout =
      validated &&
      adaOrders.length > 0 &&
      outOfStockItems.length === 0 &&
      adaOrders.every((a) => a.meetsMinimum && a.errors.length === 0);

    // ── validationMessages (synthesized) ──────────────────────────────────
    const validationMessages = [];
    if (!validated) {
      validationMessages.push("MLCC validation did not succeed.");
    } else {
      validationMessages.push("Cart validated!");
      validationMessages.push("Your cart has been successfully validated.");
    }
    if (outOfStockItems.length > 0) {
      const nr = outOfStockItems.filter((o) => o.needsRecheck).length;
      validationMessages.push(
        `${outOfStockItems.length} item(s) not available${nr > 0 ? ` (${nr} need recheck)` : ""}.`,
      );
    }
    for (const a of adaOrders) {
      if (!a.meetsMinimum) validationMessages.push(`${a.adaName} is below the 9 L minimum.`);
    }

    return {
      validated,
      validationMessages,
      adaOrders,
      outOfStockItems,
      orderSummary,
      deliveryDates,
      canCheckout,
    };
  } catch {
    return {
      validated: false,
      validationMessages: ["MLCC validation did not succeed."],
      adaOrders: [],
      outOfStockItems: [],
      orderSummary: { grossTotal: null, liquorTax: null, discount: null, netTotal: null },
      deliveryDates: { "141": null, "221": null, "321": null },
      canCheckout: false,
    };
  }
}
