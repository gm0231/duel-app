'use strict';
/* test-layoutfix.js — layout-fix round (J1-J5) contracts.
 *
 * J1: selection sheets take the chain dock's structure — the wrap
 *     is viewport-fixed, the sheet's height budget rides the
 *     conservative --appvh, grid sheets are flex columns whose
 *     ONLY scroller is the candidate region, the confirm row is an
 *     in-flow flex child, and tile effect text is unclamped.
 * J2: the mid band may grow (62px minimum, no frozen height); the
 *     band line never splits a 《card name》; and the ENGINE's band
 *     feed (state.log) now carries field departures and the other
 *     outcome classes that used to stay dlog-only (verified over
 *     real duels below: outcome lines exist, no '#0' ever prints).
 * J3: fxNotice queues (no silent replacement) and the departure /
 *     destruction announcements are outcome-based, not gated on
 *     seat+turn+face-up.
 * J4: the chain dock names its trigger via prompt.context /
 *     prompt.trigger, and candidates carry the FULL effect body.
 *     Engine side: SELECT_CHAIN prompts with an empty chain get a
 *     same-turn+phase trigger attached when one exists.
 * J5: history says チェーン (never リンク); the result screen has
 *     a history entry; own-set veil breath is .78-.92; a monster
 *     lying in the S/T zone gets no ATK/DEF plate or marks chip.
 */
const fs = require('fs');
const path = require('path');
const factory = require(path.join(__dirname, 'build', 'ocgcore.js'));
const Engine = require(path.join(__dirname, 'engine.js'));

let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
const ruleDecls = (re) => {
  const m = html.match(re); if (!m) return null;
  const out = {};
  for (const part of m[1].split(';')) { const kv = part.split(':'); if (kv.length >= 2) out[kv[0].trim()] = kv.slice(1).join(':').trim(); }
  return out;
};

// ---------- J1: sheet structure ----------
{
  const wrap = ruleDecls(/#sheetwrap\{([^}]*)\}/);
  ok(!!wrap && wrap.position === 'fixed', 'LF-J1a: #sheetwrap is viewport-fixed (the sheet can no longer anchor below the visible fold)');
  const sheet = ruleDecls(/#sheet\{([^}]*)\}/);
  ok(!!sheet && /var\(--appvh/.test(sheet['max-height'] || '') && /100dvh - 108px/.test(sheet['max-height'] || ''),
    'LF-J1b: #sheet height budget = dock discipline (100dvh-108) capped by the conservative --appvh');
  ok(/#sheet\.flexsheet\{[^}]*display:flex/.test(html) && /#sheet \.sheet-scroll\{[^}]*overflow-y:auto/.test(html) &&
     /#sheet\.flexsheet \.btnrow\{[^}]*position:static/.test(html),
    'LF-J1c: flex sheets exist — column flex, candidate-only scroller, in-flow button row');
  ok(clientSrc.includes("classList.add('flexsheet')") && clientSrc.includes('<div class="sheet-scroll">') &&
     clientSrc.includes("setProperty('--appvh'"),
    'LF-J1d: gridSheet engages the flex structure inside a .sheet-scroll; --appvh is published from viewportHeights()');
  const itext = ruleDecls(/\.gcard \.itext\{([^}]*)\}/);
  ok(!!itext && !('-webkit-line-clamp' in itext) && !('max-height' in itext),
    'LF-J1e: in-tile effect text is unclamped (full text; the candidate region scrolls)');
}

// ---------- J2: band shape ----------
{
  const header = ruleDecls(/#header\{([^}]*)\}/);
  ok(!!header && !('min-height' in header) && !('height' in header),
    'LF-J2a: BU-73 — the header (the old mid band\'s seat) has no frozen height and no forced floor; its height is its contents (46px button row + the event line), grown by inflated fonts and absorbed by the fit loop');
  // layout-fix2 (J2'): the .lk spans only ever wrapped strings
  // that already carried 《》 — the band's real lines were built
  // bare, so they never matched. Superseded by nbHTML tokenisation
  // (atomic .nb units; see test-layoutfix2.js LF2-J2'a).
  ok(clientSrc.includes('function nbHTML(text)') && html.includes('.nb{'),
    'LF-J2b: band lines render through nbHTML atomic units (supersedes the .lk spans, layout-fix2)');
  ok(engineSrc.includes('layout-fix J2') && engineSrc.includes('fromField && !(to.loc & LOC.OVERLAY) && to.loc !== LOC.HAND'),
    'LF-J2c: engine mirrors field departures into the band feed');
}

// ---------- J3: notice queue + outcome announcements ----------
{
  ok(clientSrc.includes('const fxNoticeQ = []') && clientSrc.includes('function fxNoticePump()'),
    'LF-J3a: fxNotice queues instead of silently replacing');
  ok(clientSrc.includes('が除外された') && clientSrc.includes('が手札に戻った') && clientSrc.includes('がデッキに戻った') &&
     clientSrc.includes('コントロールが移った') && clientSrc.includes('裏側守備表示になった'),
    'LF-J3b: banish / bounce / deck-return / control / flip outcomes are all announced');
  ok(!clientSrc.includes("state.turnPlayer !== HP && dep.entry.code != null && (dep.entry.pos & E.POS_FACEUP) !== 0"),
    'LF-J3c: the old opponent-turn + face-up-only destruction gate is gone');
}

// ---------- J4: dock trigger + full effect body ----------
{
  ok(clientSrc.includes('const ctxLink = prompt.context') && clientSrc.includes('prompt.trigger') &&
     clientSrc.includes('の攻撃宣言への応答') && clientSrc.includes('への応答'),
    'LF-J4a: the dock resolves its cause from prompt.context, then the chain top, then prompt.trigger');
  ok(!clientSrc.includes("fxExcerpt(cfx) + (fxTruncated(cfx)"),
    'LF-J4b: dock candidates no longer use the 28-character excerpt');
  // layout-fix2 (J4'): same-turn-only attachment — the turn+phase
  // gate starved post-resolution and phase-start windows, the most
  // frequent nameless prompts (see test-layoutfix2.js LF2-J4'b).
  ok(engineSrc.includes('prompt.trigger = (!prompt.context && lt') && engineSrc.includes('lt.turn === this.state.turnCount'),
    'LF-J4c: the driver attaches the mirror lastTrigger to empty-chain prompts (same turn; layout-fix2 widened from turn+phase)');
}

// ---------- J5: details ----------
{
  ok(!/return 'リンク'/.test(clientSrc) && !clientSrc.includes('（リンク'),
    'LF-J5a: the detailed history never says リンク');
  ok(html.includes('id="reshistbtn"') && clientSrc.includes('histFromResult'),
    'LF-J5b: the result screen carries its own history entry and restores itself on close');
  const kfAt = html.indexOf('@keyframes setbreath');
  const kf = kfAt >= 0 ? html.slice(kfAt, kfAt + 80) : '';
  ok(kf.includes('opacity:.78') && kf.includes('opacity:.92'),
    'LF-J5c: the own-set veil breathes at .78-.92 (the back dominates; the card reads as set)');
  // brushup round 2026-11-13 (user instruction: spell/trap
  // subtype icons) narrows the tile half of this pin: a card
  // lying in the S/T zone still gets NO plate and NO monster
  // marks when it is a monster; an actual spell/trap there now
  // carries its subtype symbol chip instead of nothing.
  ok(clientSrc.includes('if (loc === E.LOC.SZONE) return \'\';') && clientSrc.includes('loc !== E.LOC.SZONE || !isMonster(card.code)') && clientSrc.includes('function stIconFile(code)'),
    'LF-J5d: no ATK/DEF plate and no monster marks for a card lying in the S/T zone (a real spell/trap there carries its subtype symbol — brushup 2026-11-13)');
}

// ---------- engine behaviour over real duels ----------
function installSeededCrypto(seed) {
  let s = seed >>> 0;
  const fake = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s; } return a; } };
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
}

async function runDuel(M, data, seed, deckA, deckB, seen) {
  installSeededCrypto(seed * 2654435761 % 4294967296);
  const mems = [Engine.makeBotMemory(), Engine.makeBotMemory()];
  const wrap = (seat) => (prompt, state) => {
    if (prompt.name === 'SELECT_CHAIN') {
      seen.chainPrompts++;
      if (!prompt.context) {
        seen.emptyCtx++;
        if (prompt.trigger) {
          seen.withTrigger++;
          // layout-fix2: staleness is turn-only now — a trigger
          // from an earlier battle sub-step stays valid in DAMAGE.
          if (prompt.trigger.turn !== state.turnCount) seen.staleTrigger++;
        }
      }
    }
    return Engine.botAnswer(prompt, state, data, mems[seat]);
  };
  const duel = new Engine.Duel(M, data, {
    seed, pace: { bot: 0, botChain: 0, batch: 0 }, sleep: () => Promise.resolve(),
    deckP0: data.decks[deckA], deckP1: data.decks[deckB], humanTeam: 0,
    onLog: () => {},
    onUpdate: (state) => { for (const line of state.log) seen.logLines.add(line); },
    humanAnswerer: async (prompt, state) => wrap(0)(prompt, state),
    botAnswerer: (prompt, state) => wrap(1)(prompt, state),
  });
  const stats = await duel.run();
  return { over: duel.over, retries: stats ? stats.retries : -1, winner: duel.state.winner };
}

(async () => {
  const M = await factory();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const seen = { logLines: new Set(), chainPrompts: 0, emptyCtx: 0, withTrigger: 0, staleTrigger: 0 };
  const pairs = [['ishizu', 'gg'], ['gg', 'ishizu'], ['ishizu', 'monarch'], ['monarch', 'ishizu'], ['gg', 'monarch'], ['ishizu', 'gg']];
  let allOver = true, allRetries0 = true;
  for (let i = 0; i < pairs.length; i++) {
    const r = await runDuel(M, data, 7700 + i * 131, pairs[i][0], pairs[i][1], seen);
    if (!r.over) allOver = false;
    if (r.retries !== 0) allRetries0 = false;
  }
  ok(allOver, 'LF-E1: all 6 layout-fix duels complete');
  ok(allRetries0, 'LF-E2: no rejected answers (MSG_RETRY == 0) in any duel');
  const lines = [...seen.logLines];
  ok(!lines.some(l => l.includes('#0')), 'LF-E3: the band feed never prints #0 (face-down special summons stay generic)');
  const outcome = lines.filter(l => /破壊され|除外された|手札に戻った|デッキに戻った|EXデッキに戻った|墓地へ送られた|表示形式が|コントロールが/.test(l));
  ok(outcome.length >= 10, 'LF-E4: field-outcome lines reach the band feed across duels (got ' + outcome.length + ')');
  ok(lines.some(l => l.includes('破壊され')), 'LF-E5: destruction outcomes reach the band feed');
  console.log('  [info] band lines sampled:', lines.length, '| outcome lines:', outcome.length,
    '| chain prompts:', seen.chainPrompts, '| empty-context:', seen.emptyCtx, '| with trigger:', seen.withTrigger);
  ok(seen.chainPrompts > 0 && seen.emptyCtx > 0, 'LF-E6: empty-chain response windows occur and were sampled');
  ok(seen.withTrigger > 0, 'LF-E7: prompt.trigger attaches to empty-chain windows (summon/attack triggers named)');
  ok(seen.staleTrigger === 0, 'LF-E8: no stale trigger ever attaches (the turn always matches; the phase may legitimately advance — layout-fix2)');
  console.log(failures ? ('\n' + failures + ' FAILURES') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
