/* =====================================================================
 * Dice Deals – Overlay-Helper, Toast & Geld-Float
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

/* ── Overlay-Helper ────────────────────────────────────── */
function openOv(id) { document.getElementById(id).classList.add("show"); }
function closeOv(id) { document.getElementById(id).classList.remove("show"); }

function toggleFullscreen() {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
        if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
    }
}
document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("fullscreen-btn");
    if (btn) btn.textContent = document.fullscreenElement ? "\u26F6 Vollbild beenden" : "\u26F6 Vollbild";
});
document.querySelectorAll(".overlay, .kicked-overlay, .winner-overlay").forEach(ov => ov.addEventListener("click", e => { if(e.target===ov) ov.classList.remove("show"); }));

function showKickedScreen() {
    document.getElementById("kicked-overlay").classList.add("show");
    if (pollTm) clearInterval(pollTm);
}

function checkIfKicked(s) {
    if (!s) return false;
    const me = s.players?.find(p => p.username === ME);
    if (!me) { showKickedScreen(); return true; }
    if (me.is_bankrupt && me.is_disconnected) { showKickedScreen(); return true; }
    return false;
}

/* ── Toast ─────────────────────────────────────────────── */
function toast(icon, text) {
    document.getElementById("toast-icon").textContent = icon;
    document.getElementById("toast-text").textContent = text;
    const t = document.getElementById("toast");
    t.classList.add("show");
    clearTimeout(toastTm);
    toastTm = setTimeout(() => t.classList.remove("show"), 3500);
}

/* ── Geld-Float Animation ──────────────────────────────── */
function spawnMoneyFloat(x, y, amount) {
    const el = document.createElement("div");
    el.className = "money-float " + (amount >= 0 ? "positive" : "negative");
    el.textContent = (amount >= 0 ? "+" : "") + amount.toLocaleString("de-DE") + " €";
    el.style.left = x + "px";
    el.style.top  = y + "px";
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
}
function spawnMoneyFloatNearPlayer(username, amount) {
    const playerList = document.getElementById("players-list");
    if (!playerList) return;
    const cards = playerList.querySelectorAll(".player-card");
    cards.forEach(card => {
        if (card.textContent.includes(username)) {
            const rect = card.getBoundingClientRect();
            spawnMoneyFloat(rect.left + 60, rect.top + 10, amount);
        }
    });
}
