'use strict';
/* test-zolga.js — regression for the Zolga confirmation defect
   (user report 2026-11-03: "ゾルガの相手のデッキ見る効果、なんか
   ちゃんとできてない気がする").
   Root cause found by triage: the core DID send MSG_CONFIRM_CARDS for
   both decks and the engine parsed it correctly, but the message only
   updated the mirror's knowledge — no event, no log — so the client
   had nothing to present and the "look at the top 5 of both decks"
   resolved invisibly (at most the single top card surfaced later in
   the deck pile sheet).
   Part 1 (engine, headless): drives Zolga (31525442) effect 1 in a
   stacked-deck duel and asserts the wire truth reaches the state as
   'confirm' events: two events (own deck + opponent deck), 5 entries
   each, activator as shown player, codes identical to the raw
   messages, deckTop consistent with the topmost entry, and a log line.
   Part 2 (client, jsdom; skipped when jsdom is unresolvable): boots
   the real client, feeds it confirm events shaped like Zolga's, and
   asserts the reveal sheet lists both decks top-first with working
   card-detail rows and a close button that resolves the wait. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const { i32resp, cmdResp, placeResp, Reader } = Engine;

const ZOLGA = 31525442, VERN = 36745317; // 森と目覚の春化精: Lv4 EARTH Fairy, normal-summonable
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
class Stop extends Error {}

async function attempt(M, data, attemptNo) {
  const filler = data.decks.ishizu.main.filter(c => c !== ZOLGA && c !== VERN);
  const main0 = [].concat(Array(10).fill(VERN), Array(10).fill(ZOLGA), filler).slice(0, 40);
  const res = { summoned: false, zolgaTried: false, rawConfirms: [], done: false };
  let promptsAfter = 0;
  const mem = Engine.makeBotMemory();
  const humanAnswerer = async (prompt, state) => {
    if (res.zolgaTried && res.rawConfirms.length >= 2) { if (++promptsAfter > 2) throw new Stop('captured'); }
    if (state.turnCount > 6) throw new Stop('too late');
    switch (prompt.name) {
      case 'SELECT_IDLECMD': {
        if (!res.summoned) {
          const i = prompt.summon.findIndex(e => e.code === VERN);
          if (i >= 0) { res.summoned = true; return cmdResp(0, i); }
        }
        if (res.summoned && !res.zolgaTried) {
          const i = prompt.activate.findIndex(e => e.code === ZOLGA && e.loc === Engine.LOC.HAND);
          if (i >= 0) { res.zolgaTried = true; return cmdResp(5, i); }
        }
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return Engine.botAnswer(prompt, state, data, mem);
      }
      case 'SELECT_CHAIN': return i32resp(-1);
      case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return i32resp(0);
      case 'ANNOUNCE_NUMBER': {
        let best = 0; prompt.options.forEach((v, i) => { if (v >= prompt.options[best]) best = i; });
        return i32resp(best); // always look at the maximum (5 when possible)
      }
      case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
        const avail = (~prompt.flag) >>> 0;
        const cells = [];
        for (let s = 0; s < 7; s++) if (avail & (1 << s)) cells.push({ con: prompt.player, loc: 0x04, seq: s });
        for (let s = 0; s < 5; s++) if (avail & (0x100 << s)) cells.push({ con: prompt.player, loc: 0x08, seq: s });
        return placeResp(cells.slice(0, prompt.count));
      }
      case 'SELECT_POSITION': return i32resp(1);
      default: return Engine.botAnswer(prompt, state, data, mem);
    }
  };
  const duel = new Engine.Duel(M, data, {
    seed: 20261103 + attemptNo,
    pace: { bot: 0, botChain: 0, batch: 0 },
    sleep: () => Promise.resolve(),
    deckP0: { main: main0, extra: [] }, deckP1: data.decks.gg,
    humanAnswerer,
    botAnswerer: (p, s, d, m) => Engine.botAnswer(p, s, d, m),
    onMessage: (m) => {
      if (m[0] === 31 && res.zolgaTried) {
        const r = new Reader(m, 1);
        const shown = r.u8(); const n = r.u32();
        const entries = [];
        for (let i = 0; i < n; i++) { const code = r.u32(); const con = r.u8(); const loc = r.u8(); const seq = r.u32(); entries.push({ code, con, loc, seq }); }
        if (entries.length && entries[0].loc === Engine.LOC.DECK) res.rawConfirms.push({ shown, entries });
      }
    },
  });
  try { await duel.run(); } catch (e) { if (!(e instanceof Stop)) throw e; }
  res.state = duel.state;
  res.done = res.rawConfirms.length >= 2;
  return res;
}

async function part1() {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  let res = null;
  for (let a = 1; a <= 15 && !res; a++) {
    const r = await attempt(M, data, a);
    if (r.done) res = r;
  }
  ok(!!res, 'Z1: Zolga scenario fired (special summon + both deck looks) within 15 attempts');
  if (!res) return;
  const st = res.state;
  ok(st.players[0].mzone.some(c => c && c.code === ZOLGA), 'Z2: Zolga was special summoned to the field');
  const evs = st.events.filter(e => e.kind === 'confirm');
  ok(evs.length >= 2, 'Z3: engine emitted confirm events (got ' + evs.length + ')');
  const byCon = {};
  for (const ev of evs) for (const c of ev.cards) if (c.loc === Engine.LOC.DECK) (byCon[c.con] = byCon[c.con] || []).push({ ev, c });
  for (const con of [0, 1]) {
    const list = byCon[con] || [];
    ok(list.length === 5, 'Z4-' + con + ': confirm event carries 5 deck cards for con ' + con + ' (got ' + list.length + ')');
    ok(list.every(x => x.ev.shown === 0), 'Z5-' + con + ': shown player is the activator (seat 0)');
    ok(list.every(x => x.c.code > 0 && data.cards[x.c.code]), 'Z6-' + con + ': all confirmed codes are real pool cards');
    // event truth == wire truth (multiset of codes per controller)
    const evCodes = list.map(x => x.c.code).sort((a, b) => a - b);
    const rawCodes = res.rawConfirms.filter(rc => rc.entries[0].con === con)
      .flatMap(rc => rc.entries.map(e => e.code)).sort((a, b) => a - b);
    ok(JSON.stringify(evCodes) === JSON.stringify(rawCodes), 'Z7-' + con + ': event codes match the raw MSG_CONFIRM_CARDS codes');
    // deckTop must be the topmost (max seq) confirmed card
    const top = list.slice().sort((a, b) => b.c.seq - a.c.seq)[0];
    ok(st.deckTop[con] === top.c.code, 'Z8-' + con + ': state.deckTop is the topmost confirmed card (' + (data.names[st.deckTop[con]] || st.deckTop[con]) + ')');
  }
  ok(st.log.some(l => l.startsWith('確認：')), 'Z9: a confirmation line was written to the duel log');
}

async function part2() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP part 2: jsdom not resolvable (set NODE_PATH)'); return; }
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const wasmBinary = fs.readFileSync(path.join(__dirname, 'build', 'ocgcore.wasm'));
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; } play() { return Promise.resolve(); } pause() {} };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => String(url).includes('ocgcore.wasm')
    ? { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf }
    : { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(__dirname, file), 'utf8');
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
  ok(!!window.__confirm, 'C1: client exposes the confirm surface');
  if (!window.__confirm) { window.close(); return; }
  // synthetic Zolga-shaped events: entries deliberately out of seq order
  const own = data.decks.ishizu.main.slice(0, 5);   // con 0 deck
  const opp = data.decks.gg.main.slice(0, 5);       // con 1 deck
  const seqs = [30, 34, 31, 33, 32];                // display order must be idx 1,3,4,2,0
  const mk = (codes, con) => ({ kind: 'confirm', shown: 0, cards: codes.map((code, i) => ({ code, con, loc: 1, seq: seqs[i] })) });
  window.__confirm.push(mk(own, 0));
  window.__confirm.push(mk(opp, 1));
  let resolved = false;
  const p = window.__confirm.show().then(() => { resolved = true; });
  await new Promise(r => setTimeout(r, 60));
  const sheet = window.document.getElementById('sheet');
  const text = sheet.textContent;
  ok(text.includes('カードの確認'), 'C2: reveal sheet opens with its title');
  ok(text.includes('自分のデッキ（上から）') && text.includes('相手のデッキ（上から）'), 'C3: both decks are sectioned (own + opponent)');
  const rows = [...sheet.querySelectorAll('[data-info]')];
  const rowCodes = rows.map(r => +r.dataset.info);
  const expectCodes = [1, 3, 4, 2, 0].map(i => own[i]).concat([1, 3, 4, 2, 0].map(i => opp[i]));
  ok(JSON.stringify(rowCodes) === JSON.stringify(expectCodes),
    'C4: rows are both decks, top-first (highest seq first): ' + rowCodes.map(c => data.names[c]).join(' / '));
  ok(rows.slice(0, 5).every((r, i) => r.textContent.includes((i + 1) + '枚目')), 'C5: deck rows are numbered from the top');
  // a row opens the floating card detail OVER the sheet, sheet intact
  const row = rows[0];
  ok(!!row, 'C6: rows carry card-detail hooks');
  if (row) {
    row.click();
    await new Promise(r => setTimeout(r, 30));
    const pop = window.document.getElementById('infopop');
    ok(pop.className === 'on' && pop.textContent.includes(data.names[+row.dataset.info]), 'C7: row tap opens that card\'s detail');
    window.document.getElementById('infopop-close').click();
    await new Promise(r => setTimeout(r, 30));
    ok(window.document.getElementById('sheet').textContent.includes('カードの確認'), 'C7b: closing the detail returns to the intact confirm sheet');
  }
  window.document.getElementById('sheet-cancel').click();
  await p;
  ok(resolved, 'C8: close button resolves the presentation wait');
  // C9/C10: the confirm sheet is a view sheet — the x button and a
  // backdrop tap are the same single exit (C-20) and must ALSO settle
  // the wait; before the fix they closed the sheet and stranded the
  // promise in humanAnswerer, freezing the duel for good.
  const settles = async (closeFn, label) => {
    window.__confirm.push(mk(own, 0));
    let done = false;
    const q = window.__confirm.show().then(() => { done = true; });
    await new Promise(r => setTimeout(r, 40));
    closeFn();
    await Promise.race([q, new Promise(r => setTimeout(r, 400))]);
    ok(done, label);
  };
  await settles(() => window.document.getElementById('sheetx').click(), 'C9: x button resolves the presentation wait');
  await settles(() => window.document.getElementById('sheetwrap').click(), 'C10: backdrop tap resolves the presentation wait');
  // C11-C14: SELECT_UNSELECT_CARD button truthfulness. Both buttons
  // send -1; the core finishes with the current selection when a
  // finishable selection reaches min and cancels when nothing is
  // selected, so 選ばずにやめる may only appear while -1 cancels.
  ok(!!window.__unselect, 'C11: client exposes the unselect surface');
  if (window.__unselect) {
    const stub = (i) => ({ code: own[i % own.length], con: 0, loc: 4, seq: i });
    const open = (over) => window.__unselect.open(Object.assign(
      { select: [stub(0), stub(1)], unselect: [], min: 1, max: 2, finishable: true, cancelable: true }, over));
    const doc = window.document;
    open({ unselect: [stub(2)] });
    ok(!!doc.getElementById('unselect-finish') && !doc.getElementById('unselect-cancel'),
      'C12: finishable + selection >= min offers 決定 only (no fake cancel)');
    open({ unselect: [] });
    ok(!doc.getElementById('unselect-finish') && !!doc.getElementById('unselect-cancel'),
      'C13: nothing selected offers 選ばずにやめる only');
    open({ unselect: [stub(2)], finishable: false });
    ok(!!doc.getElementById('unselect-cancel'), 'C14: non-finishable cancelable prompt keeps its cancel');
    open({ unselect: [stub(2)], min: 2 });
    ok(!doc.getElementById('unselect-finish') && !doc.getElementById('unselect-cancel') &&
      doc.getElementById('sheet').textContent.includes('あと1枚'),
      'C14b: mid-selection shows no button and states the remainder');
  }
  window.close();
}

(async () => {
  await part1();
  await part2();
  console.log(failures === 0 ? 'ALL ZOLGA CHECKS PASSED' : failures + ' ZOLGA CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
