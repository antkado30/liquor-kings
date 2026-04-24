import { loginToMilo } from "./login.js";
import { navigateToProducts } from "./navigate-to-products.js";
import { addItemsToCart } from "./add-items-to-cart.js";

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const loginUrl = process.env.MILO_LOGIN_URL;
  const headful = process.env.MILO_TEST_HEADFUL === "1";
  const licenseNumber = process.env.MILO_TEST_LICENSE;

  if (!username || !password || !licenseNumber) {
    throw new Error(
      "Missing required env vars: MILO_USERNAME, MILO_PASSWORD, MILO_TEST_LICENSE (optional: MILO_LOGIN_URL, MILO_TEST_HEADFUL=1)",
    );
  }

  console.log("=== Stage 1 + 2 + 3 Add Items Test (SAFE MODE) ===");

  // Test-only enrichment: include ADA numbers directly.
  // Production API endpoints should enrich ada_number from the MLCC items table.
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

    const stage3 = await addItemsToCart(session, testCart, {
      captureArtifacts: true,
    });

    console.log("Add-items successful.");
    console.log("itemsAdded:", stage3.itemsAdded.length);
    for (const item of stage3.itemsAdded) {
      console.log(`  - ${item.code} x${item.quantity}: ${item.actualNameOnPage || "(name unavailable)"}`);
    }
    console.log("itemsRejected:", stage3.itemsRejected.length);
    for (const item of stage3.itemsRejected) {
      console.log(`  - ${item.code} x${item.quantity}: ${item.reason || "not accepted"}`);
    }
    console.log("stage3DurationMs:", stage3.stage3DurationMs);
    console.log("currentUrl:", stage3.currentUrl);
    console.log("outputDir:", stage3.outputDir || "(none)");
    console.log(
      "CART IS NOW POPULATED ON MILO. Items will remain in cart until manually removed OR until you click Validate+Checkout (never done by this tool). Safe to leave.",
    );
    process.exitCode = 0;
  } catch (error) {
    console.error("Add-items test failed.");
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
