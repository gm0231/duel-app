'use strict';
/* test-typecolor.js — regression for card-kind colors on name bands
   (user request 2026-11-03; variant A adopted the same day: the
   whole name band takes the original frame color of the card kind).
   Contract under test:
   - cardKind(code) derives the kind mechanically from the core
     type bitmask in data.json (cards[code].type) — no per-card
     hand assignment; EVERY card in the pool classifies (0 misses),
     unknown codes yield '' so their bands keep the default look.
   - The kind class rides only on name elements that are visible
     under the normal rules (tile / hand / resident preview /
     selection grids / FX ghost / cut-in big card). An opponent's
     face-down card renders no name element at all, so it can
     never leak a kind color (information asymmetry unchanged).
   - Variant A is always on (no body-class gating, no variant B
     remnants in the stylesheet).
   Method: boot the real client in jsdom (harness as test-cardart),
   paint a fabricated board through the client's own render() and
   assert the DOM contract; rendered colors are verified separately
   in a real browser capture (cap-typecolor-a.js). */
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

// Independent re-derivation of the kind from the type bitmask —
// the client's cardKind() must agree with this for every pool card.
function kindOf(t) {
  t = t | 0;
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
const expected = {};
const reps = {};
for (const [code, d] of Object.entries(data.cards)) {
  const k = kindOf(d.type);
  expected[code] = k;
  if (k && !reps[k]) reps[k] = +code;
}
const codes = Object.keys(data.cards).map(Number);
ok(codes.every(c => expected[c] !== ''), 'TC0: every pool card classifies mechanically (0 unclassified of ' + codes.length + ')');
for (const k of ['spell', 'trap', 'fusion', 'synchro', 'xyz', 'effect'])
  ok(reps[k] != null, 'TC0b: pool has a ' + k + ' representative (' + (data.names[reps[k]] || reps[k]) + ')');
const SPELL = reps.spell, TRAP = reps.trap, FUSION = reps.fusion, SYNCHRO = reps.synchro, XYZ = reps.xyz, EFFECT = reps.effect;

// ---- stylesheet contract (variant A baked in, no gating) ----
ok(!html.includes('tc-full') && !html.includes('tc-accent'), 'TC0c: no prototype body-class gating remains (variant B removed)');
ok(/\.nm:is\(\.k-spell/.test(html) && html.includes('background:var(--kcd)'), 'TC0d: name bands take the deep kind color (variant A rule present)');
ok(html.includes('.nm.k-synchro{color:#211d14;}'), 'TC0e: synchro band uses dark text on the silver frame color');
ok(html.includes('--k-spell-d:#0d4a34') && html.includes('--k-trap-d:#6d2150') && html.includes('--k-fusion-d:#452a63'), 'TC0f: deep kind palette present');

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
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'TC1: client boots');

  // ---- cardKind agreement over the whole pool ----
  const agree = window.eval(`(() => {
    const exp = ${JSON.stringify(expected)};
    let bad = [];
    for (const [code, k] of Object.entries(exp)) if (cardKind(+code) !== k) bad.push(code + ':' + cardKind(+code) + '!=' + k);
    return { bad, unknown: cardKind(999999999), unknownCls: kindCls(999999999), sampleCls: kindCls(${FUSION}) };
  })()`);
  ok(agree.bad.length === 0, 'TC2: cardKind() agrees with the independent derivation for all ' + codes.length + ' pool cards' + (agree.bad.length ? ' — ' + agree.bad.join(', ') : ''));
  ok(agree.unknown === '' && agree.unknownCls === '', 'TC3: unknown code -> no kind, no class (band keeps the default look)');
  ok(agree.sampleCls === ' k-fusion', 'TC4: kindCls formats the class (fusion sample)');

  doc.getElementById('startbtn').click();
  for (let i = 0; i < 120 && doc.querySelectorAll('.slot').length < 10; i++)
    await new Promise(r => setTimeout(r, 50));

  // ---- fabricated board through the client's own render() ----
  const res = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${FUSION}, 0x1);   // own face-up Fusion
      b.players[0].mzone[1] = mon(${SYNCHRO}, 0x1);  // own face-up Synchro
      b.players[0].mzone[2] = mon(${XYZ}, 0x1);      // own face-up Xyz
      b.players[0].mzone[3] = mon(${EFFECT}, 0x4);   // own face-up DEF Effect
      b.players[0].szone[0] = st(${TRAP}, 0x5);      // own face-up Trap
      b.players[0].szone[1] = st(${TRAP}, 0xa);      // own SET Trap (owner reads the name)
      b.players[1].mzone[0] = mon(${FUSION}, 0x8);   // opp face-down Fusion (MUST stay nameless)
      b.players[1].szone[0] = st(${SPELL}, 0x5);     // opp face-up Spell (public)
      b.players[0].hand = [{ code: ${SPELL} }, { code: ${EFFECT} }, { code: ${TRAP} }];
      render(b);
      const nmCls = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const nm = slot && slot.querySelector('.tile .nm');
        return nm ? nm.className : null;
      };
      const handNms = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, cls: (h.querySelector('.nm') || {}).className || null }));
      setPreview(${FUSION}, null);
      const pvFusion = (document.querySelector('#preview .pv-name') || {}).className || null;
      setPreview(${SYNCHRO}, null);
      const pvSynchro = (document.querySelector('#preview .pv-name') || {}).className || null;
      gridSheet({ title: 't', sub: '', prompt: {}, cards: [{ code: ${SPELL}, locLabel: '' }, { code: ${TRAP}, locLabel: '' }, { code: ${FUSION}, locLabel: '' }], selected: new Set(), valid: () => true, confirmLabel: '決定', cancelable: true });
      const gridNms = [...document.querySelectorAll('#sheet .gcard .nm')].map(n => n.className);
      const ghostUp = fxGhostEl(${FUSION}, false, 40, 55);
      const ghostDown = fxGhostEl(${FUSION}, true, 40, 55);
      return {
        ownFusion: nmCls('0:4:0'), ownSynchro: nmCls('0:4:1'), ownXyz: nmCls('0:4:2'), ownEffect: nmCls('0:4:3'),
        ownTrapUp: nmCls('0:8:0'), ownTrapSet: nmCls('0:8:1'),
        oppDownFusion: nmCls('1:4:0'), oppSpellUp: nmCls('1:8:0'),
        handNms, pvFusion, pvSynchro, gridNms,
        ghostUpNm: ghostUp.querySelector('.nm') ? ghostUp.querySelector('.nm').className : null,
        ghostDownNm: ghostDown.querySelector('.nm') ? ghostDown.querySelector('.nm').className : 'ABSENT',
      };
    })()
  `);
  const has = (cls, k) => cls != null && cls.split(/\s+/).includes('k-' + k);
  ok(res.ownFusion !== null && res.oppSpellUp !== null, 'TC5: non-vacuity — fabricated tiles rendered');
  ok(has(res.ownFusion, 'fusion'), 'TC6: own face-up Fusion tile band carries k-fusion');
  ok(has(res.ownSynchro, 'synchro'), 'TC7: own face-up Synchro tile band carries k-synchro');
  ok(has(res.ownXyz, 'xyz'), 'TC8: own face-up Xyz tile band carries k-xyz');
  ok(has(res.ownEffect, 'effect'), 'TC9: own face-up Effect tile band carries k-effect');
  ok(has(res.ownTrapUp, 'trap'), 'TC10: own face-up Trap tile band carries k-trap');
  ok(has(res.ownTrapSet, 'trap'), 'TC11: own SET Trap keeps its owner-visible name band, colored k-trap (same treatment as before)');
  ok(res.oppDownFusion === null, 'TC12: opponent FACE-DOWN card has NO name element at all -> no kind color can leak');
  ok(has(res.oppSpellUp, 'spell'), 'TC13: opponent face-up Spell band carries k-spell (public information)');
  const hSpell = res.handNms.find(h => h.code === String(SPELL));
  const hEffect = res.handNms.find(h => h.code === String(EFFECT));
  const hTrap = res.handNms.find(h => h.code === String(TRAP));
  ok(!!hSpell && has(hSpell.cls, 'spell'), 'TC14: hand Spell band carries k-spell');
  ok(!!hEffect && has(hEffect.cls, 'effect'), 'TC15: hand Effect band carries k-effect');
  ok(!!hTrap && has(hTrap.cls, 'trap'), 'TC16: hand Trap band carries k-trap');
  ok(has(res.pvFusion, 'fusion'), 'TC17: resident preview name carries k-fusion');
  ok(has(res.pvSynchro, 'synchro'), 'TC18: resident preview name carries k-synchro');
  ok(res.gridNms.length === 3 && has(res.gridNms[0], 'spell') && has(res.gridNms[1], 'trap') && has(res.gridNms[2], 'fusion'), 'TC19: selection-grid bands carry their kind classes');
  ok(has(res.ghostUpNm, 'fusion'), 'TC20: face-up FX ghost band carries k-fusion');
  ok(res.ghostDownNm === 'ABSENT' || res.ghostDownNm === null, 'TC21: face-down FX ghost has no name band (no color, no leak)');

  window.close();
  console.log(failures === 0 ? 'ALL TYPECOLOR CHECKS PASSED' : failures + ' TYPECOLOR CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
