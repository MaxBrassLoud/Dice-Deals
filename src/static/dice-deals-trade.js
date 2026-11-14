/* =====================================================================
 * Dice Deals – Handel
 * Mehrere parallele Trades, Storno, Gefängnisfreikarten, Asset-Lock.
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

/* ── Handel ─────────────────────────────────────────────── */
let tradeTarget = null;    // gewählter Mitspieler im Composer
let counterTradeId = null; // null = Neues Angebot, sonst Gegenangebot zu dieser trade_id
let tradeDraft = null;     // {myProps:[],myMoney,myCards,theirProps:[],theirMoney,theirCards}
let lastIncomingCount = 0;

function tradesOf(s){ return (s && s.trades) || []; }
function incomingTrades(s){ return tradesOf(s).filter(t => t.to === ME); }
function outgoingTrades(s){ return tradesOf(s).filter(t => t.from === ME); }

function lockedProps(excludeId){
    const s = new Set();
    for (const t of tradesOf(GS)){
        if (excludeId && t.id === excludeId) continue;
        (t.my_props||[]).forEach(n => s.add(n));
        (t.their_props||[]).forEach(n => s.add(n));
    }
    return s;
}
function lockedCardsFor(username, excludeId){
    let n = 0;
    for (const t of tradesOf(GS)){
        if (excludeId && t.id === excludeId) continue;
        if (t.from === username) n += t.my_jail_cards || 0;
        if (t.to === username) n += t.their_jail_cards || 0;
    }
    return n;
}

function checkTradeIncoming(s){
    const n = incomingTrades(s).length;
    const badge = document.getElementById("trade-badge");
    if (badge){
        if (n > 0){ badge.style.display = "inline-flex"; badge.textContent = n; }
        else badge.style.display = "none";
    }
    if (n > lastIncomingCount && !document.getElementById("ov-trade").classList.contains("show")){
        const t = incomingTrades(s)[0];
        toast("🤝", `${t.from} möchte handeln!`);
    }
    lastIncomingCount = n;
    // Offene Übersicht bei neuen Angeboten live aktualisieren (Composer nicht stören)
    const ov = document.getElementById("ov-trade");
    if (ov && ov.classList.contains("show") && !tradeTarget && !counterTradeId){
        buildTradeHome(document.getElementById("trade-modal"));
    }
}
function openTrade(){ lastIncomingCount = incomingTrades(GS).length; tradeTarget = null; counterTradeId = null; tradeDraft = null; buildTrade(); openOv("ov-trade"); document.getElementById("trade-badge").style.display = "none"; }
function buildTrade(){ const modal = document.getElementById("trade-modal"); if (!modal) return; if (!tradeDraft) buildTradeHome(modal); else buildComposer(modal); }

/* ── Übersicht (ein-/ausgehende Angebote) ─────────────── */
function tradeChipsHTML(names, owner, money, cards){
    let h = "";
    for (const n of names || []){
        const p = (owner ? owner.properties : []).find(x => x.name === n);
        h += `<span class="prop-chip"><div style="width:8px;height:8px;border-radius:50%;background:${CMAP[p?.color_group]||"#888"};flex-shrink:0"></div>${n} (${(p?.price||0).toLocaleString("de-DE")}€)</span>`;
    }
    if (money) h += `<span class="prop-chip">💰 ${money.toLocaleString("de-DE")} €</span>`;
    if (cards) h += `<span class="prop-chip">🃏 ×${cards}</span>`;
    return h || `<span style="color:var(--text2);font-size:11px;">Nichts</span>`;
}
function tradeValue(props, money, owner){
    return (props||[]).reduce((s,n)=>{ const p = (owner?.properties||[]).find(x=>x.name===n); return s + (p?.price||0); }, 0) + (money||0);
}
function buildTradeHome(modal){
    const me = GS?.players?.find(p=>p.username===ME);
    const inc = incomingTrades(GS);
    const out = outgoingTrades(GS);
    let list = "";
    for (const t of inc){
        const them = GS?.players?.find(p=>p.username===t.from);
        const themColor = PCOLORS[them?.color]||"#888";
        const getV = tradeValue(t.my_props, t.my_money, them);
        const giveV = tradeValue(t.their_props, t.their_money, me);
        const diff = getV - giveV;
        const bl = diff>0 ? `+${diff.toLocaleString("de-DE")} € für dich` : diff<0 ? `${(-diff).toLocaleString("de-DE")} € zu deinen Lasten` : "Ausgeglichen";
        list += `<div class="trade-card incoming">
            <div class="tc-head"><div class="tdot" style="background:${themColor}"></div><span class="tc-name">${t.from}</span><span class="tc-badge incoming">Angebot</span></div>
            <div class="tc-cols">
                <div><div class="tsec">Du bekommst</div><div class="tc-chips">${tradeChipsHTML(t.my_props, them, t.my_money, t.my_jail_cards)}</div></div>
                <div><div class="tsec">Du gibst</div><div class="tc-chips">${tradeChipsHTML(t.their_props, me, t.their_money, t.their_jail_cards)}</div></div>
            </div>
            <div class="tc-status">Bilanz: <b>${bl}</b></div>
            ${(t.history||[]).length>1 ? `<div class="thist">${(t.history||[]).map(h=>`<div class="hent"><span class="hwho">${h.by}</span>: ${h.action}</div>`).join("")}</div>` : ""}
            <div class="tc-actions">
                <button class="btn danger" onclick="respondTrade('reject','${t.id}')">✗ Ablehnen</button>
                <button class="btn warning" onclick="startCounter('${t.id}')">↩ Gegenangebot</button>
                <button class="btn success" onclick="respondTrade('accept','${t.id}')">✓ Annehmen</button>
            </div>
        </div>`;
    }
    for (const t of out){
        const them = GS?.players?.find(p=>p.username===t.to);
        const themColor = PCOLORS[them?.color]||"#888";
        list += `<div class="trade-card outgoing">
            <div class="tc-head"><div class="tdot" style="background:${themColor}"></div><span class="tc-name">${t.to}</span><span class="tc-badge outgoing">Offen</span></div>
            <div class="tc-cols">
                <div><div class="tsec">Du gibst</div><div class="tc-chips">${tradeChipsHTML(t.my_props, me, t.my_money, t.my_jail_cards)}</div></div>
                <div><div class="tsec">Du bekommst</div><div class="tc-chips">${tradeChipsHTML(t.their_props, them, t.their_money, t.their_jail_cards)}</div></div>
            </div>
            <div class="tc-status">⏳ Warte auf Antwort…</div>
            <div class="tc-actions">
                <button class="btn danger" onclick="cancelTrade('${t.id}')">🔙 Zurücknehmen</button>
            </div>
        </div>`;
    }
    if (!list) list = `<div class="trade-empty">Noch keine Handelsangebote.<br>Starte ein neues Angebot – auch mehrere parallel sind möglich.<br><span style="font-size:10px;">Grundstücke und Freikarten in laufenden Angeboten sind gesperrt.</span></div>`;
    modal.innerHTML = `<h2>🤝 Handel</h2>
        <div class="trades-list">${list}</div>
        <div class="mfooter"><button class="btn" onclick="closeOv('ov-trade')">Schließen</button><button class="btn primary" onclick="startComposer(null)">➕ Neues Angebot</button></div>`;
}

/* ── Composer (neu / Gegenangebot) ─────────────────────── */
function startComposer(target, prefill, tradeId){
    tradeTarget = target || null;
    counterTradeId = tradeId || null;
    tradeDraft = prefill || { myProps:[], myMoney:0, myCards:0, theirProps:[], theirMoney:0, theirCards:0 };
    buildComposer(document.getElementById("trade-modal"));
}
function startCounter(tradeId){
    const t = tradesOf(GS).find(x => x.id === tradeId);
    if (!t) return;
    startComposer(t.from, {
        myProps: [...(t.their_props||[])],
        myMoney: t.their_money || 0,
        myCards: t.their_jail_cards || 0,
        theirProps: [...(t.my_props||[])],
        theirMoney: t.my_money || 0,
        theirCards: t.my_jail_cards || 0,
    }, tradeId);
}
function backToTradeHome(){ tradeTarget = null; counterTradeId = null; tradeDraft = null; buildTradeHome(document.getElementById("trade-modal")); }

function buildComposer(modal){
    const me = GS?.players?.find(p=>p.username===ME);
    const them = tradeTarget ? GS?.players?.find(p=>p.username===tradeTarget) : null;
    const others = (GS?.players||[]).filter(p=>p.username!==ME && !p.is_bankrupt);
    const title = counterTradeId
        ? `↩ Gegenangebot an <span style="color:${PCOLORS[them?.color]||"#888"}">${them?.username||""}</span>`
        : "🤝 Neues Angebot";
    modal.innerHTML = `<h2>${title}</h2>
        ${counterTradeId ? "" : `<select class="psel" id="tgt-sel">
            <option value="">-- Spieler wählen --</option>
            ${others.map(p=>`<option value="${p.username}" ${p.username===tradeTarget?"selected":""}>${p.username} (${p.money.toLocaleString("de-DE")} €)</option>`).join("")}
        </select>`}
        <div class="tgrid">
            <div class="tside">
                <h3><div class="tdot" style="background:${PCOLORS[me?.color]||"#888"}"></div>Du gibst</h3>
                <div class="tsec">Grundstücke</div>
                <div id="t-my-props">${composerPropsHTML(me?.properties||[], "my")}</div>
                <div class="tsec">🃏 Gefängnisfreikarten</div>
                ${cardsRowHTML("my", Math.max(0, (me?.get_out_of_jail_cards||0) - lockedCardsFor(ME, counterTradeId)))}
                <div class="tsec">💰 Geld</div>
                <div class="tmoney-row"><input class="tmoney" id="t-my-money" type="number" min="0" placeholder="0" value="${tradeDraft.myMoney||""}" oninput="draftMoney('my')"><span style="color:var(--text2);font-size:12px;">€</span></div>
            </div>
            <div class="tmid">⇄</div>
            <div class="tside">
                <h3><div class="tdot" style="background:${them?PCOLORS[them.color]||"#888":"#666"}"></div>${them?them.username:"Du bekommst"}</h3>
                <div class="tsec">Grundstücke</div>
                <div id="t-their-props">${them?composerPropsHTML(them.properties||[], "their"):`<p style="font-size:11px;color:var(--text2);">Wähle zuerst einen Spieler.</p>`}</div>
                <div class="tsec">🃏 Gefängnisfreikarten</div>
                ${cardsRowHTML("their", Math.max(0, (them?.get_out_of_jail_cards||0) - lockedCardsFor(tradeTarget, counterTradeId)))}
                <div class="tsec">💰 Geld</div>
                <div class="tmoney-row"><input class="tmoney" id="t-their-money" type="number" min="0" placeholder="0" value="${tradeDraft.theirMoney||""}" oninput="draftMoney('their')"><span style="color:var(--text2);font-size:12px;">€</span></div>
            </div>
        </div>
        <div class="tsum" id="t-sum"></div>
        <div class="mfooter">
            <button class="btn" onclick="backToTradeHome()">← Zurück</button>
            <button class="btn primary" onclick="submitTrade()">${counterTradeId?"↩ Gegenangebot senden":"📤 Angebot senden"}</button>
        </div>`;
    if (!counterTradeId){
        document.getElementById("tgt-sel").addEventListener("change", e=>{
            tradeTarget = e.target.value || null;
            tradeDraft.theirProps = [];
            tradeDraft.theirMoney = 0;
            tradeDraft.theirCards = 0;
            buildComposer(modal);
        });
    }
    updateComposerSum();
}
function composerPropsHTML(props, side){
    const locked = lockedProps(counterTradeId);
    if (!props.length) return `<p style="font-size:11px;color:var(--text2);">Keine Grundstücke.</p>`;
    return props.map(prop=>{
        const c = CMAP[prop.color_group]||"#888";
        const inO = (side==="my" ? tradeDraft.myProps : tradeDraft.theirProps).includes(prop.name);
        const lk = locked.has(prop.name);
        return `<div class="tprop${inO?" in-offer":""}${lk?" locked":""}" id="tp-${side}-${prop.name.replace(/[\s\/]/g,"-")}" onclick="toggleDraftProp('${prop.name.replace(/'/g,"\\'")}','${side}')"><div class="pdot" style="background:${c}"></div><span style="flex:1">${prop.name}</span><span class="tpval">${prop.price.toLocaleString("de-DE")}€${lk?" 🔒":""}</span></div>`;
    }).join("");
}
function cardsRowHTML(side, avail){
    const cur = side==="my" ? tradeDraft.myCards : tradeDraft.theirCards;
    return `<div class="cards-row"><div class="stepper"><button onclick="stepCards('${side}',-1)">−</button><span class="cnt" id="t-${side}-cards">${cur}</span><button onclick="stepCards('${side}',1)">+</button></div><span style="color:var(--text2);">verfügbar: ${avail}</span></div>`;
}
function availCards(side){
    if (side==="my") return Math.max(0, (GS?.players?.find(p=>p.username===ME)?.get_out_of_jail_cards||0) - lockedCardsFor(ME, counterTradeId));
    return Math.max(0, (GS?.players?.find(p=>p.username===tradeTarget)?.get_out_of_jail_cards||0) - lockedCardsFor(tradeTarget, counterTradeId));
}
function toggleDraftProp(name, side){
    if (lockedProps(counterTradeId).has(name)) return;
    const arr = side==="my" ? tradeDraft.myProps : tradeDraft.theirProps;
    const i = arr.indexOf(name);
    if (i===-1) arr.push(name); else arr.splice(i,1);
    buildComposer(document.getElementById("trade-modal"));
}
function stepCards(side, d){
    const max = availCards(side);
    if (side==="my") tradeDraft.myCards = Math.min(max, Math.max(0, tradeDraft.myCards + d));
    else tradeDraft.theirCards = Math.min(max, Math.max(0, tradeDraft.theirCards + d));
    buildComposer(document.getElementById("trade-modal"));
}
function draftMoney(side){
    if (!tradeDraft) return;
    if (side==="my") tradeDraft.myMoney = Math.max(0, parseInt(document.getElementById("t-my-money")?.value||"0")||0);
    else tradeDraft.theirMoney = Math.max(0, parseInt(document.getElementById("t-their-money")?.value||"0")||0);
    updateComposerSum();
}
function updateComposerSum(){
    const c = document.getElementById("t-sum"); if (!c) return;
    const me = GS?.players?.find(p=>p.username===ME);
    const them = tradeTarget ? GS?.players?.find(p=>p.username===tradeTarget) : null;
    const myV = tradeValue(tradeDraft.myProps, tradeDraft.myMoney, me);
    const thV = tradeValue(tradeDraft.theirProps, tradeDraft.theirMoney, them);
    const diff = thV - myV;
    const bc = diff>100 ? "pos" : diff<-100 ? "neg" : "neu";
    const bl = diff>0 ? `+${diff.toLocaleString("de-DE")} € zu deinen Gunsten` : diff<0 ? `${(-diff).toLocaleString("de-DE")} € zu deinen Lasten` : "Ausgeglichener Tausch";
    const pros = [], cons = [];
    if (tradeDraft.theirProps.length) pros.push(`+${tradeDraft.theirProps.length} Grundstück(e) erhalten`);
    if (tradeDraft.myProps.length) cons.push(`−${tradeDraft.myProps.length} Grundstück(e) abgeben`);
    if (tradeDraft.theirMoney) pros.push(`+${tradeDraft.theirMoney.toLocaleString("de-DE")} € erhalten`);
    if (tradeDraft.myMoney) cons.push(`−${tradeDraft.myMoney.toLocaleString("de-DE")} € zahlen`);
    if (tradeDraft.theirCards) pros.push(`+${tradeDraft.theirCards} Gefängnisfreikarte(n)`);
    if (tradeDraft.myCards) cons.push(`−${tradeDraft.myCards} Gefängnisfreikarte(n)`);
    c.innerHTML = `<div class="tsum-row"><span>Du bietest (Wert)</span><span class="val">${myV.toLocaleString("de-DE")} €</span></div>
        <div class="tsum-row"><span>${them?.username||"Gegenüber"} gibt (Wert)</span><span class="val">${thV.toLocaleString("de-DE")} €</span></div>
        <div class="tsum-row bal ${bc}"><span>Bilanz</span><span class="val">${bl}</span></div>
        <div class="pro-con">${pros.map(p=>`<div class="pro">✓ ${p}</div>`).join("")}${cons.map(p=>`<div class="con">✗ ${p}</div>`).join("")}</div>`;
}
async function submitTrade(){
    if (!counterTradeId && !tradeTarget){ toast("❌","Wähle einen Mitspieler"); return; }
    const d = tradeDraft;
    if (!d.myProps.length && !d.myMoney && !d.theirProps.length && !d.theirMoney && !d.myCards && !d.theirCards){ toast("❌","Angebot ist leer"); return; }
    const body = counterTradeId
        ? { action:"counter", trade_id: counterTradeId, my_props:d.myProps, my_money:d.myMoney, their_props:d.theirProps, their_money:d.theirMoney, my_jail_cards:d.myCards, their_jail_cards:d.theirCards }
        : { to:tradeTarget, my_props:d.myProps, my_money:d.myMoney, their_props:d.theirProps, their_money:d.theirMoney, my_jail_cards:d.myCards, their_jail_cards:d.theirCards };
    const url = counterTradeId ? "/api/trade/respond" : "/api/trade/send";
    const res = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    if (!res.ok){ const j = await res.json().catch(()=>({})); toast("❌", j.error||"Fehler"); return; }
    GS = await res.json();
    const msg = counterTradeId ? "Gegenangebot gesendet" : `Angebot an ${tradeTarget} gesendet`;
    tradeTarget = null; counterTradeId = null; tradeDraft = null;
    updateUI(GS);
    buildTradeHome(document.getElementById("trade-modal"));
    toast("📤", msg);
}

/* ── Aktionen auf bestehende Angebote ──────────────────── */
async function respondTrade(action, tradeId){
    const res = await fetch("/api/trade/respond", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action, trade_id: tradeId }) });
    if (!res.ok){ const d = await res.json().catch(()=>({})); toast("❌", d.error||"Fehler"); return; }
    GS = await res.json();
    updateUI(GS);
    buildTradeHome(document.getElementById("trade-modal"));
    toast(action==="accept"?"🤝":action==="reject"?"❌":"↩", {accept:"Handel angenommen!", reject:"Handel abgelehnt.", counter:"Gegenangebot gesendet"}[action]);
}
async function cancelTrade(tradeId){
    const res = await fetch("/api/trade/cancel", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ trade_id: tradeId }) });
    if (!res.ok){ const d = await res.json().catch(()=>({})); toast("❌", d.error||"Fehler"); return; }
    GS = await res.json();
    updateUI(GS);
    buildTradeHome(document.getElementById("trade-modal"));
    toast("🔙","Angebot zurückgenommen");
}
