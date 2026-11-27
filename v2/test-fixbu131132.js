'use strict';
/* test-fixbu131132.js — fix-bu131-132-1127 (run 26, 2026-11-27).
 *
 * BU-131: the turn banner (.fx-turn) was silently dropped when a
 * notice chain outlasted its 2.6 s pending cap. Run 26 measured
 * 6 of 33 flips missed (18%); every missed flip had a notice
 * live at the flip — the duel-start initial-draw notice (turn 1,
 * twice) and end-phase discard -> draw notice chains (620 D2
 * turns 8/13, 700 D2 turn 2, 620 D1 turn 6). The header readout
 * kept showing whose turn it was, so no information was lost —
 * but the banner IS the turn-change signal, and it failed exactly
 * at the busiest flips, where the signal is needed most.
 *
 * Mechanism: fxTurnBanner defers on a 120 ms poll while a
 * decision UI is open or a notice is live, and dropped the
 * pending silently after 2600 ms. A single notice dwells
 * hold+480 ms (reading time), so a two-notice chain already
 * outlasts the cap. The mirror mechanism is asymmetric: a notice
 * born while a banner is live waits up to ~4.5 s (10 x 450 ms)
 * for the banner, but the banner only waited 2.6 s for a notice.
 *
 * Candidates:
 *   (a) adopted — remove the silent drop: the banner waits until
 *       the notice retires, then shows. The wait stays bounded in
 *       practice: a re-flip replaces the pending, any decision-UI
 *       opener cuts it (sheet/tray/dock/place-hint), a reset cuts
 *       it, and a live notice retires on its own dwell or its
 *       safety timer. The prompt hold (fxTurnBannerHold, 4200 ms
 *       cap) still bounds prompt delay: if a long chain is still
 *       waiting when the cap hits, the prompt opens and cuts the
 *       pending, so a prompt is never swallowed — the banner is
 *       dropped only when a decision UI actually needs the seat.
 *   (b) rejected — shorten the notice dwell while a banner waits:
 *       it would cut the notice's reading time, the very thing
 *       the notice is for.
 *   (c) rejected — special-case turn 1 only: it leaves the
 *       discard -> draw chains (4 of the 6 misses) unfixed.
 *   (d) rejected — raise the cap to a fixed larger value (6 s):
 *       any fixed cap reintroduces the same defect class for a
 *       longer chain; the bound that replaces it is structural
 *       (re-flip / decision-UI cut / reset), not a clock.
 * Residual (by design, not a defect): a decision UI opening
 * while the banner is pending still cuts it (BU-44/BU-92 — the
 * decision UI settles the banner). The single 926 ms short-life
 * banner in run 26 (700 D1 turn 1) is that cut firing, not the
 * drop: a chain-check tray opened mid-banner.
 *
 * BU-132: a hand card's action sheet with ZERO actions showed no
 * reason at all. Run 26: 700 D1 turn 7, 《冥帝王エイドス》
 * (level 6) in hand, own monster zone empty — the sheet showed
 * art + attributes + full effect text + 「選択に戻る」 and nothing
 * else. A level 6 needs 1 tribute, so no summon/set was offered,
 * and ① triggers on summon, ② is a field effect, ③ is a grave
 * effect, so no activation was offered either. The 効果を発動
 * greyed row only covers a missing activation, and it needs a
 * derivable reason (handTargetReason etc.) — here there was none.
 *
 * Adopted: when a hand MONSTER's sheet has zero actions,
 * handNoActionReason derives the reason from the live state, in
 * the order the sheet's own evidence supports — opponent's turn,
 * non-main phase, cannot-be-normal-summoned (Ritual / Fusion /
 * Synchro / Xyz / Link, or a text that says so), level 5+ with
 * fewer releasable monsters than the tribute count (level 5-6: 1,
 * level 7+: 2; every own monster counts as releasable, so a
 * shortfall on the full count is certain; a tribute frees its own
 * zone, so zone-full never blocks a tribute summon), level <=4
 * with a full monster zone, the turn's normal summon/set already
 * spent (summonMarks, the same arrival evidence
 * monsterRevivedReason trusts — a mark dies when the monster
 * leaves the field, so absence means "unknown", never "not
 * spent"). The row rides the same greyed-row form as the effect
 * row, labelled 通常召喚・セット. Anything else returns null and
 * the sheet stays as it was — never a guessed reason. Spells and
 * traps with zero actions are out of scope: their activation case
 * already rides the 効果を発動 row, and their set reasons are
 * stated by handTapReason's preview.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-bu131-132.js): banner miss rate across
 * real duels at both heights (baseline 6/33 = 18%), and the
 * zero-action sheet with its reason row in real play (plus a
 * staged synthetic-state shot if no zero-action sheet occurs).
 *
 * Probe results (mirror-239b006): 620 — 8 turn changes, 8
 * shown, 0 missed (max delay 2785 ms, a banner held past the
 * old 2.6 s drop); 700 — 10 changes, 10 shown, 0 missed (max
 * delay 2830 ms). Zero-action hand sheets: 620 カルダーン
 * (battle reason, shot 116) and 700 エイドス x2 (tribute
 * reason, shot 094 — the filed run-26 case reproduced — and
 * battle reason, shot 101).
 *
 * Follow-up fixes found by the probe + the suite (same round):
 * the 620 probe caught a live zero-action sheet with NO reason
 * (《地久神－カルボン》, second copy in hand just after the
 * first was summoned): trackFieldSummons only attributed the
 * 'summon' kind to arrivals fresh in the event's own batch,
 * but the engine MOVEs the card in one message and announces
 * SUMMONING in the next — the mark was kind-less when the
 * sheet opened. The tracker now attributes by (con, code,
 * turn) as well (F132w1/w2). The suite caught H30b: a state
 * without turnPlayer was misread as the opponent's turn; an
 * absent turnPlayer is now "unknown", never a claim (F132x).
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- BU-131 source pins ----------
{
  // the turn banner's pending poll: from the fxTurnBanner definition
  // to the re-flip cut line (the poll lives in that span).
  const start = clientSrc.indexOf('function fxTurnBanner(mine, turnNo)');
  const end = clientSrc.indexOf("fxTurnBannerCut(); // a re-flip replaces", start);
  ok(start > 0 && end > start, 'F131a: the fxTurnBanner body is found (setup)');
  if (start > 0 && end > start) {
    const body = clientSrc.slice(start, end);
    ok(!body.includes('2600'), 'F131b: the turn-banner pending wait has NO 2.6 s silent drop (was: else if (... > 2600) drop)');
    ok(body.includes('fxNoticeLive()'), 'F131c: the pending still waits while a notice is live');
    ok(body.includes('if (!fxDecisionUiOpen() && !fxNoticeLive()) { clearInterval(pend.timer); fxTurnPending = null; fxTurnBanner(pend.mine, pend.turnNo); }'),
      'F131d: the pending still fires once no decision UI is open and no notice is live');
    ok(body.includes('if (fxTurnPending) { fxTurnPending.mine = mine; fxTurnPending.turnNo = turnNo; return; }'),
      'F131e: a re-flip still replaces a waiting pending (latest turn wins)');
  }
  // the phase banner keeps its own 2600 ms cap — a different
  // mechanism, not in scope; exactly one `pend.since > 2600` must
  // remain in the file (the phase banner's).
  const drops = (clientSrc.match(/pend\.since > 2600/g) || []).length;
  ok(drops === 1, 'F131f: exactly one 2600 ms pending drop remains — the phase banner’s own (got ' + drops + ')');
  ok(clientSrc.includes('fix-bu131-132-1127 (BU-131)'), 'F131g: the BU-131 change is documented at the site');
}

// ---------- BU-132 source pins ----------
ok(clientSrc.includes('function handNoActionReason(code, state)'),
  'F132a: handNoActionReason exists');
ok(clientSrc.includes("if (zoneCode != null && con === HP && loc === E.LOC.HAND && acts.length === 0 && isMonster(zoneCode)) {"),
  'F132b: the zero-action hand-monster wiring exists in openActionSheet');
ok(clientSrc.includes('通常召喚・セット<span class="reason">'),
  'F132c: the zero-action row is labelled 通常召喚・セット with a reason span');
ok(clientSrc.includes('リリースできるモンスターがいません（レベル'),
  'F132d: the tribute-shortage wording exists');
ok(clientSrc.includes('handCandidates, handUsedReason, handTargetReason, handNoActionReason,'),
  'F132e: handNoActionReason is exposed on window.__poolcov for tests');
ok(clientSrc.includes("if ((d.type & 0x80) || (d.type & 0x40) || (d.type & 0x2000) || (d.type & 0x800000) || (d.type & 0x4000000)) return 'このカードは通常召喚できません';"),
  'F132f: Ritual / Fusion / Synchro / Xyz / Link monsters are excluded from the tribute arithmetic');

// ---------- live behaviour in jsdom ----------
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
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

// a fabricated duel state for the reason function: HP=0, turn 5,
// own turn, Main Phase 1, the named hand card, the named field.
function fakeState(handCodes, mzoneCodes, phaseName, turnPlayer, turnCount) {
  const P = (hand, mz) => ({
    hand: hand.map(code => ({ code })),
    mzone: [0, 1, 2, 3, 4].map(i => (mz[i] ? { code: mz[i], pos: 4 } : null)),
    szone: [null, null, null, null, null, null],
    grave: [], deckCount: 30, lp: 8000,
  });
  return {
    turnPlayer: turnPlayer != null ? turnPlayer : 0,
    turnCount: turnCount != null ? turnCount : 5,
    phaseName: phaseName || 'MAIN1', winner: null,
    players: [P(handCodes, mzoneCodes), P([], [])],
  };
}
const EIDOS = 31596518; // 冥帝王エイドス, level 6 (the filed case)
const JUNK = 1006081;   // ジャンク・チェンジャー, level <= 4
const EREBUS = 23064604; // 冥帝エレボス, level 8 (normal-summonable, 2 tributes)
const RITUAL = 51522296; // 凶導の白き天底, Ritual monster (type 0xA1)

(async () => {
  const window = await boot();
  const doc = window.document;
  const ev = (src) => window.eval(src);
  const reason = (code, st) => ev('__poolcov.handNoActionReason(' + code + ', ' + JSON.stringify(st) + ')');

  // ----- BU-132 live: the filed case, Eidos, empty field -----
  ok(reason(EIDOS, fakeState([EIDOS], [])) === 'リリースできるモンスターがいません（レベル6はリリース1体が必要です）',
    'F132g: Eidos (lv6, empty field) -> tribute-shortage reason (got ' + JSON.stringify(reason(EIDOS, fakeState([EIDOS], []))) + ')');
  // one releasable monster is exactly enough for level 6
  ok(reason(EIDOS, fakeState([EIDOS], [JUNK])) === null,
    'F132h: Eidos with one monster on the field -> no reason (a tribute exists)');
  // level 8 needs two tributes
  ok(reason(EREBUS, fakeState([EREBUS], [JUNK])) === 'リリースできるモンスターがいません（レベル8はリリース2体が必要です）',
    'F132i: level 8 with one monster -> needs-2 reason (got ' + JSON.stringify(reason(EREBUS, fakeState([EREBUS], [JUNK]))) + ')');
  ok(reason(EREBUS, fakeState([EREBUS], [JUNK, JUNK])) === null,
    'F132j: level 8 with two monsters -> no reason');
  // level <= 4, full zone
  ok(reason(JUNK, fakeState([JUNK], [JUNK, JUNK, JUNK, JUNK, JUNK])) === 'モンスターゾーンに空きがありません',
    'F132k: level <=4 with a full zone -> zone reason');
  ok(reason(JUNK, fakeState([JUNK], [JUNK, JUNK])) === null,
    'F132l: level <=4 with room -> no reason');
  // opponent's turn and non-main phases outrank everything
  ok(reason(EIDOS, fakeState([EIDOS], [], 'MAIN1', 1)) === '相手のターンです',
    'F132m: opponent’s turn -> turn reason');
  ok(reason(EIDOS, fakeState([EIDOS], [], 'BATTLE', 0)) === 'バトルフェイズ中は通常召喚できません',
    'F132n: battle phase -> battle reason');
  ok(reason(EIDOS, fakeState([EIDOS], [], 'END', 0)) === 'このフェイズでは通常召喚できません',
    'F132o: end phase -> phase reason');
  // ritual monsters never reach the tribute arithmetic
  ok(reason(RITUAL, fakeState([RITUAL], [])) === 'このカードは通常召喚できません',
    'F132p: a Ritual monster -> cannot-normal-summon reason (not a tribute lie)');
  // the turn's summon already spent: seed the mark through the
  // real tracker path (trackFieldSummons), then ask again.
  ev('__atkblock.reset()');
  const spentState = fakeState([JUNK], [JUNK]);
  ev('__atkblock.track([{kind:"summon", code:' + JUNK + ', con:0}], ' + JSON.stringify(spentState) + ')');
  ok(reason(JUNK, spentState) === 'このターン通常召喚済みです',
    'F132q: summon spent this turn (summonMarks) -> summon-done reason (got ' + JSON.stringify(reason(JUNK, spentState)) + ')');
  // a mark from an EARLIER turn does not arm the reason
  ev('__atkblock.reset()');
  const oldState = fakeState([JUNK], [JUNK]);
  oldState.turnCount = 6;
  ev('__atkblock.track([{kind:"summon", code:' + JUNK + ', con:0}], ' + JSON.stringify(fakeState([JUNK], [JUNK], 'MAIN1', 0, 5)) + ')');
  ok(reason(JUNK, oldState) === null,
    'F132r: a summon mark from turn 5 does not claim turn 6 is spent');
  // BU-132 follow-up (probe 620, duel 2, turn 1): the human
  // summoned 《地久神－カルボン》 and then tapped a second copy
  // in hand — the sheet showed zero actions and NO reason.
  // The arrival was observed in one update and its SUMMONING
  // announcement in the next, so the mark was kind-less when
  // the sheet opened. The tracker now attributes the event to
  // the existing mark by (con, code, turn).
  ev('__atkblock.reset()');
  const splitState = fakeState([JUNK], [JUNK]);
  ev('__atkblock.track([], ' + JSON.stringify(splitState) + ')');
  ok(reason(JUNK, splitState) === null,
    'F132w1: an arrival WITHOUT its summon event does not claim the summon is spent (it could be a special summon)');
  ev('__atkblock.track([{kind:"summon", code:' + JUNK + ', con:0}], ' + JSON.stringify(splitState) + ')');
  ok(reason(JUNK, splitState) === 'このターン通常召喚済みです',
    'F132w2: the same arrival WITH its later summon event -> summon-done reason (got ' + JSON.stringify(reason(JUNK, splitState)) + ')');
  // BU-132 follow-up (test-fixhandreason H30b): a state that
  // does not say whose turn it is must stay silent, not claim
  // the opponent's turn — the H30b fixture builds such a state
  // (no turnPlayer field) and expects no grey row. Isolated
  // from the F132w mark (reset first: any spent-summon mark
  // would rightly arm the (f) reason for any hand card).
  ev('__atkblock.reset()');
  const noTpState = fakeState([JUNK], []);
  delete noTpState.turnPlayer;
  ok(reason(JUNK, noTpState) === null,
    'F132x: turnPlayer absent -> no reason (unknown is not the opponent\u2019s turn, got ' + JSON.stringify(reason(JUNK, noTpState)) + ')');
  // re-seed the split-batch mark for the F132w3 sheet check
  // below (the reset above cleared it).
  ev('__atkblock.track([], ' + JSON.stringify(splitState) + ')');
  ev('__atkblock.track([{kind:"summon", code:' + JUNK + ', con:0}], ' + JSON.stringify(splitState) + ')');

  // ----- BU-132 live: the sheet itself, zero actions -----
  ev('duelState = ' + JSON.stringify(fakeState([EIDOS], [])) + '; currentPrompt = null; cmdPromptOpen = false; actionMap.clear();');
  ev("openActionSheet('0:2:0')");
  await sleep(100);
  const sheet = doc.getElementById('sheet');
  const rows = [...sheet.querySelectorAll('.optbtn.disabled')].map(el => el.textContent.replace(/\s+/g, ' ').trim());
  ok(rows.some(t => t.includes('通常召喚・セット') && t.includes('リリースできるモンスターがいません（レベル6はリリース1体が必要です）')),
    'F132s: the zero-action sheet shows the 通常召喚・セット row with the tribute reason (got ' + JSON.stringify(rows) + ')');
  ok(!rows.some(t => t.includes('効果を発動')),
    'F132t: the filed case has no 効果を発動 row (Eidos has no hand-activatable effect)');
  const ttl = sheet.querySelector('.ttl');
  ok(ttl && ttl.textContent.includes('冥帝王エイドス'),
    'F132u: the sheet is for Eidos (got ' + JSON.stringify(ttl && ttl.textContent) + ')');
  // the split-batch spent case reaches the sheet too: the
  // F132w mark is still seeded, so reopening the hand JUNK
  // shows the summon-done row (the live カルボン case).
  ev('duelState = ' + JSON.stringify(splitState) + '; currentPrompt = null; cmdPromptOpen = false; actionMap.clear();');
  ev("openActionSheet('0:2:0')");
  await sleep(100);
  const rowsSpent = [...sheet.querySelectorAll('.optbtn.disabled')].map(el => el.textContent.replace(/\s+/g, ' ').trim());
  ok(rowsSpent.some(t => t.includes('通常召喚・セット') && t.includes('このターン通常召喚済みです')),
    'F132w3: the zero-action sheet shows the summon-done row for the split-batch mark (got ' + JSON.stringify(rowsSpent) + ')');
  // a hand card WITH an offered action gets no zero-action row:
  // put a summon in the action map and reopen.
  ev('actionMap.set("0:2:0", [{ label: "通常召喚", code: ' + EIDOS + ' }]);');
  ev("openActionSheet('0:2:0')");
  await sleep(100);
  const rows2 = [...doc.getElementById('sheet').querySelectorAll('.optbtn.disabled')].map(el => el.textContent.replace(/\s+/g, ' ').trim());
  ok(!rows2.some(t => t.includes('通常召喚・セット')),
    'F132v: with an action offered, no zero-action row appears (got ' + JSON.stringify(rows2) + ')');
  ev('sheetClose(); actionMap.clear();');

  // ----- BU-131 live: a banner held behind a notice for LONGER
  // than the old 2.6 s cap must still appear once the notice
  // retires. With the old code the pending would have been dropped
  // at 2600 ms and no banner would ever show.
  ev('(() => { const l = document.getElementById("fxlayer") || document.body; const d = document.createElement("div"); d.className = "fx-notice"; d.id = "bu131-fake-notice"; d.textContent = "テスト通知"; l.appendChild(d); })()');
  ok(ev('!!document.querySelector(".fx-notice")'), 'F131h: the fake live notice is up (setup)');
  ev('fxTurnBanner(true, 1)');
  await sleep(200);
  ok(ev('!!fxTurnPending'), 'F131i: the banner is pending behind the live notice (setup)');
  ok(!doc.querySelector('.fx-turn'), 'F131j: no banner element while the notice is live (setup)');
  await sleep(3000); // past the old 2600 ms drop point
  ok(ev('!!fxTurnPending'), 'F131k: the pending SURVIVES past 2.6 s (the old code dropped it here)');
  ev('(() => { const d = document.getElementById("bu131-fake-notice"); if (d) d.remove(); })()');
  await sleep(500); // the 120 ms poll fires the banner once the notice is gone
  const banner = doc.querySelector('.fx-turn');
  ok(!!banner, 'F131l: the banner appears once the notice retires');
  if (banner) {
    ok(banner.textContent.includes('ターン 1') && banner.textContent.includes('自分のターン'),
      'F131m: the late banner still names the right turn (got ' + JSON.stringify(banner.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)) + ')');
  }
  ev('fxTurnBannerCut()');
  ok(!doc.querySelector('.fx-turn'), 'F131n: cleanup removes the banner');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU131132 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
