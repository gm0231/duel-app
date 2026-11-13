'use strict';
/* BU-72 / BU-73 (2026-11-13) — damage/heal numeral grammar and
   the header + central LP band layout.
   Design: hidden_files/fx-design-2026-11-13-dmg-layout.md
   (section A + the LP上下 revision at the end).
   Pins:
     DMG-S* static structure: #topbar/#midbar/#mybar are gone;
       #header (2 rows) and #lpband (opponent plate over mine)
       carry every element the old bars carried; the chain bar
       overlays the header at right:144px; the preduel rule hides
       the new sections; the mode table is full 224 / compact 206.
     DMG-L* layout formula: computeLayout at the design's own
       budgets (620 / 700) meets the design targets — tile 41 /
       hand 80 at 620, tile 52 / hand 94 at 700 — and never drops
       below the legacy board floor.
     DMG-F* FX contract: every damage records dmgnum {player,
       amount, tier, battle} and floats ONE unified numeral at
       the tier size; heals record healnum and float the green
       inverse; the SE follows the tier (T1 hit_big@0.35,
       T2 hit_big@0.6, T3 hit_critical@0.6, all damage sounded);
       a pay keeps its gold chip and spawns NO numeral. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const ruleDecls = (re) => {
  const m = html.match(re);
  if (!m) return null;
  const d = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) d[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return d;
};

// ================= static structure =================
{
  ok(!/id="topbar"/.test(html) && !/id="midbar"/.test(html) && !/id="mybar"/.test(html) &&
     /id="header"/.test(html) && /id="lpband"/.test(html),
    'DMG-S1: #topbar/#midbar/#mybar are gone; #header and #lpband exist');
  const idx = (id) => html.indexOf('id="' + id + '"');
  ok(idx('header') > -1 && idx('header') < idx('placehint') && idx('placehint') < idx('oppField') &&
     idx('oppField') < idx('lpband') && idx('lpband') < idx('myField') && idx('myField') < idx('handbar'),
    'DMG-S2: stack order is header / placehint / oppField / lpband / myField / handbar (the band sits between the fields)');
  const band = html.slice(idx('lpband'), idx('myField'));
  ok(band.indexOf('id="oppPlate"') > -1 && band.indexOf('id="oppPlate"') < band.indexOf('id="myPlate"') &&
     band.indexOf('id="oppLp"') > band.indexOf('id="oppPlate"') && band.indexOf('id="oppLp"') < band.indexOf('id="myPlate"') &&
     band.indexOf('id="myLp"') > band.indexOf('id="myPlate"'),
    'DMG-S3: inside the band the opponent plate (with oppLp) stands ABOVE my plate (with myLp)');
  const hdr = html.slice(idx('header'), idx('placehint'));
  const order = ['menubtn', 'phaseinfo', 'loghistbtn', 'phasebtn', 'turninfo', 'logline', 'autopass', 'oppHandChip', 'fxbtn', 'chainbar'];
  ok(order.every((id, i) => hdr.indexOf('id="' + id + '"') > -1 && (i === 0 || hdr.indexOf('id="' + order[i - 1] + '"') < hdr.indexOf('id="' + id + '"'))),
    'DMG-S4: the header carries, in order: menu / phase / history / phase button (row 1), turn / event line / auto-pass chip / opp-hand chip / fx button (row 2), and the chain bar');
  const chainbar = ruleDecls(/#chainbar\{([^}]*)\}/);
  ok(!!chainbar && chainbar.right === '144px',
    'DMG-S5: the chain bar overlays the header with its right edge at 144px (the 136px phase button stays exposed)');
  const header = ruleDecls(/#header\{([^}]*)\}/);
  ok(!!header && !('height' in header) && !('min-height' in header),
    'DMG-S6: the header is not height-frozen — its 81px is by construction (46px button row + the event line\'s two lines; rect-verified in the browser pass)');
  const lpnum = ruleDecls(/\.lpplate \.lp\{([^}]*)\}/);
  const lpnumC = ruleDecls(/#app\.compactui \.lpplate \.lp\{([^}]*)\}/);
  ok(!!lpnum && lpnum['font-size'] === '28px' && lpnum['line-height'] === '1' && !!lpnumC && lpnumC['font-size'] === '24px',
    'DMG-S7: the LP numeral line is 28px full / 24px compact at line-height 1 — the plate is exactly that one line (band 61 full / 53 compact by construction)');
  const pbtn = ruleDecls(/#phasebtn\{([^}]*)\}/);
  ok(!!pbtn && pbtn.height === '46px' && pbtn['min-width'] === '136px' && !/#phasebtn\{height:44px/.test(html),
    'DMG-S8: the phase button is 46px in BOTH tiers with the BU-61 min-width 136px (no compact 44px rule remains)');
  const fxbtn = ruleDecls(/#fxbtn\{([^}]*)\}/);
  ok(!!fxbtn && fxbtn.width === '28px' && fxbtn.height === '28px',
    'DMG-S9: the settings button is a 28px icon-only square in header row 2');
  const pre = html.match(/#app\.preduel>([^{]*)\{/);
  ok(!!pre && pre[1].includes('#header') && pre[1].includes('#lpband') && !pre[1].includes('#topbar') && !pre[1].includes('#midbar') && !pre[1].includes('#mybar'),
    'DMG-S10: the preduel rule hides #header and #lpband (BU-69 read across to the new sections)');
  ok(/full: \{ fixedNoPv: 224/.test(clientSrc) && /compact: \{ fixedNoPv: 206/.test(clientSrc),
    'DMG-S11: the layout mode table is full 224 / compact 206 (BU-73 budgets)');
  ok(!clientSrc.includes('function fxHealFloat') && !clientSrc.includes('function fitLogline') &&
     clientSrc.includes("fxRecord('dmgnum'") && clientSrc.includes("fxRecord('healnum'"),
    'DMG-S12: fxHealFloat and fitLogline are abolished; the fxRecord contract carries dmgnum / healnum');
}

// ================= boot =================
async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const doc = window.document;
  window.__audioLog = [];
  window.Audio = class {
    constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; window.__audioLog.push(this); }
    play() { this.playedVolume = this.volume; return Promise.resolve(); }
    pause() {}
  };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => String(url).includes('ocgcore.wasm')
    ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
    : { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  const inject = (file) => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    doc.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('client.js');
  for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

function fakeState(mut) {
  const P = () => ({ mzone: [null, null, null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 });
  const st = { players: [P(), P()], phaseName: '', turnCount: 1, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [] };
  if (mut) mut(st);
  return st;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const ev = (src) => window.eval(src);
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'DMG-L0: client boots');
  ok(doc.getElementById('chainbar').closest('#header') === doc.getElementById('header'),
    'DMG-L0b: in the live DOM the chain bar is a child of the header');

  // ---------- layout formula ----------
  const L620 = ev('computeLayout(390, 620)');
  ok(L620.tileW === 41 && L620.handH === 80 && L620.tileW >= ev('legacyTileW(390, 620)'),
    'DMG-L1: budget 620 — tile ' + L620.tileW + ' (target 41), hand ' + L620.handH + ' (target 80), at/above the legacy floor');
  const L700 = ev('computeLayout(390, 700)');
  ok(L700.tileW === 52 && L700.handH === 94 && L700.tileW >= ev('legacyTileW(390, 700)'),
    'DMG-L2: budget 700 — tile ' + L700.tileW + ' (target 52), hand ' + L700.handH + ' (target 94), at/above the legacy floor');

  // ---------- FX grammar ----------
  const fx = window.__fx;
  const step = (st, evs) => { const before = fx.log.length; fx.process(evs || [], st); return fx.log.slice(before); };
  const render = (st) => window.render(st);
  const has = (recs, kind, pred) => recs.some(r => r.kind === kind && (!pred || pred(r)));
  const sePlayed = (namePart) => window.__audioLog.filter(a => String(a.src).includes(namePart) && a.playedVolume != null);
  const clearSeDedupe = () => ev('Object.keys(seLast).forEach(k => delete seLast[k])');

  ok(ev('fxDmgTier(499)') === 1 && ev('fxDmgTier(500)') === 2 && ev('fxDmgTier(1499)') === 2 && ev('fxDmgTier(1500)') === 3,
    'DMG-F0: tier boundaries are 499 / 500 / 1499 / 1500');

  // T1 effect damage to the opponent: numeral + hit_big at 0.35
  fx.reset(); clearSeDedupe();
  let st = fakeState(); render(st); step(st);
  st = fakeState(s => { s.players[1].lp = 7700; }); render(st);
  let recs = step(st, [{ kind: 'damage', player: 1, amount: 300 }]);
  ok(has(recs, 'dmgnum', r => r.player === 1 && r.amount === 300 && r.tier === 1 && r.battle === false),
    'DMG-F1: T1 effect damage records dmgnum {tier 1, battle:false}');
  const n1 = doc.querySelector('.fx3-dmgnum');
  ok(!!n1 && n1.textContent === '−300' && n1.style.fontSize === '22px' && n1.classList.contains('fx3-num--t1'),
    'DMG-F1b: the T1 numeral reads −300 at 22px (got ' + (n1 ? n1.textContent + '/' + n1.style.fontSize + '/' + n1.className : 'none') + ')');
  // SE selection lives in drainSeEvents (the production onUpdate
  // path), not in fxProcess — drive it directly with the event.
  clearSeDedupe();
  ev("drainSeEvents({ events: [{ kind: 'damage', player: 1, amount: 300 }] })");
  const se1 = sePlayed('hit_big');
  ok(se1.length >= 1 && se1[se1.length - 1].playedVolume === 0.35,
    'DMG-F1c: T1 damage sounds hit_big at volume 0.35 (no silent small damage; got ' + JSON.stringify(se1.map(a => a.playedVolume)) + ')');

  // T3 effect damage to me: numeral 36px + hit_critical at 0.6
  fx.reset(); clearSeDedupe();
  st = fakeState(); render(st); step(st);
  st = fakeState(s => { s.players[0].lp = 5600; }); render(st);
  recs = step(st, [{ kind: 'damage', player: 0, amount: 2400 }]);
  ok(has(recs, 'dmgnum', r => r.player === 0 && r.amount === 2400 && r.tier === 3 && r.battle === false),
    'DMG-F2: T3 effect damage records dmgnum {tier 3, battle:false}');
  const n3 = doc.querySelector('.fx3-dmgnum');
  ok(!!n3 && n3.textContent === '−2400' && n3.style.fontSize === '36px' && n3.classList.contains('fx3-num--t3'),
    'DMG-F2b: the T3 numeral reads −2400 at 36px');
  clearSeDedupe();
  ev("drainSeEvents({ events: [{ kind: 'damage', player: 0, amount: 2400 }] })");
  const se3 = sePlayed('hit_critical');
  ok(se3.length >= 1 && se3[se3.length - 1].playedVolume === 0.6,
    'DMG-F2c: T3 damage sounds hit_critical at volume 0.6');
  clearSeDedupe();
  ev("drainSeEvents({ events: [{ kind: 'damage', player: 1, amount: 900 }] })");
  const se2 = sePlayed('hit_big');
  ok(se2.length >= 1 && se2[se2.length - 1].playedVolume === 0.6,
    'DMG-F2d: T2 damage sounds hit_big at the standing volume 0.6');

  // battle damage: dmgnum battle:true (the numeral rides impact)
  fx.reset(); clearSeDedupe();
  const E = window.Engine;
  const MON = (() => { for (const [code, c] of Object.entries(data.cards)) if ((c.type & 0x1) && c.atk >= 900 && !(c.type & 0x4802040)) return +code; return null; })();
  const mon = (code) => ({ code, pos: 1, materials: 0, curAtk: data.cards[code].atk, curDef: data.cards[code].def });
  st = fakeState(s => { s.players[0].mzone[0] = mon(MON); }); render(st); step(st);
  st = fakeState(s => { s.players[0].mzone[0] = mon(MON); s.players[1].lp = 7100; });
  st.lastAttack = { attacker: { con: 0, loc: E.LOC.MZONE, seq: 0 }, target: null };
  render(st);
  recs = step(st, [{ kind: 'attack', code: MON, con: 0, direct: true }, { kind: 'damage', player: 1, amount: 900 }]);
  ok(has(recs, 'dmgnum', r => r.player === 1 && r.amount === 900 && r.tier === 2 && r.battle === true),
    'DMG-F3: battle damage records dmgnum {tier 2, battle:true}');
  ok(!recs.some(r => r.kind === 'lpchip'), 'DMG-F3b: battle damage records NO chip (single presentation)');

  // heal: healnum + the green inverse numeral, recover SE unchanged
  fx.reset(); clearSeDedupe();
  st = fakeState(); render(st); step(st);
  st = fakeState(s => { s.players[0].lp = 8300; }); render(st);
  recs = step(st, [{ kind: 'recover', player: 0, amount: 300 }]);
  ok(has(recs, 'healnum', r => r.player === 0 && r.amount === 300 && r.tier === 1) && !recs.some(r => r.kind === 'dmgnum'),
    'DMG-F4: a heal records healnum {tier 1} and no dmgnum');
  const hn = doc.querySelector('.fx3-healnum');
  ok(!!hn && hn.textContent === '+300' && hn.style.fontSize === '22px',
    'DMG-F4b: the heal numeral reads +300 at the tier size 22px (got ' + (hn ? hn.textContent + '/' + hn.style.fontSize : 'none') + ')');
  clearSeDedupe();
  ev("drainSeEvents({ events: [{ kind: 'recover', player: 0, amount: 300 }] })");
  ok(sePlayed('recover').length >= 1, 'DMG-F4c: the recover SE still sounds for a heal');

  // pay: the gold chip only — costs never enter the ± grammar
  fx.reset(); clearSeDedupe();
  st = fakeState(); render(st); step(st);
  st = fakeState(s => { s.players[0].lp = 6500; }); render(st);
  recs = step(st, [{ kind: 'pay', player: 0, amount: 1500 }]);
  ok(has(recs, 'lpchip', r => r.chip === 'pay' && r.amount === 1500) && !recs.some(r => r.kind === 'dmgnum') && !doc.querySelector('.fx3-dmgnum'),
    'DMG-F5: an LP cost records only the gold pay chip — no damage numeral');

  ok(fx.error === null, 'DMG-F6: fxError stayed null through every BU-72/73 step (got: ' + fx.error + ')');
  window.close();

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL DMGLAYOUT CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
