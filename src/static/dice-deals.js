/* =====================================================================
 * Dice Deals – Spiellogik (Frontend)
 * Ausgelagert aus dice-deals.html zur besseren Wartbarkeit.
 * ===================================================================== */

const ME = window.DICE_DEALS_CONFIG.username;

const CMAP = { brown:"#795548", lightblue:"#29b6f6", pink:"#ec407a", orange:"#ff7043", red:"#ef5350", yellow:"#ffd740", green:"#66bb6a", darkblue:"#1565c0", station:"#78909c", utility:"#ab47bc", special:"transparent" };
const PCOLORS = {
    blue:"#58a6ff", red:"#f85149", green:"#3fb950", yellow:"#e3b341",
    purple:"#bc8cff", orange:"#fb923c", pink:"#f778ba", teal:"#2dd4bf",
    lime:"#a3e635", white:"#f1f5f9", brown:"#a16207", cyan:"#22d3ee"
};
const AVATAR_COLORS = {
    blue:"#58a6ff", red:"#f85149", green:"#3fb950", yellow:"#e3b341",
    purple:"#bc8cff", orange:"#fb923c", pink:"#f778ba", teal:"#2dd4bf",
    lime:"#a3e635", white:"#f1f5f9", brown:"#a16207", cyan:"#22d3ee"
};
const DICE_FACES = ["","⚀","⚁","⚂","⚃","⚄","⚅"];
const COLORS = ["blue","red","green","yellow","purple","orange","pink","teal","lime","white","brown","cyan"];

function avatarContent(p) {
    if (p && p.avatar_url) return `<img src="${p.avatar_url}" alt="">`;
    return (p && p.avatar_emoji) || "";
}

/* ── Globaler Zustand ───────────────────────────────────── */
let GS = null;
let IS_HOST = false;
let selColor = "blue";
let toastTm = null;
let pollTm = null;
let gameStateEtag = null;
let stateRequestInFlight = false;
let chatOpen = true;
let chatUnread = 0;
let prevChatLen = 0;

let pendingRent = null;
let selOfferProp = null;
let incomingRentOffer = null;
let pendingTax = null;
let tradeTarget = null;
let myOffer = { props:[], money:0 };
let theirOffer = { props:[], money:0 };
let expandedProp = null;

let prevPositions = {};
let prevMoneys = {};
let prevEventType = null;
let oldState_bankruptMap = {};
let walkInProgress = false;
let winnerShown = false;
let turnTimerInterval = null;
let turnTimerDeadlineLocal = 0;
let turnTimerFired = false;

let casinoState = null;

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

/* ── Feld-Animationen ──────────────────────────────────── */
function getFieldEl(idx) { return document.querySelector(`.field[data-fi="${idx}"]`); }
function applyFieldClass(idx, cls, durationMs) {
    const el = getFieldEl(idx);
    if (!el) return;
    const ALL = ["step-through","step-start","step-arrive","step-arrive-rent","pass-go","anim-land","anim-rent","anim-buy","anim-jail"];
    ALL.forEach(c => el.classList.remove(c));
    void el.offsetWidth;
    el.classList.add(cls);
    if (durationMs) setTimeout(() => el.classList.remove(cls), durationMs);
    else el.addEventListener("animationend", () => el.classList.remove(cls), {once:true});
}
function pulseField(fieldIdx, type) {
    const map = { land:"anim-land", rent:"anim-rent", buy:"anim-buy", jail:"anim-jail" };
    applyFieldClass(fieldIdx, map[type] || "anim-land");
}
function animateToken(username, isNew) {
    document.querySelectorAll(`.token[title="${username}"]`).forEach(t => {
        const cls = isNew ? "just-added" : "moving";
        t.classList.remove("moving","just-added");
        void t.offsetWidth;
        t.classList.add(cls);
        t.addEventListener("animationend", () => t.classList.remove(cls), {once:true});
    });
}
async function walkToken(username, from, to, steps, passedGo, lastEventType) {
    if (from === to && steps !== 40) return;
    walkInProgress = true;
    applyFieldClass(from, "step-start", 1800);
    const path = [];
    let cur = from;
    for (let i = 0; i < steps; i++) {
        cur = (cur + 1) % 40;
        path.push(cur);
    }
    const STEP_MS = steps <= 6 ? 210 : steps <= 10 ? 160 : 120;
    const PAUSE_MS = 60;
    for (let i = 0; i < path.length; i++) {
        const fieldIdx = path[i];
        const isLast = i === path.length - 1;
        if (!isLast) applyFieldClass(fieldIdx, "step-through", STEP_MS + PAUSE_MS);
        if (fieldIdx === 0 && !isLast && passedGo) applyFieldClass(0, "pass-go", 600);
        await new Promise(r => setTimeout(r, STEP_MS + PAUSE_MS));
    }
    if (getFieldEl(from)) getFieldEl(from).classList.remove("step-start");
    const arriveType = (lastEventType === "rent") ? "step-arrive-rent" : "step-arrive";
    applyFieldClass(to, arriveType, 700);
    if (passedGo) applyFieldClass(0, "pass-go", 700);
    walkInProgress = false;
}
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
function animatePasch() {
    ["die1","die2"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove("pasch"); void el.offsetWidth; el.classList.add("pasch");
        el.addEventListener("animationend", () => el.classList.remove("pasch"), {once:true});
    });
}
function animateTurnChange() {
    const el = document.getElementById("status-box");
    if (!el) return;
    el.classList.remove("new-turn"); void el.offsetWidth; el.classList.add("new-turn");
    el.addEventListener("animationend", () => el.classList.remove("new-turn"), {once:true});
}
function animateParkingPot(won) {
    const el = document.querySelector(".parking-pot");
    if (!el || !won) return;
    el.classList.remove("winning"); void el.offsetWidth; el.classList.add("winning");
    el.addEventListener("animationend", () => el.classList.remove("winning"), {once:true});
}
function animateBuild(fieldIdx) {
    const fieldEl = document.querySelector(`.field[data-fi="${fieldIdx}"]`);
    if (!fieldEl) return;
    const bld = fieldEl.querySelector(".field-buildings");
    if (!bld) return;
    bld.classList.remove("just-built"); void bld.offsetWidth; bld.classList.add("just-built");
    bld.addEventListener("animationend", () => bld.classList.remove("just-built"), {once:true});
}
function runAnimations(newState, oldPositions, oldMoneys, oldEvent) {
    if (!newState?.players) return;
    const evt = newState.last_event;
    const evtType = evt?.type;
    newState.players.forEach(p => {
        const oldPos = oldPositions[p.username];
        const oldMoney = oldMoneys[p.username];
        if (oldPos !== undefined && oldPos !== p.position) {
            const mv = newState.last_move;
            if (mv && mv.player === p.username && mv.from === oldPos) {
                walkToken(p.username, mv.from, mv.to, mv.steps, mv.passed_go, evtType).then(() => animateToken(p.username, false));
            } else {
                animateToken(p.username, false);
                const fieldData = newState.board?.[p.position];
                if (fieldData) {
                    let pulseType = "land";
                    if (evtType === "rent" && evt?.to !== p.username) pulseType = "rent";
                    else if (p.position === 10 && p.in_jail) pulseType = "jail";
                    pulseField(p.position, pulseType);
                }
            }
        }
        if (oldMoney !== undefined && oldMoney !== p.money) {
            const diff = p.money - oldMoney;
            if (Math.abs(diff) >= 1) {
                spawnMoneyFloatNearPlayer(p.username, diff);
                flashPlayerCard(p.username, diff >= 0 ? "green" : "red");
            }
        }
        if (p.is_bankrupt && !oldState_bankruptMap[p.username]) flashPlayerCard(p.username, "bankrupt");
    });
    if (newState.dice && newState.dice[0] === newState.dice[1]) animatePasch();
    if (evtType === "free_parking" && evtType !== oldEvent) animateParkingPot(true);
    if (evtType === "build" && evt.field && evtType !== oldEvent) {
        const fi = newState.board?.findIndex(f => f.name === evt.field);
        if (fi !== -1) animateBuild(fi);
    }
    if (newState.current_player !== (window._prevCurrentPlayer)) {
        animateTurnChange();
        window._prevCurrentPlayer = newState.current_player;
    }
}

/* ── Board-Rendering ───────────────────────────────────── */
function edgeClass(row, col) {
    if (row === 10) return "edge-bottom";
    if (row === 0)  return "edge-top";
    if (col === 0)  return "edge-left";
    if (col === 10) return "edge-right";
    return "";
}
const CORNER_DATA = { 0:{icon:"🏁",label:"Los"}, 10:{icon:"🚔",label:"Gefängnis"}, 20:{icon:"🅿️",label:"Frei parken"}, 30:{icon:"👮",label:"Ins Gefängnis"} };
const TYPE_ICONS = { tax:"🏛️", chance:"🃏", community:"📮", station:"🚂", utility:"⚡" };

function renderBoard(s) {
    const bd = document.getElementById("board");
    bd.innerHTML = "";
    if (!s?.board || s.board.length !== 40) return;
    const pos = [];
    for(let i=0;i<=10;i++) pos.push({fi:i, col:10-i, row:10});
    for(let i=11;i<=19;i++) pos.push({fi:i, col:0, row:10-(i-10)});
    pos.push({fi:20, col:0, row:0});
    for(let i=21;i<=29;i++) pos.push({fi:i, col:i-20, row:0});
    pos.push({fi:30, col:10, row:0});
    for(let i=31;i<=39;i++) pos.push({fi:i, col:10, row:i-30});
    const cells = {};
    pos.forEach(({fi,col,row}) => cells[`${row}-${col}`] = fi);
    for(let row=0; row<=10; row++) {
        for(let col=0; col<=10; col++) {
            if(row>=1 && row<=9 && col>=1 && col<=9) continue;
            const fi = cells[`${row}-${col}`];
            if(fi === undefined) continue;
            const f = s.board[fi];
            const el = document.createElement("div");
            el.style.gridColumn = col + 1;
            el.style.gridRow    = row + 1;
            el.dataset.fi = fi;
            const isCorner = (fi === 0 || fi === 10 || fi === 20 || fi === 30);
            const edge = edgeClass(row, col);
            el.className = `field${isCorner ? " corner" : ""}${edge ? " " + edge : ""}`;
            const curP = s.players?.find(p => p.username === s.current_player);
            const isCurrentField = !!(curP && curP.position === fi && !curP.is_bankrupt);
            const isMyField = !!s.players?.some(p => p.username === ME && p.position === fi && !p.is_bankrupt);
            if (isCurrentField) el.classList.add("current-turn");
            if (isMyField) el.classList.add("my-position");
            if (isCorner) {
                const cd = CORNER_DATA[fi];
                el.innerHTML = `<div class="corner-icon">${cd.icon}</div><div class="corner-label">${cd.label}</div>`;
            } else {
                const bandColor = CMAP[f.color_group] || null;
                if (bandColor && bandColor !== "transparent") {
                    const band = document.createElement("div");
                    band.className = "color-band";
                    band.style.setProperty("--band-color", bandColor);
                    el.appendChild(band);
                }
                const body = document.createElement("div");
                body.className = "field-body";
                if (f.field_type !== "property" && TYPE_ICONS[f.field_type]) {
                    const ic = document.createElement("div");
                    ic.className = "field-icon";
                    ic.textContent = TYPE_ICONS[f.field_type];
                    body.appendChild(ic);
                }
                const nm = document.createElement("div");
                nm.className = "field-name";
                nm.textContent = f.name;
                body.appendChild(nm);
                if (f.price > 0) {
                    const pr = document.createElement("div");
                    pr.className = "field-price";
                    pr.textContent = f.price + "€";
                    body.appendChild(pr);
                }
                if (f.houses > 0) {
                    const bld = document.createElement("div");
                    bld.className = "field-buildings";
                    if (f.houses === 5) {
                        bld.textContent = "🏨";
                        bld.title = "Hotel";
                    } else {
                        bld.innerHTML = "🏠".repeat(f.houses) + `<span class="house-count">${f.houses}</span>`;
                        bld.title = `${f.houses} Haus${f.houses === 1 ? "" : "er"}`;
                    }
                    body.appendChild(bld);
                }
                el.appendChild(body);
                if (f.owner_color) {
                    const ownerColor = PCOLORS[f.owner_color] || "#888";
                    el.style.setProperty("--owner-color", ownerColor);
                    el.classList.add("owned");
                    const od = document.createElement("div");
                    od.className = "owner-dot";
                    od.style.background = ownerColor;
                    od.title = "Besitzer: " + f.owner;
                    el.appendChild(od);
                }
            }
            const here = s.players.filter(p => p.position === fi && !p.is_bankrupt);
            if (here.length) {
                const tr = document.createElement("div");
                tr.className = "tokens-row";
                if (isCorner) tr.style.cssText = "position:absolute;bottom:4px;left:0;right:0;";
                here.forEach(p => {
                    const t = document.createElement("div");
                    t.className = "token" + (p.username === s.current_player ? " highlight" : "") + (p.username === ME ? " me" : "");
                    t.style.background = `linear-gradient(135deg,${p.avatar_color||PCOLORS[p.color]||'#888'},${(p.avatar_color||PCOLORS[p.color]||'#888')}cc)`;
                    t.title = p.username;
                    t.innerHTML = avatarContent(p);
                    t.style.fontSize = 'clamp(4px,0.8cqi,10px)';
                    t.style.display = 'flex';
                    t.style.alignItems = 'center';
                    t.style.justifyContent = 'center';
                    tr.appendChild(t);
                });
                el.appendChild(tr);
            }
            el.addEventListener("mousemove", e => showTip(e, f, fi, s));
            el.addEventListener("mouseleave", () => { document.getElementById("tooltip").style.display = "none"; });
            el.addEventListener("touchstart", e => showTipTouch(e, f, fi, s), {passive:true});
            el.addEventListener("touchend", () => hideTipSoon());
            bd.appendChild(el);
        }
    }
    const center = document.createElement("div");
    center.className = "field center-area";
    center.style.gridColumn = "2/11";
    center.style.gridRow    = "2/11";
    const pips = s.players.map(p => `<div class="center-pip"><div class="cpip-dot" style="background:linear-gradient(135deg,${p.avatar_color||PCOLORS[p.color]||'#888'},${(p.avatar_color||PCOLORS[p.color]||'#888')}cc);font-size:10px;display:flex;align-items:center;justify-content:center;">${avatarContent(p)}</div>${p.username.substring(0,8)}</div>`).join("");
    const pot = s.free_parking_pot || 0;
    const potHTML = pot > 0 ? `<div class="parking-pot">🅿️ <span>${pot.toLocaleString("de-DE")} €</span></div>` : `<div class="parking-pot empty">🅿️ Topf leer</div>`;
    center.innerHTML = `<div class="center-logo"><div class="title">Dice Deals</div><div class="sub">${s.players.length} Spieler${s.current_player ? " · " + s.current_player + " am Zug" : ""}</div>${potHTML}<div class="player-pips">${pips}</div></div>`;
    bd.appendChild(center);
}

/* ── Tooltip ───────────────────────────────────────────── */
let tipHideTm = null;
function hideTipSoon() { clearTimeout(tipHideTm); tipHideTm = setTimeout(() => { document.getElementById("tooltip").style.display="none"; }, 1800); }
function showTipTouch(e, f, fi, s) { clearTimeout(tipHideTm); const touch = e.touches[0]; showTipAt(touch.clientX, touch.clientY, f, fi, s); }
function showTip(e,f,idx,s) { showTipAt(e.clientX, e.clientY, f, idx, s); }
function showTipAt(x, y, f, idx, s) {
    const sp = {0:"200 € beim Vorbeiziehen",10:"Besuch / Gefängnis",20:"Frei Parken",30:"Gehe ins Gefängnis"};
    let h = `<div class="tooltip-title">${f.name}</div>`;
    if(f.price > 0) {
        h += `<div class="tooltip-row"><span>Preis</span><span>${f.price} €</span></div>`;
        if(f.current_rent) h += `<div class="tooltip-row"><span>Miete</span><span>${f.current_rent} €</span></div>`;
        if(f.houses > 0) h += `<div class="tooltip-row"><span>Gebäude</span><span>${f.houses===5?"🏨 Hotel":"🏠 x"+f.houses}</span></div>`;
        h += f.owner ? `<div class="tooltip-row"><span>Besitzer</span><span>${f.owner}</span></div>` : `<div class="tooltip-row"><span>Status</span><span style="color:var(--accent2)">Kaufbar</span></div>`;
    } else if(sp[idx]) h += `<div style="color:var(--text2);font-size:11px;margin-top:4px;">${sp[idx]}</div>`;
    document.getElementById("tooltip").innerHTML = h;
    document.getElementById("tooltip").style.display = "block";
    const tw = 190, th = 120, vw = window.innerWidth, vh = window.innerHeight;
    document.getElementById("tooltip").style.left = Math.min(x + 14, vw - tw - 8) + "px";
    document.getElementById("tooltip").style.top  = Math.min(y - 10, vh - th - 8) + "px";
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
        const disconnTag = isDisconn ? '<span class="disconn-badge">Offline</span>' : '';
        const hostTag = isHostPlayer ? '<span class="host-badge">HOST</span>' : '';
        const propChips = (p.properties || []).map(pr => {
            const houseInfo = pr.houses === 5 ? "Hotel" : pr.houses > 0 ? `${pr.houses} Haus/H\u00e4user` : "";
            const chipTitle = `${pr.name}${houseInfo ? " - " + houseInfo : ""}`;
            return `<span class="prop-chip-mini" style="--chip:${CMAP[pr.color_group] || "#888"}" title="${chipTitle}"></span>`;
        }).join("");
        card.innerHTML=`<div class="player-avatar" style="background:linear-gradient(135deg,${p.avatar_color||PCOLORS[p.color]||'#888'},${(p.avatar_color||PCOLORS[p.color]||'#888')}cc);font-size:16px;">${avatarContent(p)}</div>
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

/* ── Eigene Grundstücke (Akkordeon) ────────────────────── */
function renderProps(s) {
    const panel = document.getElementById("props-panel");
    const list  = document.getElementById("props-list");
    const me    = s?.players?.find(p => p.username === ME);
    if (!me?.properties?.length) { panel.style.display = "none"; return; }
    panel.style.display = "block";
    list.innerHTML = "";
    list.className = "prop-list";
    const isMyTurn = s.current_player === ME;
    me.properties.forEach(prop => {
        const color = CMAP[prop.color_group] || "#888";
        const housesLabel = prop.houses === 5 ? "🏨 Hotel" : prop.houses > 0 ? "🏠".repeat(prop.houses) : "Unbebaut";
        const isOpen = expandedProp === prop.name;
        const mortgageVal = prop.mortgage_value || Math.floor((prop.price||0)/2);
        const repayVal    = prop.repay_value    || Math.round(mortgageVal * 1.1);
        const item = document.createElement("div");
        item.className = `prop-item${prop.is_mortgaged?" mortgaged":""}${isOpen?" expanded":""}`;
        const header = document.createElement("div");
        header.className = "prop-header";
        header.innerHTML = `<div class="prop-color-strip" style="background:${color}"></div><div class="prop-header-info"><div class="prop-header-name">${prop.name}</div><div class="prop-header-sub">${prop.is_mortgaged ? '<span class="prop-mortgaged-badge">🏦 Hypothek</span>' : housesLabel}<span style="margin-left:auto;color:var(--text2);font-size:10px;">${(prop.price||0)} €</span></div></div><div class="prop-chevron">▼</div>`;
        header.onclick = () => { expandedProp = (expandedProp === prop.name) ? null : prop.name; renderProps(s); };
        item.appendChild(header);
        const drawer = document.createElement("div");
        drawer.className = "prop-drawer";
        const stats = [["Kaufpreis", `${prop.price} €`],["Hypothekenwert", `${mortgageVal} €`],["Rückzahlung (+10%)", `${repayVal} €`]];
        if (prop.house_cost > 0) stats.push(["Hauspreis", `${prop.house_cost} €`],["Gebäude", prop.houses===5?"🏨 Hotel":prop.houses>0?`🏠 x${prop.houses}`:"–"]);
        stats.push(["Status", prop.is_mortgaged ? "<span style='color:var(--danger)'>⚠️ Verpfändet – keine Miete</span>" : "<span style='color:var(--accent2)'>✓ Aktiv</span>"]);
        stats.forEach(([label, val]) => { drawer.innerHTML += `<div class="prop-drawer-stat"><span class="label">${label}</span><span class="val">${val}</span></div>`; });
        const acts = document.createElement("div"); acts.className = "prop-actions";
        if (prop.house_cost > 0 && !prop.is_mortgaged) {
            const bh = document.createElement("button"); bh.className = "pact-btn green"; bh.disabled = !isMyTurn || !prop.can_build_house; bh.innerHTML = `+🏠 Haus<br><small>${prop.house_cost}€</small>`; bh.onclick = e => { e.stopPropagation(); buildProp(prop.name, "house"); }; acts.appendChild(bh);
            const bht = document.createElement("button"); bht.className = "pact-btn green"; bht.disabled = !isMyTurn || !prop.can_build_hotel; bht.innerHTML = `+🏨 Hotel<br><small>${prop.house_cost}€</small>`; bht.onclick = e => { e.stopPropagation(); buildProp(prop.name, "hotel"); }; acts.appendChild(bht);
            if (prop.houses > 0) {
                const sh = document.createElement("button"); sh.className = "pact-btn red";
                if (prop.houses === 5) { sh.disabled = !prop.can_sell_hotel; sh.innerHTML = `−🏨 Hotel<br><small>+${prop.house_cost}€</small>`; sh.onclick = e => { e.stopPropagation(); sellProp(prop.name, "hotel"); }; }
                else { sh.disabled = !prop.can_sell_house; sh.innerHTML = `−🏠 Haus<br><small>+${prop.house_cost}€</small>`; sh.onclick = e => { e.stopPropagation(); sellProp(prop.name, "house"); }; }
                acts.appendChild(sh);
            }
        }
        if (!prop.is_mortgaged) {
            const mb = document.createElement("button"); mb.className = "pact-btn orange"; mb.disabled = !prop.can_mortgage; mb.innerHTML = `🏦 Hypothek<br><small>+${mortgageVal}€</small>`; mb.onclick = e => { e.stopPropagation(); takeMortgage(prop.name); }; acts.appendChild(mb);
        } else {
            const umb = document.createElement("button"); umb.className = "pact-btn span2"; umb.disabled = !prop.can_unmortgage; umb.innerHTML = `✓ Hypothek ablösen (${repayVal}€ = ${mortgageVal}€ + 10% Zinsen)`; umb.onclick = e => { e.stopPropagation(); liftMortgage(prop.name); }; acts.appendChild(umb);
        }
        drawer.appendChild(acts); item.appendChild(drawer); list.appendChild(item);
    });
}

/* ── Button-Zustände ───────────────────────────────────── */
function updateBtns(s) {
    const my = s.current_player===ME;
    const ph = s.turn_phase;
    const hasPendingAction = !!s.pending_tax||!!s.pending_rent||!!s.pending_card||!!s.active_casino;
    const rollBtn = document.getElementById("btn-roll");
    const canSkipBuyAfterDouble = my && ph === "roll" && !!s.can_buy && !hasPendingAction;
    rollBtn.disabled = !my||ph!=="roll"||hasPendingAction;
    rollBtn.textContent = canSkipBuyAfterDouble ? "🎲 Weiter würfeln (nicht kaufen)" : "🎲 Würfeln";
    document.getElementById("btn-buy").disabled = !my||!s.can_buy||hasPendingAction;
    document.getElementById("btn-end").disabled = !my||ph==="roll"||hasPendingAction;
    document.getElementById("status-box").textContent = s.status||"";
    const me = s.players?.find(p=>p.username===ME);
    const jailBtn = document.getElementById("btn-jail-buy");
    const jailCardBtn = document.getElementById("btn-jail-card");
    if(me?.in_jail && my && ph==="roll") {
        jailBtn.style.display = "flex";
        jailBtn.disabled = (me.money < 50);
        jailBtn.textContent = me.money < 50 ? "🔓 Freikaufen (50 €) — kein Geld" : "🔓 Aus Gefängnis freikaufen (50 €)";
        const jailCards = me.get_out_of_jail_cards || 0;
        if(jailCards > 0) { jailCardBtn.style.display = "flex"; jailCardBtn.textContent = `🃏 Gefängnisfreikarte nutzen (${jailCards}x)`; }
        else jailCardBtn.style.display = "none";
    } else { jailBtn.style.display = "none"; jailCardBtn.style.display = "none"; }
    const dd = document.getElementById("dice-display");
    if(s.dice) { dd.style.display="flex"; document.getElementById("die1").textContent=DICE_FACES[s.dice[0]]; document.getElementById("die2").textContent=DICE_FACES[s.dice[1]]; document.getElementById("dice-sum").textContent=`= ${s.dice[0]+s.dice[1]}`; }
    else dd.style.display="none";
}

/* ── Zug-Timer ─────────────────────────────────────────── */
function updateTurnTimer(s) {
    const box = document.getElementById("turn-timer");
    if (!box) return;
    if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
    if (!s || !s.turn_deadline || !s.current_player ||
        (s.last_event && (s.last_event.type === "winner" || s.last_event.type === "draw"))) {
        box.style.display = "none";
        return;
    }
    const serverNow = typeof s.server_time === "number" ? s.server_time : Date.now() / 1000;
    const remaining = Math.max(0, s.turn_deadline - serverNow);
    turnTimerDeadlineLocal = Date.now() + remaining * 1000;
    turnTimerFired = false;
    box.style.display = "flex";
    const label = document.getElementById("turn-timer-label");
    const countEl = document.getElementById("turn-timer-count");
    const fillEl = document.getElementById("turn-timer-fill");
    if (label) {
        label.textContent = s.current_player === ME
            ? "Du hast noch Zeit - ohne Bewegung endet der Zug automatisch."
            : `${s.current_player} am Zug - automatisches Ende ohne Bewegung.`;
    }
    function tick() {
        const rem = Math.max(0, turnTimerDeadlineLocal - Date.now());
        const remSec = Math.ceil(rem / 1000);
        if (countEl) countEl.textContent = remSec + "s";
        if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, (rem / 20000) * 100)) + "%";
        box.classList.toggle("warning", rem <= 5000);
        if (rem <= 0 && !turnTimerFired) {
            turnTimerFired = true;
            if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
            fetchState(true);
        }
    }
    tick();
    turnTimerInterval = setInterval(tick, 250);
}

/* ── Gewinner-Overlay ──────────────────────────────────── */
function checkWinner(s) {
    if (!s.winner && !(s.last_event?.type === "winner")) return;
    if (winnerShown) return;
    winnerShown = true;
    const winnerName = s.winner || s.last_event?.player || "?";
    const winnerPlayer = s.players?.find(p => p.username === winnerName);
    function assetVal(p) { if(!p) return 0; let v=p.money||0; (p.properties||[]).forEach(pr=>{ if(!pr.is_mortgaged) v+=Math.floor((pr.price||0)/2); if(pr.houses===5) v+=(pr.house_cost||0); else v+=(pr.houses||0)*(pr.house_cost||0); }); return v; }
    document.getElementById("winner-name").textContent = `🎉 ${winnerName} gewinnt!`;
    document.getElementById("winner-money").textContent = winnerPlayer ? `${(winnerPlayer.money||0).toLocaleString("de-DE")} €` : "–";
    document.getElementById("winner-assets").textContent = winnerPlayer ? `${assetVal(winnerPlayer).toLocaleString("de-DE")} €` : "–";
    const ranking = document.getElementById("winner-ranking"); ranking.innerHTML = "";
    if (s.players?.length > 1) {
        const medals = ["🥇","🥈","🥉"];
        const sorted = [...s.players].sort((a,b) => assetVal(b) - assetVal(a));
        sorted.forEach((p, i) => {
            const row = document.createElement("div"); row.className = "rank-row" + (i === 0 ? " rank-1" : "");
            const status = p.is_bankrupt ? "💀 Bankrott" : p.is_disconnected ? "👋 Verlassen" : `${assetVal(p).toLocaleString("de-DE")} €`;
            row.innerHTML = `<span class="rank-medal">${medals[i] || `${i+1}.`}</span><div class="player-avatar" style="width:26px;height:26px;font-size:14px;background:linear-gradient(135deg,${p.avatar_color||PCOLORS[p.color]||'#888'},${(p.avatar_color||PCOLORS[p.color]||'#888')}cc);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:white;font-weight:800;flex-shrink:0;">${avatarContent(p)}</div><span class="rank-name">${p.username}</span><span class="rank-val">${status}</span>`;
            ranking.appendChild(row);
        });
    }
    document.getElementById("winner-overlay").classList.add("show");
    clearInterval(pollTm);
}

/* ── Aktionen ──────────────────────────────────────────── */
async function rollDice() {
    document.getElementById("btn-roll").disabled = true;
    const d1 = document.getElementById("die1"), d2 = document.getElementById("die2");
    const dd = document.getElementById("dice-display"); dd.style.display = "flex";
    const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
    let frame = 0, totalFrames = 10;
    const rollInterval = setInterval(() => { d1.textContent = faces[Math.floor(Math.random()*6)]; d2.textContent = faces[Math.floor(Math.random()*6)]; d1.classList.toggle("rolling", frame%2===0); d2.classList.toggle("rolling", frame%2===1); frame++; if(frame>=totalFrames) clearInterval(rollInterval); }, 60);
    const res = await fetch("/api/game/roll", {method:"POST"});
    clearInterval(rollInterval); d1.classList.remove("rolling"); d2.classList.remove("rolling");
    if(!res.ok){ const d=await res.json(); toast("❌", d.error||"Fehler"); await fetchState(true); return; }
    GS = await res.json();
    if (GS.dice) { d1.textContent = DICE_FACES[GS.dice[0]]; d2.textContent = DICE_FACES[GS.dice[1]]; d1.style.transform="scale(1.2)"; d2.style.transform="scale(1.2)"; setTimeout(()=>{d1.style.transform="";d2.style.transform="";},200); }
    await new Promise(r => setTimeout(r,250)); updateUI(GS);
    if (GS.last_move) {
        const steps = Math.abs(GS.last_move.steps||0);
        const STEP_MS = steps <=6 ?210 : steps<=10 ?160 :120;
        const walkDuration = steps*(STEP_MS+60)+900;
        ["btn-roll","btn-end","btn-buy"].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
        setTimeout(()=>{if(GS)updateBtns(GS);},walkDuration);
    }
}
async function buyProperty() { document.getElementById("btn-buy").disabled=true; const btn=document.getElementById("btn-buy"); btn.style.transform="scale(.95)"; setTimeout(()=>btn.style.transform="",150); const res=await fetch("/api/game/buy",{method:"POST"}); if(!res.ok){toast("❌","Kauf nicht möglich");await fetchState(true);return;} const d=await res.json(); if(d.success!==false){GS=d;const me=GS.players?.find(p=>p.username===ME);if(me)pulseField(me.position,"buy");await new Promise(r=>setTimeout(r,120));updateUI(GS);toast("🏠",GS.status);} else toast("❌","Kauf nicht möglich");}
async function buildProp(name,type){ const res=await fetch("/api/game/build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,type})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Bauen fehlgeschlagen");return;} GS=await res.json(); const fi=GS.board?.findIndex(f=>f.name===name); if(fi!==-1){pulseField(fi,"buy");await new Promise(r=>setTimeout(r,80));} updateUI(GS); toast("🏗️",GS.status);}
async function buyOutOfJail() { const res=await fetch("/api/game/buy_out_of_jail",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🔓",GS.status);}
async function takeMortgage(name){ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,action:"take"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🏦",GS.status);}
async function liftMortgage(name){ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,action:"lift"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("✅",GS.status);}
async function sellProp(name,type){ const label=type==="hotel"?"Hotel":"Haus"; if(!confirm(`${label} auf "${name}" verkaufen und ${type==="hotel"?"Hotel":"Haus"}kosten zurückerhalten?`)) return; const res=await fetch("/api/game/sell_building",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,type})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Verkauf fehlgeschlagen");return;} GS=await res.json(); updateUI(GS); toast("🔨",GS.status);}
async function endTurn(){ const btn=document.getElementById("btn-end"); btn.style.transform="scale(.95)"; setTimeout(()=>btn.style.transform="",150); const res=await fetch("/api/game/end_turn",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); animateTurnChange(); updateUI(GS);}
async function kickPlayer(username){ if(!confirm(`${username} wirklich aus dem Spiel entfernen?`)) return; const res=await fetch("/api/room/kick",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🚫",`${username} wurde entfernt.`);}
async function confirmCard(){ closeOv("ov-card"); const res=await fetch("/api/game/confirm_card",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS);}
async function useJailCard(){ const res=await fetch("/api/game/use_jail_card",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🃏",GS.status);}

/* ── Liquidations-Panel (Miete) ────────────────────────── */
function buildRentLiquidatePanel(me,rentAmount){ const container=document.getElementById("rent-liquidate-list"); if(!container||!me)return; const props=me.properties||[]; if(!props.length){container.innerHTML=`<p style="font-size:11px;color:var(--text2);">Keine Grundstücke zum Liquidieren.</p>`;return;} container.innerHTML=""; props.forEach(prop=>{ const row=document.createElement("div");row.className="rliq-prop";row.innerHTML=`<div class="rliq-dot" style="background:${CMAP[prop.color_group]||"#888"}"></div><span class="rliq-name">${prop.name}</span>`; if(prop.houses>0){ const sh=document.createElement("button");sh.className="rliq-btn sell";sh.textContent=prop.houses===5?`−🏨 +${prop.house_cost}€`:`−🏠 +${prop.house_cost}€`; sh.disabled=prop.houses===5?!prop.can_sell_hotel:!prop.can_sell_house; sh.onclick=async()=>{ const type=prop.houses===5?"hotel":"house"; const res=await fetch("/api/game/sell_building",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,type})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); }; row.appendChild(sh); } if(!prop.is_mortgaged){ const mv=prop.mortgage_value||Math.floor((prop.price||0)/2); const mb=document.createElement("button");mb.className="rliq-btn mtg";mb.textContent=`🏦 +${mv}€`; mb.disabled=!prop.can_mortgage; mb.onclick=async()=>{ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,action:"take"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); }; row.appendChild(mb); } else { const rv=prop.repay_value||Math.round((prop.mortgage_value||0)*1.1); const ub=document.createElement("button");ub.className="rliq-btn";ub.textContent=`✓ Ablösen −${rv}€`; ub.disabled=!prop.can_unmortgage; ub.onclick=async()=>{ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,action:"lift"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); }; row.appendChild(ub); } container.appendChild(row); }); }

/* ── Miete ─────────────────────────────────────────────── */
function checkRentPending(s){ if(!s.pending_rent){ if(document.getElementById("ov-rent").classList.contains("show"))closeOv("ov-rent"); pendingRent=null; return; } const rent=s.pending_rent; if(rent.payer!==ME)return; pendingRent=rent; document.getElementById("rent-amount").textContent=`${rent.amount.toLocaleString("de-DE")} €`; document.getElementById("rent-to").textContent=`an ${rent.creditor}${rent.field_name?" — "+rent.field_name:""}`; const me=s.players.find(p=>p.username===ME); const myMoney=me?.money||0; document.getElementById("rent-my-money").textContent=`${myMoney.toLocaleString("de-DE")} €`; const payBtn=document.getElementById("btn-pay"); const totalAssets=(me?.properties||[]).reduce((sum,p)=>{ if(!p.is_mortgaged) sum+=Math.floor((p.price||0)/2); if(p.houses===5) sum+=(p.house_cost||0); else sum+=(p.houses||0)*(p.house_cost||0); return sum; }, myMoney); if(myMoney>=rent.amount){ payBtn.textContent="💳 Miete zahlen"; payBtn.disabled=false; payBtn.className="btn danger"; } else if(totalAssets>=rent.amount){ payBtn.textContent=`⚠️ Erst liquidieren (Kasse: ${myMoney.toLocaleString("de-DE")} €)`; payBtn.disabled=true; payBtn.className="btn"; } else { payBtn.textContent=`💀 Bankrott bestätigen`; payBtn.disabled=false; payBtn.className="btn danger"; } const ol=document.getElementById("offer-list"); const prevSel=selOfferProp; ol.innerHTML=""; selOfferProp=null; document.getElementById("btn-offer-prop").disabled=true; const myProps=me?.properties||[]; if(!myProps.length) ol.innerHTML=`<p style="color:var(--text2);font-size:11px;">Keine Grundstücke.</p>`; else { myProps.forEach(prop=>{ const item=document.createElement("div");item.className="offer-item"+(prop.name===prevSel?" sel":""); item.innerHTML=`<div class="pdot" style="background:${CMAP[prop.color_group]||"#888"}"></div><span style="flex:1">${prop.name}</span><span class="pval">${prop.price} €</span>`; if(prop.name===prevSel){selOfferProp=prop.name;document.getElementById("btn-offer-prop").disabled=false;} item.onclick=()=>{ document.querySelectorAll("#offer-list .offer-item").forEach(i=>i.classList.remove("sel")); item.classList.add("sel"); selOfferProp=prop.name; document.getElementById("btn-offer-prop").disabled=false; }; ol.appendChild(item); }); } buildRentLiquidatePanel(me,rent.amount); if(!document.getElementById("ov-rent").classList.contains("show")) openOv("ov-rent"); }
async function payRent(){ if(!pendingRent)return; closeOv("ov-rent"); const res=await fetch("/api/game/pay_rent",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("💸",`${pendingRent.amount.toLocaleString("de-DE")} € Miete gezahlt`); pendingRent=null; }
async function offerPropForRent(){ if(!selOfferProp||!pendingRent)return; closeOv("ov-rent"); const res=await fetch("/api/game/offer_prop_for_rent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:selOfferProp})}); if(!res.ok){toast("❌","Angebot fehlgeschlagen");return;} GS=await res.json(); updateUI(GS); toast("📤",`"${selOfferProp}" angeboten`); }
function checkRentOffer(s){ if(!s.incoming_rent_offer)return; const offer=s.incoming_rent_offer; if(offer.to!==ME)return; if(document.getElementById("ov-rent-offer").classList.contains("show"))return; incomingRentOffer=offer; document.getElementById("rent-offer-from").textContent=offer.from; const c=CMAP[offer.prop_color]||"#888"; document.getElementById("rent-offer-prop").innerHTML=`<div style="width:12px;height:12px;border-radius:50%;background:${c};flex-shrink:0;"></div><span style="flex:1;font-weight:600;font-size:13px;">${offer.prop_name}</span><span style="color:var(--accent2);font-weight:700;">${offer.prop_value} €</span>`; document.getElementById("rent-offer-rent").textContent=`${offer.rent_amount} €`; openOv("ov-rent-offer"); }
async function respondRent(accept){ if(!incomingRentOffer)return; closeOv("ov-rent-offer"); const res=await fetch("/api/game/respond_rent_offer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accept})}); if(!res.ok){toast("❌","Fehler");return;} GS=await res.json(); updateUI(GS); toast(accept?"✅":"❌", accept?`"${incomingRentOffer.prop_name}" erhalten`:"Angebot abgelehnt"); incomingRentOffer=null; }

/* ── Steuer mit Aufschlüsselung ────────────────────────── */
function checkPendingTax(s) {
    if (!s.pending_tax) {
        if (document.getElementById("ov-tax").classList.contains("show")) closeOv("ov-tax");
        return;
    }
    const tax = s.pending_tax;
    if (tax.payer !== ME) return;
    pendingTax = tax;
    document.getElementById("tax-amount").textContent = `${tax.amount.toLocaleString("de-DE")} €`;
    document.getElementById("tax-field-name").textContent = `an die Bank (${tax.field_name || "Steuer"})`;

    const titleEl = document.querySelector('#ov-tax h2');
    if (titleEl) {
        if (tax.tax_type === 'property_tax') titleEl.textContent = "🏛️ Steuerprüfung!";
        else if (tax.tax_type === 'repair') titleEl.textContent = "🔧 Reparatur fällig!";
        else titleEl.textContent = "🏛️ Steuer fällig!";
    }

    const breakdownDiv = document.getElementById("tax-breakdown");
    if (breakdownDiv) {
        if (tax.breakdown && tax.breakdown.length) {
            breakdownDiv.innerHTML = `<div class="section-lbl">Aufschlüsselung</div>` +
                tax.breakdown.map(b =>
                    `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;border-bottom:1px solid rgba(48,54,61,.4);">
                        <span>${b.name}</span>
                        <span>${b.houses > 0 ? b.houses + ' 🏠' : ''}${b.hotels > 0 ? ' 🏨' : ''} → ${b.cost} €</span>
                    </div>`
                ).join("");
        } else {
            breakdownDiv.innerHTML = "";
        }
    }

    const me = s.players.find(p => p.username === ME);
    const myMoney = me?.money || 0;
    document.getElementById("tax-my-money").textContent = `${myMoney.toLocaleString("de-DE")} €`;
    buildTaxLiquidatePanel(me, tax.amount);
    if (!document.getElementById("ov-tax").classList.contains("show")) openOv("ov-tax");
}

function buildTaxLiquidatePanel(me, amount) {
    const container = document.getElementById("tax-liquidate-list");
    if (!container || !me) return;
    const props = me.properties || [];
    if (!props.length) { container.innerHTML = `<p style="font-size:11px;color:var(--text2);">Keine Grundstücke zum Liquidieren.</p>`; return; }
    container.innerHTML = "";
    props.forEach(prop => {
        const row = document.createElement("div");
        row.className = "rliq-prop";
        row.innerHTML = `<div class="rliq-dot" style="background:${CMAP[prop.color_group]||"#888"}"></div><span class="rliq-name">${prop.name}</span>`;
        if (prop.houses > 0) {
            const sh = document.createElement("button");
            sh.className = "rliq-btn sell";
            sh.textContent = prop.houses === 5 ? `−🏨 +${prop.house_cost}€` : `−🏠 +${prop.house_cost}€`;
            sh.disabled = prop.houses === 5 ? !prop.can_sell_hotel : !prop.can_sell_house;
            sh.onclick = async () => {
                const type = prop.houses === 5 ? "hotel" : "house";
                const res = await fetch("/api/game/sell_building", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,type})});
                if (!res.ok) { const d=await res.json(); toast("❌",d.error||"Fehler"); return; }
                GS = await res.json(); updateUI(GS);
            };
            row.appendChild(sh);
        }
        if (!prop.is_mortgaged) {
            const mv = prop.mortgage_value || Math.floor((prop.price||0)/2);
            const mb = document.createElement("button");
            mb.className = "rliq-btn mtg";
            mb.textContent = `🏦 +${mv}€`;
            mb.disabled = !prop.can_mortgage;
            mb.onclick = async () => {
                const res = await fetch("/api/game/mortgage", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,action:"take"})});
                if (!res.ok) { const d=await res.json(); toast("❌",d.error||"Fehler"); return; }
                GS = await res.json(); updateUI(GS);
            };
            row.appendChild(mb);
        } else {
            const rv = prop.repay_value || Math.round((prop.mortgage_value||0)*1.1);
            const ub = document.createElement("button");
            ub.className = "rliq-btn";
            ub.textContent = `✓ Ablösen −${rv}€`;
            ub.disabled = !prop.can_unmortgage;
            ub.onclick = async () => {
                const res = await fetch("/api/game/mortgage", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:prop.name,action:"lift"})});
                if (!res.ok) { const d=await res.json(); toast("❌",d.error||"Fehler"); return; }
                GS = await res.json(); updateUI(GS);
            };
            row.appendChild(ub);
        }
        container.appendChild(row);
    });
}

async function payTax() {
    if (!pendingTax) return;
    closeOv("ov-tax");
    const res = await fetch("/api/game/pay_tax", {method:"POST"});
    if (!res.ok) { const d = await res.json(); toast("❌", d.error||"Fehler"); return; }
    GS = await res.json();
    updateUI(GS);
    toast("🏛️", `${pendingTax.amount.toLocaleString("de-DE")} € Steuer gezahlt`);
    pendingTax = null;
}

/* ── Trade ─────────────────────────────────────────────── */
function checkTradeIncoming(s){ if(!s.incoming_trade || s.incoming_trade.to!==ME){ document.getElementById("trade-badge").style.display="none"; return; } document.getElementById("trade-badge").style.display="inline-flex"; if(!document.getElementById("ov-trade").classList.contains("show")) toast("🤝",`${s.incoming_trade.from} möchte handeln!`); }
function openTrade(){ buildTrade(); openOv("ov-trade"); document.getElementById("trade-badge").style.display="none"; }
function buildTrade(){ const modal=document.getElementById("trade-modal"); if(GS?.incoming_trade && GS.incoming_trade.to===ME){ buildIncomingTrade(modal,GS.incoming_trade); return; } buildInitTrade(modal); }
function buildInitTrade(modal){ const me=GS?.players?.find(p=>p.username===ME); const others=GS?.players?.filter(p=>p.username!==ME&&!p.is_bankrupt)||[]; myOffer={props:[],money:0}; theirOffer={props:[],money:0}; tradeTarget=null; modal.innerHTML=`<h2>🤝 Handel initiieren</h2><select class="psel" id="tgt-sel"><option value="">-- Spieler wählen --</option>${others.map(p=>`<option value="${p.username}">${p.username} (${p.money.toLocaleString("de-DE")} €)</option>`).join("")}</select><div class="tgrid" id="tgrid"><div class="tside"><h3><div class="tdot" style="background:${PCOLORS[me?.color]||'#888'}"></div>Mein Angebot</h3><div class="tsec">Grundstücke</div><div id="t-my-props">${tpropsHTML(me?.properties||[],"my")}</div><div class="tsec">💰 Ich zahle zusätzlich</div><div class="tmoney-row"><input class="tmoney" id="t-my-money" type="number" min="0" placeholder="0" oninput="updateTSum()"><span style="color:var(--text2);font-size:12px;">€</span></div></div><div class="tmid">⇄</div><div class="tside"><h3 id="t-their-hdr"><div class="tdot" style="background:#666"></div>Ich verlange</h3><div class="tsec">Grundstücke</div><div id="t-their-props"><p style="font-size:11px;color:var(--text2);">Wähle Spieler.</p></div><div class="tsec">💰 Ich verlange zusätzlich</div><div class="tmoney-row"><input class="tmoney" id="t-their-money" type="number" min="0" placeholder="0" oninput="updateTSum()"><span style="color:var(--text2);font-size:12px;">€</span></div></div></div><div class="tsum" id="t-sum"></div><div class="mfooter"><button class="btn" onclick="closeOv('ov-trade')">Schließen</button><button class="btn primary" onclick="sendTrade()">📤 Angebot senden</button></div>`; document.getElementById("tgt-sel").addEventListener("change", e=>{ tradeTarget=e.target.value; updateTheirSide(); updateTSum(); }); updateTSum(); }
function tpropsHTML(props,side){ if(!props.length) return `<p style="font-size:11px;color:var(--text2);">Keine Grundstücke.</p>`; return props.map(prop=>{ const c=CMAP[prop.color_group]||"#888"; const inO=(side==="my"?myOffer:theirOffer).props.includes(prop.name); return `<div class="tprop${inO?" in-offer":""}" id="tp-${side}-${prop.name.replace(/[\s\/]/g,'-')}" onclick="toggleTP('${prop.name.replace(/'/g,"\\'")}','${side}')"><div class="pdot" style="background:${c}"></div><span style="flex:1">${prop.name}</span><span class="tpval">${prop.price}€</span></div>`; }).join(""); }
function toggleTP(name,side){ const arr=side==="my"?myOffer.props:theirOffer.props; const idx=arr.indexOf(name); if(idx===-1) arr.push(name); else arr.splice(idx,1); const key=name.replace(/[\s\/]/g,'-'); const el=document.getElementById(`tp-${side}-${key}`); if(el) el.classList.toggle("in-offer",arr.includes(name)); updateTSum(); }
function updateTheirSide(){ const container=document.getElementById("t-their-props"); const hdr=document.getElementById("t-their-hdr"); if(!tradeTarget||!GS){ if(container) container.innerHTML=`<p style="font-size:11px;color:var(--text2);">Wähle Spieler.</p>`; return; } const them=GS.players.find(p=>p.username===tradeTarget); if(!them||!hdr||!container) return; hdr.innerHTML=`<div class="tdot" style="background:${PCOLORS[them.color]||'#888'}"></div>${them.username}`; theirOffer.props=theirOffer.props.filter(n=>them.properties.some(p=>p.name===n)); container.innerHTML=tpropsHTML(them.properties||[],"their"); }
function updateTSum(){ const c=document.getElementById("t-sum"); if(!c) return; const me=GS?.players?.find(p=>p.username===ME); const them=tradeTarget?GS?.players?.find(p=>p.username===tradeTarget):null; myOffer.money=parseInt(document.getElementById("t-my-money")?.value||"0")||0; theirOffer.money=parseInt(document.getElementById("t-their-money")?.value||"0")||0; const myV=myOffer.props.reduce((s,n)=>{const p=me?.properties?.find(x=>x.name===n);return s+(p?.price||0);},0)+myOffer.money; const thV=theirOffer.props.reduce((s,n)=>{const p=them?.properties?.find(x=>x.name===n);return s+(p?.price||0);},0)+theirOffer.money; const diff=thV-myV; const bc=diff>100?"pos":diff<-100?"neg":"neu"; const bl=diff>0?`+${diff.toLocaleString("de-DE")} € zu deinen Gunsten`:diff<0?`${diff.toLocaleString("de-DE")} € zu deinen Lasten`:"Ausgeglichener Tausch"; const pros=[];const cons=[]; if(theirOffer.props.length) pros.push(`+${theirOffer.props.length} Grundstück(e) erhalten`); if(myOffer.props.length) cons.push(`−${myOffer.props.length} Grundstück(e) abgeben`); if(theirOffer.money) pros.push(`+${theirOffer.money.toLocaleString("de-DE")} € erhalten`); if(myOffer.money) cons.push(`−${myOffer.money.toLocaleString("de-DE")} € zahlen`); c.innerHTML=`<div class="tsum-row"><span>Du bietest (Wert)</span><span class="val">${myV.toLocaleString("de-DE")} €</span></div><div class="tsum-row"><span>${them?.username||"Gegenüber"} gibt (Wert)</span><span class="val">${thV.toLocaleString("de-DE")} €</span></div><div class="tsum-row bal ${bc}"><span>Bilanz</span><span class="val">${bl}</span></div><div class="pro-con">${pros.map(p=>`<div class="pro">✓ ${p}</div>`).join("")}${cons.map(p=>`<div class="con">✗ ${p}</div>`).join("")}</div>`; }
async function sendTrade(){ if(!tradeTarget){toast("❌","Wähle einen Mitspieler");return;} if(!myOffer.props.length&&!myOffer.money&&!theirOffer.props.length&&!theirOffer.money){toast("❌","Angebot ist leer");return;} const res=await fetch("/api/trade/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:tradeTarget,my_props:myOffer.props,my_money:myOffer.money,their_props:theirOffer.props,their_money:theirOffer.money})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); closeOv("ov-trade"); updateUI(GS); toast("📤",`Angebot an ${tradeTarget} gesendet`); myOffer={props:[],money:0}; theirOffer={props:[],money:0}; tradeTarget=null; }
function buildIncomingTrade(modal,trade){ const me=GS?.players?.find(p=>p.username===ME); const them=GS?.players?.find(p=>p.username===trade.from); const myColor=PCOLORS[me?.color]||"#888"; const themColor=PCOLORS[them?.color]||"#888"; const senderGivesProps=trade.my_props||[]; const senderGivesMoney=trade.my_money||0; const iGiveProps=trade.their_props||[]; const iGiveMoney=trade.their_money||0; const senderGivesVal=senderGivesProps.reduce((s,n)=>{const p=them?.properties?.find(x=>x.name===n);return s+(p?.price||0);},0)+senderGivesMoney; const iGiveVal=iGiveProps.reduce((s,n)=>{const p=me?.properties?.find(x=>x.name===n);return s+(p?.price||0);},0)+iGiveMoney; const diff=senderGivesVal-iGiveVal; const bc=diff>100?"pos":diff<-100?"neg":"neu"; const bl=diff>0?`+${diff.toLocaleString("de-DE")} € zu deinen Gunsten`:diff<0?`${diff.toLocaleString("de-DE")} € zu deinen Lasten`:"Ausgeglichener Tausch"; const senderChips=senderGivesProps.map(n=>{const p=them?.properties?.find(x=>x.name===n);return `<span class="prop-chip"><div style="width:8px;height:8px;border-radius:50%;background:${CMAP[p?.color_group]||"#888"};flex-shrink:0"></div>${n} (${p?.price||0}€)</span>`;}).join("")+(senderGivesMoney?`<span class="prop-chip">💰 ${senderGivesMoney.toLocaleString("de-DE")} €</span>`:""); const iGiveChips=iGiveProps.map(n=>{const p=me?.properties?.find(x=>x.name===n);return `<span class="prop-chip"><div style="width:8px;height:8px;border-radius:50%;background:${CMAP[p?.color_group]||"#888"};flex-shrink:0"></div>${n} (${p?.price||0}€)</span>`;}).join("")+(iGiveMoney?`<span class="prop-chip">💰 ${iGiveMoney.toLocaleString("de-DE")} €</span>`:""); let cMyProps=[...iGiveProps]; let cMyMoney=iGiveMoney; let cThProps=[...senderGivesProps]; let cThMoney=senderGivesMoney; modal.innerHTML=`<h2>🤝 Angebot von <span style="color:${themColor}">${trade.from}</span></h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div style="background:var(--bg3);border-radius:var(--r);padding:10px;border:1px solid rgba(63,185,80,.25);"><div class="section-lbl" style="color:var(--accent2);">✓ ${trade.from} gibt dir</div><div style="margin-top:6px;">${senderChips||"<span style='color:var(--text2);font-size:11px;'>Nichts</span>"}</div></div><div style="background:var(--bg3);border-radius:var(--r);padding:10px;border:1px solid rgba(248,81,73,.25);"><div class="section-lbl" style="color:var(--danger);">✗ Du gibst</div><div style="margin-top:6px;">${iGiveChips||"<span style='color:var(--text2);font-size:11px;'>Nichts</span>"}</div></div></div><div class="tsum"><div class="tsum-row"><span>Du erhältst (Wert)</span><span class="val">${senderGivesVal.toLocaleString("de-DE")} €</span></div><div class="tsum-row"><span>Du gibst (Wert)</span><span class="val">${iGiveVal.toLocaleString("de-DE")} €</span></div><div class="tsum-row bal ${bc}"><span>Bilanz</span><span class="val">${bl}</span></div></div>${(trade.history||[]).length?`<div class="thist"><div style="font-size:10px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Verhandlungshistorie</div>${trade.history.map(h=>`<div class="hent"><span class="hwho">${h.by}</span>: ${h.action}</div>`).join("")}</div>`:""}<div class="counter-section"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Gegenangebot machen (optional)</div><div class="tgrid"><div class="tside"><h3 style="font-size:12px;"><div class="tdot" style="background:${myColor}"></div>Du gibst</h3><div id="c-my-props">${cPropsHTML(me?.properties||[],cMyProps,"cmy")}</div><div class="tmoney-row" style="margin-top:6px;"><input class="tmoney" id="c-my-money" type="number" min="0" placeholder="0" value="${cMyMoney||""}" style="font-size:12px;padding:5px 8px;"><span style="color:var(--text2);font-size:11px;">€</span></div></div><div class="tmid">⇄</div><div class="tside"><h3 style="font-size:12px;"><div class="tdot" style="background:${themColor}"></div>${trade.from} gibt</h3><div id="c-their-props">${cPropsHTML(them?.properties||[],cThProps,"cth")}</div><div class="tmoney-row" style="margin-top:6px;"><input class="tmoney" id="c-their-money" type="number" min="0" placeholder="0" value="${cThMoney||""}" style="font-size:12px;padding:5px 8px;"><span style="color:var(--text2);font-size:11px;">€</span></div></div></div></div><div class="mfooter"><button class="btn danger" onclick="respondTrade('reject')">✗ Ablehnen</button><button class="btn warning" onclick="respondTrade('counter')">↩ Gegenangebot</button><button class="btn success" onclick="respondTrade('accept')">✓ Annehmen</button></div>`; (me?.properties||[]).forEach(prop=>{ const key=prop.name.replace(/[\s\/]/g,'-');const el=document.getElementById(`tpc-cmy-${key}`);if(!el)return;el.onclick=()=>{const i=cMyProps.indexOf(prop.name);if(i===-1)cMyProps.push(prop.name);else cMyProps.splice(i,1);el.classList.toggle("in-offer",cMyProps.includes(prop.name));};}); (them?.properties||[]).forEach(prop=>{ const key=prop.name.replace(/[\s\/]/g,'-');const el=document.getElementById(`tpc-cth-${key}`);if(!el)return;el.onclick=()=>{const i=cThProps.indexOf(prop.name);if(i===-1)cThProps.push(prop.name);else cThProps.splice(i,1);el.classList.toggle("in-offer",cThProps.includes(prop.name));};}); modal._counter=()=>({my_props:cMyProps,my_money:parseInt(document.getElementById("c-my-money")?.value||"0")||0,their_props:cThProps,their_money:parseInt(document.getElementById("c-their-money")?.value||"0")||0}); }
function cPropsHTML(props,selected,side){ if(!props.length)return `<p style="font-size:11px;color:var(--text2);">Keine Grundstücke.</p>`; return props.map(prop=>{ const c=CMAP[prop.color_group]||"#888"; const inO=selected.includes(prop.name); return `<div class="tprop${inO?" in-offer":""}" id="tpc-${side}-${prop.name.replace(/[\s\/]/g,'-')}"><div class="pdot" style="background:${c}"></div><span style="flex:1">${prop.name}</span><span class="tpval">${prop.price}€</span></div>`; }).join(""); }
async function respondTrade(action){ const modal=document.getElementById("trade-modal"); let body={action}; if(action==="counter"&&modal._counter) body={action,...modal._counter()}; const res=await fetch("/api/trade/respond",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); closeOv("ov-trade"); updateUI(GS); toast(action==="accept"?"🤝":action==="reject"?"❌":"↩",{accept:"Handel angenommen!",reject:"Handel abgelehnt.",counter:"Gegenangebot gesendet"}[action]); }

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

/* ── Beitreten ─────────────────────────────────────────── */
function showJoinModal() {
    const grid = document.getElementById("color-grid");
    grid.innerHTML = "";
    const takenColors = new Set((GS?.players || []).filter(p => p.username !== ME && !p.is_disconnected).map(p => p.color));
    if (takenColors.has(selColor)) {
        selColor = COLORS.find(c => !takenColors.has(c)) || COLORS[0];
    }
    COLORS.forEach(c => {
        const taken = takenColors.has(c);
        const opt = document.createElement("div");
        opt.className = "color-option" + (c === selColor ? " selected" : "") + (taken ? " taken" : "");
        opt.style.background = PCOLORS[c];
        opt.title = taken ? `${c} — bereits vergeben` : c;
        opt.dataset.color = c;
        if (!taken) {
            opt.onclick = () => {
                grid.querySelectorAll(".color-option").forEach(el => el.classList.remove("selected"));
                opt.classList.add("selected");
                selColor = c;
                document.getElementById("color-label").textContent = c.charAt(0).toUpperCase() + c.slice(1);
            };
        }
        grid.appendChild(opt);
    });
    document.getElementById("color-label").textContent = selColor.charAt(0).toUpperCase() + selColor.slice(1);
    openOv("ov-join");
}
async function joinGame() {
    const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: selColor })
    });
    const data = await res.json();
    if (res.ok) {
        closeOv("ov-join");
        GS = data;
        updateUI(GS);
        toast("🎉", `Beigetreten als ${selColor}!`);
        setTimeout(() => fetchState(true), 100);
    } else {
        toast("❌", data.error || "Fehler beim Beitreten");
    }
}

/* ── State-Fetching ────────────────────────────────────── */
async function fetchState(silent=false) {
    if (stateRequestInFlight) return;
    stateRequestInFlight = true;
    try {
        const headers = gameStateEtag ? { "If-None-Match": gameStateEtag } : {};
        const res = await fetch("/api/game/state", { headers });
        if (res.status === 304) return;
        if (!res.ok) return;
        const ns = await res.json();
        gameStateEtag = res.headers.get("ETag") || gameStateEtag;
        const oldSt = GS?.status;
        GS = ns;

        const meInGame = GS.players?.some(p => p.username === ME);
        if (meInGame && checkIfKicked(GS)) return;

        updateUI(GS);
        if (!silent && oldSt !== GS.status && GS.last_event) {
            const icons = { jail:"⛓️", rent:"💸", card:"🃏", tax:"🏛️", bankrupt:"💀", land_empty:"🏷️", build:"🏗️", sell_building:"🔨", free_parking:"🅿️", jail_buyout:"🔓", jail_card_used:"🃏", mortgage:"🏦", unmortgage:"✅", trade:"🤝", disconnect:"👋" };
            toast(icons[GS.last_event.type] || "📢", GS.status || "");
        }
    } catch(e) { console.error(e); }
    finally { stateRequestInFlight = false; }
}

/* ── Casino ────────────────────────────────────────────── */
function openCasino(gameType) {
    casinoState = { gameType: gameType, step: 'bet' };
    renderCasino();
    openOv('ov-casino');
}

function renderCasino() {
    const container = document.getElementById('casino-modal-content');
    if (!casinoState) return;
    const me = GS?.players?.find(p => p.username === ME);
    const myMoney = me?.money || 0;

    if (casinoState.step === 'bet') {
        if (casinoState.gameType === 'blackjack') {
            container.innerHTML = `
                <h2>♠️ Blackjack</h2>
                <p style="color:var(--text2);font-size:13px;margin-bottom:12px;">
                    Wähle deinen Einsatz (max. ${myMoney.toLocaleString('de-DE')} €).<br>
                    Gewinn: 2x Einsatz. Bei Gleichstand (Push) wird der Einsatz zurückerstattet.
                </p>
                <div class="info-box">Dein Guthaben: <strong style="color:var(--accent2);">${myMoney.toLocaleString('de-DE')} €</strong></div>
                <input class="tmoney" id="casino-bet" type="number" min="1" max="${myMoney}" value="${Math.min(100, myMoney)}" style="margin-bottom:12px;">
                <div class="mfooter">
                    <button class="btn" onclick="closeOv('ov-casino')">Abbrechen</button>
                    <button class="btn primary" onclick="startBlackjack()">Spiel starten</button>
                </div>
            `;
        } else if (casinoState.gameType === 'roulette') {
            container.innerHTML = `
                <h2>🎡 Roulette</h2>
                <p style="color:var(--text2);font-size:13px;margin-bottom:12px;">
                    Wähle Einsatz und Farbe.<br>Rot/Schwarz zahlen 2x, Grün zahlt 3x.
                </p>
                <div class="info-box">Dein Guthaben: <strong style="color:var(--accent2);">${myMoney.toLocaleString('de-DE')} €</strong></div>
                <input class="tmoney" id="casino-bet" type="number" min="1" max="${myMoney}" value="${Math.min(100, myMoney)}" style="margin-bottom:12px;">
                <div class="section-lbl">Farbe wählen</div>
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button class="btn" style="background:#dc2626;color:white;border:none;" onclick="setRouletteColor('red')" id="roulette-red">Rot (2x)</button>
                    <button class="btn" style="background:#1f2937;color:white;border:none;" onclick="setRouletteColor('black')" id="roulette-black">Schwarz (2x)</button>
                    <button class="btn" style="background:#16a34a;color:white;border:none;" onclick="setRouletteColor('green')" id="roulette-green">Grün (3x)</button>
                </div>
                <div class="mfooter">
                    <button class="btn" onclick="closeOv('ov-casino')">Abbrechen</button>
                    <button class="btn primary" onclick="playRoulette()">Drehen</button>
                </div>
            `;
            casinoState.color = 'red';
            updateRouletteColorSelection();
        }
    } else if (casinoState.step === 'blackjack') {
        renderBlackjackGame();
    } else if (casinoState.step === 'roulette-result') {
        renderRouletteResult();
    }
}

function updateRouletteColorSelection() {
    ['red','black','green'].forEach(c => {
        const btn = document.getElementById(`roulette-${c}`);
        if (btn) btn.style.outline = (casinoState.color === c) ? '3px solid white' : 'none';
    });
}
function setRouletteColor(c) {
    casinoState.color = c;
    updateRouletteColorSelection();
}

async function startBlackjack() {
    const betInput = document.getElementById('casino-bet');
    const bet = parseInt(betInput?.value);
    if (isNaN(bet) || bet <= 0) { toast('❌', 'Bitte gültigen Einsatz eingeben (mind. 1 €)'); return; }
    const me = GS?.players?.find(p => p.username === ME);
    if (!me || bet > (me.money || 0)) {
        toast('❌', `Einsatz (${bet} €) übersteigt dein Guthaben (${(me?.money || 0).toLocaleString('de-DE')} €)`);
        return;
    }
    const data = await _casinoRequest('/api/game/casino/start', { game_type: 'blackjack', bet }, 'Spiel konnte nicht gestartet werden');
    if (!data) return;
    if (!data.active_casino) {
        toast('❌', 'Server lieferte keine Casino-Daten – Backend prüfen (active_casino in to_dict?)');
        return;
    }
    GS = data;
    casinoState = { gameType: 'blackjack', step: 'blackjack' };
    renderCasino();
    updateUI(GS);
}

function renderBlackjackGame() {
    const container = document.getElementById('casino-modal-content');
    const casino = GS?.active_casino;
    if (!casino || casino.game_type !== 'blackjack') {
        container.innerHTML = `
            <h2>♠️ Blackjack</h2>
            <div class="info-box" style="background:rgba(248,81,73,.15);border:1px solid var(--danger);">
                <strong>⚠️ Kein aktives Blackjack-Spiel gefunden.</strong><br>
                <span style="font-size:12px;color:var(--text2);">Möglicherweise hat der Server das Spiel nicht korrekt angelegt. Prüfe die Browser-Konsole (F12).</span>
            </div>
            <div class="mfooter"><button class="btn" onclick="closeOv('ov-casino')">Schließen</button></div>
        `;
        return;
    }
    const playerHand = casino.player_hand.map(c => `${c[0]}${c[1]}`).join(' ');
    const dealerHand = casino.dealer_hand.map((c, i) => i === 0 && casino.status === 'player_turn' ? '??' : `${c[0]}${c[1]}`).join(' ');
    const playerVal = casino.player_value;
    const dealerVal = casino.status === 'player_turn' ? '?' : casino.dealer_value;
    let buttons = '';
    if (casino.status === 'player_turn' && !casino.finished) {
        buttons = `
            <button class="btn primary" onclick="blackjackHit()">Hit</button>
            <button class="btn" onclick="blackjackStand()">Stand</button>
        `;
    } else if (casino.finished) {
        buttons = `<button class="btn success" onclick="acknowledgeCasino()">OK</button>`;
    }
    container.innerHTML = `
        <h2>♠️ Blackjack</h2>
        <div class="info-box">Einsatz: <strong>${casino.bet.toLocaleString('de-DE')} €</strong> | Guthaben: <strong>${(GS.players.find(p=>p.username===ME)?.money||0).toLocaleString('de-DE')} €</strong></div>
        <div style="margin-bottom:12px;">
            <div class="section-lbl">Deine Hand (${playerVal})</div>
            <div style="font-size:20px;font-weight:700;letter-spacing:2px;">${playerHand}</div>
            <div class="section-lbl" style="margin-top:12px;">Dealer Hand (${dealerVal})</div>
            <div style="font-size:20px;font-weight:700;letter-spacing:2px;">${dealerHand}</div>
        </div>
        ${casino.finished ? `<div class="info-box" style="background:${casino.result==='win'?'rgba(63,185,80,.15)':casino.result==='push'?'rgba(227,179,65,.15)':'rgba(248,81,73,.15)'};"><strong>Ergebnis: ${casino.result === 'win' ? 'Gewonnen!' : casino.result === 'push' ? 'Push (Einsatz zurück)' : 'Verloren'}</strong><br>Auszahlung: ${casino.payout.toLocaleString('de-DE')} €</div>` : ''}
        <div class="mfooter">${buttons}</div>
    `;
}

async function blackjackHit() {
    const data = await _casinoRequest('/api/game/casino/blackjack/hit', null, 'Hit fehlgeschlagen');
    if (!data) return;
    GS = data;
    renderBlackjackGame();
    updateUI(GS);
}

async function blackjackStand() {
    const data = await _casinoRequest('/api/game/casino/blackjack/stand', null, 'Stand fehlgeschlagen');
    if (!data) return;
    GS = data;
    renderBlackjackGame();
    updateUI(GS);
}

async function playRoulette() {
    const betInput = document.getElementById('casino-bet');
    const bet = parseInt(betInput?.value);
    if (isNaN(bet) || bet <= 0) { toast('❌', 'Bitte gültigen Einsatz eingeben (mind. 1 €)'); return; }
    const me = GS?.players?.find(p => p.username === ME);
    if (!me || bet > (me.money || 0)) {
        toast('❌', `Einsatz übersteigt dein Guthaben (${(me?.money || 0).toLocaleString('de-DE')} €)`);
        return;
    }
    const data = await _casinoRequest('/api/game/casino/start', { game_type: 'roulette', bet, color: casinoState.color }, 'Roulette fehlgeschlagen');
    if (!data) return;
    if (!data.active_casino) { toast('❌', 'Server lieferte keine Casino-Daten'); return; }
    GS = data;
    casinoState = { gameType: 'roulette', step: 'roulette-result' };
    renderCasino();
    updateUI(GS);
}

function renderRouletteResult() {
    const container = document.getElementById('casino-modal-content');
    const casino = GS.active_casino;
    if (!casino || casino.game_type !== 'roulette') { closeOv('ov-casino'); return; }
    const colorNames = { red: 'Rot', black: 'Schwarz', green: 'Grün' };
    const colorStyles = { red: '#dc2626', black: '#1f2937', green: '#16a34a' };
    container.innerHTML = `
        <h2>🎡 Roulette</h2>
        <div class="info-box">Einsatz: <strong>${casino.bet.toLocaleString('de-DE')} €</strong> auf <strong>${colorNames[casino.color]}</strong></div>
        <div style="text-align:center;margin:20px 0;">
            <div style="font-size:48px;font-weight:800;color:${colorStyles[casino.spin_color]};">${casino.number}</div>
            <div style="font-size:18px;font-weight:700;color:${colorStyles[casino.spin_color]};">${colorNames[casino.spin_color]}</div>
        </div>
        <div class="info-box" style="background:${casino.win?'rgba(63,185,80,.15)':'rgba(248,81,73,.15)'};">
            <strong>${casino.win ? 'Gewonnen!' : 'Verloren'}</strong><br>
            Auszahlung: ${casino.payout.toLocaleString('de-DE')} €
        </div>
        <div class="mfooter"><button class="btn success" onclick="acknowledgeCasino()">OK</button></div>
    `;
}

async function acknowledgeCasino() {
    const data = await _casinoRequest('/api/game/casino/acknowledge', null, 'Bestätigung fehlgeschlagen');
    if (!data) return;
    GS = data;
    casinoState = null;
    closeOv('ov-casino');
    updateUI(GS);
}

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
            btn.onclick = () => { closeOv("ov-card"); openCasino(c.game_type); };
        } else {
            btn.textContent = "OK — Verstanden";
            btn.disabled = false;
            btn.onclick = confirmCard;
        }
        btn.style.display = "block";
    } else {
        btn.disabled = true;
        btn.style.display = "block";
        btn.textContent = `Warte auf ${c.player}…`;
    }
    openOv("ov-card");
}

/* ── Zentrale UI-Aktualisierung ────────────────────────── */
function updateUI(s) {
    if (!s) return;
    const snapPos = {...prevPositions};
    const snapMoney = {...prevMoneys};
    const snapEvent = prevEventType;
    renderBoard(s);
    renderPlayers(s);
    updateBtns(s);
    updateTurnTimer(s);
    renderProps(s);
    checkWinner(s);
    checkPendingCard(s);
    checkRentPending(s);
    checkRentOffer(s);
    checkPendingTax(s);
    checkTradeIncoming(s);
    renderChat(s);
    runAnimations(s, snapPos, snapMoney, snapEvent);

    /* Casino-Zustand synchronisieren */
    if (s.active_casino && s.active_casino.player === ME) {
        if (!casinoState || casinoState.step === 'bet') {
            if (s.active_casino.game_type === 'blackjack') {
                casinoState = { gameType: 'blackjack', step: 'blackjack' };
            } else if (s.active_casino.game_type === 'roulette') {
                casinoState = { gameType: 'roulette', step: 'roulette-result' };
            }
            renderCasino();
            openOv('ov-casino');
        } else {
            if (casinoState.gameType === 'blackjack') renderBlackjackGame();
            else if (casinoState.gameType === 'roulette') renderRouletteResult();
        }
    } else if (!s.active_casino && casinoState) {
        casinoState = null;
        closeOv('ov-casino');
    }

    s.players?.forEach(p => {
        prevPositions[p.username] = p.position;
        prevMoneys[p.username] = p.money;
        oldState_bankruptMap[p.username] = p.is_bankrupt;
    });
    prevEventType = s.last_event?.type || null;
}

/* ── Init ──────────────────────────────────────────────── */
async function init() {
    try {
        const ri = await fetch("/api/room/info");
        if (ri.ok) { const rd = await ri.json(); IS_HOST = rd.is_host || false; }
    } catch(e) {}

    await fetchState(true);

    if (!GS) return;
    const me = GS.players?.find(p => p.username === ME);
    if (!me || (me.is_disconnected && !me.is_bankrupt)) {
        showJoinModal();
    }

    loadFriendsForInvite();
}

/* ── Freunde einladen ──────────────────────────────────── */
async function loadFriendsForInvite() {
    try {
        const res = await fetch("/api/friends/list");
        const data = await res.json();
        const list = document.getElementById("invite-friends-list");
        const empty = document.getElementById("invite-empty");
        const friends = data.friends || [];
        if (!friends.length) {
            list.style.display = "none";
            empty.style.display = "block";
            return;
        }
        list.style.display = "block";
        empty.style.display = "none";
        list.innerHTML = "";
        friends.forEach(u => {
            const el = document.createElement("div");
            el.className = "friend-item";
            el.style.cssText = "margin-bottom:6px;";
            el.innerHTML = `
                <div class="friend-avatar" style="background:linear-gradient(135deg,${u.avatar_color},${u.avatar_color}cc);width:32px;height:32px;font-size:16px;">${avatarContent(u)}</div>
                <div class="friend-info">
                    <div class="friend-name" style="font-size:13px;">${u.username}</div>
                    <div class="friend-status">${u.online ? 'Online' : 'Offline'}</div>
                </div>
                <button class="friend-btn invite" style="padding:5px 12px;font-size:12px;" onclick="inviteFriendToGame('${u.id}', this)">Einladen</button>
            `;
            list.appendChild(el);
        });
    } catch(e) { console.error(e); }
}

async function inviteFriendToGame(friendId, btn) {
    btn.disabled = true;
    btn.textContent = "Sende...";
    try {
        const res = await fetch("/api/friends/invite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ friend_id: friendId })
        });
        if (res.ok) {
            btn.textContent = "Gesendet!";
            btn.style.color = "var(--accent2)";
            btn.style.borderColor = "rgba(34,197,94,0.3)";
            btn.style.background = "rgba(34,197,94,0.1)";
        } else {
            const d = await res.json();
            btn.textContent = d.error || "Fehler";
            btn.style.color = "var(--danger)";
            setTimeout(() => { btn.disabled = false; btn.textContent = "Einladen"; btn.style.color = ""; btn.style.borderColor = ""; btn.style.background = ""; }, 2000);
        }
    } catch(e) {
        btn.disabled = false;
        btn.textContent = "Einladen";
    }
}

function openInviteModal() {
    loadFriendsForInvite();
    openOv("ov-invite");
}

/* ── Polling ───────────────────────────────────────────── */
init();

function scheduleStateRefresh() {
    clearTimeout(pollTm);
    const delay = document.hidden ? 15000 : 5000;
    pollTm = setTimeout(async () => {
        await fetchState(true);
        scheduleStateRefresh();
    }, delay);
}
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fetchState(true);
    scheduleStateRefresh();
});

async function _casinoRequest(url, body, fallbackError) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
            let msg = `${fallbackError} (HTTP ${res.status})`;
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                try { const d = await res.json(); if (d.error) msg = d.error; } catch(_) {}
            }
            toast('❌', msg);
            console.error('[Casino] HTTP error', res.status, url);
            return null;
        }
        const data = await res.json();
        if (!data.active_casino && !data.pending_card && url !== '/api/game/casino/acknowledge') {
            console.warn('[Casino] Response ohne active_casino:', data);
        }
        return data;
    } catch (e) {
        console.error('[Casino] Fetch/Parse error:', e);
        toast('❌', `Verbindungsfehler: ${e.message || 'Unbekannt'}`);
        return null;
    }
}
scheduleStateRefresh();