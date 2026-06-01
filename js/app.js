/* ═══════════════════════════════════════════════════════
   OTC TOURNAMENT OPTIONS MARKET — V2 (Multi-torneo)
   Supabase-backed · Vercel ready
   ═══════════════════════════════════════════════════════ */

// ── CONFIGURACIÓN SUPABASE ──────────────────────────────
// Reemplazá con los valores de tu proyecto Supabase V2
// Settings → API
const SUPABASE_URL      = 'https://ttvnskcianlbvfjjpang.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0dm5za2NpYW5sYnZmampwYW5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MDcwNDMsImV4cCI6MjA5NTA4MzA0M30.IxO-NJkt0AS29s13_WoRcGNdctJEGcz0HzG-N8amwTo';

const _CONFIGURED = !SUPABASE_URL.startsWith('TU_') && !SUPABASE_ANON_KEY.startsWith('TU_');
const db = _CONFIGURED
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/* ═══════════════════════════════
   STATE
═══════════════════════════════ */
const S = {
  // Torneo activo
  tournamentId:      null,
  tournamentName:    '',
  tournamentStatus:  'open',
  isTournamentAdmin: false,

  // Lista de torneos (lobby)
  tournaments: [],

  // Datos del torneo activo
  countries:    [],
  prizeTable:   {},
  auctionPrices: {},
  users:        [],
  orders:       [],
  trades:       [],
  settings:     { minQty: 1, maxQty: 5 },
  gameState:    'open',
  propResults:  { goals: null, amarillas: null, rojas: null },

  // Usuario actual
  currentUser:  null,   // players.id (TEXT)
  isAdmin:      false,  // global admin (primer registrado)
};

/* ═══════════════════════════════
   LOADING
═══════════════════════════════ */
function showLoading(msg = 'Conectando...') {
  const ov = document.getElementById('loading-overlay');
  ov.querySelector('.loader-msg').textContent = msg;
  ov.classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

/* ═══════════════════════════════
   LOBBY
═══════════════════════════════ */
function showLobby() {
  document.getElementById('lobby-screen').classList.remove('hidden');
  document.getElementById('back-to-lobby-btn').style.display = 'none';
  document.getElementById('tournament-name-badge').style.display = 'none';
}
function hideLobby() {
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('back-to-lobby-btn').style.display = '';
  const badge = document.getElementById('tournament-name-badge');
  badge.textContent = S.tournamentName;
  badge.style.display = '';
}

async function loadTournaments() {
  const [
    { data: all },
    { data: myJoined },
  ] = await Promise.all([
    db.from('tournaments').select('*').order('created_at', { ascending: false }),
    db.from('tournament_players').select('tournament_id').eq('player_id', S.currentUser),
  ]);

  const myIds = new Set((myJoined || []).map(r => r.tournament_id));
  S.tournaments = (all || []).map(t => ({ ...t, isMember: myIds.has(t.id) }));
}

function renderLobby() {
  const player = S.currentUser;
  document.getElementById('lobby-user-bar').innerHTML =
    `<span>👤 <strong>${player}</strong></span>` +
    `<button class="btn btn-xs btn-outline" onclick="handleLogout()">Cerrar sesión</button>`;

  const list = document.getElementById('lobby-list');

  if (!S.tournaments.length) {
    list.innerHTML = '<div class="lobby-empty">No hay torneos disponibles.<br>Creá uno para empezar.</div>';
    return;
  }

  const mine     = S.tournaments.filter(t => t.isMember);
  const others   = S.tournaments.filter(t => !t.isMember && t.status === 'open');

  let html = '';

  if (mine.length) {
    html += `<div class="lobby-section-title" style="margin-bottom:10px;">Mis Torneos</div>`;
    html += mine.map(t => tournamentCard(t, true)).join('');
  }

  if (others.length) {
    html += `<div class="lobby-section-title" style="margin:${mine.length ? '20px' : '0'} 0 10px;">Torneos Disponibles</div>`;
    html += others.map(t => tournamentCard(t, false)).join('');
  }

  if (!mine.length && !others.length) {
    html = '<div class="lobby-empty">No hay torneos abiertos en este momento.</div>';
  }

  list.innerHTML = html;
}

function tournamentCard(t, isMember) {
  const statusLabel = { open: 'ABIERTO', closed: 'CERRADO', liquidated: 'LIQUIDADO' }[t.status] || t.status;
  const btn = isMember
    ? `<button class="btn btn-sm btn-primary" onclick="enterTournament('${t.id}','${escHtml(t.name)}','${t.status}','${t.admin_id}')">Entrar →</button>`
    : t.invite_code
      ? `<button class="btn btn-sm btn-outline" onclick="promptInviteCode('${t.id}','${escHtml(t.name)}','${t.status}','${t.admin_id}')">🔒 Unirse</button>`
      : `<button class="btn btn-sm btn-outline" onclick="joinAndEnterTournament('${t.id}','${escHtml(t.name)}','${t.status}','${t.admin_id}')">Unirse</button>`;
  const lockBadge = (!isMember && t.invite_code) ? `<span style="font-size:9px;font-family:var(--mono);color:var(--text3);margin-left:6px;">🔒 Con código</span>` : '';
  return `<div class="tournament-card">
    <div style="flex:1;">
      <div class="tc-name">${escHtml(t.name)}${lockBadge}</div>
      <div class="tc-meta">Admin: ${t.admin_id || '—'} &nbsp;·&nbsp; Creado: ${new Date(t.created_at).toLocaleDateString('es-AR')}</div>
    </div>
    <span class="tc-status ${t.status}">${statusLabel}</span>
    ${btn}
  </div>`;
}

// ── INVITE CODE ─────────────────────────────────────────
let _inviteTarget = null;

function promptInviteCode(tid, name, status, adminId) {
  _inviteTarget = { tid, name, status, adminId };
  document.getElementById('ic-name').textContent = name;
  document.getElementById('ic-code').value = '';
  const err = document.getElementById('ic-error');
  err.textContent = ''; err.style.display = 'none';
  document.getElementById('invite-modal').classList.add('open');
  setTimeout(() => document.getElementById('ic-code').focus(), 100);
}

function closeInviteModal() {
  document.getElementById('invite-modal').classList.remove('open');
  _inviteTarget = null;
}

async function confirmInviteCode() {
  const code = document.getElementById('ic-code').value.trim();
  if (!code) { showIcError('Ingresá el código de acceso'); return; }
  const t = S.tournaments.find(x => x.id === _inviteTarget?.tid);
  if (!t) return;
  if (t.invite_code && code.toLowerCase() !== t.invite_code.toLowerCase()) {
    showIcError('Código incorrecto — intentá de nuevo'); return;
  }
  closeInviteModal();
  const { tid, name, status, adminId } = _inviteTarget || {};
  await joinAndEnterTournament(tid, name, status, adminId);
}

function showIcError(msg) {
  const el = document.getElementById('ic-error');
  el.textContent = msg; el.style.display = 'block';
}

async function joinAndEnterTournament(tid, name, status, adminId) {
  showLoading('Uniéndose al torneo...');
  const { count } = await db.from('tournament_players')
    .select('id', { count: 'exact', head: true }).eq('tournament_id', tid);
  if (count >= 8) { hideLoading(); toast('El torneo ya tiene 8 jugadores.', 'err'); return; }

  const { error } = await db.from('tournament_players')
    .insert({ tournament_id: tid, player_id: S.currentUser });
  if (error && !error.message.includes('duplicate')) {
    hideLoading(); toast('Error al unirse: ' + error.message, 'err'); return;
  }
  await enterTournament(tid, name, status, adminId);
}

async function enterTournament(tid, name, status, adminId) {
  showLoading('Cargando torneo...');
  S.tournamentId      = tid;
  S.tournamentName    = name;
  S.tournamentStatus  = status;
  S.isTournamentAdmin = (adminId === S.currentUser);

  await loadState();
  setupRealtime();
  hideLobby();
  hideLoading();

  document.querySelectorAll('.admin-tab').forEach(t => {
    t.style.display = S.isTournamentAdmin ? '' : 'none';
  });

  switchTabById('inicio');
  renderInicio(); renderTicker(); updateStatus();
  renderAll();
  toast('Entraste a ' + name, 'ok');
}

function goToLobby() {
  if (_realtimeChannel) {
    db.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  S.tournamentId      = null;
  S.tournamentName    = '';
  S.isTournamentAdmin = false;
  S.countries = []; S.orders = []; S.trades = []; S.users = [];
  S.prizeTable = {}; S.auctionPrices = {};
  loadTournaments().then(renderLobby);
  showLobby();
}

// ── Crear torneo ──
function openCreateTournament() {
  document.getElementById('ct-name').value = '';
  document.getElementById('create-tournament-modal').classList.add('open');
  document.getElementById('ct-name').focus();
}
function closeCreateTournament() {
  document.getElementById('create-tournament-modal').classList.remove('open');
}
async function confirmCreateTournament() {
  const name = document.getElementById('ct-name').value.trim();
  if (!name) { toast('Ingresá un nombre para el torneo.', 'err'); return; }

  const btn = document.getElementById('ct-confirm');
  btn.disabled = true;
  const { data: t, error } = await db.from('tournaments')
    .insert({ name, admin_id: S.currentUser, status: 'open' })
    .select().single();
  if (error) { btn.disabled = false; toast(error.message, 'err'); return; }

  await db.from('tournament_players').insert({ tournament_id: t.id, player_id: S.currentUser });
  btn.disabled = false;
  closeCreateTournament();
  toast('Torneo creado: ' + name, 'ok');
  await enterTournament(t.id, t.name, t.status, t.admin_id);
}

/* ═══════════════════════════════
   CARGA DESDE SUPABASE
═══════════════════════════════ */
async function loadState() {
  const tid = S.tournamentId;
  if (!tid) return;

  const [
    { data: settings },
    { data: tpData },
    { data: teams },
    { data: prizes },
    { data: orders },
    { data: trades },
  ] = await Promise.all([
    db.from('game_settings').select('*').eq('tournament_id', tid),
    db.from('tournament_players').select('player_id').eq('tournament_id', tid),
    db.from('teams').select('*').eq('tournament_id', tid).order('display_order'),
    db.from('prizes').select('*').eq('tournament_id', tid).order('position'),
    db.from('orders').select('*').eq('tournament_id', tid).order('created_at'),
    db.from('trades').select('*').eq('tournament_id', tid).order('created_at'),
  ]);

  // Cargar players del torneo
  const playerIds = (tpData || []).map(r => r.player_id);
  let players = [];
  if (playerIds.length) {
    const { data: pd } = await db.from('players').select('*').in('id', playerIds).order('name');
    players = pd || [];
  }

  const gs      = (settings || []).find(r => r.key === 'game_state');
  const minQCfg = (settings || []).find(r => r.key === 'min_qty');
  const maxQCfg = (settings || []).find(r => r.key === 'max_qty');
  const goalsR  = (settings || []).find(r => r.key === 'goals_result');
  const amarR   = (settings || []).find(r => r.key === 'amarillas_result');
  const rojasR  = (settings || []).find(r => r.key === 'rojas_result');

  S.gameState         = gs      ? gs.value                : 'open';
  S.settings.minQty   = minQCfg ? parseInt(minQCfg.value) : 1;
  S.settings.maxQty   = maxQCfg ? parseInt(maxQCfg.value) : 5;
  S.propResults = {
    goals:     goalsR ? Number(goalsR.value)  : null,
    amarillas: amarR  ? Number(amarR.value)   : null,
    rojas:     rojasR ? Number(rojasR.value)  : null,
  };

  S.users = (players).map(p => ({ id: p.id, name: p.name }));

  S.countries = (teams || []).map(t => ({
    id:           t.id,
    ticker:       t.ticker,
    name:         t.name,
    flag:         t.flag,
    finalPos:     t.final_pos || null,
    displayOrder: t.display_order || 0,
    isHidden:     t.is_hidden || false,
    groupLabel:   t.group_label || '',
  }));

  S.auctionPrices = Object.fromEntries(
    (teams || []).map(t => [t.id, parseFloat(t.auction_price) || 0])
  );

  S.prizeTable = Object.fromEntries(
    (prizes || []).map(p => [p.position, Number(p.amount)])
  );

  S.orders = (orders || []).map(o => ({
    id:         o.id,
    ts:         new Date(o.created_at),
    userId:     o.player_id,
    countryId:  o.team_id,
    marketType: o.market_type || 'team',
    side:       o.side,
    price:      parseFloat(o.price),
    origQty:    o.orig_qty,
    remQty:     o.rem_qty,
    status:     o.status,
  }));

  S.trades = (trades || []).map(t => ({
    id:          t.id,
    ts:          new Date(t.created_at),
    buyOrderId:  t.buy_order_id,
    sellOrderId: t.sell_order_id,
    buyUserId:   t.buyer_id,
    sellUserId:  t.seller_id,
    countryId:   t.team_id,
    marketType:  t.market_type || 'team',
    qty:         t.qty,
    price:       parseFloat(t.price),
    annulled:    t.annulled,
  }));
}

/* ═══════════════════════════════
   REALTIME
═══════════════════════════════ */
let reloadTimer = null;
let _realtimeChannel = null;

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadState();
    renderAll();
  }, 400);
}

function setupRealtime() {
  if (_realtimeChannel) db.removeChannel(_realtimeChannel);
  const tid = S.tournamentId;
  _realtimeChannel = db.channel('otc-' + tid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders',       filter: `tournament_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades',       filter: `tournament_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_settings',filter: `tournament_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams',        filter: `tournament_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'prizes',       filter: `tournament_id=eq.${tid}` }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${tid}` }, scheduleReload)
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
  if (qty < min || qty > max) return { ok: false, msg: `Cantidad entre ${fmtN(min)} y ${fmtN(max)} contratos` };

  if (side === 'BUY') {
    const ownAsk = S.orders.find(o => o.countryId === cid && o.side === 'SELL' && o.status === 'live' && o.remQty > 0 && o.userId === userId && price >= o.price);
    if (ownAsk) return { ok: false, msg: `Tu BID (${fmtP(price)}) cruzaría con tu propio ASK (${fmtP(ownAsk.price)}). No se permite self-trading.` };
  } else {
    const ownBid = S.orders.find(o => o.countryId === cid && o.side === 'BUY' && o.status === 'live' && o.remQty > 0 && o.userId === userId && price <= o.price);
    if (ownBid) return { ok: false, msg: `Tu ASK (${fmtP(price)}) cruzaría con tu propio BID (${fmtP(ownBid.price)}). No se permite self-trading.` };
  }

  const { data: newOrder, error } = await db.from('orders').insert({
    tournament_id: S.tournamentId,
    player_id: userId, team_id: cid, side,
    price: parseFloat(price), orig_qty: qty, rem_qty: qty,
  }).select().single();

  if (error) return { ok: false, msg: error.message };

  const order = {
    id: newOrder.id, ts: new Date(newOrder.created_at),
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
        tournament_id:  S.tournamentId,
        buy_order_id:   execBid.id,
        sell_order_id:  execAsk.id,
        buyer_id:       execBid.userId,
        seller_id:      execAsk.userId,
        team_id: cid, qty: execQty, price: execPrice,
      }).select().single(),
    ]);

    S.trades.push({
      id: newTrade.id, ts: new Date(newTrade.created_at),
      buyOrderId: execBid.id, sellOrderId: execAsk.id,
      buyUserId: execBid.userId, sellUserId: execAsk.userId,
      countryId: cid, qty: execQty, price: execPrice, annulled: false,
    });

    matched = true;
  }
}

/* ═══════════════════════════════
   PROP MARKETS (Goles / Amarillas / Rojas)
═══════════════════════════════ */
async function placePropOrder(marketType, side, price, qty) {
  const min = S.settings.minQty, max = S.settings.maxQty;
  if (qty < min || qty > max) return { ok: false, msg: `Cantidad entre ${fmtN(min)} y ${fmtN(max)} contratos` };
  if (price <= 0) return { ok: false, msg: 'El precio debe ser mayor a 0' };
  if (side === 'BUY') {
    const ownAsk = S.orders.find(o => o.marketType === marketType && o.side === 'SELL' && o.status === 'live' && o.remQty > 0 && o.userId === S.currentUser && price >= o.price);
    if (ownAsk) return { ok: false, msg: `Tu BID (${fmtP(price)}) cruzaría con tu propio ASK. No se permite self-trading.` };
  } else {
    const ownBid = S.orders.find(o => o.marketType === marketType && o.side === 'BUY' && o.status === 'live' && o.remQty > 0 && o.userId === S.currentUser && price <= o.price);
    if (ownBid) return { ok: false, msg: `Tu ASK (${fmtP(price)}) cruzaría con tu propio BID. No se permite self-trading.` };
  }
  const { data: newOrder, error } = await db.from('orders').insert({
    tournament_id: S.tournamentId,
    player_id: S.currentUser, team_id: null, side,
    market_type: marketType,
    price: parseFloat(price), orig_qty: qty, rem_qty: qty,
  }).select().single();
  if (error) return { ok: false, msg: error.message };
  const order = {
    id: newOrder.id, ts: new Date(newOrder.created_at),
    userId: S.currentUser, countryId: null, marketType, side,
    price: parseFloat(price), origQty: qty, remQty: qty, status: 'live',
  };
  S.orders.push(order);
  await matchPropOrders(marketType);
  return { ok: true, order };
}

async function matchPropOrders(marketType) {
  let matched = true;
  while (matched) {
    matched = false;
    const bids = S.orders.filter(o => o.marketType === marketType && o.side === 'BUY' && o.status === 'live' && o.remQty > 0).sort((a, b) => b.price - a.price || a.ts - b.ts);
    const asks = S.orders.filter(o => o.marketType === marketType && o.side === 'SELL' && o.status === 'live' && o.remQty > 0).sort((a, b) => a.price - b.price || a.ts - b.ts);
    if (!bids.length || !asks.length) break;
    let execBid = null, execAsk = null;
    outer2: for (const bid of bids) {
      for (const ask of asks) {
        if (bid.price < ask.price) break;
        if (bid.userId !== ask.userId) { execBid = bid; execAsk = ask; break outer2; }
      }
    }
    if (!execBid) break;
    const execPrice = execAsk.ts <= execBid.ts ? execAsk.price : execBid.price;
    const execQty   = Math.min(execBid.remQty, execAsk.remQty);
    execBid.remQty -= execQty; execAsk.remQty -= execQty;
    if (execBid.remQty === 0) execBid.status = 'filled';
    if (execAsk.remQty === 0) execAsk.status = 'filled';
    const [, , { data: newTrade }] = await Promise.all([
      db.from('orders').update({ rem_qty: execBid.remQty, status: execBid.status }).eq('id', execBid.id),
      db.from('orders').update({ rem_qty: execAsk.remQty, status: execAsk.status }).eq('id', execAsk.id),
      db.from('trades').insert({
        tournament_id: S.tournamentId,
        buy_order_id: execBid.id, sell_order_id: execAsk.id,
        buyer_id: execBid.userId, seller_id: execAsk.userId,
        team_id: null, qty: execQty, price: execPrice, market_type: marketType,
      }).select().single(),
    ]);
    S.trades.push({
      id: newTrade.id, ts: new Date(newTrade.created_at),
      buyOrderId: execBid.id, sellOrderId: execAsk.id,
      buyUserId: execBid.userId, sellUserId: execAsk.userId,
      countryId: null, marketType, qty: execQty, price: execPrice, annulled: false,
    });
    matched = true;
  }
}

async function submitPropOrder(marketType, side) {
  if (S.gameState !== 'open') { toast('El mercado está cerrado', 'err'); return; }
  const price = parseFloat(document.getElementById(`prop-price-${marketType}`).value);
  const qty   = parseInt(document.getElementById(`prop-qty-${marketType}`).value);
  if (isNaN(price) || price <= 0) { toast('Ingresá un precio válido', 'err'); return; }
  if (isNaN(qty) || qty < 1) { toast('Ingresá una cantidad válida', 'err'); return; }
  const r = await placePropOrder(marketType, side, price, qty);
  if (!r.ok) { toast(r.msg, 'err'); return; }
  toast(`Orden ${side === 'BUY' ? 'de compra' : 'de venta'} colocada`, 'ok');
  renderProps();
}

async function savePropResults() {
  const goals     = document.getElementById('prop-goals-result').value.trim();
  const amarillas = document.getElementById('prop-amarillas-result').value.trim();
  const rojas     = document.getElementById('prop-rojas-result').value.trim();
  const upserts = [];
  if (goals     !== '') upserts.push({ tournament_id: S.tournamentId, key: 'goals_result',     value: goals });
  if (amarillas !== '') upserts.push({ tournament_id: S.tournamentId, key: 'amarillas_result', value: amarillas });
  if (rojas     !== '') upserts.push({ tournament_id: S.tournamentId, key: 'rojas_result',     value: rojas });
  if (!upserts.length) { toast('Ingresá al menos un resultado', 'err'); return; }
  await Promise.all(upserts.map(u => db.from('game_settings').upsert(u, { onConflict: 'tournament_id,key' })));
  if (goals     !== '') S.propResults.goals     = Number(goals);
  if (amarillas !== '') S.propResults.amarillas = Number(amarillas);
  if (rojas     !== '') S.propResults.rojas     = Number(rojas);
  toast('Resultados guardados', 'ok');
  renderAll();
}

function computePropLiquidation(marketType) {
  const flows = {};
  const result = S.propResults[marketType];
  if (result == null) return flows;
  S.trades.filter(t => !t.annulled && t.marketType === marketType).forEach(t => {
    const diff = (result - t.price) * t.qty;
    if (diff > 0)      addFlow(flows, t.sellUserId, t.buyUserId,  diff);
    else if (diff < 0) addFlow(flows, t.buyUserId,  t.sellUserId, -diff);
  });
  return flows;
}

function getUserPropNetResult(userId, marketType) {
  const result = S.propResults[marketType];
  if (result == null) return null;
  let total = 0;
  S.trades.filter(t => !t.annulled && t.marketType === marketType).forEach(t => {
    const diff = (result - t.price) * t.qty;
    if (t.buyUserId  === userId) total += diff;
    if (t.sellUserId === userId) total -= diff;
  });
  return total;
}

const PROP_MARKETS = [
  { key: 'goals',     label: '⚽ Goles',             desc: 'Total de goles en el torneo',            color: 'var(--accent)' },
  { key: 'amarillas', label: '🟨 Tarjetas Amarillas', desc: 'Total de tarjetas amarillas en el torneo', color: 'var(--gold)' },
  { key: 'rojas',     label: '🟥 Tarjetas Rojas',    desc: 'Total de tarjetas rojas en el torneo',   color: 'var(--red)' },
];

function renderProps() {
  const isOpen = S.gameState === 'open';
  const u = S.currentUser;
  let html = '';
  PROP_MARKETS.forEach(m => {
    const result    = S.propResults[m.key];
    const liveOrds  = S.orders.filter(o => o.marketType === m.key && o.status === 'live' && o.remQty > 0);
    const bids      = liveOrds.filter(o => o.side === 'BUY').sort((a,b) => b.price - a.price);
    const asks      = liveOrds.filter(o => o.side === 'SELL').sort((a,b) => a.price - b.price);
    const bestBid   = bids[0]?.price ?? null;
    const bestAsk   = asks[0]?.price ?? null;
    const myTrades  = S.trades.filter(t => t.marketType === m.key && !t.annulled);
    let net = 0;
    myTrades.forEach(t => { if (t.buyUserId === u) net += t.qty; if (t.sellUserId === u) net -= t.qty; });
    const pnl = getUserPropNetResult(u, m.key);
    html += `<div class="card prop-card">
      <div class="card-hd">
        <span class="card-title" style="color:${m.color}">${m.label}</span>
        ${result != null ? `<span class="prop-result-badge">${result} ${m.key === 'goals' ? 'goles' : 'tarjetas'}</span>` : ''}
        ${pnl != null ? `<span class="prop-pnl ${cls(pnl)}">${pnl >= 0 ? '+' : ''}${fmtM(pnl)}</span>` : ''}
      </div>
      <div class="prop-sub">${m.desc}</div>
      <div class="prop-quotes">
        <div class="prop-quote"><div class="pq-lbl">MEJOR COMPRA</div><div class="pq-val up">${bestBid != null ? fmtP(bestBid) : '—'}</div></div>
        <div class="prop-quote"><div class="pq-lbl">MEJOR VENTA</div><div class="pq-val dn">${bestAsk != null ? fmtP(bestAsk) : '—'}</div></div>
        <div class="prop-quote"><div class="pq-lbl">MI POSICIÓN NETA</div><div class="pq-val ${net > 0 ? 'up' : net < 0 ? 'dn' : 'muted'}">${net > 0 ? '+' : ''}${net}</div></div>
      </div>
      ${isOpen ? `<div class="prop-form">
        <input type="number" id="prop-price-${m.key}" placeholder="Precio" style="width:80px;" step="0.01" min="0.01">
        <input type="number" id="prop-qty-${m.key}" placeholder="Cant" style="width:55px;" min="${S.settings.minQty}" max="${S.settings.maxQty}" value="${S.settings.minQty}">
        <button class="btn btn-xs prop-btn-buy" onclick="submitPropOrder('${m.key}','BUY')">▲ COMPRAR</button>
        <button class="btn btn-xs prop-btn-sell" onclick="submitPropOrder('${m.key}','SELL')">▼ VENDER</button>
      </div>` : `<div class="prop-form"><span class="muted" style="font-size:11px;">Mercado cerrado</span></div>`}
      <div class="prop-book-grid">
        <div class="prop-book-col">
          <div class="prop-book-hd up">Compras</div>
          ${bids.slice(0,6).map(o => `<div class="prop-book-row">${o.userId === u ? `<button class="btn-cancel-inline" onclick="cancelOrder('${o.id}')">✕</button>` : '<span class="prop-book-spacer"></span>'}<span class="up">${fmtP(o.price)}</span><span class="muted">${o.remQty}</span></div>`).join('') || '<div class="prop-book-empty">—</div>'}
        </div>
        <div class="prop-book-col">
          <div class="prop-book-hd dn">Ventas</div>
          ${asks.slice(0,6).map(o => `<div class="prop-book-row">${o.userId === u ? `<button class="btn-cancel-inline" onclick="cancelOrder('${o.id}')">✕</button>` : '<span class="prop-book-spacer"></span>'}<span class="dn">${fmtP(o.price)}</span><span class="muted">${o.remQty}</span></div>`).join('') || '<div class="prop-book-empty">—</div>'}
        </div>
      </div>
    </div>`;
  });
  document.getElementById('props-content').innerHTML = html;
}

async function cancelOrder(orderId) {
  const o = S.orders.find(x => x.id === orderId);
  if (!o) return;
  o.status = 'cancelled';
  o.remQty = 0;
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
  if (unset.length) { toast('Faltan posiciones finales: ' + unset.map(c => c.flag + ' ' + c.ticker).join(', '), 'err'); return; }
  const used = S.countries.map(c => c.finalPos);
  if (new Set(used).size !== S.countries.length) { toast('Hay posiciones repetidas', 'err'); return; }
  if (!confirm('¿Confirmar liquidación del torneo? Los saldos finales quedarán calculados.')) return;

  S.gameState = 'closed';
  S.tournamentStatus = 'closed';
  const liveOrders = S.orders.filter(o => o.status === 'live');
  liveOrders.forEach(o => { o.status = 'cancelled'; o.remQty = 0; });

  await Promise.all([
    db.from('game_settings').upsert(
      { tournament_id: S.tournamentId, key: 'game_state', value: 'closed' },
      { onConflict: 'tournament_id,key' }
    ),
    db.from('tournaments').update({ status: 'closed' }).eq('id', S.tournamentId),
    ...liveOrders.map(o => db.from('orders').update({ status: 'cancelled', rem_qty: 0 }).eq('id', o.id)),
  ]);

  toast('Torneo liquidado. Ver saldos en Mi Posición y Saldos Globales.', 'ok');
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
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

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
      <td class="L" style="font-family:var(--mono);color:var(--text3);">${c.ticker}</td>
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
  const list = S.countries.filter(c => !c.isHidden && (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)));
  document.getElementById('mkt-count').textContent = list.length + ' equipos';
  const disabled = S.gameState === 'closed' ? 'disabled' : '';
  // Group by groupLabel (A-L); teams without group go last
  const grouped = {};
  list.forEach(c => {
    const g = c.groupLabel || '';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(c);
  });
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (!a) return 1; if (!b) return -1; return a.localeCompare(b);
  });
  const hasGroups = groupKeys.some(g => g !== '');

  const panelHtml = c => {
    const bb = getBestBid(c.id), ba = getBestAsk(c.id), lt = getLastTrade(c.id), vol = getVolume(c.id);
    const isMeBid = bb && bb.userId === S.currentUser;
    const isMeAsk = ba && ba.userId === S.currentUser;
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
        <div style="min-width:130px;flex-shrink:0;"><div class="cp-name">${c.name}</div><div class="cp-ticker">${c.ticker}</div></div>
        <div style="flex:1;display:flex;justify-content:center;gap:16px;align-items:center;" onclick="event.stopPropagation()">
          <div style="display:flex;gap:3px;align-items:center;">
            <input type="number" id="bp-${c.id}" placeholder="Precio" min="0.01" step="0.01" style="width:68px;padding:3px 6px;font-size:11px;" ${disabled} onfocus="showPriceHint('${c.id}','BUY')">
            <input type="number" id="bq-${c.id}" value="1" min="1" max="${S.settings.maxQty}" step="1" style="width:36px;padding:3px 6px;font-size:11px;text-align:center;" ${disabled}>
            <button class="btn btn-sm btn-green" onclick="submitInlineOrder('${c.id}','BUY')" ${disabled}>BID</button>
          </div>
          <div class="cp-stat"><div class="lbl">Mejor BID${isMeBid ? ' <span style="color:var(--accent);font-size:9px;font-weight:700;">★ TU ORDEN</span>' : ''}</div><div class="val" style="color:var(--green);">${bb ? fmtP(bb.price) : '—'}</div></div>
          <div class="cp-stat"><div class="lbl">Mejor ASK${isMeAsk ? ' <span style="color:var(--accent);font-size:9px;font-weight:700;">★ TU ORDEN</span>' : ''}</div><div class="val" style="color:var(--red);">${ba ? fmtP(ba.price) : '—'}</div></div>
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
  };

  let panelsHtml = '';
  groupKeys.forEach(g => {
    if (hasGroups && g) {
      panelsHtml += `
        <div class="market-group-wrap">
          <div class="market-group-header" onclick="toggleMarketGroup('${g}')">
            <span>🌐 Grupo ${g}</span>
            <span class="mg-count">${grouped[g].length} equipos</span>
            <span class="mg-chevron">▾</span>
          </div>
          <div class="market-group-body" id="mg-${g}">
            ${grouped[g].map(panelHtml).join('')}
          </div>
        </div>`;
    } else {
      panelsHtml += grouped[g].map(panelHtml).join('');
    }
  });
  document.getElementById('market-panels').innerHTML = panelsHtml;
}
function togglePanel(cid) {
  const el = document.getElementById('cp-' + cid);
  if (el) el.classList.toggle('open');
}
function toggleMarketGroup(g) {
  const body = document.getElementById('mg-' + g);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  const header = body.previousElementSibling;
  if (header) {
    const chevron = header.querySelector('.mg-chevron');
    if (chevron) chevron.textContent = isOpen ? '▴' : '▾';
  }
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
    csel.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
    S.countries.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.flag + ' ' + c.name;
      csel.appendChild(o);
    });
  }
  const q    = document.getElementById('hist-q').value.toLowerCase();
  const cid  = document.getElementById('hist-country').value;
  const side = document.getElementById('hist-side').value;
  let tr = S.trades.slice().reverse();
  if (cid) tr = tr.filter(t => t.countryId === cid);
  if (q)   tr = tr.filter(t => {
    const c = S.countries.find(x => x.id === t.countryId);
    return (c && (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q))) ||
           t.buyUserId.toLowerCase().includes(q) || t.sellUserId.toLowerCase().includes(q);
  });
  const nameOf = cid => { const c = S.countries.find(x => x.id === cid); return c ? c.flag + ' ' + c.name : cid; };
  document.getElementById('hist-global-count').textContent = tr.length + ' trades';
  document.getElementById('hist-global-tbody').innerHTML = tr.map(t => {
    const c = S.countries.find(x => x.id === t.countryId) || {};
    return `<tr class="hover-row ${t.annulled ? 'tag-annulled' : ''}">
      <td class="L" style="font-family:var(--mono);font-size:10px;color:var(--text3);">${fmtTS(t.ts)}</td>
      <td class="L">${c.flag || ''} ${c.name || nameOf(t.countryId)}</td>
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
  if (q)    mine = mine.filter(t => { const c = S.countries.find(x => x.id === t.countryId); return c && (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)); });
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
      <td><button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="doCancelOrder('${o.id}')">Cancelar</button></td>
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

  const allTs       = S.trades.filter(t => !t.annulled && (t.buyUserId === u || t.sellUserId === u));
  const totalBought = allTs.filter(t => t.buyUserId  === u).reduce((s, t) => s + t.qty, 0);
  const totalSold   = allTs.filter(t => t.sellUserId === u).reduce((s, t) => s + t.qty, 0);
  const liveOrders  = S.orders.filter(o => o.userId === u && o.status === 'live' && o.remQty > 0).length;
  document.getElementById('mypos-stats').innerHTML = [
    { lbl: 'Contratos Comprados', val: fmtN(totalBought), sub: 'en trades ejecutados' },
    { lbl: 'Contratos Vendidos',  val: fmtN(totalSold),   sub: 'en trades ejecutados' },
    { lbl: 'Órdenes Vivas',       val: fmtN(liveOrders),  sub: 'pendientes de cruce' },
    { lbl: 'Estado Torneo', val: S.gameState === 'closed' ? 'CERRADO' : 'ABIERTO', sub: '', vc: S.gameState === 'closed' ? 'dn' : 'up' },
  ].map(s => `<div class="stat"><div class="stat-lbl">${s.lbl}</div><div class="stat-val ${s.vc || ''}">${s.val}</div><div class="stat-sub">${s.sub}</div></div>`).join('');

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
      <td class="L">${c.flag} <strong>${c.name}</strong> <span style="font-family:var(--mono);font-size:10px;color:var(--text3);">${c.ticker}</span></td>
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

  // Prop market P&L en Mi Posición
  const propEl = document.getElementById('mypos-prop-section');
  if (propEl) {
    const propRows = PROP_MARKETS.map(m => {
      const myTrades = S.trades.filter(t => t.marketType === m.key && !t.annulled);
      let net = 0;
      myTrades.forEach(t => { if (t.buyUserId === u) net += t.qty; if (t.sellUserId === u) net -= t.qty; });
      if (!myTrades.some(t => t.buyUserId === u || t.sellUserId === u)) return null;
      const pnl = getUserPropNetResult(u, m.key);
      const result = S.propResults[m.key];
      return `<tr>
        <td class="L">${m.label}</td>
        <td class="${net > 0 ? 'up' : net < 0 ? 'dn' : 'muted'}" style="font-weight:700;">${net > 0 ? '+' : ''}${net}</td>
        <td>${result != null ? result : '<span class="muted">Pendiente</span>'}</td>
        <td class="${pnl != null ? cls(pnl) : 'muted'}" style="font-weight:700;">${pnl != null ? (pnl >= 0 ? '+' : '') + fmtM(pnl) : '—'}</td>
      </tr>`;
    }).filter(Boolean);
    propEl.innerHTML = propRows.length
      ? `<table><thead><tr><th class="L">Mercado</th><th>Posición Neta</th><th>Resultado</th><th>P&L</th></tr></thead><tbody>${propRows.join('')}</tbody></table>`
      : '<div class="info-banner" style="margin:0;">Sin posiciones en mercados especiales.</div>';
  }

  const sw = document.getElementById('splitwise-section');
  if (S.gameState === 'closed') {
    const flows    = computeLiquidation();
    const owes     = Object.keys(flows).filter(k => k.startsWith(u + '>>')).map(k => ({ to: k.split('>>')[1], amt: flows[k] }));
    const receives = Object.keys(flows).filter(k => k.endsWith('>>' + u)).map(k => ({ from: k.split('>>')[0], amt: flows[k] }));
    const netResult = getUserNetResult(u);

    // Prop settlements separados
    const propSettleHtml = PROP_MARKETS.map(m => {
      const pFlows = computePropLiquidation(m.key);
      const pOwes = Object.keys(pFlows).filter(k => k.startsWith(u + '>>')).map(k => ({ to: k.split('>>')[1], amt: pFlows[k] }));
      const pRecv = Object.keys(pFlows).filter(k => k.endsWith('>>' + u)).map(k => ({ from: k.split('>>')[0], amt: pFlows[k] }));
      if (!pOwes.length && !pRecv.length) return '';
      return `<div class="sw-card" style="border-color:var(--border2);">
        <div class="sw-title">${m.label} — Saldo</div>
        ${pOwes.map(x => `<div class="sw-row"><span>Debés a ${x.to}</span><span class="dn bold">${fmtM(x.amt)}</span></div>`).join('')}
        ${pRecv.map(x => `<div class="sw-row"><span>Cobrás de ${x.from}</span><span class="up bold">${fmtM(x.amt)}</span></div>`).join('')}
      </div>`;
    }).join('');

    sw.innerHTML = `<div class="card">
      <div class="card-hd"><span class="card-title">🔢 Estado de Cuenta Final — Mercado de Equipos</span></div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:12px;">
        <div class="sw-card sw-net">
          <div class="sw-title" style="color:var(--text2);">Resultado Neto Equipos</div>
          <div style="font-family:var(--mono);font-size:20px;font-weight:700;" class="${cls(netResult)}">${netResult >= 0 ? '+' : ''}${fmtM(netResult)}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:4px;">Prima cobrada − Prima pagada ± Premios</div>
        </div>
        ${owes.length ? `<div class="sw-card sw-owe"><div class="sw-title" style="color:var(--red);">Debés pagar a</div>${owes.map(x => `<div class="sw-row"><span>${x.to}</span><span class="dn bold">${fmtM(x.amt)}</span></div>`).join('')}</div>` : ''}
        ${receives.length ? `<div class="sw-card sw-recv"><div class="sw-title" style="color:var(--green);">Tenés para cobrar de</div>${receives.map(x => `<div class="sw-row"><span>${x.from}</span><span class="up bold">${fmtM(x.amt)}</span></div>`).join('')}</div>` : ''}
        ${!owes.length && !receives.length ? '<div class="info-banner">No tenés saldos pendientes con otros jugadores.</div>' : ''}
      </div>
    </div>
    ${propSettleHtml ? `<div class="card" style="margin-top:10px;"><div class="card-hd"><span class="card-title">🎯 Estado de Cuenta — Mercados Especiales</span></div><div style="padding:14px;display:flex;flex-direction:column;gap:12px;">${propSettleHtml}</div></div>` : ''}`;

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
  const tCurrent = S.tournaments.find(t => t.id === S.tournamentId);
  const icEl = document.getElementById('cfg-invite-code');
  if (icEl) icEl.value = tCurrent?.invite_code || '';
  document.getElementById('admin-c-tbody').innerHTML = S.countries.map((c, i) =>
    `<tr style="${c.isHidden ? 'opacity:0.45;' : ''}">
      <td class="L"><input type="text" id="ac-${i}-flag" value="${c.flag}" style="width:50px;text-align:center;"></td>
      <td class="L">
        <input type="text" id="ac-${i}-name" value="${c.name}">
        ${c.isHidden ? '<span style="font-size:9px;color:var(--text3);font-family:var(--mono);margin-left:6px;">OCULTO</span>' : ''}
      </td>
      <td class="L"><input type="text" id="ac-${i}-ticker" value="${c.ticker}" style="width:70px;" disabled></td>
      <td><input type="number" id="ac-${i}-ap" value="${S.auctionPrices[c.id] || 0}" step="0.5" style="width:90px;"></td>
      <td><button type="button" class="csel-btn" id="ac-${i}-pos" data-val="${c.finalPos||''}" onclick="openCsel(this,${S.countries.length})">${c.finalPos ? '#'+c.finalPos : '—'}</button></td>
      <td style="display:flex;gap:4px;align-items:center;">
        <button class="btn btn-xs btn-outline" title="${c.isHidden ? 'Mostrar en mercado' : 'Ocultar del mercado'}"
          style="${c.isHidden ? 'color:var(--green);border-color:var(--green);' : 'color:var(--text3);border-color:var(--border2);'}"
          onclick="toggleHideCountry('${c.id}')">${c.isHidden ? '👁 Mostrar' : '🚫 Ocultar'}</button>
        <button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="removeCountry('${c.id}')">×</button>
      </td>
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
      <td><button class="btn btn-xs btn-red" onclick="adminCancelOrder('${o.id}')">Cancelar</button></td>
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
      <td>${!t.annulled ? `<button class="btn btn-xs btn-outline" style="color:var(--red);border-color:var(--red);" onclick="adminAnnulTrade('${t.id}')">Anular</button>` : ''}</td>
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

  // Pre-populate prop result inputs with saved values
  const gEl = document.getElementById('prop-goals-result');
  const aEl = document.getElementById('prop-amarillas-result');
  const rEl = document.getElementById('prop-rojas-result');
  if (gEl) gEl.value = S.propResults.goals     != null ? S.propResults.goals     : '';
  if (aEl) aEl.value = S.propResults.amarillas  != null ? S.propResults.amarillas : '';
  if (rEl) rEl.value = S.propResults.rojas      != null ? S.propResults.rojas     : '';
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
  document.getElementById('om-ticker').textContent  = c.ticker;
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
  const c = S.countries.find(x => x.id === OM.cid);
  toast(`Orden ${OM.side} ingresada: ${fmtN(qty)} contratos de ${c ? c.ticker : OM.cid} a ${fmtP(price)}`, 'ok');
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
async function cancelAllMyOrders() {
  const myOrds = S.orders.filter(o => o.userId === S.currentUser && o.status === 'live' && o.remQty > 0);
  if (!myOrds.length) { toast('No tenés órdenes vivas', 'err'); return; }
  if (!confirm(`¿Cancelar todas tus ${myOrds.length} órdenes vivas?`)) return;
  await Promise.all(myOrds.map(o => cancelOrder(o.id)));
  toast(`${myOrds.length} órdenes canceladas`, 'ok');
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
  if (!S.currentUser) { toast('Sesión no iniciada', 'err'); return; }
  const priceEl = document.getElementById((side === 'BUY' ? 'bp-' : 'ap-') + cid);
  const qtyEl   = document.getElementById((side === 'BUY' ? 'bq-' : 'aq-') + cid);
  const price   = parseFloat(priceEl?.value);
  const qty     = parseInt(qtyEl?.value) || 1;
  if (!price || price <= 0) { toast('Ingresá un precio válido', 'err'); return; }
  const r = await placeOrder(S.currentUser, cid, side, price, qty);
  if (!r.ok) { toast(r.msg, 'err'); return; }
  priceEl.value = '';
  const c = S.countries.find(x => x.id === cid);
  toast(`${side === 'BUY' ? 'BID' : 'ASK'} ingresado: ${fmtN(qty)} contrato(s) de ${c ? c.ticker : cid} a ${fmtP(price)}`, 'ok');
  renderAll();
}
async function savePrizes() {
  const n = S.countries.length;
  const updates = [];
  for (let i = 1; i <= n; i++) {
    const v = parseFloat(document.getElementById(`pr-${i}`)?.value || 0);
    if (v < 0) { toast('Los premios no pueden ser negativos', 'err'); return; }
    S.prizeTable[i] = v;
    updates.push(db.from('prizes').upsert(
      { tournament_id: S.tournamentId, position: i, amount: v },
      { onConflict: 'tournament_id,position' }
    ));
  }
  await Promise.all(updates);
  toast('Premios guardados', 'ok');
  renderInicio();
  renderAll();
}
async function saveSettings() {
  const minQ       = parseInt(document.getElementById('cfg-min')?.value) || 1;
  const maxQ       = parseInt(document.getElementById('cfg-max')?.value) || 5;
  const inviteCode = (document.getElementById('cfg-invite-code')?.value || '').trim() || null;
  S.settings.minQty = minQ;
  await Promise.all([
    db.from('game_settings').upsert(
      { tournament_id: S.tournamentId, key: 'min_qty', value: String(minQ) },
      { onConflict: 'tournament_id,key' }
    ),
    db.from('game_settings').upsert(
      { tournament_id: S.tournamentId, key: 'max_qty', value: String(maxQ) },
      { onConflict: 'tournament_id,key' }
    ),
    db.from('tournaments').update({ invite_code: inviteCode }).eq('id', S.tournamentId),
  ]);
  toast('Configuración guardada', 'ok');
}
async function saveCountries() {
  const updates = [];
  S.countries.forEach((c, i) => {
    c.flag    = document.getElementById(`ac-${i}-flag`)?.value || c.flag;
    c.name    = document.getElementById(`ac-${i}-name`)?.value || c.name;
    const ap  = parseFloat(document.getElementById(`ac-${i}-ap`)?.value || 0);
    const pos = parseInt(document.getElementById(`ac-${i}-pos`)?.dataset.val);
    S.auctionPrices[c.id] = ap;
    c.finalPos = isNaN(pos) ? null : pos;
    updates.push(db.from('teams').update({
      flag: c.flag, name: c.name, auction_price: ap, final_pos: c.finalPos || null,
    }).eq('id', c.id));
  });
  await Promise.all(updates);
  toast('Equipos guardados', 'ok');
  renderInicio();
  renderAll();
}
async function addCountry() {
  const ticker = prompt('Ticker del equipo (ej: MIL):')?.toUpperCase().trim();
  const name   = prompt('Nombre completo:')?.trim();
  const flag   = prompt('Emoji bandera/escudo:')?.trim() || '🏳️';
  if (!ticker || !name) return;
  if (S.countries.find(c => c.ticker === ticker)) { toast('Ya existe un equipo con ese ticker', 'err'); return; }
  const { error } = await db.from('teams').insert({
    tournament_id: S.tournamentId,
    ticker, name, flag, auction_price: 0, display_order: S.countries.length + 1,
  });
  if (error) { toast(error.message, 'err'); return; }
  await db.from('prizes').upsert(
    { tournament_id: S.tournamentId, position: S.countries.length + 1, amount: 0 },
    { onConflict: 'tournament_id,position' }
  );
  await loadState();
  toast(`Equipo ${ticker} agregado`, 'ok');
  renderAdmin();
}
async function toggleHideCountry(id) {
  const c = S.countries.find(x => x.id === id);
  if (!c) return;
  c.isHidden = !c.isHidden;
  await db.from('teams').update({ is_hidden: c.isHidden }).eq('id', id);
  toast(c.isHidden ? `${c.flag} ${c.name} ocultado del mercado` : `${c.flag} ${c.name} visible en el mercado`, 'ok');
  renderAdmin();
  renderMarket();
}
async function removeCountry(id) {
  const c = S.countries.find(x => x.id === id);
  if (!confirm(`¿Eliminar el equipo ${c ? c.ticker : id}? Esto borrará sus órdenes y trades relacionados.`)) return;
  await db.from('teams').delete().eq('id', id);
  await loadState();
  renderAdmin();
}
async function resetGame() {
  if (!confirm('¿Iniciar nueva partida? Se eliminarán TODOS los trades y órdenes, y se reabrirá el torneo.')) return;
  await Promise.all([
    db.from('trades').delete().eq('tournament_id', S.tournamentId),
    db.from('orders').delete().eq('tournament_id', S.tournamentId),
    db.from('game_settings').upsert(
      { tournament_id: S.tournamentId, key: 'game_state', value: 'open' },
      { onConflict: 'tournament_id,key' }
    ),
    db.from('tournaments').update({ status: 'open' }).eq('id', S.tournamentId),
  ]);
  S.tournamentStatus = 'open';
  await loadState();
  renderAll();
  toast('Nueva partida iniciada', 'ok');
}

/* ═══════════════════════════════
   AUTENTICACIÓN
═══════════════════════════════ */
let _loginTab = 'in';

function showLoginScreen() { document.getElementById('login-screen').classList.remove('hidden'); }
function hideLoginScreen() { document.getElementById('login-screen').classList.add('hidden'); }

// ── Reset password screen ──
function showResetScreen() {
  hideLoginScreen();
  document.getElementById('reset-password-screen').classList.remove('hidden');
  document.getElementById('rp-pass').focus();
}
function hideResetScreen() {
  document.getElementById('reset-password-screen').classList.add('hidden');
}
async function handlePasswordReset() {
  const p1 = document.getElementById('rp-pass').value;
  const p2 = document.getElementById('rp-pass2').value;
  const err = document.getElementById('rp-error');
  err.style.display = 'none';
  if (!p1 || p1.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; err.style.display = ''; return; }
  if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden.'; err.style.display = ''; return; }
  const btn = document.getElementById('rp-submit');
  btn.disabled = true; btn.textContent = 'Guardando...';
  const { error } = await db.auth.updateUser({ password: p1 });
  btn.disabled = false; btn.textContent = 'Guardar contraseña';
  if (error) { err.textContent = error.message; err.style.display = ''; return; }
  hideResetScreen();
  toast('Contraseña actualizada. Ingresá con tu nueva clave.', 'ok');
  showLoginScreen();
}
async function showForgotPassword() {
  const email = document.getElementById('l-email').value.trim();
  if (!email) { _setLoginError('Ingresá tu email primero.'); return; }
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/',
  });
  if (error) { _setLoginError(error.message); return; }
  _setLoginError('');
  toast('¡Listo! Revisá tu email para el link de reset.', 'ok');
}

function switchLoginTab(tab) {
  _loginTab = tab;
  document.getElementById('ltab-in').classList.toggle('active', tab === 'in');
  document.getElementById('ltab-up').classList.toggle('active', tab === 'up');
  document.getElementById('lf-name').style.display  = tab === 'up' ? '' : 'none';
  document.getElementById('l-submit').textContent   = tab === 'in' ? 'Ingresar' : 'Crear cuenta';
  document.getElementById('l-hint').style.display   = tab === 'up' ? 'none' : '';
  _clearLoginError();
}
function _setLoginError(msg) {
  const el = document.getElementById('l-error');
  el.textContent = msg; el.style.display = '';
}
function _clearLoginError() { document.getElementById('l-error').style.display = 'none'; }

async function handleAuth() {
  _clearLoginError();
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) { _setLoginError('Completá email y contraseña.'); return; }
  const btn = document.getElementById('l-submit');
  btn.disabled = true; btn.textContent = 'Cargando...';
  try {
    if (_loginTab === 'in') {
      await _doSignIn(email, pass);
    } else {
      const name = document.getElementById('l-name').value.trim();
      if (!name) { _setLoginError('Ingresá tu nombre.'); return; }
      await _doSignUp(name, email, pass);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = _loginTab === 'in' ? 'Ingresar' : 'Crear cuenta';
  }
}

async function _doSignIn(email, pass) {
  const { data, error } = await db.auth.signInWithPassword({ email, password: pass });
  if (error) { _setLoginError('Email o contraseña incorrectos.'); return; }
  await _afterAuth(data.user);
}

async function _doSignUp(name, email, pass) {
  const { data, error } = await db.auth.signUp({ email, password: pass });
  if (error) { _setLoginError(error.message); return; }

  // Chequear si es el primer player global
  const { count } = await db.from('players').select('id', { count: 'exact', head: true });
  const isFirst   = count === 0;
  const playerId  = _generateId(name);

  const { error: e2 } = await db.from('players').insert({
    id: playerId, name, email,
    auth_user_id: data.user.id,
    is_admin: isFirst,
  });
  if (e2) {
    await db.auth.signOut();
    _setLoginError('Error al crear el perfil: ' + e2.message);
    return;
  }
  await _afterAuth(data.user);
}

function _generateId(name) {
  const base = name.toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return base || 'P' + Date.now().toString().slice(-5);
}

async function _afterAuth(authUser) {
  const { data: player, error } = await db.from('players')
    .select('*').eq('auth_user_id', authUser.id).single();
  if (error || !player) {
    await db.auth.signOut();
    _setLoginError('No se encontró tu perfil. Registrate primero.');
    return;
  }
  _setCurrentPlayer(player);
  hideLoginScreen();

  // Ir al lobby
  showLoading('Cargando torneos...');
  await loadTournaments();
  hideLoading();
  showLobby();
  renderLobby();
  toast('Bienvenido, ' + player.name + ' 👋', 'ok');
}

function _setCurrentPlayer(player) {
  S.currentUser = player.id;
  S.isAdmin     = player.is_admin || false;
  document.getElementById('cur-user-lbl').textContent = player.name || player.id;
}

async function handleLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  if (_realtimeChannel) {
    db.removeChannel(_realtimeChannel);
    _realtimeChannel = null;
  }
  await db.auth.signOut();
  S.currentUser      = null;
  S.isAdmin          = false;
  S.tournamentId     = null;
  S.isTournamentAdmin= false;
  document.getElementById('cur-user-lbl').textContent = '—';
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('back-to-lobby-btn').style.display = 'none';
  document.getElementById('tournament-name-badge').style.display = 'none';
  showLoginScreen();
}

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
    return `<span class="tick-item"><span class="sym">${c.ticker}</span><span class="px">${px ? fmtP(px) : '—'}</span>${chgStr}</span>`;
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
  if (name === 'props')   renderProps();
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
  if (!S.tournamentId) return;
  const active = document.querySelector('.tab.active')?.dataset?.tab;
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.style.display = S.isTournamentAdmin ? '' : 'none';
  });
  renderTicker();
  updateStatus();
  if (active === 'inicio')  renderInicio();
  if (active === 'market')  renderMarket();
  if (active === 'props')   renderProps();
  if (active === 'history') renderHistory();
  if (active === 'mypos')   renderMyPos();
  if (active === 'admin')   renderAdmin();
  if (active === 'saldos')  renderSaldos();
  if (S.currentUser) document.getElementById('cur-user-lbl').textContent = S.currentUser;
}

/* ═══════════════════════════════
   KEYBOARD / MODAL
═══════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeCreateTournament();
  }
  if (e.key === 'Enter' && !document.getElementById('login-screen').classList.contains('hidden')) {
    handleAuth();
  }
  if (e.key === 'Enter' && document.getElementById('create-tournament-modal').classList.contains('open')) {
    confirmCreateTournament();
  }
});
document.getElementById('order-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('order-modal')) closeModal();
});
document.getElementById('create-tournament-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('create-tournament-modal')) closeCreateTournament();
});

/* ═══════════════════════════════
   DOWNLOAD CSV
═══════════════════════════════ */
function downloadTradesCSV(type) {
  const q    = document.getElementById('hist-q').value.toLowerCase();
  const cid  = document.getElementById('hist-country').value;
  const side = document.getElementById('hist-side').value;
  const u    = S.currentUser;
  let headers, rows, filename;

  if (type === 'global') {
    let tr = S.trades.slice().reverse();
    if (cid) tr = tr.filter(t => t.countryId === cid);
    if (q)   tr = tr.filter(t => { const c = S.countries.find(x => x.id === t.countryId); return (c && (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q))) || t.buyUserId.toLowerCase().includes(q) || t.sellUserId.toLowerCase().includes(q); });
    headers  = ['Hora','Equipo','Ticker','Comprador','Vendedor','Cantidad','Precio (miles $)','Nocional Total','Estado'];
    rows     = tr.map(t => {
      const c = S.countries.find(x => x.id === t.countryId) || {};
      return [fmtTS(t.ts), c.name || t.countryId, c.ticker || t.countryId, t.buyUserId, t.sellUserId, t.qty, t.price, (t.qty * t.price * 1000).toFixed(0), t.annulled ? 'ANULADO' : 'EJECUTADO'];
    });
    filename = `${S.tournamentName.replace(/\s+/g,'_')}_todos_los_trades.csv`;
  } else {
    let mine = S.trades.slice().reverse().filter(t => t.buyUserId === u || t.sellUserId === u);
    if (cid)  mine = mine.filter(t => t.countryId === cid);
    if (side) mine = mine.filter(t => side === 'BUY' ? t.buyUserId === u : t.sellUserId === u);
    if (q)    mine = mine.filter(t => { const c = S.countries.find(x => x.id === t.countryId); return c && (c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)); });
    headers  = ['Hora','Equipo','Ticker','Lado','Contraparte','Cantidad','Precio (miles $)','Nocional','Estado'];
    rows     = mine.map(t => {
      const c = S.countries.find(x => x.id === t.countryId) || {};
      const isBuy = t.buyUserId === u;
      return [fmtTS(t.ts), c.name || t.countryId, c.ticker || t.countryId, isBuy ? 'COMPRE' : 'VENDI', isBuy ? t.sellUserId : t.buyUserId, t.qty, t.price, (t.qty * t.price * 1000).toFixed(0), t.annulled ? 'ANULADO' : 'EJECUTADO'];
    });
    filename = `${S.tournamentName.replace(/\s+/g,'_')}_mis_operaciones.csv`;
  }

  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════
   CUSTOM SELECT (Pos. Final)
═══════════════════════════════ */
function openCsel(btn, n) {
  document.getElementById('csel-list')?.remove();
  const r = btn.getBoundingClientRect();
  const cur = String(btn.dataset.val);
  const list = document.createElement('div');
  list.id = 'csel-list';

  const maxH = 220;
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const openUp = spaceBelow < maxH && r.top > spaceBelow;

  Object.assign(list.style, {
    position: 'fixed', left: r.left + 'px',
    minWidth: Math.max(r.width, 80) + 'px',
    maxHeight: maxH + 'px', overflowY: 'auto',
    background: '#0d1117', border: '1px solid #2a3a50',
    borderRadius: '4px', zIndex: '99999',
    boxShadow: '0 6px 24px rgba(0,0,0,.85)', fontFamily: 'monospace',
  });
  if (openUp) list.style.bottom = (window.innerHeight - r.top + 2) + 'px';
  else list.style.top = (r.bottom + 2) + 'px';

  const opts = [{ v: '', l: '—' }, ...Array.from({ length: n }, (_, k) => ({ v: String(k + 1), l: '#' + (k + 1) }))];
  opts.forEach(o => {
    const d = document.createElement('div');
    d.textContent = o.l;
    const active = o.v === cur;
    Object.assign(d.style, {
      padding: '7px 14px', cursor: 'pointer', fontSize: '12px',
      color: active ? '#3d9eff' : '#dce8f5', fontWeight: active ? '700' : '400',
    });
    d.onmouseenter = () => { d.style.background = '#1a2133'; };
    d.onmouseleave = () => { d.style.background = ''; };
    d.onclick = e => { e.stopPropagation(); btn.dataset.val = o.v; btn.textContent = o.l; list.remove(); };
    list.appendChild(d);
  });

  document.body.appendChild(list);

  const activeIdx = opts.findIndex(o => o.v === cur);
  if (activeIdx > 0) list.children[activeIdx]?.scrollIntoView({ block: 'nearest' });

  const closeHandler = e => {
    if (!list.contains(e.target) && e.target !== btn) {
      list.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

/* ═══════════════════════════════
   BOOT
═══════════════════════════════ */
(async () => {
  showLoading('Conectando...');

  if (!_CONFIGURED) {
    document.querySelector('#loading-overlay .loader-msg').textContent =
      '⚠️ Configurá las credenciales de Supabase en js/app.js';
    document.querySelector('#loading-overlay .loader-spinner').style.display = 'none';
    return;
  }

  // Detectar token de reset de contraseña en la URL
  db.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      hideLoading();
      hideLoginScreen();
      showResetScreen();
    }
  });

  try {
    const { data: { session } } = await db.auth.getSession();

    if (session) {
      const { data: player } = await db.from('players')
        .select('*').eq('auth_user_id', session.user.id).single();
      if (player) {
        _setCurrentPlayer(player);
        await loadTournaments();
        hideLoading();
        showLobby();
        renderLobby();
        return;
      }
      await db.auth.signOut();
    }

    hideLoading();
    showLoginScreen();
  } catch (err) {
    console.error(err);
    document.querySelector('#loading-overlay .loader-msg').textContent =
      '❌ Error al conectar con Supabase. Revisá las credenciales en js/app.js';
    document.querySelector('#loading-overlay .loader-spinner').style.display = 'none';
  }
})();
