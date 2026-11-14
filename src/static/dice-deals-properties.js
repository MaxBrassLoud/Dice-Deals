/* =====================================================================
 * Dice Deals – Eigene Grundstücke, Bauen/Hypothek/Verkauf
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

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
async function buildProp(name,type){ const res=await fetch("/api/game/build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,type})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Bauen fehlgeschlagen");return;} GS=await res.json(); const fi=GS.board?.findIndex(f=>f.name===name); if(fi!==-1){pulseField(fi,"buy");await new Promise(r=>setTimeout(r,80));} updateUI(GS); toast("🏗️",GS.status);}
async function takeMortgage(name){ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,action:"take"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("🏦",GS.status);}
async function liftMortgage(name){ const res=await fetch("/api/game/mortgage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,action:"lift"})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Fehler");return;} GS=await res.json(); updateUI(GS); toast("✅",GS.status);}
async function sellProp(name,type){ const label=type==="hotel"?"Hotel":"Haus"; if(!confirm(`${label} auf "${name}" verkaufen und ${type==="hotel"?"Hotel":"Haus"}kosten zurückerhalten?`)) return; const res=await fetch("/api/game/sell_building",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({property:name,type})}); if(!res.ok){const d=await res.json();toast("❌",d.error||"Verkauf fehlgeschlagen");return;} GS=await res.json(); updateUI(GS); toast("🔨",GS.status);}
