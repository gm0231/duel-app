'use strict';
/* test-smallfix.js — the 2026-11-14 backlog sweep pins.
   BU-78 (hand overflow): .hcard shrinks to fit with a 46px
     floor; #hand.canscroll carries the right-edge fade cue;
     handCueUpdate drives it from render.
   BU-79 (selection grid): 1-2 candidate grids keep the
     standard column width via the :has override (auto-fill);
     the base rule for 3+ is untouched (FX5-4 stays valid).
   BU-82 (deck page at 620): the .dp-compact tier tightens the
     page's vertical rhythm; #dpmore + .dp-canscroll are the
     scroll cue for shorter screens; dpCueUpdate drives both
     classes off viewportHeights().baseH.
   BU-83 (move notice): .fx-notice started as the top:33%
     centre band, then a slim strip under the header (top:84px)
     — which still covered the opponent's pile row and, when a
     long move text wrapped, the monster-zone top edge (parent
     re-verification 2026-11-14 evening; measured bottoms
     151/189/208 vs pile top 80). Residue fix: the strip is
     full-width and bottom-anchored INSIDE the header band by
     fxNoticeShow (top set in JS from the measured header
     rect); the route label rides the text flow inline.
   Source pins (CSS/DOM contract), in the test-fxround5 style —
   geometry itself is measured by the round's Puppeteer probes
   (deck page at 390x620/700/560, saved with the round record).
   Behavioural pins for BU-81/BU-84 live in test-chainbadge
   (CB9/CB10); BU-75/BU-80 are engine-level verdicts recorded
   in the backlog (no client code changed for them). */
const fs = require('fs');
const path = require('path');
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');

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

// ---------- BU-78 ----------
const hcard = ruleDecls(/\.hcard\{([^}]*)\}/);
ok(!!hcard && (hcard['flex'] || '') === '0 1 auto' && hcard['min-width'] === '46px',
  'SF78a: hand cards shrink to fit (flex 0 1) with a 46px floor (got flex=' + (hcard && hcard['flex']) + ', min-width=' + (hcard && hcard['min-width']) + ')');
ok(/#hand\.canscroll\{[^}]*mask-image/.test(html),
  'SF78b: the hand bar has the .canscroll right-edge fade cue');
ok(/function handCueUpdate\(\)/.test(clientSrc) && /classList\.toggle\('canscroll'/.test(clientSrc),
  'SF78c: handCueUpdate drives the cue from render');

// ---------- BU-79 ----------
const baseGrid = ruleDecls(/\.grid\{([^}]*)\}/);
ok(!!baseGrid && /auto-fit/.test(baseGrid['grid-template-columns'] || ''),
  'SF79a: the base grid rule for 3+ candidates is unchanged (auto-fit)');
ok(/\.grid:has\(> \.gcard:first-child:last-child\),\s*\.grid:has\(> \.gcard:nth-child\(2\):last-child\)\{grid-template-columns:repeat\(auto-fill,minmax\(106px,1fr\)\);/.test(html),
  'SF79b: 1-2 candidate grids keep standard-width columns (auto-fill via :has) — no full-width band tile');

// ---------- BU-82 ----------
ok(/id="dpmore"/.test(html) && /#deckpage\.dp-canscroll #dpmore\{display:block;/.test(html),
  'SF82a: the deck page carries the scroll-cue line, shown only under .dp-canscroll');
ok(/#deckpage\.dp-compact \.srow \.seg button\{min-height:38px;/.test(html)
  && /#deckpage\.dp-compact \.deck\{min-height:48px;/.test(html)
  && /#deckpage\.dp-compact\{padding:8px 14px 10px;/.test(html),
  'SF82b: the .dp-compact tier tightens the deck page vertical rhythm');
ok(/function dpCueUpdate\(\)/.test(clientSrc) && /dp-compact', viewportHeights\(\)\.baseH <= 700/.test(clientSrc),
  'SF82c: dpCueUpdate drives .dp-compact off the visible height (<= 700) and .dp-canscroll off the region overflow');

// ---------- BU-83 ----------
const notice = ruleDecls(/\.fx-notice\{([^}]*)\}/);
ok(!!notice && notice['left'] === '6px' && notice['right'] === '6px' && !('top' in notice) && !('transform' in notice),
  'SF83a: the notice is a full-width strip with no fixed top — fxNoticeShow anchors it inside the header band (got left=' + (notice && notice['left']) + ', top=' + (notice && notice['top']) + ')');
const noticeT = ruleDecls(/\.fx-notice \.nt\{([^}]*)\}/);
ok(!!noticeT && noticeT['font-size'] === '12.5px',
  'SF83b: the notice type is 12.5px so the worst-case grouped text fits the header band (got ' + (noticeT && noticeT['font-size']) + ')');
ok(!/\.fx-notice\{[^}]*top:33%/.test(html) && !/\.fx-notice\{[^}]*top:84px/.test(html), 'SF83c: neither the old centre band nor the under-header strip remains');
const noticeS = ruleDecls(/\.fx-notice \.ns\{([^}]*)\}/);
ok(!!noticeS && noticeS['display'] === 'inline',
  'SF83d: the route label rides the notice text flow inline (no second line)');
ok(/hb\.getBoundingClientRect\(\)/.test(clientSrc) && /d\.style\.top = Math\.max\(0, Math\.round\(hr\.bottom - lr\.top - 2 - d\.offsetHeight\)\)/.test(clientSrc)
  && /render\(t\) \{\s*anchorNotice\(\);/.test(clientSrc),
  'SF83e: fxNoticeShow bottom-anchors the strip 2px above the measured header bottom, re-anchored every frame of the dwell');

// ---------- parent re-verification 2026-11-14, item 2.1 ----------
// The header hand chip is the OPPONENT's count (render writes
// players[1-HP].hand.length; the mirror was verified equal to
// the core's real hand count at 1,097 prompt boundaries, zero
// divergence — see the round record's probe-counts). The bare
// label 手札 read as the reader's own hand; it now says whose.
ok(/id="oppHandChip">相手の手札 <b id="oppHandN">/.test(html),
  'SF85a: the header hand chip is labelled 相手の手札 (it shows the opponent count)');

console.log(failures ? ('FAILURES: ' + failures) : 'ALL SMALLFIX CHECKS PASSED');
process.exit(failures ? 1 : 0);
