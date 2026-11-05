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
let cmdPromptOpen = false;  // BU-02: an idle/battle command prompt is on screen
let actionMap = new Map();  // "con:loc:seq" -> [{label, bytes}] for idle/battle prompts
let pendingTap = null;      // triage-#2: a board tap buffered during the no-prompt window {key, at}
let phaseAction = null;     // {label, bytes} for the phase button
let menuActions = [];       // extra idle actions (hand shuffle)
let placeCtx = null;        // active SELECT_PLACE/DISFIELD interaction
let lastPlaceCard = null;   // {key, code} of a just-chosen summon/set action
let pendingAttacker = null; // {code} of a just-chosen 攻撃 action (BATTLECMD)
let promptAttacker = null;  // pendingAttacker, bound to the prompt it preceded
let dismissedChains = new Set(); // chain-candidate dismissals (this chain only)
let dismissedDuel = new Map();   // chain-candidate dismissals (whole duel): duelKey (card+effect class) -> {code, desc, loc}
// start-screen choices (Phase 2 item 5)
let myDeckKey = 'ishizu', opDeckKey = 'gg', firstChoice = 'first';
let autoPassFlashUntil = 0;

function cardName(code) { return (DATA && DATA.names[code]) || ('#' + code); }
function cardData(code) { return (DATA && DATA.cards[code]) || null; }
// ---- per-card illustrations (decided 2026-11-03: the user supplies
// an image per card and each is applied as it arrives; cards without
// an entry keep the shared placeholder art — the fallback IS the
// default). Files: ../assets/card-art-<slug>-s.jpg (tiles, hand,
// grid, preview, ghosts) and ../assets/card-art-<slug>.jpg (the big
// cut-in card). Cropping rule (user, 2026-11-03, all cards): when
// the art does not fit a window, keep the TOP and cut from the
// bottom — never crop the head. That is why artInline pins
// background-position to top; the delivered files are themselves
// top-anchored crops.
const CARD_ART = { 99937011: 'mudora', 62320425: 'agido', 16135253: 'agido', 25926710: 'kelbek', 63542003: 'keldo', 31525442: 'zolga', 86605515: 'cardan', 46148485: 'sphinx', 38699854: 'taiyou', 14087893: 'tsuki', 79106360: 'chaospod', 9350312: 'oka', 62133026: 'hana', 36745317: 'mori', 14108995: 'kakan', 15079028: 'carbon', 55702233: 'silky', 36898537: 'horus', 98715423: 'hakamori', 45409943: 'luce', 30100551: 'minerva', 82633039: 'castel', 62967433: 'baromett', 37706769: 'pluto', 21368273: 'trilo', 63101468: 'hyperion' }; // 剣神官ムドラ / 古衛兵アギド / 古尖兵ケルベク / 宿神像ケルドウ / 予見者ゾルガ / 賢瑞官カルダーン / 転輪のスフィンクス / 太陽の書 / 月の書 / カオスポッド / 丘と芽吹の春化精 / 花と野原の春化精 / 森と目覚の春化精 / 春化精の花冠 / 地久神－カルボン / 生きる偲びのシルキィ / メタファイズ・ホルス・ドラゴン (user art 2026-11-03) / 墓守の罠 (user art 2026-11-04, 18th delivery — the first TRAP with individual art, and a keycard-activation presentation target) / 宵闇のルーチェ (user art 2026-11-05, 19th delivery — an Ishizu keycard, so its summon cut-in and the Keycard BGM stage resolve this art too) / ライトロード・セイント ミネルバ (user art 2026-11-05, 20th delivery — a regular CARD_ART entry, not a keycard; see ART_FOCUS for her band exception) / 鳥銃士カステル (user art 2026-11-06, 21st delivery — a regular CARD_ART entry, not a keycard; no ART_FOCUS — his head sits high enough that both detail bands frame it under center top) / 神羊樹バロメット (user art 2026-11-06, 22nd delivery — a regular CARD_ART entry, not a keycard; the first painting delivered at 3:4 (1086x1448) instead of 2:3, so the big file keeps the FULL height and takes its 640:882 window horizontally (x=35, width 1051 — the 35px comes off the left edge, background only); the small file is the standard top-anchored square; see ART_FOCUS for her band exception) / 冥府の執行者 プルート (user art 2026-11-06, 23rd delivery — a regular CARD_ART entry, not a keycard; no ART_FOCUS — his face sits high (~16-25% of the big file) so both detail bands frame head, wings and the star orb under center top) / マナドゥム・トリロスークタ (user art 2026-11-06, 24th delivery — a regular CARD_ART entry, not a keycard; no ART_FOCUS — his helmeted head sits high (face ~17-19% of the big file) so both detail bands frame helmet, face and torso under center top) / マスターフレア・ヒュペリオン (user art 2026-11-06, 25th delivery — a regular CARD_ART entry, NOT a keycard (removed from the keycard list by the user's decision, so no keycard list or test is touched); no ART_FOCUS — his winged helmet sits high (crest ~4%, masked face ~10-13% of the big file) so both detail bands frame helmet, face and torso under center top; this registration completes the Ishizu EXTRA deck — every one of its cards now has individual art)
// ---- deck-scoped art overrides (user decision 2026-11-03): a card
// can carry a DIFFERENT illustration while it belongs to a specific
// deck. DECK_ART maps deck id (the data.json decks key) -> passcode
// -> slug, and resolution prefers it over CARD_ART whenever the
// caller supplies the deck context of the card instance. First
// entries: the three Vernusylph sisters (Mori, Hana, Oka) wear
// their Egyptian illustrations only inside the Ishizu deck; in
// any other deck — a future Neuron-imported deck among them —
// they fall back to their plain art on their own. The 4th entry
// extends the same treatment to 《春化精の花冠》 (14108995), the
// sisters' own spell: its Egyptian variant lives here, while
// the forest painting stays in CARD_ART as the plain art any
// other deck sees. The 5th entry is 《地久神－カルボン》
// (15079028), the first MONSTER with an override: the giant
// wears gold-and-hieroglyph regalia inside the Ishizu deck
// and stays bare stone anywhere else. The 6th entry is
// 《生きる偲びのシルキィ》 (55702233): the translucent girl
// wears an Egyptian white dress with a gold sash inside the
// Ishizu deck, and keeps her plain room painting anywhere
// else. The 7th entry is 《宵闇のルーチェ》 (45409943,
// user art 2026-11-05, the deck-override companion to the
// 19th delivery): the white-winged painting stays in
// CARD_ART as the plain art any other deck sees, while
// inside the Ishizu deck — the only deck that runs her —
// she wears the all-gold Egyptian form (golden wings,
// Eye-of-Horus shields, the pyramids and the Nile below).
// As a keycard, her summon cut-in inside an Ishizu duel
// resolves this art too. The 8th entry is 《ライトロード・
// セイント ミネルバ》 (30100551, user art 2026-11-05, the
// deck-override companion to the 20th delivery): the
// floating cathedral painting stays in CARD_ART as the
// plain art any other deck sees, while inside the Ishizu
// deck she floats over an Egyptian temple hall instead —
// blue-and-gold feathered wings, hieroglyph pillars, the
// same owl on her hand. Like Luce she is an EXTRA-deck
// monster; unlike her she is not a keycard, so no cut-in
// or BGM surface keys off this entry. Generic by design:
// new decks and cards are data, not branches.
const DECK_ART = { ishizu: { 36745317: 'mori-ishizu', 62133026: 'hana-ishizu', 9350312: 'oka-ishizu', 14108995: 'kakan-ishizu', 15079028: 'carbon-ishizu', 55702233: 'silky-ishizu', 45409943: 'luce-ishizu', 30100551: 'minerva-ishizu', 82633039: 'castel-ishizu', 62967433: 'baromett-ishizu', 37706769: 'pluto-ishizu', 63101468: 'hyperion-ishizu' } }; // 森と目覚の春化精 / 花と野原の春化精 / 丘と芽吹の春化精 / 春化精の花冠 / 地久神－カルボン / 生きる偲びのシルキィ / 宵闇のルーチェ / ライトロード・セイント ミネルバ / 鳥銃士カステル / 神羊樹バロメット / 冥府の執行者 プルート / マスターフレア・ヒュペリオン (Egyptian art, Ishizu deck only)
// Which deck each core seat is playing this duel ([seat0, seat1]),
// set at duel start; nulls outside a duel. Every art surface
// derives its deck context from the seat that owns the card
// instance, never from the viewing seat — the override follows
// the deck, not the chair.
let seatDeckKeys = [null, null];
function deckKeyOfSeat(p) { return (p === 0 || p === 1) ? seatDeckKeys[p] : null; }
// Deck context for code-only surfaces (a preview without an
// instance ref, the name catalogue): the deck key when exactly
// one of the two duel decks contains the code — the only case
// where "the deck it belongs to" is unambiguous without an
// instance. In both or neither -> null (base art).
function deckKeyOfCode(code) {
  if (code == null || !DATA || !DATA.decks) return null;
  const found = new Set();
  for (let p = 0; p < 2; p++) {
    const k = seatDeckKeys[p]; if (!k) continue;
    const d = deckListOf(k); if (!d) continue;
    if ((d.main || []).includes(code) || (d.extra || []).includes(code)) found.add(k);
  }
  return found.size === 1 ? [...found][0] : null;
}
function artSlug(code, deckKey) {
  if (code == null) return null;
  const over = deckKey ? (DECK_ART[deckKey] || {})[code] : null;
  return over || CARD_ART[code] || null;
}
function cardArtFile(code, big, deckKey) {
  const s = artSlug(code, deckKey);
  return s ? '../assets/card-art-' + s + (big ? '.jpg' : '-s.jpg') : null;
}
// ---- focus exceptions for the wide BIG-art bands (user ruling
// 2026-11-05): the crop rule above stays the default — top
// anchored, 'center top' — but a painting whose subject sits so
// low in the frame that a top-only crop leaves the subject
// essentially OUT of the band may shift its band position, that
// card only. Measured 2026-11-05 over every registered art (26
// slugs) by reproducing both bands (detail sheet 390 x 280, info
// pop 390 x 180, background-size cover) from the delivered big
// files; full table in the brushup cropfix report. Only three
// qualified: 《カオスポッド》 — the pod itself sits at y 55-85% of
// the frame, so the band showed the shelf and jar tops only;
// 《宵闇のルーチェ》 (both paintings) — her head and torso sit at
// the sheet band's bottom edge and fall outside the pop band
// entirely, leaving wings and tower. Keyed by slug, so a base art
// and its deck variant are judged — and shifted — separately.
// Consulted only for the BIG file: the bands (.infoart/.popart)
// and the cut-in cards. (On the cut-ins the shift is a numerical
// no-op: the bigcard box, 242 x 334 at phone width, matches the
// 640 x 882 file's aspect to under a pixel of cover overflow, so
// no position can move anything there.) The small square file
// keeps 'center top' everywhere: it is itself a top-anchored
// crop in which every subject already reads fine on tiles, hand
// and grid (measured in the same pass).
// A 4th entry arrived with delivery #20 (measured the same way,
// 2026-11-05): 《ライトロード・セイント ミネルバ》 — her face
// sits at ~43% of the frame, so the sheet band caught it only at
// its bottom edge and the pop band (top 33.5%) missed her
// entirely, showing dome, light rays and banner alone. 40%
// centers her face in the pop band and seats face and torso
// mid-band in the sheet band (before/after reproductions in the
// cropfix folder: minerva-band-{sheet,pop}-{before,after}.jpg).
// A 5th entry arrived the same day with her deck-scoped
// override (the 8th DECK_ART entry), judged separately like
// luce / luce-ishizu: in the Egyptian painting her face sits
// at the same height as the v2 plain painting (eyes ~29% of
// the delivered big file), so center top again pushes her
// face to the pop band's bottom edge with the mouth and chin
// outside it, while 'center 20%' — the same value as the
// plain painting — centers face, torso and owl in both
// bands (reproductions in the cropfix folder:
// minerva-ishizu-band-{sheet,pop}-{top,20}.jpg).
// A 6th entry arrived with delivery #21b (2026-11-06), the
// deck-scoped override for 《鳥銃士カステル》 (the 9th DECK_ART
// entry), judged separately like the other pairs: the plain
// painting needs no exception — his head sits high — but in
// the Egyptian painting the tall nemes headdress pushes his
// face lower (face and beak at ~29-37% of the delivered big
// file), so center top leaves the face at the pop band's
// bottom edge with the beak outside it, while 'center 20%'
// seats the whole head mid-band in both bands (reproductions
// in the cropfix folder: castel-ishizu-band-{sheet,pop}-{top,20}.jpg).
// A 7th entry arrived with delivery #22 (2026-11-06):
// 《神羊樹バロメット》 — her face sits mid-frame (eyes ~47% of
// the delivered big file), so center top leaves the sheet
// band showing wool, horn and vines with the face cut off at
// its bottom edge, and the pop band shows rainbow light and
// vine curls with the sheep essentially absent; 'center 40%'
// seats the whole head — horns, face, muzzle — mid-band in
// both bands (reproductions in the cropfix folder:
// baromett-band-{sheet,pop}-{top,30,40,50}.jpg, with
// -before / -after aliases for the top / 40% pair).
// An 8th entry arrived with delivery #22b (2026-11-06), the
// deck-scoped override for 《神羊樹バロメット》 (the 10th
// DECK_ART entry), judged separately like the other pairs:
// in the Egyptian painting her face sits mid-frame just as
// in the plain one (eyes ~50% of the delivered big file),
// so center top again leaves the pop band showing rainbow
// light and vine curls with the sheep essentially absent,
// while 'center 40%' — the same value as the plain
// painting — seats the whole head, golden crown, horns,
// face, muzzle and ankh collar mid-band in both bands
// (reproductions in the cropfix folder:
// baromett-ishizu-band-{sheet,pop}-{top,40,50}.jpg, with
// -before / -after aliases for the top / 40% pair).
const ART_FOCUS = { chaospod: 'center 85%', luce: 'center 38%', 'luce-ishizu': 'center 38%', minerva: 'center 20%', 'minerva-ishizu': 'center 20%', 'castel-ishizu': 'center 20%', baromett: 'center 40%', 'baromett-ishizu': 'center 40%' };
function artPosition(code, big, deckKey) {
  if (!big) return 'center top';
  const s = artSlug(code, deckKey);
  return (s && ART_FOCUS[s]) || 'center top';
}
// inline style for an HTML-string surface (tile art, hand, preview,
// grid cards): empty string for unlisted codes, so their markup is
// byte-identical to before.
function artCss(code, big, deckKey) {
  const f = cardArtFile(code, big, deckKey);
  return f ? 'background-image:url(' + f + ');background-position:' + artPosition(code, big, deckKey) : '';
}
function artInline(code, big, deckKey) {
  const css = artCss(code, big, deckKey);
  return css ? ' style="' + css + '"' : '';
}
// DOM-element surfaces (cut-in big cards, FX ghosts): set the same
// two properties directly; a no-op for unlisted codes.
function artApply(el, code, big, deckKey) {
  const f = code != null ? cardArtFile(code, big, deckKey) : null;
  if (!f || !el) return;
  el.style.backgroundImage = 'url(' + f + ')';
  el.style.backgroundPosition = artPosition(code, big, deckKey);
}
const artPreloaded = new Set();
function preloadCardArt(deckKeys) {
  // start-screen preload (user spec: art is fetched from deck-select
  // time so no surface ever flashes blank or '?'): warm every listed
  // art whose card sits in one of the given decks, both sizes.
  if (!DATA || !DATA.decks) return;
  const files = new Set();
  for (const k of deckKeys) {
    const d = deckListOf(k); if (!d) continue;
    for (const c of (d.main || []).concat(d.extra || [])) {
      if (!CARD_ART[c] && !(DECK_ART[k] || {})[c]) continue;
      for (const big of [false, true]) {
        const f1 = cardArtFile(c, big); if (f1) files.add(f1);
        // the deck-scoped variant too (DECK_ART): a Mori in the
        // Ishizu deck paints mori-ishizu from the first frame, and
        // the base file stays warm for code-only surfaces whose
        // context resolves the other way.
        const f2 = cardArtFile(c, big, k); if (f2) files.add(f2);
      }
    }
  }
  for (const f of files) {
    if (!artPreloaded.has(f)) { artPreloaded.add(f); const im = new Image(); im.src = f; }
  }
}
// deck-select page: display names + the live selection summary
// above the start button (what is chosen, on one line, always
// current — the page's seg handlers refresh it on every change).
function deckDisplayName(k) {
  if (SAVED_DECKS[k]) return SAVED_DECKS[k].name;
  return k === 'gg' ? 'ゲート・ガーディアン' : 'MILLENNIUM PROPHECY';
}
// ----------------------------------------------------------------
// Neuron import (Phase 1): decks the user imported and saved live
// under keys 'saved:<id>' in SAVED_DECKS, persisted in localStorage
// ('v2saveddecks', via NeuronLib). Built-in decks stay in
// DATA.decks; deckListOf is the single lookup both worlds share, so
// the start flow, the art preload and the deck-context resolution
// never branch on where a deck came from. Saved decks are own-side
// only (the opponent roster stays curated), and a saved deck whose
// cards exceed the current 63-card pool is listed and selectable
// but can never start a duel — refreshStartGate enforces that with
// the reason on the summary line.
const SAVED_DECKS = {};
let savedDeckList = [];
function deckListOf(k) {
  if (!k) return null;
  if (DATA && DATA.decks && DATA.decks[k]) return DATA.decks[k];
  const r = SAVED_DECKS[k];
  return r ? { main: r.main, extra: r.extra } : null;
}
function loadSavedDecks() {
  savedDeckList = [];
  try {
    if (window.NeuronLib) savedDeckList = NeuronLib.loadSavedDecks(localStorage) || [];
  } catch (e) { savedDeckList = []; }
  for (const r of savedDeckList) SAVED_DECKS['saved:' + r.id] = r;
}
loadSavedDecks();
let bootReady = false; // set when the boot load completes (start gate input)
function refreshStartGate() {
  const sb = $('startbtn'); if (!sb || !bootReady) return;
  const rec = SAVED_DECKS[myDeckKey];
  if (rec && !rec.poolOk) { sb.disabled = true; sb.textContent = '未対応カードがあるため開始できません'; }
  else { sb.disabled = false; sb.textContent = 'デュエル開始'; }
}
function updateDeckSum() {
  const el = $('decksum'); if (!el) return;
  const turn = firstChoice === 'first' ? '先攻' : firstChoice === 'second' ? '後攻' : '先攻・後攻ランダム';
  let txt = '自分：' + deckDisplayName(myDeckKey) + ' ／ 相手：' + deckDisplayName(opDeckKey) + ' ／ ' + turn;
  const rec = SAVED_DECKS[myDeckKey];
  if (rec && !rec.poolOk && rec.unsupported && rec.unsupported.length)
    txt += ' ／ 未対応：' + rec.unsupported.join('、');
  el.textContent = txt;
  refreshStartGate();
}
function syncDeckSelection() {
  document.querySelectorAll('#seg-mydeck button.deck').forEach(b => b.classList.toggle('sel', b.dataset.v === myDeckKey));
  document.querySelectorAll('#seg-mydeck .deck.saveditem').forEach(b => b.classList.toggle('sel', b.dataset.k === myDeckKey));
  // a selected saved deck sits below the built-ins inside the
  // list's own scroll region; bring its row into view so the
  // selection is visible feedback, not just a summary line
  if (myDeckKey && myDeckKey.indexOf('saved:') === 0) {
    const row = document.querySelector('#seg-mydeck .deck.saveditem[data-k="' + myDeckKey + '"]');
    if (row && row.scrollIntoView) { try { row.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  }
}
function selectMyDeck(key) {
  myDeckKey = key;
  syncDeckSelection();
  preloadCardArt([myDeckKey, opDeckKey]);
  updateDeckSum();
}
let delArm = null; // {key, until} — two-step delete confirm on the button itself
function renderSavedDecks() {
  const el = $('seg-mydeck'); if (!el) return;
  el.querySelectorAll('.saveditem').forEach(n => n.remove());
  if (savedDeckList.length) {
    const div = document.createElement('div');
    div.className = 'saveddiv saveditem';
    div.textContent = '保存したデッキ';
    el.appendChild(div);
  }
  for (const r of savedDeckList) {
    const key = 'saved:' + r.id;
    const d = document.createElement('div');
    d.className = 'deck saved saveditem' + (myDeckKey === key ? ' sel' : '');
    d.dataset.k = key;
    d.innerHTML = '<img src="../assets/card-art-placeholder-s.jpg" alt=""><span><span class="dn"></span><span class="dd"></span></span><span class="check"></span><button class="deckdel">削除</button>';
    d.querySelector('.dn').textContent = r.name;
    d.querySelector('.dd').textContent = 'メイン' + r.main.length + '枚／EX' + r.extra.length + '枚・' + r.pt + 'pt' + (r.poolOk ? '' : '・未対応カードあり（対戦不可）');
    d.addEventListener('click', () => { playClick(); selectMyDeck(key); });
    const del = d.querySelector('.deckdel');
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const now = Date.now();
      if (!delArm || delArm.key !== key || delArm.until < now) {
        delArm = { key, until: now + 3000 };
        del.textContent = '本当に削除'; del.classList.add('armed');
        setTimeout(() => { if (delArm && delArm.key === key) { delArm = null; renderSavedDecks(); } }, 3200);
        return;
      }
      delArm = null;
      savedDeckList = savedDeckList.filter(x => 'saved:' + x.id !== key);
      delete SAVED_DECKS[key];
      try { if (window.NeuronLib) NeuronLib.storeSavedDecks(localStorage, savedDeckList); } catch (e) {}
      if (myDeckKey === key) myDeckKey = 'ishizu';
      renderSavedDecks(); syncDeckSelection(); updateDeckSum();
    });
    el.appendChild(d);
  }
}
// genesys-data.json loads lazily — only the import panel needs it,
// so the boot path and every other test never pay for it. Shape is
// validated by NeuronLib.setData (foreign JSON leaves it unset).
let genesysDataPromise = null;
function ensureGenesysData() {
  if (!window.NeuronLib) return Promise.resolve(false);
  if (NeuronLib.dataReady()) return Promise.resolve(true);
  if (!genesysDataPromise) {
    genesysDataPromise = fetch('genesys-data.json').then(r => r.json()).then(gd => {
      const okd = NeuronLib.setData(gd);
      if (okd && DATA && DATA.names) NeuronLib.addPoolNames(DATA.names);
      return okd;
    }).catch(() => false);
  }
  return genesysDataPromise;
}
let neuronPending = null; // record candidate from the last successful parse
let neuronUrlFetchRunning = false; // re-entry guard: one relay chain at a time (a second paste/click mid-fetch must not start a competing chain over the same panel)
function neuronProvisionalName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return '取り込みデッキ ' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function neuronGroupLines(codes, namesSnap) {
  const order = [], count = new Map();
  for (const c of codes) { if (!count.has(c)) { count.set(c, 0); order.push(c); } count.set(c, count.get(c) + 1); }
  return order.map(c => {
    const nm = (namesSnap && namesSnap[c]) || (window.NeuronLib ? NeuronLib.displayName(c) : '#' + c);
    return nm + (count.get(c) > 1 ? ' ×' + count.get(c) : '');
  });
}
function renderNeuronResult(deck, val, pool) {
  const el = $('neuronresult');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let h = '<div class="np-name">' + esc(deck.name) + '</div>';
  const secs = [['メイン', deck.main], ['エクストラ', deck.extra], ['サイド', deck.side]];
  for (const [label, codes] of secs) {
    if (!codes.length && label !== 'メイン') continue;
    h += '<div class="np-sec">' + label + '（' + codes.length + '枚）</div><div class="np-cards">' +
      neuronGroupLines(codes, deck.names).map(esc).join('、') + '</div>';
  }
  if (deck.side.length) h += '<div class="np-pt">※サイドデッキは対戦では使いませんが、ポイント判定には含めています</div>';
  h += '<div class="np-pt">ポイント合計：' + val.totalPt + 'pt（上限100pt）</div>';
  if (!val.ok) {
    h += '<div class="np-ng">このデッキは使えません</div><ul>';
    for (const v of val.violations) {
      h += '<li>' + esc(v.text);
      if (v.items && v.items.length) h += '<div class="np-items">' + v.items.map(esc).join('、') + '</div>';
      h += '</li>';
    }
    h += '</ul>';
  } else if (!pool.ok) {
    h += '<div class="np-warn">Genesisには適合していますが、このアプリでは未対応のカードが含まれています（対戦はまだできません）</div>' +
      '<div class="np-sec">未対応のカード</div><div class="np-items">' + pool.unsupported.map(u => esc(u.name)).join('、') + '</div>';
  } else {
    h += '<div class="np-ok">Genesis適合 ― そのまま対戦できます</div>';
  }
  el.innerHTML = h;
}
// ---- URL import (user spec 2026-11-04: pasting the link is
// enough). The official hosts (neuron.konami.net and
// db.yugioh-card.com) send no CORS headers — verified in a real
// browser from the app's own origin — so a direct fetch always
// fails and the chain then tries public CORS relays in order.
// Every payload is content-checked before use (a real deck page
// carries input.link_value rows), so a relay answering with the
// Neuron app stub or an error page never counts as success. The
// relays are third-party services that can stop without notice;
// when the whole chain fails the panel says so plainly and
// points at the copy-paste fallback instead of failing silently.
//
// Robustness round (2026-11-04, after a real-device total
// failure at 08:35): every candidate relay was re-measured from
// the app's own origin in a real Chromium (full table in
// NOTES.md). Only routes that have actually delivered a deck
// page are in the chain. Design: 20s per attempt, up to 2 rounds
// over the route list with a 3s pause, one 150s deadline shared
// by both hops, and progress callbacks so the panel shows which
// route is being tried. Failures are classified by what the
// relays actually returned:
//   - 'deck' / 'searchlink': usable payloads (success paths).
//   - 'page': a relay DID answer with a real page that is not a
//     deck page. A private deck's share link resolves server-side
//     to the Neuron top page, so when two different routes agree
//     on a non-deck page the chain stops early and the panel
//     reports the link itself (private deck is the main cause)
//     instead of blaming the relays.
//   - nothing usable at all: the relays did not answer; the
//     panel keeps the relay explanation + paste fallback.
const NEURON_FETCH_TIMEOUT_MS = 20000;
const NEURON_FETCH_ROUNDS = 2;
const NEURON_FETCH_ROUND_PAUSE_MS = 3000;
const NEURON_FETCH_BUDGET_MS = 150000;
const NEURON_ROUTES = [
  { id: 'direct', wrap: u => u }, // expected to fail by CORS today; kept first so a future ACAO header just works
  { id: 'allorigins-raw', wrap: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) }, // measured working 2026-11-04 (follows the share link's redirect to the deck page)
  { id: 'codetabs', wrap: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) }, // measured working 2026-11-04
  { id: 'allorigins-get', wrap: u => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u) }, // same service as raw, JSON envelope; a differently-shaped request when raw is refused
];
async function neuronFetchOnce(url, timeoutMs) {
  const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const to = ctl ? setTimeout(() => ctl.abort(), timeoutMs || NEURON_FETCH_TIMEOUT_MS) : null;
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r) return { kind: 'error' };
    const text = await r.text().catch(() => '');
    return { kind: r.ok ? 'ok' : 'http', status: r.status, text };
  } catch (e) {
    return { kind: (e && e.name === 'AbortError') ? 'timeout' : 'error' };
  } finally { if (to) clearTimeout(to); }
}
function neuronUnwrapEnvelope(t) {
  if (t && t.includes('"contents"')) { // allorigins /get envelope
    try { const j = JSON.parse(t); if (j && typeof j.contents === 'string') return j.contents; } catch (e) {}
  }
  return t;
}
function neuronLooksLikeDeckHtml(t) {
  return !!t && t.includes('link_value') && t.includes('cid=') && /(monster_list|spell_list|extra_list)/.test(t);
}
function neuronExtractMemberDeckUrl(html) {
  const re = /member_deck\.action\?([^"'<>\s]+)/g;
  let mm;
  while ((mm = re.exec(html))) {
    const q = mm[1].replace(/&amp;/g, '&');
    const cg = /(?:^|&)cgid=([a-f0-9]{32})/.exec(q), dn = /(?:^|&)dno=(\d+)/.exec(q);
    if (cg && dn) return 'https://www.db.yugioh-card.com/yugiohdb/member_deck.action?ope=1&cgid=' + cg[1] + '&dno=' + dn[1];
  }
  return null;
}
// Classify one answered payload. 'junk' covers error bodies,
// rate-limit notices, app stubs and empty answers — none of them
// say anything about the target link, so the chain keeps trying.
function neuronClassifyPayload(t) {
  if (!t) return 'junk';
  if (neuronLooksLikeDeckHtml(t)) return 'deck';
  if (neuronExtractMemberDeckUrl(t)) return 'searchlink';
  if (/<html[\s>]/i.test(t) && t.length > 4000) return 'page';
  return 'junk';
}
async function neuronFetchViaChain(targetUrl, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress || null;
  const deadline = opts.deadline || (Date.now() + NEURON_FETCH_BUDGET_MS);
  const routes = opts.preferredRoute
    ? [opts.preferredRoute, ...NEURON_ROUTES.filter(r => r !== opts.preferredRoute)]
    : NEURON_ROUTES;
  let sawPage = false;
  const pageRoutes = new Set();
  for (let round = 1; round <= NEURON_FETCH_ROUNDS; round++) {
    for (let i = 0; i < routes.length; i++) {
      const remain = deadline - Date.now();
      if (remain <= 0) return { ok: false, sawPage };
      const route = routes[i];
      if (onProgress) onProgress({ index: i + 1, total: routes.length, round });
      const res = await neuronFetchOnce(route.wrap(targetUrl), Math.min(NEURON_FETCH_TIMEOUT_MS, remain));
      if (res.kind !== 'ok' && res.kind !== 'http') continue;
      const text = neuronUnwrapEnvelope(res.text || '');
      const cls = neuronClassifyPayload(text);
      if (cls === 'deck' || cls === 'searchlink') return { ok: true, text, route, cls };
      if (cls === 'page') {
        // Two DIFFERENT routes returning a real non-deck page is
        // conclusive about the link (the relays are only
        // couriers); stop instead of burning the whole budget.
        sawPage = true; pageRoutes.add(route.id);
        if (pageRoutes.size >= 2) return { ok: false, sawPage };
      }
    }
    if (round < NEURON_FETCH_ROUNDS && deadline - Date.now() > 0)
      await new Promise(r => setTimeout(r, NEURON_FETCH_ROUND_PAUSE_MS));
  }
  return { ok: false, sawPage };
}
async function neuronFetchDeckHtml(startUrl, onProgress) {
  const deadline = Date.now() + NEURON_FETCH_BUDGET_MS;
  const first = await neuronFetchViaChain(startUrl, { onProgress, deadline });
  if (first.ok && first.cls === 'deck') return { ok: true, html: first.text };
  if (first.ok && first.cls === 'searchlink') {
    // a deck-search result page (or any page) that links the deck:
    // follow the embedded member_deck URL once, trying first the
    // relay that just answered (it is the likeliest to answer
    // again right now).
    const next = neuronExtractMemberDeckUrl(first.text);
    if (next && next !== startUrl) {
      const second = await neuronFetchViaChain(next, { onProgress, deadline, preferredRoute: first.route });
      if (second.ok && second.cls === 'deck') return { ok: true, html: second.text };
      return { ok: false, reason: second.sawPage ? 'notdeck' : 'noanswer' };
    }
  }
  return { ok: false, reason: first.sawPage ? 'notdeck' : 'noanswer' };
}
function neuronSaveRecord(rec) {
  while (SAVED_DECKS['saved:' + rec.id]) rec = Object.assign({}, rec, { id: rec.id + 'x' });
  savedDeckList.push(rec);
  SAVED_DECKS['saved:' + rec.id] = rec;
  try { if (window.NeuronLib) NeuronLib.storeSavedDecks(localStorage, savedDeckList); } catch (e) {}
  renderSavedDecks();
  selectMyDeck('saved:' + rec.id);
  return rec;
}
function neuronPresentResult(parsed, autoSave) {
  const resEl = $('neuronresult');
  const saveBtn = $('neuronsave');
  if (!parsed.ok) {
    resEl.innerHTML = '<div class="np-err">読み込めませんでした</div><ul>' + parsed.errors.map(e => '<li>' + e.replace(/</g, '&lt;') + '</li>').join('') + '</ul>';
    return;
  }
  const deck = parsed.deck;
  if (!deck.name) deck.name = neuronProvisionalName();
  const val = NeuronLib.validateGenesis(deck);
  const pool = NeuronLib.poolCheck(deck, new Set(Object.keys(DATA.cards).map(Number)));
  renderNeuronResult(deck, val, pool);
  if (!val.ok) return;
  const rec = NeuronLib.makeRecord(deck, val, pool);
  if (autoSave) {
    neuronSaveRecord(rec);
    resEl.insertAdjacentHTML('beforeend', '<div class="np-pt">判定が終わり、自動で保存しました（デッキ選択の「保存したデッキ」にあります）</div>');
  } else {
    neuronPending = rec;
    saveBtn.textContent = pool.ok ? '保存する' : '保存する（対戦はまだできません）';
    saveBtn.style.display = '';
  }
}
async function neuronDoParse() {
  const resEl = $('neuronresult');
  const saveBtn = $('neuronsave');
  saveBtn.style.display = 'none'; neuronPending = null;
  if (!window.NeuronLib) { resEl.innerHTML = '<div class="np-err">取り込み機能が読み込めていません</div>'; return; }
  const parseBtn = $('neuronparse');
  parseBtn.disabled = true; parseBtn.textContent = '読み込み中…';
  const finishBtn = () => { parseBtn.disabled = false; parseBtn.textContent = '読み込む'; };
  const okd = await ensureGenesysData();
  if (!okd) { finishBtn(); resEl.innerHTML = '<div class="np-err">カードデータ（genesys-data.json）を読み込めませんでした。通信環境を確認してください</div>'; return; }
  if (!DATA) { finishBtn(); resEl.innerHTML = '<div class="np-err">カードデータの読み込みが終わっていません</div>'; return; }
  const rawText = $('neurontext').value;
  // A URL (or a bare deck code) only counts as the URL flow when
  // it is essentially the whole input — a pasted HTML page also
  // CONTAINS official URLs and must stay on the paste path.
  const url = rawText.trim().length <= 500 ? NeuronLib.extractImportUrl(rawText) : null;
  const code = !url && NeuronLib.isDeckCode(rawText) ? rawText.trim() : null;
  if ((url || code) && neuronUrlFetchRunning) { finishBtn(); return; } // a URL fetch is already in flight; never run two chains over one panel
  if (url || code) {
    neuronUrlFetchRunning = true;
    const startUrl = url || NeuronLib.deckCodeSearchUrl(code);
    const showProgress = (p) => {
      resEl.innerHTML = '<div class="np-pt">公式デッキページを取得しています…（中継経路 ' + p.index + '/' + p.total + (p.round > 1 ? '・' + p.round + '回目' : '') + '。外部の中継サービス経由のため、時間がかかることがあります）</div>';
    };
    showProgress({ index: 1, total: NEURON_ROUTES.length, round: 1 });
    const got = await neuronFetchDeckHtml(startUrl, showProgress);
    neuronUrlFetchRunning = false;
    finishBtn();
    if (!got.ok) {
      if (got.reason === 'notdeck') {
        resEl.innerHTML = '<div class="np-err">リンク先からデッキを取得できませんでした</div>' +
          '<div class="np-pt">共有リンクの飛び先がデッキページではありませんでした。デッキが非公開だと取り込めません。ニューロンでデッキを公開設定にしてから、リンクを貼り直してください（取り込みが終われば、非公開に戻して構いません）。公開済みの場合は、リンクが正しいか確認してください。</div>';
      } else {
        resEl.innerHTML = '<div class="np-err">デッキページを取得できませんでした</div>' +
          '<div class="np-pt">公式サイトはアプリからの直接の取得を許可していないため、外部の中継サービス経由で取得を試しましたが、応答がありませんでした。中継サービスは予告なく止まることがあります。時間をおいて再度お試しいただくか、リンクをブラウザで開いてページ全体を選択コピーし、ここに貼り付けてください（そのまま読み込めます）。</div>';
      }
      return;
    }
    neuronPresentResult(NeuronLib.parseImport(got.html, (h) => new DOMParser().parseFromString(h, 'text/html')), true);
    return;
  }
  finishBtn();
  neuronPresentResult(NeuronLib.parseImport(rawText, (h) => new DOMParser().parseFromString(h, 'text/html')), false);
}
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
// ---- hidden candidates in selection prompts (user report
// 2026-11-04: a target-selection grid showed the opponent's set
// cards with their names and art). The engine strips the code of
// such entries before delivery (maskPromptForHuman); this predicate
// is the render-side twin, so a candidate list that still carries a
// code is masked here too. A candidate is hidden when its identity
// is not public information for the viewer: an opponent's face-down
// field / Extra card, or an opponent hand / deck card. The one
// legal exception is shared with the engine: 墓穴の道連れ's own
// effect reveals both hands before the choice (context code), so
// its candidates stay visible. One's OWN face-down cards are never
// hidden — the owner knows them.
const HAND_DESTRUCTION_CODE = 16435215;
function selCardHidden(e, prompt) {
  if (!e) return false;
  if (e.code == null) return true; // no identity delivered, nothing to show
  if (e.con == null || e.con === HP) return false;
  if (prompt && prompt.context && prompt.context.code === HAND_DESTRUCTION_CODE) return false;
  if (e.loc === E.LOC.HAND || e.loc === E.LOC.DECK) return true;
  if ((e.loc === E.LOC.MZONE || e.loc === E.LOC.SZONE || e.loc === E.LOC.EXTRA) && e.pos != null && !(e.pos & E.POS_FACEUP)) return true;
  return false;
}
// Public-only label for a hidden candidate: which slot it sits in is
// table information (the loc line already says it); for a face-down
// monster its position form is public too (the board shows it).
function hiddenCardLabel(e) {
  if (!e) return '裏側のカード';
  if (e.loc === E.LOC.MZONE) {
    if (e.pos != null && (e.pos & E.POS.FD_ATK)) return '裏側のモンスター（攻撃表示）';
    if (e.pos != null && (e.pos & E.POS.FD_DEF)) return '裏側のモンスター（守備表示）';
    return '裏側のモンスター';
  }
  if (e.loc === E.LOC.SZONE) return '裏側のカード';
  if (e.loc === E.LOC.HAND) return '相手の手札のカード';
  if (e.loc === E.LOC.DECK) return '相手のデッキのカード';
  if (e.loc === E.LOC.EXTRA) return '相手のEXデッキのカード';
  return '裏側のカード';
}
function isMonster(code) { const d = cardData(code); return d && (d.type & 0x1); }
// card-kind (original frame) key, derived mechanically from the core
// type bitmask in data.json (cards[code].type) — no per-card hand
// assignment, so every card in the pool is covered (user request
// 2026-11-03: kind colors on the name band). Priority: spell/trap,
// then the extra-deck kinds, ritual, plain normal (TYPE_NORMAL
// without TYPE_EFFECT); any other monster is an effect monster.
// '' when the card is unknown, so unclassed bands keep today's look.
function cardKind(code) {
  const d = cardData(code); if (!d) return '';
  const t = d.type | 0;
  if (t & 0x2) return 'spell';
  if (t & 0x4) return 'trap';
  if (t & 0x40) return 'fusion';
  if (t & 0x2000) return 'synchro';
  if (t & 0x800000) return 'xyz';
  if (t & 0x80) return 'ritual';
  if ((t & 0x10) && !(t & 0x20)) return 'normal';
  if (t & 0x1) return 'effect';
  return '';
}
function kindCls(code) { const k = cardKind(code); return k ? ' k-' + k : ''; }
function statsLine(code) {
  const d = cardData(code); if (!d || !(d.type & 0x1)) return '';
  return '攻' + d.atk + '／守' + d.def;
}
function cardText(code) { return (DATA && DATA.texts && DATA.texts[code]) ? DATA.texts[code].text : ''; }
// ---- which effect is being asked about (user report 2026-11-03:
//    a confirmation that does not say WHICH effect is a defect) ----
// The core identifies the effect behind every activatable entry and
// most yes/no questions with its description string id. In this
// build's bundled scripts (data.json utility.lua) the id is
//   aux.Stringid(code, idx) = code<<20 | idx     (idx = 0-based)
// where idx is the SAME index the script passes to SetDescription,
// and script practice registers ONE description per activatable
// effect, in effect order — so desc index n names official text
// effect n+1 (verified live over 12 seeded duels: 1330 activatable
// entries, desc code always equalled the entry's card, idx always
// named an existing numbered segment; see NOTES). desc == 0 means
// "no description set" (single implicit effect) and small descs are
// core system strings — neither misidentifies, neither resolves.
function descEffect(desc) {
  if (desc == null || desc === 0) return null;
  const code = Math.floor(desc / 1048576), idx = desc % 1048576;
  if (code === 0 || idx >= 16 || !DATA || !DATA.cards[code]) return null;
  return { code, idx };
}
const CIRCLED_NUM = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯';
function effectSegments(code) { // [{n, body}] split of the official text on ①：-style markers
  const t = cardText(code).replace(/[\r\n]+/g, '\n');
  const out = [];
  const re = /([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯])：/g;
  let m, last = null;
  while ((m = re.exec(t))) {
    if (last) out.push({ n: last.n, body: t.slice(last.end, m.index).trim() });
    last = { n: CIRCLED_NUM.indexOf(m[1]) + 1, end: m.index + m[0].length };
  }
  if (last) out.push({ n: last.n, body: t.slice(last.end).trim() });
  return out;
}
// The desc-index -> printed-effect-number correspondence is NOT
// universally idx+1 (printed continuous effects own no description,
// so the indices shift). fxmap.json (derived by gen-fxmap.js from
// the bundled scripts + official texts, audited per card) says, per
// card: {id:1} = identity is proven for this card, {map:{idx:n}} =
// hand-audited override, {n} = count of described activatable
// indices (for the follow-up rule below). Cards absent from fxmap
// (or an fxmap that failed to load) get NO effect number anywhere —
// the full text is shown instead of a possibly wrong number.
let FXMAP = {};
// Resolve (entry code, desc) to the effect the prompt is about:
//   {n, body}        the numbered effect itself
//   {follow:true}    desc index == the count of described effects:
//                    the core's yes/no for the optional follow-up
//                    clause of the effect now resolving (its desc is
//                    registered one past the described effects)
//   null             cannot be pinned — callers fall back to the
//                    full text, never to a guessed effect
function resolveEffect(code, desc) {
  const de = descEffect(desc);
  if (!de || de.code !== code) return null;
  const m = FXMAP[code];
  if (!m) return null;
  const segs = effectSegments(code);
  // A mapped/identity index names its effect outright — checked
  // FIRST (pool-coverage round): a hand-audited map may sit on an
  // index equal to m.n (Pluto's only described idx is 1 with n=1),
  // and such an index is a real activation, never a follow-up.
  let n = 0;
  if (m.map) n = m.map[de.idx] || 0;
  else if (m.id && de.idx < m.n) n = de.idx + 1;
  if (n) {
    const seg = segs.find(s => s.n === n);
    if (seg) return { n: seg.n, body: seg.body };
  }
  // follow-up yes/no (index == the card's described-effect count).
  // Only for cards whose mapped effects exist at all: when a card
  // has described-but-unnumbered indices (collisions, fxmap "n"
  // without id/map), an index at the boundary cannot be trusted
  // either, so it stays unidentified like every other index there.
  if (de.idx === m.n && (m.id || m.map)) return { follow: true };
  return null;
}
// Prompt-scoped resolution (pool-coverage round) — two audited
// extensions resolveEffect deliberately does not guess at:
//   pmap: one desc idx naming DIFFERENT effects per prompt scope
//     (Masterflare Hyperion registers idx 0 twice — its IGNITION
//     copy effect, only ever an idle/battle command entry, and
//     its QUICK_O EVENT_CHAINING effect, only ever a chain
//     candidate; the script's effect types keep the scopes
//     disjoint by construction).
//   bare: a desc-LESS entry pinned by (location, scope) when the
//     script leaves exactly one activatable effect there
//     (Minerva / Pluto / Zorga — fxmap "bare", hand-audited in
//     gen-fxmap.js). scope is 'idle' (IDLECMD/BATTLECMD entries)
//     or 'chain' (SELECT_CHAIN candidates and chain links).
function scopedEffect(code, desc, loc, scope) {
  const m = FXMAP[code];
  if (!m) return null;
  const segs = effectSegments(code);
  const de = descEffect(desc);
  if (de && de.code === code && m.pmap) {
    const pm = m.pmap[de.idx];
    const n = pm ? (pm[scope] || 0) : 0;
    if (n) { const seg = segs.find(s => s.n === n); if (seg) return { n: seg.n, body: seg.body }; }
  }
  // bare pinning: the prompt/entry carries NO usable description
  // — desc is 0, or a small non-Stringid value (Minerva's real
  // EFFECTYN arrives with desc=221, captured from the core), or
  // otherwise undecodable against this card. A desc that DOES
  // decode to this card's own Stringid stands on its own merits
  // (resolveEffect / pmap above) and never reaches here.
  if (!de && m.bare) {
    const b = m.bare.find(x => x.loc === loc && (x.scope === scope || x.scope === 'any'));
    if (b) { const seg = segs.find(s => s.n === b.n); if (seg) return { n: seg.n, body: seg.body }; }
  }
  return null;
}
// A plain SELECT_YESNO whose desc the fxmap "yn" table pins to
// the optional follow-up clause of one printed effect: the
// script's only SelectYesNo carrying that idx lives inside that
// effect's operation (Minerva ②'s optional destruction, Heavy
// Magical Tank ③'s optional destruction, Agido ②'s second mill).
function resolveYesNo(code, desc) {
  const de = descEffect(desc);
  if (!de || de.code !== code) return null;
  const m = FXMAP[code];
  if (!m || !m.yn) return null;
  const n = m.yn[de.idx];
  if (!n) return null;
  const seg = effectSegments(code).find(s => s.n === n);
  return seg ? { follow: true, n: seg.n, body: seg.body } : null;
}
// A follow-up question whose desc belongs to a shared helper's
// string table rather than to the asking card (the Vernusylph
// family's resolution asks its optional special summon with
// Stringid(9350312, 1)): the RESOLVING link pins the parent
// effect, and the parent's own text carries the 「その後、…できる」
// step — the only optional step a mid-resolution yes/no can ask
// about inside that effect in this pool. Since the v11 recipe
// swap the string-base card (9350312) is itself in the pool, so
// its descs now DECODE — they are still foreign when a DIFFERENT
// Vernusylph card is the one resolving; a desc of the asking
// card itself stands or falls on its own merits, as does a desc
// decoding to any unrelated card.
const VERN_STRING_BASE = 9350312; // 丘と芽吹の春化精 (helper string table owner)
function foreignFollowFx(ctx, prompt) {
  if (!prompt.desc) return null;
  const de = descEffect(prompt.desc);
  if (de && de.code === ctx.code) return null; // the asking card's own desc: not foreign
  if (de && de.code !== VERN_STRING_BASE) return null; // decodable elsewhere: not the shared-helper case
  const parent = resolveEffect(ctx.code, ctx.desc);
  if (!parent || !parent.n) return null;
  if (!stepClause(ctx.code, parent.n)) return null;
  return { follow: true };
}
// The clause a follow-up yes/no asks about: the 「その後、…できる」
// sentence of the effect now resolving. Every follow-up observed
// in this pool (Mudora/Kelbek/the Trap spider, desc index == the
// described-effect count in each case) asks exactly that, and for
// each of those cards the LAST 「その後…できる」 sentence of the
// text is the clause its prompt carries. When a card has none, the
// fallback is the last 「〜できる」 sentence; '' when neither
// exists (the block then says it is the resolving effect's
// follow-up without quoting a clause).
function followUpClause(code) {
  const sentences = cardText(code).split('。').map(s => s.trim()).filter(Boolean);
  const steps = sentences.filter(s => s.includes('その後') && s.includes('できる'));
  const opt = steps.length ? steps : sentences.filter(s => s.includes('できる'));
  const s = opt.length ? opt[opt.length - 1] : '';
  if (!s) return '';
  return s.length > 72 ? s.slice(0, 72) + '…' : s;
}
// The 「その後、…できる」 step clause INSIDE one numbered effect's
// own text (a follow-up question's parent effect), '' when that
// effect carries no such clause.
function stepClause(code, n) {
  const seg = effectSegments(code).find(s => s.n === n);
  if (!seg) return '';
  const s = seg.body.split('。').map(x => x.trim()).filter(x => x.includes('その後') && x.includes('できる'));
  const out = s.length ? s[s.length - 1] : '';
  return out.length > 72 ? out.slice(0, 72) + '…' : out;
}
function fxExcerpt(fx) { // one-line preview of an effect body
  const s = (fx.body || '').replace(/\s+/g, ' ');
  return s.length > 28 ? s.slice(0, 28) + '…' : s;
}
// BU-28: whether fxExcerpt actually cut anything — the chain
// dock prints its guide to the full text only when it did, so
// the truncation is never silent.
function fxTruncated(fx) {
  const s = (fx.body || '').replace(/\s+/g, ' ');
  return s.length > 28;
}
// The effect behind a prompt ENTRY (chain candidate / command
// activation): resolveEffect first; when the core sends NO desc
// for a Spell/Trap entry, the entry IS the card activation itself
// (the ACTIVATE block of these cards carries no SetDescription —
// census-verified: every desc-less S/T entry in this pool is a
// fresh activation, and every effect activation carries a desc).
// A Spell/Trap's activation effect is its FIRST numbered segment,
// labelled as the activation rather than as a resolved number.
function entryEffect(e, scope) {
  const fx = resolveEffect(e.code, e.desc) || scopedEffect(e.code, e.desc, e.loc, scope || 'idle');
  if (fx) return fx;
  if (!e.desc) {
    const d = cardData(e.code);
    if (d && (d.type & 0x6)) { // Spell or Trap card
      const seg = effectSegments(e.code)[0];
      if (seg) return { n: seg.n, body: seg.body, act: true };
    }
  }
  return null;
}
// The highlight block: the asked-about effect alone, with its
// number, over the full card text in a dimmer role (the full text
// stays so nothing is hidden; the eye is told where to look).
function fxBlockHTML(code, fx) {
  const segBody = fx ? (fx.follow ? followUpClause(code) : (fx.body || '')) : '';
  if (!segBody) return cardText(code) ? '<div class="cardtext">' + cardText(code) + '</div>' : '';
  const head = fx.follow
    ? '<div class="fxlab">この後、追加で選べる処理</div>'
    : fx.act
      ? '<div class="fxlab">発動する効果（このカードの発動）</div>'
      : '<div class="fxlab">聞かれている効果：' + CIRCLED_NUM[fx.n - 1] + '</div>';
  return head + '<div class="cardtext fxmain">' + segBody + '</div>' +
    (cardText(code) ? '<details class="fxfull"><summary>カード全体のテキスト</summary><div class="cardtext">' + cardText(code) + '</div></details>' : '');
}
// Name as the dismissal manager shows it: with the effect number
// when the dismissed class is one specific effect of the card.
// Dismissals live on chain prompts, so the resolution is
// chain-scoped (Hyperion's dismissed class is its ②); a bare card
// activation (fx.act) carries no number, as before.
function dismissalName(e) {
  const fx = entryEffect(e, 'chain');
  return cardName(e.code) + (fx && fx.n && !fx.act ? ' の効果' + CIRCLED_NUM[fx.n - 1] : '');
}
function isXyzCode(code) { const d = cardData(code); return !!(d && (d.type & 0x800000)); }
function cardMetaLine(code, mats) {
  const d = cardData(code); if (!d) return '';
  const parts = [];
  const attr = E.ATTRIBUTES.find(([b]) => b === d.attribute); if (attr) parts.push(attr[1] + '属性');
  const race = E.RACES.find(([b]) => BigInt(b) === BigInt(d.race)); if (race && (d.type & 0x1)) parts.push(race[1] + '族');
  if (d.type & 0x1) parts.push(isXyzCode(code) ? 'ランク' + d.level : 'レベル' + d.level);
  if (isXyzCode(code) && mats != null) parts.push('素材×' + mats); // Minerva item: the count is information, not decoration
  return parts.join('／');
}
function liveMats(con, loc, seq) {
  if (!duelState || loc !== E.LOC.MZONE) return null;
  const c = duelState.players[con] && duelState.players[con].mzone[seq];
  return c ? (c.materials || 0) : null;
}
// Source context of a prompt (Phase 2 item 1): the chain link whose effect is
// asking. Attached by the engine driver from the core's CHAINING stream.
function contextLineHTML(prompt) {
  const ctx = prompt && prompt.context;
  if (!ctx) return '';
  // Name the effect number too when the asking link's desc pins it
  // (same wording everywhere a context line appears).
  const fx = resolveEffect(ctx.code, ctx.desc);
  const what = fx && fx.n ? '」の効果' + CIRCLED_NUM[fx.n - 1] : '」の効果';
  return '<div class="ctx">「' + cardName(ctx.code) + what + 'による確認（' + locLabel(ctx) + '）</div>';
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
try { const savedAudio = localStorage.getItem('v2audio'); if (savedAudio != null) audioOn = savedAudio === '1'; } catch (e) {}
function saveAudioPref() { try { localStorage.setItem('v2audio', audioOn ? '1' : '0'); } catch (e) {} }
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
// ---------------------------------------------------------------- activation locks (Minerva 3rd triage, 2026-11-03)
// Some effects lock the activating player out of monster-effect
// activations for the rest of the turn except one attribute — in
// this pool the Vernusylph hand effects: 「このターン、自分は○属性
// 以外のモンスターの効果を発動できない」. The core then CORRECTLY
// omits a blocked ignition from SELECT_IDLECMD (a LIGHT Minerva
// Xyz-summoned after a Vernusylph effect fired simply has no 発動
// action — no engine or parser bug; the first two triages missed
// it because their reproductions never played the Vernusylph
// line). But the action sheet could only answer with the generic
// 「今は発動できません」, because the reason lives in ANOTHER
// card's text. The lock is mechanically knowable: the restricting
// cards are derived from the pool's own card texts, and
// activations arrive on the same presentation event stream BGM
// uses. Track the human's lock for the turn and let the sheet
// state the real reason. (The stage-4 rule stands: a reason is
// shown only when it is mechanically certain — anything else
// keeps the generic form.)
const LOCK_ATTR_BY_KANJI = { '地': 1, '水': 2, '炎': 4, '風': 8, '光': 16, '闇': 32, '神': 64 };
let _lockCards = null; // Map code -> {attr, kanji}, derived from DATA.texts on first use
function lockCards() {
  if (_lockCards) return _lockCards;
  _lockCards = new Map();
  if (DATA && DATA.texts) {
    for (const code of Object.keys(DATA.texts)) {
      const t = DATA.texts[code];
      const m = t && t.text && t.text.match(/このターン、自分は([地水炎風光闇神])属性以外のモンスターの効果を発動できない/);
      if (m) _lockCards.set(+code, { attr: LOCK_ATTR_BY_KANJI[m[1]], kanji: m[1] });
    }
  }
  return _lockCards;
}
let monsterLock = null; // {attr, kanji, turnCount, code} — the human player's lock for this turn; code = the card whose effect imposed it
function noteMonsterLock(ev, state) {
  if (ev.kind !== 'activate' || ev.con !== HP || !state) return;
  const lk = lockCards().get(ev.code);
  if (lk) monsterLock = { attr: lk.attr, kanji: lk.kanji, turnCount: state.turnCount, code: ev.code };
}
// The reason the sheet may state for `code` right now, or null
// when no tracked lock explains a missing activation. The turn
// defaults to the live duel state; tests may pass it explicitly.
function monsterLockReason(code, turnCount) {
  if (!monsterLock) return null;
  const tc = turnCount != null ? turnCount : (duelState ? duelState.turnCount : null);
  if (tc == null || tc !== monsterLock.turnCount) return null;
  const d = cardData(code);
  if (!d || !(d.type & 0x1)) return null;            // monsters only
  if (d.attribute === monsterLock.attr) return null; // the excepted attribute is unaffected
  // Name the source (user direction 2026-11-03): a bare restriction
  // still leaves the player guessing WHICH card is holding them.
  // The latch records the imposing card's code, so the name is as
  // mechanically certain as the lock itself. If the name somehow
  // does not resolve, keep the unnamed form rather than printing a
  // raw code. (The latch is keyed on the activating event + code,
  // so a future lock imposed by the OPPONENT's card can ride the
  // same record — only the derivation/latch conditions would grow.)
  const src = monsterLock.code != null ? cardName(monsterLock.code) : null;
  const named = src && src[0] !== '#';
  return (named ? '《' + src + '》の効果の制約で、' : '') +
    'このターンは' + monsterLock.kanji + '属性以外のモンスター効果を発動できません';
}
// Test surface (same spirit as window.__bgm): lets the jsdom harness
// observe the derived lock set and drive the tracker with synthetic
// events — the same functions the duel flow itself calls.
window.__mlock = {
  cards() { return [...lockCards().entries()].map(([code, v]) => ({ code, attr: v.attr, kanji: v.kanji })); },
  note(ev, state) { noteMonsterLock(ev, state); },
  reason(code, turnCount) { return monsterLockReason(code, turnCount); },
  get active() { return monsterLock; },
  reset() { monsterLock = null; },
};
// ---- pool-coverage round: cannot-activate reasons, generalized ----
// The Minerva fix answered ONE card's silence. The same silence
// covers every card whose activation the engine does not offer:
// the sheet showed a greyed row only for the attribute lock and
// for Xyz detach/mill patterns, and nothing at all otherwise.
// The trackers below keep the same discipline — a reason is
// stated only when it is mechanically certain — and generalize
// the coverage to the whole pool:
//   (1) activations the HUMAN chained this turn are recorded from
//       the chain links themselves (desc-resolved, chain-scoped),
//       so a card-name once-per-turn clause that is already spent
//       can be stated as the reason (optUsedReason);
//   (2) a monster special summoned by 《死者蘇生》 this turn is
//       latched from the presentation event batch (its printed
//       rider forbids its effects for the turn — and names the
//       source, like the attribute lock does).
// What stays UNSTATED, by design: "no valid target", phase and
// timing windows, and any blocker whose evidence is not in the
// client's own records. Those keep the generic row (shown when
// the card provably HAS a field-activatable effect) or silence.
let usedFxTurn = -1;
const usedFxByCode = new Map(); // code -> {n:Set<number>, any:boolean}
let usedFxChainEpoch = 0, usedFxSeen = new Set();
function trackUsedFx(state) {
  if (!state) return;
  if (state.turnCount !== usedFxTurn) { usedFxTurn = state.turnCount; usedFxByCode.clear(); }
  if (!state.chain || !state.chain.length) { usedFxSeen = new Set(); usedFxChainEpoch++; return; }
  state.chain.forEach((l, i) => {
    const key = usedFxChainEpoch + '|' + i + '|' + l.code + '|' + (l.desc || 0);
    if (usedFxSeen.has(key)) return;
    usedFxSeen.add(key);
    if (l.con === HP) usedNamesDuel.add(l.code); // duel-scope card-name limits (brushup round 2 block below)
    if (l.con !== HP) return;
    let rec = usedFxByCode.get(l.code);
    if (!rec) { rec = { n: new Set(), any: false }; usedFxByCode.set(l.code, rec); }
    rec.any = true;
    // pmap cards (Hyperion) register one desc idx for two effects
    // of disjoint types: the ignition always OPENS its chain
    // (index 0), the quick effect always responds (index >= 1) —
    // attribute by position. All other cards resolve chain-side.
    const fxm = FXMAP[l.code];
    const scope = fxm && fxm.pmap ? (i === 0 ? 'idle' : 'chain') : 'chain';
    const fx = entryEffect({ code: l.code, desc: l.desc, loc: l.loc }, scope);
    if (fx && fx.n && !fx.act) rec.n.add(fx.n);
  });
}
// Printed numbers a card-name once-per-turn clause covers, parsed
// from the official text (「このカード名の①②の効果はそれぞれ
// １ターンに１度しか使用できない」 / 「…の②の効果は１ターンに
// １度しか使用できない」 / 「このカード名の効果は１ターンに
// １度しか使用できない」 = every numbered effect).
// The card's own once-per-turn clause, parsed from the official
// text: which printed numbers it covers, and whether the limit
// is SHARED across them (「１ターンに１度、いずれか１つしか
// 使用できない」, or the whole-card form このカード名の効果は…)
// or PER-EFFECT (「それぞれ１ターンに１度しか使用できない」, or
// a clause naming a single effect). Returns { set, shared } or
// null when the card carries no such clause.
function optCoverage(code) {
  const t = cardText(code);
  const all = new Set(effectSegments(code).map(s => s.n));
  const set = new Set();
  let shared = false, listed = false;
  const re = /このカード名の([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯]+)の効果は([^。]*?)使用できない/g;
  let m;
  while ((m = re.exec(t))) {
    listed = true;
    for (const ch of m[1]) { const n = CIRCLED_NUM.indexOf(ch) + 1; if (all.has(n)) set.add(n); }
    if (/いずれか/.test(m[2])) shared = true;
  }
  if (listed) return set.size ? { set, shared } : null;
  if (/このカード名の効果は１ターンに１度しか使用できない/.test(t)) {
    return all.size ? { set: all, shared: true } : null;
  }
  return null;
}
function optCovered(code) { const c = optCoverage(code); return c ? c.set : new Set(); }
// Numbered effects that can be activated while the card sits
// face-up on the field: the segment says 発動できる, is not
// trigger-phrased (場合に/時に発動できる), and is not bound to
// another location (墓地のこのカード…, 手札…, 除外状態…).
// Text-derived, so the pool test can enumerate it per card.
function fieldCandidates(code) {
  return effectSegments(code).filter(s => {
    const at = s.body.indexOf('発動できる');
    if (at < 0) return false;
    if (/(場合|時)に発動できる/.test(s.body)) return false;
    // a condition clause (〜場合、／〜時、) before the activation
    // wording marks a trigger, not a field ignition (Trilosucuta
    // ①, Luce ③, Sphinx ①③)
    if (/(場合|時)、/.test(s.body.slice(0, at))) return false;
    // an effect whose cost discards THIS card from the hand is a
    // hand effect (the Vernusylph ①s), never usable from the field
    if (/このカード[^。]*を手札から捨てて発動できる/.test(s.body)) return false;
    if (/墓地のこのカード|このカードが墓地に存在|手札のこのカード|このカードが手札に存在|除外状態のこのカード|このカードが除外状態/.test(s.body)) return false;
    return true;
  }).map(s => s.n);
}
// "Already used this turn" is stated ONLY when it fully explains
// the missing activation: every field candidate of the card is
// covered by its once-per-turn clause AND the clause is spent —
// for a per-effect clause that means every candidate is recorded
// as chained this turn; for a shared clause (いずれか１つ), any
// one of them. Anything less could mask a second, different
// blocker, so it stays unstated.
function optUsedReason(code) {
  const cands = fieldCandidates(code);
  if (!cands.length) return null;
  const cov = optCoverage(code);
  if (!cov || !cands.every(n => cov.set.has(n))) return null;
  const rec = usedFxByCode.get(code);
  if (!rec) return null;
  // A shared clause is spent by ANY covered candidate; a
  // per-effect clause only when EVERY candidate is spent.
  const spent = cov.shared ? cands.some(n => rec.n.has(n)) : cands.every(n => rec.n.has(n));
  return spent ? 'このターン既に使用済みです' : null;
}
// The revive rider («この効果で特殊召喚したモンスターは攻撃できず、
// その効果は発動できない») is DERIVED from the pool's texts, like
// the lock / name-limit sets — not hardcoded to one card. No card
// in the current pool carries the rider (《マジックカード「死者
// 蘇生」》 left with the v11 recipe swap, and the classic 《死者
// 蘇生》 that replaced it has no rider), so the latch below never
// arms today; it stays correct for any future pool card whose
// text carries the rider. Deliberately uncached: tests swap DATA.
const REVIVE_RIDER_RE = /この効果で特殊召喚したモンスターは攻撃できず、その効果は発動できない/;
function reviveRiderCode() {
  if (!DATA || !DATA.texts) return null;
  for (const code of Object.keys(DATA.texts)) {
    const t = DATA.texts[code];
    if (t && t.text && REVIVE_RIDER_RE.test(t.text)) return +code;
  }
  return null;
}
let monsterRevived = null; // {seq, code, turnCount, rider} — the human's monster the rider card brought back this turn
// Attribution rule (documented boundary): presentation events
// arrive in per-process batches, and 死者蘇生's activation and
// its summon NEVER share one (chain windows intervene) — so the
// latch is ARMED by the activation and fires on the next own
// special summon while armed. 死者蘇生 summons exactly one
// monster, and in this pool no other effect special summons to
// the human's field while a chain is resolving. The arm dies
// when the chain has fully closed in an earlier batch without
// a summon (negated), when the human activates something else
// first (a chained own effect also lands here — a conservative
// miss), or when the turn moves on. When the evidence is short
// of that shape, nothing is latched (silence, never a wrong
// claim).
let reviveArm = null; // {turnCount, batch}
let reviveBatch = 0;
function noteReviveFromEvents(evs, state) {
  if (!state || !evs) return;
  reviveBatch++;
  const chainLen = state.chain ? state.chain.length : 0;
  const ownAct = evs.filter(e => e.kind === 'activate' && e.con === HP);
  const rider = reviveRiderCode();
  if (rider != null && ownAct.some(e => e.code === rider)) {
    reviveArm = { turnCount: state.turnCount, batch: reviveBatch, code: rider };
  } else if (reviveArm && reviveArm.batch < reviveBatch && ownAct.length) {
    reviveArm = null;
  }
  if (reviveArm && state.turnCount === reviveArm.turnCount) {
    const sums = evs.filter(e => e.kind === 'spsummon' && e.con === HP);
    if (sums.length === 1) {
      const P = state.players && state.players[HP];
      const seq = P ? P.mzone.findIndex(c => c && c.code === sums[0].code) : -1;
      if (seq >= 0) monsterRevived = { seq, code: sums[0].code, turnCount: state.turnCount, rider: reviveArm.code };
      reviveArm = null;
    } else if (sums.length > 1) reviveArm = null;
  }
  // stale arm: its chain closed in an earlier batch (the
  // resolution batch itself already shows an empty chain, which
  // is why the summon check above runs first).
  if (reviveArm && reviveArm.batch < reviveBatch && (chainLen === 0 || state.turnCount !== reviveArm.turnCount)) {
    reviveArm = null;
  }
}
function monsterRevivedReason(code, loc, seq, turnCount) {
  if (!monsterRevived || loc !== E.LOC.MZONE) return null;
  const tc = turnCount != null ? turnCount : (duelState ? duelState.turnCount : null);
  if (tc == null || tc !== monsterRevived.turnCount) return null;
  if (monsterRevived.code !== code || monsterRevived.seq !== seq) return null;
  return '《' + cardName(monsterRevived.rider) + '》の効果で特殊召喚されたため、このターンは効果を発動できません';
}
// ---- brushup round 2: cannot-activate reasons on the OTHER surfaces ----
// The pool-coverage round stated reasons on the FIELD sheet and
// enumerated three groups whose surface is elsewhere (NOTES,
// Pool-wide coverage section 3). This block covers those surfaces
// with the same discipline — text-derived sets, mechanically
// certain evidence only, silence over a guessed reason:
//   (4) card-name activation limits (「このカード名のカードは
//       １ターンに１枚／デュエル中に１枚しか発動できない」) on
//       the HAND surface: the action sheet for a hand card whose
//       activation is spent, and the preview reason line when the
//       card has no offered action at all. Usage evidence is the
//       chain-link record itself (turn scope: usedFxByCode; duel
//       scope: usedNamesDuel, fed by the same tracker).
//   (5) 《巨神封じの矢》-type grave timing (「このカードが墓地へ
//       送られたターンには発動できない」) on the GRAVE pile
//       sheet. Arrival evidence is a multiset diff of the human's
//       own grave across state updates, stamped with the turn —
//       deliberately NOT stamped across an observation that
//       contained identity-less (null) entries, so the deck/grave
//       swap of 《現世と冥界の逆転》 can never mint a false claim.
//       Stamps are per CODE: with several copies in the grave the
//       note marks the code, not the individual copy — and if any
//       copy of a code leaves, the code's stamps drop entirely,
//       because counts cannot say which copy went.
//   (6) Trilosucuta-type EX-summon type locks (「このターン、
//       自分は○モンスターしかEXデッキから特殊召喚できない」)
//       on the EXTRA pile sheet, where EX summons are launched:
//       while the lock is live (the restricting effect sits in
//       this turn's chain-link record), each own EX monster of a
//       blocked type that carries no offered summon action gets
//       the named reason under its row.
let _nameLimitCards = null; // Map code -> 'turn' | 'duel', derived from DATA.texts
function nameLimitCards() {
  if (_nameLimitCards) return _nameLimitCards;
  _nameLimitCards = new Map();
  if (DATA && DATA.texts) {
    for (const code of Object.keys(DATA.texts)) {
      const t = DATA.texts[code];
      if (!t || !t.text) continue;
      if (/このカード名のカードはデュエル中に１枚しか発動できない/.test(t.text)) _nameLimitCards.set(+code, 'duel');
      else if (/このカード名のカードは１ターンに１枚しか発動できない/.test(t.text)) _nameLimitCards.set(+code, 'turn');
    }
  }
  return _nameLimitCards;
}
const usedNamesDuel = new Set(); // codes the human has put on a chain this duel (fed by trackUsedFx)
function nameLimitReason(code) {
  const scope = nameLimitCards().get(code);
  if (!scope) return null;
  if (scope === 'duel') {
    return usedNamesDuel.has(code) ? 'このカード名のカードはデュエル中に１枚しか発動できません' : null;
  }
  const rec = usedFxByCode.get(code);
  return rec && rec.any ? 'このカード名のカードは１ターンに１枚しか発動できません' : null;
}
let _graveSentCards = null; // Map code -> printed number of the segment carrying the clause
function graveSentCards() {
  if (_graveSentCards) return _graveSentCards;
  _graveSentCards = new Map();
  for (const code of Object.keys(DATA && DATA.texts ? DATA.texts : {})) {
    const seg = effectSegments(+code).find(s => /このカードが墓地へ送られたターンには発動できない/.test(s.body));
    if (seg) _graveSentCards.set(+code, seg.n);
  }
  return _graveSentCards;
}
let gravePrev = null; // Map code -> count in the human's grave at the previous observation (null = none yet)
let gravePrevNulls = 0;
let graveStamps = []; // {code, turn} — arrivals of the human's own grave cards
function trackGraveArrivals(state) {
  if (!state || !state.players || !state.players[HP]) return;
  const cur = new Map();
  let nulls = 0;
  for (const c of state.players[HP].grave) {
    if (c == null) { nulls++; continue; }
    cur.set(c, (cur.get(c) || 0) + 1);
  }
  // stamp only across a clean pair of observations: if either side
  // held identity-less entries (post-swap resync window), the diff
  // proves nothing about how a card reached the grave — update the
  // baseline and stay silent.
  if (gravePrev && !gravePrevNulls && !nulls) {
    for (const [code, n] of cur) {
      const before = gravePrev.get(code) || 0;
      for (let i = before; i < n; i++) graveStamps.push({ code, turn: state.turnCount });
    }
  }
  // a departure makes the per-code record ambiguous: counts cannot
  // say WHICH copy left, so if any copy of a code left since the
  // previous observation, drop that code's stamps entirely
  // (silence) rather than risk attributing an arrival turn to a
  // copy that was already in the grave
  const prevCounts = gravePrev;
  gravePrev = cur; gravePrevNulls = nulls;
  if (prevCounts) {
    graveStamps = graveStamps.filter(s => (cur.get(s.code) || 0) >= (prevCounts.get(s.code) || 0));
  }
  // stamps die with the copy that carried them: cap each code's
  // stamps at the number of copies currently in the grave
  const kept = new Map();
  graveStamps = graveStamps.filter(s => {
    const used = kept.get(s.code) || 0;
    if (used >= (cur.get(s.code) || 0)) return false;
    kept.set(s.code, used + 1);
    return true;
  });
}
function graveSentReason(code, turnCount) {
  const n = graveSentCards().get(code);
  if (!n) return null;
  const tc = turnCount != null ? turnCount : (duelState ? duelState.turnCount : null);
  if (tc == null) return null;
  if (!graveStamps.some(s => s.code === code && s.turn === tc)) return null;
  return 'このターンに墓地へ送られたため、' + CIRCLED_NUM[n - 1] + 'の効果は発動できません';
}
const EX_TYPE_TOKENS = [['Sモンスター', 0x2000], ['シンクロモンスター', 0x2000], ['Xモンスター', 0x800000], ['エクシーズモンスター', 0x800000], ['融合モンスター', 0x40], ['リンクモンスター', 0x4000000]];
let _exLockCards = null; // Map code -> {n, typeBit, token} from the segment carrying the clause
function exLockCards() {
  if (_exLockCards) return _exLockCards;
  _exLockCards = new Map();
  for (const code of Object.keys(DATA && DATA.texts ? DATA.texts : {})) {
    for (const seg of effectSegments(+code)) {
      const m = seg.body.match(/このターン、自分は(.+?)しかEXデッキから特殊召喚できない/);
      if (!m) continue;
      const hit = EX_TYPE_TOKENS.find(([tok]) => m[1].indexOf(tok) >= 0);
      if (hit) _exLockCards.set(+code, { n: seg.n, typeBit: hit[1], token: hit[0] });
    }
  }
  return _exLockCards;
}
// The EX-summon type lock in force for the human right now, or
// null: the restricting effect's number sits in this turn's own
// chain-link record (the same evidence optUsedReason trusts).
function exSummonLock() {
  for (const [code, info] of exLockCards()) {
    const rec = usedFxByCode.get(code);
    if (rec && rec.n.has(info.n)) return { code, n: info.n, typeBit: info.typeBit, token: info.token };
  }
  return null;
}
function exLockReason(lock) {
  return '《' + cardName(lock.code) + '》' + CIRCLED_NUM[lock.n - 1] + 'の効果の制約で、このターンは' + lock.token + 'しかEXデッキから特殊召喚できません';
}
// Test surface for the pool-coverage checks (same spirit as __mlock).
window.__poolcov = {
  resolveYesNo, scopedEffect, optCovered, optCoverage, fieldCandidates, optUsedReason,
  trackUsedFx,
  usedFx() { return [...usedFxByCode.entries()].map(([code, r]) => ({ code, n: [...r.n], any: r.any })); },
  noteRevive(evs, state) { noteReviveFromEvents(evs, state); },
  revivedReason(code, loc, seq, tc) { return monsterRevivedReason(code, loc, seq, tc); },
  nameLimitCards() { return [...nameLimitCards().entries()].map(([code, scope]) => ({ code, scope })); },
  nameLimitReason,
  graveSentCards() { return [...graveSentCards().entries()].map(([code, n]) => ({ code, n })); },
  trackGraveArrivals, graveSentReason,
  graveStamps() { return graveStamps.map(s => ({ code: s.code, turn: s.turn })); },
  exLockCards() { return [...exLockCards().entries()].map(([code, v]) => ({ code, n: v.n, typeBit: v.typeBit, token: v.token })); },
  exSummonLock, exLockReason,
  reset() { usedFxTurn = -1; usedFxByCode.clear(); usedFxSeen = new Set(); monsterRevived = null; reviveArm = null; reviveBatch = 0; usedNamesDuel.clear(); gravePrev = null; gravePrevNulls = 0; graveStamps = []; },
};
// ---- cannot-attack reasons (attack-block round, 2026-11-04) ----
// The twin of the cannot-activate silence: a monster whose attack
// the core does not offer in SELECT_BATTLECMD got NO row at all,
// so a correct ruling read as a bug — the reported case: Baromett
// Xyz-summoned under the opponent's 《ラビリンス・ウォール・
// シャドウ》 could not attack and nothing anywhere said why.
// Same discipline as the trackers above: sets are DERIVED from
// the pool's own texts, the live evidence is the client's own
// records, and a reason is stated only when it fully explains
// the missing command. Derivations:
//   (1) FIELD summon-turn block — a face-up field spell whose
//       text bars monsters summoned this turn from attacking
//       (except original Level N+): the source sits in a field
//       zone (szone[5]) of either player, the monster arrived /
//       was flip-summoned this turn (summonMarks), and it is not
//       in the printed-Level exception (Xyz monsters have no
//       Level and are always barred — the Baromett case).
//   (2) SELF summon-turn block — the monster's OWN text carries
//       「このカードは召喚したターンには攻撃できない」 and it was
//       normal summoned / set this turn (kind-attributed mark).
//   (3) the revive rider's attack half — the monsterRevived
//       latch above already proves the summon and its source;
//       the rider bars attacks as well as effects.
// Enumerated NOT covered (pool audit in test-atkblock.js):
//   - 《メタファイズ・ホルス・ドラゴン》's Pendulum-material
//     rider (a monster whose control it stole cannot attack
//     this turn): unreachable — the pool holds ZERO Pendulum
//     monsters, so the branch can never arm.
//   - 《光の護封霊剣》② (this turn, the opponent's monsters
//     cannot DIRECT attack): the blocked side is always the
//     CPU — the card sits only in the human's deck, so the
//     human's own attack sheet can never be its surface.
// "Summoned this turn" evidence is a zone-diff tracker in the
// spirit of trackGraveArrivals: a zone newly holding a monster
// is an arrival (normal summon, set and special summon all
// arrive; a set flipped face-up by an effect keeps its arrival
// turn, exactly like STATUS_SUMMON_TURN). Flip summons of a
// monster set on an EARLIER turn arrive through the flipsummon
// presentation event instead: the zone whose previous face was
// down and is up now, when it is the only candidate — several
// candidates stay silent. Kind attribution (summon / set /
// spsummon) rides the same batch's presentation events; when
// the batch does not attribute a kind, derivation (1) still
// applies (it is kind-agnostic) and (2) stays silent. Control
// changes write no summon event, so a stolen monster keeps the
// marks of its own summon turn — no pool card changes control
// today (audit), and a future one would need the swap case
// revisited before its marks could be trusted across zones.
let _summonTurnBlockCards = null; // Map code -> exempt original level, derived from DATA.texts
function summonTurnBlockCards() {
  if (_summonTurnBlockCards) return _summonTurnBlockCards;
  _summonTurnBlockCards = new Map();
  for (const code of Object.keys(DATA && DATA.texts ? DATA.texts : {})) {
    const t = DATA.texts[code];
    if (!t || !t.text) continue;
    const norm = t.text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    const m = norm.match(/元々のレベルが(\d+)以上のモンスターを除く、召喚・反転召喚・特殊召喚されたモンスターは、そのターンには攻撃できない/);
    if (m) _summonTurnBlockCards.set(+code, +m[1]);
  }
  return _summonTurnBlockCards;
}
let _selfSummonBlockCards = null; // Set of codes whose own text bars attacking on their summon turn
function selfSummonBlockCards() {
  if (_selfSummonBlockCards) return _selfSummonBlockCards;
  _selfSummonBlockCards = new Set();
  for (const code of Object.keys(DATA && DATA.texts ? DATA.texts : {})) {
    const t = DATA.texts[code];
    if (t && t.text && /このカードは召喚したターンには攻撃できない/.test(t.text)) _selfSummonBlockCards.add(+code);
  }
  return _selfSummonBlockCards;
}
let fieldPrev = null; // per player: [{code, pos}|null] per mzone seq at the previous observation
const summonMarks = new Map(); // 'con:seq' -> {code, turn, kinds:Set<string>}
function trackFieldSummons(evs, state) {
  if (!state || !state.players) return;
  const cur = state.players.map(P => {
    const row = [];
    for (let s = 0; s < P.mzone.length; s++) {
      const c = P.mzone[s];
      row.push(c ? { code: c.code != null ? c.code : null, pos: c.pos != null ? c.pos : null } : null);
    }
    return row;
  });
  const fresh = new Set(); // zone keys whose arrival this very observation proves
  for (let con = 0; con < 2; con++) {
    for (let s = 0; s < cur[con].length; s++) {
      const key = con + ':' + s;
      const c = cur[con][s], p = fieldPrev ? fieldPrev[con][s] : null;
      if (c && c.code != null && c.code !== 0 && (!p || (p.code != null && p.code !== 0 && p.code !== c.code))) {
        // the zone newly holds this monster: an arrival. A
        // previous IDENTITY-LESS occupant proves nothing (the
        // monster may have been there all along) — stay silent,
        // the grave tracker's discipline.
        summonMarks.set(key, { code: c.code, turn: state.turnCount, kinds: new Set() });
        fresh.add(key);
      } else if (!c || c.code !== (summonMarks.get(key) || {}).code) {
        summonMarks.delete(key); // zone emptied or the card is gone
      }
    }
  }
  // Kind attribution from THIS batch's presentation events
  // (the same evidence noteReviveFromEvents reads). Summon /
  // set / special summon events name con + code only, so they
  // attribute to the fresh arrivals they can only mean.
  if (evs) {
    for (const ev of evs) {
      if (ev.kind !== 'summon' && ev.kind !== 'spsummon' && ev.kind !== 'set' && ev.kind !== 'flipsummon') continue;
      if (ev.kind === 'set' && ev.loc !== E.LOC.MZONE) continue;
      if (ev.kind === 'flipsummon') {
        // the monster was already on the field face-down: mark
        // the one zone that turned face-up with this observation
        const cands = [];
        for (let s = 0; s < cur[ev.con].length; s++) {
          const c = cur[ev.con][s], p = fieldPrev ? fieldPrev[ev.con][s] : null;
          if (!c || c.code !== ev.code || !p) continue;
          const wasDown = p.pos != null && (p.pos & E.POS_FACEUP) === 0;
          const isUp = c.pos != null && (c.pos & E.POS_FACEUP) !== 0;
          const marked = summonMarks.get(ev.con + ':' + s);
          if (wasDown && isUp && !(marked && marked.turn === state.turnCount)) cands.push(s);
        }
        if (cands.length === 1) {
          summonMarks.set(ev.con + ':' + cands[0], { code: ev.code, turn: state.turnCount, kinds: new Set(['flipsummon']) });
        }
        continue;
      }
      for (const key of fresh) {
        const [kcon] = key.split(':').map(Number);
        const mk = summonMarks.get(key);
        if (kcon === ev.con && mk && mk.code === ev.code) mk.kinds.add(ev.kind);
      }
    }
  }
  fieldPrev = cur;
}
// The field-zone card imposing a summon-turn attack block right
// now: {code, exempt} or null. Field spells live at szone[5];
// the effect ranges over BOTH players' monster zones, so either
// player's field zone counts.
function liveSummonTurnBlock(state) {
  const set = summonTurnBlockCards();
  if (!set.size || !state || !state.players) return null;
  for (let con = 0; con < 2; con++) {
    const P = state.players[con];
    const fz = P && P.szone ? P.szone[5] : null;
    if (fz && fz.code != null && (fz.pos & E.POS_FACEUP) !== 0 && set.has(fz.code)) {
      return { code: fz.code, exempt: set.get(fz.code) };
    }
  }
  return null;
}
// The attack reason the sheet may state for the monster at
// (con, loc, seq), or null. Callers gate the context first
// (SELECT_BATTLECMD live, no 攻撃 action offered); this function
// gates the monster itself: it must still be the marked card,
// face-up in attack position — a face-down or defense monster
// has no attack command by the basic rules, and claiming an
// effect reason for it would be a false claim.
function attackBlockReason(code, con, loc, seq, state) {
  const st = state || duelState;
  if (!st || loc !== E.LOC.MZONE || !st.players || !st.players[con]) return null;
  const cell = st.players[con].mzone[seq];
  if (!cell || cell.code !== code) return null;
  if ((cell.pos & E.POS_FACEUP) === 0 || cell.pos !== E.POS.FU_ATK) return null;
  const mark = summonMarks.get(con + ':' + seq);
  const marked = mark && mark.code === code && mark.turn === st.turnCount ? mark : null;
  // (3) the revive rider's attack half (same latch as the
  // effect half in monsterRevivedReason; no pool card carries
  // the rider today, so this arms only for a future pool card).
  if (monsterRevived && monsterRevived.code === code && monsterRevived.seq === seq && monsterRevived.turnCount === st.turnCount) {
    return '《' + cardName(monsterRevived.rider) + '》の効果で特殊召喚されたため、このターンは攻撃できません';
  }
  if (!marked) return null;
  // (2) the monster's own printed clause — only a real normal
  // summon / set arms it (its script hooks SUMMON_SUCCESS), so
  // the mark must carry the kind.
  if (selfSummonBlockCards().has(code) && (marked.kinds.has('summon') || marked.kinds.has('set'))) {
    return 'このカードは召喚したターンには攻撃できません';
  }
  // (1) the field block: any summon kind counts (the core's
  // STATUS_*_SUMMON_TURN covers them all); the printed-Level
  // exception exempts — Xyz monsters have no Level at all.
  const fb = liveSummonTurnBlock(st);
  if (fb) {
    const d = cardData(code);
    const hasLevel = d && !(d.type & 0x800000);
    if (!(hasLevel && d.level >= fb.exempt)) {
      return '《' + cardName(fb.code) + '》の効果で、召喚したターンのモンスターは攻撃できません';
    }
  }
  return null;
}
// Test surface (same spirit as __poolcov).
window.__atkblock = {
  summonTurnBlockCards() { return [...summonTurnBlockCards().entries()].map(([code, exempt]) => ({ code, exempt })); },
  selfSummonBlockCards() { return [...selfSummonBlockCards()]; },
  track(evs, state) { trackFieldSummons(evs, state); },
  marks() { return [...summonMarks.entries()].map(([key, m]) => ({ key, code: m.code, turn: m.turn, kinds: [...m.kinds] })); },
  liveBlock(state) { return liveSummonTurnBlock(state || duelState); },
  reason(code, con, loc, seq, state) { return attackBlockReason(code, con, loc, seq, state); },
  reset() { fieldPrev = null; summonMarks.clear(); },
};
// Drain the engine's presentation event queue into SE cues.
const ATTR_SE = { 1: 'atk_earth', 2: 'atk_water', 4: 'atk_fire', 8: 'atk_wind', 16: 'atk_light', 32: 'atk_dark', 64: 'atk_light' };
function drainSeEvents(state) {
  if (!state.events || !state.events.length) return;
  const evs = state.events.splice(0, state.events.length);
  noteReviveFromEvents(evs, state); // 死者蘇生 rider latch (pool-coverage block above)
  // V3 stage 2 SE sync: battle damage arriving in the SAME batch as
  // its attack is one beat — its hit SE is held for the attack
  // scene's impact cue (t=280 on the FX clock). Damage arriving in a
  // later batch (a chain window separated declaration from
  // resolution) fires immediately: that arrival IS the damage
  // moment, and sound must mark the truth, not a guessed time.
  const batchAtk = evs.find(e => e.kind === 'attack');
  for (const ev of evs) {
    noteBgmEvent(ev); // BGM key-card latch (see the BGM block above)
    noteMonsterLock(ev, state); // activation-lock latch (Minerva 3rd triage block above)
    switch (ev.kind) {
      case 'set': playSe('set_card'); break;
      case 'activate': playSe('activate_card'); break;
      case 'summon': playSe('summon_circle'); break;
      case 'spsummon': playSe('summon_big'); break;
      case 'flipsummon': playSe('summon_land'); break;
      case 'attack': { const d = ev.code != null ? cardData(ev.code) : null; playSe(d ? (ATTR_SE[d.attribute] || 'atk_sword_big') : 'atk_sword_big'); break; }
      case 'damage': {
        const seName = ev.amount >= 1500 ? 'hit_critical' : ev.amount >= 500 ? 'hit_big' : null;
        if (!seName) break;
        if (batchAtk && ev.player === 1 - batchAtk.con) fxAddScene({ kind: 'secue', dur: 300, cues: [{ at: 280, fn: () => playSe(seName) }], render: () => {} });
        else playSe(seName);
        break;
      }
      case 'destroy': playSe(ev.battle ? 'destroy_blast' : 'destroy_stone'); break;
      case 'banish': playSe('banish_warp'); break;
      case 'recover': playSe('recover'); break;
      case 'negate': playSe('negate_shield'); break;
    }
  }
}

// ---------------------------------------------------------------- card confirmation (MSG_CONFIRM_CARDS)
// The core's way of saying "this player may look at these cards" —
// e.g. Zolga the Prophet shows the activator the top 5 of BOTH decks.
// The engine forwards it as a 'confirm' event, but a look is not a
// board change: nothing on the field moves, so without a dedicated
// surface the effect resolved invisibly (only the single top card
// ever surfaced, buried in the deck pile sheet). Confirms addressed
// to the human seat are queued as they arrive and presented as ONE
// read-only sheet at the head of the next human prompt — before the
// prompt itself opens, because the information belongs to the
// decision the player is about to make. Rows open the usual card
// detail on top of the sheet; every exit settles the wait (below).
let pendingConfirms = [];
// The confirm sheet is a 'view' sheet, so it has THREE exits (its own
// close button, the x button, a backdrop tap) and C-20 makes them the
// same single exit. The presentation wait must settle on ANY of them:
// sheetClose() calls settleConfirmSheet(), so no exit can strand the
// awaited promise in humanAnswerer (which would freeze the duel).
let confirmSheetResolve = null;
function settleConfirmSheet() {
  const r = confirmSheetResolve; confirmSheetResolve = null;
  if (r) r();
}
function queueConfirmEvents(evs) {
  for (const ev of evs || []) {
    if (ev.kind === 'confirm' && ev.shown === HP && ev.cards && ev.cards.some(c => c.code)) pendingConfirms.push(ev);
  }
}
function confirmGroupLabel(con, loc) {
  const whose = con === HP ? '自分' : '相手';
  if (loc === E.LOC.DECK) return whose + 'のデッキ（上から）';
  if (loc === E.LOC.HAND) return whose + 'の手札';
  if (loc === E.LOC.EXTRA) return whose + 'のEXデッキ';
  return 'カード';
}
function showPendingConfirms() {
  if (!pendingConfirms.length) return Promise.resolve();
  const evs = pendingConfirms; pendingConfirms = [];
  // group consecutive entries by (controller, location), arrival order
  const groups = [];
  for (const ev of evs) for (const c of ev.cards) {
    if (!c.code) continue;
    let g = groups[groups.length - 1];
    if (!g || g.con !== c.con || g.loc !== c.loc) { g = { con: c.con, loc: c.loc, cards: [] }; groups.push(g); }
    g.cards.push(c);
  }
  if (!groups.length) return Promise.resolve();
  return new Promise((resolve) => {
    confirmSheetResolve = resolve;
    let html = '<div class="ttl">カードの確認</div>';
    for (const g of groups) {
      // deck entries arrive in group order, not position order: the
      // top of the deck is the HIGHEST seq (the mirror's deckTop rule)
      const sorted = g.cards.slice().sort((a, b) => g.loc === E.LOC.DECK ? b.seq - a.seq : a.seq - b.seq);
      html += '<div class="ttl" style="margin-top:8px">' + confirmGroupLabel(g.con, g.loc) + '</div>' +
        sorted.map((c, i) => '<div class="sortrow" data-info="' + c.code + '">' +
          (g.loc === E.LOC.DECK ? (i + 1) + '枚目：' : '') + cardName(c.code) + '<span class="chev">›</span></div>').join('');
    }
    html += '<div class="btnrow"><button class="bigbtn" id="sheet-cancel">閉じる</button></div>';
    sheetOpenView(html);
    // rows open the FLOATING detail (openInfoPop), never openCardInfo:
    // the latter replaces the sheet's content, which would destroy
    // this sheet's own close button and strand the presentation wait.
    $('sheet').querySelectorAll('[data-info]').forEach(el => el.addEventListener('click', () => {
      if (el.dataset.info) { playClick(); openInfoPop(+el.dataset.info); }
    }));
    $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); settleConfirmSheet(); });
  });
}
// Test surface (same spirit as window.__fx / window.__bgm).
window.__confirm = {
  queue: () => pendingConfirms.slice(),
  push: (ev) => { pendingConfirms.push(ev); },
  show: showPendingConfirms,
};

// ---------------------------------------------------------------- presentation FX (rounds A/B)
// Read-only presentation: this layer consumes the engine's event queue
// (the same transient queue drainSeEvents reads) and state diffs
// between renders, and draws overlays in #fxlayer. It NEVER answers a
// prompt, mutates state, or touches layout: the layer is absolutely
// positioned, pointer-events:none, and not part of the in-flow stack,
// so the frozen board (applyLayout) cannot be affected, and a zone
// re-render cannot kill an in-flight overlay (zone DOM is rebuilt per
// batch; the layer is not). Geometry comes from painted rects of the
// standing board — the same rect discipline as the layout fit loop.
// Grammar follows the approved presentation (method = portal shape,
// destination = how a move reads; see NOTES "FX round A/B").
const fxLog = [];            // spawn record for tests: {kind, ...}
let fxError = null;          // last FX processor error (must stay null)
let fxPrev = null;           // previous render's snapshot (fxSnap)
let fxHandRects = [];        // own-hand card rects captured pre-render (FLIP reflow)
function fxRecord(kind, detail) { fxLog.push(Object.assign({ kind }, detail || {})); if (fxLog.length > 400) fxLog.splice(0, fxLog.length - 400); }
function fxLayerEl() { return $('fxlayer'); }
function fxRel(el) { // element rect in fx-layer coordinates + center
  const a = $('app').getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height, cx: r.left - a.left + r.width / 2, cy: r.top - a.top + r.height / 2 };
}
function fxSlotEl(key) { return document.querySelector('.slot[data-zone="' + key + '"]'); }
function fxPileEl(con, kind) { return document.querySelector('[data-pile="' + kind + ':' + con + '"]'); }
function fxAnim(el, frames, opts) { if (el && el.animate) { try { el.animate(frames, opts); } catch (e) {} } }
function fxNode(cls, cx, cy, w, h) {
  const layer = fxLayerEl(); if (!layer) return null;
  const d = document.createElement('div');
  d.className = 'fx ' + cls;
  d.style.left = (cx - w / 2) + 'px'; d.style.top = (cy - h / 2) + 'px';
  d.style.width = w + 'px'; d.style.height = h + 'px';
  layer.appendChild(d);
  return d;
}
function fxKill(el, ms) { if (el) setTimeout(() => { try { el.remove(); } catch (e) {} }, ms); }
function fxGhostEl(code, faceDown, w, h, deckKey) {
  const d = document.createElement('div');
  d.className = 'fx fx-ghost' + (faceDown ? ' back' : '');
  d.style.width = w + 'px'; d.style.height = h + 'px';
  if (!faceDown && code != null) { artApply(d, code, false, deckKey); d.innerHTML = '<div class="nm' + kindCls(code) + '">' + cardName(code) + '</div>'; }
  return d;
}
function fxPlaceGhost(code, faceDown, pt, w, h, deckKey) {
  const layer = fxLayerEl(); if (!layer) return null;
  const d = fxGhostEl(code, faceDown, w, h, deckKey);
  d.style.left = (pt.cx - w / 2) + 'px'; d.style.top = (pt.cy - h / 2) + 'px';
  layer.appendChild(d);
  return d;
}
// A card ghost flies from one point to another (slight arc). Used for
// every "hand-ward / pile-ward" movement: the destination is what the
// player reads (presentation 3-5, supplement grammar asymmetry).
// `delay` (optional, redesign I(1)): stagger for multi-card flights —
// the ghost waits invisible at its origin until its turn, so cards
// leaving together still land one after another. The delay rides the
// WAAPI animation itself (no per-frame writes), like the sheet-row
// stagger elsewhere; the kill timer accounts for it.
// `deckKey` (optional): the owning seat's deck id, so the ghost wears
// that deck's per-deck art override (DECK_ART) like the tiles do.
function fxFly(code, faceDown, fromPt, toPt, w, h, dur, delay, deckKey) {
  const d = fxPlaceGhost(code, faceDown, fromPt, w, h, deckKey); if (!d) return;
  const dl = delay || 0;
  if (dl > 0) d.style.opacity = '0'; // held until the delayed animation takes over (fill:backwards shows frame 0)
  const dx = toPt.cx - fromPt.cx, dy = toPt.cy - fromPt.cy;
  fxAnim(d, [
    { transform: 'translate(0px,0px)', opacity: 1 },
    { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy * 0.5 - 16) + 'px)', opacity: 1, offset: 0.55 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.72)', opacity: 0.9 },
  ], { duration: dur || 430, easing: 'ease-in-out', delay: dl, fill: dl > 0 ? 'backwards' : 'none' });
  fxKill(d, dl + (dur || 430) + 40);
}
function fxZoneGlow(key, ms) {
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const d = fxNode('fx-zoneglows', r.cx, r.cy, r.w, r.h); if (!d) return;
  fxAnim(d, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: ms || 620, easing: 'ease-out' });
  fxKill(d, (ms || 620) + 40);
}
function fxPortal(key, method, glowMs) {
  // V4-5: the portal is a scene on the shared clock (was WAAPI).
  // 60 ms staging: zone glow 0-, rings 60-, spiral 180, birth
  // flash 330, the summon lands 330-520. Two counter-rotating
  // layers spin up (quadratic), cruise, then brake into a scale
  // collapse (720-840). The paired zone glow is folded into the
  // scene (its third argument is the glow's duration).
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const size = Math.max(r.w, r.h) * 1.3;
  const col = method === 'fusion' ? '#b78bff' : method === 'synchro' ? '#cfe8d8' : '#ffd94d';
  const glow = fxNode('fx-zoneglows', r.cx, r.cy, r.w, r.h);
  if (glow) glow.style.opacity = '0';
  const d = fxNode('fx3-portal ' + method, r.cx, r.cy, size, size);
  if (!d) { if (glow) glow.remove(); return; }
  d.innerHTML = '<div class="r1"></div><div class="r2"></div>';
  d.style.opacity = '0';
  const gMs = glowMs || 620;
  fxAddScene({
    kind: 'portal', dur: 840, winLow: [[320, 540]],
    cues: [
      { at: 180, fn: () => fxSpawnBurst('low', { seed: (Math.random() * 1e9) | 0, o: [r.cx, r.cy], n: 10, t0: fxTimeMs + 180, life: [380, 620], mode: 'spiral', r: [6, size * 0.52], turns: 1.5, size: [2.5, 4.5], cols: [col, '#ffffff'] }) },
      { at: 330, fn: () => { const t2 = fxSlotEl(key); if (t2) fxAnim(t2, [{ filter: 'brightness(1.6)' }, { filter: 'brightness(1)' }], { duration: 190, easing: 'ease-out' }); } },
    ],
    drawLow(ctx, t) { // the birth flash: a bloom as the summon lands
      const bt = fxSeg(t, 330, 470);
      if (bt > 0) fxDrawGlow(ctx, r.cx, r.cy, fxLerp(40, 90, bt), col, .8 * (1 - bt));
    },
    render(t) {
      if (glow) { // the folded zone glow: in by 25%, out by gMs
        glow.style.opacity = String(t >= gMs ? 0 : (t < gMs * 0.25 ? t / (gMs * 0.25) : 1 - (t - gMs * 0.25) / (gMs * 0.75)));
      }
      const sp = fxSeg(t, 60, 400), su = sp * sp;
      const brk = fxSeg(t, 600, 840);
      const rot = 360 * su + Math.max(0, t - 400) * 0.36 * (1 - brk * 0.8);
      let s;
      if (t < 240) s = fxLerp(.55, 1.04, FXE.outCubic(fxSeg(t, 60, 240)));
      else if (t < 400) s = fxLerp(1.04, 1, fxSeg(t, 240, 400));
      else if (t < 720) s = 1;
      else s = fxLerp(1, .8, fxSeg(t, 720, 840));
      d.style.opacity = String(fxSeg(t, 60, 240) * (1 - fxSeg(t, 720, 840)));
      d.style.transform = 'scale(' + s.toFixed(3) + ')';
      d.children[0].style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
      d.children[1].style.transform = 'rotate(' + (-rot * 0.7).toFixed(1) + 'deg)';
    },
    onDone() { try { d.remove(); } catch (e) {} if (glow) { try { glow.remove(); } catch (e) {} } },
  });
}
function fxPuff(key) { // normal summons & sets: a small placement beat only
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const d = fxNode('fx-portal generic', r.cx, r.cy, Math.max(r.w, r.h) * 0.95, Math.max(r.w, r.h) * 0.95);
  if (!d) return;
  d.innerHTML = '<div class="ring"></div>';
  fxAnim(d, [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 430, easing: 'ease-out' });
  fxKill(d, 470);
}
// ---- summon callout (FX coverage round): every summon that no
// bigger scene owns still NAMES its card. The summoned card's image
// stamps in over its own zone — settle-in, a seat rim (gold = the
// human seat, lapis = the opponent, the redesign colour grammar),
// a readable hold (longer for the opponent, whose actions run on
// the CPU's pace), then an ease-out. It claims no input window and
// sits in the FX layer, so it can never cover a prompt or the
// result; a face-down arrival never calls out (its identity is not
// public yet), and the ace scene's summons stand down via the
// arrival branch order (they are consumed before reaching here).
function fxSummonCallout(key, code, con, pos) {
  if (code == null || (pos != null && (pos & E.POS_FACEUP) === 0)) return;
  const el = fxSlotEl(key); if (!el) return;
  const app = $('app'); if (!app) return;
  const ar = fxRel(app);
  const r = fxRel(el);
  const W = Math.round(r.w * 1.5), H = Math.round(W * 1.36);
  let cx = r.cx, cy = r.y + (r.h - 24) / 2;
  cx = Math.max(W / 2 + 2, Math.min(ar.w - W / 2 - 2, cx));
  cy = Math.max(H / 2 + 2, Math.min(ar.h - H / 2 - 2, cy));
  const card = fxPlaceGhost(code, false, { cx, cy }, W, H, deckKeyOfSeat(con));
  if (!card) return;
  card.style.zIndex = 6; card.style.opacity = '0';
  const rim = fxNode(con === HP ? 'fx3-goldframe' : 'fx3-lapisframe', cx, cy, W, H);
  if (rim) { rim.style.opacity = '0'; rim.style.zIndex = 7; }
  const hold = con === HP ? 640 : 800, dur = hold + 260;
  fxAddScene({
    kind: 'summoncall', dur,
    render(t) {
      const s = 0.7 + 0.3 * FXE.settle(fxSeg(t, 0, 200));
      card.style.transform = 'scale(' + s.toFixed(3) + ')';
      card.style.opacity = String(Math.min(fxSeg(t, 0, 90), 1 - fxSeg(t, hold, dur)));
      if (rim) {
        // ignition flash (0-460), then a low seat-coloured floor for
        // the rest of the hold — the frame is what makes the stamp
        // read as a presentation rather than a merely bigger tile
        const ri = t < 80 ? t / 80 : Math.max(0.38, 1 - fxSeg(t, 240, 460));
        rim.style.transform = card.style.transform;
        rim.style.opacity = String(0.95 * ri * (1 - fxSeg(t, hold, dur)));
      }
    },
    onDone() { try { card.remove(); } catch (e) {} if (rim) { try { rim.remove(); } catch (e) {} } },
  });
}
function fxWhiteFlash(key) { // destruction: flash white, gone (restrained)
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const d = fxNode('fx-flash', r.cx, r.cy, r.w * 1.25, r.h * 1.25); if (!d) return;
  fxAnim(d, [{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
  fxKill(d, 360);
}
// ---- Redesign C (proto 案3): the battle-destruction result chip
// (residual light). An engraved stone tablet reading 「破壊」
// (~44x18px, CSS .fx3-resultchip) stands beside the destroyed
// zone's lower-right corner — its left edge 8px inside the zone's
// right edge, its top 12px above the zone's bottom edge, exactly
// the prototype's placement (cap-proto p3fresh) — and lingers
// ~2.6 s, dissolving by opacity + a 3px rise ONLY (p3fade: opacity
// .30 at the risen position). WAAPI transform/opacity, like the
// other residual chips; all paint is static CSS. Called ONLY for
// battle destruction from the fxProcessInner destroy pass (the
// destroy event's battle flag, or a destruction the batch's
// attack scene owns) — effect destruction never reaches here.
function fxResultChip(key, code) {
  const el = fxSlotEl(key); if (!el) return null;
  const r = fxRel(el);
  // fxNode centres the box on (cx, cy): left = r.x + r.w - 8 and
  // top = r.y + r.h - 12 for a 44x18 chip give the centres below
  const d = fxNode('fx3-resultchip', r.x + r.w + 14, r.y + r.h - 3, 44, 18);
  if (!d) return null;
  d.textContent = '破壊';
  d.dataset.resultKind = 'destroy';
  if (code != null) d.dataset.code = String(code);
  fxAnim(d, [
    { transform: 'translateY(0px)', opacity: 0 },
    { transform: 'translateY(0px)', opacity: 1, offset: 0.06 },
    { transform: 'translateY(-2px)', opacity: 1, offset: 0.75 },
    { transform: 'translateY(-3px)', opacity: 0 },
  ], { duration: 2600, easing: 'ease-out' });
  fxKill(d, 2640);
  return d;
}
function fxVanish(key, code, faceDown) { // deck returns: gone in place, no flight (supplement)
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const d = fxPlaceGhost(code, faceDown, r, r.w - 2, r.h - 24, deckKeyOfSeat(+key.split(':')[0])); if (!d) return;
  fxAnim(d, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: 0 }], { duration: 340, easing: 'ease-in' });
  fxKill(d, 380);
}
function fxSlide(fromKey, toKey, code, faceDown) { // control change: the card slides (supplement)
  const a = fxSlotEl(fromKey), b = fxSlotEl(toKey); if (!a || !b) return;
  const ra = fxRel(a), rb = fxRel(b);
  const d = fxPlaceGhost(code, faceDown, ra, ra.w - 2, ra.h - 24, deckKeyOfSeat(+fromKey.split(':')[0])); if (!d) return;
  const dx = rb.cx - ra.cx, dy = rb.cy - ra.cy;
  fxAnim(d, [
    { transform: 'translate(0px,0px) scale(1)', opacity: 1 },
    { transform: 'translate(' + (dx * 0.5) + 'px,' + (dy * 0.5) + 'px) scale(1.18)', opacity: 1, offset: 0.5 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(1)', opacity: 0.95 },
  ], { duration: 480, easing: 'ease-in-out' });
  fxKill(d, 520);
}
function fxConverge(fromKey, toKey) { // materials: glow (red when chosen) -> vanish -> one point
  const a = fxSlotEl(fromKey), b = fxSlotEl(toKey); if (!a || !b) return;
  const ra = fxRel(a), rb = fxRel(b);
  const d = fxPlaceGhost(null, true, ra, ra.w - 2, ra.h - 24); if (!d) return;
  d.classList.add('srcglow');
  const dx = rb.cx - ra.cx, dy = rb.cy - ra.cy;
  fxAnim(d, [
    { transform: 'translate(0px,0px) scale(1)', opacity: 1 },
    { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.25)', opacity: 0.4 },
  ], { duration: 400, easing: 'ease-in' });
  fxKill(d, 440);
}
// ------------------------------------------------------------ synchro grammar
// Proposal S / proto 案6: a synchro summon must READ as one — the
// materials light (tuner = a lapis ring + tag, the rest = gold light,
// principle 4), their levels stand as pips, the pips flow into the
// summon zone and accumulate (the count only ever rises as pips land,
// principle 2), a stone ring closes on the total, and the summoned
// card settles onto its real tile. The decor builder below is shared
// by the standalone scene (non-cutin synchros) and the ace scene
// (cut-in synchros) so both paths speak the same grammar
// (principle 7); only the timing windows differ.
// Returns null when the materials cannot be read honestly (no
// materials, an unknown code, or a level that is not a number >= 1 —
// e.g. a token): the caller then falls back to the generic portal
// and the materials fly individually, exactly as before. The FX
// layer never invents a level it could not read.
function fxSynchroInfo(mats) {
  if (!mats || !mats.length) return null;
  const list = [], tunerCodes = [];
  let total = 0;
  for (const m of mats) {
    if (!m || m.code == null) return null;
    const d = cardData(m.code);
    if (!d) return null;
    const lv = d.level;
    if (typeof lv !== 'number' || !isFinite(lv) || lv < 1) return null;
    const tuner = (d.type & 0x1000) !== 0;
    list.push({ key: m.key, code: m.code, level: lv, tuner });
    total += lv;
    if (tuner) tunerCodes.push(m.code);
  }
  if (total < 1) return null;
  return { list, total, tunerCodes };
}
// Builds the shared decor DOM for one synchro presentation: per
// material a light layer (+ tuner tag), per level a pip that starts
// over its material and lands on the accumulation row over the
// summon zone (stone outlines mark the not-yet-landed slots), and
// the engraved count at the zone. All glow is preset in CSS; the
// render only ever writes transform / opacity (textContent changes
// only when the landed count itself changes).
// destCx/rowY: the accumulation row; numPt: the count's centre.
function fxSynchroDecor(info, destCx, rowY, numPt) {
  const pts = [];
  for (const e of info.list) {
    // geometry fallback, same contract as the ace scene's nominal
    // zone rect: with no painted slot (synthetic drives) a nominal
    // rect under the accumulation row stands in — the LEVELS are
    // always the real read values; only the geometry degrades.
    pts.push(fxPtOfKey(e.key) || { cx: destCx, cy: rowY + 60, x: destCx - 28, y: rowY + 22, w: 56, h: 76 });
  }
  const nodes = [], matsDecor = [], pips = [];
  info.list.forEach((e, i) => {
    const pt = pts[i];
    const glow = fxNode(e.tuner ? 'fx3-syntuner' : 'fx3-syngold', pt.cx, pt.cy, pt.w + 4, pt.h + 4);
    if (glow) { glow.style.opacity = '0'; nodes.push(glow); }
    let tag = null;
    if (e.tuner) {
      tag = fxNode('fx3-syntag', pt.cx, pt.y - 26, 58, 15);
      if (tag) { tag.textContent = 'チューナー'; tag.style.opacity = '0'; nodes.push(tag); }
    }
    matsDecor.push({ glow, tag });
  });
  const outlines = [];
  for (let k = 0; k < info.total; k++) {
    const dx = destCx + (k - (info.total - 1) / 2) * 12;
    const ol = fxNode('fx3-synpip outline', dx, rowY, 10, 10);
    if (ol) { ol.style.opacity = '0'; nodes.push(ol); outlines.push(ol); }
  }
  let k = 0;
  info.list.forEach((e, i) => {
    const pt = pts[i];
    for (let j = 0; j < e.level; j++, k++) {
      const home = { x: pt.cx + (j - (e.level - 1) / 2) * 12, y: pt.y - 10 };
      const dest = { x: destCx + (k - (info.total - 1) / 2) * 12, y: rowY };
      const el = fxNode('fx3-synpip ' + (e.tuner ? 'lapis' : 'gold'), home.x, home.y, 10, 10);
      if (el) { el.style.opacity = '0'; nodes.push(el); }
      pips.push({ el, home, dest, k });
    }
  });
  const numEl = fxNode('fx3-synnum', numPt.cx, numPt.cy, 76, 40);
  let numSpan = null;
  if (numEl) {
    numEl.innerHTML = '<span class="n">0</span><span class="tot">/ ' + info.total + '</span>';
    numEl.style.opacity = '0';
    nodes.push(numEl);
    numSpan = numEl.querySelector('.n');
  }
  let shown = -1;
  // T: {appearBase, appearStep, flyBase, flyStep, flyDur, glowIn,
  // glowOut, tagOut, outlineIn, outlineOut, pipFade, numOut} — the
  // two call sites pass their own windows on the same grammar.
  function render(t, T) {
    const glowOp = fxSeg(t, T.glowIn[0], T.glowIn[1]) * (1 - fxSeg(t, T.glowOut[0], T.glowOut[1]));
    const tagOp = fxSeg(t, T.glowIn[0], T.glowIn[1]) * (1 - fxSeg(t, T.tagOut[0], T.tagOut[1]));
    for (const md of matsDecor) {
      if (md.glow) md.glow.style.opacity = String(glowOp);
      if (md.tag) md.tag.style.opacity = String(tagOp);
    }
    const olOp = 0.9 * fxSeg(t, T.outlineIn[0], T.outlineIn[1]) * (1 - fxSeg(t, T.outlineOut[0], T.outlineOut[1]));
    for (const ol of outlines) ol.style.opacity = String(olOp);
    const pipFade = 1 - fxSeg(t, T.pipFade[0], T.pipFade[1]);
    let arrived = 0;
    for (const p of pips) {
      const flyStart = T.flyBase + p.k * T.flyStep, flyEnd = flyStart + T.flyDur;
      if (t >= flyEnd) arrived++;
      if (!p.el) continue;
      const appearAt = T.appearBase + p.k * T.appearStep;
      const op = fxSeg(t, appearAt, appearAt + 80) * pipFade;
      let tr;
      if (t < flyStart) {
        const s = FXE.settle(fxSeg(t, appearAt, appearAt + 110));
        tr = 'scale(' + Math.max(0.01, s).toFixed(3) + ')';
      } else {
        const u = FXE.inOut(fxSeg(t, flyStart, flyEnd));
        tr = 'translate(' + ((p.dest.x - p.home.x) * u).toFixed(1) + 'px,' +
          ((p.dest.y - p.home.y) * u - Math.sin(Math.PI * u) * 10).toFixed(1) + 'px)';
      }
      p.el.style.transform = tr;
      p.el.style.opacity = String(op);
    }
    if (numEl) {
      if (arrived !== shown) { shown = arrived; if (numSpan) numSpan.textContent = String(arrived); }
      numEl.style.opacity = String((arrived > 0 ? 1 : 0) * (1 - fxSeg(t, T.numOut[0], T.numOut[1])));
    }
  }
  return { nodes, render, numEl };
}
// Standalone synchro scene (~1900 ms, the proto strip's six beats)
// for synchros the ace cut-in does not own. Returns the scene, or
// null when the presentation cannot be built (no layer / no zone
// geometry / unreadable materials) — the caller falls back.
function fxSynchroSceneV3(o) {
  const layer = fxLayerEl(); if (!layer) return null;
  const info = o.info || fxSynchroInfo(o.mats);
  if (!info) return null;
  const app = $('app'); if (!app) return null;
  const ar = fxRel(app);
  const slotEl = fxSlotEl(o.key);
  const zr = slotEl ? fxRel(slotEl) : { cx: ar.cx, cy: ar.y + ar.h * (o.con === HP ? 0.60 : 0.28), w: 56, h: 76, x: ar.cx - 28, y: ar.y + ar.h * (o.con === HP ? 0.60 : 0.28) - 38 };
  const ringD = Math.max(zr.w, zr.h) * 1.12;
  const nodes = [];
  // the materials are already gone from the board at diff time, so
  // — exactly as the ace scene does — ghosts stand in for them
  // while they light; they are consumed quietly as the pips leave.
  // DOM order is paint order: ghosts, then the decor (lights/pips),
  // then the ring, the count re-stacked over the ring's core, and
  // the summoned ghost last so nothing ever covers the card.
  const matGhosts = [];
  for (const e of info.list) {
    const pt = fxPtOfKey(e.key); if (!pt) continue;
    const g = fxPlaceGhost(e.code, false, pt, Math.max(10, pt.w - 2), Math.max(10, pt.h - 24));
    if (g) { matGhosts.push(g); nodes.push(g); }
  }
  // the accumulation row rides just INSIDE the ring's top edge
  // (proto p6d): anchored above the zone it lands in the midbar —
  // only ~3px separate the midbar's bottom from the mzone's top at
  // both app heights, so an above-zone row strikes the phase buttons.
  const decor = fxSynchroDecor(info, zr.cx, zr.cy - ringD / 2 + 14, { cx: zr.cx, cy: zr.cy });
  if (!decor) { for (const n of nodes) { try { n.remove(); } catch (e) {} } return null; }
  for (const n of decor.nodes) nodes.push(n);
  const ring = fxNode('fx3-synring', zr.cx, zr.cy, ringD, ringD);
  if (ring) { ring.innerHTML = '<div class="core"></div><div class="seam"></div>'; ring.style.opacity = '0'; nodes.push(ring); }
  if (decor.numEl) layer.appendChild(decor.numEl); // the count stands ON the ring's dark core (proto p6d)
  const gw = Math.max(10, zr.w - 2), gh = Math.max(10, zr.h - 24);
  const rim = fxNode('fx3-synrim', zr.cx, zr.cy, gw + 4, gh + 4);
  if (rim) { rim.style.opacity = '0'; nodes.push(rim); }
  const ghost = fxPlaceGhost(o.code, false, zr, gw, gh);
  if (ghost) { ghost.style.opacity = '0'; nodes.push(ghost); }
  const flyStep = info.total > 1 ? Math.min(65, 500 / (info.total - 1)) : 0;
  const T = {
    appearBase: 200, appearStep: 25, flyBase: 450, flyStep, flyDur: 380,
    glowIn: [0, 140], glowOut: [430, 620], tagOut: [430, 600],
    outlineIn: [450, 550], outlineOut: [1000, 1200], pipFade: [1400, 1600], numOut: [1380, 1560],
  };
  const sc = fxAddScene({
    kind: 'synchro', dur: 1900,
    render(t) {
      for (const g of matGhosts) {
        const u = fxSeg(t, 480, 720);
        g.style.opacity = String(1 - u);
        g.style.transform = 'scale(' + (1 - 0.18 * u).toFixed(3) + ')';
      }
      decor.render(t, T);
      if (ring) {
        const base = fxSeg(t, 1000, 1150);
        const remnant = (1 - 0.6 * fxSeg(t, 1450, 1650)) * (1 - fxSeg(t, 1720, 1900));
        ring.style.opacity = String(base * remnant);
        ring.style.transform = 'scale(' + (0.72 + 0.28 * FXE.outCubic(fxSeg(t, 1000, 1350))).toFixed(3) + ')';
      }
      const gOp = fxSeg(t, 1350, 1470) * (1 - fxSeg(t, 1700, 1850));
      const gScale = 1.18 - 0.18 * FXE.settle(fxSeg(t, 1350, 1780));
      if (ghost) { ghost.style.opacity = String(gOp); ghost.style.transform = 'scale(' + gScale.toFixed(3) + ')'; }
      if (rim) {
        rim.style.opacity = String(fxSeg(t, 1350, 1470) * (1 - fxSeg(t, 1580, 1780)));
        rim.style.transform = 'scale(' + gScale.toFixed(3) + ')';
      }
    },
    onDone() { for (const n of nodes) { try { n.remove(); } catch (e) {} } },
  });
  return sc;
}
function fxPeel(key) { // an Xyz material leaves: the stack visibly thins first
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const layer = fxLayerEl(); if (!layer) return;
  const d = document.createElement('div');
  d.className = 'fx fx-peel';
  d.style.left = (r.x + 4) + 'px'; d.style.top = (r.y + 4) + 'px';
  d.style.width = (r.w - 4) + 'px'; d.style.height = (r.h - 26) + 'px';
  layer.appendChild(d);
  fxAnim(d, [{ transform: 'translate(0px,0px)', opacity: 1 }, { transform: 'translate(3px,14px)', opacity: 0 }], { duration: 460, easing: 'ease-in' });
  fxKill(d, 500);
}
function fxStripFlash(key) { // ATK/DEF changed: the value flashes, once (3-7)
  const el = fxSlotEl(key); if (!el) return;
  const r = fxRel(el);
  const layer = fxLayerEl(); if (!layer) return;
  const d = document.createElement('div');
  d.className = 'fx fx-stripflash';
  d.style.left = r.x + 'px'; d.style.top = (r.y + r.h - 22) + 'px';
  d.style.width = r.w + 'px'; d.style.height = '22px';
  layer.appendChild(d);
  fxAnim(d, [{ opacity: 0.95 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  fxKill(d, 690);
}
function fxPileFlash(con, kind) { // landing reaction: the pile lights up (3-5)
  const el = fxPileEl(con, kind); if (!el) return;
  const r = fxRel(el);
  const d = fxNode('fx-pilebox', r.cx, r.cy, r.w, r.h); if (!d) return;
  fxAnim(d, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });
  fxKill(d, 460);
}
const FX_PHASES = {
  draw: { label: 'ドローフェイズ', battle: false }, standby: { label: 'スタンバイフェイズ', battle: false },
  main1: { label: 'メインフェイズ 1', battle: false }, battle: { label: 'バトルフェイズ', battle: true },
  main2: { label: 'メインフェイズ 2', battle: false }, end: { label: 'エンドフェイズ', battle: false },
};
function fxPhaseFamily(ph) {
  if (!ph) return null;
  if (ph === 'DRAW') return 'draw';
  if (ph === 'STANDBY') return 'standby';
  if (ph === 'MAIN1') return 'main1';
  if (ph === 'MAIN2') return 'main2';
  if (ph === 'END') return 'end';
  if (/BATTLE|DAMAGE/.test(ph)) return 'battle';
  return null;
}
let fxBannerEl = null, fxBannerScene = null, fxPhaseSweepEl = null, fxPhaseHairlineEl = null;
// Redesign E (proto 案5): the settled remnant of a phase sweep —
// a 1px gold hairline (opacity 0.30) that stays ON the mid bar as
// pure decoration (the bar's layout never changes). It lives as a
// child of #midbar, so it is NOT wiped with #fxlayer; it is
// created lazily by the banner, re-shown at each settle, and
// removed only by a duel reset (fxPhaseClearSeated).
function fxPhaseHairline() {
  const mb = $('midbar'); if (!mb) return null;
  if (fxPhaseHairlineEl && fxPhaseHairlineEl.parentElement === mb) return fxPhaseHairlineEl;
  const h = document.createElement('div');
  h.className = 'fx-phase-hairline';
  h.style.opacity = '0';
  mb.appendChild(h);
  fxPhaseHairlineEl = h;
  return h;
}
function fxPhaseClearSeated() { // duel reset: no seated phase, no hairline
  const pi = $('phaseinfo'); if (pi) pi.classList.remove('fx-seated');
  if (fxPhaseHairlineEl) { try { fxPhaseHairlineEl.remove(); } catch (e) {} fxPhaseHairlineEl = null; }
}
function fxPhaseBanner(fam) {
  const info = FX_PHASES[fam]; if (!info) return;
  const layer = fxLayerEl(); if (!layer) return;
  if (fxBannerEl) { try { fxBannerEl.remove(); } catch (e) {} fxBannerEl = null; }
  if (fxBannerScene && !fxBannerScene.dead) fxBannerScene.dead = true;
  if (fxPhaseSweepEl) { try { fxPhaseSweepEl.remove(); } catch (e) {} fxPhaseSweepEl = null; }
  // a new transition un-seats the previous phase: the readout is
  // plain again and the old hairline hides until THIS sweep settles
  const pi = $('phaseinfo'); if (pi) pi.classList.remove('fx-seated');
  const hair = fxPhaseHairline(); if (hair) hair.style.opacity = '0';
  const d = document.createElement('div');
  // the battle class is kept for record compatibility, but its
  // paint is gold like every other phase (prototype over variant)
  d.className = 'fx-phase' + (info.battle ? ' battle' : '');
  d.innerHTML = '<span class="lbl">' + info.label + '</span>';
  d.style.opacity = '0';
  layer.appendChild(d);
  fxBannerEl = d;
  // ---- the sweep segment: a 2px gold line (gradient + bright
  // leading tip, CSS .fx-phase-sweep) that runs left -> right
  // across the TOP of the mid bar (prototype offset: bar top + 3px,
  // so the 2px line's centre sits at +4). It is an overlay in
  // #fxlayer computed from the bar's painted rect — the bar
  // itself never moves. Travel is transform-only: the segment is
  // laid at the bar's left edge and translates from fully off the
  // left end to fully off the right end over 0-650 ms.
  const mb = $('midbar');
  const mr = mb ? fxRel(mb) : null;
  const ar = $('app') ? fxRel($('app')) : null;
  const barW = mr && mr.w > 0 ? mr.w : (ar ? ar.w : 0);
  const barX = mr ? mr.x : 0;
  const barY = mr ? mr.y : (ar ? ar.y + ar.h * 0.38 : 0);
  const segW = Math.max(44, Math.round(barW * 0.45));
  const sweep = fxNode('fx-phase-sweep', barX + segW / 2, barY + 4, segW, 2);
  if (sweep) { sweep.style.opacity = '0'; sweep.style.transform = 'translateX(' + (-segW) + 'px)'; fxPhaseSweepEl = sweep; }
  const travel = barW + segW;
  // Redesign E timeline (one scene on the shared clock, total
  // span unchanged at ~820 ms): the phase name snaps in standing
  // (0-160) while the sweep runs (0-650); the sweep then dissolves
  // into the hairline (650-820, hairline fading up to its settled
  // 0.30), the name makes its short exit pass (700-820), and at
  // settle the name "sits" in #phaseinfo (gold + bold, the
  // fx-seated class) while the hairline remains on the bar.
  fxBannerScene = fxAddScene({
    kind: 'phase', dur: 820,
    render(t) {
      const inU = FXE.snap(fxSeg(t, 0, 160));
      const outU = FXE.inQuad(fxSeg(t, 700, 820));
      d.style.opacity = String(Math.min(inU, 1 - outU));
      d.style.transform = 'translateY(' + ((1 - inU) * 4).toFixed(2) + 'px)';
      if (sweep) {
        const u = FXE.outCubic(fxSeg(t, 0, 650));
        sweep.style.transform = 'translateX(' + (-segW + travel * u).toFixed(1) + 'px)';
        sweep.style.opacity = String(Math.min(1, fxSeg(t, 0, 60) * 4) * (1 - fxSeg(t, 650, 820)));
      }
      if (hair) hair.style.opacity = String(0.30 * fxSeg(t, 650, 820));
    },
    onDone() {
      try { d.remove(); } catch (e) {} if (fxBannerEl === d) fxBannerEl = null;
      if (sweep) { try { sweep.remove(); } catch (e) {} if (fxPhaseSweepEl === sweep) fxPhaseSweepEl = null; }
      if (hair) hair.style.opacity = '0.30'; // the hairline remains
      const pi2 = $('phaseinfo'); if (pi2) pi2.classList.add('fx-seated'); // the name sits in the bar
    },
  });
  fxRecord('phase', { phase: fam });
}
// ------------------------------------------------------------ V3 stage 1: FX foundation
// One clock, a scene engine, signature easings, sprite particles and
// hit-stop — the foundation every V3 scene stands on. Requirements
// and the layer-order table live in NOTES ("V3 integration —
// Stage 1"); the short form:
//  - every scene is a function of ONE shared FX clock (fxTimeMs);
//    layers are scheduled against scene-local time on that clock.
//  - hit-stop freezes the FX clock itself (all scenes + particles);
//    the game (engine / prompts / board) is never on this clock.
//  - particles are pre-rendered sprites, drawImage only, capped at
//    FX_PARTICLE_CAP live across all scenes; no shadowBlur anywhere.
//  - scene rendering writes transform / opacity (+ canvas) only.
// Legacy round A/B effects keep their own WAAPI/interval timers in
// this stage; scenes built from stage 2 onward run on this engine.
function fxCubicBezier(x1, y1, x2, y2) {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => { let t = x; for (let i = 0; i < 5; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-5) break; t -= e / dx(t); } return sy(t < 0 ? 0 : t > 1 ? 1 : t); };
}
// Signature easings (proposal 1.5): a curve per PURPOSE, replacing the
// round A/B habit of reusing ease-out / ease-in-out / ease-in for
// everything. CSS-side equivalents are the same cubic-bezier tuples.
const FXE = {
  settle: fxCubicBezier(.16, 1.3, .3, 1),   // card appearance (summon / cut-in): slight overshoot, then settles
  snap: fxCubicBezier(.2, .9, .25, 1),      // information UI (banners, result): quick, clean stop
  launch: fxCubicBezier(.6, 0, .9, .4),     // lines / beams: accelerates into the target
  washOut: fxCubicBezier(.16, .8, .26, 1),  // full-screen washes: long decay tail
  spinUp: fxCubicBezier(.25, .6, .35, 1),   // portal rotation ramp
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inQuad: t => t * t,
  outExpo: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  linear: t => t,
};
const fxSeg = (t, a, b) => { const v = (t - a) / (b - a); return v < 0 ? 0 : v > 1 ? 1 : v; };
const fxLerp = (a, b, t) => a + (b - a) * t;
// ---- the FX clock + scene engine
let fxTimeMs = 0;          // the shared FX clock; freezes during hit-stop
let fxLastWall = 0;        // last pump's wall timestamp
let fxStopUntilWall = 0;   // hit-stop: wall time until which the clock is frozen
let fxScenes = [];         // active scenes {kind, t0, dur, render, onDone, dead}
let fxLoopOn = false, fxFrameNo = 0;
function fxNow() { return fxTimeMs; }
function fxHitStop(ms) {
  const until = performance.now() + ms;
  if (until > fxStopUntilWall) fxStopUntilWall = until;
  fxEnsureLoop();
}
function fxAddScene(def) {
  const sc = Object.assign({ t0: fxTimeMs, dead: false }, def);
  fxScenes.push(sc);
  fxEnsureLoop();
  return sc;
}
function fxEnsureLoop() {
  if (fxLoopOn) return;
  fxLoopOn = true;
  const seen = fxFrameNo;
  try { requestAnimationFrame(fxPump); } catch (e) {}
  // watchdog: if rAF is throttled (background tab, jsdom), pump by hand
  setTimeout(() => { if (fxLoopOn && fxFrameNo === seen) fxPump(performance.now()); }, 90);
}
function fxPump(wall) {
  fxFrameNo++;
  if (!fxLastWall) fxLastWall = wall;
  let dt = wall - fxLastWall;
  fxLastWall = wall;
  if (dt > 100) dt = 100; // a jank frame must not teleport a scene
  if (dt < 0) dt = 0;
  if (wall >= fxStopUntilWall) fxTimeMs += dt; // during hit-stop the clock (and every scene on it) is frozen
  let alive = false;
  for (const sc of fxScenes) {
    if (sc.dead) continue; // superseded scenes never render again (their cleanup already ran)
    const t = fxTimeMs - sc.t0;
    if (t < 0) { alive = true; continue; }
    if (t >= sc.dur) {
      if (!sc.dead) {
        sc.dead = true;
        try { if (sc.render) sc.render(sc.dur); } catch (e) {}
        try { if (sc.onDone) sc.onDone(); } catch (e) {}
      }
      continue;
    }
    alive = true;
    try { sc.render(t); } catch (e) { fxError = String((e && e.stack) || e); sc.dead = true; }
    if (!sc.dead && sc.cues) { // timed cues on the shared clock (SE sync points, hit-stop triggers)
      for (const q of sc.cues) {
        if (!q.done && t >= q.at) { q.done = true; try { q.fn(); } catch (e) {} }
      }
    }
  }
  fxScenes = fxScenes.filter(s => !s.dead);
  fxDrawParticles();
  fxLoopOn = false;
  if (alive || fxBursts.length) fxEnsureLoop();
}
// ---- particles: seeded, closed-form, sprite-only (ported from the
// approved prototype). A burst's particles are fully determined by
// (seed, index), so any frame renders identically in playback and in
// still capture — and freezing the FX clock freezes them mid-flight.
const FX_PARTICLE_CAP = 90;
let fxBursts = []; // {cv:'low'|'top', mode:'burst'|'spiral', seed, o:[x,y], n, t0, life:[min,max], ...}
const fxSpriteCache = {};
function fxSprite(col, r) {
  const k = col + '_' + r;
  if (fxSpriteCache[k]) return fxSpriteCache[k];
  const c = document.createElement('canvas'); c.width = c.height = r * 2;
  const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.25, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  fxSpriteCache[k] = c; return c;
}
function fxMulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// particles of one burst alive at FX time t (closed form, exact count)
function fxBurstAliveAt(b, t) {
  const rnd = fxMulberry32(b.seed);
  let n = 0;
  for (let i = 0; i < b.n; i++) {
    const dl = rnd() * (b.delayMax || 0), life = fxLerp(b.life[0], b.life[1], rnd());
    rnd(); rnd(); rnd(); rnd(); // keep the stream aligned with the draw functions
    const age = t - b.t0 - dl;
    if (age >= 0 && age <= life) n++;
  }
  return n;
}
function fxParticlesAliveAt(t) { return fxBursts.reduce((a, b) => a + fxBurstAliveAt(b, t), 0); }
function fxSpawnBurst(cvKind, b) {
  b.cv = cvKind; b.mode = b.mode || 'burst';
  // spiral bursts need a radius band and a turn count; default them
  // here so a caller that omits them can never crash the draw pass
  if (b.mode === 'spiral') { if (!b.r) b.r = [0, 60]; if (b.turns == null) b.turns = 1.5; }
  if (b.t0 == null) b.t0 = fxTimeMs;
  // budget: clip this burst so the projected live total (sampled over
  // its lifetime) never exceeds the cap; the draw pass hard-stops at
  // the cap as a second net.
  let peak = 0;
  const maxLife = b.life[1] + (b.delayMax || 0);
  for (let dt = 0; dt <= maxLife; dt += 50) peak = Math.max(peak, fxParticlesAliveAt(b.t0 + dt));
  const room = Math.max(0, FX_PARTICLE_CAP - peak);
  if (b.n > room) b.n = room;
  if (b.n > 0) { fxBursts.push(b); fxEnsureLoop(); }
  return b;
}
function fxCanvasEl(kind) {
  // find-or-create: the round A/B code clears #fxlayer / #fxcutin via
  // innerHTML (duel reset, cut-in show), which would wipe a static
  // canvas — so the particle canvases re-create themselves on demand
  // and always land back inside their table row's host.
  const id = kind === 'low' ? 'fxcv' : 'fxcvTop';
  let c = $(id);
  if (!c) {
    c = document.createElement('canvas');
    c.id = id;
    const host = $(kind === 'low' ? 'fxlayer' : 'fxcutin');
    if (host) host.appendChild(c);
  }
  return c;
}
function fxCtxOf(id) {
  const c = fxCanvasEl(id === 'fxcv' ? 'low' : 'top');
  if (!c || !c.getContext) return null;
  const layer = c.parentElement;
  const w = layer ? layer.clientWidth : 0, h = layer ? layer.clientHeight : 0;
  if (!w || !h) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
// ---- V4 polish: additive bloom painting (proposal 追記 V4).
// Scenes may register drawLow / drawTop hooks fn(ctx, sceneLocalT);
// the pump paints them on the shared FX clock right after the
// particle pass, so light freezes with hit-stop exactly like
// everything else. DOM stays for cards and text; light lives here.
const fxBloomCache = {};
function fxBloomSprite(col) {
  let c = fxBloomCache[col];
  if (c) return c;
  c = fxBloomCache[col] = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.16, 'rgba(255,255,255,.92)'); gr.addColorStop(.38, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}
const fxRingCache = {};
function fxRingSprite(col, wf) {
  const key = col + '|' + wf;
  let c = fxRingCache[key];
  if (c) return c;
  c = fxRingCache[key] = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const a = Math.max(0, .5 - wf), d = Math.min(1, .5 + wf);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(a, 'rgba(0,0,0,0)'); gr.addColorStop(.5, col); gr.addColorStop(d, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}
// V4 R4: rotating conic backdrops are pre-rendered ONCE into an
// offscreen raster per (colour, pattern) and thereafter only
// rotated on the canvas — the DOM versions forced a full repaint
// of a 430-520 px gradient layer on every frame, which the stage-0
// and R3 distributions both identified as the ace/finisher cost.
const fxRasterCache = {};
function fxConicRaster(col, size, onDeg, periodDeg, alpha) {
  const key = col + '|' + size + '|' + onDeg + '|' + periodDeg + '|' + alpha;
  if (fxRasterCache[key]) return fxRasterCache[key];
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const c2 = cv.getContext && cv.getContext('2d');
  if (c2) {
    c2.fillStyle = col; c2.globalAlpha = alpha;
    const cx = size / 2;
    for (let a = 0; a < 360; a += periodDeg) { // CSS conic 'from 0deg' = from the top, clockwise
      c2.beginPath(); c2.moveTo(cx, cx);
      c2.arc(cx, cx, cx, (a - 90) * Math.PI / 180, (a + onDeg - 90) * Math.PI / 180);
      c2.closePath(); c2.fill();
    }
  }
  fxRasterCache[key] = cv; return cv;
}
function fxDrawRotRaster(ctx, cv, cx, cy, rotDeg, alpha) {
  if (!(alpha > 0) || !cv || !cv.width) return;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rotDeg * Math.PI / 180);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
  ctx.restore(); ctx.globalAlpha = 1;
}
function fxDiscRaster(col, size) { // radial wash disc: solid to 30%, gone by 68%
  const key = 'disc|' + col + '|' + size;
  if (fxRasterCache[key]) return fxRasterCache[key];
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const c2 = cv.getContext && cv.getContext('2d');
  if (c2) {
    const g = c2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, col); g.addColorStop(.30, col); g.addColorStop(.68, 'rgba(0,0,0,0)');
    c2.fillStyle = g; c2.fillRect(0, 0, size, size);
  }
  fxRasterCache[key] = cv; return cv;
}
function fxDrawGlow(ctx, x, y, r, col, alpha, additive) {
  if (!(r > 0) || !(alpha > 0)) return;
  if (additive !== false) ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(fxBloomSprite(col), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function fxDrawSoftRing(ctx, x, y, r, col, alpha, wf) {
  if (!(r > 0) || !(alpha > 0)) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(fxRingSprite(col, wf == null ? .10 : wf), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function fxDrawComet(ctx, x1, y1, x2, y2, ext, col, alphaMul, trails) {
  if (!(ext > 0) || !(alphaMul > 0)) return;
  const hx = fxLerp(x1, x2, ext), hy = fxLerp(y1, y2, ext);
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const tail = Math.min(len * .55, 90), tx = hx - ux * tail, ty = hy - uy * tail;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(tx, ty, hx, hy);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.55, col); g.addColorStop(1, '#ffffff');
  ctx.strokeStyle = g;
  ctx.globalAlpha = .95 * alphaMul; ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.globalAlpha = .33 * alphaMul; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.restore();
  if (trails) for (const tr of trails) { if (tr.e > 0 && tr.e < ext) fxDrawGlow(ctx, fxLerp(x1, x2, tr.e), fxLerp(y1, y2, tr.e), 10, col, tr.a * alphaMul); }
  fxDrawGlow(ctx, hx, hy, 16, col, .95 * alphaMul);
  fxDrawGlow(ctx, hx, hy, 34, col, .40 * alphaMul);
}
function fxDrawBurstSet(ctx, cvKind, t, drawn, wantAdd) {
  for (const b of fxBursts) {
    if (b.cv !== cvKind) continue;
    if (!!b.add !== wantAdd) continue;
    const rnd = fxMulberry32(b.seed);
      for (let i = 0; i < b.n && drawn < FX_PARTICLE_CAP; i++) {
        const dl = rnd() * (b.delayMax || 0), life = fxLerp(b.life[0], b.life[1], rnd());
        const age = t - b.t0 - dl;
        if (b.mode === 'spiral') {
          // stream order mirrors the prototype's drawSpiral: a0, r0, col, sz
          const a0 = rnd() * Math.PI * 2, r0 = fxLerp(b.r[0], b.r[1], rnd());
          const col = b.cols[(rnd() * b.cols.length) | 0], sz = fxLerp(b.size[0], b.size[1], rnd());
          if (age < 0 || age > life) continue;
          const u = age / life, ang = a0 + u * b.turns * Math.PI * 2, rad = r0 * (1 - FXE.inCubic(u));
          const px = b.o[0] + Math.cos(ang) * rad, py = b.o[1] + Math.sin(ang) * rad * .62;
          ctx.globalAlpha = Math.sin(Math.PI * u) * (b.alpha || 1);
          const spr = fxSprite(col, 16);
          ctx.drawImage(spr, px - sz, py - sz, sz * 2, sz * 2);
          drawn++;
        } else {
          const sp = fxLerp(b.speed[0], b.speed[1], rnd()), an = b.ang[0] + (rnd() - .5) * b.ang[1];
          const sz = fxLerp(b.size[0], b.size[1], rnd()), col = b.cols[(rnd() * b.cols.length) | 0];
          if (age < 0 || age > life) continue;
          const k = b.dragK || 0; let px, py;
          // drag: distance = sp * (1 - e^{-k t}) / k (t in seconds, sp in px/s).
          // DEVIATION from the prototype, recorded in NOTES: the
          // prototype's divisor (k/1000) made every dragK particle
          // land ~1000x too far away — i.e. off-screen and invisible.
          if (k > 0) { const f = (1 - Math.exp(-k * age / 1000)) / k; px = b.o[0] + Math.cos(an) * sp * f; py = b.o[1] + Math.sin(an) * sp * f + (b.grav || 0) * age * age / 2e6; }
          else { px = b.o[0] + Math.cos(an) * sp * age / 1000; py = b.o[1] + Math.sin(an) * sp * age / 1000 + (b.grav || 0) * age * age / 2e6; }
          const u = age / life, alpha = Math.sin(Math.PI * Math.min(1, u)) * (b.alpha || 1);
          const spr = fxSprite(col, 16), s = sz * (0.6 + 0.4 * Math.sin(Math.PI * u));
          ctx.globalAlpha = alpha; ctx.drawImage(spr, px - s, py - s, s * 2, s * 2);
          drawn++;
        }
      }
  }
  return drawn;
}
const fxCanvasDirty = { low: false, top: false };
function fxPaintCanvases() {
  const t = fxTimeMs;
  fxBursts = fxBursts.filter(b => t - b.t0 <= b.life[1] + (b.delayMax || 0) + 40);
  let drawn = 0;
  for (const cvKind of ['low', 'top']) {
    const hooks = [];
    for (const sc of fxScenes) {
      if (sc.dead) continue;
      const h = cvKind === 'low' ? sc.drawLow : sc.drawTop;
      if (!h) continue;
      // a scene may declare the local-time windows in which its hook
      // actually paints (winLow / winTop: [[a, b], ...]); outside
      // them the canvas is left completely untouched — a full-screen
      // clear + repaint every frame for an idle hook is exactly the
      // kind of cost V4 exists to remove.
      const win = cvKind === 'low' ? sc.winLow : sc.winTop;
      if (win) { const lt = t - sc.t0; let on = false; for (const sg of win) { if (lt >= sg[0] && lt <= sg[1]) { on = true; break; } } if (!on) continue; }
      hooks.push([sc, h]);
    }
    const hasBursts = fxBursts.some(b => b.cv === cvKind);
    const id = cvKind === 'low' ? 'fxcv' : 'fxcvTop';
    if (!hooks.length && !hasBursts) {
      if (fxCanvasDirty[cvKind]) {
        const ctx0 = fxCtxOf(id);
        if (ctx0) { const layer0 = $(id).parentElement; ctx0.clearRect(0, 0, layer0.clientWidth, layer0.clientHeight); }
        fxCanvasDirty[cvKind] = false;
      }
      continue;
    }
    const ctx = fxCtxOf(id);
    if (!ctx) continue;
    const layer = $(id).parentElement;
    ctx.clearRect(0, 0, layer.clientWidth, layer.clientHeight);
    drawn = fxDrawBurstSet(ctx, cvKind, t, drawn, false);
    ctx.globalAlpha = 1;
    // V4: bursts flagged add paint in a second, additive pass (light,
    // not dust) — still inside the shared particle budget.
    if (fxBursts.some(b => b.cv === cvKind && b.add)) {
      ctx.globalCompositeOperation = 'lighter';
      drawn = fxDrawBurstSet(ctx, cvKind, t, drawn, true);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    for (const pair of hooks) { try { pair[1](ctx, t - pair[0].t0); } catch (e) { fxError = fxError || ('paint hook: ' + (e && e.message)); } }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    fxCanvasDirty[cvKind] = true;
  }
}
function fxDrawParticles() { fxPaintCanvases(); }
// Foundation self-check scene (verification only): a 90-particle
// spiral+burst over the board centre on the shared clock. Driven via
// window.__fx.stress() by the stage-1 FPS / freeze harness.
function fxStressScene() {
  const app = $('app'); if (!app) return null;
  const r = fxRel(app), cx = r.cx, cy = r.y + r.h * 0.42;
  fxSpawnBurst('low', { mode: 'spiral', seed: 11, o: [cx, cy], n: 46, life: [500, 850], r: [46, 96], turns: 1.6, size: [3, 7], cols: ['#9a6bff', '#cdb2ff', '#5a8cff'], delayMax: 280, alpha: .95 });
  fxSpawnBurst('low', { seed: 23, o: [cx, cy], n: 44, life: [600, 1100], speed: [90, 260], ang: [0, Math.PI * 2], grav: 300, dragK: 2.2, size: [3, 7], cols: ['#9a6bff', '#cdb2ff', '#ffffff'], alpha: .95 });
  return fxAddScene({ kind: 'stress', dur: 3000, render: () => {} });
}
function fxResetFoundation() {
  fxScenes = []; fxBursts = [];
  fxStopUntilWall = 0; fxTimeMs = 0; fxLastWall = 0;
  fxAceSceneRef = null; fxFinisherSceneRef = null; fxAceRecent = null; fxKeycardSceneRef = null; // stage 3 scene refs (hosts are wiped by fxResetDuel)
  fxChainWordScene = null; fxBannerScene = null; // V4 scene refs
  // redesign E: the sweep's leftovers live outside #fxlayer (the
  // hairline is a #midbar child, the seated state a #phaseinfo
  // class) — clear them explicitly so no gold survives a reset
  fxPhaseSweepEl = null; fxPhaseClearSeated();
  try { fxChainLanded.clear(); } catch (e) {} // redesign B: landed flags never survive a duel reset
  const appEl = $('app'); if (appEl) appEl.style.transform = ''; // a finisher tilt must not survive the duel
  for (const id of ['fxcv', 'fxcvTop']) { const c = $(id); if (c && c.getContext) { const x = c.getContext('2d'); if (x) x.clearRect(0, 0, c.width, c.height); } }
  fxCanvasDirty.low = fxCanvasDirty.top = false;
}

// ------------------------------------------------------------ FX snapshots
function fxSnap(state) {
  const z = {};
  for (let p = 0; p < 2; p++) {
    const P = state.players[p];
    for (let s = 0; s < 5; s++) { const c = P.mzone[s]; z[p + ':' + E.LOC.MZONE + ':' + s] = c ? { code: c.code, pos: c.pos, mats: c.materials || 0, atk: c.curAtk, def: c.curDef } : null; }
    for (let s = 0; s < 6; s++) { const c = P.szone[s]; z[p + ':' + E.LOC.SZONE + ':' + s] = c ? { code: c.code, pos: c.pos } : null; }
  }
  return {
    z,
    grave: state.players.map(P => P.grave.slice()),
    removed: state.players.map(P => P.removed.slice()),
    extra: state.players.map(P => P.extra.map(e => e.code)),
    deck: state.players.map(P => P.deckCount),
    handLen: state.players.map(P => P.hand.length),
    myHand: state.players[HP].hand.map(c => c.code),
    phaseFam: fxPhaseFamily(state.phaseName), turn: state.turnCount,
    chainLen: state.chain.length, solving: state.solvingLink,
    links: state.chain.map(l => ({ code: l.code, con: l.con, solved: !!l.solved, neg: !!(l.negated || l.disabled) })),
    lp: state.players.map(P => P.lp), winner: state.winner,
  };
}
function fxBagDiff(before, after) {
  const count = (arr) => { const m = new Map(); for (const c of arr) m.set(c, (m.get(c) || 0) + 1); return m; };
  const bm = count(before), am = count(after), added = [], removed = [];
  am.forEach((n, c) => { for (let i = 0; i < n - (bm.get(c) || 0); i++) added.push(c); });
  bm.forEach((n, c) => { for (let i = 0; i < n - (am.get(c) || 0); i++) removed.push(c); });
  return { added, removed };
}
function fxMethodOf(code) {
  const d = code != null ? cardData(code) : null;
  if (!d) return 'generic';
  if (d.type & 0x40) return 'fusion';
  if (d.type & 0x800000) return 'xyz';
  if (d.type & 0x2000) return 'synchro';
  return 'generic';
}
function fxCaptureDom() { // pre-render hand geometry for the FLIP reflow
  fxHandRects = [...document.querySelectorAll('#hand .hcard')].map(el => {
    const r = fxRel(el);
    return { code: el.dataset.code != null ? +el.dataset.code : null, cx: r.cx, cy: r.cy, w: r.w, h: r.h };
  });
}
function fxResetDuel() {
  fxResetFoundation(); // V3 stage 1: scenes / bursts / the FX clock restart with the duel
  fxPrev = null; fxHandRects = []; fxLog.length = 0; fxError = null;
  const layer = fxLayerEl(); if (layer) layer.innerHTML = '';
  const cut = $('fxcutin'); if (cut) { cut.className = ''; cut.innerHTML = ''; }
  fxResetRoundB();
}
// ------------------------------------------------------------ FX processor
function fxProcess(evs, state) {
  if (!state || !state.players || !fxLayerEl()) return;
  try { fxProcessInner(evs || [], state); }
  catch (e) { fxError = String((e && e.stack) || e); }
}
function fxProcessInner(evs, state) {
  const cur = fxSnap(state);
  const prev = fxPrev;
  fxPrev = cur;
  if (!prev) return; // first update of the duel is the baseline, nothing "happened" yet
  // redesign B (p2b): a chain that emptied or shrank (ended /
  // rebuilt) takes its landed flags with it — the next chain
  // starts un-absorbed and re-earns the gold on its own landings
  if (cur.chainLen === 0 || cur.chainLen < prev.chainLen) { try { fxChainLanded.clear(); } catch (e) {} }
  // ---- phase banner (3-8): only at the transition, an overlay band
  if (cur.phaseFam && cur.phaseFam !== prev.phaseFam && cur.turn > 0) fxPhaseBanner(cur.phaseFam);
  // ---- zone cell diffs
  const arrived = [], departed = [], changed = [];
  for (const key of Object.keys(cur.z)) {
    const a = prev.z[key], b = cur.z[key];
    if (!a && b) arrived.push({ key, entry: b });
    else if (a && !b) departed.push({ key, entry: a });
    else if (a && b) changed.push({ key, before: a, after: b });
  }
  const evSummon = evs.filter(e => e.kind === 'summon'), evSp = evs.filter(e => e.kind === 'spsummon');
  const graveD = cur.grave.map((g, p) => fxBagDiff(prev.grave[p], g));
  const remD = cur.removed.map((g, p) => fxBagDiff(prev.removed[p], g));
  const extraD = cur.extra.map((g, p) => fxBagDiff(prev.extra[p], g));
  const flashed = new Set(); // piles already given a landing reaction this batch
  const pileLand = (con, kind) => { const k = kind + ':' + con; if (!flashed.has(k)) { flashed.add(k); fxPileFlash(con, kind); } };
  const ptOf = (key) => { const el = fxSlotEl(key); return el ? fxRel(el) : null; };
  const handPt = (con) => {
    if (con === HP) { const el = $('handbar'); return el ? fxRel(el) : null; }
    const el = $('opppiles'); return el ? fxRel(el) : null;
  };
  const pilePt = (con, kind) => { const el = fxPileEl(con, kind); return el ? fxRel(el) : null; };
  const consumedArr = new Set(), consumedDep = new Set();
  // Redesign I(1) — deck -> grave accounting: codes that ALREADY flew
  // to a graveyard in this batch (field departures below, then the
  // own-hand departures further down), as a per-player multiset.
  // The deck-origin pass after the hand movements subtracts these
  // from graveD[p].added; flying a code twice (e.g. a hand discard
  // re-flown as if it came from the deck) is forbidden, so every
  // grave flight in this batch MUST register here.
  const graveFlown = [[], []];
  // ---- control change: a monster leaves one field and appears on the
  // other in the same batch — it slides (supplement), never teleports
  for (const ar of arrived) {
    if (ar.entry.code == null) continue;
    const [con, loc] = ar.key.split(':').map(Number);
    if (loc !== E.LOC.MZONE) continue;
    const dep = departed.find(d => !consumedDep.has(d.key) && d.entry.code === ar.entry.code &&
      d.key.split(':').map(Number)[0] === 1 - con && d.key.split(':').map(Number)[1] === E.LOC.MZONE);
    if (dep) {
      consumedDep.add(dep.key); consumedArr.add(ar.key);
      fxSlide(dep.key, ar.key, ar.entry.code, (ar.entry.pos & E.POS_FACEUP) === 0);
      fxRecord('controlslide', { code: ar.entry.code });
    }
  }
  // ---- field departures: the destination is what reads (3-5)
  const fieldDeps = departed.filter(d => !consumedDep.has(d.key));
  const destOfDep = (dep) => { // returns {kind:'grave'|'removed'|'extra'|'hand'|'deck'|'gone', idx}
    const [con] = dep.key.split(':').map(Number);
    const code = dep.entry.code;
    if (code != null) {
      if (graveD[con].added.includes(code)) return 'grave';
      if (remD[con].added.includes(code)) return 'removed';
      if (extraD[con].added.includes(code)) return 'extra';
    }
    return null;
  };
  // ---- arrivals on the monster zone: summons & returns
  const spArrivals = arrived.filter(a => !consumedArr.has(a.key) && a.key.split(':').map(Number)[1] === E.LOC.MZONE);
  // fusion / xyz materials: same-controller field departures in this batch
  const matDepsOf = (con) => fieldDeps.filter(d => !consumedDep.has(d.key) &&
    d.key.split(':').map(Number)[0] === con && d.key.split(':').map(Number)[1] === E.LOC.MZONE);
  for (const ar of spArrivals) {
    const [con] = ar.key.split(':').map(Number);
    const code = ar.entry.code;
    const fromGrave = code != null && graveD[con].removed.includes(code);
    const fromRemoved = code != null && remD[con].removed.includes(code);
    const method = fxMethodOf(code);
    const isSp = evSp.length > 0, isNormal = evSummon.length > 0 && !isSp;
    const isSetMon = !isSp && !isNormal && code != null &&
      evs.some(e => e.kind === 'set' && e.loc === E.LOC.MZONE && e.con === con && e.code === code);
    if (fromGrave || fromRemoved) { // revival / return: NO flight — the zone lights and it appears
      fxPortal(ar.key, 'revive', 700); // V4-5: the zone glow is folded into the portal scene
      fxRecord('portal', { method: 'revive', code });
      if ((ar.entry.pos & E.POS_FACEUP) !== 0) { // FX coverage: a revival names its card too
        fxSummonCallout(ar.key, code, con, ar.entry.pos);
        fxRecord('summoncall', { code, how: 'revive', con });
      }
      consumedArr.add(ar.key);
      continue;
    }
    // V3 stage 3: an ace arrival (cut-in roster, setting ON) is
    // owned end-to-end by the ace scene — the round-A converge /
    // portal and the round-B cut-in for this summon stand down.
    if (fxSettings.cutin && code != null && FX_CUTIN_CODES.has(code)) {
      // the summon EVENT may have beaten the state diff (the two
      // land in different fxProcess batches): if the event pass
      // already owns this summon, stand down completely.
      if (fxAceRecent && fxAceRecent.code === code && fxAceRecent.con === con && fxTimeMs <= fxAceRecent.until) { consumedArr.add(ar.key); continue; }
      const mats = (method === 'fusion' || method === 'xyz' || method === 'synchro') ? matDepsOf(con) : [];
      const sc = fxAceSceneV3({ code, key: ar.key, con, method, mats: mats.map(m => ({ key: m.key, code: m.entry.code })) });
      if (sc) {
        for (const m of mats) { consumedDep.add(m.key); fxRecord('converge', { code: m.entry.code, via: 'acescene' }); }
        fxRecord('portal', { method, code, via: 'acescene' });
        fxRecord('cutin', { code, via: 'acescene' });
        fxAceRecent = { code, con, until: fxTimeMs + 8000 };
        consumedArr.add(ar.key);
        continue;
      }
      // scene busy (another ace is presenting): fall through to
      // the normal treatment below.
    }
    if (method === 'fusion' || method === 'xyz') {
      const mats = matDepsOf(con);
      for (const m of mats) { consumedDep.add(m.key); fxConverge(m.key, ar.key); fxRecord('converge', { code: m.entry.code }); }
      fxPortal(ar.key, method, 640); // V4-5: glow folded in
      fxRecord('portal', { method, code });
      consumedArr.add(ar.key);
      continue;
    }
    if (method === 'synchro') {
      // Proposal S: a synchro gets its own scene (materials light,
      // levels accumulate, the stone ring closes) instead of the
      // generic portal — but ONLY when every material's level can
      // be read. Otherwise fall through to the generic portal below
      // and let the materials fly individually: the presentation
      // never invents a level it could not read.
      const mats = matDepsOf(con);
      const info = fxSynchroInfo(mats.map(m => ({ key: m.key, code: m.entry.code })));
      const sc = info ? fxSynchroSceneV3({ code, key: ar.key, con, info }) : null;
      if (sc) {
        for (const m of mats) { consumedDep.add(m.key); fxRecord('converge', { code: m.entry.code, via: 'synchro' }); }
        fxRecord('synchro', { code, total: info.total, tunerCodes: info.tunerCodes });
        consumedArr.add(ar.key);
        continue;
      }
    }
    if (isNormal || isSetMon) {
      fxPuff(ar.key); fxRecord('place', { how: isNormal ? 'summon' : 'set', code });
      if (isNormal && (ar.entry.pos & E.POS_FACEUP) !== 0) { // FX coverage: the plainest summon in the game was the one with no card presentation at all
        fxSummonCallout(ar.key, code, con, ar.entry.pos);
        fxRecord('summoncall', { code, how: 'summon', con });
      }
      // Round B (B10): an advance (tribute) summon's tributes leave the
      // way fusion/Xyz materials do — they glow and converge into the
      // summon point instead of flying to the graveyard — and the
      // arrival light is a touch stronger. No seniority ceremony.
      const lv = code != null && cardData(code) ? cardData(code).level : 0;
      if (lv >= 5) {
        const mats = matDepsOf(con);
        for (const m of mats) { consumedDep.add(m.key); fxConverge(m.key, ar.key); fxRecord('converge', { code: m.entry.code, how: 'tribute' }); }
        fxZoneGlow(ar.key, 850);
        fxRecord('advance', { code, level: lv });
      }
      consumedArr.add(ar.key); continue;
    }
    // other special summons (from hand / deck / extra): zone glows first
    fxPortal(ar.key, method, 600); // V4-5: glow folded in
    fxRecord('portal', { method, code });
    if ((ar.entry.pos & E.POS_FACEUP) !== 0) { // FX coverage: the portal lights the zone; the callout names the card (never for a face-down arrival — not public yet)
      fxSummonCallout(ar.key, code, con, ar.entry.pos);
      fxRecord('summoncall', { code, how: 'spsummon', con });
    }
    consumedArr.add(ar.key);
  }
  // arrivals on the spell/trap zone (sets): a small placement beat
  for (const ar of arrived) {
    if (consumedArr.has(ar.key)) continue;
    if (ar.key.split(':').map(Number)[1] === E.LOC.SZONE) { fxPuff(ar.key); fxRecord('place', { how: 'set', code: ar.entry.code }); consumedArr.add(ar.key); }
  }
  // remaining departures fly / vanish by destination
  for (const dep of fieldDeps) {
    if (consumedDep.has(dep.key)) continue;
    consumedDep.add(dep.key);
    const [con] = dep.key.split(':').map(Number);
    const fromPt = ptOf(dep.key);
    const faceDown = (dep.entry.pos & E.POS_FACEUP) === 0;
    const dest = destOfDep(dep);
    if (dest === 'grave' || dest === 'removed' || dest === 'extra') {
      const toPt = pilePt(con, dest);
      fxRecord('flight', { to: dest, code: dep.entry.code }); // intent is recorded even if a rect is momentarily unreadable; the ghost spawns when geometry exists (always, post-render)
      if (dest === 'grave' && dep.entry.code != null) graveFlown[con].push(dep.entry.code); // I(1): already flown — the deck-origin pass must not fly it again
      if (fromPt && toPt) fxFly(dep.entry.code, faceDown, fromPt, toPt, fromPt.w - 2, fromPt.h - 24, undefined, undefined, deckKeyOfSeat(con));
      pileLand(con, dest);
    } else if (cur.handLen[con] > prev.handLen[con]) { // bounced to a hand
      const toPt = handPt(con);
      fxRecord('flight', { to: 'hand', code: dep.entry.code });
      if (fromPt && toPt) fxFly(dep.entry.code, faceDown, fromPt, toPt, fromPt.w - 2, fromPt.h - 24, undefined, undefined, deckKeyOfSeat(con));
    } else if (cur.deck[con] > prev.deck[con]) { // returned to the deck: vanishes in place
      fxVanish(dep.key, dep.entry.code, faceDown);
      fxRecord('vanish', { to: 'deck', code: dep.entry.code });
      pileLand(con, 'deck');
    } else { // token / material / untracked: a quiet fade
      fxVanish(dep.key, dep.entry.code, faceDown);
      fxRecord('vanish', { to: 'gone', code: dep.entry.code });
    }
  }
  // destroy events: white flash at the zone the card occupied.
  // V3 stage 2: if this batch's attack scene targets that zone, the
  // scene owns the white peak (timed to the blow at its t=350) — an
  // immediate flash here would double it into a strobe.
  const atkTargetKeys = new Set(fxAttackKeys(evs, state).map(x => x.tKey).filter(Boolean));
  for (const ev of evs) {
    if (ev.kind !== 'destroy') continue;
    const dep = departed.find(d => d.entry.code === ev.code && d.key.split(':').map(Number)[0] === ev.con);
    if (dep) {
      const viaScene = atkTargetKeys.has(dep.key);
      if (viaScene) fxRecord('destroyflash', { code: ev.code, via: 'scene' });
      else { fxWhiteFlash(dep.key); fxRecord('destroyflash', { code: ev.code }); }
      // Redesign C (proto 案3): the result chip is for BATTLE
      // destruction only — the destroy event's battle flag
      // (engine: reason & 0x20), or a destruction this batch's
      // attack scene owns (its target zone). Effect destruction
      // (battle flag clear, no attack scene) gets NO chip: its
      // grammar stays the white flash + flight above.
      if (ev.battle || viaScene) {
        fxResultChip(dep.key, ev.code);
        fxRecord('resultchip', { code: ev.code, key: dep.key, battle: !!ev.battle, via: viaScene ? 'scene' : 'battle' });
      }
    }
  }
  // ---- flip summons (FX coverage): the flip itself is animated by
  // the changed-diff below (round B); the callout names the card —
  // a flip summon is a summon, and every summon presents its card.
  for (const ev of evs) {
    if (ev.kind !== 'flipsummon' || ev.code == null) continue;
    for (const key of Object.keys(cur.z)) {
      const ze = cur.z[key], parts = key.split(':').map(Number);
      if (ze && ze.code === ev.code && parts[0] === ev.con && parts[1] === E.LOC.MZONE) {
        if ((ze.pos & E.POS_FACEUP) !== 0) {
          fxSummonCallout(key, ev.code, ev.con, ze.pos);
          fxRecord('summoncall', { code: ev.code, how: 'flipsummon', con: ev.con });
        }
        break;
      }
    }
  }
  // ---- in-place changes: xyz detach / attach, stat changes, flips (round B hook)
  for (const ch of changed) {
    const [con, loc] = ch.key.split(':').map(Number);
    if (loc !== E.LOC.MZONE) { fxRoundBChanged(ch, evs, prev, cur); continue; }
    if (ch.before.code === ch.after.code) {
      if ((ch.after.mats || 0) < (ch.before.mats || 0)) { fxPeel(ch.key); fxRecord('peel', { code: ch.after.code }); }
      else if ((ch.after.mats || 0) > (ch.before.mats || 0)) { fxZoneGlow(ch.key, 450); fxRecord('attach', { code: ch.after.code }); }
      if (ch.before.atk != null && ch.after.atk != null && (ch.before.atk !== ch.after.atk || ch.before.def !== ch.after.def)) {
        fxStripFlash(ch.key);
        fxRecord('statflash', { code: ch.after.code });
      }
    }
    fxRoundBChanged(ch, evs, prev, cur);
  }
  // ---- hand movements (own hand: identities known)
  const myD = fxBagDiff(prev.myHand, cur.myHand);
  for (const code of myD.added) {
    let fromPt = null, fromKind = null;
    if (graveD[HP].removed.includes(code)) { fromPt = pilePt(HP, 'grave'); fromKind = 'grave'; }
    else if (remD[HP].removed.includes(code)) { fromPt = pilePt(HP, 'removed'); fromKind = 'removed'; }
    else if (extraD[HP].removed.includes(code)) { fromPt = pilePt(HP, 'extra'); fromKind = 'extra'; }
    else if (cur.deck[HP] < prev.deck[HP]) { fromPt = pilePt(HP, 'deck'); fromKind = 'deck'; }
    const toPt = handPt(HP);
    if (fromKind) fxRecord('flight', { to: 'hand', from: fromKind, code });
    if (fromPt && toPt) fxFly(code, false, fromPt, toPt, 44, 58, undefined, undefined, deckKeyOfSeat(HP));
  }
  for (const code of myD.removed) {
    // placed on the field? the arrival/puff already tells it — no flight (grammar asymmetry)
    const placed = arrived.some(a => a.entry.code === code);
    if (placed) continue;
    const fromRect = fxHandRects.find(r => r.code === code);
    const fromPt = fromRect || handPt(HP);
    if (graveD[HP].added.includes(code)) { const toPt = pilePt(HP, 'grave'); fxRecord('flight', { to: 'grave', from: 'hand', code }); graveFlown[HP].push(code); if (fromPt && toPt) fxFly(code, false, fromPt, toPt, 44, 58, undefined, undefined, deckKeyOfSeat(HP)); pileLand(HP, 'grave'); }
    else if (remD[HP].added.includes(code)) { const toPt = pilePt(HP, 'removed'); fxRecord('flight', { to: 'removed', from: 'hand', code }); if (fromPt && toPt) fxFly(code, false, fromPt, toPt, 44, 58, undefined, undefined, deckKeyOfSeat(HP)); pileLand(HP, 'removed'); }
    else if (cur.deck[HP] > prev.deck[HP]) { if (fromRect) { const layer = fxLayerEl(); const d = fxPlaceGhost(code, false, fromRect, fromRect.w - 2, fromRect.h - 2, deckKeyOfSeat(HP)); if (d) { fxAnim(d, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.55)', opacity: 0 }], { duration: 320, easing: 'ease-in' }); fxKill(d, 360); } } fxRecord('vanish', { to: 'deck', from: 'hand', code }); pileLand(HP, 'deck'); }
  }
  // opponent hand count changes: draws fly in as card backs
  const opp = 1 - HP;
  if (cur.handLen[opp] > prev.handLen[opp] && cur.deck[opp] < prev.deck[opp]) {
    const fromPt = pilePt(opp, 'deck'), toPt = handPt(opp);
    fxRecord('flight', { to: 'opphand', from: 'deck' });
    if (fromPt && toPt) fxFly(null, true, fromPt, toPt, 40, 52);
  }
  // ---- deck -> grave (redesign I(1)): cards an effect sends
  // straight from the deck to the graveyard (《おろかな副葬》's
  // resolution, mills, ...) previously only ticked the grave
  // counter — nothing flew, so "what fell" could not be followed.
  // Deck-origin candidates are what is LEFT of graveD[p].added
  // after subtracting (as a multiset, one occurrence per flight)
  // every code that already flew to that grave in this batch from
  // the field or the hand (graveFlown, filled above). A candidate
  // flies ONLY when the deck actually shrank, and never more
  // cards than the deck shrank by — the count/code cross-check
  // that keeps a hand discard (deck unchanged) or an unrelated
  // grave arrival from ever being re-flown as a deck card.
  // DEVIATION from proposals-rest item I, deliberate and decided:
  // the proposal's wording has a face-DOWN (card-back) ghost fly,
  // but the decided behaviour is a face-UP ghost. The graveyard
  // is public information and the point of this item is that the
  // player can follow WHAT fell — a back would hide exactly that.
  // Multiple cards falling together stagger by 110 ms per card
  // (the fxFly delay above), in grave-arrival order.
  // Scope: grave only — deck -> removed / hand / field are not
  // covered here (draws/searches already have their own grammar).
  for (let p = 0; p < 2; p++) {
    const deckDrop = prev.deck[p] - cur.deck[p];
    if (deckDrop <= 0) continue;
    const residual = graveD[p].added.slice();
    for (const flown of graveFlown[p]) {
      const i = residual.indexOf(flown);
      if (i >= 0) residual.splice(i, 1);
    }
    if (!residual.length) continue;
    const n = Math.min(residual.length, deckDrop);
    const fromPt = pilePt(p, 'deck'), toPt = pilePt(p, 'grave');
    for (let i = 0; i < n; i++) {
      const code = residual[i];
      fxRecord('flight', { to: 'grave', from: 'deck', code }); // from:'deck' is the deck-origin marker (same `from` convention as the hand flights)
      if (fromPt && toPt) fxFly(code, false, fromPt, toPt, 44, 58, 430, i * 110, deckKeyOfSeat(p));
    }
    if (n > 0) pileLand(p, 'grave');
  }
  // ---- pile count ticks where no flight already landed
  for (let p = 0; p < 2; p++) {
    if (graveD[p].added.length || graveD[p].removed.length) pileLand(p, 'grave');
    if (remD[p].added.length || remD[p].removed.length) pileLand(p, 'removed');
    if (extraD[p].added.length || extraD[p].removed.length) pileLand(p, 'extra');
    if (cur.deck[p] !== prev.deck[p]) pileLand(p, 'deck');
  }
  // ---- hand reflow (FLIP): surviving cards slide to their new spots
  if (fxHandRects.length) {
    const used = new Array(fxHandRects.length).fill(false);
    document.querySelectorAll('#hand .hcard').forEach(el => {
      const code = el.dataset.code != null ? +el.dataset.code : null;
      if (code == null) return;
      const i = fxHandRects.findIndex((r, j) => !used[j] && r.code === code);
      if (i < 0) return;
      used[i] = true;
      const now = fxRel(el), dx = fxHandRects[i].cx - now.cx, dy = fxHandRects[i].cy - now.cy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        fxAnim(el, [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0px,0px)' }], { duration: 280, easing: 'ease-out' });
        fxRecord('reflow', { code });
      }
    });
  }
  fxRoundBEvents(evs, prev, cur, { arrived, departed, changed, state });
}
// ------------------------------------------------------------ FX round B
// Settings (B11): presentation toggles, persisted best-effort. They
// only ever change how prompts/effects are PRESENTED — never the
// legal answers the core offers: chain 'off' answers pass (i32 -1),
// which SELECT_CHAIN always accepts; chain 'on' merely un-hides
// candidates the player had dismissed earlier in the duel.
const fxSettings = { cutin: true, resp: 'auto' }; // resp: 'auto' | 'on' | 'off'
try {
  const savedFx = JSON.parse(localStorage.getItem('v2fx') || 'null');
  if (savedFx) {
    if (typeof savedFx.cutin === 'boolean') fxSettings.cutin = savedFx.cutin;
    if (savedFx.resp === 'auto' || savedFx.resp === 'on' || savedFx.resp === 'off') fxSettings.resp = savedFx.resp;
  }
} catch (e) {}
function fxSaveSettings() { try { localStorage.setItem('v2fx', JSON.stringify(fxSettings)); } catch (e) {} }
// Ace cut-in roster (B6): the same boss class as the BGM key-card list
// (NOTES "BGM 3-stage") — the eight SUMMON-trigger key cards. The two
// key TRAPS (墓守の罠 / 現世と冥界の逆転) latch the BGM stage on
// ACTIVATION; a cut-in is a summon presentation with an ATK/DEF
// banner, and a trap has neither a summon nor ATK/DEF, so trap
// activations keep the chain/showcase presentation (see NOTES).
const FX_CUTIN_CODES = KEYCARD_CODES;
function fxPtOfKey(key) { const el = fxSlotEl(key); return el ? fxRel(el) : null; }
// ---- LP counter (B7): damage/recovery counts on the counter itself;
// a heal additionally floats a blue number (MD shows floats only there)
const fxLpShown = [null, null];   // per seat: the value the counter currently shows
const fxLpScenes = [null, null];  // per seat: active count scene (render defers to it)
function fxLpBusy(con) { return !!fxLpScenes[con] && !fxLpScenes[con].dead; }
function fxLpEl(con) { return con === HP ? $('myLp') : $('oppLp'); }
// V3 stage 2: the count runs on the shared FX clock (600 ms,
// easeOutCubic — proposal L11), so it can be SCHEDULED: after an
// attack the count starts at attack+400 ms, after the impact has
// landed (cause before effect). A damage drop also carries the red
// damage number at the LP plate (L10): an accent at the counter —
// the counter itself stays the primary readout. A scene that is
// superseded mid-count restarts from the value currently shown.
function fxLpCount(con, to, startAtFx, opts) {
  const el = fxLpEl(con); if (!el) return;
  // V3 stage 3: while a finisher scene owns this seat's counter
  // (its LP drain), no count scene is started for it
  if (fxLpScenes[con] && !fxLpScenes[con].dead && fxLpScenes[con].kind === 'finisher') return;
  if (fxLpScenes[con] && !fxLpScenes[con].dead) { const old = fxLpScenes[con]; old.dead = true; if (old.cleanup) old.cleanup(); }
  fxLpScenes[con] = null;
  const start = fxLpShown[con];
  if (start == null || start === to) { fxLpShown[con] = to; el.textContent = to; return; }
  // Redesign A / F1: pin the counter to the START value the moment
  // the scene is created. render() runs BEFORE fxProcess in
  // onUpdate and only defers to a count scene that already exists,
  // so by the time we get here the DOM already shows the batch's
  // FINAL value. Without this pin the final value is what the
  // player sees until the count starts, and the count then jumps
  // BACK to the start — a non-monotonic display (audit-fx F1).
  // Pinning synchronously at creation closes that window before
  // any paint can happen; the delay branch below then re-writes
  // the start value unconditionally on every frame.
  el.textContent = start;
  const delay = Math.max(0, (startAtFx != null ? startAtFx : fxTimeMs) - fxTimeMs);
  const isDmg = to < start;
  // Redesign A / F2: the opponent's LP plate sits at the very top
  // of the screen, so the upward damage number (anchored above the
  // plate, translateY(-100%)) was clipped by the viewport. The
  // opponent variant anchors at the plate's BOTTOM edge and drifts
  // DOWN into the board (proto p1c: the glyph box sits at the
  // plate's lower interior, fully on screen). My own plate (mid
  // screen) keeps the upward form.
  const dmgDown = isDmg && con !== HP;
  // Redesign F: a NON-battle LP drop (effect damage / LP cost) is
  // presented by its own chip (fxLpChip), not by this battle damage
  // number — the LP loop passes opts.noNum for those batches so the
  // drop is shown exactly once, in the chip grammar. Battle drops
  // (attack-scheduled, startAtFx set) keep the number and get NO chip.
  let numEl = null;
  if (isDmg && !(opts && opts.noNum)) {
    const layer = fxLayerEl(), r = fxRel(el);
    if (layer && r) {
      numEl = document.createElement('div');
      numEl.className = 'fx fx3-dmgnum' + (dmgDown ? ' fx3-dmgnum--down' : '');
      numEl.textContent = '−' + (start - to);
      numEl.style.left = r.cx + 'px'; numEl.style.top = (dmgDown ? (r.y + r.h - 3) : (r.y - 2)) + 'px';
      numEl.style.opacity = '0';
      layer.appendChild(numEl);
    }
  }
  let flashed = false;
  const sc = fxAddScene({
    kind: 'lpcount', dur: delay + 620,
    render(t) {
      const tt = t - delay;
      if (tt < 0) { fxLpShown[con] = start; el.textContent = start; } // F1: unconditional — in the delay window the DOM must hold the start value on EVERY frame, so no path (a stray render, a superseding batch) can flash the final value first
      else {
        if (isDmg && !flashed) { flashed = true; el.classList.remove('lpflash'); void el.offsetWidth; el.classList.add('lpflash'); }
        const u = Math.min(1, tt / 600);
        const v = Math.round(start + (to - start) * FXE.outCubic(u));
        if (v !== fxLpShown[con]) { fxLpShown[con] = v; el.textContent = v; }
      }
      if (numEl) { // L10 window: [delay+20, delay+600] of the scene
        const nu = fxSeg(t, delay + 20, delay + 600);
        if (nu <= 0 || nu >= 1) { numEl.style.opacity = '0'; }
        else {
          const s = 1.45 - 0.45 * FXE.settle(fxSeg(t, delay + 20, delay + 150));
          const fade = Math.min(fxSeg(t, delay + 20, delay + 60) * 2, 1, (1 - fxSeg(t, delay + 480, delay + 600)) * 1.6 + 0.15);
          numEl.style.opacity = String(Math.max(0, Math.min(1, fade)));
          numEl.style.transform = dmgDown
            ? 'translate(-50%,0) translateY(' + (8 * nu) + 'px) scale(' + s.toFixed(3) + ')'
            : 'translate(-50%,-100%) translateY(' + (-8 * nu) + 'px) scale(' + s.toFixed(3) + ')';
        }
        // V4: the number runs white-hot for its first 70 ms, then
        // cools to the standard red (3 quantized steps, not a ramp)
        const hot = t - (delay + 20);
        const hstep = hot < 35 ? 0 : hot < 70 ? 1 : 2;
        if (numEl._hs !== hstep) { numEl._hs = hstep; numEl.style.color = hstep === 0 ? '#ffffff' : hstep === 1 ? '#ffc9c2' : '#ff5348'; }
      }
    },
    onDone() {
      fxLpShown[con] = to; el.textContent = to;
      el.classList.remove('lpflash');
      if (numEl) numEl.remove();
      if (fxLpScenes[con] === sc) fxLpScenes[con] = null;
    },
  });
  sc.cleanup = () => { if (numEl) numEl.remove(); el.classList.remove('lpflash'); };
  fxLpScenes[con] = sc;
}
function fxHealFloat(con, amount) {
  const el = fxLpEl(con); if (!el) return;
  const r = fxRel(el); if (!r) return;
  const layer = fxLayerEl(); if (!layer) return;
  // Redesign F (audit F2 remainder): the opponent's LP plate sits at
  // the very top of the screen, so the old float — anchored at the
  // plate's top edge (r.y) and rising 26px — was clipped. The
  // opponent variant follows the redesign-A damage-number rule:
  // anchor at the plate's BOTTOM interior edge and drift DOWN into
  // the board. My own plate keeps the original upward float.
  // Redesign F heal grammar: this node IS the heal chip — it also
  // carries the fx3-lpchip classes (gold for me, lapis-white for the
  // opponent), so a heal is presented exactly once, as one node.
  const down = con !== HP;
  const d = document.createElement('div');
  d.className = 'fx fx-healfloat fx3-lpchip fx3-lpchip--heal fx3-lpchip--' + (down ? 'opp' : 'mine') +
    (down ? ' fx-healfloat--down fx3-lpchip--down' : '');
  d.dataset.direction = down ? 'down' : 'up';
  d.dataset.lpKind = 'heal';
  d.textContent = '+' + amount;
  d.style.left = r.cx + 'px'; d.style.top = (down ? (r.y + r.h - 3) : r.y) + 'px';
  layer.appendChild(d);
  // same on-screen clamp as fxLpChip (see there)
  const appW = $('app').getBoundingClientRect().width, halfW = d.offsetWidth / 2;
  if (appW > 0 && halfW > 0) d.style.left = Math.max(halfW + 2, Math.min(r.cx, appW - halfW - 2)) + 'px';
  // Chip lifetime: the float rises (or, downward variant, sinks)
  // quickly, then HOLDS fully visible before fading — the same
  // residual-light linger as the pay/damage chips, at float scale.
  if (down) {
    fxAnim(d, [
      { transform: 'translate(-50%,0)', opacity: 0 },
      { transform: 'translate(-50%,10px)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%,20px)', opacity: 1, offset: 0.78 },
      { transform: 'translate(-50%,26px)', opacity: 0 },
    ], { duration: 1800, easing: 'ease-out' });
  } else {
    fxAnim(d, [
      { transform: 'translate(-50%,0)', opacity: 0 },
      { transform: 'translate(-50%,-10px)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%,-20px)', opacity: 1, offset: 0.78 },
      { transform: 'translate(-50%,-26px)', opacity: 0 },
    ], { duration: 1800, easing: 'ease-out' });
  }
  fxKill(d, 1840);
}
// ---- Redesign F: non-battle LP chips. An LP cost (engine 'pay'
// event, MSG_PAY_LPCOST) and effect damage (a 'damage' event with
// no attack scene behind it) each get an engraved chip at the LP
// plate — gold stamp for a cost (paid by choice), white-hot/red for
// effect damage — instead of the battle damage number, so "paid"
// and "was dealt" never read the same. The chip lingers (residual
// light, ~2.4 s) while fxLpCount counts the counter monotonically
// underneath it. The opponent variant anchors at the plate's bottom
// interior and drifts down (same anti-clip rule as above).
// `stack` offsets a second chip in the same batch (pay + damage)
// so the two chips never overlap. Animation is WAAPI
// transform/opacity only; all glow is static CSS paint.
function fxLpChip(con, chip, amount, stack) {
  const el = fxLpEl(con); if (!el) return null;
  const r = fxRel(el); if (!r) return null;
  const layer = fxLayerEl(); if (!layer) return null;
  const down = con !== HP;
  const idx = stack || 0;
  const d = document.createElement('div');
  d.className = 'fx fx3-lpchip fx3-lpchip--' + chip + (down ? ' fx3-lpchip--down' : '');
  d.dataset.direction = down ? 'down' : 'up';
  d.dataset.lpKind = chip;
  d.textContent = '−' + amount;
  d.style.left = r.cx + 'px';
  d.style.top = (down ? (r.y + r.h - 3 + idx * 24) : (r.y - 2 - idx * 24)) + 'px';
  layer.appendChild(d);
  // keep the whole chip on screen: the LP plate hugs the screen
  // edge, so a wide chip centered on it bleeds off the side
  // (measured: a -1500 pay chip started at x=-7). Guarded so the
  // zero-geometry test environment skips the clamp.
  const appW = $('app').getBoundingClientRect().width, halfW = d.offsetWidth / 2;
  if (appW > 0 && halfW > 0) d.style.left = Math.max(halfW + 2, Math.min(r.cx, appW - halfW - 2)) + 'px';
  const drift = down ? 6 : -6;
  const base = down ? 'translate(-50%,0)' : 'translate(-50%,-100%)';
  fxAnim(d, [
    { transform: base + ' translateY(0px)', opacity: 0 },
    { transform: base + ' translateY(' + (drift * 0.4) + 'px)', opacity: 1, offset: 0.08 },
    { transform: base + ' translateY(' + drift + 'px)', opacity: 1, offset: 0.8 },
    { transform: base + ' translateY(' + drift + 'px)', opacity: 0 },
  ], { duration: 2400, easing: 'ease-out' });
  fxKill(d, 2440);
  return d;
}
// ---- battle (B7): attacker glows, a thin cyan line reaches the
// target, the attribute-coloured impact lands there. The attacking
// card itself never leaves its zone; no formula is ever shown.
const FX_ATTR_COLORS = { 1: '#d29a55', 2: '#4aa3ff', 4: '#ff6a3d', 8: '#7fe08a', 16: '#ffe98a', 32: '#9a6aff', 64: '#ffd94d' };
const FX_ATTR_WASH = { 1: 'rgba(170,115,60,.50)', 2: 'rgba(40,110,255,.42)', 4: 'rgba(255,90,30,.48)', 8: 'rgba(90,230,140,.38)', 16: 'rgba(255,250,225,.88)', 32: 'rgba(16,4,38,.85)', 64: 'rgba(255,215,80,.55)' };
// ---- V3 stage 2: the attack scene (proposal 1.2). One timeline on
// the shared FX clock; every layer is scheduled against the single
// impact point t=280, where a 70 ms hit-stop freezes the whole FX
// world (line, particles, LP alike). The board itself never moves:
// the target shake rides a ghost, and battle destruction keeps the
// round-A removal grammar (the card flies to its pile) — this scene
// owns the white peak + rising particles at the target, timed to
// the blow, and suppresses the diff pass's immediate white flash.
let fxLastAttackScene = null; // {t0, defCon} — the LP loop schedules its count from this
function fxAttackKeys(evs, state) {
  // attacker/target zone keys for each attack event in a batch
  // (shared by the scene wiring and the destroy-flash suppression)
  const out = [];
  const la = state ? state.lastAttack : null;
  for (const ev of evs) {
    if (ev.kind !== 'attack') continue;
    let aKey = null, tKey = null;
    if (la && la.attacker && la.attacker.con === ev.con) {
      aKey = la.attacker.con + ':' + E.LOC.MZONE + ':' + la.attacker.seq;
      if (la.target) tKey = la.target.con + ':' + E.LOC.MZONE + ':' + la.target.seq;
    }
    out.push({ ev, aKey, tKey });
  }
  return out;
}
function fxAttackSceneV3(o) {
  const layer = fxLayerEl(); if (!layer) return null;
  const aPt = o.aPt, tPt = o.tPt; if (!aPt || !tPt) return null;
  const col = FX_ATTR_COLORS[o.attr] || '#ffe9a8';
  const dx = tPt.cx - aPt.cx, dy = tPt.cy - aPt.cy, len = Math.hypot(dx, dy);
  const nodes = [];
  const mk = (cls, cx, cy, w, h) => { const d = fxNode(cls, cx, cy, w, h); if (d) nodes.push(d); return d; };
  const emph = mk('fx3-emph', aPt.cx, aPt.cy, aPt.w, aPt.h);            // L1 attacker emphasis
  const trim = mk('fx3-trim', tPt.cx, tPt.cy, Math.max(tPt.w, 30), Math.max(tPt.h, 30)); // L2 target rim
  if (trim) trim.style.borderColor = col;
  // L8/L9 ghost stack (V4): the shake and the dissolve ride three
  // stacked copies — main, a white-hot copy, a gray copy — whose
  // filters are set ONCE here; the dissolve becomes an opacity
  // cross-fade, so no filter is ever written per frame.
  let ghost = null, ghostHot = null, ghostGray = null, ghostSil = null;
  if (!o.direct && o.targetCode != null) {
    const gw = Math.max(10, tPt.w - 2), gh = Math.max(10, tPt.h - 24);
    ghost = fxPlaceGhost(o.targetCode, false, tPt, gw, gh, o.tDeck);
    if (ghost) {
      ghost.style.opacity = '0'; nodes.push(ghost);
      ghostHot = fxPlaceGhost(o.targetCode, false, tPt, gw, gh, o.tDeck);
      if (ghostHot) { ghostHot.style.filter = 'brightness(2.7) saturate(0)'; ghostHot.style.opacity = '0'; nodes.push(ghostHot); }
      ghostGray = fxPlaceGhost(o.targetCode, false, tPt, gw, gh, o.tDeck);
      if (ghostGray) { ghostGray.style.filter = 'grayscale(1) brightness(.82)'; ghostGray.style.opacity = '0'; nodes.push(ghostGray); }
      // Redesign A / F3 (proto p1d): a dedicated silhouette layer
      // ABOVE the hot/gray copies — a white card rectangle with a
      // gold rim and a readable name band, all static paint in CSS
      // (.fx3-silhouette); only its opacity/transform are animated.
      // At the shifted white-hot peak (430-490, see render) this is
      // what the player reads, so the target stays a CARD instead
      // of dissolving into the bloom's white core.
      if (o.destroyed) {
        ghostSil = mk('fx3-silhouette', tPt.cx, tPt.cy, gw, gh);
        if (ghostSil) { ghostSil.style.opacity = '0'; ghostSil.innerHTML = '<div class="nm">' + cardName(o.targetCode) + '</div>'; }
      }
    }
  }
  // L7 attribute particles, born at the impact point on the FX clock
  fxSpawnBurst('low', { add: 1, seed: (Math.random() * 1e9) | 0, o: [tPt.cx, tPt.cy], n: 26, t0: fxTimeMs + 280, life: [300, 560], speed: [110, 330], ang: [0, Math.PI * 2], grav: 520, dragK: 2.6, size: [2.5, 6], cols: [col, '#ffffff', col], alpha: .95 });
  if (o.destroyed) fxSpawnBurst('low', { add: 1, seed: (Math.random() * 1e9) | 0, o: [tPt.cx, tPt.cy], n: 8, t0: fxTimeMs + 410, life: [320, 520], speed: [16, 54], ang: [-Math.PI / 2, 0.9], grav: -60, size: [2.5, 5], cols: ['#ffffff', '#ffe9a8'], alpha: .9 });
  const sc = fxAddScene({
    kind: 'attack', dur: 1000, winLow: [[0, 780]],
    cues: [{ at: 280, fn: () => fxHitStop(70) }], // L4: the world stops at the collision
    // V4 (proposal 追記 V4-2): every light layer lives on the low
    // canvas — L1 halo + rim sweep, the L3 comet, the L5 three-tier
    // impact bloom, L6 soft rings, L9 rising streaks. The DOM keeps
    // only the two card rims and the ghost stack (transform/opacity).
    drawLow(ctx, t) {
      const halo = t < 300 ? fxSeg(t, 0, 300) : 1 - fxSeg(t, 300, 640);
      if (halo > 0) fxDrawGlow(ctx, aPt.cx, aPt.cy, 64, col, .5 * halo);
      if (t > 0 && t < 170) { // rim light runs once around the attacker's edge
        const u = fxSeg(t, 0, 170), sweep = -Math.PI / 2 + u * Math.PI * 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.globalAlpha = .9 * (1 - .4 * u);
        ctx.beginPath(); ctx.arc(aPt.cx, aPt.cy, Math.max(aPt.w, aPt.h) * .62, sweep - .5, sweep + .5); ctx.stroke();
        ctx.restore();
      }
      if (len >= 8 && t >= 60 && t <= 430) { // the tapered comet; trail ghosts sample the launch curve 30/60/95 ms back
        const af = Math.min(fxSeg(t, 60, 100), 1 - fxSeg(t, 300, 430));
        const ext = FXE.launch(fxSeg(t, 100, 280));
        const trails = [30, 60, 95].map((L, i) => ({ e: FXE.launch(fxSeg(t - L, 100, 280)), a: [.4, .25, .15][i] }));
        if (af > 0 && ext > 0) fxDrawComet(ctx, aPt.cx, aPt.cy, tPt.cx, tPt.cy, ext, col, af, trails);
      }
      if (t >= 280 && t <= 560) { // impact: white core / colour halo / wash
        fxDrawGlow(ctx, tPt.cx, tPt.cy, 34, '#ffffff', .95 * (1 - fxSeg(t, 335, 500)));
        fxDrawGlow(ctx, tPt.cx, tPt.cy, 62, col, .6 * (.35 + .65 * fxSeg(t, 280, 370)) * (1 - fxSeg(t, 370, 520)));
        fxDrawGlow(ctx, tPt.cx, tPt.cy, 110, col, .30 * fxSeg(t, 280, 320) * (1 - fxSeg(t, 280, 560)));
      }
      if (t >= 280 && t < 700) { // two soft rings, 60 ms stagger
        const u1 = FXE.outCubic(fxSeg(t, 280, 620)); if (u1 > 0) fxDrawSoftRing(ctx, tPt.cx, tPt.cy, 13 + 34 * u1, col, .8 * (1 - u1), .12);
        const u2 = FXE.outCubic(fxSeg(t, 340, 680)); if (u2 > 0) fxDrawSoftRing(ctx, tPt.cx, tPt.cy, 13 + 35 * u2, col, .7 * (1 - u2), .12);
      }
      if (o.destroyed && t >= 380 && t < 760) { // thin light streaks rise off the broken body
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const u = fxSeg(t, 380 + i * 40, 660 + i * 40); if (u <= 0 || u >= 1) continue;
          const x = tPt.cx - 14 + i * 14, y0 = tPt.cy + 10, y1 = y0 - 52 * FXE.outCubic(u);
          const g = ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, '#ffffff');
          ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.globalAlpha = .55 * (1 - u);
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        }
        ctx.restore();
      }
    },
    render(t) {
      if (emph) { // L1: 1 -> 1.06 with the settle curve's own overshoot; gone by ~640 (the glow itself is canvas now)
        emph.style.transform = 'scale(' + (1 + 0.06 * FXE.settle(fxSeg(t, 0, 120))).toFixed(3) + ')';
        emph.style.opacity = String(1 - fxSeg(t, 480, 640));
      }
      if (trim) { // L2: one rim pulse, 60-210
        const p = Math.sin(Math.PI * fxSeg(t, 60, 210));
        trim.style.transform = 'scale(' + (1 + 0.045 * p).toFixed(3) + ')';
        trim.style.opacity = String(0.85 * p * (1 - fxSeg(t, 300, 460)));
      }
      if (ghost) {
        if (t < 280) { ghost.style.opacity = '0'; if (ghostHot) ghostHot.style.opacity = '0'; if (ghostGray) ghostGray.style.opacity = '0'; if (ghostSil) ghostSil.style.opacity = '0'; }
        else {
          const st = t - 280;
          const gx = 3 * Math.sin(st / 17) * Math.exp(-st / 85); // L8: damped +-3px shake
          if (o.destroyed && t >= 430) { // L9 (Redesign A / F3): the white-hot peak moved 350-410 -> 430-490, AFTER the bloom white core (280-500, alpha up to .95) has decayed; the silhouette layer peaks in the same window so the card rectangle + gold rim + name band stay readable at the peak. The dissolve fade itself (500-660) is unchanged.
            const du = fxSeg(t, 430, 600);
            const tr = 'translate(' + gx.toFixed(1) + 'px,' + (-12 * FXE.inCubic(du)).toFixed(1) + 'px)';
            // Brushup FX-1a: the fade used to run 470-600, leaving
            // the colour copy at ~0.42 mid-dissolve while the gray
            // copy (x0.85) carried the read — in stills the dying
            // card was nearly invisible (audit-fx s545 frame). The
            // fade now runs 500-660: the colour copy stays the
            // readable one through the dissolve's middle, and the
            // tail still lands inside the scene's 1000 ms.
            const fade = 1 - fxSeg(t, 500, 660);
            ghost.style.transform = tr;
            ghost.style.opacity = String(fade);
            if (ghostHot) { ghostHot.style.transform = tr; ghostHot.style.opacity = String(.85 * Math.sin(Math.PI * fxSeg(t, 430, 490)) * fade); }
            if (ghostGray) { ghostGray.style.transform = tr; ghostGray.style.opacity = String(.85 * fxSeg(t, 490, 600) * fade); }
            if (ghostSil) { ghostSil.style.transform = tr; ghostSil.style.opacity = String(.96 * Math.sin(Math.PI * fxSeg(t, 430, 490)) * fade); }
          } else {
            ghost.style.transform = 'translate(' + gx.toFixed(1) + 'px,0px)';
            ghost.style.opacity = String(o.destroyed ? 1 : 1 - fxSeg(t, 450, 480));
            if (ghostHot) ghostHot.style.opacity = '0';
            if (ghostGray) ghostGray.style.opacity = '0';
            if (ghostSil) ghostSil.style.opacity = '0';
          }
        }
      }
    },
    onDone() { for (const n of nodes) { try { n.remove(); } catch (e) {} } },
  });
  return sc;
}
function fxAtkBanner() {
  const layer = fxLayerEl(); if (!layer) return;
  const d = document.createElement('div');
  d.className = 'fx-atkbanner';
  d.textContent = '直接攻撃';
  layer.appendChild(d);
  fxAnim(d, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
  fxKill(d, 940);
}
// ---- redesign D (p4b): the opponent's action name tag. A thin
// lapis strip at the top of the screen that names ONE public
// opponent action and is gone in ~1.6 s. INFORMATION DISCIPLINE
// (strict): a card name is shown ONLY for the opponent's public
// summon events — normal / special / flip summon, whose identity
// the summon itself reveals. A SET is announced with generic
// wording only («モンスターをセット» / «カードをセット»): the
// set event stream carries the real code locally, and it must
// never reach this tag's text or record. Attacks (the attack
// scene names them), chain activations (the chain pop names
// them), draws and phase changes get NO tag, and neither do the
// human's own actions. One tag at a time: a newer action replaces
// the tag that is still up. Animation is WAAPI opacity/transform
// only, on the shared kill-timer discipline of the other tags.
let fxOppTagEl = null, fxOppTagTimer = null;
function fxOppNameTag(text, detail) {
  fxRecord('oppnametag', detail);
  const layer = fxLayerEl(); if (!layer) return;
  if (fxOppTagTimer) { clearTimeout(fxOppTagTimer); fxOppTagTimer = null; }
  if (fxOppTagEl) { try { fxOppTagEl.remove(); } catch (e) {} fxOppTagEl = null; }
  const d = document.createElement('div');
  d.className = 'fx-oppnametag';
  d.dataset.how = detail.how || '';
  d.textContent = text;
  layer.appendChild(d);
  fxOppTagEl = d;
  fxAnim(d, [
    { opacity: 0, transform: 'translateX(-6px)' },
    { opacity: 1, transform: 'translateX(0px)', offset: 0.12 },
    { opacity: 1, transform: 'translateX(0px)', offset: 0.82 },
    { opacity: 0, transform: 'translateX(0px)' },
  ], { duration: 1600, easing: 'ease-out' });
  fxOppTagTimer = setTimeout(() => {
    fxOppTagTimer = null;
    if (fxOppTagEl === d) fxOppTagEl = null;
    try { d.remove(); } catch (e) {}
  }, 1640);
}
function fxOppTagsFromEvents(evs, state) {
  const opp = 1 - HP;
  const VERB = { summon: '召喚', spsummon: '特殊召喚', flipsummon: '反転召喚' };
  for (const ev of evs) {
    if (ev.con !== opp) continue; // the human's own actions get no tag
    if (ev.kind === 'set') {
      // generic wording ONLY — ev.code is deliberately never read
      // here, so a face-down card's identity cannot leak (above)
      const text = ev.loc === E.LOC.MZONE ? '相手：モンスターをセット' : '相手：カードをセット';
      fxOppNameTag(text, { how: 'set', text });
      continue;
    }
    const verb = VERB[ev.kind];
    if (!verb) continue; // attack / activate / draw / damage ...: other grammar owns them
    if (ev.code == null || ev.code === 0) continue; // a code-less announcement (face-down special summon on the wire) names nothing — silence over a guess
    // a special summon that landed FACE-DOWN is not public either:
    // when the standing state shows this card face-down on the
    // opponent's field, keep the name out and announce the act
    // generically, exactly like a set
    let faceDown = false;
    if (state && state.players && state.players[opp]) {
      const z = state.players[opp].mzone.find(c => c && c.code === ev.code);
      if (z && z.pos != null && (z.pos & E.POS_FACEUP) === 0) faceDown = true;
    }
    if (faceDown) fxOppNameTag('相手：モンスターを' + verb, { how: ev.kind, text: '相手：モンスターを' + verb });
    else fxOppNameTag('相手：《' + cardName(ev.code) + '》を' + verb, { how: ev.kind, code: ev.code });
  }
}
// ---- V3 stage 3: the finisher scene (proposal 1.3). Lives INSIDE
// the layer table (#fxcutin, z35); the result display is separated
// from it by TIME (a gate at scene-local 2450 ms — redesign G, see
// fxFinisherGateMs — never by stacking above it. The wash is a
// radial bloom FROM the defender's LP plate — it has an origin
// and a direction.
let fxFinisherSceneRef = null;
function fxFinisherGateMs() {
  const sc = fxFinisherSceneRef;
  if (!sc || sc.dead) return 0;
  // Redesign G (audit A-07): the gate sits at scene-local 2450 ms,
  // AFTER the wash is fully gone (its last paint is at 2400 ms,
  // fxFinisherSceneV3 drawTop). The old 2300 ms let the result
  // (z60) stand under the wash's 2300-2400 ms tail (drawn on the
  // z65 canvas) for a beat; 2450 leaves a 50 ms clear margin so
  // the result always stands after the veil recedes. Sole caller:
  // the duel-end handler below, which awaits this before showing
  // the result — nothing else in the flow reads the gate.
  const remain = (sc.t0 + 2450) - fxTimeMs;
  return Math.max(0, Math.min(2450, remain));
}
function fxFinisherSceneV3(attr) {
  const host = $('fxcutin'); if (!host) return;
  const la = fxLastAttackScene; if (!la || !la.aPt) return;
  const layer = fxLayerEl(); if (!layer) return;
  const app = $('app'); if (!app) return;
  const ar = fxRel(app);
  const defCon = la.defCon;
  const lpEl = fxLpEl(defCon);
  const lpPt = lpEl ? fxRel(lpEl) : la.tPt;
  if (!lpPt) return;
  const col = FX_ATTR_COLORS[attr] || '#ffe9a8';
  const washCol = FX_ATTR_WASH[attr] || 'rgba(255,233,168,.5)';
  // the finisher owns the loser's counter from here: stop any count
  // scene for that seat and take the currently-shown value as the
  // drain's start (the LP loop defers to us via fxLpCount's guard)
  let drainFrom = fxLpShown[defCon];
  if (fxLpScenes[defCon] && !fxLpScenes[defCon].dead) { const old = fxLpScenes[defCon]; old.dead = true; if (old.cleanup) old.cleanup(); }
  if (drainFrom == null) drainFrom = 4000;
  const lpElRef = lpEl;
  // ---- nodes: charge + vignette on the board layer; the rest in the host
  const nodes = [];
  const charge = fxNode('fx3-emph', la.aPt.cx, la.aPt.cy, la.aPt.w, la.aPt.h);
  if (charge) { charge.style.borderColor = col; charge.style.boxShadow = '0 0 26px ' + col + ', inset 0 0 14px ' + col; nodes.push(charge); } // V4: shadow set once; the charge is opacity/transform only
  const vig = document.createElement('div'); vig.className = 'fx3-vignette'; vig.style.opacity = '0'; layer.appendChild(vig); nodes.push(vig);
  host.innerHTML = ''; host.className = 'on';
  const hmk = (cls) => { const d = document.createElement('div'); d.className = cls; host.appendChild(d); nodes.push(d); return d; };
  const scrim = hmk('scrim'); scrim.style.opacity = '0';
  // (the swirl backdrop is a rotating raster in drawTop, R4 — no DOM layer)
  const vw = Math.min(window.innerWidth || 390, 430);
  const cw = Math.round(Math.min(250, vw * 0.62)), chh = Math.round(cw * 1.38);
  const card = hmk('bigcard');
  card.style.width = cw + 'px'; card.style.height = chh + 'px'; card.style.opacity = '0';
  artApply(card, la.code, true, la.aKey ? deckKeyOfSeat(+la.aKey.split(':')[0]) : null);
  card.innerHTML = '<div class="nm' + kindCls(la.code) + '">' + cardName(la.code) + '</div>';
  // beam: attacker -> defender LP plate (fxcutin shares the app coordinate space)
  const dx = lpPt.cx - la.aPt.cx, dy = lpPt.cy - la.aPt.cy, len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const beam = document.createElement('div');
  beam.className = 'fx fx3-linew fx3-beam';
  beam.style.left = la.aPt.cx + 'px'; beam.style.top = la.aPt.cy + 'px'; beam.style.width = len + 'px'; beam.style.opacity = '0';
  beam.innerHTML = '<div class="gl"></div><div class="cl"></div>';
  host.appendChild(beam); nodes.push(beam);
  // (the wash is drawn in drawTop as a scaled disc raster, R4)
  const appEl = app;
  const sc = fxAddScene({
    kind: 'finisher', dur: 2900, winTop: [[110, 2400]],
    cues: [
      { at: 1200, fn: () => playSe((ATTR_SE && ATTR_SE[attr]) || 'atk_sword_big') },  // launch
      { at: 1420, fn: () => { fxHitStop(110); playSe('hit_critical'); } },          // impact
    ],
    // V4-4: the charge halo (tier 2), the impact as a three-tier
    // bloom, the wash's second source + the contracting last-light
    // ring, and the result's gold bloom — all on the top canvas.
    drawTop(ctx, t) {
      // V4 R4: the rotating swirl backdrop as a pre-rendered raster
      const bgA = .8 * fxSeg(t, 500, 900) * (1 - fxSeg(t, 2100, 2400));
      if (bgA > 0) fxDrawRotRaster(ctx, fxConicRaster(col, 430, 14, 30, .18), ar.cx, ar.y + ar.h * 0.40, (t * 12 / 1000) % 360, bgA);
      const tier2 = fxSeg(t, 120, 420);
      if (tier2 > 0) fxDrawGlow(ctx, la.aPt.cx, la.aPt.cy, fxLerp(54, 84, tier2), col, .45 * tier2 * (1 - fxSeg(t, 500, 700)));
      if (t >= 1400 && t < 1700) { // impact bloom at the LP plate
        const a = fxSeg(t, 1420, 1460) * (1 - fxSeg(t, 1500, 1650));
        if (a > 0) {
          fxDrawGlow(ctx, lpPt.cx, lpPt.cy, 34, '#ffffff', .95 * a);
          fxDrawGlow(ctx, lpPt.cx, lpPt.cy, 74, col, .60 * a);
          fxDrawGlow(ctx, lpPt.cx, lpPt.cy, 130, col, .32 * a);
        }
      }
      if (t >= 1420 && t < 2400) {
        // L6 wash (R4: a scaled disc raster — the DOM wash was a
        // 720 px gradient repainted on every frame of its window)
        let wa = 0;
        if (t < 1530) wa = fxSeg(t, 1420, 1530);
        else if (t < 1750) wa = 1;
        else wa = 1 - FXE.washOut(fxSeg(t, 1750, 2400));
        if (wa > 0) {
          const ws = 0.55 + 0.45 * FXE.outCubic(fxSeg(t, 1420, 1900));
          ctx.save(); ctx.translate(lpPt.cx, lpPt.cy); ctx.scale(ws, ws);
          ctx.globalAlpha = wa * 0.95;
          ctx.drawImage(fxDiscRaster(washCol, 720), -360, -360);
          ctx.restore(); ctx.globalAlpha = 1;
        }
        // the wash gets a second source at screen centre
        const wu = fxSeg(t, 1420, 2400);
        fxDrawGlow(ctx, ar.cx, ar.y + ar.h * 0.45, 190, col, .30 * Math.pow(1 - wu, 1.6));
      }
      if (t >= 1900 && t < 2350) { // the last light contracts as the wash decays
        const cu = fxSeg(t, 1900, 2350);
        fxDrawSoftRing(ctx, ar.cx, ar.y + ar.h * 0.45, fxLerp(260, 40, cu), '#ffe9a8', .5 * (1 - cu), .14);
      }
    },
    render(t) {
      // L1 charge, V4 three-tier stagger: rim 0-300 (this element),
      // halo 120-420 (drawTop), vignette 240-500
      if (charge) {
        const u = fxSeg(t, 0, 500);
        charge.style.transform = 'scale(' + (1 + 0.05 * u).toFixed(3) + ')';
        charge.style.opacity = String(0.9 * fxSeg(t, 0, 300) * (1 - fxSeg(t, 500, 700)));
      }
      if (vig) vig.style.opacity = String(0.55 * fxSeg(t, 240, 500) * (1 - fxSeg(t, 1900, 2400)));
      // L2 cut-in flash 500-1250: scrim to .6 (CSS scrim is already
      // translucent; opacity scales it), background swirl fades in
      // and turns, the card scales in (settle) by +250
      if (scrim) scrim.style.opacity = String(0.85 * fxSeg(t, 500, 750) * (1 - fxSeg(t, 2100, 2400)));
      // (backdrop: drawTop raster)
      if (card) {
        const u = FXE.settle(fxSeg(t, 500, 750));
        card.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + 0.3 * u).toFixed(3) + ')';
        card.style.opacity = String(fxSeg(t, 500, 620) * (1 - fxSeg(t, 2050, 2350)));
      }
      // L3 beam 1200-1420: accelerates to the LP plate, gone by 1600
      if (beam) {
        const ext = FXE.launch(fxSeg(t, 1200, 1420));
        beam.style.transform = 'rotate(' + ang + 'deg) scaleX(' + ext.toFixed(3) + ')';
        beam.style.opacity = String(t < 1200 ? 0 : 1 - fxSeg(t, 1450, 1600));
      }
      // L5: the impact flash is the drawTop three-tier bloom now
      // L6 wash 1420-2400: radial from the origin; peak 1530, held
      // to 1750, washOut decay to FULLY GONE at 2400
      // (L6 wash: drawn in drawTop as a scaled disc raster, R4)
      // L7 tilt 1420-2050: V4 decaying recovery — the frame leans
      // 0.5 degrees, overshoots +0.10 the other way, and settles
      if (appEl) {
        const tu = fxSeg(t, 1420, 2050);
        appEl.style.transform = tu > 0 && tu < 1 ? 'rotate(' + (-0.5 * Math.sin(Math.PI * tu) - 0.10 * Math.sin(2 * Math.PI * tu) * (1 - tu)).toFixed(3) + 'deg)' : '';
      }
      // L9 LP drain 1600-2200: accelerating (quadratic) to zero.
      // V4: a red pulse rides the drain rate (10 quantized steps),
      // and the landing pop is a settle ON THE FX CLOCK (it was a
      // wall-clock setTimeout, outside the hit-stop world)
      if (lpElRef) {
        if (t >= 1600 && t <= 2200) {
          const u = fxSeg(t, 1600, 2200);
          const v = Math.max(0, Math.round(drainFrom * (1 - u * u)));
          if (fxLpShown[defCon] !== v) { fxLpShown[defCon] = v; lpElRef.textContent = v; }
          lpElRef.style.transform = '';
          const rate = 2 * u * (1 - u) + 0.2, step = Math.round(rate * 10);
          if (lpElRef._pulse !== step) { lpElRef._pulse = step; lpElRef.style.textShadow = '0 0 ' + Math.round(6 + 14 * rate) + 'px rgba(255,60,40,' + (0.5 * Math.min(1, rate)).toFixed(2) + ')'; }
        } else if (t > 2200) {
          if (fxLpShown[defCon] !== 0) { fxLpShown[defCon] = 0; lpElRef.textContent = '0'; }
          if (lpElRef._pulse !== -1) { lpElRef._pulse = -1; lpElRef.style.textShadow = ''; }
          const pu = fxSeg(t, 2200, 2330);
          lpElRef.style.transform = pu < 1 ? 'scale(' + (1 + 0.15 * (1 - FXE.settle(pu))).toFixed(3) + ')' : '';
        }
      }
    },
    onDone() {
      for (const n of nodes) { try { n.remove(); } catch (e) {} }
      host.className = '';
      if (appEl) appEl.style.transform = '';
      if (lpElRef) { lpElRef.style.textShadow = ''; lpElRef.style.transform = ''; lpElRef._pulse = -1; }
      if (fxLpScenes[defCon] === sc) fxLpScenes[defCon] = null;
      fxFinisherSceneRef = null;
    },
  });
  sc.cleanup = () => {};
  fxLpScenes[defCon] = sc; // the LP loop defers to the finisher for this seat (fxLpCount guard)
  fxFinisherSceneRef = sc;
  // L8 afterglow: 38 particles drift down from the origin (top canvas)
  fxSpawnBurst('top', { seed: (Math.random() * 1e9) | 0, o: [lpPt.cx, lpPt.cy], n: 38, t0: fxTimeMs + 1530, life: [500, 900], speed: [20, 90], ang: [Math.PI / 2, 2.2], grav: 60, dragK: 0.8, size: [3, 7], cols: [col, '#ffffff', '#ffe9a8'], alpha: .8 });
  return sc;
}
// The core often delivers MSG_WIN in its own trailing batch, one
// process step AFTER the lethal damage batch — so the winner
// transition alone cannot require the blow in the same event list.
// The finisher instead keys on a recent hit (attack/damage event
// within the last few seconds of duel time); a deck-out win has no
// recent hit and correctly gets no wash.
let fxLastHitAt = 0, fxLastHitAttr = null;
// ---- chain scenes (B8 -> V3 stage 2, proposal 1.4). The pop is
// the CARD ITSELF (round B showed a name-only panel), its number
// slams onto the lower edge, and after the hold it TRAVELS to its
// chip in the bar — the landing ties the foreground card to its
// slot in the stack. Solving brings the link back to the
// foreground with a gold ignition; a negated link gets no gold —
// it grays out and leaves, so "negated" reads at board centre.
function fxChainChipEl(n) {
  const chips = document.querySelectorAll('#chainbar .link');
  return chips && chips[n - 1] ? chips[n - 1] : null;
}
// ---- redesign B (proto 案2 / p2b): the landed state of a chain
// link. When a pop lands on its chip, the floating CHAIN word is
// absorbed into the bar — the bar's CHAIN label turns gold with a
// gold underline and the landed chip keeps a gold frame. #chainbar
// is rebuilt by render() via innerHTML, so a class the FX layer
// pasted on would vanish at the next render: the landed set lives
// HERE, on the module side, and render() reads it when it paints
// the bar. Entries are pruned when the chain empties (render and
// the fx diff both clear), when it shrinks / is rebuilt (the diff
// clears on a length drop), and per-link when the link now sitting
// at that number is a different card (render-time prune).
let fxChainLanded = new Map(); // link number -> code (null when the code is unknown)
function fxChainPruneLanded(chain) {
  if (!chain || !chain.length) { fxChainLanded.clear(); return; }
  for (const [n, code] of [...fxChainLanded]) {
    const l = chain[n - 1];
    if (!l || (code != null && l.code !== code)) fxChainLanded.delete(n);
  }
}
function fxChainApplyLanded() { // paint the absorbed state onto the CURRENT bar DOM (between renders)
  if (!fxChainLanded.size) return;
  const lbl = document.querySelector('#chainbar .chainlbl');
  if (lbl) lbl.classList.add('landed');
  document.querySelectorAll('#chainbar .link').forEach((chip, i) => { if (fxChainLanded.has(i + 1)) chip.classList.add('landed'); });
}
function fxChainMarkLanded(n, code) {
  if (!n) return;
  fxChainLanded.set(n, code != null ? code : (fxChainLanded.get(n) || null));
  fxChainApplyLanded();
}
// V4-3: from the 2nd link, the word CHAIN stands up above the pop,
// letter by letter (30 ms stagger), and stays while the chain is
// the foreground event. Redesign B (p2b): it does NOT outlive the
// presentation — it fades out into the landing (the last 150 ms of
// its duration), because at the landing the word is absorbed into
// the chain bar's label (fxChainMarkLanded). Callers pass the
// duration of their own presentation (chain pop 950, set tilt 820).
let fxChainWordScene = null;
function fxChainWord(cx, cy, durMs) {
  const layer = fxLayerEl(); if (!layer) return;
  if (fxChainWordScene && !fxChainWordScene.dead) { fxChainWordScene.dead = true; if (fxChainWordScene.cleanup) fxChainWordScene.cleanup(); }
  const dur = durMs || 950;
  const d = document.createElement('div');
  d.className = 'fx3-chainword';
  d.style.left = cx + 'px'; d.style.top = cy + 'px'; d.style.opacity = '0';
  d.innerHTML = '<span>C</span><span>H</span><span>A</span><span>I</span><span>N</span>';
  layer.appendChild(d);
  const spans = [...d.children];
  const sc = fxAddScene({
    kind: 'chainword', dur,
    render(t) {
      d.style.opacity = String(Math.min(fxSeg(t, 130, 250), 1 - fxSeg(t, dur - 150, dur)));
      spans.forEach((sp, i) => {
        const u = FXE.settle(fxSeg(t, 150 + i * 30, 310 + i * 30));
        sp.style.transform = 'translateY(' + (10 * (1 - u)).toFixed(1) + 'px) scale(' + (0.6 + 0.4 * u).toFixed(3) + ')';
        sp.style.opacity = String(u);
      });
    },
    onDone() { try { d.remove(); } catch (e) {} if (fxChainWordScene === sc) fxChainWordScene = null; },
  });
  sc.cleanup = () => { try { d.remove(); } catch (e) {} };
  fxChainWordScene = sc;
}
function fxChainSceneV3(n, code, deckKey) {
  const layer = fxLayerEl(); if (!layer) return;
  const app = $('app'); if (!app) return;
  const ar = fxRel(app);
  const W = 104, H = 142;
  // Redesign B (p2a): zero occlusion while the chain builds / holds.
  // The pop's lower edge used to cover the link chips under it
  // (~13 px in the audit frame). The whole bundle — pop card, rim
  // and the CHAIN word — is lifted as ONE piece until the card's
  // bottom edge sits 4 px above the chain bar's top edge. The lift
  // is computed from the measured rects at scene creation (in the
  // prototype's environment it came to 58 px; that number is an
  // outcome of the geometry, never a constant), and it is applied
  // ONCE, here, as the creation position — no per-frame writes,
  // and neither the bar nor the board layout moves.
  const baseCy = ar.y + ar.h * 0.34;
  let lift = 0;
  const barEl0 = $('chainbar');
  if (barEl0) {
    const br = fxRel(barEl0);
    if (br.w > 0 || br.h > 0) lift = Math.max(0, Math.ceil((baseCy + H / 2) - (br.y - 4)));
  }
  const cx = ar.cx, cy = baseCy - lift;
  const card = fxPlaceGhost(code, false, { cx, cy }, W, H, deckKey);
  if (!card) return;
  card.style.zIndex = 6;
  card.dataset.chainLift = String(lift);
  if (lift > 0) fxRecord('chainlift', { n, lift });
  // V4: the white rim is a preset-shadow overlay that only ever
  // changes opacity/transform — the card itself gets no per-frame
  // boxShadow write.
  const rimEl = fxNode('fx3-chainrim', cx, cy, W, H);
  if (rimEl) { rimEl.style.opacity = '0'; rimEl.style.zIndex = 7; }
  const no = document.createElement('div'); no.className = 'fx3-chainno'; no.textContent = n; card.appendChild(no);
  // landing target: this link's own chip (fall back to the bar centre)
  let tx = cx, ty = cy, chip = fxChainChipEl(n);
  if (chip) { const r = fxRel(chip); if (r.w > 0) { tx = r.cx; ty = r.cy; } }
  if (tx === cx && ty === cy) { const bar = $('chainbar'); if (bar) { const r = fxRel(bar); if (r.w > 0) { tx = r.cx; ty = r.cy; } } }
  const dx = tx - cx, dy = ty - cy;
  // L5: from the 2nd link, a glowing cord + a travelling pulse join
  // the previous chip to the new one (V4: canvas, in drawLow)
  let linkPts = null;
  if (n >= 2) {
    const prevChip = fxChainChipEl(n - 1);
    if (prevChip && chip) {
      const r1 = fxRel(prevChip), r2 = fxRel(chip);
      if (Math.hypot(r2.cx - r1.cx, r2.cy - r1.cy) > 4) linkPts = { x1: r1.cx, y1: r1.cy, x2: r2.cx, y2: r2.cy };
    }
    fxChainWord(cx, cy - H / 2 - 40);
  }
  fxAddScene({
    kind: 'chainpop', dur: 950, winLow: [[0, 950]],
    drawLow(ctx, t) {
      if (t < 150) { // rim light runs once around the popped card
        const u = fxSeg(t, 0, 150), a0 = -Math.PI / 2 + u * Math.PI * 2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.globalAlpha = .9 * (1 - .4 * u);
        ctx.beginPath(); ctx.arc(cx, cy, 58, a0 - .5, a0 + .5); ctx.stroke();
        ctx.restore();
      }
      const ru = fxSeg(t, 60, 300); // soft ring behind the slamming number
      if (ru > 0 && ru < 1) fxDrawSoftRing(ctx, cx, cy + H / 2 + 1, 26 * (0.6 + 0.75 * FXE.outCubic(ru)), '#59d8f2', .8 * (1 - ru), .12);
      if (linkPts) {
        const du = fxSeg(t, 150, 400), la = .85 * (1 - fxSeg(t, 800, 950));
        if (du > 0 && la > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = '#59d8f2'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
          ctx.globalAlpha = .55 * la;
          ctx.beginPath(); ctx.moveTo(linkPts.x1, linkPts.y1); ctx.lineTo(fxLerp(linkPts.x1, linkPts.x2, du), fxLerp(linkPts.y1, linkPts.y2, du)); ctx.stroke();
          ctx.restore();
          if (t >= 150) { const pu = ((t - 150) % 600) / 600; fxDrawGlow(ctx, fxLerp(linkPts.x1, linkPts.x2, pu * du), fxLerp(linkPts.y1, linkPts.y2, pu * du), 10, '#59d8f2', .8 * la); }
        }
      }
    },
    render(t) {
      // L1: the card arrives by 220 ms (settle curve overshoots, then rests); white rim ignites in 80 ms
      const s = 0.7 + 0.3 * FXE.settle(fxSeg(t, 0, 220));
      // L4: 700-950 the card travels FLIP-style to its chip and lands small
      const u = FXE.inOut(fxSeg(t, 700, 950));
      const sc2 = fxLerp(s, Math.max(0.14, 26 / H), u);
      card.style.transform = 'translate(' + (dx * u).toFixed(1) + 'px,' + (dy * u).toFixed(1) + 'px) scale(' + sc2.toFixed(3) + ')';
      const rim = t < 80 ? t / 80 : 1 - fxSeg(t, 260, 480);
      if (rimEl) { rimEl.style.transform = card.style.transform; rimEl.style.opacity = String(0.95 * Math.max(0, rim) * (1 - fxSeg(t, 890, 950))); }
      card.style.opacity = String(1 - fxSeg(t, 890, 950));
      // L2: the number slams 1.6 -> 1.0 over 60-220 (its ring is the drawLow soft ring now)
      const ns = 1.6 - 0.6 * FXE.settle(fxSeg(t, 60, 220));
      no.style.transform = 'translateX(-50%) scale(' + ns.toFixed(3) + ')';
      no.style.opacity = String(1 - fxSeg(t, 890, 950));
    },
    onDone() {
      card.remove();
      if (rimEl) rimEl.remove();
      // redesign B (p2b): the landing absorbs the CHAIN word into
      // the bar — flag this link as landed (module-side, so the
      // state survives render()'s innerHTML rebuild of the bar)
      fxChainMarkLanded(n, code);
      if (chip) fxAnim(chip, [{ transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' }); // the chip swells on landing
    },
  });
}
function fxChainSolveSceneV3(n, code, neg, deckKey) {
  const layer = fxLayerEl(); if (!layer) return;
  const app = $('app'); if (!app) return;
  const ar = fxRel(app);
  const cx = ar.cx, cy = ar.y + ar.h * 0.34, W = 104, H = 142;
  // V4: the link FLIPs back from its own chip — it starts at the
  // chip's rect (position + scale) and arrives centre at 180 ms
  let sx = cx, sy = cy, s0 = 0.8;
  const chip = fxChainChipEl(n);
  if (chip) { const r = fxRel(chip); if (r.w > 0) { sx = r.cx; sy = r.cy; s0 = Math.max(0.1, r.h / H); } }
  const card = fxPlaceGhost(code, false, { cx, cy }, W, H, deckKey);
  if (!card) return;
  card.style.zIndex = 6;
  const no = document.createElement('div'); no.className = 'fx3-chainno'; no.textContent = n;
  if (neg) no.style.color = '#b9b9b9';
  card.appendChild(no);
  // V4: frames/glow are preset-shadow overlays + a preset-filter
  // gray copy — opacity cross-fades only, no per-frame writes of
  // boxShadow / filter.
  const glowEl = neg ? null : fxNode('fx3-goldglow', cx, cy, W, H);
  if (glowEl) { glowEl.style.opacity = '0'; glowEl.style.zIndex = 7; }
  const frameEl = fxNode(neg ? 'fx3-grayframe' : 'fx3-goldframe', cx, cy, W, H);
  if (frameEl) { frameEl.style.opacity = '0'; frameEl.style.zIndex = 7; }
  let grayCopy = null;
  if (neg) { grayCopy = fxPlaceGhost(code, false, { cx, cy }, W, H, deckKey); if (grayCopy) { grayCopy.style.filter = 'grayscale(1)'; grayCopy.style.opacity = '0'; grayCopy.style.zIndex = 7; } }
  fxAddScene({
    kind: 'chainsolve', dur: 450,
    cues: neg ? [] : [{ at: 200, fn: () => fxSpawnBurst('low', { seed: (Math.random() * 1e9) | 0, o: [cx, cy], n: 10, life: [380, 620], speed: [14, 46], ang: [-Math.PI / 2, 0.8], grav: -50, size: [2.5, 5], cols: ['#ffd94d', '#ffe9a8'], alpha: .95 }) }],
    render(t) {
      const u = FXE.snap(fxSeg(t, 0, 180));
      const sink = 8 * fxSeg(t, 300, 450);
      const tr = 'translate(' + ((sx - cx) * (1 - u)).toFixed(1) + 'px,' + ((sy - cy) * (1 - u) + sink).toFixed(1) + 'px) scale(' + fxLerp(s0, 1, u).toFixed(3) + ')';
      card.style.transform = tr;
      const fade = 1 - fxSeg(t, 330, 450);
      card.style.opacity = String(fade);
      if (glowEl) { // V4: ignition moved back to 200-330; on exit the
        // glow dies FIRST (330-400), then the card sinks away
        glowEl.style.transform = tr;
        glowEl.style.opacity = String(fxSeg(t, 200, 330) * (1 - fxSeg(t, 330, 400)));
      }
      if (frameEl) {
        frameEl.style.transform = tr;
        frameEl.style.opacity = String((neg ? fxSeg(t, 120, 300) : fxSeg(t, 200, 330)) * fade);
      }
      if (grayCopy) { // negated: the gray copy takes over 120-300, no gold anywhere
        grayCopy.style.transform = tr;
        grayCopy.style.opacity = String(fxSeg(t, 120, 300) * fade);
      }
    },
    onDone() { card.remove(); if (glowEl) glowEl.remove(); if (frameEl) frameEl.remove(); if (grayCopy) grayCopy.remove(); },
  });
}
// ---- set S/T activation (B9): the card tips into the chain
// presentation — tilted, white-rimmed — it never flips inside its zone
function fxSetActivate(code, linkNo, targetKey, deckKey) {
  const layer = fxLayerEl(); if (!layer) return;
  const app = $('app'); if (!app) return;
  const ar = fxRel(app);
  const d = fxPlaceGhost(code, false, { cx: ar.cx, cy: ar.y + ar.h * 0.36 }, 74, 96, deckKey); if (!d) return;
  // Redesign B (p2c, audit C3): when a SET S/T becomes link 2+, the
  // tilt path speaks the SAME grammar as a hand / field activation —
  // until now it had neither the CHAIN word nor a gold frame, so a
  // set trap joining the chain read as a lesser event. The word
  // stands by the chain bar (centred over it, 16 px above its top
  // edge, as in the prototype) and the gold frame (the preset
  // .fx3-goldframe layer — opacity only, never a per-frame shadow
  // write) sits over the flipped card's own tile. The frame is over
  // the face-up tile, so it does not depend on the card-back art.
  if (linkNo >= 2) {
    const bar = $('chainbar');
    let wx = ar.cx, wy = ar.y + ar.h * 0.36 - 70; // fallback: above the tilted pop
    if (bar) { const br = fxRel(bar); if (br.w > 0 || br.h > 0) { wx = br.cx; wy = br.y - 16; } }
    fxChainWord(wx, wy, 820);
    if (!targetKey && duelState && duelState.players) { // fallback: locate the tile from the standing state by code
      for (let con = 0; con < 2 && !targetKey; con++) {
        const P = duelState.players[con];
        if (!P || !P.szone) continue;
        const si = P.szone.findIndex(c => c && c.code === code);
        if (si >= 0) targetKey = con + ':' + E.LOC.SZONE + ':' + si;
      }
    }
    let frameEl = null;
    if (targetKey) {
      const slotEl = fxSlotEl(targetKey);
      if (slotEl) {
        const r = fxRel(slotEl);
        frameEl = fxNode('fx3-goldframe', r.cx, r.cy, Math.max(10, r.w - 2), Math.max(10, r.h - 2));
        if (frameEl) { frameEl.style.opacity = '0'; frameEl.style.zIndex = 6; }
      }
    }
    fxRecord('setactivatechain', { code, n: linkNo, frame: !!frameEl, targetKey: targetKey || null });
    fxAddScene({
      kind: 'setland', dur: 820,
      render(t) { if (frameEl) frameEl.style.opacity = String(0.95 * fxSeg(t, 40, 160) * (1 - fxSeg(t, 640, 820))); },
      onDone() { if (frameEl) frameEl.remove(); fxChainMarkLanded(linkNo, code); }, // the tilt lands like a pop: the word is absorbed into the bar
    });
  }
  // when this activation IS the chain's new link, the tilted card is
  // the foreground pop (B8) and carries the big link number itself —
  // a separate pop panel on top of it would just bury both.
  // V3 stage 2: the number SLAMS in (proposal 1.4 L2) instead of
  // sitting static for the whole presentation.
  if (linkNo) {
    d.innerHTML += '<div class="setno">' + linkNo + '</div>';
    const noEl = d.querySelector('.setno');
    if (noEl) {
      noEl.style.transformOrigin = '0 0';
      fxAddScene({ kind: 'setno', dur: 780, render(t) { noEl.style.transform = 'scale(' + (1.7 - 0.7 * FXE.settle(fxSeg(t, 40, 200))).toFixed(3) + ')'; } });
    }
  }
  d.style.transform = 'rotate(-14deg)';
  d.style.boxShadow = '0 0 0 2px #ffffff, 0 0 20px #ffffffaa';
  d.style.zIndex = 5;
  fxAnim(d, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 780, easing: 'ease-out' });
  fxKill(d, 820);
}
// ---- V3 stage 3: the ace appearance scene (proposal 1.1). ONE
// timeline (4,600 ms) owns the whole event — materials, portal,
// flash, cut-in, landing — so the round-A converge/portal and the
// round-B cut-in for the same summon are suppressed (takeover is
// total or not at all). The hold is ALIVE: background vortex and
// light streaks keep turning, particles drift up, the card's glow
// breathes, and the banner's ATK/DEF count up to their real
// values. A tap skips to the exit (the tap is never consumed).
let fxAceSceneRef = null;
// stage 3: cross-batch ace takeover marker {code, con, until} —
// the state diff and the summon event land in different
// fxProcess batches, so the marker must outlive a single call.
let fxAceRecent = null;
const FX_PORTAL_COLS = { fusion: ['#b286ff', '#4a2cb2'], synchro: ['#6fe08a', '#1d7a3a'], xyz: ['#59d8f2', '#1a6f8a'], generic: ['#ffd94d', '#c9a227'], revive: ['#ffe9a8', '#c9a227'] };
function fxAceSkip() {
  const sc = fxAceSceneRef;
  if (!sc || sc.dead || sc.skipLocal != null) return;
  const local = fxTimeMs - sc.t0;
  if (local < 3900) {
    sc.skipLocal = local; sc.dur = local + 700; // exit (300) + landing (350) + margin
    // the exit/landing now happen at THIS local time, not at
    // 3900/4200 — retarget the V4 paint windows to match
    sc.winLow = [[140, 1200], [local, local + 700]];
    sc.winTop = [[Math.min(1400, local), local + 700]];
  }
}
function fxAceSceneV3(o) {
  const layer = fxLayerEl(); if (!layer) return null;
  const host = $('fxcutin'); if (!host) return null;
  const app = $('app'); if (!app) return null;
  const ar = fxRel(app);
  const slotEl = fxSlotEl(o.key);
  // geometry fallback: with no painted slot (synthetic drives), the
  // zone side uses a nominal rect on the summoner's half — the
  // presentation must still run (the cut-in is the payload)
  const zr = slotEl ? fxRel(slotEl) : { cx: ar.cx, cy: ar.y + ar.h * (o.con === HP ? 0.60 : 0.28), w: 56, h: 76 };
  const d = cardData(o.code);
  const cols = FX_PORTAL_COLS[o.method] || FX_PORTAL_COLS.generic;
  const nodes = [];
  // ---- zone side (#fxlayer)
  const preglow = fxNode('fx fx3-core', zr.cx, zr.cy, Math.max(30, zr.w * 2.2), Math.max(30, zr.w * 2.2)); // L3
  if (preglow) { preglow.style.background = 'radial-gradient(circle,' + cols[0] + '88 0%,transparent 65%)'; preglow.style.opacity = '0'; nodes.push(preglow); }
  const psize = Math.max(zr.w, zr.h) * 1.35 || 60;
  const vA = fxNode('fx3-vortexA', zr.cx, zr.cy, psize, psize); // L4 outer vortex
  if (vA) { vA.style.background = 'repeating-conic-gradient(from 10deg,' + cols[0] + 'f2 0deg 16deg,' + cols[1] + '4d 16deg 34deg)'; vA.style.webkitMask = vA.style.mask = 'radial-gradient(circle,transparent 52%,#000 62%,#000 88%,transparent 96%)'; vA.style.opacity = '0'; nodes.push(vA); }
  const vB = fxNode('fx3-vortexB', zr.cx, zr.cy, psize * 0.62, psize * 0.62); // L4 inner counter-vortex
  if (vB) { vB.style.background = 'repeating-conic-gradient(from 190deg,' + cols[0] + 'd9 0deg 10deg,' + cols[1] + '33 10deg 26deg)'; vB.style.webkitMask = vB.style.mask = 'radial-gradient(circle,transparent 50%,#000 62%,#000 84%,transparent 94%)'; vB.style.opacity = '0'; nodes.push(vB); }
  // L6 converge flash is a three-tier bloom on the low canvas now (V4)
  const matGhosts = []; // L1/L2 materials (+ V4: two trail ghosts
  // under the card and a red-hot copy over it per material — the heat
  // is a preset filter on the copy, cross-faded by opacity only)
  for (const m of o.mats) {
    const pt = fxPtOfKey(m.key); if (!pt) continue;
    const gw = Math.max(10, pt.w - 2), gh = Math.max(10, pt.h - 24);
    const mDeck = deckKeyOfSeat(+m.key.split(':')[0]);
    const tr2 = fxPlaceGhost(m.code, false, pt, gw, gh, mDeck);
    if (tr2) { tr2.style.opacity = '0'; nodes.push(tr2); }
    const tr1 = fxPlaceGhost(m.code, false, pt, gw, gh, mDeck);
    if (tr1) { tr1.style.opacity = '0'; nodes.push(tr1); }
    const g = fxPlaceGhost(m.code, false, pt, gw, gh, mDeck);
    if (g) {
      const hot = fxPlaceGhost(m.code, false, pt, gw, gh, mDeck);
      if (hot) { hot.style.filter = 'brightness(2.1) saturate(1.6) hue-rotate(-18deg)'; hot.style.opacity = '0'; nodes.push(hot); }
      matGhosts.push({ el: g, hot, tr1, tr2, pt }); nodes.push(g);
    }
  }
  // Proposal S (ace path): a SYNCHRO ace also speaks the synchro
  // grammar on the zone side — the materials light (tuner = lapis
  // ring, the rest gold), their level pips ride the converge, and
  // the total stands at the zone, readable before the scrim covers
  // the board (~1000 ms). The 4600 ms timeline and the cut-in body
  // are untouched, and there is no second presentation: this decor
  // lives entirely inside the ace scene's own zone phase. When the
  // materials' levels cannot be read, nothing is added (the ace
  // scene runs exactly as before).
  let synDecor = null;
  if (o.method === 'synchro' && o.mats && o.mats.length) {
    const synInfo = fxSynchroInfo(o.mats);
    if (synInfo) {
      synDecor = fxSynchroDecor(synInfo, zr.cx, zr.cy - 30, { cx: zr.cx, cy: zr.cy });
      if (synDecor) for (const n of synDecor.nodes) nodes.push(n);
    }
  }
  const SYN_T_ACE = {
    appearBase: 40, appearStep: 20, flyBase: 150, flyStep: 30, flyDur: 280,
    glowIn: [0, 250], glowOut: [500, 560], tagOut: [480, 560],
    outlineIn: [150, 260], outlineOut: [560, 700], pipFade: [720, 900], numOut: [880, 1000],
  };
  // L17 landing rings are soft rings on the low canvas now (V4)
  const zoneGlowL = fxNode('fx3-emph', zr.cx, zr.cy, zr.w, zr.h); // L17 zone glow
  if (zoneGlowL) { zoneGlowL.style.borderColor = cols[0]; zoneGlowL.style.opacity = '0'; nodes.push(zoneGlowL); }
  fxSpawnBurst('low', { mode: 'spiral', seed: (Math.random() * 1e9) | 0, o: [zr.cx, zr.cy], n: 46, t0: fxTimeMs + 300, life: [500, 850], r: [46, 96], turns: 1.6, size: [3, 7], cols: [cols[0], '#ffffff', cols[1]], delayMax: 300, alpha: .95 }); // L5
  fxSpawnBurst('low', { seed: (Math.random() * 1e9) | 0, o: [zr.cx, zr.cy], n: 10, t0: fxTimeMs + 4200, life: [300, 520], speed: [40, 120], ang: [0, Math.PI * 2], grav: 380, dragK: 1.6, size: [2, 5], cols: ['#ffe9a8', '#ffffff'], alpha: .8 }); // L17 dust
  // ---- presentation side (#fxcutin)
  host.innerHTML = ''; host.className = 'on';
  const hmk = (cls) => { const n2 = document.createElement('div'); n2.className = cls; host.appendChild(n2); nodes.push(n2); return n2; };
  const scrim = hmk('scrim'); scrim.style.opacity = '0'; // L7
  // L8 backdrop + streaks: V4 R4 — drawn as rotating rasters in drawTop, no DOM layers
  const vw = Math.min(window.innerWidth || 390, 430);
  const cw = Math.round(Math.min(250, vw * 0.62)), chh = Math.round(cw * 1.38);
  const after1 = hmk('bigcard'); after1.style.width = cw + 'px'; after1.style.height = chh + 'px'; after1.style.opacity = '0'; after1.style.filter = 'brightness(1.5) saturate(1.3)'; // L9 V4 afterimages, 55/120 ms behind the card
  after1.innerHTML = '<div class="nm' + kindCls(o.code) + '">' + cardName(o.code) + '</div>';
  const after2 = hmk('bigcard'); after2.style.width = cw + 'px'; after2.style.height = chh + 'px'; after2.style.opacity = '0'; after2.style.filter = 'brightness(1.5) saturate(1.3)';
  after2.innerHTML = '<div class="nm' + kindCls(o.code) + '">' + cardName(o.code) + '</div>';
  const card = hmk('bigcard'); card.style.width = cw + 'px'; card.style.height = chh + 'px'; card.style.opacity = '0'; // L9
  artApply(after1, o.code, true, deckKeyOfSeat(o.con)); artApply(after2, o.code, true, deckKeyOfSeat(o.con)); artApply(card, o.code, true, deckKeyOfSeat(o.con));
  card.style.boxShadow = '0 0 42px ' + cols[0] + '77, 0 6px 24px #000c'; // static frame shadow, set once; the breathing glow is canvas now (V4)
  card.innerHTML = '<div class="nm' + kindCls(o.code) + '">' + cardName(o.code) + '</div>';
  const banner = hmk('banner'); banner.style.opacity = '0'; // L12/L13
  banner.innerHTML = '<div class="cn">' + cardName(o.code) + '</div><div class="rule"></div><div class="cs"></div>';
  const ruleEl = banner.querySelector('.rule');
  const csEl = banner.querySelector('.cs');
  const ccx = ar.cx, ccy = ar.y + ar.h * 0.40;
  const ringMk = () => { const r = hmk('fx fx3-ring'); r.style.left = (ccx - 32) + 'px'; r.style.top = (ccy - 32) + 'px'; r.style.width = '64px'; r.style.height = '64px'; r.style.borderColor = cols[0]; r.style.opacity = '0'; return r; };
  const ringA = ringMk(), ringB = ringMk(); // L10
  fxSpawnBurst('top', { seed: (Math.random() * 1e9) | 0, o: [ccx, ccy], n: 24, t0: fxTimeMs + 950, life: [380, 720], speed: [120, 300], ang: [0, Math.PI * 2], grav: 300, dragK: 2.2, size: [3, 7], cols: [cols[0], '#ffffff', cols[1]], alpha: .95 }); // L11
  fxSpawnBurst('top', { seed: (Math.random() * 1e9) | 0, o: [ccx, ccy + 40], n: 26, t0: fxTimeMs + 1300, life: [1800, 2600], speed: [8, 26], ang: [-Math.PI / 2, .9], grav: -14, dragK: .4, size: [2, 5], cols: [cols[0], '#ffffff'], delayMax: 800, alpha: .55 }); // L14
  const portalAngle = (te) => { const ds = (te - 300) / 1000; if (ds <= 0) return 0; if (ds < 0.4) return 625 * ds * ds; return 100 + 500 * (ds - 0.4); };
  const sc = fxAddScene({
    kind: 'ace', dur: 4600, winLow: [[140, 1200], [4150, 4600]], winTop: [[740, 4600]],
    cues: [{ at: 700, fn: () => playSe('summon_big') }], // L6 is the SE sync point A (the landing sound of the special summon)
    // V4 (proposal 追記 V4-1): the light layers — funnel core + rim
    // at the zone, material heat, the 700 ms three-tier flash bloom
    // and the landing soft rings (low canvas); the breathing hold
    // glow and the exit implosion ring (top canvas).
    drawLow(ctx, t) {
      const te = sc.skipLocal != null && t > sc.skipLocal ? 3900 + (t - sc.skipLocal) : t;
      const po = fxSeg(te, 300, 380) * (1 - fxSeg(te, 1020, 1180));
      if (po > 0) { // dark funnel core + rim light breathing with the spin-up
        const spin = fxSeg(te, 300, 700);
        fxDrawGlow(ctx, zr.cx, zr.cy, fxLerp(30, 86, spin), '#05030a', .55 * po, false);
        fxDrawSoftRing(ctx, zr.cx, zr.cy, psize * .40, cols[0], (.25 + .55 * spin + .08 * Math.sin(te / 37)) * po, .10);
      }
      for (const mg of matGhosts) { // white heat at each converging material
        const cu = FXE.inCubic(fxSeg(te, 150, 550));
        if (cu > 0 && cu < 1) fxDrawGlow(ctx, fxLerp(mg.pt.cx, zr.cx, cu), fxLerp(mg.pt.cy, zr.cy, cu), 26, '#ffffff', .5 * cu);
      }
      if (te > 700 && te < 860) { // L6: the flash, as a three-tier bloom
        const fl = Math.sin(Math.PI * fxSeg(te, 700, 860));
        fxDrawGlow(ctx, zr.cx, zr.cy, 52, '#ffffff', .95 * fl);
        fxDrawGlow(ctx, zr.cx, zr.cy, 120, cols[0], .55 * fl);
        fxDrawGlow(ctx, zr.cx, zr.cy, 215, cols[0], .30 * fl);
      }
      if (te >= 4200) { // L17: landing soft rings, 60 ms stagger
        const u1 = fxSeg(te, 4200, 4520); if (u1 > 0 && u1 < 1) fxDrawSoftRing(ctx, zr.cx, zr.cy, 32 * (0.5 + 0.8 * FXE.outCubic(u1)), cols[0], .9 * (1 - u1), .12);
        const u2 = fxSeg(te, 4260, 4580); if (u2 > 0 && u2 < 1) fxDrawSoftRing(ctx, zr.cx, zr.cy, 32 * (0.5 + 0.8 * FXE.outCubic(u2)), cols[0], .7 * (1 - u2), .12);
      }
    },
    drawTop(ctx, t) {
      const te = sc.skipLocal != null && t > sc.skipLocal ? 3900 + (t - sc.skipLocal) : t;
      // V4 R4: the swirl backdrop + counter-rotating streaks as
      // canvas rasters (they were DOM conic layers — the repaint
      // cost the distributions kept flagging in the hold phase)
      const bgIn = fxSeg(te, 750, 1100), bgOut = 1 - fxSeg(te, 3900, 4200);
      if (bgIn > 0 && bgOut > 0) {
        const rotTe = Math.min(te, 3900);
        fxDrawRotRaster(ctx, fxConicRaster(cols[0], 430, 14, 30, .19), ccx, ccy, ((rotTe - 750) * 12 / 1000) % 360, .85 * bgIn * bgOut);
        fxDrawRotRaster(ctx, fxConicRaster('#fff0c8', 520, 2, 18, .14), ccx, ccy, -((rotTe - 750) * 6 / 1000) % 360, .7 * bgIn * bgOut);
      }
      if (te < 1400) return;
      const cardOp = fxSeg(te, 900, 1030) * (1 - fxSeg(te, 3900, 4200));
      if (cardOp <= 0) return;
      const exitU = fxSeg(te, 3900, 4200), shrink = 1 - .45 * exitU;
      const ph = 2 * Math.PI * (te - 1400) / 2400;
      fxDrawGlow(ctx, ccx, ccy, 200 * shrink, cols[0], (.30 + .08 * Math.sin(ph)) * cardOp);
      fxDrawGlow(ctx, ccx, ccy, 130 * shrink, '#ffe9a8', (.14 + .05 * Math.sin(ph + 1.2)) * cardOp);
      if (exitU > 0 && exitU < 1) fxDrawSoftRing(ctx, ccx, ccy, 190 * shrink, cols[0], .4 * exitU, .14); // the glow collapses inward before the scrim lifts
    },
    render(t) {
      const te = sc.skipLocal != null && t > sc.skipLocal ? 3900 + (t - sc.skipLocal) : t;
      // L1/L2: materials glow red-hot (the preset-filter copy fades
      // in over the card), trail ghosts ride at 66% / 33% of the
      // path, then everything converges into the point (V4)
      for (const mg of matGhosts) {
        const glow = FXE.outCubic(fxSeg(te, 0, 250));
        const cu = FXE.inCubic(fxSeg(te, 150, 550));
        const op = 1 - fxSeg(te, 500, 560);
        const tr = 'translate(' + ((zr.cx - mg.pt.cx) * cu).toFixed(1) + 'px,' + ((zr.cy - mg.pt.cy) * cu).toFixed(1) + 'px) scale(' + (1 - 0.78 * cu).toFixed(3) + ')';
        mg.el.style.transform = tr;
        mg.el.style.opacity = String(op);
        if (mg.hot) { mg.hot.style.transform = tr; mg.hot.style.opacity = String(glow * op); }
        const trailIn = fxSeg(te, 150, 250);
        for (const tp of [[mg.tr1, .66, .30], [mg.tr2, .33, .15]]) {
          if (!tp[0]) continue;
          const cuT = cu * tp[1];
          tp[0].style.transform = 'translate(' + ((zr.cx - mg.pt.cx) * cuT).toFixed(1) + 'px,' + ((zr.cy - mg.pt.cy) * cuT).toFixed(1) + 'px) scale(' + (1 - 0.78 * cuT).toFixed(3) + ')';
          tp[0].style.opacity = String(tp[2] * op * trailIn);
        }
      }
      // Proposal S (ace path): the synchro decor rides the same
      // zone phase — lights with the 0-250 ms glow, pips converge
      // with the material ghosts (150-560 ms), the total is read
      // and gone before the scrim finishes rising (750-1000 ms)
      if (synDecor) synDecor.render(te, SYN_T_ACE);
      // L3: the zone lights before the portal opens
      if (preglow) preglow.style.opacity = String(0.85 * fxSeg(te, 250, 380) * (1 - fxSeg(te, 480, 800)));
      // L4: rotation RAMPS 0 -> 500 deg/s (300-700), inner ring counter-rotates at -1.6x
      if (vA || vB) {
        const th = portalAngle(te);
        const ps = 0.55 + 0.45 * FXE.settle(fxSeg(te, 300, 700));
        const po = fxSeg(te, 300, 380) * (1 - fxSeg(te, 1020, 1180));
        if (vA) { vA.style.transform = 'rotate(' + th.toFixed(1) + 'deg) scale(' + ps.toFixed(3) + ')'; vA.style.opacity = String(po); }
        if (vB) { vB.style.transform = 'rotate(' + (-1.6 * th).toFixed(1) + 'deg) scale(' + ps.toFixed(3) + ')'; vB.style.opacity = String(po); }
      }
      // L6: the converge flash is the drawLow three-tier bloom now
      // L7/L8: scrim in; background vortex + streaks turn for the
      // WHOLE hold — but the exit is two-stage (V4): the rotation
      // freezes at 3900 and the scrim only lifts from 3980
      const holdOut = 1 - fxSeg(te, 3900, 4200);
      const rotTe = Math.min(te, 3900);
      if (scrim) scrim.style.opacity = String(0.78 * fxSeg(te, 750, 1000) * (1 - fxSeg(te, 3980, 4200)));
      // (the swirl backdrop is drawn in drawTop as rasters, R4)
      // L9/L15/L16: card settles in (its breathing glow is the
      // drawTop canvas now) and sinks 6 px as it exits
      if (card) {
        const sIn = 1.35 - 0.35 * FXE.settle(fxSeg(te, 900, 1350));
        const sOut = 1 - 0.15 * fxSeg(te, 3900, 4200);
        card.style.transform = 'translate(-50%,-50%) translateY(' + (6 * fxSeg(te, 3900, 4200)).toFixed(1) + 'px) scale(' + (sIn * sOut).toFixed(3) + ')';
        card.style.opacity = String(fxSeg(te, 900, 1030) * holdOut);
      }
      // L9 V4: two afterimages trail the card's entrance by 55/120 ms
      for (const ap of [[after1, 55, .30], [after2, 120, .14]]) {
        if (!ap[0]) continue;
        const teL = te - ap[1];
        if (teL >= 900 && te < 2100) {
          const sL = 1.35 - 0.35 * FXE.settle(fxSeg(teL, 900, 1350));
          ap[0].style.transform = 'translate(-50%,-50%) scale(' + sL.toFixed(3) + ')';
          ap[0].style.opacity = String(ap[2] * (1 - fxSeg(teL, 1200, 1900)) * fxSeg(teL, 900, 1030));
        } else ap[0].style.opacity = '0';
      }
      // L10: burst rings, 150 ms apart
      if (ringA) { const u = FXE.outCubic(fxSeg(te, 950, 1550)); ringA.style.transform = 'scale(' + (0.4 + 1.2 * u).toFixed(3) + ')'; ringA.style.opacity = String(0.8 * (1 - u) * (te >= 950 ? 1 : 0)); }
      if (ringB) { const u = FXE.outCubic(fxSeg(te, 1100, 1700)); ringB.style.transform = 'scale(' + (0.4 + 1.2 * u).toFixed(3) + ')'; ringB.style.opacity = String(0.7 * (1 - u) * (te >= 1100 ? 1 : 0)); }
      // L12/L13: banner snaps in; V4 stagger — the name lands, the
      // gold rule draws (1180-1400), the count starts at 1280
      if (banner) {
        banner.style.opacity = String(fxSeg(te, 1100, 1400) * holdOut);
        banner.style.transform = 'translateX(' + (-26 * (1 - FXE.snap(fxSeg(te, 1100, 1400)))).toFixed(1) + 'px)';
        if (ruleEl) { ruleEl.style.transform = 'scaleX(' + fxSeg(te, 1180, 1400).toFixed(3) + ')'; ruleEl.style.opacity = String(fxSeg(te, 1100, 1400) * holdOut); }
        if (csEl && d && d.atk != null) {
          const u = FXE.outCubic(fxSeg(te, 1280, 1680));
          csEl.textContent = 'ATK ' + Math.round(d.atk * u) + ' ／ DEF ' + Math.round(d.def * u);
        }
      }
      // L17: the landing beat on the real board zone (the rings are
      // drawLow soft rings now; the zone glow stays DOM)
      if (zoneGlowL) zoneGlowL.style.opacity = String(0.9 * Math.sin(Math.PI * fxSeg(te, 4200, 4550)));
    },
    onDone() {
      for (const n of nodes) { try { n.remove(); } catch (e) {} }
      if (host.className === 'on') host.className = '';
      fxAceSceneRef = null;
    },
  });
  fxAceSceneRef = sc;
  return sc;
}
// ---- keycard spell/trap activation cut-in (user, 2026-11-04):
// a key card that is a SPELL or TRAP gets an ace-grade presentation
// when it ACTIVATES — the same trigger that raises the BGM ladder
// (the codes come from KEYCARD_ACTIVATE_CODES, the keycard
// definitions themselves, never a per-name branch in the FX code).
// The summon ace scene is built around materials converging on an
// empty zone, so an activation — the card already stands in its
// S/T zone — takes the same STAGE instead: a gold frame stands
// over the card's own tile, the scrim rises, and the card itself
// stands large with its name banner. Shorter than the summon
// scene (2400 ms): an activation usually sits inside a chain and
// must not hold the duel up. While it runs it OWNS the event —
// fxRoundBEvents skips the generic fxSetActivate tilt pop for the
// same activation, so the two never stack. Any tap skips to the
// exit, like the ace scene.
let fxKeycardSceneRef = null;
function fxKeycardSkip() {
  const sc = fxKeycardSceneRef;
  if (!sc || sc.dead || sc.skipLocal != null) return;
  const local = fxTimeMs - sc.t0;
  if (local < 2000) { sc.skipLocal = local; sc.dur = local + 420; }
}
function fxKeycardCutin(code, con, key) {
  const layer = fxLayerEl(); if (!layer) return null;
  const host = $('fxcutin'); if (!host) return null;
  const app = $('app'); if (!app) return null;
  const ar = fxRel(app);
  const cols = FX_PORTAL_COLS.generic;
  const nodes = [];
  // zone side: the gold frame over the activating card's own tile
  // (the card does not move; the frame is what says this one is
  // the key card — the same preset fxSetActivate uses for chain
  // links, held for the whole presentation here)
  let frameEl = null;
  const slotEl = key ? fxSlotEl(key) : null;
  if (slotEl) {
    const r = fxRel(slotEl);
    frameEl = fxNode('fx3-goldframe', r.cx, r.cy, Math.max(10, r.w - 2), Math.max(10, r.h - 2));
    if (frameEl) { frameEl.style.opacity = '0'; frameEl.style.zIndex = 6; nodes.push(frameEl); }
  }
  // presentation side (#fxcutin): scrim, the big card (big art
  // file, top-anchored; unlisted key S/T fall back to the shared
  // placeholder through the .bigcard class background, exactly
  // like the summon cut-in), the name banner, burst rings.
  host.innerHTML = ''; host.className = 'on';
  const hmk = (cls) => { const n2 = document.createElement('div'); n2.className = cls; host.appendChild(n2); nodes.push(n2); return n2; };
  const scrim = hmk('scrim'); scrim.style.opacity = '0';
  const vw = Math.min(window.innerWidth || 390, 430);
  const cw = Math.round(Math.min(250, vw * 0.62)), chh = Math.round(cw * 1.38);
  const card = hmk('bigcard'); card.style.width = cw + 'px'; card.style.height = chh + 'px'; card.style.opacity = '0';
  artApply(card, code, true, deckKeyOfSeat(con));
  card.style.boxShadow = '0 0 42px ' + cols[0] + '77, 0 6px 24px #000c';
  card.innerHTML = '<div class="nm' + kindCls(code) + '">' + cardName(code) + '</div>';
  const banner = hmk('banner'); banner.style.opacity = '0';
  const d = cardData(code);
  banner.innerHTML = '<div class="cn">' + cardName(code) + '</div><div class="rule"></div><div class="cs">' + (d && (d.type & 0x4) ? '罠カード' : '魔法カード') + '</div>';
  const ruleEl = banner.querySelector('.rule');
  const ccx = ar.cx, ccy = ar.y + ar.h * 0.40;
  const ringMk = () => { const r = hmk('fx fx3-ring'); r.style.left = (ccx - 32) + 'px'; r.style.top = (ccy - 32) + 'px'; r.style.width = '64px'; r.style.height = '64px'; r.style.borderColor = cols[0]; r.style.opacity = '0'; return r; };
  const ringA = ringMk(), ringB = ringMk();
  fxSpawnBurst('top', { seed: (Math.random() * 1e9) | 0, o: [ccx, ccy], n: 20, t0: fxTimeMs + 350, life: [380, 720], speed: [120, 300], ang: [0, Math.PI * 2], grav: 300, dragK: 2.2, size: [3, 7], cols: [cols[0], '#ffffff', cols[1]], alpha: .95 });
  const sc = fxAddScene({
    kind: 'keycardact', dur: 2400,
    render(t) {
      const te = sc.skipLocal != null && t > sc.skipLocal ? 2000 + (t - sc.skipLocal) : t;
      const holdOut = 1 - fxSeg(te, 2000, 2320);
      if (frameEl) frameEl.style.opacity = String(0.95 * fxSeg(te, 0, 160) * (1 - fxSeg(te, 1900, 2320)));
      if (scrim) scrim.style.opacity = String(0.78 * fxSeg(te, 150, 400) * (1 - fxSeg(te, 2050, 2320)));
      if (card) {
        const sIn = 1.35 - 0.35 * FXE.settle(fxSeg(te, 300, 750));
        const sOut = 1 - 0.15 * fxSeg(te, 2000, 2320);
        card.style.transform = 'translate(-50%,-50%) translateY(' + (6 * fxSeg(te, 2000, 2320)).toFixed(1) + 'px) scale(' + (sIn * sOut).toFixed(3) + ')';
        card.style.opacity = String(fxSeg(te, 300, 430) * holdOut);
      }
      if (ringA) { const u = FXE.outCubic(fxSeg(te, 350, 950)); ringA.style.transform = 'scale(' + (0.4 + 1.2 * u).toFixed(3) + ')'; ringA.style.opacity = String(0.8 * (1 - u) * (te >= 350 ? 1 : 0)); }
      if (ringB) { const u = FXE.outCubic(fxSeg(te, 500, 1100)); ringB.style.transform = 'scale(' + (0.4 + 1.2 * u).toFixed(3) + ')'; ringB.style.opacity = String(0.7 * (1 - u) * (te >= 500 ? 1 : 0)); }
      if (banner) {
        banner.style.opacity = String(fxSeg(te, 500, 800) * holdOut);
        banner.style.transform = 'translateX(' + (-26 * (1 - FXE.snap(fxSeg(te, 500, 800)))).toFixed(1) + 'px)';
        if (ruleEl) { ruleEl.style.transform = 'scaleX(' + fxSeg(te, 580, 800).toFixed(3) + ')'; ruleEl.style.opacity = String(fxSeg(te, 500, 800) * holdOut); }
      }
    },
    onDone() {
      for (const n of nodes) { try { n.remove(); } catch (e) {} }
      if (host.className === 'on') host.className = '';
      fxKeycardSceneRef = null;
    },
  });
  fxKeycardSceneRef = sc;
  return sc;
}
// ---- ace cut-in (B6, legacy path for arrivals the stage-3 scene
// does not take over — revivals): portal flash on the zone (round
// A) -> the scrim dims the field -> the card, large, with a
// name/ATK/DEF banner. ~4.7 s; any tap skips it.
let fxCutinTimer = null, fxCutinGen = 0;
function fxCutinShow(code, deckKey) {
  const host = $('fxcutin'); if (!host) return;
  ++fxCutinGen;
  const d = cardData(code);
  const vw = Math.min(window.innerWidth || 390, 430);
  const w = Math.round(Math.min(250, vw * 0.62)), h = Math.round(w * 1.38);
  host.innerHTML = '<div class="scrim"></div>' +
    '<div class="bigcard" style="width:' + w + 'px;height:' + h + 'px;' + artCss(code, true, deckKey) + '"><div class="nm' + kindCls(code) + '">' + cardName(code) + '</div></div>' +
    '<div class="banner"><div class="cn">' + cardName(code) + '</div>' +
    '<div class="cs">' + (d && (d.type & 0x1) ? 'ATK ' + d.atk + ' ／ DEF ' + d.def : '') + '</div></div>';
  host.className = 'on';
  const sc = host.querySelector('.scrim'); fxAnim(sc, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
  const bc = host.querySelector('.bigcard');
  fxAnim(bc, [
    { transform: 'translate(-50%,-50%) scale(.68)', opacity: 0 },
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
  ], { duration: 400, easing: 'ease-out' });
  const bn = host.querySelector('.banner'); fxAnim(bn, [{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 160, easing: 'ease-out' });
  if (fxCutinTimer) clearTimeout(fxCutinTimer);
  fxCutinTimer = setTimeout(() => fxCutinHide(), 4400);
}
function fxCutinHide() {
  if (fxAceSceneRef && !fxAceSceneRef.dead) return; // V3 stage 3: the ace scene owns the host (tap = its skip)
  const host = $('fxcutin'); if (!host || host.className !== 'on') return;
  const gen = ++fxCutinGen;
  if (fxCutinTimer) { clearTimeout(fxCutinTimer); fxCutinTimer = null; }
  [...host.children].forEach(ch => fxAnim(ch, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in' }));
  setTimeout(() => { if (fxCutinGen === gen) { host.className = ''; host.innerHTML = ''; } }, 280);
}
document.addEventListener('pointerdown', () => { if (fxAceSceneRef && !fxAceSceneRef.dead) fxAceSkip(); else if (fxKeycardSceneRef && !fxKeycardSceneRef.dead) fxKeycardSkip(); else fxCutinHide(); }, true); // tap anywhere skips; never consumes the tap
// ---- in-place position changes (B9): flips and ATK<->DEF rotation
function fxRoundBChanged(ch, evs, prev, cur) {
  const [con, loc] = ch.key.split(':').map(Number);
  const b = ch.before, a = ch.after;
  if (!b || !a || b.code !== a.code) return;
  const bUp = (b.pos & E.POS_FACEUP) !== 0, aUp = (a.pos & E.POS_FACEUP) !== 0;
  if (!bUp && aUp) { // face-down -> face-up: white flash + edge-on flip
    fxWhiteFlash(ch.key);
    const tile = document.querySelector('.slot[data-zone="' + ch.key + '"] .tile');
    if (tile) fxAnim(tile, [
      { transform: 'scaleX(1)' }, { transform: 'scaleX(.06)', offset: 0.45 }, { transform: 'scaleX(1)' },
    ], { duration: 430, easing: 'ease-in-out' });
    fxRecord('flip', { code: a.code });
    return;
  }
  if (bUp && aUp && loc === E.LOC.MZONE) { // attack <-> defense: the card body rotates
    const bDef = (b.pos & E.POS_DEFENSE) !== 0, aDef = (a.pos & E.POS_DEFENSE) !== 0;
    if (bDef !== aDef) {
      const inner = document.querySelector('.slot[data-zone="' + ch.key + '"] .tile .inner');
      if (inner) fxAnim(inner, aDef
        ? [{ transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(90deg) scale(.82)' }]
        : [{ transform: 'rotate(90deg) scale(.82)' }, { transform: 'rotate(0deg) scale(1)' }], { duration: 330, easing: 'ease-in-out' });
      fxRecord('poschange', { code: a.code, to: aDef ? 'def' : 'atk' });
    }
  }
}
function fxRoundBEvents(evs, prev, cur, diff) {
  const st = diff.state;
  // redesign D (p4b): the opponent's action name tag reads the
  // same event batch (see fxOppTagsFromEvents for its strict
  // public-events-only scope)
  fxOppTagsFromEvents(evs, st);
  // ---- ace cut-in (B6; V3 stage 3: arrivals the ace scene took
  // over are skipped here — the scene already presented them)
  if (fxSettings.cutin) {
    for (const ev of evs) {
      if ((ev.kind === 'summon' || ev.kind === 'spsummon') && ev.code != null && FX_CUTIN_CODES.has(ev.code)) {
        // arrivals pass already owns this summon (the marker
        // survives across fxProcess batches; the state diff and
        // the summon event routinely land in different batches)
        if (fxAceRecent && fxAceRecent.code === ev.code && fxAceRecent.con === ev.con && fxTimeMs <= fxAceRecent.until) { fxAceRecent = null; continue; }
        // fallback: the event beat the state diff — take the
        // summon over from here so it still gets exactly one
        // presentation, the scene (materials unknown on this
        // path; the presentation runs without the converge)
        let key = null;
        for (const k in cur.z) { const ze = cur.z[k]; if (ze && ze.code === ev.code && k.split(':')[0] === String(ev.con) && k.split(':')[1] === String(E.LOC.MZONE)) { key = k; break; } }
        const sc = key ? fxAceSceneV3({ code: ev.code, key, con: ev.con, method: null, mats: [] }) : null;
        if (sc) { fxRecord('cutin', { code: ev.code, via: 'acescene-event' }); fxAceRecent = { code: ev.code, con: ev.con, until: fxTimeMs + 8000 }; continue; }
        if (fxAceSceneRef && !fxAceSceneRef.dead) continue; // an ace scene is presenting; never poster over it
        fxCutinShow(ev.code, deckKeyOfSeat(ev.con));
        fxRecord('cutin', { code: ev.code });
      }
    }
  }
  // ---- keycard spell/trap activations (user, 2026-11-04): the
  // ace-grade stage, on the BGM ladder's own trigger (an
  // 'activate' event for a KEYCARD_ACTIVATE_CODES code). When the
  // presentation runs it owns the event — the generic set S/T
  // tilt below stands down for it, so the two never stack. With
  // the cut-in setting off, or while an ace scene is presenting,
  // the generic presentation keeps the activation as before.
  const keyActOwned = new Set();
  if (fxSettings.cutin) {
    for (const ev of evs) {
      if (ev.kind !== 'activate' || ev.code == null || !KEYCARD_ACTIVATE_CODES.has(ev.code)) continue;
      if (fxAceSceneRef && !fxAceSceneRef.dead) continue; // never poster over an ace scene
      if (fxKeycardSceneRef && !fxKeycardSceneRef.dead) continue; // one keycard stage at a time
      let key = null;
      for (const k in cur.z) { const ze = cur.z[k]; if (ze && ze.code === ev.code && k.split(':')[0] === String(ev.con) && k.split(':')[1] === String(ev.loc)) { key = k; break; } }
      const scK = fxKeycardCutin(ev.code, ev.con, key);
      if (scK) { keyActOwned.add(ev); fxRecord('keycardact', { code: ev.code }); fxRecord('cutin', { code: ev.code, via: 'keycardact' }); }
    }
  }
  // ---- chain growth is computed first: a set S/T activation that
  // IS the new link merges its tilt pop with the chain pop (B8+B9)
  const grew = cur.links.length > prev.links.length;
  const newLink = grew ? cur.links[cur.links.length - 1] : null;
  let popDone = false;
  // ---- set S/T activations (B9): SZONE activations tip into the
  // chain presentation; activations from hand/grave keep the
  // existing showcase side
  for (const ev of evs) {
    if (ev.kind !== 'activate' || ev.loc !== E.LOC.SZONE) continue;
    if (keyActOwned.has(ev)) continue; // the keycard stage owns this activation (no stacking)
    const isNewLink = !!(newLink && ev.code === newLink.code && ev.con === newLink.con);
    // redesign B (p2c): the raw chain link carries the set card's
    // own zone (con/loc/seq) — pass it so fxSetActivate can put the
    // gold frame on that exact tile
    let targetKey = null;
    if (isNewLink && st && Array.isArray(st.chain)) {
      const raw = st.chain[cur.links.length - 1];
      if (raw && raw.loc === E.LOC.SZONE && raw.seq != null) targetKey = raw.con + ':' + raw.loc + ':' + raw.seq;
    }
    fxSetActivate(ev.code, isNewLink ? cur.links.length : 0, targetKey, deckKeyOfSeat(ev.con));
    if (isNewLink) popDone = true;
    fxRecord('setactivate', { code: ev.code });
  }
  // ---- attacks (B7 -> V3 stage 2 scene)
  let lastAtkAttr = null;
  const atkList = fxAttackKeys(evs, st);
  for (const ev of evs) {
    if (ev.kind === 'damage') fxLastHitAt = performance.now();
    if (ev.kind !== 'attack') continue;
    const d = ev.code != null ? cardData(ev.code) : null;
    const attr = d ? d.attribute : null;
    lastAtkAttr = attr;
    fxLastHitAt = performance.now(); fxLastHitAttr = attr;
    const ak = atkList.find(x => x.ev === ev) || {};
    let aKey = ak.aKey || null, tKey = ak.tKey || null;
    if (!aKey && ev.code != null) { // fallback: find the attacker in the standing snapshot
      for (const k of Object.keys(cur.z)) {
        const e2 = cur.z[k], parts = k.split(':').map(Number);
        if (e2 && e2.code === ev.code && parts[0] === ev.con && parts[1] === E.LOC.MZONE) { aKey = k; break; }
      }
    }
    const direct = ev.direct || !tKey;
    const aPt = aKey ? fxPtOfKey(aKey) : null;
    let tPt = null, targetCode = null, destroyed = false;
    if (direct) { // direct attack: the line runs to the LP plate + banner
      const lpEl = fxLpEl(1 - ev.con);
      tPt = lpEl ? fxRel(lpEl) : null;
    } else {
      tPt = tKey ? fxPtOfKey(tKey) : null;
      const dep = diff.departed.find(dd => dd.key === tKey);
      const standing = cur.z[tKey];
      targetCode = dep ? dep.entry.code : (standing ? standing.code : null);
      destroyed = !!dep && evs.some(e2 => e2.kind === 'destroy' && e2.code === dep.entry.code);
    }
    if (aPt && tPt) {
      const sc = fxAttackSceneV3({ aPt, tPt, attr, direct, targetCode, destroyed, tDeck: deckKeyOfSeat(tKey ? +tKey.split(':')[0] : 1 - ev.con) });
      if (sc) fxLastAttackScene = { t0: sc.t0, defCon: 1 - ev.con, aPt, tPt, attr, code: ev.code, aKey };
    }
    if (direct) fxAtkBanner();
    fxRecord('attackline', { code: ev.code, direct: !!direct });
    if (direct) fxRecord('directattack', { code: ev.code });
    else fxRecord('impact', { code: ev.code, attr });
  }
  // ---- finisher (B7): only the blow that ends the duel gets the
  // full-screen wash (attribute-tinted); the result overlay follows.
  // Keyed on the winner transition + a recent hit (see fxLastHitAt)
  if (cur.winner != null && prev.winner == null && fxLastHitAt && performance.now() - fxLastHitAt < 5000) {
    fxFinisherSceneV3(lastAtkAttr != null ? lastAtkAttr : fxLastHitAttr);
    fxRecord('finisher', { attr: lastAtkAttr != null ? lastAtkAttr : fxLastHitAttr });
  }
  // ---- chain (B8): newest link pops forward; solving is recorded
  // (its glow lives on the bar chip in render). Skipped when the new
  // link is a set S/T activation — its tilt pop already carries the
  // number (see fxSetActivate)
  if (grew && !popDone) {
    const n = cur.links.length;
    fxChainSceneV3(n, cur.links[n - 1].code, deckKeyOfSeat(cur.links[n - 1].con));
    fxRecord('chainpop', { n, code: cur.links[n - 1].code });
  } else if (grew) {
    fxRecord('chainpop', { n: cur.links.length, code: cur.links[cur.links.length - 1].code, via: 'tilt' });
  }
  if (cur.solving !== prev.solving && cur.solving > 0) {
    fxRecord('chainsolving', { n: cur.solving });
    const link = cur.links[cur.solving - 1];
    if (link) fxChainSolveSceneV3(cur.solving, link.code, !!link.neg, deckKeyOfSeat(link.con));
  }
  // ---- LP (B7 -> V3 stage 2 -> Redesign F): the counter counts on
  // the FX clock; after an attack it starts at attack+400 ms (impact
  // first, then the number — cause before effect).
  // Redesign F classification, per seat and batch:
  //  - attack-scheduled drop (an attack scene for this seat started
  //    <400 ms ago — the same predicate that schedules the count):
  //    BATTLE damage. It keeps the fxLpCount damage number and gets
  //    NO F chip (no double presentation). The finisher's drain owns
  //    its seat the same way: no chip while a finisher scene holds
  //    the counter, and a lethal attack drop is attack-scheduled by
  //    construction, so the drain is never doubled either.
  //  - any other drop: split by the batch's events — 'pay' events
  //    (MSG_PAY_LPCOST, engine redesign-F) are LP COSTS (gold chip),
  //    'damage' events are EFFECT damage (red chip). A drop no event
  //    explains (e.g. an LPUPDATE sync) falls back to effect damage.
  //    fxLpCount's battle number is suppressed (noNum) so the drop
  //    is shown exactly once, as chip(s); the count itself still
  //    runs monotonically from the pinned start value.
  //  - a rise: a heal. The heal float node IS the + chip (gold for
  //    me, lapis-white for the opponent; see fxHealFloat).
  for (let p = 0; p < 2; p++) {
    if (cur.lp[p] === prev.lp[p]) continue;
    if (fxLpShown[p] == null) fxLpShown[p] = prev.lp[p];
    const delta = cur.lp[p] - prev.lp[p];
    let startAt = null;
    if (delta < 0 && fxLastAttackScene && fxLastAttackScene.defCon === p && fxTimeMs - fxLastAttackScene.t0 < 400) startAt = fxLastAttackScene.t0 + 400;
    const attackScheduled = startAt != null;
    const finisherOwns = !!(fxLpScenes[p] && !fxLpScenes[p].dead && fxLpScenes[p].kind === 'finisher');
    const chipLoss = delta < 0 && !attackScheduled && !finisherOwns;
    fxLpCount(p, cur.lp[p], startAt, chipLoss ? { noNum: true } : null);
    fxRecord('lpchange', { player: p, from: prev.lp[p], to: cur.lp[p] });
    if (delta > 0) {
      fxHealFloat(p, delta);
      fxRecord('healfloat', { player: p, amount: delta });
      fxRecord('lpchip', { player: p, chip: 'heal', amount: delta, signed: delta, variant: p === HP ? 'mine' : 'opp', down: p !== HP });
    } else if (chipLoss) {
      const loss = -delta;
      let payAmt = 0, dmgAmt = 0;
      for (const ev of evs) {
        if (ev.player !== p || ev.amount == null) continue;
        if (ev.kind === 'pay') payAmt += ev.amount;
        else if (ev.kind === 'damage') dmgAmt += ev.amount;
      }
      // Reconcile the event split with the actual net loss: an
      // unexplained remainder reads as effect damage; if the events
      // overshoot the net (a heal offset the same batch), trim
      // damage first, then pay, so the chips always sum to the loss.
      if (payAmt + dmgAmt < loss) dmgAmt += loss - (payAmt + dmgAmt);
      else if (payAmt + dmgAmt > loss) {
        let excess = payAmt + dmgAmt - loss;
        const cutD = Math.min(dmgAmt, excess); dmgAmt -= cutD; excess -= cutD;
        payAmt -= excess;
      }
      let stack = 0;
      if (payAmt > 0) { fxLpChip(p, 'pay', payAmt, stack++); fxRecord('lpchip', { player: p, chip: 'pay', amount: payAmt, signed: -payAmt, variant: 'pay', down: p !== HP }); }
      if (dmgAmt > 0) { fxLpChip(p, 'damage', dmgAmt, stack++); fxRecord('lpchip', { player: p, chip: 'damage', amount: dmgAmt, signed: -dmgAmt, variant: 'damage', down: p !== HP }); }
    }
  }
}
function fxResetRoundB() {
  if (fxCutinTimer) { clearTimeout(fxCutinTimer); fxCutinTimer = null; }
  fxCutinGen++;
  fxLastHitAt = 0; fxLastHitAttr = null;
  fxLastAttackScene = null;
  for (let p = 0; p < 2; p++) {
    if (fxLpScenes[p]) { const s = fxLpScenes[p]; s.dead = true; if (s.cleanup) s.cleanup(); fxLpScenes[p] = null; }
    fxLpShown[p] = null;
  }
}
// Test surface (same spirit as window.__layout / window.__bgm). process/snap
// let test-fx drive the diff pipeline with synthetic state pairs so each
// grammar is asserted deterministically, not just observed in live duels.
window.__fx = {
  log: fxLog,
  get error() { return fxError; },
  get ready() { return !!fxPrev; },
  process: fxProcess,
  reset: fxResetDuel,
  settings: fxSettings, // round B (B11): the same object the prompt UI reads
  cutinOn: () => { const h = $('fxcutin'); return !!h && h.className === 'on'; },
  lpShown: (con) => fxLpShown[con],
  // redesign D (p4b): the live opponent-action name tag's text, or
  // null when no tag is up — harnesses assert its wording (and, for
  // sets, the ABSENCE of the hidden card's name) against this
  oppTagText: () => { const el = document.querySelector('#fxlayer .fx-oppnametag'); return el ? el.textContent : null; },
  // redesign B (p2b): the landed-link flags behind the chain bar's
  // gold absorption — read them, or stand a link as landed, so
  // harnesses verify the render() output against the flag itself
  chainLanded: () => [...fxChainLanded.keys()].sort((a, b) => a - b),
  markChainLanded: (n, code) => fxChainMarkLanded(n, code),
  finisherGateMs: () => fxFinisherGateMs(), // redesign G: the result gate, readable for verification
  phaseSeated: () => { const pi = $('phaseinfo'); return !!pi && pi.classList.contains('fx-seated'); }, // redesign E: the settled phase state
  clearChainLanded: () => fxChainLanded.clear(),
  // V3 stage 1 foundation surface: the shared clock, the scene
  // registry, the particle budget and the hit-stop — so harnesses
  // verify the foundation's numbers, not just its wiring.
  now: () => fxTimeMs,
  scenes: () => fxScenes.map(s => ({ kind: s.kind, t0: Math.round(s.t0), dur: s.dur })),
  particles: () => fxParticlesAliveAt(fxTimeMs),
  hitStop: (ms) => fxHitStop(ms),
  stress: () => fxStressScene(),
  spawnBurst: (cv, b) => fxSpawnBurst(cv, b),
};

// ---------------------------------------------------------------- rendering
function tileHTML(card, con, actKey, loc) {
  if (!card) return '';
  const faceUp = (card.pos & E.POS_FACEUP) !== 0;
  // defense rotation is a MONSTER-zone concept only: in the core's
  // position encoding a spell/trap is 0x5 face-up / 0xa face-down,
  // which ALWAYS intersects POS_DEFENSE (0xC) — an unguarded bit test
  // rotated every S/T tile 90 degrees (user report 2026-11-03)
  const isDef = loc === E.LOC.MZONE && (card.pos & E.POS_DEFENSE) !== 0;
  const showFace = faceUp || con === HP;
  // the owner's own face-down cards (user design 2026-11-03): no plain
  // back and no 「裏」 badge — the back pattern is veiled over the real
  // face, which ghosts through with a slow opacity breath (.setown).
  // Opponent face-down cards keep the plain back (showFace false).
  const ownSet = con === HP && !faceUp && card.code != null;
  const nm = showFace && card.code != null ? cardName(card.code) : '';
  const ctrTotal = card.counters ? (Array.isArray(card.counters) ? card.counters.reduce((a, c) => a + (c.count || 0), 0) : card.counters) : 0;
  // board-tile kind frame (user decision 2026-11-04, variant 1): on
  // the board the name band is covered by the art, so a face-up tile
  // carries the kind class on .tile itself and the stylesheet draws a
  // 2px frame in the card-kind frame color. Gated on faceUp
  // specifically — an opponent's face-down card AND the owner's own
  // set card get no kind class at all (information asymmetry). The
  // class sits on .tile, which never rotates, so a defense tile's
  // 90-degree inner rotation cannot disturb the upright frame.
  const kindTile = faceUp && card.code != null ? kindCls(card.code) : '';
  return '<div class="tile' + kindTile + (isDef ? ' def' : '') + (showFace ? '' : ' back') + (ownSet ? ' setown' : '') +
    (card.materials >= 2 ? ' mats2' : card.materials === 1 ? ' mats1' : '') +
    (actKey && actionMap.has(actKey) ? ' actionable' : '') + '"' +
    (actKey ? ' data-act="' + actKey + '"' : '') + '>' +
    ((card.materials || isXyzCode(card.code)) ? '<div class="mats">×' + (card.materials || 0) + '</div>' : '') +
    (ctrTotal ? '<div class="ctrs">◉' + ctrTotal + '</div>' : '') +
    // the artwork lives INSIDE .inner (round B): in defense position
    // the whole inner — art + name band — rotates 90 degrees, while
    // the corner badges (.mats/.ctrs) and the stat strip stay upright.
    // The .art layer is the ONLY drawing of the card face: the tile's
    // own background must stay plain, or an unrotated copy of the face
    // (or of the back pattern) shows behind the rotated inner and the
    // tile reads as two overlapping cards (user report 2026-11-03).
    '<div class="inner"><div class="art"' + (showFace && card.code != null ? artInline(card.code, false, deckKeyOfSeat(con)) : '') + '></div>' +
    (ownSet ? '<div class="veil"></div>' : '') +
    (nm ? '<div class="nm' + kindCls(card.code) + '">' + nm + '</div>' : '') +
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
  // round B (B9): in defense position the strip stays upright outside
  // the rotated card, and the DEF line is emphasised so the form
  // reads off the numbers as well as the rotation
  const isDef = (card.pos & E.POS_DEFENSE) !== 0;
  const big5 = Math.abs(atk) >= 10000 || Math.abs(def) >= 10000 ? ' big5' : ''; // B-15: 5-digit values shrink to 9px instead of overflowing
  return '<div class="slotstats' + (isDef ? ' defmode' : '') + big5 + '"><span>ATK <b>' + atk + '</b></span><span' + (isDef ? ' class="defline"' : '') + '>DEF <b>' + def + '</b></span></div>';
}
function zoneRow(el, cards, con, loc) {
  el.innerHTML = cards.map((card, seq) => {
    const key = con + ':' + loc + ':' + seq;
    const hl = placeCtx && placeCtx.avail.has(key) ? ' hl' : '';
    const pk = placeCtx && placeCtx.chosen.has(key) ? ' picked' : '';
    const st = card ? slotStatsHTML(card, con) : '';
    const fz = loc === E.LOC.SZONE && seq === 5;
    return '<div class="slot' + (st ? ' hs' : '') + hl + pk + (fz ? ' fzone' : '') + '" data-zone="' + key + '">' +
      '<span class="znum">' + (fz ? '' : (seq + 1)) + '</span>' +
      (card ? tileHTML(card, con, key, loc) + st : '') +
      '</div>';
  }).join('');
}
function pileHTML(p, con) {
  const P = duelState.players[con];
  const actGrave = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.GRAVE + ':'));
  const actExtra = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.EXTRA + ':'));
  const actRem = [...actionMap.keys()].some(k => k.startsWith(con + ':' + E.LOC.REMOVED + ':'));
  return '<div class="pile" data-pile="deck:' + con + '">デッキ <b>' + P.deckCount + '</b></div>' +
    '<div class="pile' + (actExtra ? ' actionable' : '') + '" data-pile="extra:' + con + '">EX <b>' + P.extra.length + '</b>' + (actExtra ? '<span class="pact">発動可</span>' : '') + '</div>' +
    '<div class="pile' + (actGrave ? ' actionable' : '') + '" data-pile="grave:' + con + '">墓地 <b>' + P.grave.length + '</b>' + (actGrave ? '<span class="pact">発動可</span>' : '') + '</div>' +
    '<div class="pile' + (actRem ? ' actionable' : '') + '" data-pile="removed:' + con + '">除外 <b>' + P.removed.length + '</b>' + (actRem ? '<span class="pact">発動可</span>' : '') + '</div>' +
    '<div class="pile" data-pile="hand:' + con + '">手札 <b>' + P.hand.length + '</b></div>';
}
let duelState = null;
// B-10: the engine mirror caps its log at 60 lines; the client
// keeps its own turn-tagged copy so the history sheet can show
// what happened, with the turn it happened on.
let logHist = [], logPrev = [];
function captureLog(state) {
  const cur = state.log;
  let fresh = [];
  if (logPrev.length && cur.length >= logPrev.length && logPrev.every((v, i) => cur[i] === v)) {
    fresh = cur.slice(logPrev.length);
  } else if (logPrev.length) {
    let k = Math.min(logPrev.length, cur.length);
    while (k > 0 && logPrev.slice(logPrev.length - k).join('\n') !== cur.slice(0, k).join('\n')) k--;
    fresh = cur.slice(k);
  } else fresh = cur.slice();
  for (const t of fresh) logHist.push({ turn: state.turnCount, text: t });
  if (logHist.length > 80) logHist = logHist.slice(-80);
  logPrev = cur.slice();
}
// Detailed history (log-detail round): the engine mirror keeps a
// structured detailed stream (state.dlog) next to the headline
// log — activations with their chain links, resolution headers,
// and outcome lines (destroyed / banished / milled / LP deltas /
// stat changes), all composed from message data. The client
// captures it turn-stamped like captureLog and renders it grouped
// by turn and by chain episode, oldest first, so a duel can be
// re-read as a story. The one thing the mirror cannot do is name
// WHICH printed effect a chain link is — that needs fxmap, which
// lives here; chain entries therefore arrive structured and get
// their effect suffix at capture time from the same audited
// resolver the prompt sheets use.
let dlogPrev = [], histEntries = [];
function dlogFxSuffix(code, desc, loc) {
  const fx = resolveEffect(code, desc) || scopedEffect(code, desc, loc, 'chain');
  if (fx && fx.n) return ' の効果' + CIRCLED_NUM[fx.n - 1];
  const d = cardData(code);
  if (d && (d.type & 0x6)) return ' の発動'; // Spell/Trap: the card activation itself
  return ' の効果';
}
function dlogText(e) {
  const who = e.con === HP ? '自分' : '相手';
  if (e.k === 'act') return 'リンク' + e.link + '：' + who + ' の ' + cardName(e.code) + dlogFxSuffix(e.code, e.desc, e.loc) + (e.tgt ? '（対象：' + e.tgt + '）' : '');
  if (e.k === 'solve') return '▼ 解決：リンク' + e.link + ' ' + cardName(e.code) + dlogFxSuffix(e.code, e.desc, e.loc);
  if (e.k === 'neg') return who + ' の ' + cardName(e.code) + dlogFxSuffix(e.code, e.desc, e.loc) + ' の発動が無効になった（リンク' + e.link + '）';
  if (e.k === 'dis') return who + ' の ' + cardName(e.code) + dlogFxSuffix(e.code, e.desc, e.loc) + ' の効果が無効になった（リンク' + e.link + '）';
  return e.s || '';
}
function captureDLog(state) {
  const cur = state.dlog || [];
  // Entries are unique objects and the stream is append-only (the
  // mirror trims from the head past 600): the last captured entry
  // is the anchor — everything after it is fresh. A batch can
  // never outrun the cap between two renders, so the anchor is
  // always still present.
  let fresh;
  if (!dlogPrev.length) fresh = cur.slice();
  else {
    const idx = cur.lastIndexOf(dlogPrev[dlogPrev.length - 1]);
    fresh = idx >= 0 ? cur.slice(idx + 1) : cur.slice();
  }
  // Setup entries are stamped turn 0 by the engine (the opening
  // draws); the sheet groups them under turn 1 like the headline
  // log's T-numbering does (frame check: a raw 0/1 split printed
  // the ターン1 heading twice).
  for (const e of fresh) histEntries.push({ turn: Math.max(1, e.turn), tp: e.tp, ph: e.ph, k: e.k, cid: e.cid, sol: e.sol, text: dlogText(e) });
  if (histEntries.length > 500) histEntries = histEntries.slice(-500);
  dlogPrev = cur.slice();
}
function openLogHistory() {
  // B-10 fix (2026-11-03, user report: 履歴ボタンが押しても何も
  // 起きない): do NOT gate on currentPrompt. SELECT_IDLECMD /
  // SELECT_BATTLECMD stay open for the player's whole turn, so the
  // old blanket guard silently swallowed the tap at every moment
  // it would actually be used. A view sheet is read-only, overlays
  // the board and never answers the pending prompt — the pile
  // sheets and the menu sheet already open over a live prompt the
  // same way, and an arriving sheet prompt reclaims the sheet via
  // sheetOpen. What still blocks: a sheet or the dock already
  // owning the screen (those prompts live there).
  if (!logHist.length && !histEntries.length) return;
  if ($('sheetwrap').classList.contains('on') || $('dock').className === 'on') return;
  let rows, sub;
  if (histEntries.length) {
    // Detailed rendering: chronological (oldest first — the sheet
    // opens scrolled to the newest entry), grouped by turn, with
    // chain episodes boxed and each resolution header followed by
    // its outcome lines, so activation <-> resolution correspondence
    // can be traced by eye.
    const entries = histEntries.slice(-240);
    const parts = [];
    let lastTurn = null, lastPh = null, chainOpen = false, boxCid = 0;
    const closeChain = () => { if (chainOpen) { parts.push('</div>'); chainOpen = false; boxCid = 0; } };
    for (const e of entries) {
      if (e.turn !== lastTurn) {
        closeChain();
        parts.push('<div class="logturn">ターン' + Math.max(1, e.turn) + '（' + (e.tp === HP ? '自分' : '相手') + 'のターン）</div>');
        lastTurn = e.turn; lastPh = null;
      }
      // One box per chain EPISODE: back-to-back episodes in the
      // same phase (trigger effects firing in sequence) merge
      // into a single box if the box only follows "has cid" —
      // the frame check showed three episodes in one frame.
      if (e.cid) { if (!chainOpen || boxCid !== e.cid) { closeChain(); parts.push('<div class="logchain">'); chainOpen = true; boxCid = e.cid; } }
      else closeChain();
      if (e.ph && e.ph !== lastPh) { parts.push('<div class="logphase">' + phaseJa(e.ph) + '</div>'); lastPh = e.ph; }
      const cls = 'loghistrow' + (e.k === 'solve' ? ' solve' : '') + (e.k === 'neg' || e.k === 'dis' ? ' neg' : '') + (e.sol ? ' res' : '');
      parts.push('<div class="' + cls + '">' + e.text + '</div>');
    }
    closeChain();
    rows = parts.join('');
    sub = '全 ' + histEntries.length + ' 件（古い順・効果と処理の詳細）';
  } else {
    rows = logHist.slice(-30).reverse().map(e =>
      '<div class="loghistrow"><span class="lt">T' + Math.max(1, e.turn) + '</span>' + e.text + '</div>').join('');
    sub = '直近 ' + Math.min(30, logHist.length) + ' 件（新しい順）';
  }
  sheetOpenView('<div class="ttl">対戦の履歴</div><div class="sub">' + sub + '</div>' + rows +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
  // Open at the newest entry (the bottom of the chronological list).
  const sh = $('sheet');
  requestAnimationFrame(() => { try { sh.scrollTop = sh.scrollHeight; } catch (e) {} });
}
function render(state) {
  duelState = state;
  const me = state.players[HP], op = state.players[1 - HP];
  // round B (B7): while an LP count animation owns a counter, render
  // must not stomp it — the count lands exactly on the state value
  if (!fxLpBusy(1 - HP)) $('oppLp').textContent = op.lp;
  if (!fxLpBusy(HP)) $('myLp').textContent = me.lp;
  $('turninfo').textContent = 'ターン' + Math.max(1, state.turnCount) + '／' + (state.turnPlayer === HP ? '自分' : '相手');
  // redesign D (p4a): opponent-turn air — render() only toggles
  // the class; the lapis rim preset inside #oppField breathes by
  // CSS animation (opacity 0.55<->1.0, 2.6 s) and the dim preset
  // inside #myField fades in. No layout is touched either way.
  { const appEl = $('app'); if (appEl) appEl.classList.toggle('opp-turn', state.turnPlayer !== HP && state.winner == null); }
  // B-08: the phase readout shows the phase name only — whose
  // turn it is already lives in the topbar, and the long form
  // wrapped into a 5-line collapse whenever a button appeared.
  $('phaseinfo').textContent = state.phaseName ? phaseJa(state.phaseName) : '—';
  zoneRow($('oppSzone'), [0,1,2,3,4,5].map(i => op.szone[i]), 1 - HP, E.LOC.SZONE);
  // Genesis format: no Extra Monster Zones — render main monster zones 0-4
  // only. The state mirror keeps 7 slots (the core's RELOAD_FIELD always
  // serializes 7), but seq 5/6 can never be offered or occupied now.
  zoneRow($('oppMzone'), op.mzone.slice(0, 5), 1 - HP, E.LOC.MZONE);
  zoneRow($('myMzone'), me.mzone.slice(0, 5), HP, E.LOC.MZONE);
  zoneRow($('mySzone'), [0,1,2,3,4,5].map(i => me.szone[i]), HP, E.LOC.SZONE);
  $('oppPilebar').innerHTML = pileHTML(null, 1 - HP);
  $('myPilebar').innerHTML = pileHTML(null, HP);
  captureLog(state);
  captureDLog(state);
  // hand
  $('handcount').textContent = me.hand.length;
  const handCounts = {};
  me.hand.forEach(c => { if (c.code != null) handCounts[c.code] = (handCounts[c.code] || 0) + 1; });
  $('hand').innerHTML = me.hand.map((c, i) => {
    const key = HP + ':' + E.LOC.HAND + ':' + i;
    const act = (actionMap.has(key) ? ' actionable' : '') + (lastPlaceCard && lastPlaceCard.key === key ? ' placing' : '') + (cmdPromptOpen && !actionMap.has(key) ? ' dim' : '');
    const st = c.code != null && isMonster(c.code)
      ? '<div class="hstats' + (Math.abs(cardData(c.code).atk) >= 10000 || Math.abs(cardData(c.code).def) >= 10000 ? ' big5' : '') + '"><span>ATK <b>' + cardData(c.code).atk + '</b></span><span>DEF <b>' + cardData(c.code).def + '</b></span></div>'
      : '<div class="hstats"></div>';
    return '<div class="hcard' + act + '" data-act="' + key + '"' + (c.code != null ? ' data-code="' + c.code + '"' : '') + '>' +
      (c.code != null && handCounts[c.code] > 1 ? '<div class="cnt">×' + handCounts[c.code] + '</div>' : '') +
      '<div class="himg"' + (c.code != null ? artInline(c.code, false, deckKeyOfSeat(HP)) : '') + '><div class="nm' + (c.code != null ? kindCls(c.code) : '') + '">' + (c.code != null ? cardName(c.code) : '？') + '</div></div>' + st + '</div>';
  }).join('');
  // opponent hand = backs in topbar only (count); chain bar
  const cb = $('chainbar');
  // redesign B (p2b): prune the FX layer's landed flags against
  // THIS chain first (empty chain clears them; a different card at
  // a landed number drops that flag) — the bar below then paints
  // the absorbed gold straight from the surviving flags
  fxChainPruneLanded(state.chain);
  if (state.chain.length) {
    cb.className = 'on';
    // round B (B8): with 2+ links the bundle carries a CHAIN label
    // from the moment it stacks; the newest link rides forward while
    // stacking; the solving link glows; resolved links dim
    cb.innerHTML = (state.chain.length >= 2 ? '<span class="chainlbl' + (fxChainLanded.size ? ' landed' : '') + '">CHAIN</span>' : '') + state.chain.map((l, i) => {
      const n = i + 1;
      const cls = 'link' + (state.solvingLink === n ? ' solving' : '') + (l.negated || l.disabled ? ' negated' : '') +
        (l.solved ? ' done' : '') + (fxChainLanded.has(n) ? ' landed' : '') + (!state.solvingLink && i === state.chain.length - 1 ? ' newest' : '');
      return '<span class="' + cls + '"><span class="no">' + n + '</span> ' + cardName(l.code) + (state.solvingLink === n ? '<span class="solvingtag">解決中</span>' : '') + (l.solved ? ' ✓' : '') + '</span>';
    }).join('');
  } else {
    // B-17: the reserved band is not wasted while no chain is
    // up — it carries the previous event (the logline holds the
    // latest) and the history entry (B-10). The button is 19px
    // tall because the band's height is frozen by the layout.
    cb.className = 'idle';
    const prevLog = state.log.length >= 2 ? state.log[state.log.length - 2] : '';
    cb.innerHTML = '<span class="prevlog">' + prevLog + '</span><button id="loghistbtn">履歴</button>';
  }
  $('logline').textContent = state.log.length ? state.log[state.log.length - 1] : '';
  // phase button
  const pb = $('phasebtn');
  if (phaseAction) { pb.disabled = false; pb.textContent = phaseAction.label; }
  else {
    pb.disabled = true;
    // triage-#2 fix: between prompts the game is PROCESSING
    // (opponent chain check, batch pacing) — say so, never leave
    // a dead "—" up while taps would be meaningless.
    // C-30: on the opponent's turn the disabled button says so —
    // waiting-for-the-opponent is not waiting-for-the-engine.
    pb.textContent = currentPrompt ? '選択中…' : (state.winner != null ? '—' : (state.turnPlayer !== HP ? '相手のターン' : '処理中…'));
  }
  $('midbar').classList.toggle('busy', !currentPrompt && !!duelState && state.winner == null);
  // B-08: the button never appears/disappears (that reflowed the
  // whole phase bar); it is present and disabled when there is
  // nothing behind it, so every width in the bar is constant.
  $('menubtn').disabled = !menuActions.length;
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
function phaseJaContext(n) {
  // W-27 (brushup round 3): context lines name the phase at the
  // granularity a confirmation actually needs. The battle
  // sub-steps (BATTLE_START / BATTLE_STEP / BATTLE) collapse to
  // バトルフェイズ — the player cannot act on their boundaries,
  // and バトル開始 sat one row away from the phase button's
  // destination labels, inviting a misread. The one sub-phase
  // distinction that changes what a confirmation means — a
  // damage-step timing — is named explicitly instead. The
  // phase READOUT in the mid bar keeps the fine phaseJa names:
  // it is a display, not a context line, and the damage-step
  // readout is real information there (B-08 compression stands).
  if (n === 'BATTLE_START' || n === 'BATTLE_STEP' || n === 'BATTLE') return 'バトルフェイズ';
  if (n === 'DAMAGE' || n === 'DAMAGE_CAL') return 'ダメージ計算の確認';
  return phaseJa(n);
}
function timingText(state) {
  const ph = state.phaseName ? '・' + phaseJaContext(state.phaseName) : '';
  return (state.turnPlayer === HP ? '自分のターン' : '相手のターン') + ph;
}
function confirmTag(state) { // call ONCE per shown prompt, never per redraw
  if (state.turnCount !== confirmTurn) { confirmTurn = state.turnCount; confirmSeq = 0; }
  confirmSeq++;
  // From the FIRST confirmation, not the third: "is this the same
  // question again?" is the player's cue to use the suppression
  // exits, and it matters most on the early repeats (care audit
  // W-19; supersedes the C-27 from-the-3rd rule).
  return '（このターン' + confirmSeq + '回目の確認）';
}
// C-27: duel-long suppression for effect-activation yes/no,
// keyed per card AND effect descriptor — the exit the chain
// dock already had, which SELECT_EFFECTYN never offered.
let duelNoConfirm = new Set();
const effectYnKey = (p) => p.code + '|' + p.desc;

// ---------------------------------------------------------------- prompt UI
let sheetKind = 'prompt';
let sheetAnimGen = 0, sheetCloseTimer = null, sheetBlockerOn = false;
function sheetAnimCancel(el) { if (el && el.getAnimations) { try { for (const a of el.getAnimations()) a.cancel(); } catch (e) {} } }
function sheetOpenView(html) { sheetOpen(html, 'view'); }
function sheetOpen(html, kind) {
  sheetKind = kind || 'prompt';
  closeInfoPop();
  const wrap = $('sheetwrap'), sheet = $('sheet');
  const wasOpen = wrap.classList.contains('on');
  if (sheetCloseTimer) { clearTimeout(sheetCloseTimer); sheetCloseTimer = null; }
  sheetAnimGen++;
  delete wrap.dataset.closing;
  sheetAnimCancel(sheet); sheetAnimCancel(wrap);
  sheet.innerHTML = html;
  wrap.className = 'on';
  clearPeekBar(); // a fresh sheet resets peek (className above); its mirrors die with the old content
  wrap.dataset.kind = sheetKind;
  const pk = $('peekbtn'); if (pk) pk.textContent = '盤面を見る';
  if (!wasOpen) {
    // V4-6: opening is a motion, not a cut — the sheet slides up on
    // the sheetIn curve (its overshoot IS the 4%), the scrim fades
    // in over 180 ms, and content rows stagger up at 25 ms from
    // +90 ms. Redraws of an already-open sheet never re-animate.
    fxAnim(wrap, [{ backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,0.53)' }], { duration: 180, easing: 'ease-out' });
    fxAnim(sheet, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 280, easing: 'cubic-bezier(.16,1.12,.3,1)' });
    const rows = sheet.children;
    for (let i = 0; i < Math.min(rows.length, 8); i++)
      fxAnim(rows[i], [{ opacity: '0', transform: 'translateY(8px)' }, { opacity: '1', transform: 'translateY(0)' }], { duration: 150, delay: 90 + i * 25, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'both' });
  }
}
function sheetClose() {
  settleConfirmSheet(); // any exit from the confirm sheet ends its wait
  closeInfoPop();
  clearPeekBar();
  const wrap = $('sheetwrap'), sheet = $('sheet');
  if (!wrap.classList.contains('on')) { wrap.removeAttribute('data-kind'); sheet.innerHTML = ''; return; }
  if (wrap.dataset.closing) return; // a close motion is already in flight
  const gen = ++sheetAnimGen;
  sheetAnimCancel(sheet); sheetAnimCancel(wrap);
  // the closing state rides in data-closing, NEVER the class list:
  // className === 'on' is a load-bearing contract (test clickers,
  // the pending-tap guard) and stays true until the motion lands.
  wrap.dataset.closing = '1';
  if (!sheetBlockerOn) { // while closing, the sheet's content is inert:
    sheetBlockerOn = true; // a capture-phase blocker eats stale taps
    sheet.addEventListener('click', (ev) => { if ($('sheetwrap').dataset.closing) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  }
  const fromPeek = wrap.classList.contains('peek');
  fxAnim(wrap, [{ backgroundColor: 'rgba(0,0,0,0.53)' }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 180, easing: 'ease-in' });
  fxAnim(sheet, [{ transform: fromPeek ? 'translateY(calc(100% - 44px))' : 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: 180, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' });
  if (sheetCloseTimer) clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheetCloseTimer = null;
    if (sheetAnimGen !== gen) return; // superseded by a newer open/close
    wrap.className = '';
    wrap.removeAttribute('data-kind');
    delete wrap.dataset.closing;
    sheet.innerHTML = '';
  }, 185);
}
// BU-22 (R-SEL-2): peeking the sheet down to look at the board
// used to take the answer buttons off-screen with it — checking
// the board cost the player their place in the question. While
// peeked, the sheet's answer controls (big buttons, option
// buttons, position tiles — never the view sheet's close) are
// mirrored into #peekbar, a bottom band that stays put; a tap
// on a mirror clicks the original control, so the answer path
// is the sheet's own, handlers and disabled state included.
// Sheet content is static while peeked (the grid is off-screen,
// and any redraw goes through sheetOpen, which resets peek), so
// the mirrors cannot go stale mid-peek.
function clearPeekBar() {
  const bar = $('peekbar'); if (!bar) return;
  bar.innerHTML = ''; bar.classList.remove('onbar');
}
function syncPeekBar() {
  const bar = $('peekbar'); if (!bar) return;
  clearPeekBar();
  const wrap = $('sheetwrap');
  if (!wrap.classList.contains('on') || !wrap.classList.contains('peek')) return;
  const srcs = $('sheet').querySelectorAll('button.bigbtn:not(#sheet-cancel), button.optbtn, .posbtn');
  srcs.forEach(el => {
    const b = document.createElement('button');
    b.className = 'bigbtn' + (el.classList.contains('sub') ? ' sub' : '');
    b.textContent = (el.textContent || '').trim();
    if (el.disabled) b.disabled = true;
    b.addEventListener('click', () => { el.click(); });
    bar.appendChild(b);
  });
  if (bar.children.length) bar.classList.add('onbar');
}
// R-SEL-1: a read-only detail that floats OVER whatever selection
// is in progress — opening or closing it never answers, toggles
// or cancels anything, so a choice can be checked mid-selection
// and the selection is exactly as it was left.
function openInfoPop(code, ref, fx) {
  if (code == null || !DATA || !DATA.cards[code]) return;
  setPreview(code, ref || null);
  const mats = ref ? liveMats(ref.con, ref.loc, ref.seq) : null;
  const meta = cardMetaLine(code, mats);
  const st = statsLine(code);
  // card-view rule (user, 2026-11-04): every surface that shows a
  // card's detail leads with its BIG art. The floating pop was the
  // one surface still missing it; the band resolves its deck
  // context exactly like setPreview does (the instance's seat when
  // a ref names one, unique deck membership for a bare code), and
  // unlisted cards fall back to the shared placeholder through the
  // .popart class background, exactly like .infoart. The secrecy
  // guard is unchanged: a null/hidden code never reaches this
  // function (boardCardAt and friends), so no art or name can leak
  // for an opponent's face-down card.
  const popDeckKey = ref && ref.con != null ? deckKeyOfSeat(ref.con) : deckKeyOfCode(code);
  $('infopop').innerHTML = '<div class="popart"' + artInline(code, true, popDeckKey) + '></div>' +
    '<div class="ttl">' + cardName(code) + '</div>' +
    '<div class="sub">' + [meta, st].filter(Boolean).join('／') + '</div>' +
    (cardText(code) ? (fx ? fxBlockHTML(code, fx) : '<div class="cardtext">' + cardText(code) + '</div>') : '<div class="sub">このカードのテキストは表示できません</div>') +
    // W-28: the detail pop floats over whatever is beneath it;
    // while a prompt is open, closing returns to that selection
    // (選択に戻る); over a pure view it is just 閉じる.
    '<div class="btnrow"><button class="bigbtn sub" id="infopop-close">' + (currentPrompt ? '選択に戻る' : '閉じる') + '</button></div>';
  $('infopop').className = 'on';
  $('infopop-close').addEventListener('click', () => { playClick(); closeInfoPop(); });
}
function closeInfoPop() { const p = $('infopop'); if (p && p.className) { p.className = ''; p.innerHTML = ''; } }
// The one visibility rule for board info (opponent-info round):
// a field card's public info may be shown iff it is face-up, or
// it is the player's own card (own face-down cards ghost through
// by design). An opponent's face-down card NEVER resolves here —
// its code stays hidden behind this single guard, the same rule
// the tile art and the stat strip already obey.
function boardCardAt(key) {
  if (!duelState || !key) return null;
  const [con, loc, seq] = key.split(':').map(Number);
  if (loc !== E.LOC.MZONE && loc !== E.LOC.SZONE) return null;
  const P = duelState.players[con];
  if (!P) return null;
  const card = loc === E.LOC.MZONE ? P.mzone[seq] : P.szone[seq];
  if (!card || card.code == null) return null;
  if ((card.pos & E.POS_FACEUP) === 0 && con !== HP) return null;
  return { code: card.code, ref: { con, loc, seq } };
}
// R-SEL-2 extension (opponent-info round): while a selection
// sheet is peeked down, a tap on a board card is an INFO tap —
// the read-only detail floats over the board, and closing it
// returns to the peeked sheet with the selection untouched.
// The prompt is never answered, toggled or cancelled from here.
function peekInfoTap(key) {
  const hit = boardCardAt(key);
  if (!hit) return false;
  playClick();
  openInfoPop(hit.code, hit.ref);
  return true;
}
function peekBoardTap(x, y) {
  if (!document.elementsFromPoint) return false;
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!el || !el.closest) continue;
    const zoneEl = el.closest('[data-zone]');
    if (zoneEl) return peekInfoTap(zoneEl.dataset.zone);
    if (el.closest('#preview') && previewState) {
      playClick();
      openInfoPop(previewState.code, previewState.con != null && previewState.loc != null ? { con: previewState.con, loc: previewState.loc, seq: previewState.seq } : null);
      return true;
    }
    const handEl = el.closest('#hand .hcard');
    if (handEl && handEl.dataset.code) { setPreview(+handEl.dataset.code, null); return true; }
  }
  return false;
}
function dockClose() { $('dock').className = ''; $('dock').innerHTML = ''; syncAutoPassChipPos(); }
function clearInteraction() {
  sheetClose(); dockClose();
  cmdPromptOpen = false;
  actionMap = new Map(); phaseAction = null; menuActions = [];
  if (placeCtx) lastPlaceCard = null; // a finished placement consumes the marker
  placeCtx = null;
  $('placehint').className = '';
}
function retryWarn(prompt) {
  return prompt.retryCount ? '<div class="warn">その選択はできませんでした。選び直してください。</div>' : '';
}
function finishPrompt(bytes) {
  const cp = currentPrompt;
  closeInfoPop();
  clearInteraction();
  if (duelState) render(duelState);
  if (cp) { currentPrompt = null; cp.resolve(bytes); }
}
function uiAnswer(prompt, state) {
  return new Promise((resolve) => {
    // Response mode 'off' (round B, B11): every non-forced chain
    // prompt is passed without opening the dock. A presentation
    // choice only — passing (i32 -1) is always a legal SELECT_CHAIN
    // answer, and forced prompts are still shown in every mode.
    if (fxSettings.resp === 'off' && prompt.name === 'SELECT_CHAIN' && !prompt.forced) { resolve(E.i32resp(-1)); return; }
    // Zero-option chain prompts (user report 2026-11-04): the core
    // sends MSG_SELECT_CHAIN at every timing window even when the
    // player has nothing chainable (measured: 58% of chain prompts
    // in bot duels carry 0 entries) — passing is then the ONLY legal
    // answer, so asking is pure friction. Resolve immediately, before
    // any prompt cycle (no currentPrompt, no stats refresh, no dock).
    if (prompt.name === 'SELECT_CHAIN' && chainPassDecision(prompt, state) === 'pass') { resolve(E.i32resp(-1)); return; }
    if (prompt.name === 'SELECT_EFFECTYN' && duelNoConfirm.has(effectYnKey(prompt))) { flashAutoPass(cardName(prompt.code)); resolve(E.i32resp(0)); return; }
    // An arriving prompt takes the sheet back from the FX settings
    // sheet (round B) — the settings sheet must never sit over a dock
    if ($('sheet') && $('sheet').querySelector('#fxseg-cutin')) sheetClose();
    currentPrompt = { prompt, resolve };
    // The 攻撃 action's target choice is the SELECT_CARD that
    // immediately follows it; bind the attacker to that one prompt
    // only, so its sheet can name whose attack it is (P1-2).
    promptAttacker = prompt.name === 'SELECT_CARD' ? pendingAttacker : null;
    pendingAttacker = null;
    // Refresh live ATK/DEF behind the prompt UI, then dispatch. With the
    // engine in a Worker, refreshFieldStats() returns a Promise for a
    // worker round-trip (only serviceable while this prompt waits); the
    // in-process Duel's version is synchronous and returns undefined, so
    // awaiting it keeps the fallback path behaving exactly as before.
    const refreshed = duel ? Promise.resolve().then(() => duel.refreshFieldStats()) : Promise.resolve();
    refreshed.catch(() => {}).then(() => {
      try {
        dispatchPrompt(prompt, state);
      } catch (err) {
        // never dead-end: fall back to the bot policy answer for this prompt
        finishPrompt(E.botAnswer(prompt, state, DATA, E.makeBotMemory()));
      }
    });
  });
}
function dispatchPrompt(prompt, state) {
  if (prompt.name !== 'SELECT_PLACE' && prompt.name !== 'SELECT_DISFIELD' && prompt.name !== 'SELECT_POSITION') lastPlaceCard = null;
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
  cmdPromptOpen = true;
  actionMap = new Map(); menuActions = [];
  const add = (list, label, type) => list.forEach((e, i) => {
    const key = e.con + ':' + e.loc + ':' + e.seq;
    if (!actionMap.has(key)) actionMap.set(key, []);
    const lab0 = typeof label === 'function' ? label(e) : label;
    // Activatable entries keep their desc: two effects of the same
    // card must not collapse into indistinguishable buttons.
    const fx = lab0 === '効果を発動' ? entryEffect(e, 'idle') : null;
    const lab = fx && fx.n ? (fx.act ? 'カードを発動：' + fxExcerpt(fx) : '効果を発動：' + CIRCLED_NUM[fx.n - 1] + ' ' + fxExcerpt(fx)) : lab0;
    actionMap.get(key).push({ label: lab, bytes: E.cmdResp(type, i), code: e.code, desc: e.desc, activate: lab0 === '効果を発動' });
  });
  // W-20: a position change names its DESTINATION, read from the
  // monster's current position — 「表示形式を変更」 never said
  // which way the card would end up facing.
  const reposLabel = (e) => {
    const P = state && state.players ? state.players[e.con] : null;
    const c = P && e.loc === E.LOC.MZONE ? P.mzone[e.seq] : null;
    const pos = c ? c.pos : null;
    if (pos === E.POS.FU_ATK) return '守備表示に変更する';
    if (pos === E.POS.FU_DEF) return '攻撃表示に変更する';
    if (pos != null && (pos & (E.POS.FD_ATK | E.POS.FD_DEF))) return '表側攻撃表示にする';
    return '表示形式を変更';
  };
  if (prompt.name === 'SELECT_IDLECMD') {
    add(prompt.summon, '通常召喚', 0);
    add(prompt.spsummon, '特殊召喚', 1);
    add(prompt.repos, reposLabel, 2);
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
  // triage-#2: honor a tap buffered during the processing
  // window — its sheet opens at once (leading input), with the
  // same reach a direct tap has: the action sheet when the key
  // is actionable, the info view for my face-up field monster
  // otherwise. Stale buffers (>4s) die quietly.
  if (pendingTap) {
    const pt = pendingTap; pendingTap = null;
    if (Date.now() - pt.at < 4000) {
      if (actionMap.has(pt.key)) openActionSheet(pt.key);
      else {
        const [con2, loc2, seq2] = pt.key.split(':').map(Number);
        if (con2 === HP && loc2 === E.LOC.MZONE && duelState) {
          const c = duelState.players[con2].mzone[seq2];
          if (c && c.code != null && (c.pos & E.POS_FACEUP) !== 0) openActionSheet(pt.key);
        }
      }
    }
  }
}
function openActionSheet(key) {
  const acts = actionMap.get(key) || [];
  const [con, loc, seq] = key.split(':').map(Number);
  // with no offered actions the sheet is an info view (opened for
  // own face-up monsters) — the card comes from the zone itself
  let zoneCode = acts.length ? acts[0].code : null;
  if (zoneCode == null && duelState) {
    const P = duelState.players[con];
    const c = loc === E.LOC.MZONE ? P.mzone[seq] : loc === E.LOC.SZONE ? P.szone[seq] : null;
    zoneCode = c ? c.code : null;
  }
  if (zoneCode == null && !acts.length) return;
  // attack-block round: in a live battle command, an own monster
  // the core offers no 攻撃 for gets the same courtesy as a
  // missing activation — a greyed row WITH the reason when one
  // is mechanically certain (attackBlockReason), and the same
  // reason on the persistent preview. A monster WITH an attack
  // action is untouched, as is every non-battle sheet.
  let atkReason = null;
  if (zoneCode != null && con === HP && loc === E.LOC.MZONE &&
      currentPrompt && currentPrompt.prompt.name === 'SELECT_BATTLECMD' &&
      !acts.some(a => a.label === '攻撃')) {
    atkReason = attackBlockReason(zoneCode, con, loc, seq);
  }
  if (zoneCode != null) setPreview(zoneCode, { con, loc, seq }, atkReason);
  const title = zoneCode != null ? cardName(zoneCode) : 'アクション';
  const txt = zoneCode != null ? cardText(zoneCode) : '';
  const meta = zoneCode != null ? cardMetaLine(zoneCode, liveMats(con, loc, seq)) : '';
  // Minerva item (2), generalized pool-wide (pool-coverage
  // round): an effect the engine does NOT offer gets a greyed
  // row WITH the reason, instead of silence — "cannot use" is
  // shown by greying (the user's UI principle) and the reason
  // is readable right here in the sheet. Only mechanically
  // derivable reasons are stated; anything else stays with the
  // generic form rather than a guessed reason. Reasons, in
  // order of certainty: (a) a tracked activation lock from
  // another card's lingering restriction (3rd triage — blocks
  // regardless of materials or deck, any monster); (b) the
  // 死者蘇生 rider on a monster it brought back this turn;
  // (c) every field-activatable effect already spent under its
  // once-per-turn clause (tracked from the chain links) — and,
  // brushup round 2, a spent card-name activation limit
  // (nameLimitReason), which also serves the HAND sheet below;
  // (d) for Xyz monsters, the detach cost vs live materials /
  // a mill count vs the live deck. When none is derivable but
  // the card provably HAS a field-activatable effect, the row
  // still appears with the generic form — silence was the
  // original defect. (Offered-activation detection reads the
  // act's own flag: identified effects carry numbered labels,
  // so matching the bare label text missed them.)
  let unusable = '';
  if (zoneCode != null && con === HP && loc === E.LOC.HAND && !acts.some(a => a.activate)) {
    // brushup round 2 (the hand surface): a card-name activation
    // limit that is already spent is the one reason that fully
    // explains a missing activation from the hand — the same
    // greyed row, on the sheet the hand card itself opens.
    const hReason = nameLimitReason(zoneCode);
    if (hReason) unusable = '<div class="optbtn disabled">効果を発動<span class="reason">' + hReason + '</span></div>';
  }
  if (zoneCode != null && con === HP && (loc === E.LOC.MZONE || loc === E.LOC.SZONE) && !acts.some(a => a.activate)) {
    let faceup = true;
    if (duelState) {
      const P = duelState.players[con];
      const zc = loc === E.LOC.MZONE ? P.mzone[seq] : P.szone[seq];
      if (zc && zc.pos != null) faceup = (zc.pos & E.POS_FACEUP) !== 0;
    }
    let reason = null;
    if (faceup) {
      if (loc === E.LOC.MZONE) {
        reason = monsterLockReason(zoneCode) || monsterRevivedReason(zoneCode, loc, seq);
      }
      if (!reason) reason = nameLimitReason(zoneCode);
      if (!reason) reason = optUsedReason(zoneCode);
      if (!reason && loc === E.LOC.MZONE && isXyzCode(zoneCode)) {
        const norm = txt.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
        const detach = norm.match(/X素材を(\d+)つ取り除/);
        const mill = norm.match(/デッキの上からカードを(\d+)枚墓地へ送る/);
        if (detach || mill) {
          const mats = liveMats(con, loc, seq) || 0;
          reason = '今は発動できません';
          if (detach && mats < +detach[1]) reason = '素材が足りません（現在×' + mats + '）';
          else if (mill && duelState && duelState.players[con].deckCount < +mill[1]) reason = 'デッキが ' + mill[1] + ' 枚未満です';
        }
      }
      if (!reason && fieldCandidates(zoneCode).length) reason = '今は発動できません';
    }
    if (reason) unusable = '<div class="optbtn disabled">効果を発動<span class="reason">' + reason + '</span></div>';
  }
  // When this card has several offered effects, pin the texts: the
  // offered effects are highlighted one by one (full text stays
  // readable below, R-SEL-1 style).
  const offeredFx = [...new Set(acts.map(a => { const f = entryEffect(a, 'idle'); return f && f.n ? f.n : 0; }).filter(Boolean))].sort();
  const fxBlocks = zoneCode != null && offeredFx.length > 1
    ? offeredFx.map(n => { const seg = effectSegments(zoneCode).find(s => s.n === n); return seg ? fxBlockHTML(zoneCode, seg) : ''; }).join('')
    : '';
  const atkRow = atkReason ? '<div class="optbtn disabled">攻撃<span class="reason">' + atkReason + '</span></div>' : '';
  sheetOpenView('<div class="ttl">' + title + '</div><div class="sub">' + locLabel({ con, loc, seq }) + (meta ? '／' + meta : '') + '</div>' +
    acts.map((a, i) => '<button class="optbtn" data-action-idx="' + i + '">' + a.label + '</button>').join('') +
    atkRow +
    unusable +
    (fxBlocks || (txt ? '<div class="cardtext">' + txt + '</div>' : '')) +
    // W-28 (brushup round 3): this sheet IS the pending idle
    // choice — closing it returns to that choice, so it takes
    // the selection-context label, not the viewing one.
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">選択に戻る</button></div>');
  $('sheet').querySelectorAll('[data-action-idx]').forEach(b => b.addEventListener('click', () => {
    const a = acts[+b.dataset.actionIdx];
    if (a.label === '通常召喚' || a.label === '特殊召喚' || a.label === 'モンスターをセット' || a.label === '魔法・罠をセット') lastPlaceCard = { key, code: a.code };
    if (a.label === '攻撃') pendingAttacker = { code: a.code };
    playClick(); finishPrompt(a.bytes);
  }));
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
    body = list.length ? list.slice().reverse().map(c => {
      // card-view round: a known card leads with its thumbnail
      // (small art, the instance's deck context); a hidden card
      // (code null — face-down banished) keeps the bare '？' row:
      // no thumbnail element, no name, nothing to resolve.
      let row = '<div class="sortrow" data-info="' + (c != null ? c : '') + '">' + (c != null ? '<span class="pthumb"' + artInline(c, false, deckKeyOfSeat(con)) + '></span>' + cardName(c) : '？') + '<span class="chev">›</span></div>';
      // brushup round 2 (the grave surface): a grave effect barred
      // on the turn its card was sent there says so under its row.
      if (kind === 'grave' && con === HP && c != null) {
        const gr = graveSentReason(c);
        if (gr) row += '<div class="rowreason">' + gr + '</div>';
      }
      return row;
    }).join('') : '<div class="sub">' + (kind === 'grave' ? '墓地は空です（0枚）' : '除外されているカードはありません（0枚）') + '</div>';
  } else if (kind === 'extra') {
    // brushup round 2 (the EX surface): while an EX-summon type
    // lock is live, an own EX monster of a blocked type that the
    // engine offers no summon for carries the named reason.
    const exLock = con === HP ? exSummonLock() : null;
    const actSeqs = new Set(pileActs.map(pa => pa.seq));
    body = con === HP ? (P.extra.length ? P.extra.map((c, i) => {
      let row = '<div class="sortrow" data-info="' + (c.code != null ? c.code : '') + '">' + (c.code != null ? '<span class="pthumb"' + artInline(c.code, false, deckKeyOfSeat(con)) + '></span>' + cardName(c.code) : '？') + '<span class="chev">›</span></div>';
      if (exLock && !actSeqs.has(i)) {
        const d = cardData(c.code);
        if (d && !(d.type & exLock.typeBit)) row += '<div class="rowreason">' + exLockReason(exLock) + '</div>';
      }
      return row;
    }).join('') : '<div class="sub">EXデッキは空です（0枚）</div>') : '<div class="sub">相手のEXデッキは見られません（残り ' + P.extra.length + ' 枚）</div>';
  } else if (kind === 'deck') {
    body = '<div class="sub">残り ' + P.deckCount + ' 枚' + (state.deckTop[con] ? '<br>一番上（公開中）：' + cardName(state.deckTop[con]) : '') + '</div>';
  } else if (kind === 'hand') {
    body = '<div class="sub">' + P.hand.length + ' 枚</div>';
  }
  if (pileActs.length) {
    body += '<div class="ttl" style="margin-top:8px">実行できるアクション</div>' + pileActs.map((pa, i) =>
      pa.acts.map((a, j) => '<button class="optbtn" data-pile-act="' + i + ':' + j + '">' + cardName(a.code) + '：' + a.label + '</button>').join('')).join('');
  }
  sheetOpenView('<div class="ttl">' + ({ grave: '墓地', removed: '除外', extra: 'EXデッキ', deck: 'デッキ', hand: '手札' }[kind]) + '（' + (con === HP ? '自分' : '相手') + '）</div>' + body +
    // W-28: with executable actions this sheet serves the
    // pending choice (選択に戻る); without them it is a viewer
    // (閉じる). The label follows what closing actually does.
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">' + (pileActs.length ? '選択に戻る' : '閉じる') + '</button></div>');
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
  sheetOpenView(
    // card-view round: the sheet leads with the BIG art (the
    // cut-in file, deck context resolved like the resident preview
    // resolves a bare code); unlisted cards fall back to the shared
    // placeholder through the .infoart class background, exactly
    // like the FX big card. Name, meta, stats and text follow
    // below the art, unchanged.
    '<div class="infoart"' + artInline(code, true, deckKeyOfCode(code)) + '></div>' +
    '<div class="ttl">' + cardName(code) + '</div>' +
    '<div class="sub">' + [meta, st].filter(Boolean).join('／') + '</div>' +
    (txt ? '<div class="cardtext">' + txt + '</div>' : '<div class="sub">このカードのテキストは表示できません</div>') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
// ---- chain dock (EDOPro-style; numbered links live in the mid bar) ----
function chainKey(e) { return e.code + '|' + e.con + '|' + e.loc + '|' + e.seq + '|' + e.desc; }
// Duel-long dismissal class (BU-04, user ruling 2026-11-05): the
// card + its effect, nothing else. Location, copy (seq) and the
// scene/timing the question arrived in are NOT part of the class —
// the same card's same effect is never asked again this duel,
// wherever it currently sits. Effect identity comes from the same
// resolution that names the class for the player (entryEffect,
// chain scope — dismissalName), so the key and the shown name can
// never describe different classes. An entry whose effect cannot
// be pinned (a bare card activation, fx.act, or nothing resolvable)
// classes by the card alone.
function duelKey(e) {
  const fx = entryEffect(e, 'chain');
  if (fx && fx.n && !fx.act) return e.code + '|fx' + fx.n;
  return e.code + '|card';
}
// Does this SELECT_CHAIN prompt have any option worth asking about?
// Returns:
//   'pass'  — no live candidate: answer pass (-1) at once, show
//             nothing. Covers BOTH the core's zero-entry prompts
//             and prompts whose every candidate is dismissed for
//             this chain (mixed with duel dismissals).
//   'flash' — every candidate is duel-dismissed: uiChain owns this
//             case (visible 自動パス flash + short delay), so the
//             player can see their setting fire.
//   'show'  — at least one live candidate, or the prompt is forced
//             (mandatory responses are always shown; passing is not
//             even legal there).
// Dismissals never apply in response mode 'on' （毎回）, exactly as
// in uiChain. The per-chain dismissal reset mirrors uiChain's own
// (a finished chain's dismissals must not leak into an open-state
// activation window), and stays idempotent when uiChain repeats it.
function chainPassDecision(prompt, state) {
  if (prompt.forced) return 'show';
  const entries = prompt.entries || [];
  if (!entries.length) return 'pass';
  if (fxSettings.resp === 'on') return 'show';
  if (state && !state.chain.length) dismissedChains = new Set();
  let allDuel = true, allAny = true;
  for (const e of entries) {
    const dk = duelKey(e); // duel dismissals key on the card+effect class (BU-04)
    if (!dismissedDuel.has(dk)) allDuel = false;
    if (!dismissedDuel.has(dk) && !dismissedChains.has(chainKey(e))) allAny = false;
  }
  if (allDuel) return 'flash';
  return allAny ? 'pass' : 'show';
}
// BU-15: the auto-pass chip's home (CSS bottom: hand height +
// 33px) sits INSIDE the chain dock's span whenever the dock is
// open, straddling its dismissal buttons and splitting their
// labels. A state display must never cover the controls it
// describes: while the dock is up, the chip rides directly
// above the dock's top edge (the dock's own duelsection still
// lists the same state inside); when the dock closes, the
// inline bottom is dropped and the CSS home applies again.
function syncAutoPassChipPos() {
  const el = $('autopass'); if (!el) return;
  const dock = $('dock');
  if (dock && dock.className === 'on' && dock.offsetHeight) el.style.bottom = (dock.offsetHeight + 6) + 'px';
  else el.style.bottom = '';
}
function updateAutoPassChip() {
  const el = $('autopass'); if (!el) return;
  if (Date.now() < autoPassFlashUntil) return; // flash text still showing
  if (dismissedDuel.size) { el.textContent = '自動パス設定中：' + dismissedDuel.size + ' 件（タップで管理）'; el.className = 'on'; }
  else { el.className = ''; el.textContent = ''; }
  syncAutoPassChipPos();
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
    '<div class="sortrow"><span>' + dismissalName(v) + '</span><span class="mv"><button data-undismiss="' + k + '">解除</button></span></div>').join('');
  sheetOpenView('<div class="ttl">自動パスの設定（このデュエル）</div>' +
    '<div class="sub">ここにある「カードの効果」だけが残ったチェーン確認は、自動でパスされます。同じカードの同じ効果なら、置かれた場所・コピー・場面が変わっても聞きません。他に候補がある確認は通常どおり表示されます。</div>' +
    (rows || '<div class="sub">設定中のカードはありません</div>') +
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
  $('sheet').querySelectorAll('[data-undismiss]').forEach(b => b.addEventListener('click', () => {
    playClick(); dismissedDuel.delete(b.dataset.undismiss); updateAutoPassChip(); openDismissManager();
  }));
  $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
}
// ---- FX / response settings (round B, B11) ----
// The same toggles live on the start screen (seg-cutin / seg-resp)
// and in this sheet, reachable mid-duel from the small 演出設定
// button in the phase bar. Neither place ever touches the board:
// the sheet is an overlay, and while a prompt is open the button is
// inert (a prompt owns the sheet).
function syncFxSegs() {
  const mark = (id, v) => { const el = $(id); if (el) el.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === v)); };
  mark('seg-cutin', fxSettings.cutin ? 'on' : 'off');
  mark('seg-resp', fxSettings.resp);
}
function openFxSettings() {
  if (currentPrompt) return; // during a prompt the dock/sheet carries the interaction
  const draw = () => {
    sheetOpenView('<div class="ttl">演出・応答の設定</div>' +
      '<div class="sub">見せ方と確認の仕方だけの設定です。対戦の処理には影響しません。</div>' +
      '<div class="segrow">召喚カットイン</div><div class="seg" id="fxseg-cutin">' +
      '<button data-v="on"' + (fxSettings.cutin ? ' class="sel"' : '') + '>ON</button>' +
      '<button data-v="off"' + (!fxSettings.cutin ? ' class="sel"' : '') + '>OFF</button></div>' +
      '<div class="segrow">応答モード（チェーン確認）</div><div class="seg" id="fxseg-resp">' +
      '<button data-v="auto"' + (fxSettings.resp === 'auto' ? ' class="sel"' : '') + '>おまかせ</button>' +
      '<button data-v="on"' + (fxSettings.resp === 'on' ? ' class="sel"' : '') + '>毎回</button>' +
      '<button data-v="off"' + (fxSettings.resp === 'off' ? ' class="sel"' : '') + '>自動</button></div>' +
      '<div class="sub">おまかせ：「聞かない」にしたカードだけ自動でパス。それ以外は毎回確認します<br>毎回：すべてのチェーンで毎回確認します（「聞かない」設定は無効）<br>自動：任意のチェーン確認は全て自動でパス。必須の確認だけ表示します</div>' +
      '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">閉じる</button></div>');
    const wire = (id, apply) => {
      const el = $(id); if (!el) return;
      el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { playClick(); apply(b.dataset.v); draw(); }));
    };
    wire('fxseg-cutin', (v) => { fxSettings.cutin = v === 'on'; fxSaveSettings(); syncFxSegs(); });
    wire('fxseg-resp', (v) => { fxSettings.resp = v; fxSaveSettings(); syncFxSegs(); });
    $('sheet-cancel').addEventListener('click', () => { playClick(); sheetClose(); });
  };
  draw();
}
function uiChain(prompt, state) {
  if (!state.chain.length) dismissedChains = new Set();
  // Response mode 'on' (round B, B11): confirm at EVERY timing — the
  // per-chain / per-duel dismissals neither hide candidates nor
  // auto-pass. 'auto' keeps the item-4 behaviour exactly as before.
  const noDismiss = fxSettings.resp === 'on';
  const hidden = (e) => !noDismiss && (dismissedChains.has(chainKey(e)) || dismissedDuel.has(duelKey(e)));
  const visibleIdx = () => prompt.entries.map((e, i) => i).filter(i => prompt.forced || !hidden(prompt.entries[i]));
  // Duel-long dismissal (item 4): auto-answer pass ONLY when every remaining
  // candidate belongs to a dismissed card class. Prompts with any other
  // candidate, and all forced prompts, are shown normally. A visible flash
  // indicator tells the player the auto-pass happened.
  if (!noDismiss && !prompt.forced && prompt.entries.length > 0 && prompt.entries.every(e => dismissedDuel.has(duelKey(e)))) {
    flashAutoPass([...new Set(prompt.entries.map(e => dismissalName(e)))].join('・'));
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
      '<div class="ctx">' + timingText(state) + '｜' + (top ? 'チェーン' + state.chain.length + '：<span class="toplink" data-topinfo="1">' + cardName(top.code) + '</span> への応答' : '効果への応答') + (prompt.forced ? '（発動必須）' : '') + tag + '</div>' +
      retryWarn(prompt) +
      '<div class="cands">' + prompt.entries.map((e, i) => {
        if (!noDismiss && dismissedDuel.has(duelKey(e))) return ''; // duel-dismissed: hidden here, managed in the section below
        const disChain = dismissedChains.has(chainKey(e));
        // the candidate's own effect, named on the candidate itself
        // (a card with several chainable effects must not read as
        // one undifferentiated name)
        const cfx = entryEffect(e, 'chain');
        return '<div class="cand' + (disChain ? ' dismissed' : '') + '" data-chain="' + i + '">' + cardName(e.code) +
          '<div class="loc">' + locLabel(e) + (disChain ? '（このチェーンでは聞かない）' : '') + '</div>' +
          (cfx && cfx.n ? '<div class="fxline">' + (cfx.act ? '発動：' : '効果' + CIRCLED_NUM[cfx.n - 1] + '：') + fxExcerpt(cfx) + (fxTruncated(cfx) ? '<span class="fxmore">（続きは「詳細」で読めます）</span>' : '') + '</div>' : '') +
          (prompt.forced ? '' : '<span class="dismiss" data-dismiss="' + i + '">' + (disChain ? '聞くに戻す' : 'このチェーンでは聞かない') + '</span>') +
          (prompt.forced || disChain ? '' : '<span class="dueldismiss" data-dueldismiss="' + i + '">このデュエル中は聞かない（このカードのこの効果）</span>') +
          '<span class="candinfo" data-info="' + i + '">詳細</span></div>';
      }).join('') + '</div>' +
      (() => {
        // one row per dismissed CLASS: two copies of one card's
        // effect in a single prompt are the same class (BU-04)
        const dd = [...new Map(prompt.entries.filter(e => dismissedDuel.has(duelKey(e))).map(e => [duelKey(e), e])).values()];
        if (noDismiss || !dd.length) return '';
        return '<div class="duelsection">自動パス設定中：' + [...new Set(dd.map(e => dismissalName(e)))].join('・') +
          dd.map(e => '<button data-undismiss="' + duelKey(e) + '">' + dismissalName(e) + ' を解除</button>').join('') + '</div>';
      })() +
      '<div class="row">' + (prompt.forced ? '' : '<button class="bigbtn" id="chain-pass">パス</button>') + '</div>' +
      // W-17: what パス commits to, and that the question can
      // return — stated once, under the button itself.
      (prompt.forced ? '' : '<div class="sub">パス＝このタイミングでは何も発動しません。場面が変わると、また確認されることがあります。</div>');
    $('dock').className = 'on'; // exact class is a contract (tests/tools match on it) — do not append state classes here
    if (firstDraw && $('dock').animate) { // a NEW prompt visibly arrives, even if its text matches the previous one
      try { $('dock').animate([{ transform: 'translateY(14px)', opacity: .25 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' }); } catch (e) {}
    }
    firstDraw = false;
    $('dock').querySelectorAll('[data-chain]').forEach(c => c.addEventListener('click', (ev) => {
      if (ev.target.dataset.dismiss != null || ev.target.dataset.dueldismiss != null || ev.target.dataset.info != null) return;
      if (dismissedChains.has(chainKey(prompt.entries[+c.dataset.chain]))) return; // chain-dismissed: un-dismiss via × first
      playClick(); finishPrompt(E.i32resp(+c.dataset.chain));
    }));
    // R-SEL-1: reading a candidate never answers the prompt —
    // the detail floats over the dock and closes back onto it.
    $('dock').querySelectorAll('[data-info]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      const e = prompt.entries[+x.dataset.info]; openInfoPop(e.code, e, entryEffect(e, 'chain'));
    }));
    // P2-5: the link being answered is itself readable in full —
    // tapping its name in the context line floats its detail,
    // without answering anything.
    $('dock').querySelectorAll('[data-topinfo]').forEach(x => x.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick();
      if (top) openInfoPop(top.code, top);
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
      dismissedDuel.set(duelKey(e), { code: e.code, desc: e.desc, loc: e.loc });
      updateAutoPassChip();
      // if that was the last visible candidate class, the prompt now auto-passes
      if (!prompt.forced && prompt.entries.every(en => dismissedDuel.has(duelKey(en)))) {
        flashAutoPass([...new Set(prompt.entries.map(en => dismissalName(en)))].join('・'));
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
    syncAutoPassChipPos(); // BU-15: the chip clears the dock it now sits over
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
function renderPlaceHint() {
  const h = $('placehint');
  if (!h || !placeCtx) return;
  h.innerHTML = placeCtx.title + '（あと ' + (placeCtx.count - placeCtx.chosen.size) + '）' +
    (placeCtx.retry ? '<div class="retry">その場所には置けません。光っている場所から選んでください。</div>' : '');
}
function uiPlace(prompt, state) {
  const zones = availZones(prompt);
  let title;
  if (prompt.name === 'SELECT_PLACE') {
    // C-26: name what is being placed whenever the identity is
    // certain — the just-chosen procedure action's card, else
    // the asking effect in the context form (never a guess).
    // W-05: a tap here is an immediate, unchangeable commitment —
    // the banner must say so BEFORE the tap, not after.
    if (lastPlaceCard) title = '《' + cardName(lastPlaceCard.code) + '》を置く場所をタップしてください。タップした場所にそのまま置かれます（選び直せません）';
    else title = contextText(prompt) + '置く場所をタップしてください。タップした場所にそのまま置かれます（選び直せません）';
  } else {
    title = contextText(prompt) + '無効にするゾーンをタップしてください。タップしたゾーンはそのまま無効になります（選び直せません）';
  }
  placeCtx = { avail: new Set(zones.map(z => z.con + ':' + z.loc + ':' + z.seq)), chosen: new Map(), count: prompt.count, retry: !!prompt.retryCount, title };
  const h = $('placehint');
  // C-26: directly under the midbar, over the top edge of the
  // player's own field — no longer hiding the opponent's piles.
  const mb = $('midbar'), ap = $('app');
  if (mb && ap && ap.getBoundingClientRect) {
    const mbB = mb.getBoundingClientRect().bottom, apT = ap.getBoundingClientRect().top;
    if (mbB) h.style.top = Math.round(mbB - apT) + 'px';
  }
  h.className = 'on';
  renderPlaceHint();
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
  sheetOpen('<div class="ttl">' + cardName(prompt.code) + ' の表示形式</div><div class="sub">表示形式を選んでください。タップした表示形式で即確定し、取り消すことはできません。</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    '<div class="posrow">' + defs.map(d => '<div class="posbtn" data-pos="' + d.bit + '"><div class="glyph ' + d.cls + '"></div>' + d.label + '</div>').join('') + '</div>');
  $('sheet').querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.pos)); }));
}
// BU-23: whether a grid selection is mandatory must be readable
// BEFORE the first tap, and it is derived from the prompt's own
// terms only — never guessed: a cancel exit makes it optional
// (the whole operation can be abandoned), a zero minimum makes
// it optional (confirm with nothing), anything else is a
// requirement the core will enforce with a retry.
function gridReqNote(o) {
  if (o.cancelable) return '（任意：選ばずにやめることもできます）';
  if (o.prompt && o.prompt.min === 0) return '（任意：0枚でも決定できます）';
  return '（必須）';
}
// ---- generic card-grid selection sheet (tray conventions) ----
function gridSheet(o) {
  // o: {title, purpose?, sub, cards:[{code,locLabel,extra,locked}], selected:Set(idx), valid:fn, confirmLabel, cancelable, onToggle}
  // purpose: the plain-words purpose line (selectPurposeText), rendered
  // under the title when present; absent = the sheet renders as before.
  const draw = () => {
    // Hidden candidates (opponent's face-down / hand / deck cards)
    // render as the card back with a public-only label: no name, no
    // art, no stats, no text, no detail button.
    const hidOf = (c) => selCardHidden(c.ref || c, o.prompt);
    const nameOf = (c) => hidOf(c) ? hiddenCardLabel(c.ref || c) : cardName(c.code);
    const tray = [...o.selected].map(i => '<span class="chip" data-chip="' + i + '">' + nameOf(o.cards[i]) + ' ✕</span>').join('') +
      (o.locked || []).map(c => '<span class="chip locked">' + (selCardHidden(c, o.prompt) ? hiddenCardLabel(c) : cardName(c.code)) + '（固定）</span>').join('');
    const subTxt = typeof o.sub === 'function' ? o.sub() : o.sub;
    sheetOpen('<div class="ttl">' + o.title + '</div>' + (o.purpose ? '<div class="purpose">' + o.purpose + '</div>' : '') + '<div class="sub" id="gsub">' + subTxt + gridReqNote(o) + '</div>' + contextLineHTML(o.prompt) + retryWarn(o.prompt) +
      // (W-24: a retry used to repeat the sub as a 「条件：」 line
      // under the warning — the same sentence twice. The shortfall
      // already lives on the disabled confirm button's label.)
      (tray ? '<div id="tray">' + tray + '</div>' : '<div id="tray"></div>') +
      '<div class="grid">' + o.cards.map((c, i) => {
        const hid = hidOf(c);
        return '<div class="gcard' + (hid ? ' back' : '') + (o.selected.has(i) ? ' sel' : '') + '" data-grid="' + i + '"' + (hid ? '' : artInline(c.code, false, c.ref && c.ref.con != null ? deckKeyOfSeat(c.ref.con) : deckKeyOfSeat(HP))) + '>' +
        (hid ? '' : '<button class="gdetail" data-gdetail="' + i + '">詳細</button>') +
        '<div class="loc">' + c.locLabel + '</div><div class="nm' + (hid ? '' : kindCls(c.code)) + '">' + (hid ? hiddenCardLabel(c.ref || c) : cardName(c.code) + (c.extra ? ' ' + c.extra : '')) + '</div>' +
        (hid ? '' : (statsLine(c.code) ? '<div class="stats">' + statsLine(c.code) + '</div>' : '') +
        (hid ? '' : (o.showText && cardText(c.code) ? '<div class="itext">' + cardText(c.code) + '</div>' : ''))) + '</div>';
      }).join('') + '</div>' +
      '<div class="btnrow"><button class="bigbtn" id="grid-confirm" ' + (o.valid() ? '' : 'disabled') + '>' + (o.valid() ? (o.confirmLabel || '決定') : (o.needLabel ? o.needLabel() : (o.confirmLabel || '決定'))) + '</button>' +
      (o.cancelable ? '<button class="bigbtn sub" id="grid-cancel">選ばずにやめる</button>' : '') + '</div>');
    $('sheet').querySelectorAll('[data-grid]').forEach(g => g.addEventListener('click', (ev) => { if (ev.target.closest('[data-gdetail]')) return; playClick();
      if (o.onToggle(+g.dataset.grid) === 'max') { const gs = $('gsub'); if (gs) { const orig = gs.innerHTML; gs.textContent = 'これ以上選べません。選んだカードをタップすると外せます'; setTimeout(() => { if (gs.isConnected) gs.innerHTML = orig; }, 1500); } return; }
      draw(); }));
    // R-SEL-1: detail opens over the sheet; the selection (held
    // in o's closure) is untouched by opening or closing it.
    $('sheet').querySelectorAll('[data-gdetail]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); playClick(); openInfoPop(o.cards[+b.dataset.gdetail].code, o.cards[+b.dataset.gdetail].ref || null); }));
    $('sheet').querySelectorAll('[data-chip]').forEach(ch => ch.addEventListener('click', () => { playClick(); o.onToggle(+ch.dataset.chip); draw(); }));
    $('grid-confirm').addEventListener('click', () => { playClick(); o.onConfirm([...o.selected]); });
    const cancel = $('grid-cancel');
    if (cancel) cancel.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  };
  draw();
}
// BU-13 (brushup round 3): SELECT_CARD itself carries no purpose
// tag, so for the one selection the CORE asks on its own behalf —
// the rule-process hand-limit discard — this client states only
// the purpose it can PROVE from the prompt + state alone. Every
// guard must hold: END phase, no chain in progress and no asking
// effect (context null), not cancelable, every candidate is the
// asked player's own hand card, and min == max == exactly the
// over-limit count (hand - 6). Effect-driven selections from the
// hand (a discard COST, a target, a material) fail at least the
// context / chain / count guards and keep the generic title — a
// guessed purpose that mislabels a cost as a rule discard would
// be worse than none. Returns 'handlimit' or null.
// (Effect-driven purposes come from the core's own declaration
// instead — see selectPurposeText below.)
function inferSelectPurpose(prompt, state) {
  if (!state || !prompt || prompt.name !== 'SELECT_CARD' || prompt.context) return null;
  if (state.phaseName !== 'END' || (state.chain && state.chain.length)) return null;
  if (prompt.cancelable) return null;
  const P = state.players && state.players[prompt.player];
  if (!P || !P.hand) return null;
  const excess = P.hand.length - 6;
  if (excess <= 0 || prompt.min !== excess || prompt.max !== excess) return null;
  if (!prompt.cards.length || prompt.cards.some(c => c.con !== prompt.player || c.loc !== E.LOC.HAND)) return null;
  return 'handlimit';
}
// ---- select purpose (user instruction 2026-11-05: when an
// effect asks for cards, say in plain words WHAT the selection
// is for — "特殊召喚するカードを選択", "除外するカードを選択" —
// for every card, not per-card patches; the effect context line
// stays as it was, this line is added, never a replacement).
// Primary source: the core's own declaration. Before a scripted
// selection, the effect script (or a core procedure) calls
// Duel.Hint(HINT_SELECTMSG, player, value); the driver attaches
// the value to the prompt as prompt.selectHint (engine.js,
// consume-on-dispatch, so it cannot be stale). Generic values
// are the HINTMSG_* system ids from the bundled constant.lua and
// map mechanically through the table below — no per-card text.
// Anything else (560 HINTMSG_SELECT = a bare "select", a raw card
// code, an aux.Stringid card-string id, or no hint at all) proves
// NO specific purpose and yields null: the sheet then keeps the
// generic heading rather than printing a guessed purpose. The
// provable-inference fallback for the core's own rule process
// (hand-limit discard, BU-13) already renders as that sheet's
// title/sub, so it is not repeated here.
const SELECT_HINT_PURPOSE = {
  500: 'リリースするカードを選択',          // HINTMSG_RELEASE
  501: '捨てるカードを選択',                // HINTMSG_DISCARD
  502: '破壊するカードを選択',              // HINTMSG_DESTROY
  503: '除外するカードを選択',              // HINTMSG_REMOVE
  504: '墓地へ送るカードを選択',            // HINTMSG_TOGRAVE
  505: '手札に戻すカードを選択',            // HINTMSG_RTOHAND
  506: '手札に加えるカードを選択',          // HINTMSG_ATOHAND
  507: 'デッキに戻すカードを選択',          // HINTMSG_TODECK
  508: '召喚するカードを選択',              // HINTMSG_SUMMON
  509: '特殊召喚するカードを選択',          // HINTMSG_SPSUMMON
  510: 'セットするカードを選択',            // HINTMSG_SET
  511: '融合素材にするカードを選択',        // HINTMSG_FMATERIAL
  512: 'シンクロ素材にするカードを選択',    // HINTMSG_SMATERIAL
  513: 'エクシーズ素材にするカードを選択',  // HINTMSG_XMATERIAL
  514: '表側表示にするカードを選択',        // HINTMSG_FACEUP
  515: '裏側表示にするカードを選択',        // HINTMSG_FACEDOWN
  516: '攻撃表示にするカードを選択',        // HINTMSG_ATTACK
  517: '守備表示にするカードを選択',        // HINTMSG_DEFENSE
  518: '装備するカードを選択',              // HINTMSG_EQUIP
  519: '取り除くエクシーズ素材を選択',      // HINTMSG_REMOVEXYZ
  520: 'コントロールを得るカードを選択',    // HINTMSG_CONTROL
  521: '破壊の身代わりになるカードを選択',  // HINTMSG_DESREPLACE
  522: '表側攻撃表示にするカードを選択',    // HINTMSG_FACEUPATTACK
  523: '表側守備表示にするカードを選択',    // HINTMSG_FACEUPDEFENSE
  524: '裏側攻撃表示にするカードを選択',    // HINTMSG_FACEDOWNATTACK
  525: '裏側守備表示にするカードを選択',    // HINTMSG_FACEDOWNDEFENSE
  526: '確認するカードを選択',              // HINTMSG_CONFIRM
  527: 'フィールドに出すカードを選択',      // HINTMSG_TOFIELD
  528: '表示形式を変更するカードを選択',    // HINTMSG_POSCHANGE
  531: 'リリースするカードを選択',          // HINTMSG_TRIBUTE
  533: 'リンク素材にするカードを選択',      // HINTMSG_LMATERIAL
  549: '攻撃対象のカードを選択',            // HINTMSG_ATTACKTARGET
  551: '対象とするカードを選択',            // HINTMSG_TARGET
  575: '発動を無効にするカードを選択',      // HINTMSG_NEGATE
  576: '攻撃力・守備力が変わるカードを選択', // HINTMSG_ATKDEF
  578: 'エクシーズ素材として重ねるカードを選択', // HINTMSG_ATTACH
  579: '墓地に戻すカードを選択',            // HINTMSG_RTOGRAVE
};
function selectHintPurpose(value) {
  if (typeof value !== 'number' || !isFinite(value)) return null;
  return SELECT_HINT_PURPOSE[value] || null;
}
// The purpose line for a card-selection prompt, or null when no
// purpose is provable (the sheet then renders exactly as before).
function selectPurposeText(prompt) {
  if (!prompt) return null;
  return selectHintPurpose(prompt.selectHint);
}
function uiSelectCards(prompt, state) {
  const isTrib = prompt.name === 'SELECT_TRIBUTE';
  const atk = !isTrib && promptAttacker ? promptAttacker : null;
  const isHandLimit = !isTrib && !atk && inferSelectPurpose(prompt, state) === 'handlimit';
  const selected = new Set();
  const sum = () => [...selected].reduce((a, i) => a + (prompt.cards[i].releaseParam || 0), 0);
  gridSheet({
    prompt,
    // Tribute / attack-target / hand-limit sheets already state
    // their purpose in the title or sub — the purpose line would
    // only repeat it, so it is suppressed there.
    purpose: (isTrib || atk || isHandLimit) ? null : selectPurposeText(prompt),
    title: isTrib ? 'リリースするカード' : atk ? cardName(atk.code) + ' の攻撃' : isHandLimit ? '手札の上限' : 'カードの選択',
    sub: () => isTrib ? '合計 ' + prompt.min + ' 以上になるよう選んでください（現在 ' + sum() + '）'
                      : atk ? '攻撃する相手を選んでください'
                      : isHandLimit ? '手札が上限（6枚）を超えています。捨てるカードを ' + prompt.min + ' 枚選んでください（現在 ' + selected.size + ' 枚）'
                      : prompt.min + '〜' + prompt.max + ' 枚選んでください（現在 ' + selected.size + ' 枚）',
    confirmLabel: atk ? 'この相手を攻撃する' : isHandLimit ? 'このカードを捨てる' : undefined,
    cards: prompt.cards.map(c => ({ code: c.code, locLabel: locLabel(c), extra: isTrib ? '（リリース値 ' + c.releaseParam + '）' : '', ref: c })),
    selected,
    locked: [],
    showText: true,
    cancelable: prompt.cancelable,
    valid: () => isTrib ? (sum() >= prompt.min && selected.size <= prompt.max) : (selected.size >= prompt.min && selected.size <= prompt.max),
    needLabel: () => isTrib ? '決定（合計あと' + Math.max(0, prompt.min - sum()) + '）' : isHandLimit ? '捨てる（あと' + Math.max(0, prompt.min - selected.size) + '枚）' : '決定（あと' + Math.max(0, prompt.min - selected.size) + '枚）',
    onToggle: (i) => {
      if (selected.has(i)) selected.delete(i);
      else { if (!isTrib && selected.size >= prompt.max) return 'max'; selected.add(i); }
    },
    onConfirm: (idx) => finishPrompt(E.cardsResp(idx)),
  });
}
function uiUnselect(prompt, state) {
  const combined = prompt.select.map((c, i) => ({ c, idx: i, sel: false }))
    .concat(prompt.unselect.map((c, i) => ({ c, idx: prompt.select.length + i, sel: true })));
  const selCount = prompt.unselect.length;
  // Both buttons below send the same wire reply (-1), and the core
  // reads it by state (playerop.cpp SelectUnselectCard, operations
  // SelectTribute case 3): with a finishable selection of >= min it
  // FINISHES with the current selection; with nothing selected it
  // cancels the whole operation. So 「選ばずにやめる」 may only be
  // offered while -1 would truly cancel — nothing selected yet, or
  // a prompt that is not finishable at all. Offering it beside 決定
  // let "やめる" silently confirm the selection instead.
  const cancelTruthful = prompt.cancelable && !(prompt.finishable && selCount > 0);
  let hint = '';
  if (prompt.finishable && selCount > 0 && selCount < prompt.min) hint = 'あと' + (prompt.min - selCount) + '枚選ぶと決定できます。';
  if (prompt.finishable && selCount > 0) hint += 'やめる場合は選択をすべて外してください。';
  // BU-23: same derived mandatory/optional note as the grid
  // sheet — a truthful cancel exit says so, no cancel at all
  // says 必須, and the middle case (cancel exists but a live
  // selection would turn it into a confirm) is already spelled
  // out by the hint above, so it gets no tag rather than a lie.
  const purpose = selectPurposeText(prompt);
  const reqNoteU = cancelTruthful ? '（任意：選ばずにやめることもできます）' : (!prompt.cancelable ? '（必須）' : '');
  sheetOpen('<div class="ttl">カードの選択</div>' + (purpose ? '<div class="purpose">' + purpose + '</div>' : '') + '<div class="sub">' + prompt.min + '〜' + prompt.max + ' 枚（現在 ' + selCount + ' 枚選択中）。タップで選択／解除します。' + reqNoteU + (hint ? ' ' + hint : '') + '</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    '<div class="grid">' + combined.map((x, k) => {
      const hid = selCardHidden(x.c, prompt);
      return '<div class="gcard' + (hid ? ' back' : '') + (x.sel ? ' sel' : '') + '" data-unselect="' + x.idx + '"' + (hid ? '' : artInline(x.c.code, false, deckKeyOfSeat(x.c.con))) + '>' +
      (hid ? '' : '<button class="gdetail" data-uinfo="' + k + '">詳細</button>') +
      '<div class="loc">' + locLabel(x.c) + '</div><div class="nm' + (hid ? '' : kindCls(x.c.code)) + '">' + (hid ? hiddenCardLabel(x.c) : cardName(x.c.code)) + '</div>' +
      (hid ? '' : (statsLine(x.c.code) ? '<div class="stats">' + statsLine(x.c.code) + '</div>' : '') +
      (hid ? '' : (cardText(x.c.code) ? '<div class="itext">' + cardText(x.c.code) + '</div>' : ''))) + '</div>';
    }).join('') + '</div>' +
    '<div class="btnrow">' +
    (prompt.finishable && selCount >= prompt.min ? '<button class="bigbtn" id="unselect-finish">決定</button>' : '') +
    (cancelTruthful ? '<button class="bigbtn sub" id="unselect-cancel">選ばずにやめる</button>' : '') + '</div>');
  $('sheet').querySelectorAll('[data-unselect]').forEach(g => g.addEventListener('click', (ev) => { if (ev.target.closest('[data-uinfo]')) return; playClick(); finishPrompt(E.unselectToggleResp(+g.dataset.unselect)); }));
  $('sheet').querySelectorAll('[data-uinfo]').forEach(b => b.addEventListener('click', (ev) => { ev.stopPropagation(); playClick(); const x = combined[+b.dataset.uinfo]; openInfoPop(x.c.code, x.c); }));
  const fin = $('unselect-finish'); if (fin) fin.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  const can = $('unselect-cancel'); if (can) can.addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
}
function uiSelectSum(prompt, state) {
  const selected = new Set();
  const fmt = (c) => { const o1 = c.sumParam & 0xffff, o2 = c.sumParam >> 16; return o2 && o2 !== o1 ? '値 ' + o1 + '／' + o2 : '値 ' + o1; };
  // Current total of must + selected, as a RANGE: cards with two
  // values make any single "current sum" a lie, so the sub states
  // the reachable span and collapses to one number when it is one
  // (care audit W-13, on the TRIBUTE sheet's established format).
  const span = () => {
    let lo = 0, hi = 0;
    for (const c of prompt.must.concat([...selected].map(i => prompt.cards[i]))) {
      const o1 = c.sumParam & 0xffff, o2 = c.sumParam >> 16;
      const a = o2 ? Math.min(o1, o2) : o1, b = o2 ? Math.max(o1, o2) : o1;
      lo += a; hi += b;
    }
    return { lo, hi };
  };
  gridSheet({
    prompt,
    purpose: selectPurposeText(prompt),
    title: 'カードの選択（合計値）',
    sub: () => {
      const s = span();
      const cur = s.lo === s.hi ? '現在の合計 ' + s.lo : '現在の合計 ' + s.lo + '〜' + s.hi;
      return (prompt.mode === 'exact' ? '合計がちょうど ' + prompt.acc + ' になるよう選んでください' : '合計が ' + prompt.acc + ' 以上になるよう選んでください') + '（' + cur + '）';
    },
    cards: prompt.cards.map(c => ({ code: c.code, locLabel: locLabel(c), extra: fmt(c), ref: c })),
    selected,
    locked: prompt.must,
    showText: true,
    cancelable: false,
    valid: () => E.sumSelectionValid(prompt, [...selected]),
    needLabel: () => {
      const s = span();
      if (prompt.mode === 'exact' && s.lo === s.hi && s.hi < prompt.acc) return '決定（合計あと' + (prompt.acc - s.hi) + '）';
      if (prompt.mode !== 'exact' && s.hi < prompt.acc) return '決定（合計あと' + (prompt.acc - s.hi) + '）';
      return '決定';
    },
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
      prompt.cards.map((c, i) => '<div class="counterrow"><span>' + (selCardHidden(c, prompt) ? hiddenCardLabel(c) : cardName(c.code)) + '（' + locLabel(c) + '／' + c.count + '個）</span>' +
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
    sheetOpen('<div class="ttl">' + (prompt.name === 'SORT_CHAIN' ? 'チェーンの順番' : 'カードの順番') + '</div><div class="sub">' + (prompt.name === 'SORT_CHAIN' ? '上から順に処理される順番です。並べ替えて「この順番で決定」を押してください。' : '上から順に、次に使う順番に並べてください。') + '</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
      order.map((ci, pos) => '<div class="sortrow"><span>' + (pos + 1) + '. ' + (selCardHidden(prompt.cards[ci], prompt) ? hiddenCardLabel(prompt.cards[ci]) : cardName(prompt.cards[ci].code)) + '</span><span class="mv">' +
        '<button data-up="' + pos + '">↑</button><button data-down="' + pos + '">↓</button></span></div>').join('') +
      '<div class="btnrow"><button class="bigbtn" id="sort-ok">この順番で決定</button><button class="bigbtn sub" id="sort-keep">元の順番のままにする</button></div>');
    $('sheet').querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.up; if (p > 0) { [order[p-1], order[p]] = [order[p], order[p-1]]; } playClick(); draw(); }));
    $('sheet').querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.down; if (p < order.length - 1) { [order[p+1], order[p]] = [order[p], order[p+1]]; } playClick(); draw(); }));
    $('sort-ok').addEventListener('click', () => { playClick(); finishPrompt(E.sortResp(order)); });
    $('sort-keep').addEventListener('click', () => { playClick(); finishPrompt(E.cancelResp()); });
  };
  draw();
}
// ---- yes/no, option ----
const OPTION_LABELS = {
  // (古衛兵アギド's two mill-target options left with the card in
  // the v11 recipe swap; no current pool card needs a label here.)
};
function optionLabelText(desc) {
  if (typeof desc !== 'number' || !isFinite(desc)) return null;
  // desc = aux.Stringid(code, idx) = code<<20 | idx (see
  // descEffect; the code*16+n form names no real card)
  const code = Math.floor(desc / 1048576), idx = desc % 1048576;
  return OPTION_LABELS[code + '|' + idx] || null;
}
window.__optLabel = { resolve: optionLabelText };
// Test surface (brushup round 3): the SELECT_CARD purpose
// inference and the context-line phase granularity, so the
// guard set is pinned by test-purpose.js. hintText /
// purposeText pin the select-hint purpose line (2026-11-05).
window.__purpose = { infer: inferSelectPurpose, phaseCtx: phaseJaContext, hintText: selectHintPurpose, purposeText: selectPurposeText };
// Test surface: render the SELECT_UNSELECT_CARD sheet for a synthetic
// prompt so its button states can be asserted without a live duel.
window.__unselect = { open: (prompt) => uiUnselect(prompt, null) };
// Test surface: render the SELECT_CARD grid sheet for a synthetic
// prompt (same seam as __unselect), for test-facedown-select.js.
window.__select = { open: (prompt) => uiSelectCards(prompt, null) };
// Test surface (opponent-info round): the board info-tap guard
// and the peek info tap, so test-oppinfo.js can pin the
// visibility rule and the selection-untouched contract without
// hit-testing (jsdom has no elementsFromPoint).
window.__oppinfo = { boardCardAt, peekInfoTap };
// Test surface (selection-clarity round): the BU-15 chip
// placement, the BU-22 peek answer band, the BU-23 derived
// requirement notes and the BU-28 truncation flag, so
// test-clarity.js can pin them without a live duel.
window.__clarity = { syncChipPos: syncAutoPassChipPos, syncPeekBar, gridReqNote, announceDupNote, fxTruncated };
function uiYesNo(prompt, state) {
  const isEff = prompt.name === 'SELECT_EFFECTYN';
  // WHICH card and WHICH effect is being asked must be readable on
  // the sheet itself (user report 2026-11-03). Sources, in order:
  // EFFECTYN names its card outright; a plain YESNO carries the
  // asking card in the prompt context AND, when its desc is that
  // card's string id, the exact effect index being resolved.
  const ctx = !isEff && prompt.context && prompt.context.code ? prompt.context : null;
  const named = isEff ? { code: prompt.code } : ctx;
  // Resolution order (pool-coverage round): an EFFECTYN falls
  // back to the prompt-scoped pinning (desc-less triggers whose
  // location+scope leave one candidate — Minerva ② from the
  // graveyard); a plain YESNO first tries the audited yn table
  // (a follow-up whose desc index the count rule cannot see),
  // then the shared-helper follow-up rule — BEFORE the asking
  // link's own desc, because the context link always resolves
  // and would shadow the follow-up (observed in the browser:
  // the Vernusylph optional-summon question rendered as an
  // activation confirmation) — then the desc itself, then the
  // asking link's desc.
  const fx = isEff ? (resolveEffect(prompt.code, prompt.desc) || scopedEffect(prompt.code, prompt.desc, prompt.loc, 'chain'))
                   : (ctx ? (resolveYesNo(ctx.code, prompt.desc) || foreignFollowFx(ctx, prompt) || resolveEffect(ctx.code, prompt.desc) || resolveEffect(ctx.code, ctx.desc)) : null);
  const ttl = named
    ? cardName(named.code) + ' の効果' + (fx && fx.n ? CIRCLED_NUM[fx.n - 1] : '')
    : '確認';
  let sub, block;
  if (isEff) {
    // Per-location phrasing: locLabel + ' の効果' glued a floating
    // particle (「自分の墓地 の効果…」). Each location gets its own
    // whole sentence (care audit W-14).
    sub = prompt.loc === E.LOC.HAND ? '手札にあるこのカードの効果を発動しますか？'
      : prompt.loc === E.LOC.GRAVE ? '墓地にあるこのカードの効果を発動しますか？'
      : prompt.loc === E.LOC.REMOVED ? '除外されているこのカードの効果を発動しますか？'
      : 'フィールドのこのカードの効果を発動しますか？';
    block = fxBlockHTML(prompt.code, fx);
  } else if (fx && fx.follow) {
    // yes/no about the optional clause inside the resolving effect.
    // The parent effect is the one the context (the solving chain
    // link) names: when its number is known, the question is pinned
    // to it and its own step clause is quoted; otherwise the clause
    // is quoted from the card text as a whole. (The yn table pins
    // the parent number on fx itself — the asking link's desc may
    // be absent, e.g. Minerva's undescribed ②.)
    const parentFx = (fx.n ? fx : null) || resolveEffect(ctx.code, ctx.desc) || scopedEffect(ctx.code, ctx.desc, ctx.loc, 'chain');
    const clause = (parentFx && parentFx.n ? stepClause(ctx.code, parentFx.n) : '')
      || followUpClause(ctx.code);
    sub = '「' + cardName(ctx.code) + '」の効果の続きです。' + (clause ? '次も行いますか？' : 'この効果の処理を続けますか？');
    block = fxBlockHTML(ctx.code, parentFx && parentFx.n ? parentFx : fx);
  } else if (named) {
    sub = '「' + cardName(named.code) + '」' + (fx && fx.n ? 'の効果' + CIRCLED_NUM[fx.n - 1] : 'の効果') + 'について確認です。この効果を進めますか？';
    block = fxBlockHTML(named.code, fx);
  } else {
    // No card could be pinned to this question: say what the
    // question IS instead of a bare 「選択してください」 (W-18).
    // (No card text can be attached here — by construction this
    // branch has no context card to quote.)
    sub = '効果の処理についての確認です。';
    block = '';
  }
  sheetOpen('<div class="ttl">' + ttl + '</div>' +
    '<div class="ctx">' + timingText(state) + confirmTag(state) + '</div>' +
    '<div class="sub">' + sub + '</div>' + (isEff || named ? '' : contextLineHTML(prompt)) + retryWarn(prompt) +
    block +
    // a follow-up question is not an activation: its answer pair
    // says 行う/行わない, matching the question's own wording
    '<button class="optbtn" id="yn-yes">' + (fx && fx.follow ? '行う' : (isEff || named ? '発動する' : 'はい')) + '</button>' +
    '<button class="optbtn" id="yn-no">' + (fx && fx.follow ? '行わない' : (isEff || named ? '発動しない' : 'いいえ')) + '</button>' +
    // C-27 (audit round): an effectyn class can be suppressed for
    // the rest of the duel; the auto-answer is then 発動しない.
    (isEff ? '<button class="optbtn" id="yn-suppress">この効果の確認を、このデュエル中は省略する</button><div class="sub">省略すると、次回からは自動で「発動しない」として進みます</div>' : ''));
  $('yn-yes').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(1)); });
  $('yn-no').addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(0)); });
  const sup = $('yn-suppress');
  if (sup) sup.addEventListener('click', () => { playClick(); duelNoConfirm.add(effectYnKey(prompt)); finishPrompt(E.i32resp(0)); });
}
function uiOption(prompt, state) {
  // C-24: option entries are the same desc string ids as everywhere
  // else. A button's label, in order of precision: the audit round's
  // hand-written wording for sub-descriptions (Agido's mill
  // choices, which are NOT numbered effects), then the numbered
  // effect the desc decodes to, then a plain numbered label. The
  // SOURCE card (from the context or the first decodable option)
  // is named in the title and its full text rides below.
  const optFx = prompt.options.map(o => descEffect(o));
  const srcCode = (prompt.context && prompt.context.code) || (optFx.find(d => d) || {}).code || null;
  const ttl = srcCode ? cardName(srcCode) + ' の効果の選択' : '効果の選択';
  sheetOpen('<div class="ttl">' + ttl + '</div><div class="sub">適用する効果を選んでください。タップするとその効果で確定します（選び直せません）。</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
    prompt.options.map((o, i) => {
      const lb = optionLabelText(o);
      if (lb) return '<button class="optbtn" data-opt="' + i + '">' + lb + '</button>';
      const d = optFx[i];
      const fx = d ? resolveEffect(d.code, o) : null;
      if (fx && fx.n) return '<button class="optbtn" data-opt="' + i + '">効果' + CIRCLED_NUM[fx.n - 1] + '：' + fxExcerpt(fx) + '</button>';
      // Last resort (W-07): never a bare number the result cannot
      // be read from — point at the full text printed below.
      return '<button class="optbtn" data-opt="' + i + '">その他の効果（全文は下のカードテキストで確認してください）</button>';
    }).join('') +
    (srcCode ? fxBlockHTML(srcCode, null) : ''));
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
    sheetOpen('<div class="ttl">' + (isRace ? '種族' : '属性') + 'の宣言</div><div class="sub">' + (prompt.context && prompt.context.code ? '「' + cardName(prompt.context.code) + '」の効果で宣言する' + (isRace ? '種族' : '属性') + 'を ' : '') + prompt.count + ' つ選んでください（現在 ' + selected.size + '）</div>' + contextLineHTML(prompt) + retryWarn(prompt) +
      '<div class="grid">' + bits.map(([bit, nm]) => '<div class="gcard' + (selected.has(bit) ? ' sel' : '') + '" data-bit="' + bit + '"><div class="nm">' + nm + '</div></div>').join('') + '</div>' +
      '<div class="btnrow"><button class="bigbtn" id="ann-confirm" ' + (selected.size === prompt.count ? '' : 'disabled') + '>決定</button></div>' +
      // P2-3: the declaring card's own text rides the sheet, so
      // "what is this declaration FOR" is answerable in place.
      (prompt.context && prompt.context.code ? fxBlockHTML(prompt.context.code, null) : ''));
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
  sheetOpen('<div class="ttl">数値の宣言</div>' + contextLineHTML(prompt) +
    (prompt.context && prompt.context.code ? '<div class="sub">「' + cardName(prompt.context.code) + '」の効果で宣言する数を選んでください。タップするとその数で確定します。</div>' : '') + retryWarn(prompt) +
    prompt.options.map((o, i) => '<button class="optbtn" data-num="' + i + '">' + o + '</button>').join('') +
    (prompt.context && prompt.context.code ? fxBlockHTML(prompt.context.code, null) : ''));
  $('sheet').querySelectorAll('[data-num]').forEach(b => b.addEventListener('click', () => { playClick(); finishPrompt(E.i32resp(+b.dataset.num)); }));
}
// BU-23 (declare grid): copies of the SAME code are fungible —
// announcing any of them announces that code, so the grid may
// say so. Same NAME on different codes is a different matter:
// those are different declarations and must never carry the
// note. The pool is built from Object.keys(DATA.cards), so a
// repeated code cannot occur today; the note is wired to the
// literal condition so a future pool source that ever feeds
// copies gets the line, and nothing else ever does.
function announceDupNote(codes) {
  const seen = new Set();
  for (const c of codes) { if (seen.has(c)) return '同名カードはどれを選んでも同じです。'; seen.add(c); }
  return '';
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
  // Two steps, not tap-to-declare (P1-4/W-10): a declaration is
  // irreversible and a name-only grid invites mis-taps, so a tap
  // only SELECTS (with a detail button per candidate, the tray
  // convention) and the named confirm button declares.
  let chosen = null;
  const draw = () => {
    sheetOpen('<div class="ttl">カードの宣言</div>' + contextLineHTML(prompt) +
      '<div class="sub">宣言するカードをタップで選び、「宣言する」を押してください。（必須）' + (announceDupNote(pool) ? ' ' + announceDupNote(pool) : '') + '</div>' + retryWarn(prompt) +
      '<div class="grid">' + pool.map(code => '<div class="gcard' + (chosen === code ? ' sel' : '') + '" data-code="' + code + '"' + artInline(code, false, deckKeyOfCode(code)) + '><button class="gdetail" data-acinfo="' + code + '">詳細</button><div class="nm' + kindCls(code) + '">' + cardName(code) + '</div></div>').join('') + '</div>' +
      '<div class="btnrow"><button class="bigbtn" id="announce-ok" ' + (chosen == null ? 'disabled' : '') + '>' + (chosen == null ? '宣言する' : '《' + cardName(chosen) + '》を宣言する') + '</button></div>');
    $('sheet').querySelectorAll('[data-code]').forEach(g => g.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-acinfo]')) return;
      playClick(); chosen = +g.dataset.code; draw();
    }));
    $('sheet').querySelectorAll('[data-acinfo]').forEach(b => b.addEventListener('click', (ev) => {
      ev.stopPropagation(); playClick(); openInfoPop(+b.dataset.acinfo);
    }));
    const ok = $('announce-ok');
    if (ok) ok.addEventListener('click', () => { if (chosen != null) { playClick(); finishPrompt(E.i32resp(chosen)); } });
  };
  draw();
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
  // W-01: never leak the internal prompt name to the player. This
  // sheet is itself the failure surface — say so, and say what the
  // button does about it.
  sheetOpen('<div class="ttl">確認の表示に失敗しました</div><div class="sub">この確認は正しく表示できませんでした。自動で無難な答えを返して対戦を続けます。</div>' +
    '<div class="btnrow"><button class="bigbtn" id="fb-auto">自動で答えて続ける</button></div>');
  $('fb-auto').addEventListener('click', () => { playClick(); finishPrompt(E.botAnswer(prompt, state, DATA, E.makeBotMemory())); });
}
// ---------------------------------------------------------------- global taps
$('autopass').addEventListener('click', () => { playClick(); openDismissManager(); });
$('preview').addEventListener('click', () => { if (previewState) { playClick(); openCardInfo(previewState.code); } });
document.addEventListener('click', (ev) => {
  // B-10: the whole log strip is the history target — the 履歴
  // button, the previous-event text in the idle chain bar, and the
  // latest log line below it. The button alone is a 40x19 px
  // target; the strip is what the player actually sees as "the
  // log", and taps landing on its text went nowhere.
  if (ev.target.closest('#loghistbtn') || ev.target.closest('#logline') || ev.target.closest('#chainbar .prevlog')) { playClick(); openLogHistory(); return; }
  // preview follows the player's taps (hand cards always; field zones when
  // not placing) — it never consumes the tap, the handlers below still run
  const handEl = ev.target.closest('#hand .hcard');
  if (handEl && handEl.dataset.code) {
    // BU-02: state only the reason that is mechanically certain
    let reason = null;
    if (handEl.classList.contains('dim') && currentPrompt && currentPrompt.prompt.name === 'SELECT_BATTLECMD' && isMonster(+handEl.dataset.code))
      reason = 'バトルフェイズ中は通常召喚できません';
    // brushup round 2: a spent card-name activation limit is the
    // other mechanically certain reason a dimmed hand card can state
    if (!reason && handEl.classList.contains('dim')) reason = nameLimitReason(+handEl.dataset.code);
    setPreview(+handEl.dataset.code, null, reason);
  }
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
      renderPlaceHint();
      if (duelState) render(duelState);
      return;
    }
    // a zone the placement does not target is an INFO tap, not a
    // placement: show the card's public info in the resident
    // preview and leave the placement exactly as it was
    // (opponent-info round; boardCardAt hides opponent face-down).
    const hit = boardCardAt(key);
    if (hit) setPreview(hit.code, hit.ref);
    return;
  }
  if (zoneEl && !placeCtx && duelState) {
    const hit = boardCardAt(zoneEl.dataset.zone);
    if (hit) {
      // attack-block round: the persistent preview carries the
      // same certain reason the action sheet states — an own
      // monster with no offered 攻撃 in a live battle command.
      let reason = null;
      const { con: zcon, loc: zloc, seq: zseq } = hit.ref;
      if (zcon === HP && zloc === E.LOC.MZONE && currentPrompt && currentPrompt.prompt.name === 'SELECT_BATTLECMD' &&
          !(actionMap.get(zcon + ':' + zloc + ':' + zseq) || []).some(a => a.label === '攻撃')) {
        reason = attackBlockReason(hit.code, zcon, zloc, zseq);
      }
      setPreview(hit.code, hit.ref, reason);
    }
  }
  const actEl = ev.target.closest('[data-act]');
  // triage-#2: a tap that lands while no IDLE/BATTLE prompt is
  // live (the processing window after a resolution) is BUFFERED,
  // never silently dropped — the tile pulses so the tap visibly
  // landed, and uiCmd opens the sheet the moment the prompt
  // makes the key actionable. Not buffered while a sheet/dock
  // owns the screen (those taps belong to that UI).
  if (actEl && duelState && !currentPrompt && $('sheetwrap').className !== 'on' && $('dock').className !== 'on' && !placeCtx) {
    pendingTap = { key: actEl.dataset.act, at: Date.now() };
    playClick();
    try { actEl.animate([{ transform: 'scale(.93)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' }); } catch (e) {}
    return;
  }
  if (actEl && currentPrompt && (currentPrompt.prompt.name === 'SELECT_IDLECMD' || currentPrompt.prompt.name === 'SELECT_BATTLECMD')) {
    const key = actEl.dataset.act;
    if (actionMap.has(key)) { playClick(); openActionSheet(key); }
    else {
      // no offered actions: my face-up field monsters still open
      // the sheet as an info view, so an unusable effect can say
      // why instead of the tap going nowhere (Minerva item)
      const [con2, loc2, seq2] = key.split(':').map(Number);
      if (con2 === HP && loc2 === E.LOC.MZONE && duelState) {
        const c = duelState.players[con2].mzone[seq2];
        if (c && c.code != null && (c.pos & E.POS_FACEUP) !== 0) { playClick(); openActionSheet(key); }
      }
    }
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
  sheetOpenView('<div class="ttl">その他のアクション</div>' +
    menuActions.map((a, i) => '<button class="optbtn" data-menu="' + i + '">' + a.label + '</button>').join('') +
    // W-28: menu actions belong to the pending idle choice.
    '<div class="btnrow"><button class="bigbtn sub" id="sheet-cancel">選択に戻る</button></div>');
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
//   topbar 42 + opp field (pad 4 + pilebar 30 + 2 zone rows) + midbar 78
//   (chainbar 21 reserved + logline 15 + phasebar 34 + padding/borders 8)
//   + my field (2 zone rows + pilebar 30 + pad 4) + handbar extras 19
//   (who 11 + padding 8) + 4 zone-row margins 8  =  FIXED 215
//   plus 4 × slotH + handH + previewH.
//   (V3 stage 4: pile chips grew 21->28px for tap size (B-11) and
//   the handbar/margins gave the difference back; the strip grew
//   22->24px (B-15). The fit loop still verifies against the real
//   rendered bottom, so this constant only steers the first pass.)
// Slot: width W, image height round(W×1.22), +24 stats strip = slotH.
// Hand: width round(W×56/47), image round(handW×1.22), +24 stats strip.
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
const LAYOUT_FIXED = 215;
const LAYOUT_SAFETY = 8; // px kept free below the stack, always (round 3: 6 → 8)
let layoutInfo = null;
function layoutParts(W) {
  const imgH = Math.round(W * 1.22);
  const slotH = imgH + 24;
  const handW = Math.round(W * 56 / 47);
  const handH = Math.round(handW * 1.22) + 24;
  return { imgH, slotH, handW, handH, stack: LAYOUT_FIXED + 4 * slotH + handH };
}
function computeLayout(vwIn, vh) {
  const vw = Math.min(vwIn || 390, 430); // #app max-width
  // width cap: the widest row is the spell/trap row — 6 slots + 5 gaps of 4
  // + field padding 12 must fit the app width. All zones share this size.
  let W = Math.max(40, Math.floor((vw - 12 - 20) / 6));
  let p = layoutParts(W);
  while (p.stack > vh && W > 40) { W--; p = layoutParts(W); }
  // B-14: the detail preview is a DECIDED feature ("余れば詳細"),
  // and the old order starved it at every phone height — the base
  // stack fit, the leftover was <24px, and the preview never
  // existed in play. The preview is now funded BEFORE the hand
  // grows: tiles keep shrinking (to the 40px floor) until the
  // leftover can hold a usable preview (>=52px aims at the full
  // form; the loop stops at the tile floor, where the compact
  // form — name + stats, detail one tap away — still shows).
  while (vh - p.stack < 52 && W > 40) { W--; p = layoutParts(W); }
  // Slack distribution: preview first (up to a fully usable 56px), then the
  // hand grows up to 1.3× its standard height, then any rest to the preview.
  let leftover = Math.max(0, vh - p.stack);
  let pv = Math.min(leftover, 56); leftover -= pv;
  const handCap = Math.round(p.handH * 1.3);
  const grow = Math.min(leftover, Math.max(0, handCap - p.handH));
  const handH = p.handH + grow; leftover -= grow;
  pv += leftover;
  const pvShown = pv >= 20 ? pv : 0; // under 20px not even the compact one-row form (name + stats) fits; it stays as the dead band
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
  $('preview').className = info.pvShown > 0 ? (info.pvShown < 40 ? 'on compact' : 'on') : '';
  // stage 4: at the tile floor the B-15 strip type (9/10px) is
  // wider than the tile — the strip shrinks its type instead of
  // clipping digits (measureStripClip watches both axes now).
  $('app').classList.toggle('smalltiles', info.tileW < 44);
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
    if (el.scrollHeight > el.clientHeight + 1) { clipped++; continue; }
    // V3 stage 4: the horizontal axis counts too — at the 40px
    // tile floor a 4-digit line overflows SIDEWAYS (the round-4
    // check was vertical-only and certified it as fitting).
    for (const sp of el.querySelectorAll('span')) {
      if (sp.scrollWidth > sp.clientWidth + 1) { clipped++; break; }
    }
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
let previewState = null; // {code, con, loc, seq, sig, deckKey}
function setPreview(code, ref, reason) {
  if (code == null || !DATA || !DATA.cards[code]) return;
  // deck-scoped art: the instance's seat decides when a ref names
  // one; a bare code resolves by unique deck membership instead.
  const deckKey = ref && ref.con != null ? deckKeyOfSeat(ref.con) : deckKeyOfCode(code);
  previewState = { code, con: ref ? ref.con : null, loc: ref ? ref.loc : null, seq: ref ? ref.seq : null, sig: '', reason: reason || null, deckKey };
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
    // changed values are tinted (presentation 3-7): only the value that
    // differs from the printed one is coloured, so "what changed" reads off
    stats = 'ATK ' + (atk !== d.atk ? '<span class="mod">' + atk + '</span>' : atk) +
      '／DEF ' + (def !== d.def ? '<span class="mod">' + def + '</span>' : def);
  }
  // brushup round 2: in compact mode (short viewports) the strip
  // is one line tall and the stacked reason line is clipped away
  // by the fixed height — the reason rides the title line there
  // (and truncates before the name does). Taller strips keep the
  // stacked form.
  const compact = el.classList.contains('compact');
  const sig = previewState.code + '|' + stats + '|' + (card ? card.pos : '') + '|' + (card ? (card.materials || 0) : '') + '|' + (previewState.reason || '') + '|' + (compact ? 'c' : '') + '|' + (previewState.deckKey || '');
  if (sig === previewState.sig) return; // no DOM churn on unrelated re-renders
  previewState.sig = sig;
  el.innerHTML = '<div class="pv-art"' + artInline(previewState.code, false, previewState.deckKey) + '></div><div class="pv-body">' +
    '<div class="pv-top"><span class="pv-name' + kindCls(previewState.code) + '">' + cardName(previewState.code) + '</span>' +
    (stats ? '<span class="pv-stats">' + stats + '</span>' : '') +
    (compact && previewState.reason ? '<span class="pv-reason-inline">' + previewState.reason + '</span>' : '') + '</div>' +
    '<div class="pv-meta">' + cardMetaLine(previewState.code, card ? (card.materials || 0) : null) + '</div>' +
    (!compact && previewState.reason ? '<div class="pv-reason">' + previewState.reason + '</div>' : '') +
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
  // deck-select page navigation (pure DOM — wired before the data
  // load so the pages can be walked even on the failure path, whose
  // retry button lives on the deck page).
  $('deckpage').style.display = 'none';
  updateDeckSum();
  renderSavedDecks();
  $('todeck').addEventListener('click', () => { playClick(); $('start').style.display = 'none'; $('deckpage').style.display = 'flex'; });
  $('deckback').addEventListener('click', () => { playClick(); $('deckpage').style.display = 'none'; $('start').style.display = 'flex'; });
  // neuron import panel (Phase 1): pure DOM wiring here; the data
  // it needs (data.json + genesys-data.json) is fetched lazily by
  // the parse action itself.
  $('deckimport').addEventListener('click', () => { playClick(); $('neuronpanel').style.display = 'flex'; ensureGenesysData(); });
  $('neuronback').addEventListener('click', () => { playClick(); $('neuronpanel').style.display = 'none'; });
  $('neuronparse').addEventListener('click', () => { playClick(); neuronDoParse(); });
  $('neuronsave').addEventListener('click', () => {
    if (!neuronPending) return;
    playClick();
    const rec = neuronPending; neuronPending = null;
    neuronSaveRecord(rec);
    $('neuronpanel').style.display = 'none';
    $('neuronsave').style.display = 'none';
  });
  // pasting a share link (or a bare deck code) starts the import
  // by itself — the user asked for "paste the URL and it is done".
  $('neurontext').addEventListener('paste', (e) => {
    try {
      const t = (e.clipboardData || window.clipboardData).getData('text') || '';
      if (window.NeuronLib && t.trim().length <= 500 && (NeuronLib.extractImportUrl(t) || NeuronLib.isDeckCode(t)))
        setTimeout(() => neuronDoParse(), 60);
    } catch (err) {}
  });
  $('neuronopencode').addEventListener('click', () => {
    playClick();
    const code = $('neuroncode').value.trim();
    if (window.NeuronLib && NeuronLib.isDeckCode(code)) window.open(NeuronLib.deckCodeSearchUrl(code), '_blank');
    else $('neuroncode').focus();
  });
  try {
    DATA = await (await fetch('data.json')).json();
    // fxmap.json: which printed effect a desc index names. A failed
    // or foreign-shaped response (test stubs answer every fetch
    // with data.json) just leaves FXMAP empty — identification
    // degrades to full-text display, never to wrong numbers.
    try {
      const fm = await (await fetch('fxmap.json')).json();
      const k = Object.keys(fm || {})[0];
      if (fm && k && fm[k] && typeof fm[k].n === 'number') FXMAP = fm;
    } catch (e) { /* identification off, display unaffected */ }
    $('loadmsg').textContent = '準備完了（カード ' + Object.keys(DATA.cards).length + ' 種）';
    preloadCardArt([myDeckKey, opDeckKey]); // deck-select-time art preload (no blank/'?' surfaces)
    // A-03: the start button's state IS the load state — disabled
    // and labelled while loading, live only when a duel can start.
    const sb = $('startbtn'); sb.disabled = false; sb.textContent = 'デュエル開始';
    bootReady = true; refreshStartGate(); // a restored unplayable saved deck must not re-enable start
  } catch (e) {
    $('loadmsg').textContent = 'カードデータの読み込みに失敗しました。通信環境を確認して、もう一度お試しください。';
    const sb = $('startbtn'); sb.disabled = false; sb.textContent = '再読み込み';
    sb.addEventListener('click', () => location.reload());
    return;
  }
  wireSeg('seg-mydeck', (v) => { selectMyDeck(v); });
  wireSeg('seg-opdeck', (v) => { opDeckKey = v; preloadCardArt([myDeckKey, opDeckKey]); updateDeckSum(); });
  wireSeg('seg-first', (v) => { firstChoice = v; updateDeckSum(); });
  syncFxSegs(); // reflect any persisted round-B settings before wiring
  wireSeg('seg-cutin', (v) => { fxSettings.cutin = v === 'on'; fxSaveSettings(); });
  wireSeg('seg-resp', (v) => { fxSettings.resp = v; fxSaveSettings(); });
  $('fxbtn').addEventListener('click', () => { playClick(); openFxSettings(); });
  // R-SEL-2: while a selection sheet is up, the board can be
  // checked without answering anything — the sheet slides down
  // to a grab strip and the dim lifts; tapping again restores it.
  // C-20: view sheets can also be left by tapping the dimmed
  // backdrop or the x button — the same single exit as their
  // own close button. Prompt sheets ignore backdrop taps.
  $('sheetx').addEventListener('click', () => { playClick(); sheetClose(); });
  $('sheetwrap').addEventListener('click', (ev) => {
    if (ev.target === $('sheetwrap') && sheetKind === 'view') { playClick(); sheetClose(); }
    // opponent-info round: while a prompt sheet is peeked down,
    // the wrap still covers the board, so a backdrop tap is
    // forwarded to the card under the point as a read-only info
    // tap (peekBoardTap). It never reaches the phase/menu buttons
    // beneath — only card surfaces answer, and only with info.
    else if (ev.target === $('sheetwrap') && $('sheetwrap').classList.contains('peek')) peekBoardTap(ev.clientX, ev.clientY);
  });
  $('peekbtn').addEventListener('click', () => {
    playClick();
    const w = $('sheetwrap'); const on = w.classList.toggle('peek');
    $('peekbtn').textContent = on ? '選択に戻る' : '盤面を見る';
    syncPeekBar(); // BU-22: the answer band follows the peek state
  });
  // reflect the persisted audio preference in the switch at boot
  $('soundbtn').classList.toggle('on', audioOn);
  $('sndstate').textContent = audioOn ? 'オン' : 'オフ';
  $('soundbtn').addEventListener('click', () => {
    audioOn = !audioOn;
    saveAudioPref();
    // section 4: a switch shape + a state word, not a text button
    $('soundbtn').classList.toggle('on', audioOn);
    $('sndstate').textContent = audioOn ? 'オン' : 'オフ';
    if (!audioOn && bgmEl) { try { bgmEl.pause(); } catch (e) {} }
    if (audioOn) { playClick(); setBgmScene(bgmScene || 'start', true); }
  });
  $('startbtn').addEventListener('click', async () => {
    playClick();
    playSe('vs_start');
    preloadCardArt([myDeckKey, opDeckKey]); // belt-and-braces: the chosen decks' art is warm before the first render
    previewState = null; // preview restarts with the duel (default: first hand card)
    applyLayout(); // fit once to this viewport, then frozen for the whole duel
    layoutSettleArmed = true; layoutSettled = false; // round 3: one post-render settle, still inside the start sequence
    // Seat wiring (item 5): the core's first player is always seat 0, so a
    // second-player human takes seat 1 with the decks swapped.
    const humanFirst = firstChoice === 'first' ? true : firstChoice === 'second' ? false : Math.random() < 0.5;
    HP = humanFirst ? 0 : 1;
    const deckP0 = deckListOf(humanFirst ? myDeckKey : opDeckKey);
    const deckP1 = deckListOf(humanFirst ? opDeckKey : myDeckKey);
    // deck-scoped art (DECK_ART) resolves per seat from here on:
    // seat 0 plays deckP0's key, seat 1 plays deckP1's key.
    seatDeckKeys = [humanFirst ? myDeckKey : opDeckKey, humanFirst ? opDeckKey : myDeckKey];
    // A-01: the VS transition — matchup + first/second, ~0.9s,
    // no button (it advances on its own, as decided). It also
    // covers the engine-start wait, so the tap is never followed
    // by dead time (audit C-33).
    {
      $('vssub').innerHTML = deckDisplayName(myDeckKey) + ' vs ' + deckDisplayName(opDeckKey) + '<br>あなたは' + (humanFirst ? '先攻' : '後攻') + 'です';
      const vs = $('vsoverlay'); vs.classList.add('on');
      try {
        // DS-07 (brushup round 3): the curtain itself is NEVER
        // faded. An overlay-level opacity fade (0->1 over 220 ms)
        // made the opaque #070503 background translucent for the
        // whole fade, and the still-displayed start screen bled
        // through behind the VS text (reproduced in transition
        // frames at +218 ms / 620 and +226 ms / 700; opaque only
        // from ~+299 ms). The curtain's job is to cover, so it is
        // opaque from the first painted frame; only the contents
        // stage in (beams and VS text already animate themselves;
        // the matchup line gets the small fade the overlay had).
        vs.querySelector('.vss').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        vs.querySelector('.bl').animate([{ transform: 'translateX(-30%) rotate(9deg)', opacity: 0 }, { transform: 'translateX(38%) rotate(9deg)', opacity: 1, offset: .55 }, { transform: 'translateX(60%) rotate(9deg)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' });
        vs.querySelector('.br').animate([{ transform: 'translateX(30%) rotate(-9deg)', opacity: 0 }, { transform: 'translateX(-38%) rotate(-9deg)', opacity: 1, offset: .55 }, { transform: 'translateX(-60%) rotate(-9deg)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' });
        vs.querySelector('.vst').animate([{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, delay: 120, easing: 'cubic-bezier(.16,1.3,.3,1)' });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 950));
      vs.classList.remove('on');
    }
    dismissedChains = new Set();
    logHist = []; logPrev = []; // B-10 history restarts with the duel
    dlogPrev = []; histEntries = []; // detailed history restarts too
    pendingTap = null; // triage-#2: no buffered tap survives into a new duel
    monsterLock = null; // activation lock restarts with the duel (Minerva 3rd triage)
    monsterRevived = null; reviveArm = null; reviveBatch = 0; usedFxTurn = -1; usedFxByCode.clear(); usedFxSeen = new Set(); // pool-coverage trackers restart
    dismissedDuel = new Map();
    duelNoConfirm = new Set(); // C-27 suppression restarts with the duel
    confirmTurn = -1; confirmSeq = 0; // per-turn confirmation counter restarts with the duel
    pendingConfirms = []; // unshown card confirmations restart with the duel
    updateAutoPassChip();
    fxResetDuel(); // FX snapshot/layers restart with the duel (stale overlays must not survive)
    bgmWantedRank = -1; bgmSeenKeys.clear(); // BGM stage ladder restarts with the duel
    usedNamesDuel.clear(); gravePrev = null; gravePrevNulls = 0; graveStamps = []; // brushup round 2 trackers restart with the duel
    fieldPrev = null; summonMarks.clear(); // cannot-attack trackers restart with the duel
    setBgmScene('normal', true);
    $('start').style.display = 'none';
    $('deckpage').style.display = 'none';
    $('logline').textContent = '対戦を準備中…';
    duel = await createClientDuel(DATA, {
      seed: (Date.now() % 100000) + 1,
      pace: { bot: 620, botChain: 300, batch: 40 },
      deckP0, deckP1, humanTeam: HP,
      onLog: () => {},
      onUpdate: (state) => {
        if (duel) { try { duel.refreshFieldStats(); } catch (e) {} }
        const fxEvs = state.events ? state.events.slice() : []; // presentation queue: copied before drainSeEvents consumes it
        queueConfirmEvents(fxEvs); // MSG_CONFIRM_CARDS -> pending reveal sheet (see the confirm block)
        fxCaptureDom(); // pre-render hand geometry for the FX reflow (FLIP)
        drainSeEvents(state);
        trackUsedFx(state); // this turn's own activations, for cannot-activate reasons
        trackGraveArrivals(state); // own grave arrivals by turn, for the grave-sheet reason
        trackFieldSummons(fxEvs, state); // field arrivals by turn, for the cannot-attack reasons
        render(state);
        updateBgm(state);
        fxProcess(fxEvs, state); // presentation FX overlays (read-only; board geometry is final now)
        maybeSettleLayout(); // round 3: first render done, first prompt not yet delivered (engine order)
      },
      humanAnswerer: async (prompt, state) => { maybeSettleLayout(); render(state); await showPendingConfirms(); return uiAnswer(prompt, state); },
    });
    const stats = await duel.run();
    const st = duel.state;
    render(st);
    // V3 stage 3: the result waits for the finisher's result beat
    // (scene-local 2450 ms — redesign G: the wash's last paint is
    // at 2400 ms, so the gate sits 50 ms AFTER it is fully gone) —
    // the separation is by TIME inside the layer table, so the
    // result is never seen under an active wash (the round-B
    // defect; audit A-07 was the 2300-2400 ms tail overlap).
    const gateMs = fxFinisherGateMs();
    if (gateMs > 0) await new Promise(r => setTimeout(r, gateMs));
    setBgmScene(st.winner === HP ? 'win' : 'lose', true);
    // A-05: the result explains the ending in the player's words.
    // LP is a quantity that ends the duel AT 0 — a negative final
    // LP is a mid-calculation value, so it is clamped for display
    // and the overkill is written separately.
    const won = st.winner === HP;
    $('resultTitle').textContent = won ? '勝利！' : '敗北';
    const reason = st.winReason === 1
      ? (won ? '相手のLPが0になりました' : 'あなたのLPが0になりました')
      : st.winReason === 2
        ? (won ? '相手のデッキが尽きました' : 'あなたのデッキが尽きました')
        : (won ? '効果による勝利' : '効果による敗北');
    $('resultDetail').textContent = 'ターン ' + stats.turns + ' で決着 ― ' + reason;
    const myLp = st.players[HP].lp, opLp = st.players[1 - HP].lp;
    const over = !won && myLp < 0 ? '（' + (-myLp) + ' の超過ダメージ）' : (won && opLp < 0 ? '（' + (-opLp) + ' の超過ダメージ）' : '');
    $('resultSub').textContent = '最終LP 自分 ' + Math.max(0, myLp) + ' ― 相手 ' + Math.max(0, opLp) + over;
    $('result').style.display = 'flex';
    // V4-4: the result stands with a snap, sinking 10 px into place;
    // a gold bloom pulls a beat behind it (an element of the result
    // itself — the FX canvas sits under this overlay and its own
    // bloom there was occluded, verified on the R3 frame strip)
    fxAnim($('result'), [{ opacity: '0', transform: 'translateY(-10px)' }, { opacity: '1', transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.25,1)' });
    const rb = document.createElement('div');
    rb.style.cssText = 'position:absolute;left:50%;top:42%;width:300px;height:300px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(255,217,77,.5) 0%,rgba(255,217,77,.14) 45%,transparent 70%);pointer-events:none;';
    $('result').appendChild(rb);
    fxAnim(rb, [{ opacity: '0' }, { opacity: '1', offset: 0.3 }, { opacity: '0' }], { duration: 800, delay: 120, easing: 'ease-out' });
    fxKill(rb, 1000);
  });
  // A-06: the two exits say what they do. Rematch keeps the start
  // selections (decks, first/second, response mode, cut-in) and
  // goes straight back in; title is the full reset.
  $('againbtn').addEventListener('click', () => {
    try { sessionStorage.setItem('v3rematch', JSON.stringify({ my: myDeckKey, op: opDeckKey, first: firstChoice })); } catch (e) {}
    location.reload();
  });
  $('titlebtn').addEventListener('click', () => location.reload());
  // A-06 rematch restore: same settings, straight back in (the VS
  // transition still plays — it is part of starting a duel).
  try {
    const rm = sessionStorage.getItem('v3rematch');
    if (rm) {
      sessionStorage.removeItem('v3rematch');
      const cfg = JSON.parse(rm);
      const setSeg = (id, v) => { const el = $(id); if (!el || v == null) return; el.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.v === v)); };
      if (cfg.my) { myDeckKey = cfg.my; setSeg('seg-mydeck', cfg.my); if (SAVED_DECKS[cfg.my]) syncDeckSelection(); }
      if (cfg.op) { opDeckKey = cfg.op; setSeg('seg-opdeck', cfg.op); }
      if (cfg.first) { firstChoice = cfg.first; setSeg('seg-first', cfg.first); }
      updateDeckSum();
      $('startbtn').click();
    }
  } catch (e) {}
  // start-screen BGM begins on first tap anywhere (autoplay policy)
  document.addEventListener('pointerdown', function once() {
    setBgmScene('start', true);
    document.removeEventListener('pointerdown', once);
  });
})();
