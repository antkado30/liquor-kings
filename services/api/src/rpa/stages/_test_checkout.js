import { loginToMilo } from "./login.js";
import { navigateToProducts } from "./navigate-to-products.js";
import { addItemsToCart } from "./add-items-to-cart.js";
import { validateCartOnMilo } from "./validate-cart.js";
import { checkoutOnMilo } from "./checkout.js";

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const loginUrl = process.env.MILO_LOGIN_URL;
  const headful = process.env.MILO_TEST_HEADFUL === "1";
  const licenseNumber = process.env.MILO_TEST_LICENSE;
  const skipAddItems = process.env.MILO_TEST_SKIP_ADDITEMS === "1";

  if (!username || !password || !licenseNumber) {
    throw new Error(
      "Missing required env vars: MILO_USERNAME, MILO_PASSWORD, MILO_TEST_LICENSE (optional: MILO_LOGIN_URL, MILO_TEST_HEADFUL=1, MILO_TEST_SKIP_ADDITEMS=1, MILO_TEST_ALLOW_SUBMIT=yes, LK_ALLOW_ORDER_SUBMISSION=yes)",
    );
  }

  const testAllowSubmit = process.env.MILO_TEST_ALLOW_SUBMIT === "yes";
  const globalAllowSubmit = process.env.LK_ALLOW_ORDER_SUBMISSION === "yes";
  const mode = testAllowSubmit && globalAllowSubmit ? "submit" : "dry_run";

  console.log("=== Stage 1+2+3+4+5 Checkout Flow Test ===");
  console.log(`Stage 5 mode requested: ${mode}`);

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

    const checkedOut = await checkoutOnMilo(validated, {
      mode,
      allowOrderSubmission: testAllowSubmit,
      timeoutMs: 60_000,
    });

    console.log("validated:", checkedOut.validated);
    console.log("canCheckout:", checkedOut.canCheckout);
    console.log("stage5 mode:", checkedOut.mode);
    console.log("submitted:", checkedOut.submitted);
    console.log("dryRunReason:", checkedOut.dryRunReason || null);
    console.log("confirmationNumbers:", checkedOut.confirmationNumbers);
    console.log("submittedTimestamp:", checkedOut.submittedTimestamp);
    console.log("successToastMessages:", checkedOut.successToastMessages);
    console.log("errorToastMessages:", checkedOut.errorToastMessages);
    console.log("confirmationEmail:", checkedOut.confirmationEmail);
    console.log("stage5DurationMs:", checkedOut.stage5DurationMs);
    console.log("currentUrl:", checkedOut.currentUrl);
    console.log("outputDir:", checkedOut.outputDir || "(none)");
    console.log(
      `FINAL MODE: ${checkedOut.mode}. Live submission requires BOTH MILO_TEST_ALLOW_SUBMIT=yes and LK_ALLOW_ORDER_SUBMISSION=yes.`,
    );
    process.exitCode = 0;
  } catch (error) {
    console.error("Checkout flow test failed.");
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
