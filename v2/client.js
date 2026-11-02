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
// BGM (user decision 2026-11-03 — replaces the old advantage-score
// scenes): the start screen plays the user's upload track, looped, and
// the duel itself uses the MD-style 3-stage ladder Normal -> Keycard ->
// Climax. Stages only ever go UP. Each stage owns a 2-track pool; the
// track is picked at random, stage tracks do NOT loop — when one ends,
// the next pick from the same stage excludes the track that just
// finished. Triggers: Keycard = either player summons a key card
// (KEYCARD_CODES below) or activates a key trap (KEYCARD_ACTIVATE_CODES
// below — traps fire on activation, not summon); Climax = either
// player's LP reaches 2000 or below. Result: a win plays the pyramid
// track, a loss draws from the Climax pool.
const BGM_START_FILE = 'ishizu-upload.mp3';
const BGM_STAGES = {
  normal: ['ishizu-start.mp3', 'ishizu-caravan.mp3'],
  keycard: ['ishizu-advantage.mp3', 'ishizu-big-advantage.mp3'],
  climax: ['ishizu-voice-note-2.mp3', 'ishizu-mystical.mp3'],
};
const BGM_STAGE_RANK = { normal: 0, keycard: 1, climax: 2 };
const BGM_STAGE_NAME = ['normal', 'keycard', 'climax'];
const BGM_WIN_FILE = 'ishizu-big-advantage.mp3';
// Boss-class cards of both decks, five per side (codes/names from
// data.json; the rationale and the borderline candidates are recorded
// in NOTES.md, section "BGM 3-stage"). Summon triggers: the four
// combined Gate Guardians + Dark Guardian (GG deck), Yami no Luce +
// Tenrin no Sphinx + Metaphys Horus Dragon (Ishizu deck).
// Masterflare Hyperion was in the first list and was REMOVED by the
// user's decision (2026-11-03) — it is deliberately not here.
const KEYCARD_CODES = new Set([8505920, 97783338, 34904525, 61398234, 26746975, 45409943, 46148485, 36898537]);
// Key TRAPS (Ishizu deck): a trap has no summon, so these latch on
// ACTIVATION instead — 98715423 Gravekeeper's Trap (a permanent trap,
// it stays face-up once flipped) and 17484499 Exchange of the Spirit
// (the deck's signature reversal). User decision 2026-11-03.
const KEYCARD_ACTIVATE_CODES = new Set([98715423, 17484499]);
let bgmEl = null, bgmScene = null, bgmFile = null;
let bgmWantedRank = -1;            // highest stage this duel's triggers have demanded (latched)
const bgmSeenKeys = new Set();     // key-card codes already seen on a field this duel
function bgmPick(pool, exclude) {
  if (pool.length <= 1) return pool[0];
  let f = exclude;
  while (f === exclude) f = pool[Math.floor(Math.random() * pool.length)];
  return f;
}
function playBgmFile(file, loop) {
  try {
    if (!bgmEl) {
      bgmEl = new Audio(); bgmEl.volume = 0.55;
      bgmEl.addEventListener('ended', () => {
        // Stage tracks do not loop: draw the next track of the SAME
        // stage, excluding the one that just ended. Looping scenes
        // ('start' / 'win') never reach this handler.
        if (!audioOn || !bgmScene || !BGM_STAGES[bgmScene]) return;
        playBgmFile(bgmPick(BGM_STAGES[bgmScene], bgmFile), false);
      });
    }
    bgmEl.loop = !!loop;
    bgmEl.src = '../assets/bgm/' + file;
    bgmEl.play().catch(() => {});
    bgmFile = file;
  } catch (e) {}
}
// scene: 'start' | 'normal' | 'keycard' | 'climax' | 'win' | 'lose'
function setBgmScene(scene, force) {
  if (!audioOn) return;
  if (scene === bgmScene && !force) return;
  if (scene === bgmScene && force && bgmFile) { playBgmFile(bgmFile, scene === 'start' || scene === 'win'); return; }
  if (scene === 'start') { bgmScene = 'start'; playBgmFile(BGM_START_FILE, true); return; }
  if (scene === 'win') { bgmScene = 'win'; playBgmFile(BGM_WIN_FILE, true); return; }
  if (scene === 'lose') { bgmScene = 'climax'; playBgmFile(bgmPick(BGM_STAGES.climax, null), false); return; }
  if (BGM_STAGES[scene]) { bgmScene = scene; playBgmFile(bgmPick(BGM_STAGES[scene], null), false); }
}
function noteBgmEvent(ev) {
  // Summon events carry the card code (engine.js MSG_SUMMONING /
  // MSG_SPSUMMONING presentation events), so a key card is latched the
  // moment it is summoned — even if it leaves the field again before
  // the next render. Either player's summon counts.
  if ((ev.kind === 'summon' || ev.kind === 'spsummon') && ev.code != null && KEYCARD_CODES.has(ev.code))
    bgmWantedRank = Math.max(bgmWantedRank, BGM_STAGE_RANK.keycard);
  // Activation events (engine.js MSG_CHAINING presentation event) also
  // carry the card code, so a key TRAP is latched the moment it is
  // activated — flipping a set trap face-up is its activation, and a
  // permanent trap's later effect activations chain with the same code.
  // Either player's activation counts.
  if (ev.kind === 'activate' && ev.code != null && KEYCARD_ACTIVATE_CODES.has(ev.code))
    bgmWantedRank = Math.max(bgmWantedRank, BGM_STAGE_RANK.keycard);
}
function updateBgm(state) {
  if (!state || state.winner != null || !bgmScene || bgmScene === 'start' || bgmScene === 'win') return;
  // Trigger detection runs (and latches) even while a prompt is open,
  // so a stage-up is deferred, never lost. The field scan complements
  // noteBgmEvent: a key card still on a field counts however it got
  // there (control change, revival with a missed event, ...).
  if (state.players[0].lp <= 2000 || state.players[1].lp <= 2000)
    bgmWantedRank = Math.max(bgmWantedRank, BGM_STAGE_RANK.climax);
  for (const P of state.players) for (const c of P.mzone) {
    if (c && c.code != null && KEYCARD_CODES.has(c.code) && !bgmSeenKeys.has(c.code)) {
      bgmSeenKeys.add(c.code);
      bgmWantedRank = Math.max(bgmWantedRank, BGM_STAGE_RANK.keycard);
    }
  }
  // Same complement for the key traps: one that is FACE-UP in a spell/
  // trap zone has been activated, however the event stream went (the
  // permanent Gravekeeper's Trap stays face-up after its flip). A trap
  // that is merely set (face-down) has NOT been activated and must not
  // latch — hence the face-up requirement.
  for (const P of state.players) for (const c of P.szone) {
    if (c && c.code != null && KEYCARD_ACTIVATE_CODES.has(c.code) && (c.pos & E.POS_FACEUP) !== 0 && !bgmSeenKeys.has(c.code)) {
      bgmSeenKeys.add(c.code);
      bgmWantedRank = Math.max(bgmWantedRank, BGM_STAGE_RANK.keycard);
    }
  }
  if (currentPrompt) return; // never switch under the player's fingers
  // Stage-ups bypass the old 8-second dwell: stages never go back down,
  // so there is nothing left to flap, and the cue belongs to the moment
  // itself (MD cuts the music when the key card lands) — holding it
  // back up to 8 s would detach it from the play it marks.
  const cur = BGM_STAGE_RANK[bgmScene];
  if (cur == null || bgmWantedRank <= cur) return;
  setBgmScene(BGM_STAGE_NAME[bgmWantedRank]);
}
// Test surface (same spirit as window.__layout): lets the jsdom harness
// observe BGM state and drive updateBgm / setBgmScene with synthetic
// states — the same functions the duel flow itself calls.
window.__bgm = {
  get scene() { return bgmScene; },
  get file() { return bgmFile; },
  get wantedRank() { return bgmWantedRank; },
  update(state) { updateBgm(state); },
  note(ev) { noteBgmEvent(ev); },
  sceneTo(scene) { setBgmScene(scene, true); },
};
// Drain the engine's presentation event queue into SE cues.
const ATTR_SE = { 1: 'atk_earth', 2: 'atk_water', 4: 'atk_fire', 8: 'atk_wind', 16: 'atk_light', 32: 'atk_dark', 64: 'atk_light' };
function drainSeEvents(state) {
  if (!state.events || !state.events.length) return;
  const evs = state.events.splice(0, state.events.length);
  for (const ev of evs) {
    noteBgmEvent(ev); // BGM key-card latch (see the BGM block above)
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
  return '<div class="tile' + (isDef ? ' def' : '') + (showFace ? '' : ' back') + (actKey && actionMap.has(actKey) ? ' actionable' : '') + '"' +
    (actKey ? ' data-act="' + actKey + '"' : '') + '>' +
    (card.materials ? '<div class="mats">×' + card.materials + '</div>' : '') +
    '<div class="inner">' +
    (nm ? '<div class="nm">' + nm + '</div>' : '') +
    '</div></div>';
}
// ATK/DEF strip rendered at the SLOT level — outside the card frame, with
// ATK/DEF labels (user spec). Live (effect-modified) values from the core
// query when available, printed values otherwise. Same visibility rule as
// the tile face: face-up cards, plus the owner's own face-down cards.
function slotStatsHTML(card, con) {
  if (!card || card.code == null) return '';
  const faceUp = (card.pos & E.POS_FACEUP) !== 0;
  if (!faceUp && con !== HP) return '';
  if (!isMonster(card.code)) return '';
  const d = cardData(card.code);
  const atk = card.curAtk != null ? card.curAtk : d.atk;
  const def = card.curDef != null ? card.curDef : d.def;
  return '<div class="slotstats"><span>ATK <b>' + atk + '</b></span><span>DEF <b>' + def + '</b></span></div>';
}
function zoneRow(el, cards, con, loc) {
  el.innerHTML = cards.map((card, seq) => {
    const key = con + ':' + loc + ':' + seq;
    const hl = placeCtx && placeCtx.avail.has(key) ? ' hl' : '';
    const pk = placeCtx && placeCtx.chosen.has(key) ? ' picked' : '';
    const st = card ? slotStatsHTML(card, con) : '';
    return '<div class="slot' + (st ? ' hs' : '') + hl + pk + '" data-zone="' + key + '">' +
      '<span class="znum">' + (loc === E.LOC.SZONE && seq === 5 ? 'F' : (seq + 1)) + '</span>' +
      (card ? tileHTML(card, con, key) + st : '') +
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
  zoneRow($('oppSzone'), [0,1,2,3,4,5].map(i => op.szone[i]), 1 - HP, E.LOC.SZONE);
  // Genesis format: no Extra Monster Zones — render main monster zones 0-4
  // only. The state mirror keeps 7 slots (the core's RELOAD_FIELD always
  // serializes 7), but seq 5/6 can never be offered or occupied now.
  zoneRow($('oppMzone'), op.mzone.slice(0, 5), 1 - HP, E.LOC.MZONE);
  zoneRow($('myMzone'), me.mzone.slice(0, 5), HP, E.LOC.MZONE);
  zoneRow($('mySzone'), [0,1,2,3,4,5].map(i => me.szone[i]), HP, E.LOC.SZONE);
  $('oppPilebar').innerHTML = pileHTML(null, 1 - HP);
  $('myPilebar').innerHTML = pileHTML(null, HP);
  // hand
  $('handcount').textContent = me.hand.length;
  $('hand').innerHTML = me.hand.map((c, i) => {
    const key = HP + ':' + E.LOC.HAND + ':' + i;
    const act = actionMap.has(key) ? ' actionable' : '';
    const st = c.code != null && isMonster(c.code)
      ? '<div class="hstats"><span>ATK <b>' + cardData(c.code).atk + '</b></span><span>DEF <b>' + cardData(c.code).def + '</b></span></div>'
      : '<div class="hstats"></div>';
    return '<div class="hcard' + act + '" data-act="' + key + '"' + (c.code != null ? ' data-code="' + c.code + '"' : '') + '>' +
      '<div class="himg"><div class="nm">' + (c.code != null ? cardName(c.code) : '？') + '</div></div>' + st + '</div>';
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
  updatePreviewFromState(state);
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
  if (acts[0].code) setPreview(acts[0].code, { con, loc, seq });
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
  setPreview(code, null);
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
$('preview').addEventListener('click', () => { if (previewState) { playClick(); openCardInfo(previewState.code); } });
document.addEventListener('click', (ev) => {
  // preview follows the player's taps (hand cards always; field zones when
  // not placing) — it never consumes the tap, the handlers below still run
  const handEl = ev.target.closest('#hand .hcard');
  if (handEl && handEl.dataset.code) setPreview(+handEl.dataset.code, null);
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
  if (zoneEl && !placeCtx && duelState) {
    const [zcon, zloc, zseq] = zoneEl.dataset.zone.split(':').map(Number);
    if (zloc === E.LOC.MZONE || zloc === E.LOC.SZONE) {
      const P = duelState.players[zcon];
      const card = zloc === E.LOC.MZONE ? P.mzone[zseq] : P.szone[zseq];
      if (card && card.code != null && ((card.pos & E.POS_FACEUP) !== 0 || zcon === HP)) setPreview(card.code, { con: zcon, loc: zloc, seq: zseq });
    }
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
// ---------------------------------------------------------------- layout
// User decision (2026-11-02): "fit the board to the screen; if space
// remains, a persistent card-detail preview." Sizes are computed ONCE at
// duel start from the viewport and then frozen for the whole duel — prompts
// (dock/sheets) overlay absolutely and the chain row's height is always
// reserved, so nothing can resize or shift the board mid-duel.
//
// Vertical budget (px, mirrors index.html exactly — every bar has an
// explicit height there; re-derived element by element in the layout-fix
// round and confirmed exact):
//   topbar 44 + opp field (pad 5 + pilebar 23 + 2 zone rows) + midbar 78
//   (chainbar 21 reserved + logline 15 + phasebar 34 + padding/borders 8)
//   + my field (2 zone rows + pilebar 23 + pad 5) + handbar extras 23
//   (who 13 + padding 10) + 4 zone-row margins 16  =  FIXED 217
//   plus 4 × slotH + handH + previewH.
// Slot: width W, image height round(W×1.22), +22 stats strip = slotH.
// Hand: width round(W×56/47), image round(handW×1.22), +22 stats strip.
// (Round 4: the strip is two stacked 11px lines — see the round-4 note
// below; it was a single 15/14px row until then.)
//
// LAYOUT FIX (real-browser defect): the formula targets an EXACT fill —
// whenever the preview is shown, the distribution consumes every leftover
// px and contentH == the height read from window.innerHeight, i.e. the
// dead band is 0 by construction. But window.innerHeight is NOT always
// the visible height (browser chrome states, app webview bands, 100dvh
// divergence): when the visible region is even a few tens of px shorter,
// exactly that much is clipped off the bottom of the stack and the page
// does not scroll — the hand's ATK/DEF strip went first. The constants
// were not the cause (217 is exact; margin collapsing inside .field can
// only make the real stack a few px SHORTER than the model).
// Fix: (1) budget against the VISUAL viewport height (visualViewport
// when available) minus a safety margin; (2) after applying, measure
// the real stack and step the budget down until it fits — all still
// inside the duel-start click, so the mid-duel freeze is untouched.
//
// LAYOUT FIX ROUND 2 (real-browser defect in the round above): round
// 1's step-down measured the stack bottom as offsetTop + offsetHeight
// accumulated up the offsetParent chain — a DOCUMENT-coordinate value
// (distance from the document's top edge; it does not move with scroll
// or with the visual viewport) — and compared it against a VIEWPORT-
// coordinate budget (visualViewport.height). The two numbers are only
// interchangeable when scrollY == 0, visualViewport.offsetTop == 0 and
// vv.height == innerHeight == documentElement.clientHeight; round 1
// never read offsetTop, scrollY or clientHeight, so it could not
// notice when that identity failed (in-app webview bands overlaying
// the layout viewport, chrome states, 100dvh on #app making the
// document box taller than the painted visible region — document
// coordinates happily extend below the visible bottom while the page
// does not scroll). Round 1's "fit" certified document fit against a
// modeled target, never painted visibility: in the verification
// browser the formula content sat within vv.height − 4 while the
// PAINTED hand strip was still half-clipped at the screen's bottom
// edge, flush, with no dead band — a delta a document-space loop
// cannot see at all.
// Fix: close the loop on the painted box. The formula budget now
// starts from the most conservative of the reported heights
// (visualViewport.height / innerHeight / clientHeight — a 0 reading
// means "no signal" and is ignored), and the step-down measures the
// stack's real bottom with getBoundingClientRect() — the same
// coordinate system the browser paints in — stepping down until
// rect.bottom <= visualViewport.offsetTop + visualViewport.height
// − safety. window.__layout records both bottoms (document and rect),
// every height signal, and each step, so a real-browser check can
// read the numbers directly. Where getBoundingClientRect has no
// layout to report (jsdom: all-zero rects), the loop stays inert and
// __layout.fit reports 'unmeasurable' instead of claiming a fit.
//
// LAYOUT FIX ROUND 3 (the loop still certified a clip in the real
// browser; measured in headless Chromium 156 against this code):
// (1) THE LOOP MEASURED A SKELETON. applyLayout runs inside the
// start-button click, BEFORE the duel's first render — the four zone
// rows are still empty divs, so the painted stack it measured was
// shorter than the real one by exactly the four zone rows. At
// 430×1080 the fit recorded rectBottom 685 and fit:true while the
// post-render stack actually painted to 1069 — a 384px blind spot
// (4 × slotH 96). Any formula/signal overshoot smaller than that
// sailed through both rounds untouched. Fix: after the duel's first
// render (the engine calls onUpdate after the first message batch,
// strictly BEFORE the first prompt is delivered — see maybeSettleLayout),
// the fit pass runs ONCE more against the fully rendered stack,
// continuing from the standing budget (sizes only ever shrink).
// It is part of the duel-start sizing: armed by the start click,
// one-shot, no listeners, and the mid-duel freeze is unchanged.
// (2) THE TARGET TRUSTED THE LARGEST CANDIDATE. Round 2's ceiling
// was vv.offsetTop + vv.height; rect coordinates are anchored at
// the visual viewport's own top edge, so with an offset visual
// viewport the visible bottom in rect coords is vv.height — the
// +offsetTop form overstates it by exactly offsetTop (a 13px offset
// overstates by 13px: with the 6px margin, a ~7px clip — the
// observed half-strip). Fix: the target is now the MOST
// CONSERVATIVE visible bottom among the rect-coordinate candidates
// (see viewportHeights) and the safety margin is 8px. Distrusting
// the largest can only over-shrink (a bigger dead band), never clip.
// (3) Checked and NOT a cause: the preview's rendered height equals
// its --pv budget exactly in Chromium at every tested size
// (including compact 26px and full 330px) — no min-content growth.
// Fonts cannot grow the stack either: every in-flow text sits in a
// fixed-height box, and the page loads no webfonts.
// (4) ?layoutdebug=1 renders the final fit state as on-page TEXT
// (renderLayoutDebug) — the verification harness cannot evaluate
// JS, so window.__layout alone was unreachable there.
//
// LAYOUT FIX ROUND 4 (the strip clip was NOT a stack-height defect at
// all; measured in headless Chromium 156 at 390×{620,700,998} against
// this code, and matching the parent's 1919×998 real-browser report):
// every ATK/DEF span measured 28px tall inside its 14px (.hstats) /
// 15px (.slotstats) strip, at EVERY height, with fit=true throughout.
// The strips were one flex ROW of two spans ("ATK 3750" + "DEF 3400"
// ≈ 83px of text at 9/10px) inside 53–64px of strip width: flex-
// shrink narrowed each span to 24–33px, the text wrapped at the
// label/number space, and the resulting two-line span overflowed the
// fixed-height strip symmetrically (7px above, 7px below). The
// overflow below the strip is clipped by the slot's / card's own
// overflow:hidden — visually: the ATK/DEF labels read fine, the
// numbers' lower half is cut, mid-board rows look "covered by the
// next row". The fit loop could never see it: it measures BOX
// bottoms (handbar, stack), and every box was inside the target
// while the glyphs inside the strips were cut. Three rounds of
// stack-height work were therefore treating a healthy quantity.
// Fix: the strips are now two STACKED lines (ATK over DEF), each
// nowrap with an explicit 11px line-height in a 22px strip (CSS in
// index.html; worst line "DEF 3400" measures 38.3px at 8px/9px,
// ~35.8px with the -.5px letter-spacing — inside even the minimum
// tile's 36px inner width, so the wrap cannot recur; a pathological
// 5-digit value can now only graze horizontally inside its own
// line). layoutParts budgets the strip at 22px for both slot and
// hand. The fit loop additionally measures the strips themselves
// (measureStripClip): fit now requires zero vertically-overflowing
// strips wherever strip layout is measurable, so this failure class
// is inside the guarantee from now on. Two companion hardenings in
// index.html: text-size-adjust:100% (a webview inflating text was
// hypothesis (b) — with nowrap lines inflation could no longer wrap
// text, and the explicit 100% removes the variable entirely), and
// #hand's scrollbar is hidden (in classic-scrollbar environments
// the horizontal bar renders inside #hand's fixed height and eats
// the strip whole at 6+ hand cards — the parent's turn-5 symptom;
// iOS overlay scrollbars never consumed the space, so this is a
// no-op there). Hypotheses (b)/(c) are not needed to explain ANY of
// the observed evidence — the wrap reproduces the full symptom set
// in honest Chromium at 998px, signals in agreement, fit=true —
// and the conservative signal target of round 3 stays as defense
// in depth for environments Chromium cannot model.
const LAYOUT_FIXED = 217;
const LAYOUT_SAFETY = 8; // px kept free below the stack, always (round 3: 6 → 8)
let layoutInfo = null;
function layoutParts(W) {
  const imgH = Math.round(W * 1.22);
  const slotH = imgH + 22;
  const handW = Math.round(W * 56 / 47);
  const handH = Math.round(handW * 1.22) + 22;
  return { imgH, slotH, handW, handH, stack: LAYOUT_FIXED + 4 * slotH + handH };
}
function computeLayout(vwIn, vh) {
  const vw = Math.min(vwIn || 390, 430); // #app max-width
  // width cap: the widest row is the spell/trap row — 6 slots + 5 gaps of 4
  // + field padding 12 must fit the app width. All zones share this size.
  let W = Math.max(40, Math.floor((vw - 12 - 20) / 6));
  let p = layoutParts(W);
  while (p.stack > vh && W > 40) { W--; p = layoutParts(W); }
  // Slack distribution: preview first (up to a fully usable 56px), then the
  // hand grows up to 1.3× its standard height, then any rest to the preview.
  let leftover = Math.max(0, vh - p.stack);
  let pv = Math.min(leftover, 56); leftover -= pv;
  const handCap = Math.round(p.handH * 1.3);
  const grow = Math.min(leftover, Math.max(0, handCap - p.handH));
  const handH = p.handH + grow; leftover -= grow;
  pv += leftover;
  const pvShown = pv >= 24 ? pv : 0; // a sub-24px sliver is hidden; it stays as the (<24px) dead band
  const contentH = LAYOUT_FIXED + 4 * p.slotH + handH + pvShown;
  return { vw, vh, tileW: W, imgH: p.imgH, slotH: p.slotH, handW: p.handW, handH, pv, pvShown, contentH, dead: vh - contentH };
}
// Every height signal the environment offers, in one place. The
// formula budgets against baseH = the SMALLEST positive signal (the
// most conservative reading wins; a 0 means the API has nothing to
// say here — jsdom reports clientHeight 0 — and is ignored, it must
// never zero the budget).
// visibleBottom — the fit loop's target — is the bottom edge of the
// visible region expressed in RECT coordinates (the coordinate
// system getBoundingClientRect reports in, anchored at the visual
// viewport's own top-left). ROUND 3: it is the MOST CONSERVATIVE of
// the derivable candidates. With an offset visual viewport there
// are two readings of its bottom edge: vv.height (anchored at the
// visual viewport's top edge — the rect-coordinate reading) and
// vv.offsetTop + vv.height (anchored at the layout origin — round
// 2's target, and always the LARGEST candidate when offsetTop > 0).
// When the signals disagree, the largest is distrusted: the layout
// viewport's own edges (clientHeight, innerHeight) are candidates
// on the same footing, and the minimum wins. The cost of distrust
// is bounded (a dead band larger by at most offsetTop); the cost of
// trusting the largest was the observed clip.
function viewportHeights() {
  const vv = window.visualViewport;
  const ih = Math.floor(window.innerHeight || 0);
  const ch = document.documentElement ? Math.floor(document.documentElement.clientHeight || 0) : 0;
  const hasVV = !!(vv && vv.height);
  const vvH = hasVV ? Math.floor(vv.height) : null;
  const vvTop = vv && vv.offsetTop ? vv.offsetTop : 0;
  const signals = [ih, ch, vvH].filter(v => v && v > 0);
  const baseH = signals.length ? Math.min.apply(null, signals) : ih;
  const bottoms = [];
  if (hasVV) { bottoms.push(vvH); bottoms.push(vvTop + vvH); }
  if (ch > 0) bottoms.push(ch);
  if (ih > 0) bottoms.push(ih);
  const visibleBottom = bottoms.length ? Math.min.apply(null, bottoms) : ih;
  return { innerHeight: ih, clientHeight: ch, vvHeight: vvH, vvOffsetTop: vvTop,
           baseH, visibleBottom };
}
function applyLayoutVars(info) {
  const rs = document.documentElement.style;
  rs.setProperty('--sw', info.tileW + 'px');
  rs.setProperty('--sh', info.slotH + 'px');
  rs.setProperty('--hw', info.handW + 'px');
  rs.setProperty('--hh', info.handH + 'px');
  rs.setProperty('--pv', info.pvShown + 'px');
  $('preview').className = info.pvShown > 0 ? (info.pvShown < 56 ? 'on compact' : 'on') : '';
  if (previewState) renderPreview();
}
// Document-coordinate bottom of the in-flow stack, from offsetTop +
// offsetHeight accumulated over the six in-flow sections (absolute
// children — dock/sheet/overlays — are excluded by construction).
// Kept as a RECORD only: round 1's defect was steering the fit loop
// with this number (see the round-2 note above); visibility is judged
// from painted rects, not from document coordinates.
function measureStackBottom() {
  const app = $('app');
  const base = app && app.offsetTop ? app.offsetTop : 0;
  let bottom = 0;
  for (const id of ['topbar', 'oppField', 'midbar', 'myField', 'preview', 'handbar']) {
    const el = $(id);
    if (!el || !el.offsetHeight) continue; // display:none (preview off) reads 0
    const b = base + el.offsetTop + el.offsetHeight;
    if (b > bottom) bottom = b;
  }
  return bottom;
}
// Painted bottom of the in-flow stack in RECT coordinates — where the
// browser actually draws the stack's last pixel row, directly
// comparable to viewportHeights().visibleBottom. The hand bar is the
// last in-flow section, but the max is taken over all six (a
// display:none section reads an all-zero rect and drops out). Returns
// null when no rect carries any layout information at all (jsdom:
// every rect is 0) — the caller must then report the fit as
// unmeasurable rather than claim it.
function measureStackRectBottom() {
  let bottom = 0, seen = false;
  for (const id of ['topbar', 'oppField', 'midbar', 'myField', 'preview', 'handbar']) {
    const el = $(id);
    if (!el || !el.getBoundingClientRect) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 || r.bottom !== 0) seen = true;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  return seen ? bottom : null;
}
// Painted bottom of the hand bar alone (the stack's last section and
// the element whose ATK/DEF strip was clipped) — recorded on
// window.__layout and shown by the ?layoutdebug=1 readout so a
// real-browser check can compare it against the visible bottom
// directly. Null where rects carry no layout (jsdom).
function measureHandRectBottom() {
  const el = $('handbar');
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  return (r.height > 0 || r.bottom !== 0) ? Math.round(r.bottom * 10) / 10 : null;
}
// Round 4: count stat strips whose TEXT overflows the strip box
// vertically (scrollHeight beyond clientHeight) — the failure class
// the box-bottom loop was blind to for three rounds (see the round-4
// note at LAYOUT_FIXED). Elements without layout (jsdom reports
// clientHeight 0) are skipped; returns null when no strip was
// measurable at all, the clipped count otherwise. Folded into the
// fit verdict in layoutFit: a stack can no longer certify fit while
// a strip's text is cut inside its own box.
function measureStripClip() {
  let seen = 0, clipped = 0;
  const els = document.querySelectorAll('.hstats, .slotstats');
  for (const el of els) {
    if (!el.clientHeight) continue;
    seen++;
    if (el.scrollHeight > el.clientHeight + 1) clipped++;
  }
  return seen ? clipped : null;
}
// One fit pass. isSettle=false is the duel-start pass (fresh budget
// from the target). isSettle=true is the round-3 settle: it CONTINUES
// from the standing budget — sizes only ever shrink — but measures
// the fully rendered stack (zone slots, hand cards and preview
// content all in the DOM), which the start pass cannot see (its
// zone rows are still empty; see the round-3 note above). Both
// passes run inside the duel-start sequence; nothing here is bound
// to any event, so the mid-duel freeze is untouched.
function layoutFit(isSettle) {
  const vp = viewportHeights();
  const allowedRect = vp.visibleBottom - LAYOUT_SAFETY; // rect-coord ceiling for the painted stack bottom
  const prev = isSettle ? layoutInfo : null;
  // The painted bottom BEFORE this pass touches any size — for the
  // settle this is the number the start pass was blind to.
  const settleRectBefore = isSettle ? measureStackRectBottom() : null;
  let budget = prev && prev.budget != null ? prev.budget : Math.max(0, vp.visibleBottom - LAYOUT_SAFETY);
  const decorate = (info) => {
    info.vh = vp.baseH; info.budget = budget; info.dead = vp.baseH - info.contentH;
    info.innerHeight = vp.innerHeight; info.clientHeight = vp.clientHeight;
    info.vvHeight = vp.vvHeight; info.vvOffsetTop = vp.vvOffsetTop;
    info.visibleBottom = vp.visibleBottom;
    return info;
  };
  let info = decorate(computeLayout(window.innerWidth, budget));
  layoutInfo = info;
  window.__layout = info; // measurement hook for tests (jsdom has no layout engine)
  applyLayoutVars(info);
  // Visible-fit guarantee: measure the PAINTED stack bottom (rect
  // coordinates) and step the budget down by the measured excess until
  // it clears the visible bottom minus the safety margin. Shrinking
  // the budget first eats the preview, then the hand growth, then the
  // tile unit (computeLayout's own order), so the board shrinks only
  // as much as reality demands. Bounded: at most 16 steps, and the
  // loop stops as soon as a step can no longer shrink contentH
  // (minimum layout reached — W floor 40 and no preview; if a visible
  // region is shorter than even that stack, the minimum layout is
  // kept and info.fit reports false). When rect measurement does not
  // exist here (jsdom), the loop is inert, the corrected formula
  // stands, and info.fit reports 'unmeasurable'.
  let measured = measureStackBottom();
  let rect = measureStackRectBottom();
  // The start pass always opens the log; the settle appends its
  // opening entry only when its measurement carries information
  // (a null rect in jsdom adds nothing the start pass didn't say).
  const fitLog = prev && prev.fitLog ? prev.fitLog.slice() : [];
  if (!isSettle || rect !== null)
    fitLog.push({ pass: isSettle ? 'settle' : 'start', step: 0, budget, contentH: info.contentH, measured, rectBottom: rect });
  let steps = 0;
  while (rect !== null && rect > allowedRect && steps < 16) {
    budget = Math.max(0, budget - Math.ceil(rect - allowedRect));
    const next = decorate(computeLayout(window.innerWidth, budget));
    if (next.contentH >= info.contentH) break; // cannot shrink further
    info = next;
    layoutInfo = info;
    window.__layout = info;
    applyLayoutVars(info);
    measured = measureStackBottom();
    rect = measureStackRectBottom();
    steps++;
    fitLog.push({ pass: isSettle ? 'settle' : 'start', step: steps, budget, contentH: info.contentH, measured, rectBottom: rect });
  }
  info.measured = measured;      // document-coordinate bottom (record only)
  info.rectBottom = rect;        // painted bottom in rect coordinates (null = unmeasurable)
  info.handRectBottom = measureHandRectBottom();
  info.fitSteps = (prev && prev.fitSteps ? prev.fitSteps : 0) + steps;
  info.fitLog = fitLog;
  info.stripClip = measureStripClip(); // round 4: vertically overflowing stat strips (null = unmeasurable)
  const stripsOk = info.stripClip === null || info.stripClip === 0;
  info.fitVisible = rect === null ? null : (rect <= allowedRect && stripsOk);
  info.fit = rect === null ? 'unmeasurable' : info.fitVisible; // true only on a rect-verified visible fit with no clipped strip
  if (isSettle) { info.settled = true; info.settleRectBefore = settleRectBefore; }
  else if (prev && prev.settled) { info.settled = true; info.settleRectBefore = prev.settleRectBefore; }
  renderLayoutDebug();
}
function applyLayout() { layoutFit(false); }
// ------------------------------------------------------- layout settle
// Round 3 (see the note at LAYOUT_FIXED): the start pass measures a
// skeleton — the zone rows are empty until the duel's first render.
// The settle re-runs the fit ONCE against the rendered stack. It is
// armed by the start-button handler and fires from the duel's first
// onUpdate (the engine delivers state updates after each message
// batch, strictly before answering the first prompt) or, as a
// fallback, at the head of the first humanAnswerer call — in both
// cases before any duel interaction has been answered, i.e. still
// inside the duel-start sizing. One-shot; no listeners; a resize or
// a later prompt can never re-trigger it.
let layoutSettleArmed = false;
let layoutSettled = false;
function maybeSettleLayout() {
  if (!layoutSettleArmed || layoutSettled) return;
  // A rect measurement only describes the real stack once the board
  // is rendered: zone slots and hand cards in the DOM.
  if (!document.querySelector('#myMzone .slot') || !document.querySelector('#hand .hcard')) return;
  layoutSettled = true;
  try { layoutFit(true); }
  catch (e) { if (window.__layout) window.__layout.settleError = String(e); }
}
// ------------------------------------------------------- layout debug
// ?layoutdebug=1: a small fixed-position TEXT readout (bottom-left,
// monospace, dismissible via the ×) of the final fit state —
// signals, budget, rect bottoms, fit — updated at each fit pass.
// The parent's verification harness cannot evaluate JS in the page,
// so window.__layout's numbers were unreachable in the real
// environment; this puts them on the screen itself. Default off:
// without the parameter nothing is created and nothing changes.
const layoutDebugOn = /[?&]layoutdebug=1(?:&|$)/.test(window.location.search || '');
function renderLayoutDebug() {
  if (!layoutDebugOn) return;
  let el = document.getElementById('layoutdebug');
  if (!el) {
    el = document.createElement('div');
    el.id = 'layoutdebug';
    el.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:999;pointer-events:none;background:rgba(0,0,0,.88);color:#7fc97f;border:1px solid #7fc97f;border-radius:4px;font:10px/1.6 monospace;padding:5px 8px;white-space:pre;';
    const txt = document.createElement('span');
    const x = document.createElement('span');
    x.textContent = ' [×]';
    x.style.cssText = 'cursor:pointer;color:#e06666;pointer-events:auto;';
    x.addEventListener('click', () => { el.remove(); });
    el.appendChild(txt); el.appendChild(x);
    el._txt = txt;
    document.body.appendChild(el);
  }
  const L = window.__layout || {};
  const hb = $('handbar');
  const handNow = hb && hb.getBoundingClientRect ? Math.round(hb.getBoundingClientRect().bottom * 10) / 10 : null;
  el._txt.textContent =
    'LAYOUT FIT\n' +
    'inner=' + L.innerHeight + ' client=' + L.clientHeight + ' vvH=' + L.vvHeight + ' vvTop=' + L.vvOffsetTop + '\n' +
    'baseH=' + L.vh + ' target=' + L.visibleBottom + ' budget=' + L.budget + '\n' +
    'contentH=' + L.contentH + ' rectBottom=' + L.rectBottom + ' handBottom=' + (L.handRectBottom != null ? L.handRectBottom : handNow) + '\n' +
    'fit=' + L.fit + ' steps=' + L.fitSteps + ' settled=' + !!L.settled + (L.settled ? ' settleRect=' + L.settleRectBefore : '') +
    '\nstripClip=' + L.stripClip + ' tile=' + L.tileW + 'x' + L.slotH + ' hand=' + L.handH + ' pv=' + L.pvShown;
}
// ---------------------------------------------------------------- preview
// Persistent card-detail strip in the leftover space (never overlays or
// shrinks the board). Shows the most recently tapped/selected card: larger
// art, name, meta, live ATK/DEF for field cards, full text (scrolls inside
// the strip only). Tapping the strip opens the full card-info sheet.
// Default before any tap: the first card of the opening hand.
let previewState = null; // {code, con, loc, seq, sig}
function setPreview(code, ref) {
  if (code == null || !DATA || !DATA.cards[code]) return;
  previewState = { code, con: ref ? ref.con : null, loc: ref ? ref.loc : null, seq: ref ? ref.seq : null, sig: '' };
  renderPreview();
}
function renderPreview() {
  const el = $('preview');
  if (!el || !previewState) return;
  let card = null;
  if (previewState.con != null && duelState) {
    const P = duelState.players[previewState.con];
    if (previewState.loc === E.LOC.MZONE) card = P.mzone[previewState.seq];
    else if (previewState.loc === E.LOC.SZONE) card = P.szone[previewState.seq];
    if (card && card.code !== previewState.code) card = null; // zone changed hands: fall back to printed values
  }
  let stats = '';
  if (isMonster(previewState.code)) {
    const d = cardData(previewState.code);
    const atk = card && card.curAtk != null ? card.curAtk : d.atk;
    const def = card && card.curDef != null ? card.curDef : d.def;
    stats = 'ATK ' + atk + '／DEF ' + def;
  }
  const sig = previewState.code + '|' + stats + '|' + (card ? card.pos : '');
  if (sig === previewState.sig) return; // no DOM churn on unrelated re-renders
  previewState.sig = sig;
  el.innerHTML = '<div class="pv-art"></div><div class="pv-body">' +
    '<div class="pv-top"><span class="pv-name">' + cardName(previewState.code) + '</span>' +
    (stats ? '<span class="pv-stats">' + stats + '</span>' : '') + '</div>' +
    '<div class="pv-meta">' + cardMetaLine(previewState.code) + '</div>' +
    '<div class="pv-text">' + (cardText(previewState.code) || '') + '</div></div>';
}
function updatePreviewFromState(state) {
  if (!previewState) {
    const me = state.players[HP];
    if (me && me.hand.length && me.hand[0].code != null) setPreview(me.hand[0].code, null);
    return;
  }
  renderPreview();
}
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
    previewState = null; // preview restarts with the duel (default: first hand card)
    applyLayout(); // fit once to this viewport, then frozen for the whole duel
    layoutSettleArmed = true; layoutSettled = false; // round 3: one post-render settle, still inside the start sequence
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
    bgmWantedRank = -1; bgmSeenKeys.clear(); // BGM stage ladder restarts with the duel
    setBgmScene('normal', true);
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
        maybeSettleLayout(); // round 3: first render done, first prompt not yet delivered (engine order)
      },
      humanAnswerer: async (prompt, state) => { maybeSettleLayout(); render(state); return uiAnswer(prompt, state); },
    });
    const stats = await duel.run();
    const st = duel.state;
    render(st);
    setBgmScene(st.winner === HP ? 'win' : 'lose', true);
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
