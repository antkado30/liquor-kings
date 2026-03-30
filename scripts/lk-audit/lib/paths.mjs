import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (liquor-kings/) */
export const REPO_ROOT = resolve(__dirname, "..", "..", "..");

export function pathFromRoot(...segments) {
  return join(REPO_ROOT, ...segments);
}
