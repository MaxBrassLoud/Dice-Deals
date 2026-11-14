/* =====================================================================
 * Dice Deals – Spielfeld, Feld-/Token-Animationen, Tooltip
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

let prevCurrentPlayer = null;

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
    if (newState.current_player !== prevCurrentPlayer) {
        animateTurnChange();
        prevCurrentPlayer = newState.current_player;
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
            if (isCurrentField) {
                el.classList.add("current-turn");
                el.style.setProperty("--pc", PCOLORS[curP.color] || curP.avatar_color || "#e3b341");
            }
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
                    // Besitzerfarbe = dieselbe Kette wie Token/Karte (avatar_color → PCOLORS),
                    // damit Karte, Token und Besitzmarkierung überall übereinstimmen.
                    const owner = s.players.find(pl => pl.username === f.owner);
                    const ownerColor = owner
                        ? (PCOLORS[owner.color] || owner.avatar_color || "#888")
                        : (PCOLORS[f.owner_color] || "#888");
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
                    t.style.background = `linear-gradient(135deg,${PCOLORS[p.color]||p.avatar_color||'#888'},${(PCOLORS[p.color]||p.avatar_color||'#888')}cc)`;
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
    const pips = s.players.map(p => `<div class="center-pip"><div class="cpip-dot" style="background:linear-gradient(135deg,${PCOLORS[p.color]||p.avatar_color||'#888'},${(PCOLORS[p.color]||p.avatar_color||'#888')}cc);font-size:10px;display:flex;align-items:center;justify-content:center;">${avatarContent(p)}</div>${p.username.substring(0,8)}</div>`).join("");
    const pot = s.free_parking_pot || 0;
    const potHTML = pot > 0 ? `<div class="parking-pot">🅿️ <span>${pot.toLocaleString("de-DE")} €</span></div>` : `<div class="parking-pot empty">🅿️ Topf leer</div>`;
    const startHTML = s.started ? "" : (IS_HOST
        ? `<button class="btn success center-start-btn" id="btn-start-game" onclick="startGame()">▶ Spiel starten</button>`
        : `<div class="center-wait">⏳ Warte auf Spielstart des Hosts…<br><span class="cw-sub">${s.players.length} Spieler im Raum</span></div>`);
    center.innerHTML = `<div class="center-logo"><div class="title">Dice Deals</div><div class="sub">${s.players.length} Spieler${s.current_player ? " · " + s.current_player + " am Zug" : ""}</div>${potHTML}<div class="player-pips">${pips}</div></div>${startHTML}`;
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
