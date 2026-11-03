/**
 * One-shot end-to-end runner: boots server.js as a child process on its own
 * port (3111 by default), waits for /api/health, runs the multi-turn
 * conversation test, then shuts the server down.
 *
 *   node test/run-e2e.mjs
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.TEST_PORT) || 3111;
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "inherit",
});

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(500);
  try {
    const r = await fetch(`${BASE}/api/health`);
    up = r.ok;
  } catch { /* not listening yet */ }
}
if (!up) {
  console.error("Server did not become healthy in 20s.");
  server.kill();
  process.exit(1);
}

let failed = false;
try {
  const { runConversationTest } = await import("./api-test-lib.mjs");
  await runConversationTest(BASE);
} catch (err) {
  console.error("✗ Test failed:", err.message);
  failed = true;
} finally {
  server.kill();
  // Give the child a moment to release the port before exiting.
  await sleep(300);
  process.exit(failed ? 1 : 0);
}
