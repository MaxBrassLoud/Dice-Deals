/* =====================================================================
 * Dice Deals – Konstanten & globaler Zustand
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

const ME = window.DICE_DEALS_CONFIG.username;

const CMAP = { brown:"#795548", lightblue:"#29b6f6", pink:"#ec407a", orange:"#ff7043", red:"#ef5350", yellow:"#ffd740", green:"#66bb6a", darkblue:"#1565c0", station:"#78909c", utility:"#ab47bc", special:"transparent" };
const PCOLORS = {
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
