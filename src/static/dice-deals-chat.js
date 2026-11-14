/* =====================================================================
 * Dice Deals – Chat
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

/* ── Chat ──────────────────────────────────────────────── */
function toggleChat() {
    chatOpen = true;
    chatUnread = 0;
    const badge = document.getElementById("chat-badge");
    if (badge) badge.style.display = "none";
    document.getElementById("chat-btn")?.classList.add("active");
    const section = document.getElementById("chat-section");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const input = document.getElementById("chat-input");
    if (input) input.focus();
    scrollChat();
}
function renderChat(s) {
    if (!s.chat_messages) return;
    const container = document.getElementById("chat-msgs");
    if (!container) return;
    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    container.innerHTML = "";
    s.chat_messages.forEach(msg => {
        const el = document.createElement("div");
        if (msg.type === "system") {
            el.className = "chat-msg sys-msg";
            el.textContent = `\u{1F514} ${msg.text}`;
        } else {
            el.className = "chat-msg" + (msg.from === ME ? " mine" : "");
            el.innerHTML = `<span class="chat-who" style="color:${PCOLORS[msg.from_color] || "#888"}">${avatarContent(s.players?.find(p => p.username === msg.from))} ${msg.from}</span>${escapeHtml(msg.text)}`;
        }
        container.appendChild(el);
    });
    prevChatLen = s.chat_messages.length;
    chatUnread = 0;
    const badge = document.getElementById("chat-badge");
    if (badge) badge.style.display = "none";
    if (wasAtBottom) scrollChat();
}
function scrollChat(){ const c=document.getElementById("chat-msgs"); if(c) c.scrollTop=c.scrollHeight; }
function escapeHtml(s){ const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
async function sendChat(){ const input=document.getElementById("chat-input"); const text=input.value.trim(); if(!text) return; input.value=""; const res=await fetch("/api/game/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})}); if(!res.ok) return; GS=await res.json(); renderChat(GS); scrollChat(); }
