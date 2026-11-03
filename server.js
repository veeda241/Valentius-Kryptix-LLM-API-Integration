/**
 * HTTP backend — Express server exposing the chatbot.
 *
 *   POST /api/chat    { conversationId?, message }
 *                   -> 200 { reply, meta } | { error, meta } on failure
 *   GET  /api/history?conversationId=...  -> full stored history + summary
 *   GET  /api/health  -> key/model status (never leaks the key itself)
 *
 * Also serves the static chat UI from /public.
 */

import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { sendTurn, getHistory, newConversationId } from "./src/chatService.js";
import { modelInfo, ChatError } from "./src/geminiClient.js";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(fileURLToPath(new URL("./public", import.meta.url))));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: modelInfo.model,
    apiKeyConfigured: modelInfo.keyConfigured,
    timeoutMs: modelInfo.timeoutMs,
  });
});

app.get("/api/history", (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) return res.status(400).json({ error: "Missing conversationId." });
  const { history, summary } = getHistory(String(conversationId).slice(0, 64));
  res.json({ history, summary });
});

app.post("/api/chat", async (req, res) => {
  const { conversationId, message } = req.body ?? {};

  // --- input validation: fail fast with a clear message, never crash ---
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Please send a non-empty message." });
  }
  if (message.length > 4000) {
    return res.status(400).json({ error: "Message too long — keep it under 4000 characters." });
  }
  const id = typeof conversationId === "string" && conversationId.trim() ? conversationId.slice(0, 64) : newConversationId();

  try {
    const result = await sendTurn(id, message.trim());
    res.json(result);
  } catch (err) {
    // Error handling contract: the client always gets a readable message +
    // a sensible HTTP status, never a stack trace or a broken UI.
    const chatErr = err instanceof ChatError ? err : new ChatError(500, "Something went wrong on our side. Please try again.");
    if (!(err instanceof ChatError)) console.error("Unhandled chat error:", err);
    res.status(chatErr.status).json({ error: chatErr.message, conversationId: id });
  }
});

// 404 for unknown API routes (JSON, so the frontend can handle it cleanly)
app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown API endpoint." }));

// Malformed JSON bodies etc. must also come back as clean JSON, never HTML.
app.use((err, _req, res, next) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large." });
  }
  console.error("Unhandled server error:", err);
  res.status(500).json({ error: "Internal server error. Please try again." });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Kryptix chatbot running at http://localhost:${PORT}`);
  console.log(`  model: ${modelInfo.model} | api key configured: ${modelInfo.keyConfigured}`);
  if (!modelInfo.keyConfigured) {
    console.log("  ⚠  No GEMINI_API_KEY found — copy .env.example to .env and add your key, then restart.");
  }
});
