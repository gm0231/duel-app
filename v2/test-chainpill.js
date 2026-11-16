'use strict';
/* test-chainpill.js — the 2026-11-16 chainpill pins.
   Parent re-verification of flashnotice-1116 (main 9219245) found
   two faces of one mechanism, measured 390x620/700 in Chromium:
   (1) the persistent auto-pass pill 「自動パス設定中：2 件
   （タップで管理）」 was fully readable in calm states (19/19
   chars) but vanished entirely while a chain was up (0/19) —
   the parent's "not visible in calm states" was sampled during
   chain screens, where the bar hid it; (2) the log line during
   chain resolution kept only its last char past the bar's right
   edge (1/21 — 'た' of 「…を手札から捨てた」; the parent saw
   「から捨てた」 from a two-line event). Root cause: #chainbar
   anchored to #header (top:0;bottom:0 of the whole header), so
   while .on it painted opaque over row 2 as well (pill overlap
   120x39, log-line overlap 242x16).
   The fix: the bar lives inside .hd-row1 and anchors to that row
   only — row 2 (turn readout, event line, auto-pass pill,
   opp-hand chip, FX button) stays readable while a chain
   resolves. Source pins (CSS/DOM contract), in the
   test-flashnotice style — geometry itself is measured by the
   round's Puppeteer probes (repro + after-fix, 390x620/700,
   saved with the round record). */
const fs = require('fs');
const path = require('path');
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');

const ruleDecls = (re) => {
  const m = html.match(re);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};

// CP-1: the bar is a child of row 1 (not a direct child of #header).
const row1 = html.match(/<div class="hd-row1">([\s\S]*?)<div class="hd-row2">/);
ok(!!row1 && row1[1].includes('id="chainbar"'),
  'CP-1: #chainbar lives inside .hd-row1 (the bar anchors to row 1 only)');
// CP-2: row 1 is the positioned containing block for the bar.
const row1Rule = ruleDecls(/\.hd-row1\{([^}]*)\}/);
ok(!!row1Rule && row1Rule.position === 'relative',
  'CP-2: .hd-row1 is position:relative — the absolute bar anchors to this row');
// CP-3: the bar still spans its containing block top-to-bottom with
// the 144px right reservation, and takes no flow height.
const bar = ruleDecls(/#chainbar\{([^}]*)\}/);
ok(!!bar && bar.position === 'absolute' && bar.top === '0' && bar.bottom === '0' &&
   bar.left === '0' && bar.right === '144px' && !('height' in bar) && !('min-height' in bar),
  'CP-3: #chainbar is absolute, top:0 bottom:0 left:0 right:144px, no height/min-height (it spans row 1, takes no flow height)');
// CP-4: row 2 stays a sibling of row 1 (the bar cannot cover it by
// ancestry) — the log line and the pill live in row 2, after row 1.
const row2 = html.match(/<div class="hd-row2">([\s\S]*?)<div id="watchbar">/);
ok(!!row2 && row2[1].includes('id="logline"') && row2[1].includes('id="autopass"') &&
   !row2[1].includes('id="chainbar"'),
  'CP-4: #logline and #autopass live in .hd-row2, which is a sibling of .hd-row1 — the bar is not their ancestor');
// CP-5: the auto-scroll clears the 26px fade zone, not just the
// bar edge — live 2-link chains measured scrollLeft 6 vs max 12
// and 55 vs 65, leaving the newest link's last character dimmed
// under the fade (the bar's right padding counts as scrollable,
// so need alone stops short of max). The scroll target is
// need + 26, clamped to the max scroll.
const js = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const scrollFn = js.match(/function chainbarScrollUpdate[\s\S]*?\n\}/);
ok(!!scrollFn && scrollFn[0].includes('need + 26') &&
   scrollFn[0].includes('scrollWidth - cb.clientWidth'),
  'CP-5: chainbarScrollUpdate scrolls to need + 26, clamped to max scroll (scrollWidth - clientWidth)');
// CP-6: the 26 in the scroll math is the fade width — it must
// match the #chainbar.canscroll mask in index.html.
const fade = html.match(/#chainbar\.canscroll\{[^}]*calc\(100% - (\d+)px\)/);
ok(!!fade && fade[1] === '26' && !!scrollFn && scrollFn[0].includes('need + 26'),
  'CP-6: fade width is 26px in both #chainbar.canscroll and the scroll math');
// CP-7: the scroll never exceeds the max scroll and never goes
// negative — a chain that fits does not scroll at all.
ok(!!scrollFn && scrollFn[0].includes('Math.min(Math.max(need + 26, 0), Math.max(maxScroll, 0))'),
  'CP-7: scroll target is clamped to [0, maxScroll] (no overshoot, no negative scroll)');
if (failures) { console.log('CHAINPILL CHECKS FAILED: ' + failures); process.exit(1); }
console.log('ALL CHAINPILL CHECKS PASSED');
