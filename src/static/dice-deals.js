/* =====================================================================
 * Dice Deals – Hauptdatei (UI-Update, Aktionen, Join/Invite, Polling)
 * ZULETZT laden: enthält die einzigen Top-Level-Aufrufe init()/scheduleStateRefresh().
 * ===================================================================== */





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
    let frame = 0, totalFrames = 10;
    const rollInterval = setInterval(() => { d1.textContent = DICE_FACES[1+Math.floor(Math.random()*6)]; d2.textContent = DICE_FACES[1+Math.floor(Math.random()*6)]; d1.classList.toggle("rolling", frame%2===0); d2.classList.toggle("rolling", frame%2===1); frame++; if(frame>=totalFrames) clearInterval(rollInterval); }, 60);
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
async function buyOutOfJail() { const res=await fetch("/api/game/buy_out_of_jail",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🔓",GS.status);}
async function endTurn(){ const btn=document.getElementById("btn-end"); btn.style.transform="scale(.95)"; setTimeout(()=>btn.style.transform="",150); const res=await fetch("/api/game/end_turn",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); animateTurnChange(); updateUI(GS);}
async function kickPlayer(username){ if(!confirm(`${username} wirklich aus dem Spiel entfernen?`)) return; const res=await fetch("/api/room/kick",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🚫",`${username} wurde entfernt.`);}
async function confirmCard(){
    const res = await fetch("/api/game/confirm_card", {method:"POST"});
    if (!res.ok) { const d = await res.json(); toast("❌", d.error || "Fehler"); return; }
    closeOv("ov-card");          // ← erst NACH dem Fetch schließen
    GS = await res.json();
    updateUI(GS);
}
async function useJailCard(){ const res=await fetch("/api/game/use_jail_card",{method:"POST"}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🃏",GS.status);}




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

    if (s.active_casino) {
        const ac = s.active_casino;
        if (ac.player === ME) {
            if (!casinoState || casinoState.step === 'bet') {
                if (ac.game_type === 'blackjack') {
                    casinoState = { gameType: 'blackjack', step: 'blackjack', _resetCards: true };
                } else if (ac.game_type === 'roulette') {
                    casinoState = { gameType: 'roulette', step: 'roulette-result' };
                } else if (ac.game_type === 'double_or_nothing') {
                    casinoState = { gameType: 'double_or_nothing', step: 'double_or_nothing', _lastRound: 0 };
                }
                renderCasino();
                openOv('ov-casino');
            } else {
                if (casinoState.gameType === 'blackjack') renderBlackjackGame();
                else if (casinoState.gameType === 'roulette') renderRouletteResult();
                else if (casinoState.gameType === 'double_or_nothing') renderDoubleOrNothing();
            }
        } else {
            // Zuschauer: Casino-Spiel live mitlesen, aber keine Aktionen
            const specKey = ac.player + '|' + ac.game_type;
            if (!casinoState || casinoState._specKey !== specKey) {
                if (ac.game_type === 'blackjack') {
                    casinoState = { gameType: 'blackjack', step: 'blackjack', _resetCards: true, spectator: true, player: ac.player, _specKey: specKey };
                } else if (ac.game_type === 'roulette') {
                    casinoState = { gameType: 'roulette', step: 'roulette-result', spectator: true, player: ac.player, _specKey: specKey };
                } else if (ac.game_type === 'double_or_nothing') {
                    casinoState = { gameType: 'double_or_nothing', step: 'double_or_nothing', _lastRound: 0, spectator: true, player: ac.player, _specKey: specKey };
                }
            }
            renderCasino();
            openOv('ov-casino');
        }
    } else if (!s.active_casino && casinoState && casinoState.step !== 'bet') {
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

scheduleStateRefresh();