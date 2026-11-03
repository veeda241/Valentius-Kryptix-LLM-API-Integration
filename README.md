# Valentius-Kryptix-LLM-API-Integration

A chatbot backed by a **real LLM API (Google Gemini)** with proper context window management, so it holds a genuine multi-turn conversation instead of forgetting everything after one reply.

Built with **Node.js + Express + the official Google GenAI SDK (`@google/genai`)**. Ships with **two usable interfaces**: a web chat UI and a terminal CLI.

---

## ✅ Requirements coverage

| Requirement | Where it's implemented |
|---|---|
| Working backend endpoint calling a real LLM API | `server.js` → `POST /api/chat` → `src/geminiClient.js` (Gemini `generateContent`) |
| Multi-turn history per conversation | `src/chatService.js` — in-memory store keyed by `conversationId`; full message list is sent with every request. The web UI persists its conversation id in `localStorage`, so even a page refresh resumes the same conversation. |
| Context window management (**two** real strategies) | `src/contextManager.js` — ① **Truncation**: only the last `MAX_WINDOW_MESSAGES` (default 12) turns are sent raw. ② **Running summary** (stretch goal): everything truncated out of the window is compressed by the LLM into a rolling summary that is **prepended to the system prompt** on every call. Facts from 10+ messages ago survive truncation. |
| System prompt with a defined role/personality | `src/systemPrompt.js` — "Kryptix": warm, concise, uses your name, forbidden from leaking API keys, instructed to trust the running summary as memory. Sent as Gemini's `systemInstruction` on every request. |
| Error handling (API failure / timeout) | `src/geminiClient.js` classifies every failure into a clean user-facing message with a proper HTTP status: invalid/missing key (502), rate limit / free-tier quota incl. retry delay (429), timeout (504), model overloaded (503), network failure (502), model not found (502), empty LLM response (502). Plus: 30 s hard timeout guard, failed turns rolled back from history, malformed-JSON / oversized-body / unknown-route all return clean JSON (never HTML stack traces), and the web UI shows errors as red "System" bubbles instead of breaking. |
| API keys in environment variables, never committed | `.env` is in `.gitignore` **before the first commit**; only `.env.example` (placeholder) is tracked. The key is read via `dotenv` and passed only to the SDK — the `/api/health` endpoint reports *whether* a key is configured, never the key itself. |

## 🧭 Proof it actually works (verified live against the Gemini API)

A 6-turn conversation (run with `npm test`) showed the bot recalling facts stated 4+ turns earlier:

```
You    > Hi! My name is Vyas and my lucky number is 42.
You    > I have a cat named Pixel and my favourite colour is teal.
You    > What's the capital of France?
You    > Can you remind me what pets I have and what my favourite colour is?
Kryptix> You have a cat named Pixel, Vyas, and your favourite colour is teal! …
You    > One more thing — my PIN for the gym locker is 7-3-9. Please don't forget it.
You    > Memory test: what is my name, my lucky number, my cat's name, my
         favourite colour, and my gym PIN? One short sentence.
Kryptix> You are Vyas, your lucky number is 42, your cat is Pixel, your
         favourite colour is teal, and your gym PIN is 7-3-9.
```

The summarisation strategy was verified separately with a deliberately tiny window (`MAX_WINDOW_MESSAGES=4`, run with `npm run test:summary`): after the early messages were **truncated out of the window**, the bot still answered *"Your home town is Pune, and your secret code word is mango-lantern!"* — because those facts lived on in the server-side running summary:

```
- Home town: Pune
- Secret code word: mango-lantern
- Previous question: Tallest mountain in the world (Mount Everest)
```

Error handling was also exercised for real: when the free-tier daily quota fired, the API returned a clean `429 – Gemini rate limit / free-tier daily quota reached…` JSON message and the app kept working (no crash, no broken UI).

## 🚀 Quick start

```bash
# 1. Install
npm install

# 2. Configure your key (get a free one at https://aistudio.google.com/apikey)
copy .env.example .env      # Windows (Ctrl+C style: use notepad to edit)
#    → set GEMINI_API_KEY=your_real_key

# 3a. Web UI  →  open http://localhost:3000
npm start

# 3b. Or use the terminal
npm run cli                 # /context shows window+summary stats, /reset, /exit

# 4. Verify end-to-end (boots its own server on port 3111)
npm test                    # 6-turn context-persistence + error-handling test
npm run test:summary        # proves truncation + running summary
```

## 🏗 Architecture

```
public/index.html + app.js + style.css   Web chat UI (vanilla JS, localStorage session id)
            │  fetch POST /api/chat { conversationId, message }
            ▼
server.js                                Express backend (validation, JSON error contract)
            ▼
src/chatService.js                       Per-conversation store (history + running summary, TTL cleanup)
     ├─▶ src/contextManager.js           Strategy: sliding window (truncation) + LLM running summary
     └─▶ src/geminiClient.js             @google/genai SDK, timeout guard, error classification
                ▲
cli.js          ┘                         CLI reuses the exact same service modules
src/systemPrompt.js                       "Kryptix" persona, sent as systemInstruction every call
test/                                     Live end-to-end proofs (conversation, summary, error paths)
```

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | `{ conversationId?, message }` → `{ reply, meta: { totalMessages, windowMessages, summaryActive, summaryJustUpdated } }` or `{ error }` with a meaningful status code |
| `GET /api/health` | model + whether the key is configured (never the key itself) |
| `GET /api/history?conversationId=…` | full stored history + current running summary |

## 🔒 Security notes

- Real key lives only in `.env` (gitignored) or your shell environment; `.env.example` contains a placeholder.
- The key never reaches the browser — all Gemini calls happen server-side.
- Messages are rendered with `textContent` (no `innerHTML`) to avoid XSS.
- Request body size limited (64 KB) and message length capped (4000 chars).
