/**
 * Conversation store + chat orchestration, shared by the HTTP server and the
 * CLI so both exercise exactly the same logic.
 *
 * Per conversationId we keep:
 *   history  – every message ever exchanged (source of truth)
 *   summary  – running summary of everything truncated out of the window
 *
 * sendTurn(): append user msg -> build truncated window (+summary) -> call
 * Gemini -> append reply -> fold evicted messages into the summary.
 */

import { randomUUID } from "node:crypto";
import { generate, ChatError } from "./geminiClient.js";
import { buildRequest, summarise } from "./contextManager.js";

const conversations = new Map(); // id -> { history, summary, lastSeen }
const IDLE_TTL_MS = 1000 * 60 * 60; // forget conversations idle for 1h

function getConversation(id) {
  let c = conversations.get(id);
  if (!c) {
    c = { history: [], summary: null, lastSeen: Date.now() };
    conversations.set(id, c);
  }
  c.lastSeen = Date.now();
  return c;
}

// Periodic cleanup so the in-memory store can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of conversations) {
    if (now - c.lastSeen > IDLE_TTL_MS) conversations.delete(id);
  }
}, 5 * 60 * 1000).unref();

export function newConversationId() {
  return randomUUID();
}

export async function sendTurn(conversationId, userText) {
  const conv = getConversation(conversationId);
  conv.history.push({ role: "user", text: userText });

  const { systemInstruction, contents, evicted, windowSize } = buildRequest(conv);

  let reply;
  try {
    reply = await generate({ systemInstruction, contents });
  } catch (err) {
    // Roll back the failed user turn so history stays valid user/model pairs.
    conv.history.pop();
    throw err;
  }

  conv.history.push({ role: "model", text: reply });

  // Stretch goal path: compress everything that fell out of the window into
  // a running summary. Failure here must NOT break the user's chat turn.
  let summarised = false;
  if (evicted.length > 0) {
    try {
      conv.summary = await summarise(evicted, conv.summary, (prompt) =>
        generate({ systemInstruction: "You are a precise conversation-summarisation engine.", contents: [{ role: "user", parts: [{ text: prompt }] }] })
      );
      summarised = true;
    } catch {
      // Summary generation is best-effort; truncation still protects the window.
    }
  }

  return {
    reply,
    meta: {
      conversationId,
      totalMessages: conv.history.length,
      windowMessages: windowSize,
      summaryActive: Boolean(conv.summary),
      summaryJustUpdated: summarised,
    },
  };
}

export function getHistory(conversationId) {
  const c = conversations.get(conversationId);
  return c ? { history: c.history, summary: c.summary } : { history: [], summary: null };
}

export function resetConversation(conversationId) {
  conversations.delete(conversationId);
}

export { ChatError };
