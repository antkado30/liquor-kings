import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function joinApiPath(apiBaseUrl, pathname) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const pathPart = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return `${base}${pathPart}`;
}

async function readJsonResponse(res) {
  const text = await res.text();
  let body;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON response (HTTP ${res.status})`);
  }

  return body;
}

function httpErrorMessage(status, body) {
  if (body && typeof body.error === "string") {
    return body.error;
  }

  return `HTTP ${status}`;
}

export async function claimNextRun({ apiBaseUrl, workerId, workerNotes }) {
  const url = joinApiPath(apiBaseUrl, "/execution-runs/claim-next");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId, workerNotes }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function heartbeatRun({
  apiBaseUrl,
  runId,
  workerId,
  progressStage,
  progressMessage,
  workerNotes,
}) {
  const url = joinApiPath(apiBaseUrl, `/execution-runs/${runId}/heartbeat`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workerId,
      progressStage,
      progressMessage,
      workerNotes,
    }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function finalizeRun({
  apiBaseUrl,
  runId,
  status,
  workerNotes,
  errorMessage,
}) {
  const url = joinApiPath(apiBaseUrl, `/execution-runs/${runId}/status`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      workerNotes,
      errorMessage,
    }),
  });

  const body = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res.status, body));
  }

  return body;
}

export async function processOneRun({ apiBaseUrl, workerId }) {
  const claimBody = await claimNextRun({
    apiBaseUrl,
    workerId,
    workerNotes: "claimed by local execution worker",
  });

  if (claimBody.data === null) {
    return {
      success: true,
      claimed: false,
    };
  }

  const { run, payload } = claimBody.data;

  if (
    !payload ||
    !payload.cart ||
    !payload.store ||
    !Array.isArray(payload.items)
  ) {
    await finalizeRun({
      apiBaseUrl,
      runId: run.id,
      status: "failed",
      workerNotes: "payload validation failed in local worker",
      errorMessage: "Execution payload missing required fields",
    });

    return {
      success: false,
      claimed: true,
      failed: true,
    };
  }

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    workerId,
    progressStage: "payload_loaded",
    progressMessage: "Execution payload loaded",
  });

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    workerId,
    progressStage: "preflight_complete",
    progressMessage: "Preflight checks complete",
  });

  await heartbeatRun({
    apiBaseUrl,
    runId: run.id,
    workerId,
    progressStage: "ready_for_mlcc",
    progressMessage: "Stub worker ready for MLCC automation",
  });

  await finalizeRun({
    apiBaseUrl,
    runId: run.id,
    status: "succeeded",
    workerNotes: "completed by local execution worker",
    errorMessage: undefined,
  });

  return {
    success: true,
    claimed: true,
    runId: run.id,
  };
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  path.resolve(process.argv[1] ?? "") === path.resolve(__filename);

if (isMainModule) {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
  const workerId = process.env.WORKER_ID ?? "local-worker-1";

  try {
    const result = await processOneRun({ apiBaseUrl, workerId });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
