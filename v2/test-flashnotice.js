'use strict';
/* test-flashnotice.js — the 2026-11-16 BU-89 residual pins.
   Parent re-verification of smallfix3-1116 (main 1a0bc64) found the
   header still truncates long text while the auto-pass chip owns
   row 2 — three faces of one width fight, measured 390x620/700:
   (A) the log line (latest event) is forced to one ellipsis line
   in the flash-squeezed column: 40px wide, showing only 「相手：」
   of a 21-char event.
   (B) the persistent pill 「自動パス設定中：2 件（タップで管理）」
   is flex-shrunk to 88px, showing only 「自動パス設定」.
   (C) the chain bar (246px window, right:144px keeps 履歴 / the
   phase button clickable) holds ~479px of content for a 2-link
   chain with a solving tag: link 1 cut mid-name, link 2 entirely
   off-screen right, with no cue that the strip scrolls.
   The fix: row 2 wraps and the log line takes its own full-width
   line while the chip is up; the pill wraps to two clean lines
   and never shrinks; the bar scrolls its foreground link into
   view and fades its right edge while more content waits.
   Source pins (CSS/DOM contract), in the test-fxround5 style —
   geometry itself is measured by the round's Puppeteer probes
   (repro + after-fix, 390x620/700, saved with the round record). */
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

// ---------- (A) the log line gets its own line while the chip is up ----------
const row2 = ruleDecls(/\.hd-row2\{([^}]*)\}/);
ok(!!row2 && row2['flex-wrap'] === 'wrap',
  'FN-A1: row 2 may wrap (got ' + JSON.stringify(row2) + ')');
ok(html.includes('#header:has(#autopass.on) #logline{flex:1 1 100%'),
  'FN-A2: the log line takes its own full-width line while the chip is up');
ok(!html.includes('#header.apflash #logline{white-space:nowrap'),
  'FN-A3: the old squeezed one-line ellipsis rule is gone (it showed only 「相手：」 in a 40px column)');

// ---------- (B) the persistent pill wraps, it never shrinks ----------
const pill = ruleDecls(/#autopass\.on:not\(\.flash\)\{([^}]*)\}/);
ok(!!pill && pill['white-space'] === 'normal' && pill['flex'] === '0 0 auto' && pill['max-width'] === '170px' && pill['flex-direction'] === 'column',
  'FN-B1: the persistent pill wraps at 170px and never shrinks (got ' + JSON.stringify(pill) + ')');
ok(/sp1\.className = 'ap-p1'/.test(clientSrc) && /sp2\.className = 'ap-p2'/.test(clientSrc)
  && /'自動パス設定中：' \+ dismissedDuel\.size \+ ' 件'/.test(clientSrc)
  && /'（タップで管理）'/.test(clientSrc),
  'FN-B2: updateAutoPassChip splits the label into two spans (count line + hint line), keeping the exact label text');
ok(!/#autopass\.on:not\(\.flash\)[^}]*text-overflow:ellipsis/.test(html),
  'FN-B3: the persistent pill carries no ellipsis');

// ---------- (C) the chain bar scrolls its foreground link into view ----------
const cue = ruleDecls(/#chainbar\.canscroll\{([^}]*)\}/);
ok(!!cue && /linear-gradient\(90deg,#000 calc\(100% - 26px\)/.test(cue['mask-image'] || ''),
  'FN-C1: the bar fades its right edge while more content waits (hand-cue pattern, got ' + JSON.stringify(cue) + ')');
ok(/function chainbarScrollUpdate\(state, savedScroll\)/.test(clientSrc)
  && /fxChainScrollSig = sig;/.test(clientSrc)
  && /cb\.querySelector\('\.link\.solving'\) \|\| cb\.querySelector\('\.link:last-child'\)/.test(clientSrc)
  && /cb\.scrollLeft = savedScroll;/.test(clientSrc),
  'FN-C2: chainbarScrollUpdate scrolls the solving/newest link into view on a chain change and restores the saved position otherwise');
ok(/chainbarScrollUpdate\(state, chainScrollSaved\);/.test(clientSrc)
  && /fxChainScrollSig = null;/.test(clientSrc),
  'FN-C3: render() calls the scroll update after rebuilding the bar and resets the signature when the chain empties');

process.exitCode = failures ? 1 : 0;
if (failures) console.log(failures + ' FAILURES'); else console.log('ALL FLASHNOTICE CHECKS PASSED');
