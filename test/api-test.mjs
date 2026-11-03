/**
 * API smoke test against an ALREADY RUNNING server (npm start).
 * For the one-shot version that boots the server too: node test/run-e2e.mjs
 */
import { runConversationTest } from "./api-test-lib.mjs";

const BASE = process.env.TEST_BASE || "http://localhost:3000";
try {
  await runConversationTest(BASE);
} catch (err) {
  console.error("✗ Test failed:", err.message);
  process.exit(1);
}
