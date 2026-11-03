/**
 * Frontend logic — talks to POST /api/chat.
 * Conversation identity is a UUID kept in localStorage, so a page refresh
 * resumes the SAME server-side conversation (multi-turn history persists).
 * Errors from the backend are rendered as clear red bubbles — never a
 * broken UI.
 */

const els = {
  messages: document.getElementById("messages"),
  form: document.getElementById("chatForm"),
  input: document.getElementById("msgInput"),
  send: document.getElementById("sendBtn"),
  reset: document.getElementById("resetBtn"),
  dot: document.getElementById("statusDot"),
  modelLabel: document.getElementById("modelLabel"),
  contextBar: document.getElementById("contextBar"),
  cbTurn: document.getElementById("cbTurn"),
  cbWindow: document.getElementById("cbWindow"),
  cbTotal: document.getElementById("cbTotal"),
  cbSummary: document.getElementById("cbSummary"),
};

// --- conversation id (persisted across refreshes) ---
let conversationId = localStorage.getItem("kryptix_conversationId");
if (!conversationId) {
  conversationId = crypto.randomUUID();
  localStorage.setItem("kryptix_conversationId", conversationId);
}

function addBubble(role, text, isError = false) {
  const div = document.createElement("div");
  div.className = `msg ${role}${isError ? " error" : ""}`;
  const label = document.createElement("span");
  label.className = "who";
  label.textContent = role === "user" ? "You" : isError ? "System" : "Kryptix";
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text; // textContent, not innerHTML — no XSS
  div.append(label, body);
  els.messages.append(div);
  els.messages.scrollTop = els.messages.scrollHeight;
  return div;
}

function setBusy(busy) {
  els.send.disabled = busy;
  els.input.disabled = busy;
  els.dot.classList.toggle("pulse", busy);
}

function updateContextBar(meta) {
  els.contextBar.hidden = false;
  els.cbTurn.textContent = Math.ceil(meta.totalMessages / 2);
  els.cbWindow.textContent = meta.windowMessages;
  els.cbTotal.textContent = meta.totalMessages;
  els.cbSummary.textContent = meta.summaryActive ? (meta.summaryJustUpdated ? "updated ⟳" : "active") : "inactive";
}

async function send(text) {
  const typing = addBubble("model", "…");
  typing.classList.add("typing");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
      signal: AbortSignal.timeout(60_000), // client-side timeout too
    });
    let data;
    try { data = await res.json(); } catch { data = { error: `Server returned an invalid response (HTTP ${res.status}).` }; }
    typing.remove();
    if (!res.ok || data.error) {
      addBubble("model", data.error || "Something went wrong. Please try again.", true);
      els.dot.classList.add("bad");
    } else {
      if (data.conversationId && typeof data.conversationId === "string") {
        conversationId = data.conversationId;
        localStorage.setItem("kryptix_conversationId", conversationId);
      }
      addBubble("model", data.reply);
      if (data.meta) updateContextBar(data.meta);
      els.dot.classList.remove("bad");
    }
  } catch (err) {
    typing.remove();
    const msg = err?.name === "TimeoutError"
      ? "The server took too long to answer. Please try again."
      : "Could not reach the backend server. Is it running? (npm start)";
    addBubble("model", msg, true);
    els.dot.classList.add("bad");
  } finally {
    setBusy(false);
    els.input.focus();
  }
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  els.input.value = "";
  addBubble("user", text);
  setBusy(true);
  send(text);
});

els.reset.addEventListener("click", () => {
  conversationId = crypto.randomUUID();
  localStorage.setItem("kryptix_conversationId", conversationId);
  els.messages.innerHTML = "";
  els.contextBar.hidden = true;
  addBubble("model", "New conversation started. What's on your mind?");
});

// --- boot: check health, greet or surface config problems clearly ---
addBubble("model", "Hey! I'm Kryptix. Tell me your name and something about yourself — I'll prove I remember it several messages later.");
(async () => {
  try {
    const res = await fetch("/api/health");
    const h = await res.json();
    els.modelLabel.textContent = `${h.model} · context-managed`;
    els.dot.classList.toggle("bad", !h.apiKeyConfigured);
    if (!h.apiKeyConfigured) {
      addBubble("model", "⚠ The server has no GEMINI_API_KEY configured yet — messages will fail until .env is set up.", true);
    }
  } catch {
    els.dot.classList.add("bad");
  }
})();
