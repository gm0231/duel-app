'use strict';
/* test-setvis.js — regression for the two tile double-draw defects and
   the own-set-card ghost design (user reports 2026-11-03).
   Defect 1: a face-up DEFENSE tile showed the upright artwork behind
   the rotated card. Defect 2: a face-down DEFENSE tile read as two
   overlapping cards (chevron moire). Root cause for both: the card
   face / back pattern was drawn TWICE — once as the .tile element's
   own background (never rotates) and once inside .inner .art (the
   layer that rotates in defense position). Fix: the tile's own
   background is plain and .tile.back paints no pattern; .art is the
   single drawing layer.
   Design: the owner's own face-down cards carry .setown — the back
   pattern veiled OVER the real face (a .veil layer inside .inner,
   breathing via a CSS opacity keyframe). Opponent face-down cards
   keep the plain back: no veil, no ghost.
   Method: boot the real client in jsdom (harness as test-strot),
   start a duel, then paint a fabricated board through the client's
   own render() and assert the DOM/CSS contract in one synchronous
   eval (race-free against the live duel). CSS-level assertions read
   index.html directly. */
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

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
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

// ---- CSS-level contract (single drawing layer + breathing veil) ----
{
  const tileRule = (html.match(/\.tile\{[^}]*\}/) || [''])[0];
  ok(tileRule && !tileRule.includes('url('), 'SV1: .tile itself paints NO artwork (single draw lives in .inner .art)');
  const backRule = (html.match(/\.tile\.back\{[^}]*\}/) || [''])[0];
  ok(backRule && !backRule.includes('linear-gradient') && !backRule.includes('url('), 'SV2: .tile.back paints NO back design of its own (the design lives only in the rotating .art)');
  ok(/\.tile\.back \.inner \.art\{[^}]*url\('\.\.\/assets\/card-back-s\.jpg'\)/.test(html), 'SV3: the user card-back image is drawn by .tile.back .inner .art (rotates with the card)');
  ok(!html.includes('repeating-linear-gradient(45deg,#3d2c14'), 'SV3b: the old CSS stripe back is gone from every surface (hand backs, glyphs, ghosts, peel)');
  for (const sel of ['.hcard.back .himg', '.posbtn .glyph.back', '.fx-ghost.back', '.fx-peel']) {
    const rule = (html.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}')) || [''])[0];
    ok(rule.includes("url('../assets/card-back-s.jpg')"), 'SV3c: ' + sel + ' uses the user card-back image');
  }
  const kf = (html.match(/@keyframes setbreath\{[^}]*\}/) || [''])[0];
  ok(!!kf && kf.includes('opacity') && !kf.includes('box-shadow') && !kf.includes('filter'), 'SV4: @keyframes setbreath exists and animates opacity only');
  const veilRule = (html.match(/\.tile\.setown \.inner \.veil\{[^}]*\}/) || [''])[0];
  ok(/animation:\s*setbreath/.test(veilRule) && veilRule.includes("url('../assets/card-back-s.jpg')"), 'SV5: .setown veil = the user card-back image under the breathing animation');
}

(async () => {
  const window = await boot();
  const doc = window.document;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'SV6: client boots');
  doc.getElementById('startbtn').click();
  for (let i = 0; i < 120 && doc.querySelectorAll('.slot').length < 10; i++)
    await new Promise(r => setTimeout(r, 50));

  const res = window.eval(`
    (() => {
      const E = window.Engine;
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(25955164, 0x4);  // own face-up DEF
      b.players[0].mzone[1] = mon(31525442, 0x8);  // own face-down DEF (set)
      b.players[0].szone[0] = st(35726888, 0xa);   // own set S/T
      b.players[1].mzone[0] = mon(31525442, 0x8);  // opp face-down DEF
      b.players[1].szone[0] = st(35726888, 0xa);   // opp set S/T
      render(b);
      const grab = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        return { cls: t.className, veil: !!t.querySelector('.veil'), badge: !!t.querySelector('.setbadge'), art: !!t.querySelector('.art') };
      };
      // the opponent's rows render with reversed seq from the viewer's
      // side, so pick the opponent's face-down DEF by class signature
      // inside its row instead of by zone key
      const oppMz = [...document.querySelectorAll('#oppMzone .tile')];
      const od = oppMz.find(t => t.classList.contains('back') && t.classList.contains('def'));
      return {
        ownDefUp: grab('0:4:0'), ownDefDown: grab('0:4:1'), ownSetST: grab('0:8:0'),
        oppDefDown: od ? { cls: od.className, veil: !!od.querySelector('.veil'), badge: !!od.querySelector('.setbadge'), art: !!od.querySelector('.art') } : null,
        oppSetST: grab('1:8:0'),
      };
    })()
  `);
  const has = (t, c) => !!t && t.cls.split(/\s+/).includes(c);
  ok(!!res.ownDefDown && !!res.ownSetST && !!res.oppDefDown && !!res.oppSetST && !!res.ownDefUp,
    'SV7: non-vacuity — all five fabricated tiles rendered');
  ok(has(res.ownDefDown, 'setown') && has(res.ownDefDown, 'def') && res.ownDefDown.veil && !res.ownDefDown.badge && !has(res.ownDefDown, 'back'),
    'SV8: own face-down DEF = setown + def + veil, no badge, no plain back');
  ok(has(res.ownSetST, 'setown') && res.ownSetST.veil && !res.ownSetST.badge && !has(res.ownSetST, 'back') && !has(res.ownSetST, 'def'),
    'SV9: own set S/T = setown + veil, no badge, no plain back, no rotation');
  ok(has(res.oppDefDown, 'back') && has(res.oppDefDown, 'def') && !res.oppDefDown.veil && !has(res.oppDefDown, 'setown'),
    'SV10: opponent face-down DEF = plain back + def, NO veil/ghost (asymmetry)');
  ok(has(res.oppSetST, 'back') && !res.oppSetST.veil && !has(res.oppSetST, 'setown'),
    'SV11: opponent set S/T = plain back, NO veil/ghost');
  ok(has(res.ownDefUp, 'def') && !res.ownDefUp.veil && !has(res.ownDefUp, 'setown') && !has(res.ownDefUp, 'back'),
    'SV12: own face-up DEF unchanged (def only, no veil)');
  window.close();
  console.log(failures === 0 ? 'ALL SETVIS CHECKS PASSED' : failures + ' SETVIS CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
