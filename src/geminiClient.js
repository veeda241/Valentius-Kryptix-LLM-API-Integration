/**
 * Thin wrapper around the official Google GenAI SDK (@google/genai).
 * - API key comes ONLY from the environment (never hardcoded).
 * - Every call has a hard timeout guard.
 * - All failures are normalised into a ChatError with a clear, user-facing
 *   message (invalid key / rate limit / timeout / network / bad response).
 */

import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30_000;

let client = null;
if (API_KEY && API_KEY !== "your-gemini-api-key-here") {
  client = new GoogleGenAI({
    apiKey: API_KEY,
    httpOptions: { timeout: TIMEOUT_MS },
  });
}

export class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status; // HTTP-like code the frontend should receive
  }
}

/** Classify any SDK/network failure into a clean ChatError. */
function toChatError(err) {
  if (err instanceof ChatError) return err;
  const msg = String(err?.message ?? err);
  const status = err?.status ?? err?.response?.status;

  if (status === 401 || status === 403 || /api key not valid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return new ChatError(502, "The server's Gemini API key is missing or invalid. Check the GEMINI_API_KEY environment variable.");
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(msg)) {
    const retry = /retry in ([\dhms .]+)/i.exec(msg)?.[1];
    return new ChatError(429, `Gemini rate limit / free-tier daily quota reached.${retry ? ` The API suggests retrying in ~${retry.trim()}.` : " Please wait a few seconds and try again."}`);
  }
  if (/timeout|timed out|deadline|ETIMEDOUT|ABORTED/i.test(msg)) {
    return new ChatError(504, "The Gemini API took too long to respond (timeout). Please try again.");
  }
  if (status === 503 || /UNAVAILABLE|high demand/i.test(msg)) {
    return new ChatError(503, "The Gemini model is temporarily overloaded (503). This is usually brief — please try again in a moment.");
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network|fetch failed|socket hang up/i.test(msg)) {
    return new ChatError(502, "Could not reach the Gemini API — it looks like a network problem. Check your internet connection.");
  }
  if (status === 404 || /not found/i.test(msg)) {
    return new ChatError(502, `The configured Gemini model was not found ("${MODEL}"). Set GEMINI_MODEL in .env to a valid model.`);
  }
  return new ChatError(500, "Unexpected error while calling the Gemini API. Please try again.");
}

/**
 * Core call: send system instruction + contents to Gemini, return reply text.
 * Protected by a Promise.race timeout in addition to the SDK's own one.
 */
export async function generate({ systemInstruction, contents }) {
  if (!client) {
    throw new ChatError(
      500,
      "GEMINI_API_KEY is not configured. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey"
    );
  }

  const withTimeout = (promise) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(new ChatError(504, `Gemini API call exceeded ${TIMEOUT_MS / 1000}s timeout.`)),
          TIMEOUT_MS
        );
        t.unref(); // don't keep the process alive just for the guard
      }),
    ]);

  let response;
  try {
    response = await withTimeout(
      client.models.generateContent({
        model: MODEL,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      })
    );
  } catch (err) {
    // Keep the raw error in server logs for debugging; the user only ever
    // sees the clean, classified ChatError message.
    console.error("[gemini] raw failure:", err?.message ?? err, "| status:", err?.status ?? "n/a", "| cause:", err?.cause?.message ?? err?.cause ?? "n/a");
    throw toChatError(err);
  }

  const text = typeof response?.text === "string" ? response.text : response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text || !text.trim()) {
    throw new ChatError(502, "Gemini returned an empty or invalid response. Please try again.");
  }
  return text.trim();
}

export const modelInfo = { model: MODEL, keyConfigured: Boolean(client), timeoutMs: TIMEOUT_MS };
