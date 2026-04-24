import { loginToMilo } from "./login.js";
import { navigateToProducts } from "./navigate-to-products.js";
import { addItemsToCart } from "./add-items-to-cart.js";
import { validateCartOnMilo } from "./validate-cart.js";

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const loginUrl = process.env.MILO_LOGIN_URL;
  const headful = process.env.MILO_TEST_HEADFUL === "1";
  const licenseNumber = process.env.MILO_TEST_LICENSE;
  const skipAddItems = process.env.MILO_TEST_SKIP_ADDITEMS === "1";

  if (!username || !password || !licenseNumber) {
    throw new Error(
      "Missing required env vars: MILO_USERNAME, MILO_PASSWORD, MILO_TEST_LICENSE (optional: MILO_LOGIN_URL, MILO_TEST_HEADFUL=1, MILO_TEST_SKIP_ADDITEMS=1)",
    );
  }

  console.log("=== Stage 1+2+3+4 Full Validate Flow Test (SAFE MODE) ===");

  // Keep this aligned with _test_add_items.js.
  const testCart = [
    { code: "9121", quantity: 12, bottle_size_ml: 1000, ada_number: "321", expected_name: "J DANIELS OLD 7 BLACK" },
    { code: "11022", quantity: 12, bottle_size_ml: 750, ada_number: "221", expected_name: "DEEP EDDY RUBY RED" },
  ];

  let session = null;
  try {
    session = await loginToMilo(
      {
        username,
        password,
        ...(loginUrl ? { loginUrl } : {}),
      },
      {
        headless: !headful,
        slowMo: 250,
        captureArtifacts: true,
      },
    );

    session = await navigateToProducts(session, {
      licenseNumber,
      captureArtifacts: true,
    });

    if (skipAddItems) {
      const cartUrl = new URL(session.currentUrl || session.page.url());
      cartUrl.pathname = "/milo/cart";
      cartUrl.search = "";
      cartUrl.hash = "";
      await session.page.goto(cartUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
      session.currentUrl = session.page.url();
      session.currentPage = "cart";
    } else {
      session = await addItemsToCart(session, testCart, {
        captureArtifacts: true,
      });
    }

    const validated = await validateCartOnMilo(session, {
      captureArtifacts: true,
    });

    console.log("validated:", validated.validated);
    console.log("validationMessages:", validated.validationMessages);
    console.log("adaOrders:");
    for (const ada of validated.adaOrders) {
      console.log(
        `  - ${ada.adaName} (${ada.adaNumber || "unknown"}): delivery=${ada.deliveryDate || "n/a"}, liters=${ada.subtotalLiters}, dollars=${ada.subtotalDollars}, meetsMinimum=${ada.meetsMinimum}, items=${ada.items.length}, errors=${ada.errors.length}`,
      );
    }
    console.log("outOfStockItems:", validated.outOfStockItems.length);
    for (const item of validated.outOfStockItems) {
      console.log(`  - ${item.code || "unknown"} ${item.name} qty=${item.quantity ?? "n/a"} ada=${item.adaName || "n/a"}`);
    }
    console.log("orderSummary:", validated.orderSummary);
    console.log("canCheckout:", validated.canCheckout);
    console.log("stage4DurationMs:", validated.stage4DurationMs);
    console.log("currentUrl:", validated.currentUrl);
    console.log("outputDir:", validated.outputDir || "(none)");
    console.log(
      "VALIDATE WAS CLICKED. Cart has been stock-checked by MLCC. NO ORDER WAS SUBMITTED. Items will remain in cart until you manually clear or click Checkout (never done by this tool).",
    );
    process.exitCode = 0;
  } catch (error) {
    console.error("Validate flow test failed.");
    console.error("error.code:", error?.code || "UNKNOWN");
    console.error("error.message:", error?.message || String(error));
    console.error("error.details:", error?.details || null);
    if (error?.screenshotPath) {
      console.error("error.screenshotPath:", error.screenshotPath);
    }
    process.exitCode = 1;
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error("Fatal test runner error:", error?.message || String(error));
  process.exit(1);
});
