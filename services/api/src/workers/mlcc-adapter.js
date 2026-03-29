function payloadShapeError() {
  return {
    ready: false,
    items: [],
    errors: [
      {
        type: "payload",
        message: "Execution payload missing required fields",
      },
    ],
  };
}

function itemError(item, message) {
  return {
    type: "item",
    cartItemId: item?.cartItemId ?? null,
    bottleId: item?.bottleId ?? null,
    message,
  };
}

function isPositiveIntegerQuantity(value) {
  const n = Number(value);

  return Number.isInteger(n) && n > 0;
}

export function adaptExecutionPayloadToMlccOrder(payload) {
  if (
    !payload ||
    !payload.cart ||
    !payload.store ||
    !Array.isArray(payload.items)
  ) {
    return payloadShapeError();
  }

  const itemErrors = [];

  for (const item of payload.items) {
    if (!item || !item.bottle) {
      itemErrors.push(
        itemError(item, "Execution item is missing bottle data"),
      );
      continue;
    }

    const rawCode = item.bottle.mlcc_code;

    if (
      rawCode == null ||
      typeof rawCode !== "string" ||
      rawCode.trim() === ""
    ) {
      itemErrors.push(itemError(item, "Bottle is missing MLCC code"));
      continue;
    }

    if (!isPositiveIntegerQuantity(item.quantity)) {
      itemErrors.push(
        itemError(item, "Execution item quantity must be a positive integer"),
      );
      continue;
    }
  }

  if (itemErrors.length > 0) {
    return {
      ready: false,
      items: [],
      errors: itemErrors,
    };
  }

  const items = payload.items.map((item) => {
    const mlccCode = item.bottle.mlcc_code.trim();
    const quantity = Number(item.quantity);

    return {
      cartItemId: item.cartItemId,
      bottleId: item.bottleId,
      mlccCode,
      quantity,
      name: item.bottle.name ?? null,
      sizeMl: item.bottle.size_ml ?? null,
      upc: item.bottle.upc ?? null,
    };
  });

  return {
    ready: true,
    items,
    errors: [],
  };
}

export function buildMlccPreflightReport(payload) {
  const adapted = adaptExecutionPayloadToMlccOrder(payload);

  if (!adapted.ready) {
    const itemCount = Array.isArray(payload?.items) ? payload.items.length : 0;

    return {
      ready: false,
      summary: {
        itemCount,
        validItemCount: 0,
        invalidItemCount: adapted.errors.length,
      },
      items: [],
      errors: adapted.errors,
    };
  }

  return {
    ready: true,
    summary: {
      itemCount: adapted.items.length,
      validItemCount: adapted.items.length,
      invalidItemCount: 0,
    },
    items: adapted.items,
    errors: [],
  };
}
