import { loginToMilo } from "./login.js";
import { navigateToProducts } from "./navigate-to-products.js";

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const loginUrl = process.env.MILO_LOGIN_URL;
  const headful = process.env.MILO_TEST_HEADFUL === "1";
  const licenseNumber = process.env.MILO_TEST_LICENSE;

  if (!username || !password || !licenseNumber) {
    throw new Error(
      "Missing required env vars: MILO_USERNAME, MILO_PASSWORD, and MILO_TEST_LICENSE (optional: MILO_LOGIN_URL, MILO_TEST_HEADFUL=1)",
    );
  }

  console.log("=== Stage 1 + 2 Navigation Test (SAFE MODE) ===");

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

    const stage2 = await navigateToProducts(session, {
      licenseNumber,
      captureArtifacts: true,
    });

    console.log("Navigation successful.");
    console.log("selectedLicense.number:", stage2.selectedLicense.number);
    console.log("selectedLicense.friendlyName:", stage2.selectedLicense.friendlyName);
    console.log("deliveryDates.141:", stage2.deliveryDates["141"]);
    console.log("deliveryDates.221:", stage2.deliveryDates["221"]);
    console.log("deliveryDates.321:", stage2.deliveryDates["321"]);
    console.log("stage2DurationMs:", stage2.stage2DurationMs);
    console.log("currentUrl:", stage2.currentUrl);
    console.log("outputDir:", stage2.outputDir || "(none)");
    process.exitCode = 0;
  } catch (error) {
    console.error("Navigation failed.");
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
