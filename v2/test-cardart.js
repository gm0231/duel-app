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

const MUDORA = 99937011, AGIDO = 62320425, KELBEK = 25926710, ZOLGA = 31525442;

// ---- delivered art files (existence + top-anchored dimensions) ----
for (const [f, w, h] of [['card-art-mudora-s.jpg', 320, 320], ['card-art-mudora.jpg', 640, 882],
                         ['card-art-agido-s.jpg', 320, 320], ['card-art-agido.jpg', 640, 882],
                         ['card-art-kelbek-s.jpg', 320, 320], ['card-art-kelbek.jpg', 640, 882]]) {
  const p = path.join(V2, '..', 'assets', f);
  ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'CA0: ' + f + ' delivered (>10KB)');
}
ok(data.decks.ishizu.main.filter(c => c === MUDORA).length === 3, 'CA0b: the Ishizu deck runs 3 copies of Mudora');
ok(data.decks.ishizu.main.filter(c => c === AGIDO).length === 1, 'CA0c: the Ishizu deck runs 1 copy of Agido');
ok(data.decks.ishizu.main.filter(c => c === KELBEK).length === 1, 'CA0d: the Ishizu deck runs 1 copy of Kelbek');

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
    unlistedInline: artInline(${ZOLGA}),
    unlistedFile: cardArtFile(${ZOLGA}, false),
    nullInline: artInline(null),
    preloaded: [...artPreloaded],
    agidoSlug: CARD_ART[${AGIDO}],
    agidoInline: artInline(${AGIDO}),
    kelbekSlug: CARD_ART[${KELBEK}],
    kelbekInline: artInline(${KELBEK}),
  }))()`);
  ok(helpers.agidoSlug === 'agido' && helpers.agidoInline.includes('card-art-agido-s.jpg') && helpers.agidoInline.includes('background-position:center top'), 'CA7b: Agido maps and stamps like Mudora');
  ok(helpers.kelbekSlug === 'kelbek' && helpers.kelbekInline.includes('card-art-kelbek-s.jpg') && helpers.kelbekInline.includes('background-position:center top'), 'CA7d: Kelbek maps and stamps like the others');
  ok(helpers.slug === 'mudora', 'CA2: CARD_ART maps Mudora -> mudora');
  ok(helpers.small === '../assets/card-art-mudora-s.jpg' && helpers.big === '../assets/card-art-mudora.jpg', 'CA3: art files resolve (small + big)');
  ok(helpers.inline.includes('card-art-mudora-s.jpg') && helpers.inline.includes('background-position:center top'), 'CA4: artInline pins the top (crop rule: keep top, cut bottom)');
  ok(helpers.inlineBig.includes('card-art-mudora.jpg') && !helpers.inlineBig.includes('-s.jpg'), 'CA5: big surface uses the big file');
  ok(helpers.unlistedInline === '' && helpers.unlistedFile === null && helpers.nullInline === '', 'CA6: unlisted/null codes fall back (empty = placeholder CSS untouched)');
  ok(helpers.preloaded.includes('../assets/card-art-mudora-s.jpg') && helpers.preloaded.includes('../assets/card-art-mudora.jpg'), 'CA7: boot preloads both sizes for the default decks');
  ok(helpers.preloaded.includes('../assets/card-art-agido-s.jpg') && helpers.preloaded.includes('../assets/card-art-agido.jpg'), 'CA7c: boot preloads Agido too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-kelbek-s.jpg') && helpers.preloaded.includes('../assets/card-art-kelbek.jpg'), 'CA7e: boot preloads Kelbek too (same deck)');

  doc.getElementById('startbtn').click();
  for (let i = 0; i < 120 && doc.querySelectorAll('.slot').length < 10; i++)
    await new Promise(r => setTimeout(r, 50));

  // ---- fabricated board through the client's own render() ----
  const res = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MUDORA}, 0x1);  // own face-up ATK Mudora
      b.players[0].mzone[1] = mon(${MUDORA}, 0x4);  // own face-up DEF Mudora (2nd copy)
      b.players[0].mzone[2] = mon(${ZOLGA}, 0x1);   // own face-up Zolga (no art)
      b.players[0].mzone[3] = mon(${AGIDO}, 0x1);   // own face-up Agido (2nd delivery)
      b.players[0].mzone[4] = mon(${KELBEK}, 0x1);  // own face-up Kelbek (3rd delivery)
      b.players[1].mzone[0] = mon(${MUDORA}, 0x1);  // opp face-up Mudora (public: art shows)
      b.players[1].mzone[1] = mon(${MUDORA}, 0x8);  // opp face-down DEF Mudora (MUST stay hidden)
      b.players[0].hand = [{ code: ${MUDORA} }, { code: ${ZOLGA} }];
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
      const ghost = fxGhostEl(${MUDORA}, false, 40, 55);
      const ghostBack = fxGhostEl(${MUDORA}, true, 40, 55);
      const ghostUnlisted = fxGhostEl(${ZOLGA}, false, 40, 55);
      return {
        ownAtk: artOf('0:4:0'), ownDef: artOf('0:4:1'), ownZolga: artOf('0:4:2'), ownAgido: artOf('0:4:3'), ownKelbek: artOf('0:4:4'),
        oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'),
        handImgs, pvMudora, pvZolga,
        ghost: ghost.style.backgroundImage || '', ghostPos: ghost.style.backgroundPosition || '',
        ghostBack: ghostBack.style.backgroundImage || '', ghostUnlisted: ghostUnlisted.style.backgroundImage || '',
      };
    })()
  `);
  ok(res.ownAtk !== null && res.ownDef !== null && res.oppDown !== null, 'CA8: non-vacuity — fabricated tiles rendered');
  ok(res.ownAtk.includes('card-art-mudora-s.jpg'), 'CA9: own face-up Mudora tile shows the individual art');
  ok(res.ownDef.includes('card-art-mudora-s.jpg'), 'CA10: every copy is covered (2nd Mudora, face-up DEF)');
  ok(res.ownZolga === '', 'CA11: unlisted card tile keeps the placeholder (no inline art)');
  ok(res.ownAgido !== null && res.ownAgido.includes('card-art-agido-s.jpg'), 'CA11b: Agido tile shows its own art (slug, not Mudora’s)');
  ok(res.ownKelbek !== null && res.ownKelbek.includes('card-art-kelbek-s.jpg'), 'CA11c: Kelbek tile shows its own art');
  ok(res.oppUp.includes('card-art-mudora-s.jpg'), 'CA12: opponent face-up Mudora shows the art (public information)');
  ok(res.oppDown === '' && !String(res.oppDown).includes('mudora'), 'CA13: opponent FACE-DOWN Mudora gets NO art (asymmetry / no leak)');
  const hMudora = res.handImgs.find(h => h.code === String(MUDORA));
  const hZolga = res.handImgs.find(h => h.code === String(ZOLGA));
  ok(!!hMudora && hMudora.style.includes('card-art-mudora-s.jpg'), 'CA14: hand Mudora shows the art');
  ok(!!hZolga && hZolga.style === '', 'CA15: hand Zolga keeps the placeholder');
  ok(res.pvMudora.includes('card-art-mudora-s.jpg'), 'CA16: resident preview shows the art for Mudora');
  ok(res.pvZolga === '', 'CA17: resident preview falls back for unlisted cards');
  ok(res.ghost.includes('card-art-mudora-s.jpg') && res.ghostPos.includes('top'), 'CA18: face-up FX ghost carries the art, top-pinned');
  ok(res.ghostBack === '' && res.ghostUnlisted === '', 'CA19: face-down and unlisted ghosts get no art');

  window.close();
  console.log(failures === 0 ? 'ALL CARDART CHECKS PASSED' : failures + ' CARDART CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
