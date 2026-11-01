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
let currentPrompt = null;   // {prompt, resolve} while a human prompt is open
let actionMap = new Map();  // "con:loc:seq" -> [{label, bytes}] for idle/battle prompts
let phaseAction = null;     // {label, bytes} for the phase button
let menuActions = [];       // extra idle actions (hand shuffle)
let placeCtx = null;        // active SELECT_PLACE/DISFIELD interaction
let dismissedChains = new Set(); // chain-candidate dismissals (this chain only)
let audio = { bgm: null, click: null };

function cardName(code) { return (DATA && DATA.names[code]) || ('#' + code); }
function cardData(code) { return (DATA && DATA.cards[code]) || null; }
function locLabel(e) {
  const who = e.con === 0 ? '自分' : '相手';
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
function playClick() {
  try {
    if (!audio.click) { audio.click = new Audio('../assets/se/ui_click.mp3'); audio.click.volume = 0.5; }
    audio.click.currentTime = 0; audio.click.play().catch(() => {});
  } catch (e) {}
}
function startBgm(src) {
  try {
    if (!audio.bgm) audio.bgm = new Audio();
    audio.bgm.src = src; audio.bgm.loop = true; audio.bgm.volume = 0.55;
    audio.bgm.play().catch(() => {});
  } catch (e) {}
}

// ---------------------------------------------------------------- rendering
function tileHTML(card, con, actKey) {
  if (!card) return '';
  const faceUp = (card.pos & E.POS_FACEUP) !== 0;
  const isDef = (card.pos & E.POS_DEFENSE) !== 0;
  const showFace = faceUp || con === 0;
  const nm = showFace && card.code != null ? cardName(card.code) : '';
  const st = showFace && card.code != null ? statsLine(card.code) : '';
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
  const [me, op] = state.players;
  $('oppLp').textContent = op.lp;
  $('myLp').textContent = me.lp;
  $('opppiles').innerHTML = '手札 ' + op.hand.length + '<br>デッキ ' + op.deckCount;
  $('turninfo').textContent = 'ターン' + Math.max(1, state.turnCount) + '／' + (state.turnPlayer === 0 ? '自分' : '相手');
  $('phaseinfo').textContent = state.phaseName ? ('フェイズ：' + phaseJa(state.phaseName) + (state.turnPlayer === 0 ? '（自分のターン）' : '（相手のターン）')) : '—';
  zoneRow($('oppSzone'), [0,1,2,3,4,5].map(i => op.szone[i]), 1, E.LOC.SZONE, true);
  zoneRow($('oppMzone'), op.mzone, 1, E.LOC.MZONE, false);
  zoneRow($('myMzone'), state.players[0].mzone, 0, E.LOC.MZONE, false);
  zoneRow($('mySzone'), [0,1,2,3,4,5].map(i => state.players[0].szone[i]), 0, E.LOC.SZONE, true);
  $('oppPilebar').innerHTML = pileHTML(null, 1);
  $('myPilebar').innerHTML = pileHTML(null, 0);
  // hand
  $('handcount').textContent = me.hand.length;
  $('hand').innerHTML = me.hand.map((c, i) => {
    const key = '0:' + E.LOC.HAND + ':' + i;
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
  sheetOpen('<div class="ttl">' + title + '</div><div class="sub">' + locLabel({ con, loc, seq }) + '</div>' +
    acts.map((a, i) => '<button class="optbtn" data-action-idx="' + i + '">' + a.label + '</button>').join('') +
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
    body = list.length ? list.slice().reverse().map(c => '<div class="sortrow">' + (c != null ? cardName(c) : '？') + '</div>').join('') : '<div class="sub">空です</div>';
  } else if (kind === 'extra') {
    body = con === 0 ? (P.extra.length ? P.extra.map(c => '<div class="sortrow">' + cardName(c.code) + '</div>').join('') : '<div class="sub">空です</div>') : '<div class="sub">相手のEXデッキは見られません（残り ' + P.extra.length + ' 枚）</div>';
  } else if (kind === 'deck') {
    body = '<div class="sub">残り ' + P.deckCount + ' 枚' + (state.deckTop[con] ? '<br>一番上（公開中）：' + cardName(state.deckTop[con]) : '') + '</div>';
  } else if (kind === 'hand') {
    body = '<div class="sub">' + P.hand.length + ' 枚</div>';
  }
  if (pileActs.length) {
    body += '<div class="ttl" style="margin-top:8px">実行できるアクション</div>' + pileActs.map((pa, i) =>
      pa.acts.map((a, j) => '<button class="optbtn" data-pile-act="' + i + ':' + j + '">' + cardName(a.code) + '：' + a.label + '</button>').join('')).join('');
  }
  sheetOpen('<div class="ttl">' + ({ grave: '墓地', removed: '除外', extra: 'EXデッキ', deck: 'デッキ', hand: '手札' }[kind]) + '（' + (con === 0 ? '自分' : '相手') + '）</div>' + body +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-pile-act]').forEach(b => b.addEventListener('click', () => {
    const [i, j] = b.dataset.pileAct.split(':').map(Number); playClick(); finishPrompt(pileActs[i].acts[j].bytes);
  }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
// ---- chain dock (EDOPro-style; numbered links live in the mid bar) ----
function chainKey(e) { return e.code + '|' + e.con + '|' + e.loc + '|' + e.seq + '|' + e.desc; }
function uiChain(prompt, state) {
  if (!state.chain.length) dismissedChains = new Set();
  const visibleIdx = () => prompt.entries.map((e, i) => i).filter(i => prompt.forced || !dismissedChains.has(chainKey(prompt.entries[i])));
  if (!prompt.forced && visibleIdx().length === 0) { // nothing chainable (or all dismissed): auto-pass, no dock
    const cp = currentPrompt; currentPrompt = null; cp.resolve(E.i32resp(-1)); return;
  }
  const draw = () => {
    const top = state.chain[state.chain.length - 1];
    const vis = visibleIdx();
    $('dock').innerHTML =
      '<div class="ttl">チェーン応答</div>' +
      '<div class="ctx">' + (top ? 'チェーン' + state.chain.length + '：' + cardName(top.code) + ' への応答' : '効果への応答') + (prompt.forced ? '（発動必須）' : '') + '</div>' +
      retryWarn(prompt) +
      '<div class="cands">' + prompt.entries.map((e, i) => {
        const dis = dismissedChains.has(chainKey(e));
        return '<div class="cand' + (dis ? ' dismissed' : '') + '" data-chain="' + i + '">' + cardName(e.code) +
          '<div class="loc">' + locLabel(e) + (dis ? '（このチェーンでは聞かない）' : '') + '</div>' +
          (prompt.forced ? '' : '<span class="dismiss" data-dismiss="' + i + '" title="このチェーンでは聞かない／元に戻す">×</span>') + '</div>';
      }).join('') + '</div>' +
      '<div class="row">' + (prompt.forced ? '' : '<button class="bigbtn" id="chain-pass">パス</button>') + '</div>';
    $('dock').className = 'on';
    $('dock').querySelectorAll('[data-chain]').forEach(c => c.addEventListener('click', (ev) => {
      if (ev.target.dataset.dismiss != null) return;
      if (dismissedChains.has(chainKey(prompt.entries[+c.dataset.chain]))) return; // dismissed: un-dismiss via × first
      playClick(); finishPrompt(E.i32resp(+c.dataset.chain));
    }));
    $('dock').querySelectorAll('[data-dismiss]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      const e = prompt.entries[+x.dataset.dismiss]; const k = chainKey(e);
      if (dismissedChains.has(k)) dismissedChains.delete(k); else dismissedChains.add(k);
      if (!prompt.forced && visibleIdx().length === 0) { finishPrompt(E.i32resp(-1)); return; }
      draw();
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
  $('placehint').textContent = (prompt.name === 'SELECT_PLACE' ? '置く場所をタップしてください' : '無効にするゾーンをタップしてください') +
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
  sheetOpen('<div class="ttl">' + cardName(prompt.code) + ' の表示形式</div>' + retryWarn(prompt) +
    '<div class="posrow">' + defs.map(d => '<div class="posbtn" data-pos="' + d.bit + '"><div class="glyph ' + d.cls + '"></div>' + d.label + '</div>').join('') + '</div>');
  $('sheet').querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.pos)); }));
}
// ---- generic card-grid selection sheet (tray conventions) ----
function gridSheet(o) {
  // o: {title, sub, cards:[{code,locLabel,extra,locked}], selected:Set(idx), valid:fn, confirmLabel, cancelable, onToggle}
  const draw = () => {
    const tray = [...o.selected].map(i => '<span class="chip" data-chip="' + i + '">' + cardName(o.cards[i].code) + ' ✕</span>').join('') +
      (o.locked || []).map(c => '<span class="chip locked">' + cardName(c.code) + '（固定）</span>').join('');
    sheetOpen('<div class="ttl">' + o.title + '</div><div class="sub">' + (typeof o.sub === 'function' ? o.sub() : o.sub) + '</div>' + retryWarn(o.prompt) +
      (tray ? '<div id="tray">' + tray + '</div>' : '<div id="tray"></div>') +
      '<div class="grid">' + o.cards.map((c, i) =>
        '<div class="gcard' + (o.selected.has(i) ? ' sel' : '') + '" data-grid="' + i + '"><div class="loc">' + c.locLabel + '</div><div class="nm">' + cardName(c.code) + (c.extra ? ' ' + c.extra : '') + '</div></div>').join('') + '</div>' +
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
  sheetOpen('<div class="ttl">カードの選択</div><div class="sub">' + prompt.min + '〜' + prompt.max + ' 枚（現在 ' + prompt.unselect.length + ' 枚選択中）。タップで選択／解除します。</div>' + retryWarn(prompt) +
    '<div class="grid">' + combined.map((x, k) =>
      '<div class="gcard' + (x.sel ? ' sel' : '') + '" data-unselect="' + x.idx + '"><div class="loc">' + locLabel(x.c) + '</div><div class="nm">' + cardName(x.c.code) + '</div></div>').join('') + '</div>' +
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
    sheetOpen('<div class="ttl">カウンターの取り除き</div><div class="sub">合計 ' + prompt.count + ' 個（現在 ' + total + ' 個）</div>' + retryWarn(prompt) +
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
    sheetOpen('<div class="ttl">' + (prompt.name === 'SORT_CHAIN' ? 'チェーンの順番' : 'カードの順番') + '</div><div class="sub">上から順に並べてください。</div>' + retryWarn(prompt) +
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
    '<div class="sub">' + (isEff ? locLabel(prompt) + ' の効果を発動しますか？' : '選択してください') + '</div>' + retryWarn(prompt) +
    '<button class="optbtn" id="yn-yes">' + (isEff ? '発動する' : 'はい') + '</button>' +
    '<button class="optbtn" id="yn-no">' + (isEff ? '発動しない' : 'いいえ') + '</button>');
  $('yn-yes').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(1)); });
  $('yn-no').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(0)); });
}
function uiOption(prompt, state) {
  sheetOpen('<div class="ttl">効果の選択</div><div class="sub">適用する効果を選んでください。</div>' + retryWarn(prompt) +
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
    sheetOpen('<div class="ttl">' + (isRace ? '種族' : '属性') + 'の宣言</div><div class="sub">' + prompt.count + ' つ選んでください（現在 ' + selected.size + '）</div>' + retryWarn(prompt) +
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
  sheetOpen('<div class="ttl">数値の宣言</div>' + retryWarn(prompt) +
    prompt.options.map((o, i) => '<button class="optbtn" data-num="' + i + '">' + o + '</button>').join(''));
  $('sheet').querySelectorAll('[data-num]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.num)); }));
}
function uiAnnounceCard(prompt, state) {
  const pool = Object.keys(DATA.cards).map(Number).sort((a, b) => cardName(a).localeCompare(cardName(b)));
  sheetOpen('<div class="ttl">カードの宣言</div><div class="sub">宣言するカードを選んでください（条件に合わない場合は選び直しになります）。</div>' + retryWarn(prompt) +
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
(async () => {
  try {
    DATA = await (await fetch('data.json')).json();
    $('loadmsg').textContent = '準備完了（カード ' + Object.keys(DATA.cards).length + ' 種）';
  } catch (e) {
    $('loadmsg').textContent = 'data.json の読み込みに失敗しました';
    return;
  }
  $('startbtn').addEventListener('click', async () => {
    playClick();
    startBgm('../assets/bgm/ishizu-start.mp3');
    $('start').style.display = 'none';
    $('logline').textContent = 'エンジン起動中…';
    const M = await OcgCoreModule();
    duel = new E.Duel(M, DATA, {
      seed: (Date.now() % 100000) + 1,
      pace: { bot: 620, botChain: 300, batch: 40 },
      onLog: () => {},
      onUpdate: (state) => render(state),
      humanAnswerer: async (prompt, state) => { render(state); return uiAnswer(prompt, state); },
    });
    const stats = await duel.run();
    const st = duel.state;
    render(st);
    $('resultTitle').textContent = st.winner === 0 ? '勝利！' : '敗北';
    $('resultDetail').textContent = 'ターン ' + stats.turns + '／決着理由：' + (st.winReason === 1 ? 'LP' : st.winReason === 2 ? 'デッキ切れ' : 'その他') +
      '／最終LP 自分 ' + st.players[0].lp + ' ― 相手 ' + st.players[1].lp;
    $('result').style.display = 'flex';
  });
  $('againbtn').addEventListener('click', () => location.reload());
  // start-screen BGM begins on first tap anywhere (autoplay policy)
  document.addEventListener('pointerdown', function once() {
    startBgm('../assets/bgm/ishizu-upload.mp3');
    document.removeEventListener('pointerdown', once);
  });
})();
