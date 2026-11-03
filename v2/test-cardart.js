'use strict';
/* test-cardart.js — regression for per-card illustrations (decided
   2026-11-03: the user supplies an image per card, applied as each
   arrives; unlisted cards keep the shared placeholder art).
   Contract under test:
   - CARD_ART maps passcode -> art slug; files live in
     ../assets/card-art-<slug>-s.jpg (small surfaces) and
     ../assets/card-art-<slug>.jpg (big cut-in card).
   - Cropping rule (user, 2026-11-03): keep the TOP, cut from the
     bottom — artInline/artCss pin background-position to center top,
     and the delivered files are top-anchored crops.
   - Surfaces: board tile art (face-visible states only), hand,
     resident preview, selection-grid cards, FX ghosts, cut-in big
     cards. An opponent's face-down card must NEVER receive the art
     (information asymmetry — inline background-image would outrank
     the .back stylesheet rule, so the apply-side condition is the
     only guard).
   - Preload: both decks' listed art is warmed from deck-select
     time (boot + deck change + start click), so no surface flashes
     blank or '?'.
   - Deck-scoped overrides (user decision 2026-11-03): DECK_ART
     maps deck id -> passcode -> slug and wins over CARD_ART when
     a surface supplies the deck context of the card instance
     (the seat that owns it — seatDeckKeys, set at duel start).
     Entries: Mori (36745317) is 'mori-ishizu', Hana (62133026)
     is 'hana-ishizu' and Oka (9350312) is 'oka-ishizu' inside
     the Ishizu deck only; in any other deck context they resolve
     to their plain art. The 4th entry is the sisters' spell,
     《春化精の花冠》 (14108995, 14th delivery): plain art 'kakan'
     (the forest painting) in CARD_ART, 'kakan-ishizu' (the
     Egyptian variant) in DECK_ART under ishizu. The opponent
     face-down rule binds the overrides exactly like the base art.
   Method: boot the real client in jsdom (harness as test-setvis),
   paint a fabricated board through the client's own render() and
   assert the DOM contract in one synchronous eval. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const MUDORA = 99937011, AGIDO = 62320425, KELBEK = 25926710, KELDO = 63542003, ZOLGA = 31525442, CARDAN = 86605515, SPHINX = 46148485, TAIYOU = 38699854, TSUKI = 14087893, CHAOSPOD = 79106360, OKA = 9350312, HANA = 62133026, MORI = 36745317, KAKAN = 14108995, CARBON = 15079028;
// The unlisted exemplar moved Zolga -> Sphinx (5th delivery) ->
// Mori (after the 7th) -> Carbon (after the 13th), and Carbon
// gained art in the 15th delivery, so the role now sits with
// 《生きる偲びのシルキィ》 55702233: a real Ishizu main-deck
// monster (x2) with no individual art, usable on every fallback
// surface (tile / hand / preview / ghost).
const UNLISTED = 55702233;

// ---- delivered art files (existence + top-anchored dimensions) ----
for (const [f, w, h] of [['card-art-mudora-s.jpg', 320, 320], ['card-art-mudora.jpg', 640, 882],
                         ['card-art-agido-s.jpg', 320, 320], ['card-art-agido.jpg', 640, 882],
                         ['card-art-kelbek-s.jpg', 320, 320], ['card-art-kelbek.jpg', 640, 882],
                         ['card-art-keldo-s.jpg', 320, 320], ['card-art-keldo.jpg', 640, 882],
                         ['card-art-zolga-s.jpg', 320, 320], ['card-art-zolga.jpg', 640, 882],
                         ['card-art-cardan-s.jpg', 320, 320], ['card-art-cardan.jpg', 640, 882],
                         ['card-art-sphinx-s.jpg', 320, 320], ['card-art-sphinx.jpg', 640, 882],
                         ['card-art-taiyou-s.jpg', 320, 320], ['card-art-taiyou.jpg', 640, 882],
                         ['card-art-tsuki-s.jpg', 320, 320], ['card-art-tsuki.jpg', 640, 882],
                         ['card-art-chaospod-s.jpg', 320, 320], ['card-art-chaospod.jpg', 640, 882],
                         ['card-art-oka-s.jpg', 320, 320], ['card-art-oka.jpg', 640, 882],
                         ['card-art-hana-s.jpg', 320, 320], ['card-art-hana.jpg', 640, 882],
                         ['card-art-mori-s.jpg', 320, 320], ['card-art-mori.jpg', 640, 882],
                         ['card-art-mori-ishizu-s.jpg', 320, 320], ['card-art-mori-ishizu.jpg', 640, 882],
                         ['card-art-hana-ishizu-s.jpg', 320, 320], ['card-art-hana-ishizu.jpg', 640, 882],
                         ['card-art-oka-ishizu-s.jpg', 320, 320], ['card-art-oka-ishizu.jpg', 640, 882],
                         ['card-art-kakan-s.jpg', 320, 320], ['card-art-kakan.jpg', 640, 882],
                         ['card-art-kakan-ishizu-s.jpg', 320, 320], ['card-art-kakan-ishizu.jpg', 640, 882],
                         ['card-art-carbon-s.jpg', 320, 320], ['card-art-carbon.jpg', 640, 882]]) {
  const p = path.join(V2, '..', 'assets', f);
  ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'CA0: ' + f + ' delivered (>10KB)');
}
ok(data.decks.ishizu.main.filter(c => c === MUDORA).length === 3, 'CA0b: the Ishizu deck runs 3 copies of Mudora');
ok(data.decks.ishizu.main.filter(c => c === AGIDO).length === 0 &&
   data.decks.ishizu.main.filter(c => c === 16135253).length === 1,
  'CA0c: recipe v11 — the deck runs the CLASSIC Agido (16135253) x1; the user art keyed to Ancient Guard Agido (62320425) no longer matches a deck card and stays dormant in CARD_ART until the user rules on it');
ok(data.decks.ishizu.main.filter(c => c === KELBEK).length === 1, 'CA0d: the Ishizu deck runs 1 copy of Kelbek');
ok(data.decks.ishizu.main.filter(c => c === KELDO).length === 3, 'CA0e: the Ishizu deck runs 3 copies of Keldo');
ok(data.decks.ishizu.main.filter(c => c === ZOLGA).length === 1, 'CA0f: the Ishizu deck runs 1 copy of Zolga');
ok(data.decks.ishizu.main.filter(c => c === CARDAN).length === 3, 'CA0g: the Ishizu deck runs 3 copies of Cardan');
ok(data.decks.ishizu.main.filter(c => c === SPHINX).length === 1, 'CA0h: the Ishizu deck runs 1 copy of Sphinx');
ok(data.decks.ishizu.main.filter(c => c === TAIYOU).length === 1, 'CA0i: the Ishizu deck runs 1 copy of Taiyou');
ok(data.decks.ishizu.main.filter(c => c === TSUKI).length === 1, 'CA0j: the Ishizu deck runs 1 copy of Tsuki');
ok(data.decks.ishizu.main.filter(c => c === CHAOSPOD).length === 2, 'CA0k: the Ishizu deck runs 2 copies of Chaos Pod');
ok(data.decks.ishizu.main.filter(c => c === OKA).length === 1, 'CA0l: the Ishizu deck runs 1 copy of Oka');
ok(data.decks.ishizu.main.filter(c => c === HANA).length === 2, 'CA0m: the Ishizu deck runs 2 copies of Hana');
ok(data.decks.ishizu.main.filter(c => c === MORI).length === 3, 'CA0n: the Ishizu deck runs 3 copies of Mori');
ok(data.decks.ishizu.main.filter(c => c === UNLISTED).length === 2, 'CA0o: the Ishizu deck runs 2 copies of the unlisted exemplar (Shilkey)');
ok(data.decks.ishizu.main.filter(c => c === CARBON).length === 3, 'CA0p: the Ishizu deck runs 3 copies of Carbon');
ok(data.decks.ishizu.main.filter(c => c === KAKAN).length === 1, 'CA0q: the Ishizu deck runs 1 copy of Kakan (Vernusylph Flower Crown)');
ok(!data.decks.gg.main.includes(KAKAN) && !data.decks.gg.extra.includes(KAKAN), 'CA0r: the GG deck does NOT run Kakan (code-only surfaces resolve its deck membership unambiguously to Ishizu)');

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CA1: client boots');

  // ---- helper contract (pure, synchronous) ----
  const helpers = window.eval(`(() => ({
    slug: CARD_ART[${MUDORA}],
    small: cardArtFile(${MUDORA}, false),
    big: cardArtFile(${MUDORA}, true),
    inline: artInline(${MUDORA}),
    inlineBig: artInline(${MUDORA}, true),
    css: artCss(${MUDORA}),
    unlistedInline: artInline(${UNLISTED}),
    unlistedFile: cardArtFile(${UNLISTED}, false),
    nullInline: artInline(null),
    preloaded: [...artPreloaded],
    agidoSlug: CARD_ART[${AGIDO}],
    agidoInline: artInline(${AGIDO}),
    kelbekSlug: CARD_ART[${KELBEK}],
    kelbekInline: artInline(${KELBEK}),
    keldoSlug: CARD_ART[${KELDO}],
    keldoInline: artInline(${KELDO}),
    zolgaSlug: CARD_ART[${ZOLGA}],
    zolgaInline: artInline(${ZOLGA}),
    cardanSlug: CARD_ART[${CARDAN}],
    cardanInline: artInline(${CARDAN}),
    sphinxSlug: CARD_ART[${SPHINX}],
    sphinxInline: artInline(${SPHINX}),
    taiyouSlug: CARD_ART[${TAIYOU}],
    taiyouInline: artInline(${TAIYOU}),
    tsukiSlug: CARD_ART[${TSUKI}],
    tsukiInline: artInline(${TSUKI}),
    chaoospodSlug: CARD_ART[${CHAOSPOD}],
    chaoospodInline: artInline(${CHAOSPOD}),
    okaSlug: CARD_ART[${OKA}],
    okaInline: artInline(${OKA}),
    hanaSlug: CARD_ART[${HANA}],
    hanaInline: artInline(${HANA}),
    moriSlug: CARD_ART[${MORI}],
    moriInline: artInline(${MORI}),
    deckArtMori: DECK_ART.ishizu && DECK_ART.ishizu[${MORI}],
    moriIshizuSmall: cardArtFile(${MORI}, false, 'ishizu'),
    moriIshizuBig: cardArtFile(${MORI}, true, 'ishizu'),
    moriIshizuInline: artInline(${MORI}, false, 'ishizu'),
    moriGg: cardArtFile(${MORI}, false, 'gg'),
    moriNoCtx: cardArtFile(${MORI}, false),
    mudoraIshizu: cardArtFile(${MUDORA}, false, 'ishizu'),
    deckArtHana: DECK_ART.ishizu && DECK_ART.ishizu[${HANA}],
    hanaIshizuSmall: cardArtFile(${HANA}, false, 'ishizu'),
    hanaIshizuBig: cardArtFile(${HANA}, true, 'ishizu'),
    hanaGg: cardArtFile(${HANA}, false, 'gg'),
    deckArtOka: DECK_ART.ishizu && DECK_ART.ishizu[${OKA}],
    okaIshizuSmall: cardArtFile(${OKA}, false, 'ishizu'),
    okaIshizuBig: cardArtFile(${OKA}, true, 'ishizu'),
    okaGg: cardArtFile(${OKA}, false, 'gg'),
    kakanSlug: CARD_ART[${KAKAN}],
    kakanInline: artInline(${KAKAN}),
    deckArtKakan: DECK_ART.ishizu && DECK_ART.ishizu[${KAKAN}],
    kakanIshizuSmall: cardArtFile(${KAKAN}, false, 'ishizu'),
    kakanIshizuBig: cardArtFile(${KAKAN}, true, 'ishizu'),
    kakanIshizuInline: artInline(${KAKAN}, false, 'ishizu'),
    kakanGg: cardArtFile(${KAKAN}, false, 'gg'),
    carbonSlug: CARD_ART[${CARBON}],
    carbonInline: artInline(${CARBON}),
  }))()`);
  ok(helpers.agidoSlug === 'agido' && helpers.agidoInline.includes('card-art-agido-s.jpg') && helpers.agidoInline.includes('background-position:center top'), 'CA7b: Agido maps and stamps like Mudora');
  ok(helpers.kelbekSlug === 'kelbek' && helpers.kelbekInline.includes('card-art-kelbek-s.jpg') && helpers.kelbekInline.includes('background-position:center top'), 'CA7d: Kelbek maps and stamps like the others');
  ok(helpers.keldoSlug === 'keldo' && helpers.keldoInline.includes('card-art-keldo-s.jpg') && helpers.keldoInline.includes('background-position:center top'), 'CA7f: Keldo maps and stamps like the others');
  ok(helpers.zolgaSlug === 'zolga' && helpers.zolgaInline.includes('card-art-zolga-s.jpg') && helpers.zolgaInline.includes('background-position:center top'), 'CA7h: Zolga maps and stamps like the others');
  ok(helpers.cardanSlug === 'cardan' && helpers.cardanInline.includes('card-art-cardan-s.jpg') && helpers.cardanInline.includes('background-position:center top'), 'CA7j: Cardan maps and stamps like the others');
  ok(helpers.sphinxSlug === 'sphinx' && helpers.sphinxInline.includes('card-art-sphinx-s.jpg') && helpers.sphinxInline.includes('background-position:center top'), 'CA7l: Sphinx maps and stamps like the others');
  ok(helpers.taiyouSlug === 'taiyou' && helpers.taiyouInline.includes('card-art-taiyou-s.jpg') && helpers.taiyouInline.includes('background-position:center top'), 'CA7n: Taiyou maps and stamps like the others');
  ok(helpers.tsukiSlug === 'tsuki' && helpers.tsukiInline.includes('card-art-tsuki-s.jpg') && helpers.tsukiInline.includes('background-position:center top'), 'CA7p: Tsuki maps and stamps like the others');
  ok(helpers.chaoospodSlug === 'chaospod' && helpers.chaoospodInline.includes('card-art-chaospod-s.jpg') && helpers.chaoospodInline.includes('background-position:center top'), 'CA7r: Chaos Pod maps and stamps like the others');
  ok(helpers.okaSlug === 'oka' && helpers.okaInline.includes('card-art-oka-s.jpg') && helpers.okaInline.includes('background-position:center top'), 'CA7t: Oka maps and stamps like the others');
  ok(helpers.hanaSlug === 'hana' && helpers.hanaInline.includes('card-art-hana-s.jpg') && helpers.hanaInline.includes('background-position:center top'), 'CA7u: Hana maps and stamps like the others');
  ok(helpers.moriSlug === 'mori' && helpers.moriInline.includes('card-art-mori-s.jpg') && helpers.moriInline.includes('background-position:center top'), 'CA7v: Mori maps and stamps like the others');
  ok(helpers.slug === 'mudora', 'CA2: CARD_ART maps Mudora -> mudora');
  ok(helpers.small === '../assets/card-art-mudora-s.jpg' && helpers.big === '../assets/card-art-mudora.jpg', 'CA3: art files resolve (small + big)');
  ok(helpers.inline.includes('card-art-mudora-s.jpg') && helpers.inline.includes('background-position:center top'), 'CA4: artInline pins the top (crop rule: keep top, cut bottom)');
  ok(helpers.inlineBig.includes('card-art-mudora.jpg') && !helpers.inlineBig.includes('-s.jpg'), 'CA5: big surface uses the big file');
  ok(helpers.unlistedInline === '' && helpers.unlistedFile === null && helpers.nullInline === '', 'CA6: unlisted/null codes fall back (empty = placeholder CSS untouched)');
  ok(helpers.preloaded.includes('../assets/card-art-mudora-s.jpg') && helpers.preloaded.includes('../assets/card-art-mudora.jpg'), 'CA7: boot preloads both sizes for the default decks');
  ok(!helpers.preloaded.includes('../assets/card-art-agido-s.jpg') && !helpers.preloaded.includes('../assets/card-art-agido.jpg'),
    'CA7c: recipe v11 — Agido (62320425) left the decks, so its art is NOT preloaded (dormant entry; preload follows deck membership)');
  ok(helpers.preloaded.includes('../assets/card-art-kelbek-s.jpg') && helpers.preloaded.includes('../assets/card-art-kelbek.jpg'), 'CA7e: boot preloads Kelbek too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-keldo-s.jpg') && helpers.preloaded.includes('../assets/card-art-keldo.jpg'), 'CA7g: boot preloads Keldo too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-zolga-s.jpg') && helpers.preloaded.includes('../assets/card-art-zolga.jpg'), 'CA7i: boot preloads Zolga too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-cardan-s.jpg') && helpers.preloaded.includes('../assets/card-art-cardan.jpg'), 'CA7k: boot preloads Cardan too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-sphinx-s.jpg') && helpers.preloaded.includes('../assets/card-art-sphinx.jpg'), 'CA7m: boot preloads Sphinx too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-taiyou-s.jpg') && helpers.preloaded.includes('../assets/card-art-taiyou.jpg'), 'CA7o: boot preloads Taiyou too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-tsuki-s.jpg') && helpers.preloaded.includes('../assets/card-art-tsuki.jpg'), 'CA7q: boot preloads Tsuki too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-chaospod-s.jpg') && helpers.preloaded.includes('../assets/card-art-chaospod.jpg'), 'CA7s: boot preloads Chaos Pod too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-oka-s.jpg') && helpers.preloaded.includes('../assets/card-art-oka.jpg'), 'CA7w: boot preloads Oka too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-hana-s.jpg') && helpers.preloaded.includes('../assets/card-art-hana.jpg'), 'CA7x: boot preloads Hana too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-mori-s.jpg') && helpers.preloaded.includes('../assets/card-art-mori.jpg'), 'CA7y: boot preloads Mori too (same deck)');
  ok(helpers.deckArtMori === 'mori-ishizu', 'CA7z1: DECK_ART registers Mori -> mori-ishizu for the Ishizu deck only');
  ok(helpers.moriIshizuSmall === '../assets/card-art-mori-ishizu-s.jpg' && helpers.moriIshizuBig === '../assets/card-art-mori-ishizu.jpg' && helpers.moriIshizuInline.includes('card-art-mori-ishizu-s.jpg'), 'CA7z2: Ishizu context resolves Mori to the Egyptian art (small + big)');
  ok(helpers.moriGg === '../assets/card-art-mori-s.jpg' && helpers.moriNoCtx === '../assets/card-art-mori-s.jpg', 'CA7z3: GG / no context resolves Mori to the plain art (override is deck-scoped, not global)');
  ok(helpers.mudoraIshizu === '../assets/card-art-mudora-s.jpg', 'CA7z4: cards without an override keep their base art in Ishizu context');
  ok(helpers.preloaded.includes('../assets/card-art-mori-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-mori-ishizu.jpg'), 'CA7z6: boot preloads the deck-scoped Mori art too (Ishizu is a selected deck)');
  ok(helpers.deckArtHana === 'hana-ishizu', 'CA7z7: DECK_ART registers Hana -> hana-ishizu for the Ishizu deck (2nd entry, same mechanism)');
  ok(helpers.hanaIshizuSmall === '../assets/card-art-hana-ishizu-s.jpg' && helpers.hanaIshizuBig === '../assets/card-art-hana-ishizu.jpg', 'CA7z8: Ishizu context resolves Hana to the Egyptian art (small + big)');
  ok(helpers.hanaGg === '../assets/card-art-hana-s.jpg', 'CA7z9: GG context resolves Hana to the plain art');
  ok(helpers.preloaded.includes('../assets/card-art-hana-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-hana-ishizu.jpg'), 'CA7z10: boot preloads the deck-scoped Hana art too');
  ok(helpers.deckArtOka === 'oka-ishizu', 'CA7z11: DECK_ART registers Oka -> oka-ishizu for the Ishizu deck (3rd entry — the sisters are complete)');
  ok(helpers.okaIshizuSmall === '../assets/card-art-oka-ishizu-s.jpg' && helpers.okaIshizuBig === '../assets/card-art-oka-ishizu.jpg', 'CA7z12: Ishizu context resolves Oka to the Egyptian art (small + big)');
  ok(helpers.okaGg === '../assets/card-art-oka-s.jpg', 'CA7z13: GG context resolves Oka to the plain art');
  ok(helpers.preloaded.includes('../assets/card-art-oka-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-oka-ishizu.jpg'), 'CA7z14: boot preloads the deck-scoped Oka art too');
  ok(helpers.carbonSlug === 'carbon' && helpers.carbonInline.includes('card-art-carbon-s.jpg') && helpers.carbonInline.includes('background-position:center top'), 'CA7z15: Carbon maps and stamps like the others (15th delivery)');
  ok(helpers.preloaded.includes('../assets/card-art-carbon-s.jpg') && helpers.preloaded.includes('../assets/card-art-carbon.jpg'), 'CA7z16: boot preloads Carbon too (same deck)');
  ok(helpers.kakanSlug === 'kakan' && helpers.kakanInline.includes('card-art-kakan-s.jpg') && helpers.kakanInline.includes('background-position:center top'), 'CA7aa: Kakan maps and stamps like the others (plain art = the forest painting)');
  ok(helpers.preloaded.includes('../assets/card-art-kakan-s.jpg') && helpers.preloaded.includes('../assets/card-art-kakan.jpg'), 'CA7ab: boot preloads Kakan too (same deck)');
  ok(helpers.deckArtKakan === 'kakan-ishizu', 'CA7z17: DECK_ART registers Kakan -> kakan-ishizu for the Ishizu deck (4th entry, first SPELL with an override)');
  ok(helpers.kakanIshizuSmall === '../assets/card-art-kakan-ishizu-s.jpg' && helpers.kakanIshizuBig === '../assets/card-art-kakan-ishizu.jpg' && helpers.kakanIshizuInline.includes('card-art-kakan-ishizu-s.jpg'), 'CA7z18: Ishizu context resolves Kakan to the Egyptian art (small + big)');
  ok(helpers.kakanGg === '../assets/card-art-kakan-s.jpg', 'CA7z19: GG context resolves Kakan to the plain forest art');
  ok(helpers.preloaded.includes('../assets/card-art-kakan-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-kakan-ishizu.jpg'), 'CA7z20: boot preloads the deck-scoped Kakan art too');

  doc.getElementById('startbtn').click();
  for (let i = 0; i < 120 && doc.querySelectorAll('.slot').length < 10; i++)
    await new Promise(r => setTimeout(r, 50));
  const seatDecks = window.eval(`seatDeckKeys.slice()`);
  ok(seatDecks[0] === 'ishizu' && seatDecks[1] === 'gg', 'CA7z5: duel start records each seat’s deck key (seat 0 = Ishizu, seat 1 = GG by default)');

  // ---- fabricated board through the client's own render() ----
  const res = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MUDORA}, 0x1);  // own face-up ATK Mudora
      b.players[0].mzone[1] = mon(${MUDORA}, 0x4);  // own face-up DEF Mudora (2nd copy)
      b.players[0].mzone[2] = mon(${UNLISTED}, 0x1); // own face-up unlisted exemplar (no art)
      b.players[0].mzone[3] = mon(${KELDO}, 0x1);   // own face-up Keldo (4th delivery; the 2nd-delivery Agido left the pool in recipe v11, so it can no longer be fabricated from DATA)
      b.players[0].mzone[4] = mon(${KELBEK}, 0x1);  // own face-up Kelbek (3rd delivery)
      b.players[1].mzone[0] = mon(${MUDORA}, 0x1);  // opp face-up Mudora (public: art shows)
      b.players[1].mzone[1] = mon(${MUDORA}, 0x8);  // opp face-down DEF Mudora (MUST stay hidden)
      b.players[1].mzone[2] = mon(${KELDO}, 0x1);   // opp face-up Keldo (4th delivery; own row is full)
      b.players[1].mzone[3] = mon(${ZOLGA}, 0x1);   // opp face-up Zolga (5th delivery)
      b.players[1].mzone[4] = mon(${CARDAN}, 0x1);  // opp face-up Cardan (6th delivery)
      b.players[0].hand = [{ code: ${MUDORA} }, { code: ${UNLISTED} }, { code: ${KELDO} }, { code: ${ZOLGA} }, { code: ${CARDAN} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${MUDORA}, null);
      const pvMudora = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${ZOLGA}, null);
      const pvZolga = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${UNLISTED}, null);
      const pvUnlisted = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      const ghost = fxGhostEl(${MUDORA}, false, 40, 55);
      const ghostBack = fxGhostEl(${MUDORA}, true, 40, 55);
      const ghostUnlisted = fxGhostEl(${UNLISTED}, false, 40, 55);
      return {
        ownAtk: artOf('0:4:0'), ownDef: artOf('0:4:1'), ownUnlisted: artOf('0:4:2'), ownAgido: artOf('0:4:3'), ownKelbek: artOf('0:4:4'),
        oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), oppKeldo: artOf('1:4:2'), oppZolga: artOf('1:4:3'), oppCardan: artOf('1:4:4'),
        handImgs, pvMudora, pvZolga, pvUnlisted,
        ghost: ghost.style.backgroundImage || '', ghostPos: ghost.style.backgroundPosition || '',
        ghostBack: ghostBack.style.backgroundImage || '', ghostUnlisted: ghostUnlisted.style.backgroundImage || '',
      };
    })()
  `);
  ok(res.ownAtk !== null && res.ownDef !== null && res.oppDown !== null, 'CA8: non-vacuity — fabricated tiles rendered');
  ok(res.ownAtk.includes('card-art-mudora-s.jpg'), 'CA9: own face-up Mudora tile shows the individual art');
  ok(res.ownDef.includes('card-art-mudora-s.jpg'), 'CA10: every copy is covered (2nd Mudora, face-up DEF)');
  ok(res.ownUnlisted === '', 'CA11: unlisted card tile keeps the placeholder (no inline art)');
  ok(res.ownAgido !== null && res.ownAgido.includes('card-art-keldo-s.jpg'), 'CA11b: the fourth tile (Keldo) shows its own art (slug, not Mudora’s)');
  ok(res.ownKelbek !== null && res.ownKelbek.includes('card-art-kelbek-s.jpg'), 'CA11c: Kelbek tile shows its own art');
  ok(res.oppKeldo !== null && res.oppKeldo.includes('card-art-keldo-s.jpg'), 'CA11d: Keldo tile shows its own art');
  ok(res.oppZolga !== null && res.oppZolga.includes('card-art-zolga-s.jpg'), 'CA11e: Zolga tile shows its own art');
  ok(res.oppCardan !== null && res.oppCardan.includes('card-art-cardan-s.jpg'), 'CA11f: Cardan tile shows its own art');
  ok(res.oppUp.includes('card-art-mudora-s.jpg'), 'CA12: opponent face-up Mudora shows the art (public information)');
  ok(res.oppDown === '' && !String(res.oppDown).includes('mudora'), 'CA13: opponent FACE-DOWN Mudora gets NO art (asymmetry / no leak)');
  const hMudora = res.handImgs.find(h => h.code === String(MUDORA));
  const hUnlisted = res.handImgs.find(h => h.code === String(UNLISTED));
  ok(!!hMudora && hMudora.style.includes('card-art-mudora-s.jpg'), 'CA14: hand Mudora shows the art');
  const hKeldo = res.handImgs.find(h => h.code === String(KELDO));
  ok(!!hKeldo && hKeldo.style.includes('card-art-keldo-s.jpg'), 'CA14b: hand Keldo shows the art');
  const hZolga = res.handImgs.find(h => h.code === String(ZOLGA));
  ok(!!hZolga && hZolga.style.includes('card-art-zolga-s.jpg'), 'CA14c: hand Zolga shows the art');
  const hCardan = res.handImgs.find(h => h.code === String(CARDAN));
  ok(!!hCardan && hCardan.style.includes('card-art-cardan-s.jpg'), 'CA14d: hand Cardan shows the art');
  ok(!!hUnlisted && hUnlisted.style === '', 'CA15: hand unlisted card keeps the placeholder');
  ok(res.pvMudora.includes('card-art-mudora-s.jpg'), 'CA16: resident preview shows the art for Mudora');
  ok(res.pvZolga.includes('card-art-zolga-s.jpg'), 'CA16b: resident preview shows the art for Zolga');
  ok(res.pvUnlisted === '', 'CA17: resident preview falls back for unlisted cards');
  ok(res.ghost.includes('card-art-mudora-s.jpg') && res.ghostPos.includes('top'), 'CA18: face-up FX ghost carries the art, top-pinned');
  ok(res.ghostBack === '' && res.ghostUnlisted === '', 'CA19: face-down and unlisted ghosts get no art');

  // ---- Sphinx board (7th delivery): both rows above are full, so
  // she gets her own fabricated board — face-up tile + hand +
  // preview carry the art, and her own face-down tile on the
  // opponent's side must NOT (she is a keycard; the asymmetry
  // contract applies to her exactly like the others) ----
  const res2 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${SPHINX}, 0x1);  // own face-up ATK Sphinx
      b.players[0].mzone[1] = mon(${CHAOSPOD}, 0x1); // own face-up ATK Chaos Pod (10th delivery, same board)
      b.players[1].mzone[0] = mon(${SPHINX}, 0x8);  // opp face-down DEF Sphinx (MUST stay hidden)
      b.players[0].hand = [{ code: ${SPHINX} }, { code: ${CHAOSPOD} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${SPHINX}"] .himg');
      const hPod = document.querySelector('#hand .hcard[data-code="${CHAOSPOD}"] .himg');
      setPreview(${SPHINX}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${CHAOSPOD}, null);
      const pvPod = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), ownPod: artOf('0:4:1'), oppDown: artOf('1:4:0'), hand: h ? (h.getAttribute('style') || '') : null, handPod: hPod ? (hPod.getAttribute('style') || '') : null, pv, pvPod };
    })()
  `);
  ok(res2.ownUp !== null && res2.oppDown !== null, 'CA20: non-vacuity — Sphinx board rendered');
  ok(res2.ownUp.includes('card-art-sphinx-s.jpg'), 'CA11g: Sphinx tile shows its own art');
  ok(res2.oppDown === '' && !String(res2.oppDown).includes('sphinx'), 'CA13b: opponent FACE-DOWN Sphinx gets NO art (asymmetry / no leak)');
  ok(res2.hand !== null && res2.hand.includes('card-art-sphinx-s.jpg'), 'CA14e: hand Sphinx shows the art');
  ok(res2.pv.includes('card-art-sphinx-s.jpg'), 'CA16c: resident preview shows the art for Sphinx');
  ok(res2.ownPod !== null && res2.ownPod.includes('card-art-chaospod-s.jpg'), 'CA11j: Chaos Pod tile shows its own art');
  ok(res2.handPod !== null && res2.handPod.includes('card-art-chaospod-s.jpg'), 'CA14h: hand Chaos Pod shows the art');
  ok(res2.pvPod.includes('card-art-chaospod-s.jpg'), 'CA16f: resident preview shows the art for Chaos Pod');

  // ---- Books board (8th/9th deliveries — the first SPELLS with
  // art): surfaces are the S/T zone, the hand and the preview.
  // Own face-up S/T shows the art; own SET S/T carries the art
  // UNDER the setown veil (the ghost the owner reads); opponent
  // set S/T gets NO art and NO veil (asymmetry, as ever) ----
  const res3 = window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${TAIYOU}, 0xa);  // own SET Taiyou (veil ghost)
      b.players[0].szone[1] = st(${TSUKI}, 0x5);   // own face-up Tsuki
      b.players[1].szone[0] = st(${TSUKI}, 0xa);   // opp SET Tsuki (MUST stay hidden)
      b.players[0].hand = [{ code: ${TAIYOU} }, { code: ${TSUKI} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${TAIYOU}, null);
      const pvTaiyou = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${TSUKI}, null);
      const pvTsuki = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownSetTaiyou: tileOf('0:8:0'), ownUpTsuki: tileOf('0:8:1'), oppSetTsuki: tileOf('1:8:0'), handImgs, pvTaiyou, pvTsuki };
    })()
  `);
  ok(res3.ownSetTaiyou !== null && res3.ownUpTsuki !== null && res3.oppSetTsuki !== null, 'CA21: non-vacuity — books board rendered');
  ok(res3.ownUpTsuki.art !== null && res3.ownUpTsuki.art.includes('card-art-tsuki-s.jpg') && !res3.ownUpTsuki.veil, 'CA11h: own face-up Tsuki S/T tile shows its own art');
  ok(res3.ownSetTaiyou.art !== null && res3.ownSetTaiyou.art.includes('card-art-taiyou-s.jpg') && res3.ownSetTaiyou.veil && res3.ownSetTaiyou.cls.split(/\s+/).includes('setown'), 'CA11i: own SET Taiyou carries its art under the setown veil (owner ghost)');
  ok(res3.oppSetTsuki.art === '' && !res3.oppSetTsuki.veil && !String(res3.oppSetTsuki.art).includes('tsuki'), 'CA13c: opponent SET Tsuki gets NO art and NO veil (asymmetry / no leak)');
  const hTaiyou = res3.handImgs.find(h => h.code === String(TAIYOU));
  const hTsuki = res3.handImgs.find(h => h.code === String(TSUKI));
  ok(!!hTaiyou && hTaiyou.style.includes('card-art-taiyou-s.jpg'), 'CA14f: hand Taiyou shows the art');
  ok(!!hTsuki && hTsuki.style.includes('card-art-tsuki-s.jpg'), 'CA14g: hand Tsuki shows the art');
  ok(res3.pvTaiyou.includes('card-art-taiyou-s.jpg'), 'CA16d: resident preview shows the art for Taiyou');
  ok(res3.pvTsuki.includes('card-art-tsuki-s.jpg'), 'CA16e: resident preview shows the art for Tsuki');

  // ---- Vernusylph board (11th-13th deliveries — the three
  // sisters): own face-up tiles, hand and preview carry each
  // sister's own art (mind the mapping: Oka = the pink-haired
  // fairy, Hana = the white rabbit, Mori = the forest boy), and
  // an opponent face-down Mori must NOT (asymmetry). Seat 0 is
  // playing the Ishizu deck in this boot, so Mori's surfaces
  // carry her DECK-SCOPED Egyptian art (mori-ishizu); the
  // flipped-seat fixture below pins the non-Ishizu fallback ----
  const res4 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${OKA}, 0x1);   // own face-up Oka
      b.players[0].mzone[1] = mon(${HANA}, 0x1);  // own face-up Hana
      b.players[0].mzone[2] = mon(${MORI}, 0x1);  // own face-up Mori
      b.players[1].mzone[0] = mon(${MORI}, 0x8);  // opp face-down DEF Mori (MUST stay hidden)
      b.players[0].hand = [{ code: ${OKA} }, { code: ${HANA} }, { code: ${MORI} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${OKA}, null);
      const pvOka = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, null);
      const pvHana = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${MORI}, null);
      const pvMori = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownOka: artOf('0:4:0'), ownHana: artOf('0:4:1'), ownMori: artOf('0:4:2'), oppDownMori: artOf('1:4:0'), handImgs, pvOka, pvHana, pvMori };
    })()
  `);
  ok(res4.ownOka !== null && res4.ownHana !== null && res4.ownMori !== null && res4.oppDownMori !== null, 'CA22: non-vacuity — Vernusylph board rendered');
  ok(res4.ownOka.includes('card-art-oka-ishizu-s.jpg'), 'CA11k: Oka tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.ownHana.includes('card-art-hana-ishizu-s.jpg'), 'CA11l: Hana tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.ownMori.includes('card-art-mori-ishizu-s.jpg'), 'CA11m: Mori tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.oppDownMori === '' && !String(res4.oppDownMori).includes('mori'), 'CA13d: opponent FACE-DOWN Mori gets NO art (asymmetry / no leak)');
  const hOka = res4.handImgs.find(h => h.code === String(OKA));
  const hHana = res4.handImgs.find(h => h.code === String(HANA));
  const hMori = res4.handImgs.find(h => h.code === String(MORI));
  ok(!!hOka && hOka.style.includes('card-art-oka-ishizu-s.jpg'), 'CA14i: hand Oka (Ishizu deck) shows the deck-scoped art');
  ok(!!hHana && hHana.style.includes('card-art-hana-ishizu-s.jpg'), 'CA14j: hand Hana (Ishizu deck) shows the deck-scoped art');
  ok(!!hMori && hMori.style.includes('card-art-mori-ishizu-s.jpg'), 'CA14k: hand Mori (Ishizu deck) shows the deck-scoped art');
  ok(res4.pvOka.includes('card-art-oka-ishizu-s.jpg'), 'CA16g: resident preview shows the deck-scoped art for Oka (unique deck membership: Ishizu)');
  ok(res4.pvHana.includes('card-art-hana-ishizu-s.jpg'), 'CA16h: resident preview shows the deck-scoped art for Hana (unique deck membership: Ishizu)');
  ok(res4.pvMori.includes('card-art-mori-ishizu-s.jpg'), 'CA16i: resident preview shows the deck-scoped art for Mori (unique deck membership: Ishizu)');

  // ---- Kakan board (14th delivery — 《春化精の花冠》, a SPELL,
  // and the first spell with a deck-scoped override): surfaces
  // are the S/T zone, the hand and the preview, like the books.
  // Seat 0 plays Ishizu in this boot, so every public surface
  // carries the EGYPTIAN variant (kakan-ishizu); own SET Kakan
  // carries it under the veil like the books, and the opponent's
  // SET Kakan gets neither art nor veil ----
  const res6 = window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${KAKAN}, 0x5);  // own face-up Kakan (Ishizu deck context)
      b.players[0].szone[1] = st(${KAKAN}, 0xa);  // own SET Kakan (veil ghost)
      b.players[1].szone[0] = st(${KAKAN}, 0xa);  // opp SET Kakan (MUST stay hidden)
      b.players[0].hand = [{ code: ${KAKAN} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const h = document.querySelector('#hand .hcard[data-code="${KAKAN}"] .himg');
      setPreview(${KAKAN}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: tileOf('0:8:0'), ownSet: tileOf('0:8:1'), oppSet: tileOf('1:8:0'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(res6.ownUp !== null && res6.ownSet !== null && res6.oppSet !== null, 'CA24: non-vacuity — Kakan board rendered');
  ok(res6.ownUp.art !== null && res6.ownUp.art.includes('card-art-kakan-ishizu-s.jpg') && !res6.ownUp.veil, 'CA11t: own face-up Kakan S/T tile in the Ishizu deck shows the DECK-SCOPED Egyptian art');
  ok(res6.ownSet.art !== null && res6.ownSet.art.includes('card-art-kakan-ishizu-s.jpg') && res6.ownSet.veil && res6.ownSet.cls.split(/\s+/).includes('setown'), 'CA11u: own SET Kakan carries the deck-scoped art under the setown veil (owner ghost, like the books)');
  ok(res6.oppSet.art === '' && !res6.oppSet.veil && !String(res6.oppSet.art).includes('kakan'), 'CA13h: opponent SET Kakan gets NO art and NO veil (asymmetry / no leak)');
  ok(res6.hand !== null && res6.hand.includes('card-art-kakan-ishizu-s.jpg'), 'CA14o: hand Kakan (Ishizu deck) shows the deck-scoped art');
  ok(res6.pv.includes('card-art-kakan-ishizu-s.jpg'), 'CA16p: resident preview shows the deck-scoped art for Kakan (unique deck membership: Ishizu)');

  // ---- Deck-scoped override, flipped seats (fixture): the SAME
  // Mori card under a NON-Ishizu deck context must fall back to
  // the plain art, while the seat actually playing Ishizu keeps
  // the Egyptian art — the override follows the deck, not the
  // chair. (The real pool has no second deck containing Mori, so
  // the non-Ishizu context is fabricated by swapping the recorded
  // seat deck keys; instance surfaces resolve from those keys.) ----
  const res5 = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 (human side) now "plays" GG; seat 1 plays Ishizu
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MORI}, 0x1);  // Mori under a GG deck context (fixture)
      b.players[1].mzone[0] = mon(${MORI}, 0x1);  // Mori in the Ishizu deck (seat 1)
      b.players[1].mzone[1] = mon(${MORI}, 0x8);  // opp face-down Mori, Ishizu context (MUST stay hidden)
      b.players[0].mzone[1] = mon(${HANA}, 0x1);  // Hana under a GG deck context (fixture)
      b.players[1].mzone[2] = mon(${HANA}, 0x1);  // Hana in the Ishizu deck (seat 1)
      b.players[1].mzone[3] = mon(${HANA}, 0x8);  // opp face-down Hana, Ishizu context (MUST stay hidden)
      b.players[0].mzone[2] = mon(${OKA}, 0x1);   // Oka under a GG deck context (fixture)
      b.players[1].mzone[4] = mon(${OKA}, 0x1);   // Oka in the Ishizu deck (seat 1)
      b.players[0].hand = [{ code: ${MORI} }, { code: ${HANA} }, { code: ${OKA} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${MORI}"] .himg');
      const hHana = document.querySelector('#hand .hcard[data-code="${HANA}"] .himg');
      const hOka = document.querySelector('#hand .hcard[data-code="${OKA}"] .himg');
      setPreview(${MORI}, { con: 0, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${MORI}, { con: 1, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, { con: 0, loc: E.LOC.MZONE, seq: 1 });
      const pvHanaSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, { con: 1, loc: E.LOC.MZONE, seq: 2 });
      const pvHanaSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${OKA}, { con: 0, loc: E.LOC.MZONE, seq: 2 });
      const pvOkaSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${OKA}, { con: 1, loc: E.LOC.MZONE, seq: 4 });
      const pvOkaSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: artOf('0:4:0'), ishizuTile: artOf('1:4:0'), ishizuDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1,
               ggHanaTile: artOf('0:4:1'), ishizuHanaTile: artOf('1:4:2'), ishizuHanaDown: artOf('1:4:3'), handHana: hHana ? (hHana.getAttribute('style') || '') : null, pvHanaSeat0, pvHanaSeat1,
               ggOkaTile: artOf('0:4:2'), ishizuOkaTile: artOf('1:4:4'), handOka: hOka ? (hOka.getAttribute('style') || '') : null, pvOkaSeat0, pvOkaSeat1 };
    })()
  `);
  ok(res5.ggTile !== null && res5.ishizuTile !== null && res5.ishizuDown !== null, 'CA23: non-vacuity — flipped-seat Mori board rendered');
  ok(res5.ggTile.includes('card-art-mori-s.jpg') && !res5.ggTile.includes('mori-ishizu'), 'CA11n: Mori under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuTile.includes('card-art-mori-ishizu-s.jpg'), 'CA11o: Mori in the Ishizu deck shows the Egyptian art even on the opponent’s seat (deck, not chair)');
  ok(res5.ishizuDown === '' && !String(res5.ishizuDown).includes('mori'), 'CA13e: opponent FACE-DOWN Mori gets NO art even in Ishizu context (asymmetry binds the override too)');
  ok(res5.hand !== null && res5.hand.includes('card-art-mori-s.jpg') && !res5.hand.includes('mori-ishizu'), 'CA14l: hand Mori under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvSeat0.includes('card-art-mori-s.jpg') && !res5.pvSeat0.includes('mori-ishizu'), 'CA16j: preview of a GG-context Mori (instance ref) shows the plain art');
  ok(res5.pvSeat1.includes('card-art-mori-ishizu-s.jpg'), 'CA16k: preview of an Ishizu-context Mori (instance ref) shows the Egyptian art');
  ok(res5.ggHanaTile !== null && res5.ggHanaTile.includes('card-art-hana-s.jpg') && !res5.ggHanaTile.includes('hana-ishizu'), 'CA11p: Hana under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuHanaTile !== null && res5.ishizuHanaTile.includes('card-art-hana-ishizu-s.jpg'), 'CA11q: Hana in the Ishizu deck shows the Egyptian art on the opponent’s seat too');
  ok(res5.ishizuHanaDown === '' && !String(res5.ishizuHanaDown).includes('hana'), 'CA13f: opponent FACE-DOWN Hana gets NO art even in Ishizu context (asymmetry binds the 2nd override too)');
  ok(res5.handHana !== null && res5.handHana.includes('card-art-hana-s.jpg') && !res5.handHana.includes('hana-ishizu'), 'CA14m: hand Hana under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvHanaSeat0.includes('card-art-hana-s.jpg') && !res5.pvHanaSeat0.includes('hana-ishizu'), 'CA16l: preview of a GG-context Hana (instance ref) shows the plain art');
  ok(res5.pvHanaSeat1.includes('card-art-hana-ishizu-s.jpg'), 'CA16m: preview of an Ishizu-context Hana (instance ref) shows the Egyptian art');
  ok(res5.ggOkaTile !== null && res5.ggOkaTile.includes('card-art-oka-s.jpg') && !res5.ggOkaTile.includes('oka-ishizu'), 'CA11r: Oka under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuOkaTile !== null && res5.ishizuOkaTile.includes('card-art-oka-ishizu-s.jpg'), 'CA11s: Oka in the Ishizu deck shows the Egyptian art on the opponent’s seat too');
  ok(res5.handOka !== null && res5.handOka.includes('card-art-oka-s.jpg') && !res5.handOka.includes('oka-ishizu'), 'CA14n: hand Oka under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvOkaSeat0.includes('card-art-oka-s.jpg') && !res5.pvOkaSeat0.includes('oka-ishizu'), 'CA16n: preview of a GG-context Oka (instance ref) shows the plain art');
  ok(res5.pvOkaSeat1.includes('card-art-oka-ishizu-s.jpg'), 'CA16o: preview of an Ishizu-context Oka (instance ref) shows the Egyptian art');

  // Oka face-down on the Ishizu seat (the flipped board above is
  // out of rendered monster slots, so she gets a minimal board):
  // the asymmetry binds the 3rd override exactly like the others.
  const res5b = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu'];
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[1].mzone[0] = mon(${OKA}, 0x8);  // opp face-down Oka, Ishizu context (MUST stay hidden)
      render(b);
      const slot = document.querySelector('.slot[data-zone="1:4:0"]');
      const a = slot && slot.querySelector('.tile .art');
      const out = a ? (a.getAttribute('style') || '') : null;
      seatDeckKeys = saved;
      return out;
    })()
  `);
  ok(res5b === '' && !String(res5b).includes('oka'), 'CA13g: opponent FACE-DOWN Oka gets NO art even in Ishizu context (asymmetry binds the 3rd override too)');

  // ---- Carbon board (15th delivery): until now Carbon WAS the
  // unlisted exemplar, so he gets the full-surface treatment on
  // his own fabricated board — own face-up tile, hand and
  // preview carry the art, and an opponent face-down Carbon
  // must NOT (asymmetry, as ever) ----
  const res8 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${CARBON}, 0x1);  // own face-up ATK Carbon
      b.players[1].mzone[0] = mon(${CARBON}, 0x8);  // opp face-down DEF Carbon (MUST stay hidden)
      b.players[0].hand = [{ code: ${CARBON} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${CARBON}"] .himg');
      setPreview(${CARBON}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppDown: artOf('1:4:0'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(res8.ownUp !== null && res8.oppDown !== null, 'CA26: non-vacuity — Carbon board rendered');
  ok(res8.ownUp.includes('card-art-carbon-s.jpg'), 'CA11x: Carbon tile shows its own art');
  ok(res8.oppDown === '' && !String(res8.oppDown).includes('carbon'), 'CA13j: opponent FACE-DOWN Carbon gets NO art (asymmetry / no leak)');
  ok(res8.hand !== null && res8.hand.includes('card-art-carbon-s.jpg'), 'CA14q: hand Carbon shows the art');
  ok(res8.pv.includes('card-art-carbon-s.jpg'), 'CA16s: resident preview shows the art for Carbon');
  // ---- Kakan, flipped seats (fixture): the 4th override under
  // the same lens as the sisters — a Kakan instance owned by a
  // NON-Ishizu deck context falls back to the plain forest art
  // on the S/T tile, the hand and the preview, while the Ishizu
  // seat keeps the Egyptian variant; the Ishizu seat's SET
  // Kakan stays invisible (asymmetry binds the 4th override).
  // (Fabricated: the GG deck does not run Kakan, exactly like
  // the sisters' fixture above.) ----
  const res7 = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 now "plays" GG; seat 1 plays Ishizu
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${KAKAN}, 0x5);  // Kakan under a GG deck context (fixture)
      b.players[1].szone[0] = st(${KAKAN}, 0x5);  // Kakan in the Ishizu deck (seat 1)
      b.players[1].szone[1] = st(${KAKAN}, 0xa);  // opp SET Kakan, Ishizu context (MUST stay hidden)
      b.players[0].hand = [{ code: ${KAKAN} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const h = document.querySelector('#hand .hcard[data-code="${KAKAN}"] .himg');
      setPreview(${KAKAN}, { con: 0, loc: E.LOC.SZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${KAKAN}, { con: 1, loc: E.LOC.SZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: tileOf('0:8:0'), ishizuTile: tileOf('1:8:0'), ishizuSet: tileOf('1:8:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1 };
    })()
  `);
  ok(res7.ggTile !== null && res7.ishizuTile !== null && res7.ishizuSet !== null, 'CA25: non-vacuity — flipped-seat Kakan board rendered');
  ok(res7.ggTile.art !== null && res7.ggTile.art.includes('card-art-kakan-s.jpg') && !res7.ggTile.art.includes('kakan-ishizu'), 'CA11v: Kakan under a non-Ishizu deck context falls back to the plain forest art (S/T tile)');
  ok(res7.ishizuTile.art !== null && res7.ishizuTile.art.includes('card-art-kakan-ishizu-s.jpg'), 'CA11w: Kakan in the Ishizu deck shows the Egyptian art even on the opponent’s seat (deck, not chair)');
  ok(res7.ishizuSet.art === '' && !res7.ishizuSet.veil && !String(res7.ishizuSet.art).includes('kakan'), 'CA13i: opponent SET Kakan gets NO art and NO veil even in Ishizu context (asymmetry binds the 4th override too)');
  ok(res7.hand !== null && res7.hand.includes('card-art-kakan-s.jpg') && !res7.hand.includes('kakan-ishizu'), 'CA14p: hand Kakan under a non-Ishizu deck context falls back to the plain art');
  ok(res7.pvSeat0.includes('card-art-kakan-s.jpg') && !res7.pvSeat0.includes('kakan-ishizu'), 'CA16q: preview of a GG-context Kakan (instance ref) shows the plain art');
  ok(res7.pvSeat1.includes('card-art-kakan-ishizu-s.jpg'), 'CA16r: preview of an Ishizu-context Kakan (instance ref) shows the Egyptian art');

  window.close();
  console.log(failures === 0 ? 'ALL CARDART CHECKS PASSED' : failures + ' CARDART CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
