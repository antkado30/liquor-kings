import "dotenv/config";
import { initSentry } from "./lib/sentry.js";

initSentry();

const { default: app } = await import("./app.js");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
