/* =====================================================================
 * Dice Deals – Casino (Roulette, Blackjack, Double or Nothing)
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

/* ── Casino ────────────────────────────────────────────── */
const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8,
    23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12,
    35, 3, 26
];
let rouletteWheelRotation = 0;

function buildRouletteWheelSVG() {
    const seg = 37, ang = 360 / seg;
    let paths = '', texts = '';
    for (let i = 0; i < seg; i++) {
        const number = ROULETTE_WHEEL_ORDER[i];  // ← Zahl an diesem Segment
        const a1 = (i * ang - 90) * Math.PI / 180;
        const a2 = ((i + 1) * ang - 90) * Math.PI / 180;
        const x1 = 100 + 95 * Math.cos(a1), y1 = 100 + 95 * Math.sin(a1);
        const x2 = 100 + 95 * Math.cos(a2), y2 = 100 + 95 * Math.sin(a2);
        const color = number === 0 ? '#16a34a'
                    : ROULETTE_RED.has(number) ? '#dc2626'
                    : '#1f2937';
        paths += `<path d="M100 100 L${x1.toFixed(2)} ${y1.toFixed(2)} A95 95 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z" fill="${color}" stroke="#0a0e1a" stroke-width="0.6"/>`;
        const mid = i * ang + ang / 2;
        const mr = (mid - 90) * Math.PI / 180;
        const tx = 100 + 72 * Math.cos(mr), ty = 100 + 72 * Math.sin(mr);
        texts += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" fill="#fff" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="middle" transform="rotate(${(mid - 90).toFixed(2)} ${tx.toFixed(2)} ${ty.toFixed(2)})">${number}</text>`;
    }
    return `<svg viewBox="0 0 200 200" class="roulette-wheel-svg" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="98" fill="#1a1f2e" stroke="#666" stroke-width="3"/>
        ${paths}
        <circle cx="100" cy="100" r="18" fill="#2a3040" stroke="#666" stroke-width="2"/>
        <circle cx="100" cy="100" r="6" fill="#e3b341"/>
    </svg>`;
}

function spinWheelTo(number) {
    const wheel = document.getElementById('roulette-wheel-svg-wrap');
    if (!wheel) return;
    const segIdx = ROULETTE_WHEEL_ORDER.indexOf(number);  // ← Segment zur Zahl finden
    if (segIdx === -1) return;
    const ang = 360 / 37;
    const targetOffset = -(segIdx + 0.5) * ang;  // ← segIdx statt number
    const curMod = ((rouletteWheelRotation % 360) + 360) % 360;
    const tgtMod = ((targetOffset % 360) + 360) % 360;
    const deltaMod = ((tgtMod - curMod) % 360 + 360) % 360;
    rouletteWheelRotation += 360 * 6 + deltaMod;
    wheel.style.transform = `rotate(${rouletteWheelRotation}deg)`;
}

const CASINO_HELP = {
    blackjack: {
        title: "♠️ Blackjack – So funktioniert's",
        body: `
            <ul class="help-list">
                <li><b>Ziel:</b> Komme mit deinen Karten so nah wie möglich an <b>21 Punkte</b> heran – ohne darüber zu kommen.</li>
                <li><b>Kartenwerte:</b> 2–10 = Nennwert · Bube/Dame/König = 10 · Ass = 1 oder 11.</li>
                <li><b>Hit:</b> Nimm eine weitere Karte.</li>
                <li><b>Stand:</b> Beende deinen Zug – der Dealer zieht bis mindestens 17.</li>
                <li><b>Gewinn:</b> Über 21 = verloren. Höher als Dealer = 2× Einsatz. Gleichstand = Einsatz zurück (Push).</li>
            </ul>`
    },
    roulette: {
        title: "🎡 Roulette – So funktioniert's",
        body: `
            <ul class="help-list">
                <li>Setze deinen Einsatz und wähle eine Farbe.</li>
                <li><b>Rot / Schwarz:</b> Zahlen 1–36 abwechselnd. Gewinn = <b>2× Einsatz</b>.</li>
                <li><b>Grün:</b> Die 0. Gewinn = <b>3× Einsatz</b>.</li>
                <li>Nach dem Dreh zeigt der Zeiger auf die Gewinnzahl.</li>
            </ul>`
    },
    double_or_nothing: {
        title: "💥 Double or Nothing – So funktioniert's",
        body: `
            <ul class="help-list">
                <li>Starte mit einem Einsatz.</li>
                <li><b>Verdoppeln:</b> 50/50 Chance, dass dein aktueller Wert <b>verdoppelt</b> wird – oder du verlierst <b>alles</b>.</li>
                <li><b>Aussteigen:</b> Nimm den aktuellen Wert jederzeit mit.</li>
                <li>Je länger du spielst, desto höher der Gewinn – aber auch das Risiko!</li>
            </ul>`
    }
};

function casinoHelpHTML(gameType) {
    const h = CASINO_HELP[gameType];
    if (!h) return '';
    return `<aside class="casino-help">
        <div class="casino-help-title">${h.title}</div>
        <div class="casino-help-body">${h.body}</div>
    </aside>`;
}

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
    const specBanner = casinoState?.spectator
        ? `<div class="casino-spec">👀 Du schaust zu – ${casinoState.player || 'Spieler'} ist am Zug. Aktionen sind deaktiviert.</div>`
        : '';
    const wrap = (main, help) => `<div class="casino-layout"><div class="casino-main">${specBanner}${main}</div>${help}</div>`;

    if (casinoState.step === 'bet') {
        if (casinoState.gameType === 'blackjack') {
            container.innerHTML = wrap(`
                <h2>♠️ Blackjack</h2>
                <p style="color:var(--text2);font-size:13px;margin-bottom:12px;">Wähle deinen Einsatz. Gewinn: 2× Einsatz, Push = Einsatz zurück.</p>
                <div class="info-box">Dein Guthaben: <strong style="color:var(--accent2);">${myMoney.toLocaleString('de-DE')} €</strong></div>
                <input class="tmoney" id="casino-bet" type="number" min="1" max="${myMoney}" value="${Math.min(100, myMoney)}" style="margin-bottom:12px;">
                <div class="mfooter">
                    <button class="btn" onclick="closeOv('ov-casino')">Abbrechen</button>
                    <button class="btn primary" onclick="startBlackjack()">Spiel starten</button>
                </div>`, casinoHelpHTML('blackjack'));
        } else if (casinoState.gameType === 'roulette') {
            container.innerHTML = wrap(`
                <h2>🎡 Roulette</h2>
                <p style="color:var(--text2);font-size:13px;margin-bottom:12px;">Rot/Schwarz zahlen 2×, Grün zahlt 3×.</p>
                <div class="info-box">Dein Guthaben: <strong style="color:var(--accent2);">${myMoney.toLocaleString('de-DE')} €</strong></div>
                <input class="tmoney" id="casino-bet" type="number" min="1" max="${myMoney}" value="${Math.min(100, myMoney)}" style="margin-bottom:12px;">
                <div class="section-lbl">Farbe wählen</div>
                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button class="btn" style="background:#dc2626;color:white;border:none;" onclick="setRouletteColor('red')" id="roulette-red">Rot (2×)</button>
                    <button class="btn" style="background:#1f2937;color:white;border:none;" onclick="setRouletteColor('black')" id="roulette-black">Schwarz (2×)</button>
                    <button class="btn" style="background:#16a34a;color:white;border:none;" onclick="setRouletteColor('green')" id="roulette-green">Grün (3×)</button>
                </div>
                <div class="mfooter">
                    <button class="btn" onclick="closeOv('ov-casino')">Abbrechen</button>
                    <button class="btn primary" onclick="playRoulette()">Drehen</button>
                </div>`, casinoHelpHTML('roulette'));
            casinoState.color = 'red';
            updateRouletteColorSelection();
        } else if (casinoState.gameType === 'double_or_nothing') {
            container.innerHTML = wrap(`
                <h2>💥 Double or Nothing</h2>
                <p style="color:var(--text2);font-size:13px;margin-bottom:12px;">Verdopple deinen Einsatz – oder verliere alles. Du kannst jederzeit aussteigen.</p>
                <div class="info-box">Dein Guthaben: <strong style="color:var(--accent2);">${myMoney.toLocaleString('de-DE')} €</strong></div>
                <input class="tmoney" id="casino-bet" type="number" min="1" max="${myMoney}" value="${Math.min(100, myMoney)}" style="margin-bottom:12px;">
                <div class="mfooter">
                    <button class="btn" onclick="closeOv('ov-casino')">Abbrechen</button>
                    <button class="btn primary" onclick="startDoubleOrNothing()">Spiel starten</button>
                </div>`, casinoHelpHTML('double_or_nothing'));
        }
    } else if (casinoState.step === 'blackjack') {
        renderBlackjackGame();
    } else if (casinoState.step === 'roulette-result') {
        renderRouletteResult();
    } else if (casinoState.step === 'double_or_nothing') {
        renderDoubleOrNothing();
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
        toast('❌', 'Server lieferte keine Casino-Daten – Backend prüfen');
        return;
    }
    GS = data;
    casinoState = { gameType: 'blackjack', step: 'blackjack', _resetCards: true };
    renderCasino();
    updateUI(GS);
}

function renderBlackjackGame() {
    const container = document.getElementById('casino-modal-content');
    const casino = GS?.active_casino;
    if (!casino || casino.game_type !== 'blackjack') {
        container.innerHTML = `<div class="casino-layout"><div class="casino-main"><h2>♠️ Blackjack</h2><div class="info-box">Kein aktives Spiel.</div><div class="mfooter"><button class="btn" onclick="closeOv('ov-casino')">Schließen</button></div></div>${casinoHelpHTML('blackjack')}</div>`;
        return;
    }
    if (!casinoState._prevPlayerLen) casinoState._prevPlayerLen = 0;
    if (!casinoState._prevDealerLen) casinoState._prevDealerLen = 0;
    if (casinoState._resetCards) { casinoState._prevPlayerLen = 0; casinoState._prevDealerLen = 0; casinoState._resetCards = false; }

    const newPlayer = casino.player_hand.length > casinoState._prevPlayerLen;
    const newDealer = casino.dealer_hand.length > casinoState._prevDealerLen;

    const renderCard = (card, hidden, isNew, index) => {
        const [rank, suit] = card;
        const red = suit === '♥' || suit === '♦';
        const showFace = !hidden;
        const cls = `bj-card${isNew ? ' bj-card-deal' : ''}`;
        const delay = isNew ? `style="animation-delay:${index * 0.12}s"` : '';
        return `<div class="${cls}" ${delay}>
            <div class="bj-card-inner${showFace ? '' : ' bj-card-back'}">
                ${showFace
                    ? `<div class="bj-rank" style="color:${red ? '#dc2626' : '#111'}">${rank}</div>
                       <div class="bj-suit" style="color:${red ? '#dc2626' : '#111'}">${suit}</div>`
                    : `<div class="bj-back-pattern">🎲</div>`}
            </div>
        </div>`;
    };

    const playerHTML = casino.player_hand.map((c, i) => renderCard(c, false, newPlayer && i >= casinoState._prevPlayerLen, i)).join('');
    const dealerHTML = casino.dealer_hand.map((c, i) => renderCard(c, i === 0 && casino.status === 'player_turn' && !casino.finished, newDealer && i >= casinoState._prevDealerLen, i)).join('');

    casinoState._prevPlayerLen = casino.player_hand.length;
    casinoState._prevDealerLen = casino.dealer_hand.length;

    const playerVal = casino.player_value;
    const dealerVal = casino.status === 'player_turn' && !casino.finished ? '?' : casino.dealer_value;
    let buttons = '';
    if (casinoState.spectator) {
        buttons = `<button class="btn" disabled>👀 ${casinoState.player || 'Spieler'} spielt…</button>`;
    } else if (casino.status === 'player_turn' && !casino.finished) {
        buttons = `<button class="btn primary" onclick="blackjackHit()">Hit</button>
                   <button class="btn" onclick="blackjackStand()">Stand</button>`;
    } else if (casino.finished) {
        buttons = `<button class="btn success" onclick="acknowledgeCasino()">OK</button>`;
    }

    const resultBanner = casino.finished ? `
        <div class="info-box bj-result ${casino.result}">
            <strong>${casino.result === 'win' ? '🎉 Gewonnen!' : casino.result === 'push' ? '🤝 Push – Einsatz zurück' : '😢 Verloren'}</strong><br>
            Auszahlung: ${casino.payout.toLocaleString('de-DE')} €
        </div>` : '';

    const main = `
        <h2>♠️ Blackjack</h2>
        <div class="info-box">Einsatz: <strong>${casino.bet.toLocaleString('de-DE')} €</strong> | Guthaben: <strong>${(GS.players.find(p=>p.username===ME)?.money||0).toLocaleString('de-DE')} €</strong></div>
        <div class="bj-table">
            <div class="section-lbl">Deine Hand (${playerVal})</div>
            <div class="bj-hand">${playerHTML}</div>
            <div class="section-lbl" style="margin-top:14px;">Dealer Hand (${dealerVal})</div>
            <div class="bj-hand">${dealerHTML}</div>
        </div>
        ${resultBanner}
        <div class="mfooter">${buttons}</div>`;

    container.innerHTML = `<div class="casino-layout"><div class="casino-main">${main}</div>${casinoHelpHTML('blackjack')}</div>`;
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
    const casino = GS?.active_casino;
    if (!casino || casino.game_type !== 'roulette') { closeOv('ov-casino'); return; }
    const colorNames = { red: 'Rot', black: 'Schwarz', green: 'Grün' };
    const colorStyles = { red: '#dc2626', black: '#374151', green: '#16a34a' };

    const main = `
        <h2>🎡 Roulette</h2>
        <div class="roulette-stage">
            <div class="roulette-pointer">▼</div>
            <div class="roulette-wheel-svg-wrap" id="roulette-wheel-svg-wrap">${buildRouletteWheelSVG()}</div>
        </div>
        <div class="roulette-result" id="roulette-result">
            <div class="roulette-number" style="color:${colorStyles[casino.spin_color]};">${casino.number}</div>
            <div class="roulette-color" style="color:${colorStyles[casino.spin_color]};">${colorNames[casino.spin_color]}</div>
        </div>
        <div class="info-box ${casino.win ? 'bj-result win' : 'bj-result lose'}" style="text-align:center;">
            <strong>${casino.win ? '🎉 Gewonnen!' : '😢 Verloren'}</strong> · Auszahlung: ${casino.payout.toLocaleString('de-DE')} €
        </div>
        <div class="mfooter">${casinoState.spectator
            ? `<button class="btn" disabled>👀 ${casinoState.player || 'Spieler'} spielt…</button>`
            : `<button class="btn success" onclick="acknowledgeCasino()">OK</button>`}</div>`;

    container.innerHTML = `<div class="casino-layout"><div class="casino-main">${main}</div>${casinoHelpHTML('roulette')}</div>`;

    setTimeout(() => {
        const wheel = document.getElementById('roulette-wheel-svg-wrap');
        if (wheel) {
            wheel.style.transform = `rotate(${rouletteWheelRotation}deg)`;
            requestAnimationFrame(() => spinWheelTo(casino.number));
        }
        const resEl = document.getElementById('roulette-result');
        if (resEl) setTimeout(() => resEl.classList.add('show'), 3800);
    }, 100);
}

async function startDoubleOrNothing() {
    const betInput = document.getElementById('casino-bet');
    const bet = parseInt(betInput?.value);
    if (isNaN(bet) || bet <= 0) { toast('❌', 'Bitte gültigen Einsatz eingeben'); return; }
    const me = GS?.players?.find(p => p.username === ME);
    if (!me || bet > (me.money || 0)) { toast('❌', `Einsatz übersteigt Guthaben (${(me?.money||0).toLocaleString('de-DE')} €)`); return; }
    const data = await _casinoRequest('/api/game/casino/start', { game_type: 'double_or_nothing', bet }, 'Start fehlgeschlagen');
    if (!data) return;
    if (!data.active_casino) { toast('❌', 'Server lieferte keine Casino-Daten'); return; }
    GS = data;
    casinoState = { gameType: 'double_or_nothing', step: 'double_or_nothing', _lastRound: 0 };
    renderCasino();
    updateUI(GS);
}

function renderDoubleOrNothing() {
    const container = document.getElementById('casino-modal-content');
    const casino = GS?.active_casino;
    if (!casino || casino.game_type !== 'double_or_nothing') { closeOv('ov-casino'); return; }

    const me = GS.players.find(p => p.username === ME);
    const canAct = !casino.finished;
    const lastRound = casinoState._lastRound || 0;
    const newRound = casino.rounds > lastRound;
    const justWon = newRound && casino.last_result === 'win';
    const justLost = newRound && casino.last_result === 'lose';

    const historyHTML = (casino.history || []).slice(-5).reverse().map(h =>
        `<div class="don-history-row ${h.result}">
            <span>Runde ${h.round}</span>
            <span>${h.result === 'win' ? '🎉 Verdoppelt' : h.result === 'lose' ? '💀 Verloren' : '💰 Ausgestiegen'}</span>
            <span>${h.value.toLocaleString('de-DE')} €</span>
        </div>`).join('');

    let valueDisplay;
    if (casino.finished && casino.last_result === 'lose') {
        valueDisplay = `<div class="don-value lost">0 €</div>`;
    } else if (casino.finished && casino.last_result === 'cashout') {
        valueDisplay = `<div class="don-value cashed">${casino.payout.toLocaleString('de-DE')} €</div>`;
    } else {
        valueDisplay = `<div class="don-value ${justWon ? 'doubling' : ''}">${casino.current_value.toLocaleString('de-DE')} €</div>`;
    }

    let buttons = '';
    if (casinoState.spectator) {
        buttons = `<button class="btn" disabled>👀 ${casinoState.player || 'Spieler'} spielt…</button>`;
    } else if (canAct) {
        buttons = `
            <button class="btn danger" onclick="doubleOrNothingContinue()">🎲 Verdoppeln (50/50)</button>
            <button class="btn success" onclick="doubleOrNothingCashout()">💰 Aussteigen (${casino.current_value.toLocaleString('de-DE')} €)</button>`;
    } else {
        buttons = `<button class="btn success" onclick="acknowledgeCasino()">OK</button>`;
    }

    const main = `
        <h2>💥 Double or Nothing</h2>
        <div class="info-box" style="text-align:center;">
            Einsatz: <strong>${casino.bet.toLocaleString('de-DE')} €</strong> · Runde <strong>${casino.rounds}</strong>
        </div>
        <div class="don-stage">
            <div class="don-value-label">Aktueller Wert</div>
            ${valueDisplay}
            <div class="don-coin ${justWon ? 'flip-win' : ''}${justLost ? 'flip-lose' : ''}">🪙</div>
        </div>
        ${casino.history?.length ? `<div class="don-history"><div class="section-lbl">Verlauf</div>${historyHTML}</div>` : ''}
        <div class="mfooter">${buttons}</div>`;

    container.innerHTML = `<div class="casino-layout"><div class="casino-main">${main}</div>${casinoHelpHTML('double_or_nothing')}</div>`;
    casinoState._lastRound = casino.rounds;
}

async function doubleOrNothingContinue() {
    const data = await _casinoRequest('/api/game/casino/double_or_nothing/continue', null, 'Verdoppeln fehlgeschlagen');
    if (!data) return;
    GS = data;
    renderDoubleOrNothing();
    updateUI(GS);
}

async function doubleOrNothingCashout() {
    const data = await _casinoRequest('/api/game/casino/double_or_nothing/cashout', null, 'Aussteigen fehlgeschlagen');
    if (!data) return;
    GS = data;
    renderDoubleOrNothing();
    updateUI(GS);
}

async function acknowledgeCasino() {
    const data = await _casinoRequest('/api/game/casino/acknowledge', null, 'Bestätigung fehlgeschlagen');
    if (!data) return;
    GS = data;
    casinoState = null;
    closeOv('ov-casino');
    updateUI(GS);
}
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
