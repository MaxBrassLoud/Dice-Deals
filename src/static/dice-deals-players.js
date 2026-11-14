/* =====================================================================
 * Dice Deals – Spieler-Karten
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

function flashPlayerCard(username, type) {
    const playerList = document.getElementById("players-list");
    if (!playerList) return;
    const cards = playerList.querySelectorAll(".player-card");
    cards.forEach(card => {
        if (card.textContent.includes(username)) {
            card.classList.remove("flash-green","flash-red","flash-shake","going-bankrupt");
            void card.offsetWidth;
            if (type === "bankrupt") card.classList.add("going-bankrupt");
            else {
                card.classList.add("flash-" + type);
                card.addEventListener("animationend", () => card.classList.remove("flash-green","flash-red","flash-shake"), {once:true});
            }
        }
    });
}
/* ── Spieler-Rendering ─────────────────────────────────── */
function renderPlayers(s) {
    const list = document.getElementById("players-list");
    list.innerHTML = "";
    if(!s?.players?.length) { list.innerHTML=`<p style="color:var(--text2);font-size:12px;">Noch keine Spieler.</p>`; return; }
    const hostName = s.host_username || "";
    s.players.forEach(p => {
        const isActive = p.username===s.current_player;
        const pc = Array.isArray(p.properties)?p.properties.length:0;
        const jailCards = p.get_out_of_jail_cards || 0;
        const isDisconn = p.is_disconnected || false;
        const isHostPlayer = p.username === hostName;
        const card = document.createElement("div");
        card.className=`player-card${isActive?" active":""}${p.is_bankrupt?" bankrupt":""}${isDisconn?" disconnected":""}`;
        const tokColor = PCOLORS[p.color] || p.avatar_color || '#888';
        card.style.setProperty("--pc", tokColor);
        if (/^#[0-9a-fA-F]{6}$/.test(tokColor)) card.style.setProperty("--pc-soft", tokColor + "1a");
        const disconnTag = isDisconn ? '<span class="disconn-badge">Offline</span>' : '';
        const hostTag = isHostPlayer ? '<span class="host-badge">HOST</span>' : '';
        const propChips = (p.properties || []).map(pr => {
            const houseInfo = pr.houses === 5 ? "Hotel" : pr.houses > 0 ? `${pr.houses} Haus/H\u00e4user` : "";
            const chipTitle = `${pr.name}${houseInfo ? " - " + houseInfo : ""}`;
            return `<span class="prop-chip-mini" style="--chip:${CMAP[pr.color_group] || "#888"}" title="${chipTitle}"></span>`;
        }).join("");
        card.innerHTML=`<div class="player-avatar" style="background:linear-gradient(135deg,${PCOLORS[p.color]||p.avatar_color||'#888'},${(PCOLORS[p.color]||p.avatar_color||'#888')}cc);font-size:16px;">${avatarContent(p)}</div>
            <div style="flex:1;min-width:0;"><div class="player-name">${p.username}${p.username===ME?' <span style="font-size:10px;color:var(--text2);font-weight:400">(Du)</span>':''}${hostTag}${p.in_jail?' ⛓️':''}${disconnTag}</div>
            <div class="player-money">${p.money.toLocaleString("de-DE")} €</div>
            <div class="player-props">${pc} Grundstück${pc!==1?"e":""}${jailCards>0?` &middot; <span style="color:var(--accent2)">🃏 ${jailCards}x</span>`:""}</div><div class="prop-chips">${propChips}</div></div>${isActive&&!isDisconn?'<div class="turn-badge">AM ZUG</div>':''}`;
        if(IS_HOST && p.username !== ME && !isDisconn && !p.is_bankrupt) {
            const kickBtn = document.createElement("button");
            kickBtn.className = "kick-btn";
            kickBtn.textContent = "✕ Kicken";
            kickBtn.onclick = (e) => { e.stopPropagation(); kickPlayer(p.username); };
            card.appendChild(kickBtn);
        }
        list.appendChild(card);
    });
}
