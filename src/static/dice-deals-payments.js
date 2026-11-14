/* =====================================================================
 * Dice Deals – Miete & Steuer (inkl. Liquidations-Panels)
 * Klassisches Script (keine ESM): Inline-onclick-Handler brauchen
 * globale Funktionsnamen. Ladereihenfolge im Template beachten!
 * ===================================================================== */

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
