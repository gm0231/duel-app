'use strict';
/* LF4 L2 probe: does any client-visible dlog snapshot carry a WRONG
   Xyz host name for a material line, even though the FINAL dlog is
   correct (K3 rewrite)? Simulates the client's render cadence: one
   snapshot per engine onUpdate (one poc_process call), then feeds
   the snapshots through the client's own captureDLog alignment
   (dlogKey includes `s`) to show the duplicate/wrong-name rows the
   history sheet would actually accumulate. */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const name = (c) => data.names[c];

function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}
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
// over the snapshot stream — to show what the history sheet
// accumulates, not just what the final engine state holds.
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
    const finalWrong = finalMat.filter(e => !e.s.includes('《' + targetName + '》'));
    // Any snapshot carrying a material line whose host is NOT the summoned monster?
    let snapWrong = 0, snapWrongSamples = [];
    for (let i = 0; i < snapshots.length; i++) {
      for (const e of snapshots[i]) {
        if (typeof e.s === 'string' && e.s.includes('エクシーズ素材になった') && !e.s.includes('《' + targetName + '》')) {
          snapWrong++;
          if (snapWrongSamples.length < 3) snapWrongSamples.push({ snap: i, s: e.s });
        }
      }
    }
    const hist = simulateCapture(snapshots);
    const histMat = hist.filter(t => t.includes('エクシーズ素材になった'));
    const histWrong = histMat.filter(t => !t.includes('《' + targetName + '》'));
    const counts = {};
    for (const t of hist) counts[t] = (counts[t] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, n]) => n > 1).slice(0, 5);
    console.log('=== ' + key + ' (target ' + targetName + ') summoned=' + summoned + ' snapshots=' + snapshots.length);
    console.log('  final dlog material lines: ' + finalMat.length + ', wrong: ' + finalWrong.length);
    console.log('  snapshots with a WRONG-host material line: ' + snapWrong, JSON.stringify(snapWrongSamples));
    console.log('  simulated history: ' + hist.length + ' rows; material rows: ' + histMat.length + ', wrong: ' + histWrong.length);
    console.log('  wrong history rows: ' + JSON.stringify(histWrong.slice(0, 4)));
    console.log('  duplicated rows (sample): ' + JSON.stringify(dupes));
  }
  process.exit(0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
