/* ═══════════════════════════════════════════════════════
   OTC TOURNAMENT OPTIONS MARKET
   Supabase-backed · GitHub Pages ready
   ═══════════════════════════════════════════════════════ */

// ── CONFIGURACIÓN SUPABASE ──────────────────────────────
// Reemplazá estos valores con los de tu proyecto Supabase
// Los encontrás en: Settings → API
const SUPABASE_URL      = 'TU_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ═══════════════════════════════
   STATE (caché local del DB)
═══════════════════════════════ */
const S = {
  countries:   [],
  prizeTable:  {},
  auctionPrices: {},
  users:       [],
  orders:      [],
  trades:      [],
  settings:    { minQty: 1, maxQty: 5 },
  gameState:   'open',
  currentUser: localStorage.getItem('otc_user') || null,
};

/* ═══════════════════════════════
   LOADING STATE
═══════════════════════════════ */
function showLoading(msg = 'Conectando al mercado...') {
  const ov = document.getElementById('loading-overlay');
  ov.querySelector('.loader-msg').textContent = msg;
  ov.classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

/* ═══════════════════════════════
   CARGA DESDE SUPABASE
═══════════════════════════════ */
async function loadState() {
  const [
    { data: settings },
    { data: players },
    { data: teams },
    { data: prizes },
    { data: orders },
    { data: trades },
  ] = await Promise.all([
    db.from('game_settings').select('*'),
    db.from('players').select('*').order('name'),
    db.from('teams').select('*').order('display_order'),
    db.from('prizes').select('*').order('position'),
    db.from('orders').select('*').order('created_at'),
    db.from('trades').select('*').order('created_at'),
  ]);

  const gs      = (settings || []).find(r => r.key === 'game_state');
  const minQCfg = (settings || []).find(r => r.key === 'min_qty');
  const maxQCfg = (settings || []).find(r => r.key === 'max_qty');

  S.gameState         = gs      ? gs.value            : 'open';
  S.settings.minQty   = minQCfg ? parseInt(minQCfg.value) : 1;
  S.settings.maxQty   = maxQCfg ? parseInt(maxQCfg.value) : 5;

  S.users = (players || []).map(p => ({ id: p.id, name: p.name }));

  S.countries = (teams || []).map(t => ({
    id: t.id, name: t.name, flag: t.flag,
    finalPos: t.final_pos || null,
    displayOrder: t.display_order || 0,
  }));

  S.auctionPrices = Object.fromEntries(
    (teams || []).map(t => [t.id, parseFloat(t.auction_price) || 0])
  );

  S.prizeTable = Object.fromEntries(
    (prizes || []).map(p => [p.position, Number(p.amount)])
  );

  S.orders = (orders || []).map(o => ({
    id:         Number(o.id),
    ts:         new Date(o.created_at),
    userId:     o.player_id,
    countryId:  o.team_id,
    side:       o.side,
    price:      parseFloat(o.price),
    origQty:    o.orig_qty,
    remQty:     o.rem_qty,
    status:     o.status,
  }));

  S.trades = (trades || []).map(t => ({
    id:          Number(t.id),
    ts:          new Date(t.created_at),
    buyOrderId:  Number(t.buy_order_id),
    sellOrderId: Number(t.sell_order_id),
    buyUserId:   t.buyer_id,
    sellUserId:  t.seller_id,
    countryId:   t.team_id,
    qty:         t.qty,
    price:       parseFloat(t.price),
    annulled:    t.annulled,
  }));
}

/* ═══════════════════════════════
   REALTIME — refresco automático
═══════════════════════════════ */
let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadState();
    renderAll();
  }, 400);
}

function setupRealtime() {
  db.channel('otc-market')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' },       scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' },       scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_settings'}, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' },        scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' },      scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prizes' },       scheduleReload)
    .subscribe();
}

/* ═══════════════════════════════
   PRICING HELPERS
═══════════════════════════════ */
function maxPrice() {
  return (S.prizeTable[1] || 0) / 1000;
}
function getBestBid(cid) {
  const bids = S.orders.filter(o => o.countryId === cid && o.side === 'BUY' && o.status === 'live' && o.remQty > 0);
  return bids.length ? bids.reduce((a, b) => a.price > b.price ? a : b) : null;
}
function getBestAsk(cid) {
  const asks = S.orders.filter(o => o.countryId === cid && o.side === 'SELL' && o.status === 'live' && o.remQty > 0);
  return asks.length ? asks.reduce((a, b) => a.price < b.price ? a : b) : null;
}
function getLastTrade(cid) {
  const ts = S.trades.filter(t => t.countryId === cid && !t.annulled);
  return ts.length ? ts[ts.length - 1] : null;
}
function getVolume(cid) {
  return S.trades.filter(t => t.countryId === cid && !t.annulled).reduce((s, t) => s + t.qty, 0);
}

/* ═══════════════════════════════
   ORDER BOOK & MATCHING ENGINE
═══════════════════════════════ */
async function placeOrder(userId, cid, side, price, qty) {
  const mp = maxPrice();
  if (price > mp) return { ok: false, msg: `Precio máximo permitido: ${fmtP(mp)}` };
  const min = S.settings.minQty, max = S.settings.maxQty;
  if (qty < min || qty > max) return { ok: false, msg: `Cantidad debe estar entre ${fmtN(min)} y ${fmtN(max)} contratos` };

  // Validar self-trading
  if (side === 'BUY') {
    const ownAsk = S.orders.find(o => o.countryId === cid && o.side === 'SELL' && o.status === 'live' && o.remQty > 0 && o.userId === userId && price >= o.price);
    if (ownAsk) return { ok: false, msg: `Tu BID (${fmtP(price)}) cruzaría con tu propio ASK (${fmtP(ownAsk.price)}). No se permite self-trading.` };
  } else {
    const ownBid = S.orders.find(o => o.countryId === cid && o.side === 'BUY' && o.status === 'live' && o.remQty > 0 && o.userId === userId && price <= o.price);
    if (ownBid) return { ok: false, msg: `Tu ASK (${fmtP(price)}) cruzaría con tu propio BID (${fmtP(ownBid.price)}). No se permite self-trading.` };
  }

  const { data: newOrder, error } = await db.from('orders').insert({
    player_id: userId, team_id: cid, side,
    price: parseFloat(price), orig_qty: qty, rem_qty: qty,
  }).select().single();

  if (error) return { ok: false, msg: error.message };

  const order = {
    id: Number(newOrder.id), ts: new Date(newOrder.created_at),
    userId, countryId: cid, side,
    price: parseFloat(price), origQty: qty, remQty: qty, status: 'live',
  };
  S.orders.push(order);

  await matchOrders(cid);
  return { ok: true, order };
}

async function matchOrders(cid) {
  let matched = true;
  while (matched) {
    matched = false;
    const bids = S.orders
      .filter(o => o.countryId === cid && o.side === 'BUY' && o.status === 'live' && o.remQty > 0)
      .sort((a, b) => b.price - a.price || a.ts - b.ts);
    const asks = S.orders
      .filter(o => o.countryId === cid && o.side === 'SELL' && o.status === 'live' && o.remQty > 0)
      .sort((a, b) => a.price - b.price || a.ts - b.ts);

    if (!bids.length || !asks.length) break;

    let execBid = null, execAsk = null;
    outer: for (const bid of bids) {
      for (const ask of asks) {
        if (bid.price < ask.price) break;
        if (bid.userId !== ask.userId) { execBid = bid; execAsk = ask; break outer; }
      }
    }
    if (!execBid) break;

    const execPrice = execAsk.ts <= execBid.ts ? execAsk.price : execBid.price;
    const execQty   = Math.min(execBid.remQty, execAsk.remQty);

    execBid.remQty -= execQty;
    execAsk.remQty -= execQty;
    if (execBid.remQty === 0) execBid.status = 'filled';
    if (execAsk.remQty === 0) execAsk.status = 'filled';

    const [, , { data: newTrade }] = await Promise.all([
      db.from('orders').update({ rem_qty: execBid.remQty, status: execBid.status }).eq('id', execBid.id),
      db.from('orders').update({ rem_qty: execAsk.remQty, status: execAsk.status }).eq('id', execAsk.id),
      db.from('trades').insert({
        buy_order_id:  execBid.id,
        sell_order_id: execAsk.id,
        buyer_id:      execBid.userId,
        seller_id:     execAsk.userId,
        team_id: cid, qty: execQty, price: execPrice,
      }).select().single(),
    ]);

    S.trades.push({
      id: Number(newTrade.id), ts: new Date(newTrade.created_at),
      buyOrderId: execBid.id, sellOrderId: execAsk.id,
      buyUserId: execBid.userId, sellUserId: execAsk.userId,
      countryId: cid, qty: execQty, price: execPrice, annulled: false,
    });

    matched = true;
  }
}

async function cancelOrder(orderId) {
  const o = S.orders.find(x => x.id === orderId);
  if (!o) return;
  o.status  = 'cancelled';
  o.remQty  = 0;
  await db.from('orders').update({ status: 'cancelled', rem_qty: 0 }).eq('id', orderId);
}

async function annulTrade(tradeId) {
  const t = S.trades.find(x => x.id === tradeId);
  if (!t) return;
  t.annulled = true;
  await db.from('trades').update({ annulled: true }).eq('id', tradeId);
}

/* ═══════════════════════════════
   POSITION CALCULATIONS
═══════════════════════════════ */
function getUserPosition(userId, cid) {
  const ts = S.trades.filter(t => t.countryId === cid && !t.annulled);
  let bought = 0, soldContracts = 0, buyPrimeTotal = 0, sellPrimeTotal = 0;
  ts.forEach(t => {
    if (t.buyUserId  === userId) { bought        += t.qty; buyPrimeTotal  += t.qty * t.price; }
    if (t.sellUserId === userId) { soldContracts += t.qty; sellPrimeTotal += t.qty * t.price; }
  });
  const avgBuy  = bought        > 0 ? buyPrimeTotal  / bought        : 0;
  const avgSell = soldContracts > 0 ? sellPrimeTotal / soldContracts : 0;
  return { bought, soldContracts, avgBuy, avgSell, net: bought - soldContracts, buyPrimeTotal, sellPrimeTotal };
}
function getAllPositions() {
  const result = [];
  S.users.forEach(u => {
    S.countries.forEach(c => {
      const pos = getUserPosition(u.id, c.id);
      if (pos.bought > 0 || pos.soldContracts > 0) result.push({ userId: u.id, countryId: c.id, ...pos });
    });
  });
  return result;
}

/* ═══════════════════════════════
   LIQUIDACIÓN
═══════════════════════════════ */
async function liquidateTournament() {
  const unset = S.countries.filter(c => !c.finalPos);
  if (unset.length) { toast('Faltan posiciones finales: ' + unset.map(c => c.flag + c.id).join(', '), 'err'); return; }
  const used = S.countries.map(c => c.finalPos);
  if (new Set(used).size !== S.countries.length) { toast('Hay posiciones repetidas', 'err'); return; }
  if (!confirm('¿Confirmar liquidación del torneo? Los saldos finales quedarán calculados.')) return;

  S.gameState = 'closed';
  const liveOrders = S.orders.filter(o => o.status === 'live');
  liveOrders.forEach(o => { o.status = 'cancelled'; o.remQty = 0; });

  await Promise.all([
    db.from('game_settings').upsert({ key: 'game_state', value: 'closed' }),
    ...liveOrders.map(o => db.from('orders').update({ status: 'cancelled', rem_qty: 0 }).eq('id', o.id)),
  ]);

  toast('🏆 Torneo liquidado. Ver saldos en Mi Posición y Saldos Globales.', 'ok');
  renderAll();
  switchTabById('mypos');
}

function computeLiquidation() {
  const flows = {};
  S.trades.filter(t => !t.annulled).forEach(t => {
    const country = S.countries.find(c => c.id === t.countryId);
    if (!country || !country.finalPos) return;
    const prizePerCtto = (S.prizeTable[country.finalPos] || 0) / 1000;
    const diff = (prizePerCtto - t.price) * t.qty;
    if (diff > 0)       addFlow(flows, t.sellUserId, t.buyUserId, diff);
    else if (diff < 0)  addFlow(flows, t.buyUserId, t.sellUserId, -diff);
  });
  return flows;
}
function addFlow(flows, from, to, amount) {
  const key = from + '>>' + to, rkey = to + '>>' + from;
  if (flows[rkey]) {
    if (flows[rkey] >= amount) { flows[rkey] -= amount; if (flows[rkey] === 0) delete flows[rkey]; }
    else { const rem = amount - flows[rkey]; delete flows[rkey]; flows[key] = (flows[key] || 0) + rem; }
  } else {
    flows[key] = (flows[key] || 0) + amount;
  }
}
function getUserNetResult(userId) {
  let total = 0;
  S.trades.filter(t => !t.annulled).forEach(t => {
    const c = S.countries.find(x => x.id === t.countryId);
    if (!c || !c.finalPos) return;
    const prizePerCtto = (S.prizeTable[c.finalPos] || 0) / 1000;
    const diff = (prizePerCtto - t.price) * t.qty;
    if (t.buyUserId  === userId) total += diff;
    if (t.sellUserId === userId) total -= diff;
  });
  return total;
}

/* ═══════════════════════════════
   FORMAT HELPERS
═══════════════════════════════ */
function fmtM(n)  { if (n == null) return '—'; return '$' + Math.abs(Math.round(n)).toLocaleString('es-AR'); }
function fmtP(n)  { if (n == null) return '—'; return '$' + parseFloat(n).toFixed(2); }
function fmtN(n)  { return Math.round(n).toLocaleString('es-AR'); }
function fmtTS(d) { return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }
function cls(n)   { return n > 0 ? 'up' : n < 0 ? 'dn' : 'muted'; }

/* ═══════════════════════════════
   RENDER — INICIO
═══════════════════════════════ */
function renderInicio() {
  const medals    = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
  const positions = ['Campeón','Subcampeón','3er Puesto','4° Puesto','5° Puesto','6° Puesto','7° Puesto','8° Puesto'];
  const total = Object.values(S.prizeTable).reduce((a, b) => a + b, 0);
  document.getElementById('prize-total-lbl').textContent = 'Total: ' + fmtM(total);
  const prizedPositions = Object.keys(S.prizeTable).map(Number).filter(p => S.prizeTable[p] > 0).sort((a, b) => a - b);
  document.getElementById('prize-visual').innerHTML = prizedPositions.map((pos, i) =>
    `<div class="prize-box ${i === 0 ? 'p1' : ''}">
      <div class="medal">${medals[i] || pos}</div>
      <div class="pos">${positions[i] || 'Puesto ' + pos}</div>
      <div class="amt">${fmtM(S.prizeTable[pos])}</div>
    </div>`
  ).join('');
  document.getElementById('inicio-tbody').innerHTML = S.countries.map(c => {
    const ap = S.auctionPrices[c.id] || 0;
    const lt = getLastTrade(c.id);
    return `<tr class="hover-row">
      <td class="L">${c.flag} <strong>${c.name}</strong></td>
      <td class="L" style="font-family:var(--mono);color:var(--text3);">${c.id}</td>
      <td style="font-family:var(--mono);">${fmtP(ap)}</td>
      <td style="font-family:var(--mono);">${lt ? fmtP(lt.price) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
}

/* ═══════════════════════════════
   RENDER — MARKET
═══════════════════════════════ */
function renderMarket() {
  const q  = document.getElementById('mkt-search').value.toLowerCase();
  const mp = maxPrice();
  document.getElementById('mkt-maxprice-lbl').textContent = `Precio máx: ${fmtP(mp)}`;
  const list = S.countries.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  document.getElementById('mkt-count').textContent = list.length + ' equipos';
  const disabled = S.gameState === 'closed' ? 'disabled' : '';
  document.getElementById('market-panels').innerHTML = list.map(c => {
    const bb = getBestBid(c.id), ba = getBestAsk(c.id), lt = getLastTrade(c.id), vol = getVolume(c.id);
    const bids = S.orders.filter(o => o.countryId === c.id && o.side === 'BUY'  && o.status === 'live' && o.remQty > 0).sort((a,b) => b.price - a.price || a.ts - b.ts);
    const asks = S.orders.filter(o => o.countryId === c.id && o.side === 'SELL' && o.status === 'live' && o.remQty > 0).sort((a,b) => a.price - b.price || a.ts - b.ts);
    const maxDepth = Math.max(1, ...bids.map(x => x.remQty), ...asks.map(x => x.remQty));
    const bidRows = bids.slice(0, 8).map(o => {
      const pct = (o.remQty / maxDepth * 100).toFixed(0);
      const me  = o.userId === S.currentUser;
      return `<div class="ob-row bid-row ob-depth">
        <div class="ob-depth-bar bid-bar" style="width:${pct}%"></div>
        <span class="ob-price">${fmtP(o.price)}</span>
        <span style="color:var(--text3);font-size:10px;text-align:center;">${me ? '<span style="color:var(--accent)">●</span>' : ''}</span>
        <span class="ob-size">${fmtN(o.remQty)}</span>
      </div>`;
    }).join('') || '<div class="ob-empty">Sin órdenes</div>';
    const askRows = asks.slice(0, 8).map(o => {
      const pct = (o.remQty / maxDepth * 100).toFixed(0);
      const me  = o.userId === S.currentUser;
      return `<div class="ob-row ask-row ob-depth">
        <div class="ob-depth-bar ask-bar" style="width:${pct}%"></div>
        <span class="ob-price">${fmtP(o.price)}</span>
        <span style="color:var(--text3);font-size:10px;text-align:center;">${me ? '<span style="color:var(--accent)">●</span>' : ''}</span>
        <span class="ob-size">${fmtN(o.remQty)}</span>
      </div>`;
    }).join('') || '<div class="ob-empty">Sin órdenes</div>';
    return `<div class="country-panel">
      <div class="country-panel-hd" onclick="togglePanel('${c.id}')">
        <span class="cp-flag">${c.flag}</span>
        <div style="min-width:130px;flex-shrink:0;"><div class="cp-name">${c.name}</div><div class="cp-ticker">${c.id}</div></div>
        <div style="flex:1;display:flex;justify-content:center;gap:16px;align-items:center;" onclick="event.stopPropagation()">
          <div style="display:flex;gap:3px;align-items:center;">
            <input type="number" id="bp-${c.id}" placeholder="Precio" min="0.01" step="0.01" style="width:68px;padding:3px 6px;font-size:11px;" ${disabled} onfocus="showPriceHint('${c.id}','BUY')">
            <input type="number" id="bq-${c.id}" value="1" min="1" max="${S.settings.maxQty}" step="1" style="width:36px;padding:3px 6px;font-size:11px;text-align:center;" ${disabled}>
            <button class="btn btn-sm btn-green" onclick="submitInlineOrder('${c.id}','BUY')" ${disabled}>BID</button>
          </div>
          <div class="cp-stat"><div class="lbl">Mejor BID</div><div class="val" style="color:var(--green);">${bb ? fmtP(bb.price) : '—'}</div></div>
          <div class="cp-stat"><div class="lbl">Mejor ASK</div><div class="val" style="color:var(--red);">${ba ? fmtP(ba.price) : '—'}</div></div>
          <div style="display:flex;gap:3px;align-items:center;">
            <button class="btn btn-sm btn-red" onclick="submitInlineOrder('${c.id}','SELL')" ${disabled}>ASK</button>
            <input type="number" id="aq-${c.id}" value="1" min="1" max="${S.settings.maxQty}" step="1" style="width:36px;padding:3px 6px;font-size:11px;text-align:center;" ${disabled}>
            <input type="number" id="ap-${c.id}" placeholder="Precio" min="0.01" step="0.01" style="width:68px;padding:3px 6px;font-size:11px;" ${disabled} onfocus="showPriceHint('${c.id}','SELL')">
          </div>
          <div class="cp-stat"><div class="lbl">Último</div><div class="val">${lt ? fmtP(lt.price) : '—'}</div></div>
          <div class="cp-stat"><div class="lbl">Volumen</div><div class="val" style="color:var(--text2);">${fmtN(vol)}</div></div>
        </div>
      </div>
      <div class="cp-body" id="cp-${c.id}">
        <div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);">
          <span style="font-family:var(--mono);font-size:10px;color:var(--text3);">
            Nocional operado: <strong style="color:var(--text);">${fmtM(vol * (lt ? lt.price : 0) * 1000)}</strong>
            &nbsp;·&nbsp;Precio máx: <strong style="color:var(--gold);">${fmtP(mp)}</strong>
            &nbsp;·&nbsp;Pos. final: <strong style="color:var(--gold);">${c.finalPos ? '#' + c.finalPos : 'Pendiente'}</strong>
          </span>
        </div>
        <div class="ob-wrap">
          <div class="ob-side">
            <div class="ob-hd bid-hd">▲ BID — Compradores (${bids.length})</div>
            ${bidRows}
          </div>
          <div class="ob-side">
            <div class="ob-hd ask-hd">▼ ASK — Vendedores (${asks.length})</div>
            ${askRows}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}
function togglePanel(cid) {
  const el = document.getElementById('cp-' + cid);
  if (el) el.classList.toggle('open');
}

/* ═══════════════════════════════
   RENDER — HISTORY
═══════════════════════════════ */
let histTab = 'global';
function switchHistTab(tab) {
  histTab = tab;
  ['global','mine','orders'].forEach(t => {
    document.getElementById('htab-' + t).classList.toggle('active', t === tab);
    document.getElementById('hist-' + t + '-panel').style.display = t === tab ? '' : 'none';
  });
  renderHistory();
}
function renderHistory() {
  const csel = document.getElementById('hist-country');
  if (csel.options.length <= 1) {
    S.countries.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.flag + ' ' + c.name; csel.appendChild(o); });
  }
  const q    = document.getElementById('hist-q').value.toLowerCase();
  const cid  = document.getElementById('hist-country').value;
  const side = document.getElementById('hist-side').value;
  let tr = S.trades.slice().reverse();
  if (cid) tr = tr.filter(t => t.countryId === cid);
  if (q)   tr = tr.filter(t => { const c = S.countries.find(x => x.id === t.countryId); return (c && c.name.toLowerCase().includes(q)) || t.buyUserId.toLowerCase().includes(q) || t.sellUserId.toLowerCase().includes(q); });
  document.getElementById('hist-global-count').textContent = tr.length + ' trades';
  document.getElementById('hist-global-tbody').innerHTML = tr.map(t => {
    const c = S.countries.find(x => x.id === t.countryId) || {};
    return `<tr class="hover-row ${t.annulled ? 'tag-annulled' : ''}">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(t.ts)}</td>
      <td class="L">${c.flag || ''} ${c.name || t.countryId}</td>
      <td class="L" style="color:var(--green);font-family:var(--mono);">${t.buyUserId}</td>
      <td class="L" style="color:var(--red);font-family:var(--mono);">${t.sellUserId}</td>
      <td>${fmtN(t.qty)}</td>
      <td>${fmtP(t.price)}</td>
      <td style="color:var(--text2);">${fmtM(t.qty * t.price * 1000)}</td>
      <td>${t.annulled ? '<span class="badge b-cancel">ANULADO</span>' : '<span class="badge b-live">EJECUTADO</span>'}</td>
    </tr>`;
  }).join('') || emptyRow(8);
  const u = S.currentUser;
  let mine = S.trades.slice().reverse().filter(t => t.buyUserId === u || t.sellUserId === u);
  if (cid)  mine = mine.filter(t => t.countryId === cid);
  if (side) mine = mine.filter(t => side === 'BUY' ? t.buyUserId === u : t.sellUserId === u);
  if (q)    mine = mine.filter(t => { const c = S.countries.find(x => x.id === t.countryId); return c && c.name.toLowerCase().includes(q); });
  document.getElementById('hist-mine-count').textContent = mine.length + ' operaciones';
  document.getElementById('hist-mine-tbody').innerHTML = mine.map(t => {
    const c = S.countries.find(x => x.id === t.countryId) || {};
    const isBuy = t.buyUserId === u;
    return `<tr class="hover-row ${t.annulled ? 'tag-annulled' : ''}">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(t.ts)}</td>
      <td class="L">${c.flag || ''} ${c.name || t.countryId}</td>
      <td>${isBuy ? '<span class="badge b-buy">COMPRÉ</span>' : '<span class="badge b-sell">VENDÍ</span>'}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text2);">${isBuy ? t.sellUserId : t.buyUserId}</td>
      <td>${fmtN(t.qty)}</td>
      <td>${fmtP(t.price)}</td>
      <td style="color:var(--text2);">${fmtM(t.qty * t.price * 1000)}</td>
      <td>${t.annulled ? '<span class="badge b-cancel">ANULADO</span>' : '<span class="badge b-live">EJECUTADO</span>'}</td>
    </tr>`;
  }).join('') || emptyRow(8);
  let myOrds = S.orders.filter(o => o.userId === u && o.status === 'live' && o.remQty > 0);
  if (cid) myOrds = myOrds.filter(o => o.countryId === cid);
  document.getElementById('hist-orders-count').textContent = myOrds.length + ' activas';
  document.getElementById('hist-orders-tbody').innerHTML = myOrds.map(o => {
    const c = S.countries.find(x => x.id === o.countryId) || {};
    return `<tr class="hover-row">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(o.ts)}</td>
      <td class="L">${c.flag || ''} ${c.name || o.countryId}</td>
      <td>${o.side === 'BUY' ? '<span class="badge b-buy">BID</span>' : '<span class="badge b-sell">ASK</span>'}</td>
      <td style="font-family:var(--mono);font-weight:700;">${fmtP(o.price)}</td>
      <td>${fmtN(o.origQty)}</td>
      <td style="color:var(--accent);">${fmtN(o.remQty)}</td>
      <td><button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="doCancelOrder(${o.id})">Cancelar</button></td>
    </tr>`;
  }).join('') || emptyRow(7);
}

/* ═══════════════════════════════
   RENDER — MY POSITION
═══════════════════════════════ */
function renderMyPos() {
  const u = S.currentUser;
  const rows = S.countries.map(c => {
    const pos = getUserPosition(u, c.id);
    if (pos.bought === 0 && pos.soldContracts === 0) return null;
    let estResult = '—';
    if (S.gameState === 'closed' && c.finalPos) {
      const prizePerCtto = (S.prizeTable[c.finalPos] || 0) / 1000;
      const r = pos.bought * (prizePerCtto - pos.avgBuy) + pos.soldContracts * (pos.avgSell - prizePerCtto);
      estResult = `<span class="${cls(r)}">${r >= 0 ? '+' : ''} ${fmtM(r)}</span>`;
    } else if (S.gameState === 'open') {
      const bb = getBestBid(c.id);
      if (bb) {
        const r = pos.bought * (bb.price - pos.avgBuy) + pos.soldContracts * (pos.avgSell - bb.price);
        estResult = `<span class="${cls(r)}">${r >= 0 ? '+' : ''} ${fmtM(r)} <span style="color:var(--text3);font-size:9px;">(est.)</span></span>`;
      }
    }
    return `<tr class="hover-row">
      <td class="L">${c.flag} <strong>${c.name}</strong></td>
      <td class="up">${fmtN(pos.bought)}</td>
      <td style="font-family:var(--mono);">${pos.bought > 0 ? fmtP(pos.avgBuy) : '—'}</td>
      <td class="dn">${fmtN(pos.soldContracts)}</td>
      <td style="font-family:var(--mono);">${pos.soldContracts > 0 ? fmtP(pos.avgSell) : '—'}</td>
      <td class="${cls(pos.net)}" style="font-weight:700;">${pos.net > 0 ? '+' : ''}${fmtN(pos.net)}</td>
      <td>${estResult}</td>
    </tr>`;
  }).filter(Boolean);
  document.getElementById('mypos-tbody').innerHTML = rows.join('') || emptyRow(7, 'Sin posiciones. Operá en el mercado para construir tu cartera.');

  const allTs      = S.trades.filter(t => !t.annulled && (t.buyUserId === u || t.sellUserId === u));
  const totalBought = allTs.filter(t => t.buyUserId === u).reduce((s, t) => s + t.qty, 0);
  const totalSold   = allTs.filter(t => t.sellUserId === u).reduce((s, t) => s + t.qty, 0);
  const liveOrders  = S.orders.filter(o => o.userId === u && o.status === 'live' && o.remQty > 0).length;
  document.getElementById('mypos-stats').innerHTML = [
    { lbl: 'Contratos Comprados', val: fmtN(totalBought), sub: 'en trades ejecutados' },
    { lbl: 'Contratos Vendidos',  val: fmtN(totalSold),   sub: 'en trades ejecutados' },
    { lbl: 'Órdenes Vivas',       val: fmtN(liveOrders),  sub: 'pendientes de cruce' },
    { lbl: 'Estado Torneo', val: S.gameState === 'closed' ? 'CERRADO' : 'ABIERTO', sub: '', vc: S.gameState === 'closed' ? 'dn' : 'up' },
  ].map(s => `<div class="stat"><div class="stat-lbl">${s.lbl}</div><div class="stat-val ${s.vc || ''}">${s.val}</div><div class="stat-sub">${s.sub}</div></div>`).join('');

  // Mark To Market
  let mtmTotal = 0;
  const mtmRows = S.countries.map(c => {
    const pos = getUserPosition(u, c.id);
    if (pos.bought === 0 && pos.soldContracts === 0) return null;
    const lt = getLastTrade(c.id);
    if (!lt) return null;
    const markPx  = lt.price;
    const buyPnl  = pos.bought        > 0 ? pos.bought        * (markPx - pos.avgBuy)  : 0;
    const sellPnl = pos.soldContracts > 0 ? pos.soldContracts * (pos.avgSell - markPx) : 0;
    const teamPnl = buyPnl + sellPnl;
    mtmTotal += teamPnl;
    const pSign = n => n >= 0 ? '+' : '';
    return `<tr class="hover-row">
      <td class="L">${c.flag} <strong>${c.name}</strong> <span style="font-family:var(--mono);font-size:10px;color:var(--text3);">${c.id}</span></td>
      <td class="${cls(pos.net)}" style="font-weight:700;">${pos.net > 0 ? '+' : ''}${fmtN(pos.net)}</td>
      <td style="font-family:var(--mono);">${pos.bought        > 0 ? fmtP(pos.avgBuy)  : '<span class="muted">—</span>'}</td>
      <td style="font-family:var(--mono);">${pos.soldContracts > 0 ? fmtP(pos.avgSell) : '<span class="muted">—</span>'}</td>
      <td style="font-family:var(--mono);font-weight:700;">${fmtP(markPx)}</td>
      <td class="${cls(buyPnl)}">${pos.bought        > 0 ? pSign(buyPnl)  + fmtM(buyPnl)  : '<span class="muted">—</span>'}</td>
      <td class="${cls(sellPnl)}">${pos.soldContracts > 0 ? pSign(sellPnl) + fmtM(sellPnl) : '<span class="muted">—</span>'}</td>
      <td class="${cls(teamPnl)}" style="font-weight:700;font-size:13px;">${pSign(teamPnl)}${fmtM(teamPnl)}</td>
    </tr>`;
  }).filter(Boolean);
  document.getElementById('mtm-tbody').innerHTML = mtmRows.join('') || emptyRow(8, 'Sin posiciones con precios operados.');
  const mtmLbl = document.getElementById('mtm-total-lbl');
  if (mtmRows.length) { mtmLbl.className = cls(mtmTotal); mtmLbl.textContent = (mtmTotal >= 0 ? '+' : '') + fmtM(mtmTotal) + ' PnL Total'; }
  else mtmLbl.textContent = '';

  const sw = document.getElementById('splitwise-section');
  if (S.gameState === 'closed') {
    const flows    = computeLiquidation();
    const owes     = Object.keys(flows).filter(k => k.startsWith(u + '>>')).map(k => ({ to: k.split('>>')[1], amt: flows[k] }));
    const receives = Object.keys(flows).filter(k => k.endsWith('>>' + u)).map(k => ({ from: k.split('>>')[0], amt: flows[k] }));
    const netResult = getUserNetResult(u);
    sw.innerHTML = `<div class="card">
      <div class="card-hd"><span class="card-title">🔢 Estado de Cuenta Final</span></div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:12px;">
        <div class="sw-card sw-net">
          <div class="sw-title" style="color:var(--text2);">Resultado Neto</div>
          <div style="font-family:var(--mono);font-size:20px;font-weight:700;" class="${cls(netResult)}">${netResult >= 0 ? '+' : ''}${fmtM(netResult)}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:4px;">Prima cobrada − Prima pagada ± Premios</div>
        </div>
        ${owes.length ? `<div class="sw-card sw-owe"><div class="sw-title" style="color:var(--red);">Debés pagar a</div>${owes.map(x => `<div class="sw-row"><span>${x.to}</span><span class="dn bold">${fmtM(x.amt)}</span></div>`).join('')}</div>` : ''}
        ${receives.length ? `<div class="sw-card sw-recv"><div class="sw-title" style="color:var(--green);">Tenés para cobrar de</div>${receives.map(x => `<div class="sw-row"><span>${x.from}</span><span class="up bold">${fmtM(x.amt)}</span></div>`).join('')}</div>` : ''}
        ${!owes.length && !receives.length ? '<div class="info-banner">No tenés saldos pendientes con otros jugadores.</div>' : ''}
      </div>
    </div>`;
  } else {
    sw.innerHTML = '<div class="info-banner">Los saldos finales se calculan cuando el administrador liquida el torneo.</div>';
  }
}

/* ═══════════════════════════════
   RENDER — ADMIN
═══════════════════════════════ */
function renderAdmin() {
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
  const n = S.countries.length;
  document.getElementById('prize-inputs').innerHTML = Array.from({ length: n }).map((_, i) =>
    `<div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;width:24px;text-align:center;">${medals[i] || i + 1}</span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--text2);width:80px;">Puesto ${i + 1}</span>
      <input type="number" id="pr-${i+1}" value="${S.prizeTable[i + 1] || 0}" min="0" step="1000" style="width:120px;">
    </div>`
  ).join('');
  document.getElementById('cfg-min').value = S.settings.minQty;
  document.getElementById('cfg-max').value = S.settings.maxQty;
  document.getElementById('admin-c-tbody').innerHTML = S.countries.map((c, i) =>
    `<tr>
      <td class="L"><input type="text" id="ac-${i}-flag" value="${c.flag}" style="width:50px;text-align:center;"></td>
      <td class="L"><input type="text" id="ac-${i}-name" value="${c.name}"></td>
      <td class="L"><input type="text" id="ac-${i}-ticker" value="${c.id}" style="width:70px;" disabled></td>
      <td><input type="number" id="ac-${i}-ap" value="${S.auctionPrices[c.id] || 0}" step="0.5" style="width:90px;"></td>
      <td><select id="ac-${i}-pos" style="width:80px;">
        <option value="">—</option>
        ${S.countries.map((_, p) => `<option value="${p+1}" ${c.finalPos === p + 1 ? 'selected' : ''}>${p + 1}</option>`).join('')}
      </select></td>
      <td><button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="removeCountry('${c.id}')">×</button></td>
    </tr>`
  ).join('');
  document.getElementById('admin-users-tbody').innerHTML = S.users.map(u => {
    const tradesCount = S.trades.filter(t => !t.annulled && (t.buyUserId === u.id || t.sellUserId === u.id)).length;
    const ordersCount = S.orders.filter(o => o.userId === u.id && o.status === 'live').length;
    const net = S.countries.reduce((s, c) => s + getUserPosition(u.id, c.id).net, 0);
    return `<tr class="hover-row">
      <td class="L" style="font-family:var(--mono);">${u.id}</td>
      <td class="L">${u.name}</td>
      <td>${tradesCount}</td><td>${ordersCount}</td>
      <td class="${cls(net)}">${net > 0 ? '+' : ''}${fmtN(net)}</td>
    </tr>`;
  }).join('');
  const liveOrds = S.orders.filter(o => o.status === 'live' && o.remQty > 0);
  document.getElementById('admin-orders-tbody').innerHTML = liveOrds.map(o => {
    const c = S.countries.find(x => x.id === o.countryId) || {};
    return `<tr class="hover-row">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(o.ts)}</td>
      <td class="L" style="font-family:var(--mono);color:var(--text2);">${o.userId}</td>
      <td class="L">${c.flag || ''} ${c.name || o.countryId}</td>
      <td>${o.side === 'BUY' ? '<span class="badge b-buy">BID</span>' : '<span class="badge b-sell">ASK</span>'}</td>
      <td>${fmtP(o.price)}</td><td>${fmtN(o.remQty)}</td>
      <td><button class="btn btn-xs btn-red" onclick="adminCancelOrder(${o.id})">Cancelar</button></td>
    </tr>`;
  }).join('') || emptyRow(7);
  document.getElementById('admin-trades-tbody').innerHTML = S.trades.slice().reverse().map(t => {
    const c = S.countries.find(x => x.id === t.countryId) || {};
    return `<tr class="hover-row ${t.annulled ? 'tag-annulled' : ''}">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(t.ts)}</td>
      <td class="L">${c.flag || ''} ${c.name || t.countryId}</td>
      <td class="L" style="color:var(--green);font-family:var(--mono);">${t.buyUserId}</td>
      <td class="L" style="color:var(--red);font-family:var(--mono);">${t.sellUserId}</td>
      <td>${fmtN(t.qty)}</td><td>${fmtP(t.price)}</td>
      <td>${t.annulled ? '<span class="badge b-cancel">ANULADO</span>' : '<span class="badge b-live">EJECUTADO</span>'}</td>
      <td>${!t.annulled ? `<button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="adminAnnulTrade(${t.id})">Anular</button>` : ''}</td>
    </tr>`;
  }).join('') || emptyRow(8);
  const allPos = getAllPositions();
  document.getElementById('admin-positions-tbody').innerHTML = allPos.map(p => {
    const c = S.countries.find(x => x.id === p.countryId) || {};
    return `<tr class="hover-row">
      <td class="L" style="font-family:var(--mono);color:var(--text2);">${p.userId}</td>
      <td class="L">${c.flag || ''} ${c.name || p.countryId}</td>
      <td class="up">${fmtN(p.bought)}</td>
      <td>${p.bought > 0 ? fmtP(p.avgBuy) : '—'}</td>
      <td class="dn">${fmtN(p.soldContracts)}</td>
      <td>${p.soldContracts > 0 ? fmtP(p.avgSell) : '—'}</td>
      <td class="${cls(p.net)}" style="font-weight:700;">${p.net > 0 ? '+' : ''}${fmtN(p.net)}</td>
    </tr>`;
  }).join('') || emptyRow(7, 'Sin posiciones abiertas');
}

/* ═══════════════════════════════
   RENDER — SALDOS GLOBALES
═══════════════════════════════ */
function renderSaldos() {
  const el = document.getElementById('saldos-content');
  if (S.gameState !== 'closed') {
    el.innerHTML = '<div class="warn-banner" style="margin-top:12px;">Los saldos globales se calculan al liquidar el torneo.</div>';
    return;
  }
  const flows = computeLiquidation();
  const userResults = S.users.map(u => ({
    user: u, net: getUserNetResult(u.id),
    owes:     Object.keys(flows).filter(k => k.startsWith(u.id + '>>')).map(k => ({ to:   k.split('>>')[1], amt: flows[k] })),
    receives: Object.keys(flows).filter(k => k.endsWith('>>' + u.id)).map(k =>   ({ from: k.split('>>')[0], amt: flows[k] })),
  })).sort((a, b) => b.net - a.net);
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
  el.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <div class="card-hd"><span class="card-title">🏆 Ranking Final</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th class="L">Pos.</th><th class="L">Usuario</th><th>Resultado Neto</th><th>Cobra de</th><th>Paga a</th></tr></thead>
        <tbody>${userResults.map((r, i) => `<tr class="hover-row">
          <td class="L">${medals[i] || i + 1}</td>
          <td class="L" style="font-weight:700;">${r.user.name} <span style="font-family:var(--mono);font-size:10px;color:var(--text3);">${r.user.id}</span></td>
          <td class="${cls(r.net)}" style="font-weight:700;font-size:14px;">${r.net >= 0 ? '+' : ''}${fmtM(r.net)}</td>
          <td class="up">${r.receives.map(x => `${x.from}: ${fmtM(x.amt)}`).join('<br>') || '—'}</td>
          <td class="dn">${r.owes.map(x => `${x.to}: ${fmtM(x.amt)}`).join('<br>') || '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin-top:14px;">
      <div class="card-hd"><span class="card-title">Red de Saldos Cruzados</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th class="L">Quien Paga</th><th class="L">A Quien</th><th>Importe</th></tr></thead>
        <tbody>${Object.keys(flows).map(k => {
          const [from, to] = k.split('>>');
          return `<tr class="hover-row">
            <td class="L" style="font-family:var(--mono);color:var(--red);">${from}</td>
            <td class="L" style="font-family:var(--mono);color:var(--green);">${to}</td>
            <td style="font-weight:700;font-family:var(--mono);">${fmtM(flows[k])}</td>
          </tr>`;
        }).join('') || emptyRow(3, 'Sin saldos cruzados')}</tbody>
      </table></div>
    </div>`;
}

/* ═══════════════════════════════
   ORDER MODAL
═══════════════════════════════ */
let OM = { cid: null, side: 'BUY' };
function openOrder(cid, side) {
  if (S.gameState === 'closed') { toast('Torneo cerrado.', 'err'); return; }
  OM.cid = cid;
  const c = S.countries.find(x => x.id === cid);
  document.getElementById('om-flag').textContent    = c.flag;
  document.getElementById('om-name').textContent    = c.name;
  document.getElementById('om-ticker').textContent  = c.id;
  document.getElementById('om-maxprice').textContent = fmtP(maxPrice());
  document.getElementById('om-price').value = '';
  document.getElementById('om-qty').value   = S.settings.minQty;
  document.getElementById('om-qty').max     = S.settings.maxQty;
  document.getElementById('om-qty-label').textContent = `Cantidad (contratos) — mín ${S.settings.minQty} / máx ${S.settings.maxQty}`;
  setOmSide(side);
  document.getElementById('order-modal').classList.add('open');
  document.getElementById('om-price').focus();
}
function setOmSide(side) {
  OM.side = side;
  document.getElementById('om-buy-btn').style.opacity  = side === 'BUY'  ? '1' : '0.4';
  document.getElementById('om-sell-btn').style.opacity = side === 'SELL' ? '1' : '0.4';
  document.getElementById('om-side-label').textContent = side === 'BUY' ? 'ORDEN BID (compra)' : 'ORDEN ASK (venta)';
  document.getElementById('om-side-label').style.color = side === 'BUY' ? 'var(--green)' : 'var(--red)';
  document.getElementById('om-confirm').className     = 'btn ' + (side === 'BUY' ? 'btn-green' : 'btn-red');
  document.getElementById('om-confirm').textContent   = side === 'BUY' ? 'Ingresar BID' : 'Ingresar ASK';
  updateOmPreview();
}
function updateOmPreview() {
  const price = parseFloat(document.getElementById('om-price').value) || 0;
  const qty   = parseInt(document.getElementById('om-qty').value) || 0;
  const mp    = maxPrice();
  const warn  = document.getElementById('om-price-warn');
  if (price > mp) { warn.textContent = `⚠ Excede el máximo (${fmtP(mp)})`; warn.style.color = 'var(--red)'; }
  else warn.textContent = '';
  document.getElementById('om-nocional').textContent   = fmtM(price * qty);
  document.getElementById('om-valor-real').textContent = fmtM(price * qty * 1000);
}
async function confirmOrder() {
  const price = parseFloat(document.getElementById('om-price').value);
  const qty   = parseInt(document.getElementById('om-qty').value);
  if (!price || price <= 0) { toast('Ingresá un precio válido', 'err'); return; }
  if (!S.currentUser) { toast('Seleccioná un usuario primero', 'err'); return; }
  document.getElementById('om-confirm').disabled = true;
  const r = await placeOrder(S.currentUser, OM.cid, OM.side, price, qty);
  document.getElementById('om-confirm').disabled = false;
  if (!r.ok) { toast(r.msg, 'err'); return; }
  closeModal();
  toast(`Orden ${OM.side} ingresada: ${fmtN(qty)} contratos de ${OM.cid} a ${fmtP(price)}`, 'ok');
  renderAll();
}
function closeModal() { document.getElementById('order-modal').classList.remove('open'); }

/* ═══════════════════════════════
   ADMIN ACTIONS
═══════════════════════════════ */
async function adminCancelOrder(id) {
  if (!confirm('¿Cancelar esta orden?')) return;
  await cancelOrder(id);
  toast('Orden cancelada', 'ok');
  renderAll();
}
async function adminAnnulTrade(id) {
  if (!confirm('¿Anular este trade? Los efectos se reflejarán en posiciones y saldos.')) return;
  await annulTrade(id);
  toast('Trade anulado', 'ok');
  renderAll();
}
async function doCancelOrder(id) {
  if (!confirm('¿Cancelar esta orden?')) return;
  await cancelOrder(id);
  toast('Orden cancelada', 'ok');
  renderAll();
}
function toggleAdminSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
}
function showPriceHint(cid, side) {
  if (side === 'BUY') {
    const ba = getBestAsk(cid), el = document.getElementById('bp-' + cid);
    if (el && ba && !el.value) { el.value = ba.price; el.select(); }
  } else {
    const bb = getBestBid(cid), el = document.getElementById('ap-' + cid);
    if (el && bb && !el.value) { el.value = bb.price; el.select(); }
  }
}
async function submitInlineOrder(cid, side) {
  if (S.gameState === 'closed') { toast('Torneo cerrado.', 'err'); return; }
  if (!S.currentUser) { toast('Seleccioná un usuario primero', 'err'); return; }
  const priceEl = document.getElementById((side === 'BUY' ? 'bp-' : 'ap-') + cid);
  const qtyEl   = document.getElementById((side === 'BUY' ? 'bq-' : 'aq-') + cid);
  const price   = parseFloat(priceEl?.value);
  const qty     = parseInt(qtyEl?.value) || 1;
  if (!price || price <= 0) { toast('Ingresá un precio válido', 'err'); return; }
  const r = await placeOrder(S.currentUser, cid, side, price, qty);
  if (!r.ok) { toast(r.msg, 'err'); return; }
  priceEl.value = '';
  toast(`${side === 'BUY' ? 'BID' : 'ASK'} ingresado: ${fmtN(qty)} contrato(s) de ${cid} a ${fmtP(price)}`, 'ok');
  renderAll();
}
async function savePrizes() {
  const n = S.countries.length;
  const updates = [];
  for (let i = 1; i <= n; i++) {
    const v = parseFloat(document.getElementById(`pr-${i}`)?.value || 0);
    if (v < 0) { toast('Los premios no pueden ser negativos', 'err'); return; }
    S.prizeTable[i] = v;
    updates.push(db.from('prizes').upsert({ position: i, amount: v }));
  }
  await Promise.all(updates);
  toast('Premios guardados', 'ok');
  renderInicio();
  renderAll();
}
async function saveSettings() {
  const minQ = parseInt(document.getElementById('cfg-min')?.value) || 1;
  const maxQ = parseInt(document.getElementById('cfg-max')?.value) || 5;
  S.settings.minQty = minQ;
  S.settings.maxQty = maxQ;
  await Promise.all([
    db.from('game_settings').upsert({ key: 'min_qty', value: String(minQ) }),
    db.from('game_settings').upsert({ key: 'max_qty', value: String(maxQ) }),
  ]);
  toast('Configuración guardada', 'ok');
}
async function saveCountries() {
  const updates = [];
  S.countries.forEach((c, i) => {
    c.flag     = document.getElementById(`ac-${i}-flag`)?.value || c.flag;
    c.name     = document.getElementById(`ac-${i}-name`)?.value || c.name;
    const ap   = parseFloat(document.getElementById(`ac-${i}-ap`)?.value || 0);
    const pos  = parseInt(document.getElementById(`ac-${i}-pos`)?.value);
    S.auctionPrices[c.id] = ap;
    c.finalPos = isNaN(pos) ? null : pos;
    updates.push(db.from('teams').update({ flag: c.flag, name: c.name, auction_price: ap, final_pos: c.finalPos || null }).eq('id', c.id));
  });
  await Promise.all(updates);
  toast('Equipos guardados', 'ok');
  renderInicio();
  renderAll();
}
async function addCountry() {
  const id   = prompt('Ticker del equipo (ej: MIL):')?.toUpperCase().trim();
  const name = prompt('Nombre completo:')?.trim();
  const flag = prompt('Emoji bandera/escudo:')?.trim() || '🏳️';
  if (!id || !name) return;
  if (S.countries.find(c => c.id === id)) { toast('Ya existe un equipo con ese ticker', 'err'); return; }
  const { error } = await db.from('teams').insert({ id, name, flag, auction_price: 0, display_order: S.countries.length + 1 });
  if (error) { toast(error.message, 'err'); return; }
  // Add prize row for new position
  await db.from('prizes').upsert({ position: S.countries.length + 1, amount: 0 });
  await loadState();
  toast(`Equipo ${id} agregado`, 'ok');
  renderAdmin();
}
async function removeCountry(id) {
  if (!confirm(`¿Eliminar el equipo ${id}? Esto borrará sus órdenes y trades relacionados.`)) return;
  await db.from('teams').delete().eq('id', id);
  await loadState();
  renderAdmin();
}
async function addUser() {
  const name = prompt('Nombre del usuario:');
  if (!name) return;
  const id = name.toUpperCase().replace(/\s/g, '').slice(0, 8);
  if (S.users.find(u => u.id === id)) { toast('ID ya existe', 'err'); return; }
  const { error } = await db.from('players').insert({ id, name });
  if (error) { toast(error.message, 'err'); return; }
  S.users.push({ id, name });
  toast('Usuario ' + id + ' agregado', 'ok');
  renderAdmin();
}
async function resetGame() {
  if (!confirm('¿Iniciar nueva partida? Se eliminarán TODOS los trades y órdenes, y se reabrirá el torneo.')) return;
  await Promise.all([
    db.from('trades').delete().neq('id', 0),
    db.from('orders').delete().neq('id', 0),
    db.from('game_settings').upsert({ key: 'game_state', value: 'open' }),
  ]);
  await loadState();
  renderAll();
  toast('Nueva partida iniciada', 'ok');
}

/* ═══════════════════════════════
   USER PICKER
═══════════════════════════════ */
function showUserPicker() {
  document.getElementById('user-picker-body').innerHTML = S.users.map(u =>
    `<button class="btn btn-outline" style="width:100%;justify-content:flex-start;margin-bottom:6px;${u.id === S.currentUser ? 'border-color:var(--accent);color:var(--accent);' : ''}" onclick="selectUser('${u.id}')">
      👤 ${u.name} <span style="font-family:var(--mono);font-size:10px;color:var(--text3);margin-left:auto;">${u.id}</span>
    </button>`
  ).join('') + `<div class="sep"></div><p style="font-size:10px;color:var(--text3);">El admin puede agregar jugadores desde el panel Admin → Usuarios.</p>`;
  document.getElementById('user-modal').classList.add('open');
}
function selectUser(id) {
  S.currentUser = id;
  localStorage.setItem('otc_user', id);
  document.getElementById('cur-user-lbl').textContent = id;
  closeUserModal();
  renderAll();
  toast('Sesión: ' + id, 'inf');
}
function closeUserModal() { document.getElementById('user-modal').classList.remove('open'); }

/* ═══════════════════════════════
   TICKER
═══════════════════════════════ */
function renderTicker() {
  const items = S.countries.map(c => {
    const ts   = S.trades.filter(t => t.countryId === c.id && !t.annulled);
    const lt   = ts.length   ? ts[ts.length - 1] : null;
    const prev = ts.length > 1 ? ts[ts.length - 2] : null;
    const px   = lt ? lt.price : null;
    const changePct = (lt && prev && prev.price > 0) ? (lt.price - prev.price) / prev.price * 100 : null;
    const chgStr = changePct !== null
      ? `<span class="${changePct >= 0 ? 'up' : 'dn'}">${changePct >= 0 ? '▲' : '▼'}${Math.abs(changePct).toFixed(1)}%</span>`
      : `<span class="muted">—%</span>`;
    return `<span class="tick-item"><span class="sym">${c.id}</span><span class="px">${px ? fmtP(px) : '—'}</span>${chgStr}</span>`;
  }).join('');
  const el = document.getElementById('ticker');
  el.innerHTML = items + items;
}

/* ═══════════════════════════════
   NAVIGATION
═══════════════════════════════ */
function switchTab(el, name) {
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('view-' + name).classList.add('active');
  if (name === 'inicio')  renderInicio();
  if (name === 'market')  renderMarket();
  if (name === 'history') renderHistory();
  if (name === 'mypos')   renderMyPos();
  if (name === 'admin')   renderAdmin();
  if (name === 'saldos')  renderSaldos();
}
function switchTabById(name) {
  const el = document.querySelector(`.tab[data-tab="${name}"]`);
  if (el) switchTab(el, name);
}
function toggleTheme() {
  document.documentElement.setAttribute('data-theme',
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

/* ═══════════════════════════════
   STATUS BAR
═══════════════════════════════ */
function updateStatus() {
  const dot = document.getElementById('sdot'), lbl = document.getElementById('slabel');
  if (S.gameState === 'closed') { dot.className = 'status-dot closed'; lbl.textContent = 'TORNEO CERRADO'; lbl.style.color = 'var(--gold)'; }
  else { dot.className = 'status-dot'; lbl.textContent = 'ABIERTO'; lbl.style.color = 'var(--green)'; }
}

/* ═══════════════════════════════
   TOAST
═══════════════════════════════ */
function toast(msg, type = 'inf') {
  const el = document.createElement('div');
  el.className = 'toast ' + ({ ok: 'ok', err: 'err', inf: 'inf' }[type] || 'inf');
  el.textContent = msg;
  document.getElementById('toast-ct').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ═══════════════════════════════
   HELPERS
═══════════════════════════════ */
function emptyRow(cols, msg = 'Sin datos') {
  return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text3);padding:20px;font-family:var(--mono);font-size:11px;">${msg}</td></tr>`;
}
function renderAll() {
  const active = document.querySelector('.tab.active')?.dataset?.tab;
  renderTicker();
  updateStatus();
  if (active === 'inicio')  renderInicio();
  if (active === 'market')  renderMarket();
  if (active === 'history') renderHistory();
  if (active === 'mypos')   renderMyPos();
  if (active === 'admin')   renderAdmin();
  if (active === 'saldos')  renderSaldos();
  if (S.currentUser) document.getElementById('cur-user-lbl').textContent = S.currentUser;
}

/* ═══════════════════════════════
   KEYBOARD / MODAL CLOSE
═══════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeUserModal(); }
});
document.getElementById('order-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('order-modal')) closeModal();
});
document.getElementById('user-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('user-modal')) closeUserModal();
});

/* ═══════════════════════════════
   BOOT
═══════════════════════════════ */
(async () => {
  showLoading('Conectando al mercado...');
  try {
    await loadState();
    setupRealtime();
    hideLoading();
    renderInicio();
    renderTicker();
    updateStatus();
    if (S.currentUser) {
      document.getElementById('cur-user-lbl').textContent = S.currentUser;
    } else if (S.users.length > 0) {
      showUserPicker();
    }
  } catch (err) {
    console.error(err);
    document.querySelector('#loading-overlay .loader-msg').textContent =
      '❌ Error al conectar con Supabase. Revisá la configuración en js/app.js';
    document.querySelector('#loading-overlay .loader-spinner').style.display = 'none';
  }
})();
