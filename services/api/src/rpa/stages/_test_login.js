import { loginToMilo } from "./login.js";

async function main() {
  const username = process.env.MILO_USERNAME;
  const password = process.env.MILO_PASSWORD;
  const loginUrl = process.env.MILO_LOGIN_URL;
  const headful = process.env.MILO_TEST_HEADFUL === "1";

  if (!username || !password) {
    throw new Error("Missing required env vars: MILO_USERNAME and MILO_PASSWORD");
  }

  console.log("=== Stage 1 Login Test (SAFE MODE) ===");

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
        captureArtifacts: true,
        slowMo: 250,
      },
    );

    console.log("Login successful.");
    console.log("postLoginUrl:", session.postLoginUrl);
    console.log("durationMs:", session.durationMs);
    console.log("outputDir:", session.outputDir);
    process.exitCode = 0;
  } catch (error) {
    console.error("Login failed.");
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
