/* =====================================================================
 * Dice Deals – Chance-/Gemeinschaftskarten-Popup
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

/* ── Karten-Popup ──────────────────────────────────────── */
function checkPendingCard(s) {
    const overlay = document.getElementById("ov-card");
    if (!s.pending_card) {
        if (overlay.classList.contains("show")) closeOv("ov-card");
        delete overlay.dataset.cardKey;
        return;
    }
    const c = s.pending_card;
    const isMine = c.player === ME;
    const cardKey = `${c.player}|${c.card_type}|${c.text}`;
    if (overlay.classList.contains("show") && overlay.dataset.cardKey === cardKey) return;
    overlay.dataset.cardKey = cardKey;

    const isChance = c.card_type === "chance";
    const popup = document.getElementById("card-popup-inner");
    popup.className = `card-popup ${isChance ? "chance" : "community"}${isMine ? "" : " spectator"}`;
    document.getElementById("card-type-label").textContent = isChance ? "🃏 Chance" : "📮 Gemeinschaft";
    const CARD_ICONS = { money: v => v > 0 ? "💰" : "💸", goto: () => "🏁", jail: () => "⛓️", jail_card: () => "🃏", move: () => "🔀", next_station: () => "🚂", casino: () => "🎰", property_tax: () => "🏛️", repair: () => "🔧", money_per_property: () => "💰" };
    document.getElementById("card-icon").textContent = CARD_ICONS[c.action] ? CARD_ICONS[c.action](c.value) : "🃏";
    document.getElementById("card-text").textContent = c.text;
    const effectEl = document.getElementById("card-effect");
    let effectText = "";
    if (c.action === "money") effectText = c.value > 0 ? `+${c.value} €` : `${c.value} €`;
    else if (c.action === "goto") effectText = "→ Gehe zu Los";
    else if (c.action === "jail") effectText = "→ Gehe ins Gefängnis";
    else if (c.action === "jail_card") effectText = "→ Gefängnisfreikarte";
    else if (c.action === "move") effectText = `${c.value > 0 ? "+" : ""}${c.value} Felder`;
    else if (c.action === "next_station") effectText = "→ Nächste Station";
    else if (c.action === "casino") effectText = "→ Casino-Spiel";
    else if (c.action === "property_tax") effectText = "→ Steuer für Gebäude";
    else if (c.action === "repair") effectText = "→ Reparaturkosten";
    else if (c.action === "money_per_property") effectText = `→ +${c.value} € pro Grundstück`;
    effectEl.textContent = effectText;
    effectEl.className = `card-popup-effect ${c.action==="money"?(c.value>=0?"positive":"negative"):(c.action==="jail"||c.action==="property_tax"||c.action==="repair"?"negative":"positive")}`;

    const ownerEl = document.getElementById("card-owner-label");
    if (ownerEl) ownerEl.textContent = isMine ? "Deine Karte" : `${c.player} zieht eine Karte`;
    const btn = document.getElementById("card-ok-btn");
    if (isMine) {
        if (c.action === "casino") {
            btn.textContent = "🎰 Zum Casino";
            btn.disabled = false;
            btn.onclick = async () => {
                await confirmCard();          // ← räumt pending_card serverseitig auf
                openCasino(c.game_type);
            };
        } else {
            btn.textContent = "OK — Verstanden";
            btn.disabled = false;
            btn.onclick = confirmCard;
        }
        btn.style.display = "block";
    } else {
        btn.disabled = true;
        btn.style.display = "block";
        btn.textContent = `${c.player} zieht… (nur er kann bestätigen)`;
    }
    openOv("ov-card");
}
