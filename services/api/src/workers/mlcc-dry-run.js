function payloadShapeError() {
  return {
    ready: false,
    plan: null,
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

export function buildMlccDryRunPlan(payload) {
  if (
    !payload ||
    !payload.cart ||
    !payload.store ||
    !Array.isArray(payload.items)
  ) {
    return payloadShapeError();
  }

  const errors = [];

  if (payload.store.id == null || payload.store.id === "") {
    errors.push({
      type: "store",
      message: "Store id is required",
    });
  }

  const storeName = payload.store.store_name;

  if (
    storeName == null ||
    typeof storeName !== "string" ||
    storeName.trim() === ""
  ) {
    errors.push({
      type: "store",
      message: "Store name is required",
    });
  }

  if (errors.length > 0) {
    return {
      ready: false,
      plan: null,
      errors,
    };
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
      plan: null,
      errors: itemErrors,
    };
  }

  const items = payload.items.map((item, index) => {
    const mlccCode = item.bottle.mlcc_code.trim();
    const quantity = Number(item.quantity);

    return {
      sequence: index + 1,
      cartItemId: item.cartItemId,
      bottleId: item.bottleId,
      mlccCode,
      quantity,
      name: item.bottle.name ?? null,
      sizeMl: item.bottle.size_ml ?? null,
      upc: item.bottle.upc ?? null,
    };
  });

  const totalQuantity = items.reduce((sum, step) => sum + step.quantity, 0);

  return {
    ready: true,
    plan: {
      mode: "mlcc_dry_run",
      cart: {
        id: payload.cart.id,
        store_id: payload.cart.store_id,
      },
      store: {
        id: payload.store.id,
        store_name:
          typeof payload.store.store_name === "string"
            ? payload.store.store_name.trim()
            : payload.store.store_name,
        liquor_license: payload.store.liquor_license ?? null,
        mlcc_store_number: payload.store.mlcc_store_number ?? null,
        mlcc_username: payload.store.mlcc_username ?? null,
      },
      items,
      summary: {
        itemCount: items.length,
        totalQuantity,
      },
    },
    errors: [],
  };
}

export function summarizeMlccDryRunOutcome(planResult) {
  if (!planResult.ready) {
    const errorMessage = planResult.errors.map((e) => e.message).join("; ");

    return {
      success: false,
      workerNotes: "MLCC dry run failed during plan generation",
      errorMessage,
    };
  }

  return {
    success: true,
    workerNotes:
      "MLCC dry run completed successfully; no live MLCC actions were performed",
    errorMessage: null,
  };
}
