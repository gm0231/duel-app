'use strict';
/* test-fix1113c.js — fix round 2026-11-13 #3 (BU-69 / BU-70).
 *
 * R1 (BU-69): after a mid-duel exit (選択に戻る → 終了する →
 * reload), the 「読み込み中…」 veil stayed up for a long time
 * and the deck page's summary transiently showed the DEFAULT
 * selections （相手：ゲート・ガーディアン) before the boot-end
 * restore fixed it. Phase measurement on the real core rig
 * (CPU x20) split the wait: the veil lifted only when the whole
 * script chain had parsed and client.js's boot prefix ran, and
 * the summary stayed wrong until data.json was parsed and the
 * ENTIRE boot wiring had run, because the restore sat at the
 * bottom of the async boot block behind both awaits. The fix:
 *  - index.html carries an inline landing script (runs at HTML
 *    parse, before any external script) that lands on the deck
 *    page and writes the stashed summary line when 'v3todeck'
 *    exists;
 *  - quitToDeckSelection stashes that summary line verbatim
 *    (the `sum` field);
 *  - the boot PREFIX consumes and applies the stash (selections
 *    + summary need no DATA), and the deck page's own controls
 *    (seg-first, the FX segs, the sound switch) are wired in the
 *    prefix too; the boot-end block only re-asserts row marks.
 * The behavioral checks below pin the pre-DATA state with a
 * deferred data.json fetch: correct page, correct summary and
 * live controls BEFORE the data arrives.
 *
 * R2 (BU-70): 《運命の抱く爆弾》① chained to 《宵闇のルーチェ》's
 * direct attack appeared to do nothing (no destruction, no
 * damage to the opponent; the owner still lost 3500 LP). Card
 * texts (data.json / official DB): the bomb destroys the
 * opponent's highest-ATK monster and damages the opponent by
 * its original ATK — its script applies the damage ONLY when
 * Duel.Destroy returns >0. Luce's ① makes the monsters in ITS
 * controller's leftmost/rightmost Main Monster Zones
 * indestructible by card effects — including Luce itself when
 * it sits at an edge. The three real-core scenes below pin the
 * interaction: edge Luce survives and the attack's battle
 * damage lands (the field report's exact numbers), center Luce
 * is destroyed with both effect damages, and an unprotected
 * attacker is destroyed the same way. Verdict: legitimate
 * interaction, no processing defect.
 */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- R1 source pins
{
  const inlineAt = html.indexOf("sessionStorage.getItem('v3todeck')");
  const engineAt = html.indexOf('build/ocgcore.js');
  ok(inlineAt > -1 && engineAt > -1 && inlineAt < engineAt, 'R1-S1: the inline landing script runs before the external script chain');
  ok(html.includes('__cfg.sum') && html.includes("getElementById('decksum')"), 'R1-S2: the inline landing writes the stashed summary line into #decksum');
  ok(/sum: \$\('decksum'\)\.textContent/.test(clientSrc), 'R1-S3: quitToDeckSelection stashes the summary line verbatim (sum)');
  ok((clientSrc.match(/getItem\('v3todeck'\)/g) || []).length === 1, 'R1-S4: the stash is consumed exactly once — in the boot prefix (the boot-end block no longer reads it)');
}

// ---------------------------------------------------------------- R1 behavioral boot (deferred data.json)
async function bootDeferred(stash) {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  let resolveData = null;
  const dataPromise = new Promise(r => { resolveData = () => r({ ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf }); });
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes('ocgcore.wasm')) return { ok: true, status: 200, url: u, arrayBuffer: async () => wasmBuf };
    if (u.includes('data.json')) return dataPromise;
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  if (stash) window.sessionStorage.setItem('v3todeck', JSON.stringify(stash));
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
  inject('neuron.js');
  inject('client.js'); // the boot prefix runs synchronously up to the data.json await
  return { window, resolveData };
}

(async () => {
  // ---- R1: return landing is correct BEFORE data.json arrives ----
  {
    const stash = { my: 'ishizu', op: 'monarch', first: 'second', sum: '自分：MILLENNIUM PROPHECY ／ 相手：帝王 ／ 後攻' };
    const { window, resolveData } = await bootDeferred(stash);
    const doc = window.document;
    ok(doc.getElementById('start').style.display === 'none', 'R1-B1: pre-DATA, the title veil is already lifted');
    ok(doc.getElementById('deckpage').style.display === 'flex', 'R1-B2: pre-DATA, the deck page is already shown');
    const sum = doc.getElementById('decksum').textContent;
    ok(sum.includes('帝王') && sum.includes('後攻') && !sum.includes('ゲート・ガーディアン'), 'R1-B3: pre-DATA, the summary already shows the RESTORED selections, never the defaults (got: ' + sum + ')');
    ok(doc.querySelector('#seg-first button[data-v="second"]').classList.contains('sel'), 'R1-B4: pre-DATA, seg-first marks 後攻 as selected');
    // the sound switch is wired in the prefix: it answers before DATA
    const sb = doc.getElementById('soundbtn');
    const before = doc.getElementById('sndstate').textContent;
    sb.click();
    ok(doc.getElementById('sndstate').textContent !== before, 'R1-B5: pre-DATA, the sound switch already answers taps');
    sb.click(); // restore
    resolveData();
    for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++) await sleep(50);
    ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'R1-B6: the boot still completes when data arrives');
    ok(doc.getElementById('startbtn').disabled === false, 'R1-B7: the start button enables after the load');
    const selRow = doc.querySelector('#seg-opdeck button.deck.sel');
    ok(!!selRow && selRow.dataset.v === 'monarch', 'R1-B8: after the load, the opponent deck row marks 帝王 (monarch) selected');
    ok(doc.querySelector('#opdeckcur .dn').textContent === '帝王', 'R1-B9: after the load, the opponent current-choice row shows 帝王');
    ok(window.sessionStorage.getItem('v3todeck') === null, 'R1-B10: the stash is consumed');
    window.close();
  }
  // ---- R1: a plain boot (no stash) is untouched ----
  {
    const { window, resolveData } = await bootDeferred(null);
    const doc = window.document;
    ok(doc.getElementById('start').style.display !== 'none' && doc.getElementById('deckpage').style.display === 'none', 'R1-C1: no stash — the title screen stands and the deck page stays hidden');
    resolveData();
    for (let i = 0; i < 100 && !doc.getElementById('loadmsg').textContent.includes('準備完了'); i++) await sleep(50);
    ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'R1-C2: no stash — the boot completes normally');
    window.close();
  }

  // ---------------------------------------------------------------- R2: real-core scenes
  const factory = require(path.join(V2, 'build', 'ocgcore.js'));
  const Engine = require(path.join(V2, 'engine.js'));
  const { GameState, parsePrompt, splitMessages, i32resp, cardsResp, cmdResp, placeResp, LOC, FLAGS_GENESIS } = Engine;
  const BOMB = 51208877, LUCE = 45409943, SPHINX = 46148485;

  function registerAll(M) {
    const ccall = M.ccall;
    for (const key of Object.keys(data.cards)) {
      const c = data.cards[key];
      const raceLo = c.race % 4294967296, raceHi = Math.floor(c.race / 4294967296);
      ccall('poc_register_card', null, ['number', 'number', 'string', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [c.code, c.alias, (c.setcodes || []).join(','), c.type, c.level, c.attribute, raceLo, raceHi, c.atk, c.def, c.lscale, c.rscale, c.link_marker]);
    }
    const enc = new TextEncoder();
    for (const name of Object.keys(data.scripts)) {
      const bytes = enc.encode(data.scripts[name]);
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      ccall('poc_register_script_buf', null, ['string', 'number', 'number'], [name, ptr, bytes.length]);
      M._free(ptr);
    }
  }
  function queryCard(M, duel, con, loc, seq) {
    const FLAGS = 0x1 | 0x2 | 0x10 | 0x100 | 0x200;
    const len = M.ccall('poc_query_card', 'number', ['number', 'number', 'number', 'number', 'number'], [duel, FLAGS, con, loc, seq]);
    if (!len) return null;
    const ptr = M.ccall('poc_query_ptr', 'number', [], []);
    const buf = M.HEAPU8.slice(ptr, ptr + len);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out = {};
    let o = 0;
    while (o + 6 <= buf.length) {
      const recLen = dv.getUint16(o, true);
      if (recLen < 4 || o + 2 + recLen > buf.length) break;
      const flag = dv.getUint32(o + 2, true);
      if (flag === 0x80000000) break;
      const v = o + 6;
      if (flag === 0x1) out.code = dv.getUint32(v, true);
      else if (flag === 0x2) out.pos = dv.getUint32(v, true);
      o += 2 + recLen;
    }
    return out.code ? out : null;
  }
  async function runScene(M, attackerCode, attackerSeq) {
    const ccall = M.ccall;
    registerAll(M);
    const duel = ccall('poc_create', 'number', ['number', 'bigint', 'number', 'number', 'number'], [777, BigInt(FLAGS_GENESIS), 8000, 5, 1]);
    const GLOBALS = ['constant.lua', 'archetype_setcode_constants.lua', 'card_counter_constants.lua', 'utility.lua', 'cards_specific_functions.lua', 'chain.lua', 'deprecated_functions.lua', 'proc_equip.lua', 'proc_fusion.lua', 'proc_fusion_spell.lua', 'proc_gemini.lua', 'proc_link.lua', 'proc_maximum.lua', 'proc_normal.lua', 'proc_pendulum.lua', 'proc_persistent.lua', 'proc_ritual.lua', 'proc_rush.lua', 'proc_skill.lua', 'proc_spirit.lua', 'proc_synchro.lua', 'proc_union.lua', 'proc_workaround.lua', 'proc_xyz.lua'];
    for (const g of GLOBALS) if (g in data.scripts) ccall('poc_load_global', 'number', ['number', 'string'], [duel, g]);
    const add = (team, code, con, loc, seq, pos) => ccall('poc_new_card', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'], [duel, team, 0, code, con, loc, seq, pos]);
    for (let i = 0; i < 40; i++) { add(0, BOMB, 0, LOC.DECK, i, 1); add(1, BOMB, 1, LOC.DECK, i, 1); }
    add(0, BOMB, 0, LOC.SZONE, 0, 0xA);
    add(1, attackerCode, 1, LOC.MZONE, attackerSeq, 1);
    ccall('poc_start', null, ['number'], [duel]);
    const scratch = ccall('poc_scratch', 'number', [], []);
    const respond = (bytes) => { M.HEAPU8.set(bytes, scratch); ccall('poc_respond', null, ['number', 'number'], [duel, bytes.length]); };
    const state = new GameState(data, data.decks.ishizu, data.decks.gg);
    state.humanPlayer = 0;
    let attackDeclared = false, bombActivated = false;
    const director = (prompt) => {
      const p = prompt.player;
      switch (prompt.name) {
        case 'SELECT_IDLECMD':
          if (p === 1 && prompt.toBP && !attackDeclared) return cmdResp(6, 0);
          if (prompt.toEP) return cmdResp(7, 0);
          if (prompt.toBP) return cmdResp(6, 0);
          return cmdResp(7, 0);
        case 'SELECT_BATTLECMD':
          if (p === 1 && !attackDeclared && prompt.attack && prompt.attack.length) {
            const idx = prompt.attack.findIndex(e => e.code === attackerCode);
            if (idx >= 0) { attackDeclared = true; return cmdResp(1, idx); }
          }
          if (prompt.toM2) return cmdResp(2, 0);
          if (prompt.toEP) return cmdResp(3, 0);
          return cmdResp(3, 0);
        case 'SELECT_CHAIN': {
          if (prompt.forced) return i32resp(0);
          if (p === 0 && !bombActivated) {
            const idx = (prompt.entries || []).findIndex(e => e.code === BOMB);
            if (idx >= 0) { bombActivated = true; return i32resp(idx); }
          }
          return i32resp(-1);
        }
        case 'SELECT_EFFECTYN': return i32resp(0);
        case 'SELECT_YESNO': return i32resp(0);
        case 'SELECT_PLACE': return placeResp([{ con: p, loc: LOC.MZONE, seq: 0 }]);
        case 'SELECT_POSITION': return i32resp(1);
        case 'SELECT_CARD': case 'SELECT_TRIBUTE': return cardsResp(prompt.cards.map((_, i) => i).slice(0, Math.min(prompt.min, prompt.cards.length)));
        case 'SELECT_SUM': {
          const chosen = [];
          const dfs = (k) => { if (Engine.sumSelectionValid(prompt, chosen)) return true; for (let j = k; j < prompt.cards.length; j++) { chosen.push(j); if (dfs(j + 1)) return true; chosen.pop(); } return false; };
          dfs(0); return cardsResp(chosen);
        }
        case 'SELECT_OPTION': return i32resp(0);
        case 'SELECT_UNSELECT_CARD': return Engine.cancelResp();
        default: return i32resp(0);
      }
    };
    let steps = 0;
    while (steps++ < 6000) {
      const status = ccall('poc_process', 'number', ['number'], [duel]);
      const len = ccall('poc_msg_len', 'number', [], []);
      const ptr = ccall('poc_msg_ptr', 'number', [], []);
      const buf = M.HEAPU8.slice(ptr, ptr + len);
      const msgs = splitMessages(buf);
      let pending = null;
      for (const m of msgs) { state.apply(m); if (Engine.SELECT_TYPES.has(m[0])) pending = m; }
      if (state.winner !== null || status === 0 || state.turnCount >= 3) break;
      if (status === 1 && pending) {
        const prompt = parsePrompt(pending);
        if (!prompt) break;
        respond(director(prompt));
      }
    }
    const evs = state.events.filter(e => ['activate', 'destroy', 'damage', 'attack'].includes(e.kind));
    const onField = queryCard(M, duel, 1, LOC.MZONE, attackerSeq);
    const grave = [];
    for (let s = 0; s < 12; s++) { const q = queryCard(M, duel, 1, LOC.GRAVE, s); if (!q) break; grave.push(q.code); }
    ccall('poc_destroy', null, ['number'], [duel]);
    return { evs, lp0: state.players[0].lp, lp1: state.players[1].lp, onField, grave, attackDeclared, bombActivated };
  }

  const M = await factory();
  // Scene A — Luce at the edge (seq 0): its own ① protects it.
  {
    const r = await runScene(M, LUCE, 0);
    const dmg = r.evs.filter(e => e.kind === 'damage');
    ok(r.attackDeclared && r.bombActivated, 'R2-A1: scene A reached the bomb chain on the direct attack');
    ok(!r.evs.some(e => e.kind === 'destroy' && e.code === LUCE), 'R2-A2: edge Luce is NOT destroyed (its ① covers its own edge zone)');
    ok(dmg.length === 1 && dmg[0].player === 0 && dmg[0].amount === 3500, 'R2-A3: the only damage is the 3500 battle damage to the bomb owner (the attack proceeds)');
    ok(r.lp0 === 4500 && r.lp1 === 8000, 'R2-A4: LP lands exactly as the field report: owner 4500, opponent 8000');
    ok(!!r.onField && r.onField.code === LUCE, 'R2-A5: core query — Luce is still on the field');
  }
  // Scene B — the same Luce in the center (seq 2): outside its ①.
  {
    const r = await runScene(M, LUCE, 2);
    const dmg = r.evs.filter(e => e.kind === 'damage');
    ok(r.evs.some(e => e.kind === 'destroy' && e.code === LUCE), 'R2-B1: center Luce IS destroyed by the bomb');
    ok(dmg.length === 2 && dmg[0].player === 1 && dmg[0].amount === 3500 && dmg[1].player === 0 && dmg[1].amount === 3500, 'R2-B2: the opponent takes 3500 effect damage, then the owner takes 3500 (no 現世と冥界の逆転 in the GY)');
    ok(r.lp0 === 4500 && r.lp1 === 4500 && r.grave.includes(LUCE), 'R2-B3: LP 4500/4500 and Luce is in the graveyard');
  }
  // Scene C — an unprotected attacker at the edge.
  {
    const r = await runScene(M, SPHINX, 0);
    const dmg = r.evs.filter(e => e.kind === 'damage');
    ok(r.evs.some(e => e.kind === 'destroy' && e.code === SPHINX), 'R2-C1: the unprotected attacker is destroyed');
    ok(dmg.length === 2 && dmg[0].amount === 2500 && dmg[1].amount === 2500 && r.lp0 === 5500 && r.lp1 === 5500, 'R2-C2: both players take its 2500 original ATK as effect damage; no battle damage follows');
  }

  console.log(failures === 0 ? 'ALL FIX1113C CHECKS PASSED' : failures + ' FIX1113C CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
