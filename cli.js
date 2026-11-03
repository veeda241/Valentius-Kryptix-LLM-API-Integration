/**
 * CLI interface — talks to the SAME chat service module the backend uses,
 * so you can test multi-turn context without opening a browser.
 *
 *   node cli.js            start/resume a conversation
 *   Commands: /reset (new conversation), /context (show window stats), /exit
 */

import "dotenv/config";
import readline from "node:readline";
import { sendTurn, getHistory, newConversationId } from "./src/chatService.js";
import { modelInfo } from "./src/geminiClient.js";

let conversationId = newConversationId();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

console.log("─".repeat(56));
console.log("  Kryptix CLI — Google Gemini multi-turn chatbot");
console.log(`  model: ${modelInfo.model} | api key: ${modelInfo.keyConfigured ? "configured" : "MISSING (set GEMINI_API_KEY in .env)"}`);
console.log("  /reset = new chat · /context = window stats · /exit = quit");
console.log("─".repeat(56));

async function main() {
  while (true) {
    const input = (await ask("\nYou  > ")).trim();
    if (!input) continue;

    if (input === "/exit") break;
    if (input === "/reset") {
      conversationId = newConversationId();
      console.log("(started a fresh conversation)");
      continue;
    }
    if (input === "/context") {
      const { history, summary } = getHistory(conversationId);
      console.log(`total messages: ${history.length} · window: last ${Math.min(history.length, Number(process.env.MAX_WINDOW_MESSAGES) || 12)} · summary active: ${Boolean(summary)}`);
      if (summary) console.log(`\nRunning summary:\n${summary}`);
      continue;
    }

    process.stdout.write("Kryptix > ");
    try {
      const { reply, meta } = await sendTurn(conversationId, input);
      console.log(reply);
      const tag = meta.summaryJustUpdated ? " · summary updated ⟳" : meta.summaryActive ? " · summary active" : "";
      console.log(`  [turn ${Math.ceil(meta.totalMessages / 2)} · window ${meta.windowMessages}/${meta.totalMessages} msgs${tag}]`);
    } catch (err) {
      // Error handling: clear message, keep the CLI alive.
      console.log(`\n  ✗ ${err.message}`);
    }
  }
  rl.close();
  console.log("bye 👋");
}

main();
