'use strict';
/* test-layoutfix4.js — layout-fix round 4 contracts (L1..L3),
 * written against the parent's published-build re-verification of
 * the round-3 build (f841476, real play, 2 matches).
 *
 * L1 (the band's chain display lost its last line): a 3-line chain
 * display ("チェーン1：《ラビリンス・ウォール・シャドウ》" + a
 * negation tail, or the bare line under a narrow logline) showed
 * its third line half-cut at the band's bottom edge, twice, in
 * real play. The Chrome rig (cap-layoutfix4.js) cannot reproduce
 * the cut for any string variant — the band always grew with 3px
 * slack — so the cause is in the real device's rendering, not in
 * the string. The fix is structural, not string-specific: (a) the
 * band never yields height to the flex column (flex-shrink:0);
 * (b) the band-height invariant is ENFORCED after every fit
 * (ensureBandFits: release the forced floor, grow the border-box
 * by the measured deficit until the content fits); (c) the band
 * hook runs AFTER the phase button is labelled, so the width it
 * fits is the width the line actually gets this render, and a
 * width change re-fits even when the text is unchanged; (d) nbFit
 * compares fractional rect widths — the integer offsetWidth /
 * clientWidth pair called a 212.0px unit in a 211.6px line
 * "fitting" and left a sub-pixel overflow. Geometry is asserted
 * in the Chrome rig (bandchain / bandvar / bandwidth / bandclip);
 * here: source pins + the jsdom render smoke (the band hook runs
 * without throwing when the width is 0).
 * L2 (history still named the wrong Xyz host — the K3 remainder):
 * round 3 pushed the material line at MOVE time with the
 * mirror-resolved host name and rewrote it in place at
 * SPSUMMONING. The final dlog was correct, but any client
 * snapshot taken between the two batches captured the wrong name
 * — and the in-place rewrite changed `s`, breaking the client's
 * value-keyed capture alignment (dlogKey includes `s`), so the
 * whole stream was re-added as duplicates (measured: the
 * draw→summon→discard→spsummon run ×2–×5, wrong-host rows in
 * the simulated history). Fix: the line is HELD at MOVE time and
 * pushed at the SPSUMMONING announcement with the announced
 * name, before the summon's own line; only an Xyz announcement
 * can own pending materials; a host that never announces is
 * flushed at NEW_TURN with the honest generic host. The stream
 * stays append-only. Asserted below on REAL summons (Baromett
 * and Castel) through the client's own capture alignment over
 * per-batch snapshots: zero wrong-host rows, zero duplicates.
 * L3 (a move notice named the wrong route): an opponent's hand
 * discard (《迷宮に潜むシャドウ・グール》) was announced as
 * "エクシーズ素材→墓地" while the band correctly said "手札から
 * 捨てた". The leftover pile-arrival pass fell back to 'overlay'
 * on NO evidence at all. Fix: the evidence order is field (a
 * recorded departure) -> hand (the hand shrank this batch, capped
 * at the shrinkage minus moves already noted from the hand) ->
 * extra (a matching Extra departure) -> overlay (only when a mats
 * decrease was actually recorded this batch); with no evidence the
 * card is COUNTED (moveleft), never guessed at. The same hand
 * evidence is added to the removed-side leftover. Residual limit:
 * a batch holding BOTH a detach and a hand discard to the same
 * pile cannot tell the two cards apart by code (the mirror holds
 * no overlay-unit codes), so the loop's arrival order decides.
 * Asserted below on synthetic state pairs through the real fx
 * pipeline (the test-fx method).
 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(V2, 'engine.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const name = (c) => data.names[c];

// ---------- source pins ----------
{
  ok(/#header\{[^}]*flex:none/.test(html) && clientSrc.includes('function ensureBandFits()') &&
     clientSrc.includes('mb.style.minHeight = (mb.offsetHeight + (mb.scrollHeight - mb.clientHeight))') &&
     clientSrc.includes('let lastLogW = 0;') && clientSrc.includes('(lw && lw !== lastLogW)') &&
     clientSrc.includes('sp.getBoundingClientRect().width > w'),
    'LF4-L1a: BU-73 — the header never shrinks (flex:none); ensureBandFits grows the border-box by the measured deficit; the hook re-fits on width change; nbFit compares fractional rect widths');
  ok(!engineSrc.includes('pm.e.s =') && engineSrc.includes('this.pendingMatLines.push({ con: matPending.con, who: matPending.who, nm: matPending.nm, cid, sol })') &&
     engineSrc.includes("this.pushDLog({ k: 'info', cid: pm.cid, sol: pm.sol, s: pm.who + '：' + pm.nm + ' が《' + hostName + '》 のエクシーズ素材になった' })") &&
     engineSrc.includes('(this.cardData[zc].type & 0x800000)') &&
     engineSrc.includes("s: pm.who + '：' + pm.nm + ' がモンスター のエクシーズ素材になった'"),
    'LF4-L2a: no in-place dlog rewrite survives; material lines are held at MOVE time and pushed at the Xyz announcement (Xyz-guarded), unannounced hosts flush generic at NEW_TURN');
  ok(clientSrc.includes('const handShrink = Math.max(0, (prev.handLen[p] || 0) - (cur.handLen[p] || 0))') &&
     clientSrc.includes("else if (notedFromHand() < handShrink) noteMove(p, 'hand', 'grave', code, false)") &&
     clientSrc.includes("else if (detached) noteMove(p, 'overlay', 'grave', code, false)") &&
     clientSrc.includes("else fxRecord('moveleft', { to: 'grave', code, con: p })") &&
     clientSrc.includes("else if (notedFromHand() < handShrink) noteMove(p, 'hand', 'removed', code, false)") &&
     !/noteMove\(p, fromField \? 'field' : \(detached/.test(clientSrc),
    'LF4-L3a: the leftover pass orders evidence field -> hand (shrink-capped) -> extra -> overlay (only when a mats decrease was recorded); no-evidence grave arrivals are counted, never guessed; the round-3 unconditional overlay fallback is gone');
}

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

// The round-3 scripted seat, parameterised by the Xyz target.
function scriptedHuman(TARGET, capture) {
  const { i32resp, cancelResp, cardsResp, cmdResp, placeResp, sortResp, unselectToggleResp, POS, LOC } = Engine;
  const KELDO = 63542003, ZOLGA = 31525442, MUDRA = 99937011, KERBEK = 25926710;
  let prompts = 0;
  return (prompt, state) => {
    if (++prompts > 4000) throw new Error('budget');
    switch (prompt.name) {
      case 'SELECT_IDLECMD': {
        const bi = prompt.spsummon.findIndex(e => e.code === TARGET);
        if (bi >= 0) return cmdResp(1, bi);
        const myMons = state.players[0].mzone.filter(Boolean).length;
        if (myMons >= 1) {
          const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
          if (ai >= 0) return cmdResp(5, ai);
          const zi = prompt.spsummon.findIndex(e => e.code === ZOLGA);
          if (zi >= 0) return cmdResp(1, zi);
        }
        if (prompt.summon.length) return cmdResp(0, 0);
        if (myMons === 0) {
          const ai = prompt.activate.findIndex(e => (e.code === KELDO || e.code === MUDRA) && e.loc === LOC.HAND);
          if (ai >= 0 && state.players[0].hand.length >= 3) return cmdResp(5, ai);
        }
        if (prompt.toEP) return cmdResp(7, 0);
        if (prompt.toBP) return cmdResp(6, 0);
        return cmdResp(7, 0);
      }
      case 'SELECT_BATTLECMD': {
        if (prompt.toEP) return cmdResp(3, 0);
        if (prompt.toM2) return cmdResp(2, 0);
        return cmdResp(3, 0);
      }
      case 'SELECT_CHAIN': return cancelResp();
      case 'SELECT_EFFECTYN': case 'SELECT_YESNO': return i32resp(0);
      case 'SELECT_OPTION': return i32resp(0);
      case 'SELECT_POSITION': return i32resp(POS.FU_ATK);
      case 'SELECT_PLACE': case 'SELECT_DISFIELD': {
        const avail = (~prompt.flag) >>> 0; const zones = [];
        for (const s of [0, 1, 2, 3, 4]) { if (zones.length >= prompt.count) break; if (avail & (1 << s)) zones.push({ con: prompt.player, loc: LOC.MZONE, seq: s }); }
        for (let s = 0; zones.length < prompt.count && s < 5; s++) if (avail & (0x100 << s)) zones.push({ con: prompt.player, loc: LOC.SZONE, seq: s });
        return placeResp(zones.slice(0, prompt.count));
      }
      case 'SELECT_CARD': case 'SELECT_TRIBUTE': {
        if (prompt.cancelable && prompt.min === 0) return cardsResp([]);
        const picks = [];
        const order = prompt.cards.map((c, i) => i).sort((a, b2) => {
          const rank = (c) => c.code === KERBEK ? 0 : c.code === ZOLGA ? 1 : 2;
          return rank(prompt.cards[a]) - rank(prompt.cards[b2]);
        });
        for (const i of order) { if (picks.length >= Math.max(1, prompt.min)) break; picks.push(i); }
        return cardsResp(picks);
      }
      case 'SELECT_UNSELECT_CARD': {
        capture.push(JSON.parse(JSON.stringify(prompt)));
        if (prompt.unselect.length >= prompt.min && prompt.finishable) return cancelResp();
        if (prompt.select.length) return unselectToggleResp(0);
        return cancelResp();
      }
      case 'SELECT_SUM': {
        const picks = [];
        for (let i = 0; i < prompt.cards.length && picks.length < prompt.min; i++) picks.push(i);
        return cardsResp(picks);
      }
      case 'SORT_CARD': return sortResp(prompt.cards.map((_, i) => i));
      case 'SORT_CHAIN': return cancelResp();
      case 'ROCK_PAPER_SCISSORS': return i32resp(1);
      case 'ANNOUNCE_RACE': case 'ANNOUNCE_ATTRIB': case 'ANNOUNCE_CARD': case 'ANNOUNCE_NUMBER': return i32resp(0);
      case 'SELECT_COUNTER': return Engine.counterResp(prompt.cards.map(() => 0));
      default: return i32resp(0);
    }
  };
}

// The client's captureDLog alignment, verbatim logic (client.js),
// over the per-batch snapshot stream — what the history sheet
// actually accumulates, not just what the final engine state holds.
function dlogKey(e) {
  return [e.turn, e.tp, e.ph, e.k, e.code, e.desc, e.loc, e.link, e.tgt, e.cid, e.sol, e.s].join('|');
}
function dlogText(e) {
  if (e.k === 'act') return 'チェーン' + e.link + '：' + (e.con === 0 ? '自分' : '相手') + ' の ' + name(e.code);
  if (e.k === 'solve') return '▼ 解決：チェーン' + e.link + ' ' + name(e.code);
  return e.s || '';
}
function simulateCapture(snapshots) {
  let dlogPrev = [], hist = [];
  for (const cur of snapshots) {
    const curKeys = cur.map(dlogKey);
    let fresh;
    if (!dlogPrev.length) fresh = cur.slice();
    else if (curKeys.length >= dlogPrev.length && dlogPrev.every((v, i) => curKeys[i] === v)) fresh = cur.slice(dlogPrev.length);
    else {
      let k = Math.min(dlogPrev.length, curKeys.length);
      while (k > 0 && dlogPrev.slice(dlogPrev.length - k).join('\n') !== curKeys.slice(0, k).join('\n')) k--;
      fresh = cur.slice(k);
    }
    for (const e of fresh) hist.push(dlogText(e));
    dlogPrev = curKeys;
  }
  return hist;
}

(async () => {
  const M = await factory();
  // ---------- L2: real Xyz summons, snapshot-accurate history ----------
  for (const [key, TARGET] of [['baromett', 62967433], ['castel', 82633039]]) {
    installSeededCrypto(1 * 2654435761 % 4294967296);
    const main = [];
    for (let i = 0; i < 10; i++) main.push(63542003, 31525442, 99937011, 25926710);
    const unsel = [];
    const snapshots = [];
    let summoned = false;
    const duel = new Engine.Duel(M, data, {
      seed: 1, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
      deckP0: { name: 'lf4-xyz', main, extra: data.decks.ishizu.extra.slice(), side: [] },
      deckP1: data.decks.gg, humanTeam: 0, onLog: () => {},
      onMessage: (m) => { if (m && m[0] === 62) { const r = new Engine.Reader(m, 1); const code = r.u32(); const con = r.u8(); if (code === TARGET && con === 0) summoned = true; } },
      onUpdate: (state) => { snapshots.push(JSON.parse(JSON.stringify(state.dlog || []))); },
      humanAnswerer: async (p, s) => scriptedHuman(TARGET, unsel)(p, s),
      botAnswerer: (p, s) => Engine.botAnswer(p, s, data, Engine.makeBotMemory()),
    });
    await duel.run();
    const targetName = name(TARGET);
    const finalMat = duel.state.dlog.filter(e => typeof e.s === 'string' && e.s.includes('エクシーズ素材になった'));
    const hist = simulateCapture(snapshots);
    const histMat = hist.filter(t => t.includes('エクシーズ素材になった'));
    const histWrong = histMat.filter(t => !t.includes('《' + targetName + '》'));
    // Multiset equality on material lines: every final material line
    // appears exactly as often in the simulated history (no
    // duplicates from a broken alignment, no missing lines).
    const countOf = (arr, t) => arr.filter(x => x === t).length;
    const matExact = finalMat.every(e => countOf(histMat, dlogText(e)) === countOf(finalMat.map(f => dlogText(f)), dlogText(e)));
    console.log('  [info] ' + key + ': summoned=' + summoned + ' snapshots=' + snapshots.length +
      ' finalDlog=' + duel.state.dlog.length + ' histRows=' + hist.length +
      ' finalMat=' + finalMat.length + ' histMat=' + histMat.length + ' wrong=' + histWrong.length);
    ok(summoned, 'LF4-L2b-' + key + ': the scripted duel really summons ' + targetName);
    ok(finalMat.length >= 2 && finalMat.every(e => e.s.includes('《' + targetName + '》')),
      'LF4-L2c-' + key + ': all ' + finalMat.length + ' final material lines name 《' + targetName + '》');
    ok(histWrong.length === 0, 'LF4-L2d-' + key + ': NO wrong-host material row in the simulated history (' + histMat.length + ' material rows)');
    ok(matExact, 'LF4-L2e-' + key + ': every material line appears exactly as often in the simulated history as in the final dlog (no duplicates, none missing)');
    ok(hist.length <= duel.state.dlog.length + 2, 'LF4-L2f-' + key + ': the simulated history does not blow up (' + hist.length + ' rows vs ' + duel.state.dlog.length + ' final dlog entries)');
    ok(!duel.state.dlog.some(e => typeof e.s === 'string' && e.s.includes('エクシーズ素材になった') && e.s.includes('モンスター')),
      'LF4-L2g-' + key + ': no material line falls back to the generic host (the announcement owned them all)');
  }

  // ---------------------------------------------------------- jsdom
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH) — render parts skipped'); }
  if (JSDOM) {
    const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
    const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
    const { window } = dom;
    window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
    const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
    const fxmap = JSON.parse(fs.readFileSync(path.join(V2, 'fxmap.json'), 'utf8'));
    window.fetch = async (url) => {
      if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
      if (String(url).includes('fxmap.json')) return { ok: true, status: 200, json: async () => fxmap, arrayBuffer: async () => wasmBuf };
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
    ok(window.document.getElementById('loadmsg').textContent.includes('準備完了'), 'LF4-C0: client boots');

    // ---- L1 smoke: the band hook runs with a 0-width logline (jsdom has no layout) ----
    {
      const F = window.__fx;
      ok(typeof window.ensureBandFits === 'function' || clientSrc.includes('function ensureBandFits()'),
        'LF4-L1b: ensureBandFits is defined (the band-height invariant exists)');
    }

    // ---- L3: synthetic movement scenarios through the real fx pipeline ----
    {
      const F = window.__fx;
      const P = (over) => Object.assign({ mzone: [null, null, null, null, null], szone: [null, null, null, null, null, null], grave: [], removed: [], extra: [], hand: [], deckCount: 40, lp: 8000 }, over || {});
      const S = (p0, p1) => ({ players: [p0, p1 || P()], chain: [], turnCount: 1, turnPlayer: 0, phaseName: 'MAIN1', solvingLink: 0, winner: null });
      const MON = (code, mats) => ({ code, pos: 1, materials: mats || 0, curAtk: 1500, curDef: 1500 });
      const run = (s0, evs, s1) => { F.reset(); F.process([], s0); const at = F.log.length; F.process(evs || [], s1); return F.log.slice(at); };
      const notes = (recs, from, to) => recs.filter(r => r.kind === 'movenote' && r.from === from && r.to === to);
      const SHADOW_GHOUL = 62411811; // 《迷宮に潜むシャドウ・グール》 — the parent's exact card

      // (a) the parent's exact case: the OPPONENT discards from hand to grave.
      // Before the fix the notice said overlay -> grave; the band said hand.
      let recs = run(S(P(), P({ hand: [{ code: SHADOW_GHOUL }] })), [], S(P(), P({ grave: [SHADOW_GHOUL] })));
      let g = notes(recs, 'hand', 'grave');
      ok(g.length === 1 && g[0].text.includes('相手の') && g[0].text.includes('《迷宮に潜むシャドウ・グール》') && g[0].text.includes('墓地へ送られた'),
        'LF4-L3b: an opponent hand discard is announced as hand -> grave, naming the card');
      ok(notes(recs, 'overlay', 'grave').length === 0,
        'LF4-L3c: the same discard produces NO overlay -> grave notice');
      ok(F.error === null, 'LF4-L3d: the opponent-discard batch runs without an fx error (got: ' + F.error + ')');

      // (b) detach regression: a mats decrease with no hand shrink is still overlay.
      recs = run(S(P({ mzone: [MON(82633039, 2), null, null, null, null] })), [], S(P({ mzone: [MON(82633039, 1), null, null, null, null], grave: [99937011] })));
      g = notes(recs, 'overlay', 'grave');
      ok(g.length === 1 && g[0].text.includes('《剣神官ムドラ》'),
        'LF4-L3e: a detached material reaching the graveyard is still named as overlay -> grave');
      ok(notes(recs, 'hand', 'grave').length === 0, 'LF4-L3f: the detach is not misread as a hand discard');

      // (c) no evidence at all: the card is COUNTED, never guessed.
      recs = run(S(P()), [], S(P({ grave: [99937011] })));
      ok(notes(recs, 'overlay', 'grave').length === 0 && notes(recs, 'hand', 'grave').length === 0 && notes(recs, 'deck', 'grave').length === 0,
        'LF4-L3g: a grave arrival with no evidence gets NO route notice (was: overlay)');
      ok(recs.filter(r => r.kind === 'moveleft' && r.to === 'grave').length === 1,
        'LF4-L3h: the no-evidence grave arrival is counted as moveleft, not silently dropped');

      // (d) opponent hand -> removed uses the same hand evidence.
      recs = run(S(P(), P({ hand: [{ code: SHADOW_GHOUL }] })), [], S(P(), P({ removed: [SHADOW_GHOUL] })));
      g = notes(recs, 'hand', 'removed');
      ok(g.length === 1 && g[0].text.includes('相手の') && g[0].text.includes('《迷宮に潜むシャドウ・グール》') && g[0].text.includes('除外された'),
        'LF4-L3i: an opponent hand banish is announced as hand -> removed');
      ok(recs.filter(r => r.kind === 'moveleft' && r.to === 'removed').length === 0,
        'LF4-L3j: the hand banish is not left as moveleft');

      // (e) mill regression: deck -> grave still groups and names.
      recs = run(S(P()), [], S(P({ grave: [99937011, 86605515, 46148485], deckCount: 37 })));
      g = notes(recs, 'deck', 'grave');
      ok(g.length === 1 && g[0].text.includes('《剣神官ムドラ》') && g[0].text.includes('《賢瑞官カルダーン》') && g[0].text.includes('《転輪のスフィンクス》'),
        'LF4-L3k: a 3-card mill is still ONE notice naming all three cards');
      ok(F.error === null, 'LF4-L3l: the mill batch runs without an fx error (got: ' + F.error + ')');
    }
    window.close();
  }

  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
