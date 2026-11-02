'use strict';
/* client.js — tap-first phone UI for the ocgcore client (Phase 1).
   Interaction semantics follow YGOPro/EDOPro conventions: actions are listed
   on the card, placement/position happen on the field, chain responses are a
   dock with numbered chain links shown in the mid bar. The client only ever
   answers prompts the core issues — it never invents game actions. */
const E = window.Engine;
const $ = (id) => document.getElementById(id);

let DATA = null;
let duel = null;
let HP = 0; // core seat occupied by the human (0 = first player, 1 = second player)
let currentPrompt = null;   // {prompt, resolve} while a human prompt is open
let actionMap = new Map();  // "con:loc:seq" -> [{label, bytes}] for idle/battle prompts
let phaseAction = null;     // {label, bytes} for the phase button
let menuActions = [];       // extra idle actions (hand shuffle)
let placeCtx = null;        // active SELECT_PLACE/DISFIELD interaction
let dismissedChains = new Set(); // chain-candidate dismissals (this chain only)
let dismissedDuel = new Map();   // chain-candidate dismissals (whole duel): chainKey -> {code}
// start-screen choices (Phase 2 item 5)
let myDeckKey = 'ishizu', opDeckKey = 'gg', firstChoice = 'first';
let autoPassFlashUntil = 0;

function cardName(code) { return (DATA && DATA.names[code]) || ('#' + code); }
function cardData(code) { return (DATA && DATA.cards[code]) || null; }
function locLabel(e) {
  const who = e.con === HP ? '自分' : '相手';
  switch (e.loc) {
    case E.LOC.HAND: return who + 'の手札';
    case E.LOC.MZONE: return who + 'のモンスターゾーン' + (e.seq + 1);
    case E.LOC.SZONE: return who + 'の魔法・罠ゾーン' + (e.seq + 1);
    case E.LOC.GRAVE: return who + 'の墓地';
    case E.LOC.REMOVED: return who + 'の除外';
    case E.LOC.EXTRA: return who + 'のEXデッキ';
    case E.LOC.DECK: return who + 'のデッキ';
    default: return who;
  }
}
function isMonster(code) { const d = cardData(code); return d && (d.type & 0x1); }
function statsLine(code) {
  const d = cardData(code); if (!d || !(d.type & 0x1)) return '';
  return '攻' + d.atk + '／守' + d.def;
}
function cardText(code) { return (DATA && DATA.texts && DATA.texts[code]) ? DATA.texts[code].text : ''; }
function cardMetaLine(code) {
  const d = cardData(code); if (!d) return '';
  const parts = [];
  const attr = E.ATTRIBUTES.find(([b]) => b === d.attribute); if (attr) parts.push(attr[1] + '属性');
  const race = E.RACES.find(([b]) => BigInt(b) === BigInt(d.race)); if (race && (d.type & 0x1)) parts.push(race[1] + '族');
  if (d.type & 0x1) parts.push('レベル' + d.level);
  return parts.join('／');
}
// Source context of a prompt (Phase 2 item 1): the chain link whose effect is
// asking. Attached by the engine driver from the core's CHAINING stream.
function contextLineHTML(prompt) {
  const ctx = prompt && prompt.context;
  if (!ctx) return '';
  return '<div class="ctx">「' + cardName(ctx.code) + '」の効果による確認（' + locLabel(ctx) + '）</div>';
}
function contextText(prompt) {
  const ctx = prompt && prompt.context;
  return ctx ? '「' + cardName(ctx.code) + '」の効果：' : '';
}
// ---------------------------------------------------------------- audio (item 6)
// User-assigned files only (assets/se, assets/bgm). No generated audio.
const SE_FILES = new Set(['ui_click', 'set_card', 'activate_card', 'vs_start',
  'atk_dark', 'atk_earth', 'atk_fire', 'atk_light', 'atk_water', 'atk_wind', 'atk_sword_big',
  'hit_big', 'hit_critical', 'destroy_blast', 'destroy_stone', 'banish_warp', 'recover',
  'negate_shield', 'summon_circle', 'summon_big', 'summon_land']);
const seCache = {}, seLast = {};
let audioOn = true;
function playSe(name) {
  if (!audioOn || !SE_FILES.has(name)) return;
  const now = performance.now();
  if (seLast[name] && now - seLast[name] < 150) return;
  seLast[name] = now;
  try {
    let a = seCache[name];
    if (!a) { a = new Audio('../assets/se/' + name + '.mp3'); a.volume = 0.6; seCache[name] = a; }
    a.currentTime = 0; a.play().catch(() => {});
  } catch (e) {}
}
function playClick() { playSe('ui_click'); }
// BGM scenes: start = user upload track; duel scenes follow the old app's
// LP + field-ATK advantage mapping, with hysteresis and a minimum dwell so
// the track never flaps. Switching is deferred while a prompt is open.
const BGM = { start: 'ishizu-upload.mp3', neutral: 'ishizu-start.mp3', adv: 'ishizu-advantage.mp3',
  bigadv: 'ishizu-big-advantage.mp3', dis: 'ishizu-caravan.mp3' };
const BIGDIS_POOL = ['ishizu-voice-note-2.mp3', 'ishizu-mystical.mp3'];
let bgmEl = null, bgmScene = null, bgmSceneSince = 0;
function setBgmScene(scene, force) {
  if (!audioOn) return;
  if (scene === bgmScene && !force) return;
  const file = scene === 'bigdis' ? BIGDIS_POOL[Math.floor(Math.random() * BIGDIS_POOL.length)] : BGM[scene];
  if (!file) return;
  try {
    if (!bgmEl) { bgmEl = new Audio(); bgmEl.loop = true; bgmEl.volume = 0.55; }
    bgmEl.src = '../assets/bgm/' + file;
    bgmEl.play().catch(() => {});
    bgmScene = scene; bgmSceneSince = Date.now();
  } catch (e) {}
}
function advantageScore(state) {
  const sumAtk = (P) => P.mzone.reduce((a, c) => a + (c && (c.pos & E.POS_FACEUP)
    ? (c.curAtk != null ? c.curAtk : (cardData(c.code) ? cardData(c.code).atk : 0)) : 0), 0);
  const me = state.players[HP], op = state.players[1 - HP];
  return (me.lp - op.lp) + (sumAtk(me) - sumAtk(op));
}
function sceneForScore(score, cur) {
  if (score >= 2600) return 'bigadv';
  if (score <= -2600) return 'bigdis';
  if (cur === 'bigadv' && score >= 2000) return 'bigadv';
  if (cur === 'bigdis' && score <= -2000) return 'bigdis';
  if (score >= 900) return 'adv';
  if (score <= -900) return 'dis';
  if (cur === 'adv' && score >= 500) return 'adv';
  if (cur === 'dis' && score <= -500) return 'dis';
  return 'neutral';
}
function updateBgm(state) {
  if (!duel || !state || state.winner != null || !bgmScene || bgmScene === 'start') return;
  if (currentPrompt) return; // never switch under the player's fingers
  if (Date.now() - bgmSceneSince < 8000) return;
  const sc = sceneForScore(advantageScore(state), bgmScene);
  if (sc !== bgmScene) setBgmScene(sc);
}
// Drain the engine's presentation event queue into SE cues.
const ATTR_SE = { 1: 'atk_earth', 2: 'atk_water', 4: 'atk_fire', 8: 'atk_wind', 16: 'atk_light', 32: 'atk_dark', 64: 'atk_light' };
function drainSeEvents(state) {
  if (!state.events || !state.events.length) return;
  const evs = state.events.splice(0, state.events.length);
  for (const ev of evs) {
    switch (ev.kind) {
      case 'set': playSe('set_card'); break;
      case 'activate': playSe('activate_card'); break;
      case 'summon': playSe('summon_circle'); break;
      case 'spsummon': playSe('summon_big'); break;
      case 'flipsummon': playSe('summon_land'); break;
      case 'attack': { const d = ev.code != null ? cardData(ev.code) : null; playSe(d ? (ATTR_SE[d.attribute] || 'atk_sword_big') : 'atk_sword_big'); break; }
      case 'damage': if (ev.amount >= 1500) playSe('hit_critical'); else if (ev.amount >= 500) playSe('hit_big'); break;
      case 'destroy': playSe(ev.battle ? 'destroy_blast' : 'destroy_stone'); break;
      case 'banish': playSe('banish_warp'); break;
      case 'recover': playSe('recover'); break;
      case 'negate': playSe('negate_shield'); break;
    }
  }
}

// ---------------------------------------------------------------- rendering
function tileHTML(card, con, actKey) {
  if (!card) return '';
  const faceUp = (card.pos & E.POS_FACEUP) !== 0;
  const isDef = (card.pos & E.POS_DEFENSE) !== 0;
  const showFace = faceUp || con === HP;
  const nm = showFace && card.code != null ? cardName(card.code) : '';
  // live (effect-modified) values from the core query when available
  const st = showFace && card.code != null
    ? (card.curAtk != null && isMonster(card.code) ? '攻' + card.curAtk + '／守' + card.curDef : statsLine(card.code)) : '';
  return '<div class="tile' + (isDef ? ' def' : '') + (showFace ? '' : ' back') + (actKey && actionMap.has(actKey) ? ' actionable' : '') + '"' +
    (actKey ? ' data-act="' + actKey + '"' : '') + '>' +
    (card.materials ? '<div class="mats">×' + card.materials + '</div>' : '') +
    '<div class="inner">' +
    (nm ? '<div class="nm">' + nm + '</div>' : '') +
    (st ? '<div class="st">' + st + '</div>' : '') +
    '</div></div>';
}
function zoneRow(el, cards, con, loc, small) {
  el.innerHTML = cards.map((card, seq) => {
    const key = con + ':' + loc + ':' + seq;
    const hl = placeCtx && placeCtx.avail.has(key) ? ' hl' : '';
    const pk = placeCtx && placeCtx.chosen.has(key) ? ' picked' : '';
    const emz = loc === E.LOC.MZONE && seq >= 5 ? ' emz' : '';
    return '<div class="slot' + (small ? ' small' : '') + emz + hl + pk + '" data-zone="' + key + '">' +
      '<span class="znum">' + (loc === E.LOC.SZONE && seq === 5 ? 'F' : (seq + 1)) + '</span>' +
      (card ? tileHTML(card, con, key) : '') +
      '</div>';
  }).join('');
}
function pileHTML(p, con) {
  const P = duelState.players[con];
  const actGrave = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.GRAVE + ':'));
  const actExtra = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.EXTRA + ':'));
  const actRem = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.REMOVED + ':'));
  return '<div class="pile" data-pile="deck:' + con + '">デッキ <b>' + P.deckCount + '</b></div>' +
    '<div class="pile' + (actExtra ? ' actionable' : '') + '" data-pile="extra:' + con + '">EX <b>' + P.extra.length + '</b></div>' +
    '<div class="pile' + (actGrave ? ' actionable' : '') + '" data-pile="grave:' + con + '">墓地 <b>' + P.grave.length + '</b></div>' +
    '<div class="pile' + (actRem ? ' actionable' : '') + '" data-pile="removed:' + con + '">除外 <b>' + P.removed.length + '</b></div>' +
    '<div class="pile" data-pile="hand:' + con + '">手札 <b>' + P.hand.length + '</b></div>';
}
let duelState = null;
function render(state) {
  duelState = state;
  const me = state.players[HP], op = state.players[1 - HP];
  $('oppLp').textContent = op.lp;
  $('myLp').textContent = me.lp;
  $('opppiles').innerHTML = '手札 ' + op.hand.length + '<br>デッキ ' + op.deckCount;
  $('turninfo').textContent = 'ターン' + Math.max(1, state.turnCount) + '／' + (state.turnPlayer === HP ? '自分' : '相手');
  $('phaseinfo').textContent = state.phaseName ? ('フェイズ：' + phaseJa(state.phaseName) + (state.turnPlayer === HP ? '（自分のターン）' : '（相手のターン）')) : '—';
  zoneRow($('oppSzone'), [0,1,2,3,4,5].map(i => op.szone[i]), 1 - HP, E.LOC.SZONE, true);
  zoneRow($('oppMzone'), op.mzone, 1 - HP, E.LOC.MZONE, false);
  zoneRow($('myMzone'), me.mzone, HP, E.LOC.MZONE, false);
  zoneRow($('mySzone'), [0,1,2,3,4,5].map(i => me.szone[i]), HP, E.LOC.SZONE, true);
  $('oppPilebar').innerHTML = pileHTML(null, 1 - HP);
  $('myPilebar').innerHTML = pileHTML(null, HP);
  // hand
  $('handcount').textContent = me.hand.length;
  $('hand').innerHTML = me.hand.map((c, i) => {
    const key = HP + ':' + E.LOC.HAND + ':' + i;
    const act = actionMap.has(key) ? ' actionable' : '';
    return '<div class="hcard' + act + '" data-act="' + key + '"><div class="nm">' + (c.code != null ? cardName(c.code) : '？') + '</div>' +
      (c.code != null && statsLine(c.code) ? '<div class="st">' + statsLine(c.code) + '</div>' : '') + '</div>';
  }).join('');
  // opponent hand = backs in topbar only (count); chain bar
  const cb = $('chainbar');
  if (state.chain.length) {
    cb.className = 'on';
    cb.innerHTML = state.chain.map((l, i) => {
      const n = i + 1;
      const cls = 'link' + (state.solvingLink === n ? ' solving' : '') + (l.negated || l.disabled ? ' negated' : '');
      return '<span class="' + cls + '"><span class="no">' + n + '</span> ' + cardName(l.code) + (l.solved ? ' ✓' : '') + '</span>';
    }).join('');
  } else { cb.className = ''; cb.innerHTML = ''; }
  $('logline').textContent = state.log.length ? state.log[state.log.length - 1] : '';
  // phase button
  const pb = $('phasebtn');
  if (phaseAction) { pb.disabled = false; pb.textContent = phaseAction.label; }
  else { pb.disabled = true; pb.textContent = currentPrompt ? '選択中…' : '—'; }
  $('menubtn').style.display = menuActions.length ? '' : 'none';
}
function phaseJa(n) {
  return { DRAW: 'ドロー', STANDBY: 'スタンバイ', MAIN1: 'メイン1', BATTLE_START: 'バトル開始', BATTLE_STEP: 'バトルステップ',
    DAMAGE: 'ダメージ計算前', DAMAGE_CAL: 'ダメージ計算時', BATTLE: 'バトル', MAIN2: 'メイン2', END: 'エンド' }[n] || n;
}
// Confirmation prompts (chain / effect-yes-no) recur at MANY timings with
// the same candidate set — a set quick-play spell is re-offered at every
// phase boundary of the opponent's turn (measured in Node: 170+ prompts in
// one duel, nearly all with identical candidates). Each one IS a new
// timing: passing (SELECT_CHAIN i32 -1 / EFFECTYN i32 0) is always accepted
// (0 MSG_RETRY) and really advances the game — but a byte-identical dock
// made it look stuck. So every shown confirmation now carries the turn
// owner + phase and a per-turn sequence number that increments per prompt.
let confirmTurn = -1, confirmSeq = 0;
function timingText(state) {
  const ph = state.phaseName ? '・' + phaseJa(state.phaseName) : '';
  return (state.turnPlayer === HP ? '自分のターン' : '相手のターン') + ph;
}
function confirmTag(state) { // call ONCE per shown prompt, never per redraw
  if (state.turnCount !== confirmTurn) { confirmTurn = state.turnCount; confirmSeq = 0; }
  confirmSeq++;
  return '（このターン' + confirmSeq + '回目の確認）';
}

// ---------------------------------------------------------------- prompt UI
function sheetOpen(html) { $('sheet').innerHTML = html; $('sheetwrap').className = 'on'; }
function sheetClose() { $('sheetwrap').className = ''; $('sheet').innerHTML = ''; }
function dockClose() { $('dock').className = ''; $('dock').innerHTML = ''; }
function clearInteraction() {
  sheetClose(); dockClose();
  actionMap = new Map(); phaseAction = null; menuActions = []; placeCtx = null;
  $('placehint').className = '';
}
function retryWarn(prompt) {
  return prompt.retryCount ? '<div class="warn">その選択はできませんでした。選び直してください。</div>' : '';
}
function finishPrompt(bytes) {
  const cp = currentPrompt;
  clearInteraction();
  if (duelState) render(duelState);
  if (cp) { currentPrompt = null; cp.resolve(bytes); }
}
function uiAnswer(prompt, state) {
  return new Promise((resolve) => {
    currentPrompt = { prompt, resolve };
    if (duel) { try { duel.refreshFieldStats(); } catch (e) {} } // live ATK/DEF behind the prompt UI
    try {
      dispatchPrompt(prompt, state);
    } catch (err) {
      // never dead-end: fall back to the bot policy answer for this prompt
      finishPrompt(E.botAnswer(prompt, state, DATA, E.makeBotMemory()));
    }
  });
}
function dispatchPrompt(prompt, state) {
  switch (prompt.name) {
    case 'SELECT_IDLECMD': case 'SELECT_BATTLECMD': return uiCmd(prompt, state);
    case 'SELECT_CHAIN': return uiChain(prompt, state);
    case 'SELECT_PLACE': case 'SELECT_DISFIELD': return uiPlace(prompt, state);
    case 'SELECT_POSITION': return uiPosition(prompt, state);
    case 'SELECT_CARD': case 'SELECT_TRIBUTE': return uiSelectCards(prompt, state);
    case 'SELECT_UNSELECT_CARD': return uiUnselect(prompt, state);
    case 'SELECT_SUM': return uiSelectSum(prompt, state);
    case 'SELECT_COUNTER': return uiCounter(prompt, state);
    case 'SORT_CARD': case 'SORT_CHAIN': return uiSort(prompt, state);
    case 'SELECT_YESNO': case 'SELECT_EFFECTYN': return uiYesNo(prompt, state);
    case 'SELECT_OPTION': return uiOption(prompt, state);
    case 'ANNOUNCE_RACE': case 'ANNOUNCE_ATTRIB': return uiAnnounceBits(prompt, state);
    case 'ANNOUNCE_NUMBER': return uiAnnounceNumber(prompt, state);
    case 'ANNOUNCE_CARD': return uiAnnounceCard(prompt, state);
    case 'ROCK_PAPER_SCISSORS': return uiRps(prompt, state);
    default: return uiFallback(prompt, state);
  }
}
// ---- idle / battle commands (EDOPro-style: actions live on the card) ----
function uiCmd(prompt, state) {
  actionMap = new Map(); menuActions = [];
  const add = (list, label, type) => list.forEach((e, i) => {
    const key = e.con + ':' + e.loc + ':' + e.seq;
    if (!actionMap.has(key)) actionMap.set(key, []);
    actionMap.get(key).push({ label, bytes: E.cmdResp(type, i), code: e.code });
  });
  if (prompt.name === 'SELECT_IDLECMD') {
    add(prompt.summon, '通常召喚', 0);
    add(prompt.spsummon, '特殊召喚', 1);
    add(prompt.repos, '表示形式を変更', 2);
    add(prompt.mset, 'モンスターをセット', 3);
    add(prompt.sset, '魔法・罠をセット', 4);
    add(prompt.activate, '効果を発動', 5);
    if (prompt.toBP) phaseAction = { label: 'バトルフェイズへ', bytes: E.cmdResp(6, 0) };
    else if (prompt.toEP) phaseAction = { label: 'エンドフェイズへ', bytes: E.cmdResp(7, 0) };
    if (prompt.toEP && prompt.toBP) menuActions.push({ label: 'エンドフェイズへ', bytes: E.cmdResp(7, 0) });
    if (prompt.canShuffle) menuActions.push({ label: '手札をシャッフル', bytes: E.cmdResp(8, 0) });
  } else {
    add(prompt.activate, '効果を発動', 0);
    add(prompt.attack, '攻撃', 1);
    if (prompt.toM2) phaseAction = { label: 'メインフェイズ2へ', bytes: E.cmdResp(2, 0) };
    else if (prompt.toEP) phaseAction = { label: 'エンドフェイズへ', bytes: E.cmdResp(3, 0) };
    if (prompt.toM2 && prompt.toEP) menuActions.push({ label: 'エンドフェイズへ', bytes: E.cmdResp(3, 0) });
  }
  render(state);
}
function openActionSheet(key) {
  const acts = actionMap.get(key); if (!acts) return;
  const [con, loc, seq] = key.split(':').map(Number);
  const title = acts[0].code ? cardName(acts[0].code) : 'アクション';
  const txt = acts[0].code ? cardText(acts[0].code) : '';
  const meta = acts[0].code ? cardMetaLine(acts[0].code) : '';
  sheetOpen('<div class="ttl">' + title + '</div><div class="sub">' + locLabel({ con, loc, seq }) + (meta ? '／' + meta : '') + '</div>' +
    acts.map((a, i) => '<button class="optbtn" data-action-idx="' + i + '">' + a.label + '</button>').join('') +
    (txt ? '<div class="cardtext">' + txt + '</div>' : '') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-action-idx]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(acts[+b.dataset.actionIdx].bytes); }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
function openPileSheet(kind, con) {
  const state = duelState; if (!state) return;
  const P = state.players[con];
  const loc = { grave: E.LOC.GRAVE, removed: E.LOC.REMOVED, extra: E.LOC.EXTRA, deck: E.LOC.DECK, hand: E.LOC.HAND }[kind];
  // actions available from this pile
  const pileActs = [];
  actionMap.forEach((acts, key) => {
    const [c, l, s] = key.split(':').map(Number);
    if (c === con && l === loc) pileActs.push({ seq: s, acts });
  });
  let body = '';
  if (kind === 'grave' || kind === 'removed') {
    const list = kind === 'grave' ? P.grave : P.removed;
    body = list.length ? list.slice().reverse().map(c => '<div class="sortrow" data-info="' + (c != null ? c : '') + '">' + (c != null ? cardName(c) : '？') + '</div>').join('') : '<div class="sub">空です</div>';
  } else if (kind === 'extra') {
    body = con === HP ? (P.extra.length ? P.extra.map(c => '<div class="sortrow" data-info="' + c.code + '">' + cardName(c.code) + '</div>').join('') : '<div class="sub">空です</div>') : '<div class="sub">相手のEXデッキは見られません（残り ' + P.extra.length + ' 枚）</div>';
  } else if (kind === 'deck') {
    body = '<div class="sub">残り ' + P.deckCount + ' 枚' + (state.deckTop[con] ? '<br>一番上（公開中）：' + cardName(state.deckTop[con]) : '') + '</div>';
  } else if (kind === 'hand') {
    body = '<div class="sub">' + P.hand.length + ' 枚</div>';
  }
  if (pileActs.length) {
    body += '<div class="ttl" style="margin-top:8px">実行できるアクション</div>' + pileActs.map((pa, i) =>
      pa.acts.map((a, j) => '<button class="optbtn" data-pile-act="' + i + ':' + j + '">' + cardName(a.code) + '：' + a.label + '</button>').join('')).join('');
  }
  sheetOpen('<div class="ttl">' + ({ grave: '墓地', removed: '除外', extra: 'EXデッキ', deck: 'デッキ', hand: '手札' }[kind]) + '（' + (con === HP ? '自分' : '相手') + '）</div>' + body +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-pile-act]').forEach(b => b.addEventListener('click', () => {
    const [i, j] = b.dataset.pileAct.split(':').map(Number); playClick(); finishPrompt(pileActs[i].acts[j].bytes);
  }));
  $('sheet').querySelectorAll('[data-info]').forEach(el => el.addEventListener('click', () => {
    if (el.dataset.info) { playClick(); openCardInfo(+el.dataset.info); }
  }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
// read-only card detail (Japanese name + official text) — view only, never
// part of an answer; safe to open over pile views.
function openCardInfo(code) {
  const txt = cardText(code);
  const meta = cardMetaLine(code);
  const st = statsLine(code);
  sheetOpen('<div class="ttl">' + cardName(code) + '</div>' +
    '<div class="sub">' + [meta, st].filter(Boolean).join('／') + '</div>' +
    (txt ? '<div class="cardtext">' + txt + '</div>' : '<div class="sub">テキスト未収録</div>') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
// ---- chain dock (EDOPro-style; numbered links live in the mid bar) ----
function chainKey(e) { return e.code + '|' + e.con + '|' + e.loc + '|' + e.seq + '|' + e.desc; }
function updateAutoPassChip() {
  const el = $('autopass'); if (!el) return;
  if (Date.now() < autoPassFlashUntil) return; // flash text still showing
  if (dismissedDuel.size) { el.textContent = '自動パス設定中：' + dismissedDuel.size + ' 件（タップで管理）'; el.className = 'on'; }
  else { el.className = ''; el.textContent = ''; }
}
function flashAutoPass(names) {
  const el = $('autopass'); if (!el) return;
  el.textContent = '自動パス：' + names;
  el.className = 'on flash';
  autoPassFlashUntil = Date.now() + 2600;
  setTimeout(updateAutoPassChip, 2700);
}
function openDismissManager() {
  if (currentPrompt) return; // during a prompt the dock itself carries the controls
  const rows = [...dismissedDuel.entries()].map(([k, v]) =>
    '<div class="sortrow"><span>' + cardName(v.code) + '</span><span class="mv"><button data-undismiss="' + k + '">解除</button></span></div>').join('');
  sheetOpen('<div class="ttl">自動パスの設定（このデュエル）</div>' +
    '<div class="sub">ここにあるカードだけが残ったチェーン確認は、自動でパスされます。他に候補がある確認は通常どおり表示されます。</div>' +
    (rows || '<div class="sub">設定中のカードはありません</div>') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-undismiss]').forEach(b => b.addEventListener('click', () => {
    playClick(); dismissedDuel.delete(b.dataset.undismiss); updateAutoPassChip(); openDismissManager();
  }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
function uiChain(prompt, state) {
  if (!state.chain.length) dismissedChains = new Set();
  const hidden = (e) => dismissedChains.has(chainKey(e)) || dismissedDuel.has(chainKey(e));
  const visibleIdx = () => prompt.entries.map((e, i) => i).filter(i => prompt.forced || !hidden(prompt.entries[i]));
  // Duel-long dismissal (item 4): auto-answer pass ONLY when every remaining
  // candidate belongs to a dismissed card class. Prompts with any other
  // candidate, and all forced prompts, are shown normally. A visible flash
  // indicator tells the player the auto-pass happened.
  if (!prompt.forced && prompt.entries.length > 0 && prompt.entries.every(e => dismissedDuel.has(chainKey(e)))) {
    flashAutoPass([...new Set(prompt.entries.map(e => cardName(e.code)))].join('・'));
    const cp = currentPrompt;
    clearInteraction(); // board is inert during the short delay: no stale actions can fire
    if (duelState) render(duelState);
    setTimeout(() => { if (currentPrompt === cp && cp) { currentPrompt = null; cp.resolve(E.i32resp(-1)); } }, 450);
    return;
  }
  if (!prompt.forced && visibleIdx().length === 0) { // nothing chainable (or all chain-dismissed): auto-pass, no dock
    const cp = currentPrompt; currentPrompt = null; cp.resolve(E.i32resp(-1)); return;
  }
  const tag = confirmTag(state); // this prompt's sequence label (see timing note)
  let firstDraw = true;
  const draw = () => {
    const top = state.chain[state.chain.length - 1];
    $('dock').innerHTML =
      '<div class="ttl">チェーン応答</div>' +
      '<div class="ctx">' + timingText(state) + '｜' + (top ? 'チェーン' + state.chain.length + '：' + cardName(top.code) + ' への応答' : '効果への応答') + (prompt.forced ? '（発動必須）' : '') + tag + '</div>' +
      retryWarn(prompt) +
      '<div class="cands">' + prompt.entries.map((e, i) => {
        if (dismissedDuel.has(chainKey(e))) return ''; // duel-dismissed: hidden here, managed in the section below
        const disChain = dismissedChains.has(chainKey(e));
        return '<div class="cand' + (disChain ? ' dismissed' : '') + '" data-chain="' + i + '">' + cardName(e.code) +
          '<div class="loc">' + locLabel(e) + (disChain ? '（このチェーンでは聞かない）' : '') + '</div>' +
          (prompt.forced ? '' : '<span class="dismiss" data-dismiss="' + i + '" title="このチェーンでは聞かない／元に戻す">×</span>') +
          (prompt.forced || disChain ? '' : '<span class="dueldismiss" data-dueldismiss="' + i + '">このデュエル中は聞かない</span>') + '</div>';
      }).join('') + '</div>' +
      (() => {
        const dd = prompt.entries.filter(e => dismissedDuel.has(chainKey(e)));
        if (!dd.length) return '';
        return '<div class="duelsection">自動パス設定中：' + [...new Set(dd.map(e => cardName(e.code)))].join('・') +
          dd.map(e => '<button data-undismiss="' + chainKey(e) + '">' + cardName(e.code) + ' を解除</button>').join('') + '</div>';
      })() +
      '<div class="row">' + (prompt.forced ? '' : '<button class="bigbtn" id="chain-pass">パス</button>') + '</div>';
    $('dock').className = 'on'; // exact class is a contract (tests/tools match on it) — do not append state classes here
    if (firstDraw && $('dock').animate) { // a NEW prompt visibly arrives, even if its text matches the previous one
      try { $('dock').animate([{ transform: 'translateY(14px)', opacity: .25 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' }); } catch (e) {}
    }
    firstDraw = false;
    $('dock').querySelectorAll('[data-chain]').forEach(c => c.addEventListener('click', (ev) => {
      if (ev.target.dataset.dismiss != null || ev.target.dataset.dueldismiss != null) return;
      if (dismissedChains.has(chainKey(prompt.entries[+c.dataset.chain]))) return; // chain-dismissed: un-dismiss via × first
      playClick(); finishPrompt(E.i32resp(+c.dataset.chain));
    }));
    $('dock').querySelectorAll('[data-dismiss]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      const e = prompt.entries[+x.dataset.dismiss]; const k = chainKey(e);
      if (dismissedChains.has(k)) dismissedChains.delete(k); else dismissedChains.add(k);
      if (!prompt.forced && visibleIdx().length === 0) { finishPrompt(E.i32resp(-1)); return; }
      draw();
    }));
    $('dock').querySelectorAll('[data-dueldismiss]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      const e = prompt.entries[+x.dataset.dueldismiss];
      dismissedDuel.set(chainKey(e), { code: e.code });
      updateAutoPassChip();
      // if that was the last visible candidate class, the prompt now auto-passes
      if (!prompt.forced && prompt.entries.every(en => dismissedDuel.has(chainKey(en)))) {
        flashAutoPass([...new Set(prompt.entries.map(en => cardName(en.code)))].join('・'));
        const cp = currentPrompt;
        clearInteraction();
        if (duelState) render(duelState);
        setTimeout(() => { if (currentPrompt === cp && cp) { currentPrompt = null; cp.resolve(E.i32resp(-1)); } }, 450);
        return;
      }
      draw();
    }));
    $('dock').querySelectorAll('[data-undismiss]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      dismissedDuel.delete(x.dataset.undismiss); updateAutoPassChip(); draw();
    }));
    const pass = $('chain-pass');
    if (pass) pass.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(-1)); });
  };
  draw();
}
// ---- place / disfield: tap the actual zones ----
function availZones(prompt) {
  const avail = (~prompt.flag) >>> 0; const out = [];
  const add = (con, loc, seq) => out.push({ con, loc, seq });
  for (let s = 0; s < 7; s++) if (avail & (1 << s)) add(prompt.player, E.LOC.MZONE, s);
  for (let s = 0; s < 5; s++) if (avail & (0x100 << s)) add(prompt.player, E.LOC.SZONE, s);
  if (avail & 0x4000) add(prompt.player, E.LOC.SZONE, 6);
  if (avail & 0x8000) add(prompt.player, E.LOC.SZONE, 7);
  for (let s = 0; s < 7; s++) if (avail & (0x10000 << s)) add(1 - prompt.player, E.LOC.MZONE, s);
  for (let s = 0; s < 5; s++) if (avail & (0x1000000 << s)) add(1 - prompt.player, E.LOC.SZONE, s);
  if (avail & 0x40000000) add(1 - prompt.player, E.LOC.SZONE, 6);
  if (avail & 0x80000000) add(1 - prompt.player, E.LOC.SZONE, 7);
  return out;
}
function uiPlace(prompt, state) {
  const zones = availZones(prompt);
  placeCtx = { avail: new Set(zones.map(z => z.con + ':' + z.loc + ':' + z.seq)), chosen: new Map(), count: prompt.count };
  $('placehint').textContent = contextText(prompt) + (prompt.name === 'SELECT_PLACE' ? '置く場所をタップしてください' : '無効にするゾーンをタップしてください') +
    '（あと ' + prompt.count + '）' + (prompt.retryCount ? ' ※その選択はできませんでした' : '');
  $('placehint').className = 'on';
  render(state);
}

// ---- position ----
function uiPosition(prompt, state) {
  const defs = [
    { bit: E.POS.FU_ATK, label: '表側攻撃表示', cls: '' },
    { bit: E.POS.FU_DEF, label: '表側守備表示', cls: 'def' },
    { bit: E.POS.FD_ATK, label: '裏側攻撃表示', cls: 'back' },
    { bit: E.POS.FD_DEF, label: '裏側守備表示', cls: 'def back' },
  ].filter(d => prompt.mask & d.bit);
  sheetOpen('<div class="ttl">' + cardName(prompt.code) + ' の表示形式</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    '<div class="posrow">' + defs.map(d => '<div class="posbtn" data-pos="' + d.bit + '"><div class="glyph ' + d.cls + '"></div>' + d.label + '</div>').join('') + '</div>');
  $('sheet').querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.pos)); }));
}
// ---- generic card-grid selection sheet (tray conventions) ----
function gridSheet(o) {
  // o: {title, sub, cards:[{code,locLabel,extra,locked}], selected:Set(idx), valid:fn, confirmLabel, cancelable, onToggle}
  const draw = () => {
    const tray = [...o.selected].map(i => '<span class="chip" data-chip="' + i + '">' + cardName(o.cards[i].code) + ' ✕</span>').join('') +
      (o.locked || []).map(c => '<span class="chip locked">' + cardName(c.code) + '（固定）</span>').join('');
    sheetOpen('<div class="ttl">' + o.title + '</div><div class="sub">' + (typeof o.sub === 'function' ? o.sub() : o.sub) + '</div>' + contextLineHTML(o.prompt) + retryWarn(o.prompt) +
      (tray ? '<div id="tray">' + tray + '</div>' : '<div id="tray"></div>') +
      '<div class="grid">' + o.cards.map((c, i) =>
        '<div class="gcard' + (o.selected.has(i) ? ' sel' : '') + '" data-grid="' + i + '"><div class="loc">' + c.locLabel + '</div><div class="nm">' + cardName(c.code) + (c.extra ? ' ' + c.extra : '') + '</div>' +
        (o.showText && cardText(c.code) ? '<div class="itext">' + cardText(c.code) + '</div>' : '') + '</div>').join('') + '</div>' +
      '<div class="btnrow"><button class="bigbtn" id="grid-confirm" ' + (o.valid() ? '' : 'disabled') + '>' + (o.confirmLabel || '決定') + '</button>' +
      (o.cancelable ? '<button class="bigbtn sub" id="grid-cancel">キャンセル</button>' : '') + '</div>');
    $('sheet').querySelectorAll('[data-grid]').forEach(g => g.addEventListener('click', () => { playClick(); o.onToggle(+g.dataset.grid); draw(); }));
    $('sheet').querySelectorAll('[data-chip]').forEach(ch => ch.addEventListener('click', () => { playClick(); o.onToggle(+ch.dataset.chip); draw(); }));
    $('grid-confirm').addEventListener('click', () => { playClick(); o.onConfirm([...o.selected]); });
    const cancel = $('grid-cancel');
    if (cancel) cancel.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  };
  draw();
}
function uiSelectCards(prompt, state) {
  const isTrib = prompt.name === 'SELECT_TRIBUTE';
  const selected = new Set();
  const sum = () => [...selected].reduce((a, i) => a + (prompt.cards[i].releaseParam || 0), 0);
  gridSheet({
    prompt,
    title: isTrib ? 'リリースするカード' : 'カードの選択',
    sub: () => isTrib ? '合計 ' + prompt.min + ' 以上になるよう選んでください（現在 ' + sum() + '）'
                      : prompt.min + '〜' + prompt.max + ' 枚選んでください（現在 ' + selected.size + ' 枚）',
    cards: prompt.cards.map(c => ({ code: c.code, locLabel: locLabel(c), extra: isTrib ? '（リリース値 ' + c.releaseParam + '）' : '' })),
    selected,
    locked: [],
    showText: true,
    cancelable: prompt.cancelable,
    valid: () => isTrib ? (sum() >= prompt.min && selected.size <= prompt.max) : (selected.size >= prompt.min && selected.size <= prompt.max),
    onToggle: (i) => {
      if (selected.has(i)) selected.delete(i);
      else { if (!isTrib && selected.size >= prompt.max) return; selected.add(i); }
    },
    onConfirm: (idx) => finishPrompt(E.cardsResp(idx)),
  });
}
function uiUnselect(prompt, state) {
  const combined = prompt.select.map((c, i) => ({ c, idx: i, sel: false }))
    .concat(prompt.unselect.map((c, i) => ({ c, idx: prompt.select.length + i, sel: true })));
  sheetOpen('<div class="ttl">カードの選択</div><div class="sub">' + prompt.min + '〜' + prompt.max + ' 枚（現在 ' + prompt.unselect.length + ' 枚選択中）。タップで選択／解除します。</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    '<div class="grid">' + combined.map((x, k) =>
      '<div class="gcard' + (x.sel ? ' sel' : '') + '" data-unselect="' + x.idx + '"><div class="loc">' + locLabel(x.c) + '</div><div class="nm">' + cardName(x.c.code) + '</div>' +
      (cardText(x.c.code) ? '<div class="itext">' + cardText(x.c.code) + '</div>' : '') + '</div>').join('') + '</div>' +
    '<div class="btnrow">' +
    (prompt.finishable && prompt.unselect.length >= prompt.min ? '<button class="bigbtn" id="unselect-finish">決定</button>' : '') +
    (prompt.cancelable ? '<button class="bigbtn sub" id="unselect-cancel">キャンセル</button>' : '') + '</div>');
  $('sheet').querySelectorAll('[data-unselect]').forEach(g => g.addEventListener('click', () => { playClick(); finishPrompt(E.unselectToggleResp(+g.dataset.unselect)); }));
  const fin = $('unselect-finish'); if (fin) fin.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  const can = $('unselect-cancel'); if (can) can.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
}
function uiSelectSum(prompt, state) {
  const selected = new Set();
  const fmt = (c) => { const o1 = c.sumParam & 0xffff, o2 = c.sumParam >> 16; return o2 && o2 !== o1 ? '値 ' + o1 + '／' + o2 : '値 ' + o1; };
  gridSheet({
    prompt,
    title: 'カードの選択（合計値）',
    sub: prompt.mode === 'exact' ? '合計がちょうど ' + prompt.acc + ' になるよう選んでください' : '合計が ' + prompt.acc + ' 以上になるよう選んでください',
    cards: prompt.cards.map(c => ({ code: c.code, locLabel: locLabel(c), extra: fmt(c) })),
    selected,
    locked: prompt.must,
    showText: true,
    cancelable: false,
    valid: () => E.sumSelectionValid(prompt, [...selected]),
    onToggle: (i) => { selected.has(i) ? selected.delete(i) : selected.add(i); },
    onConfirm: (idx) => finishPrompt(E.cardsResp(idx)),
  });
}
// ---- counter ----
function uiCounter(prompt, state) {
  const amounts = prompt.cards.map(() => 0);
  const draw = () => {
    const total = amounts.reduce((a, b) => a + b, 0);
    sheetOpen('<div class="ttl">カウンターの取り除き</div><div class="sub">合計 ' + prompt.count + ' 個（現在 ' + total + ' 個）</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
      prompt.cards.map((c, i) => '<div class="counterrow"><span>' + cardName(c.code) + '（' + locLabel(c) + '／' + c.count + '個）</span>' +
        '<span class="ctl"><button data-dec="' + i + '">−</button><b>' + amounts[i] + '</b><button data-inc="' + i + '">＋</button></span></div>').join('') +
      '<div class="btnrow"><button class="bigbtn" id="counter-confirm" ' + (total === prompt.count ? '' : 'disabled') + '>決定</button></div>');
    $('sheet').querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.inc; if (amounts[i] < prompt.cards[i].count) amounts[i]++; playClick(); draw(); }));
    $('sheet').querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.dec; if (amounts[i] > 0) amounts[i]--; playClick(); draw(); }));
    $('counter-confirm').addEventListener('click', () => { playClick(); finishPrompt(E.counterResp(amounts)); });
  };
  draw();
}
// ---- sort ----
function uiSort(prompt, state) {
  let order = prompt.cards.map((_, i) => i); // order[pos] = original index
  const draw = () => {
    sheetOpen('<div class="ttl">' + (prompt.name === 'SORT_CHAIN' ? 'チェーンの順番' : 'カードの順番') + '</div><div class="sub">上から順に並べてください。</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
      order.map((ci, pos) => '<div class="sortrow"><span>' + (pos + 1) + '. ' + cardName(prompt.cards[ci].code) + '</span><span class="mv">' +
        '<button data-up="' + pos + '">↑</button><button data-down="' + pos + '">↓</button></span></div>').join('') +
      '<div class="btnrow"><button class="bigbtn" id="sort-ok">この順番で決定</button><button class="bigbtn sub" id="sort-keep">変更しない</button></div>');
    $('sheet').querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.up; if (p > 0) { [order[p-1], order[p]] = [order[p], order[p-1]]; } playClick(); draw(); }));
    $('sheet').querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.down; if (p < order.length - 1) { [order[p+1], order[p]] = [order[p], order[p+1]]; } playClick(); draw(); }));
    $('sort-ok').addEventListener('click', () => { playClick(); finishPrompt(E.sortResp(order)); });
    $('sort-keep').addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  };
  draw();
}
// ---- yes/no, option ----
function uiYesNo(prompt, state) {
  const isEff = prompt.name === 'SELECT_EFFECTYN';
  sheetOpen('<div class="ttl">' + (isEff ? cardName(prompt.code) + ' の効果' : '確認') + '</div>' +
    '<div class="ctx">' + timingText(state) + confirmTag(state) + '</div>' +
    '<div class="sub">' + (isEff ? locLabel(prompt) + ' の効果を発動しますか？' : '選択してください') + '</div>' + (isEff ? '' : contextLineHTML(prompt)) + retryWarn(prompt) +
    '<button class="optbtn" id="yn-yes">' + (isEff ? '発動する' : 'はい') + '</button>' +
    '<button class="optbtn" id="yn-no">' + (isEff ? '発動しない' : 'いいえ') + '</button>');
  $('yn-yes').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(1)); });
  $('yn-no').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(0)); });
}
function uiOption(prompt, state) {
  sheetOpen('<div class="ttl">効果の選択</div><div class="sub">適用する効果を選んでください。</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    prompt.options.map((o, i) => '<button class="optbtn" data-opt="' + i + '">選択肢 ' + (i + 1) + '</button>').join(''));
  $('sheet').querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.opt)); }));
}
// ---- announce ----
function uiAnnounceBits(prompt, state) {
  const isRace = prompt.name === 'ANNOUNCE_RACE';
  const table = isRace ? E.RACES : E.ATTRIBUTES;
  // race bits all fit in the low u32 for the current table (max 0x2000000)
  const bits = table.filter(([bit]) => isRace ? (prompt.availLo & bit) !== 0 : (prompt.avail & bit) !== 0);
  const selected = new Set();
  const draw = () => {
    sheetOpen('<div class="ttl">' + (isRace ? '種族' : '属性') + 'の宣言</div><div class="sub">' + prompt.count + ' つ選んでください（現在 ' + selected.size + '）</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
      '<div class="grid">' + bits.map(([bit, nm]) => '<div class="gcard' + (selected.has(bit) ? ' sel' : '') + '" data-bit="' + bit + '"><div class="nm">' + nm + '</div></div>').join('') + '</div>' +
      '<div class="btnrow"><button class="bigbtn" id="ann-confirm" ' + (selected.size === prompt.count ? '' : 'disabled') + '>決定</button></div>');
    $('sheet').querySelectorAll('[data-bit]').forEach(g => g.addEventListener('click', () => {
      const bit = +g.dataset.bit;
      if (selected.has(bit)) selected.delete(bit); else if (selected.size < prompt.count) selected.add(bit);
      playClick(); draw();
    }));
    $('ann-confirm').addEventListener('click', () => {
      playClick();
      let mask = 0; selected.forEach(bit => { mask |= bit; });
      if (isRace) finishPrompt(E.u64resp(mask >>> 0, 0));
      else finishPrompt(E.i32resp(mask));
    });
  };
  draw();
}
function uiAnnounceNumber(prompt, state) {
  sheetOpen('<div class="ttl">数値の宣言</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    prompt.options.map((o, i) => '<button class="optbtn" data-num="' + i + '">' + o + '</button>').join(''));
  $('sheet').querySelectorAll('[data-num]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.num)); }));
}
function uiAnnounceCard(prompt, state) {
  // Offer only cards the core will accept: the prompt's opcode filter is the
  // core's own declarable rule (is_declarable in playerop.cpp), ported to
  // engine.js. If the filter somehow empties the pool, fall back to all cards
  // rather than dead-ending the prompt.
  let pool = Object.keys(DATA.cards).map(Number);
  if (prompt.opcodes && prompt.opcodes.length) {
    const filtered = pool.filter(code => E.isDeclarable({ code, ...DATA.cards[code] }, prompt.opcodes));
    if (filtered.length) pool = filtered;
  }
  pool.sort((a, b) => cardName(a).localeCompare(cardName(b), 'ja'));
  sheetOpen('<div class="ttl">カードの宣言</div>' + contextLineHTML(prompt) +
    '<div class="sub">宣言するカードを選んでください。</div>' + retryWarn(prompt) +
    '<div class="grid">' + pool.map(code => '<div class="gcard" data-code="' + code + '"><div class="nm">' + cardName(code) + '</div></div>').join('') + '</div>');
  $('sheet').querySelectorAll('[data-code]').forEach(g => g.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+g.dataset.code)); }));
}
function uiRps(prompt, state) {
  sheetOpen('<div class="ttl">じゃんけん</div>' + retryWarn(prompt) +
    '<div class="posrow">' +
    '<div class="posbtn" data-rps="1">✌<br>チョキ</div>' +
    '<div class="posbtn" data-rps="2">✋<br>パー</div>' +
    '<div class="posbtn" data-rps="3">✊<br>グー</div></div>');
  $('sheet').querySelectorAll('[data-rps]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.rps)); }));
}
function uiFallback(prompt, state) {
  sheetOpen('<div class="ttl">確認（' + prompt.name + '）</div><div class="sub">この確認には専用UIがまだありません。自動応答で進行します。</div>' +
    '<div class="btnrow"><button class="bigbtn" id="fb-auto">自動応答</button></div>');
  $('fb-auto').addEventListener('click', () => { playClick(); finishPrompt(E.botAnswer(prompt, state, DATA, E.makeBotMemory())); });
}
// ---------------------------------------------------------------- global taps
$('autopass').addEventListener('click', () => { playClick(); openDismissManager(); });
document.addEventListener('click', (ev) => {
  const zoneEl = ev.target.closest('[data-zone]');
  if (zoneEl && placeCtx) {
    const key = zoneEl.dataset.zone;
    if (placeCtx.avail.has(key) && !placeCtx.chosen.has(key)) {
      playClick();
      const [con, loc, seq] = key.split(':').map(Number);
      placeCtx.chosen.set(key, { con, loc, seq });
      if (placeCtx.chosen.size >= placeCtx.count) {
        finishPrompt(E.placeResp([...placeCtx.chosen.values()]));
        return;
      }
      $('placehint').textContent = $('placehint').textContent.replace(/あと \d+/, 'あと ' + (placeCtx.count - placeCtx.chosen.size));
      if (duelState) render(duelState);
    }
    return;
  }
  const actEl = ev.target.closest('[data-act]');
  if (actEl && currentPrompt && (currentPrompt.prompt.name === 'SELECT_IDLECMD' || currentPrompt.prompt.name === 'SELECT_BATTLECMD')) {
    const key = actEl.dataset.act;
    if (actionMap.has(key)) { playClick(); openActionSheet(key); }
    return;
  }
  const pileEl = ev.target.closest('[data-pile]');
  if (pileEl) {
    const [kind, con] = pileEl.dataset.pile.split(':');
    playClick(); openPileSheet(kind, +con);
  }
});
$('phasebtn').addEventListener('click', () => { if (phaseAction) { playClick(); finishPrompt(phaseAction.bytes); } });
$('menubtn').addEventListener('click', () => {
  if (!menuActions.length) return;
  sheetOpen('<div class="ttl">その他のアクション</div>' +
    menuActions.map((a, i) => '<button class="optbtn" data-menu="' + i + '">' + a.label + '</button>').join('') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(menuActions[+b.dataset.menu].bytes); }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
});
// ---------------------------------------------------------------- boot
function wireSeg(id, apply) {
  const el = $(id);
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    playClick();
    el.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    apply(b.dataset.v);
  }));
}
(async () => {
  try {
    DATA = await (await fetch('data.json')).json();
    $('loadmsg').textContent = '準備完了（カード ' + Object.keys(DATA.cards).length + ' 種）';
  } catch (e) {
    $('loadmsg').textContent = 'data.json の読み込みに失敗しました';
    return;
  }
  wireSeg('seg-mydeck', (v) => { myDeckKey = v; });
  wireSeg('seg-opdeck', (v) => { opDeckKey = v; });
  wireSeg('seg-first', (v) => { firstChoice = v; });
  $('soundbtn').addEventListener('click', () => {
    audioOn = !audioOn;
    $('soundbtn').textContent = audioOn ? '音：ON' : '音：OFF';
    if (!audioOn && bgmEl) { try { bgmEl.pause(); } catch (e) {} }
    if (audioOn) { playClick(); setBgmScene(bgmScene || 'start', true); }
  });
  $('startbtn').addEventListener('click', async () => {
    playClick();
    playSe('vs_start');
    // Seat wiring (item 5): the core's first player is always seat 0, so a
    // second-player human takes seat 1 with the decks swapped.
    const humanFirst = firstChoice === 'first' ? true : firstChoice === 'second' ? false : Math.random() < 0.5;
    HP = humanFirst ? 0 : 1;
    const deckP0 = DATA.decks[humanFirst ? myDeckKey : opDeckKey];
    const deckP1 = DATA.decks[humanFirst ? opDeckKey : myDeckKey];
    dismissedChains = new Set();
    dismissedDuel = new Map();
    confirmTurn = -1; confirmSeq = 0; // per-turn confirmation counter restarts with the duel
    updateAutoPassChip();
    setBgmScene('neutral', true);
    $('start').style.display = 'none';
    $('logline').textContent = 'エンジン起動中…';
    const M = await OcgCoreModule();
    duel = new E.Duel(M, DATA, {
      seed: (Date.now() % 100000) + 1,
      pace: { bot: 620, botChain: 300, batch: 40 },
      deckP0, deckP1, humanTeam: HP,
      onLog: () => {},
      onUpdate: (state) => {
        if (duel) { try { duel.refreshFieldStats(); } catch (e) {} }
        drainSeEvents(state);
        render(state);
        updateBgm(state);
      },
      humanAnswerer: async (prompt, state) => { render(state); return uiAnswer(prompt, state); },
    });
    const stats = await duel.run();
    const st = duel.state;
    render(st);
    setBgmScene(st.winner === HP ? 'bigadv' : 'bigdis', true);
    $('resultTitle').textContent = st.winner === HP ? '勝利！' : '敗北';
    $('resultDetail').textContent = 'ターン ' + stats.turns + '／決着理由：' + (st.winReason === 1 ? 'LP' : st.winReason === 2 ? 'デッキ切れ' : 'その他') +
      '／最終LP 自分 ' + st.players[HP].lp + ' ― 相手 ' + st.players[1 - HP].lp;
    $('result').style.display = 'flex';
  });
  $('againbtn').addEventListener('click', () => location.reload());
  // start-screen BGM begins on first tap anywhere (autoplay policy)
  document.addEventListener('pointerdown', function once() {
    setBgmScene('start', true);
    document.removeEventListener('pointerdown', once);
  });
})();
