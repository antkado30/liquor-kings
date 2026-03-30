import { readFileSync, existsSync } from "node:fs";
import { pathFromRoot } from "./paths.mjs";

/**
 * Loads services/api/.env into process.env without overwriting existing keys.
 */
export function loadApiEnv() {
  const envPath = pathFromRoot("services", "api", ".env");

  if (!existsSync(envPath)) {
    return { loaded: false, path: envPath };
  }

  const raw = readFileSync(envPath, "utf8");

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");

    if (eq === -1) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return { loaded: true, path: envPath };
}

export function requireEnv(name) {
  const v = process.env[name];

  if (v === undefined || String(v).trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name} (set in services/api/.env or the shell)`,
    );
  }

  return v;
}
