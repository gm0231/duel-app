'use strict';
/* test-smallfix3.js — the 2026-11-16 backlog sweep pins.
   BU-85 (multi-name join): a 2-3 name join (199/279px) cannot
     fit the 148px flash name line, so .ap-name wraps at '・'
     instead of truncating (keep-all keeps each name whole;
     overflow-wrap:anywhere is the fallback for one
     unbreakable name). Single names (max 139px) never wrap.
   BU-90 (few-candidate grid): the grid is flex with centred
     rows; the standard ~117px tile width is carried by the
     tile itself (flex-basis 106px, capped at one third of
     the row minus the gaps), so 1-2 visible tiles sit
     centred at standard width whether they are the only DOM
     children or the only ones left after a word search
     (display:none drops out of the flex layout). Full 3-tile
     rows render as before (116.7px vs 117px, under 1px).
   Source pins (CSS/DOM contract), in the test-fxround5 style —
   geometry itself is measured by the round's Puppeteer probes
   (flash joins + grid sweeps at 390x620/700, saved with the
   round record). */
const fs = require('fs');
const path = require('path');
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');

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

// ---------- BU-85: the join wraps, it never truncates ----------
const apName = ruleDecls(/#autopass\.flash \.ap-name\{([^}]*)\}/);
ok(!!apName && apName['white-space'] === 'normal' && apName['word-break'] === 'keep-all' && apName['overflow-wrap'] === 'anywhere'
  && !('text-overflow' in apName) && apName['white-space'] !== 'nowrap',
  'SF3-85a: the flash name wraps at ・ (keep-all + anywhere fallback), no nowrap/ellipsis (got ' + JSON.stringify(apName) + ')');
ok(/flashAutoPass\(names\)/.test(fs.readFileSync(path.join(V2, 'client.js'), 'utf8'))
  && /sp\.className = 'ap-name'; sp\.textContent = names;/.test(fs.readFileSync(path.join(V2, 'client.js'), 'utf8')),
  'SF3-85b: flashAutoPass still puts the whole joined name (textContent) into .ap-name');

// ---------- BU-89 residual: a flash starting mid-dwell ----------
// The fxNoticeShow deferral only holds notices that ARRIVE
// during a flash; a notice already dwelling got re-anchored
// every frame into the flash-collapsed (~11px) logline column
// and grew the header to ~594px, pushing the board off-screen
// (measured on mainline 8fd5a18). While apflash owns the
// header, anchorNotice seats the live strip full-width in its
// own band below row 2 instead.
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const anchorSrc = (clientSrc.match(/const anchorNotice = \(\) => \{([\s\S]*?)\n  \};/) || [])[1] || '';
ok(/hb\.classList\.contains\('apflash'\)/.test(anchorSrc)
  && /d\.style\.left = '6px';\s*\n\s*d\.style\.right = '6px';/.test(anchorSrc),
  'SF3-89a: anchorNotice seats a dwelling notice full-width while apflash owns the header (no 11px squeeze)');

// ---------- BU-90: few-candidate rows centre at standard width ----------
const grid = ruleDecls(/\.grid\{([^}]*)\}/);
ok(!!grid && grid['display'] === 'flex' && grid['flex-wrap'] === 'wrap' && grid['justify-content'] === 'center'
  && !('grid-template-columns' in grid),
  'SF3-90a: the grid is flex (wrap) with centred rows — no grid tracks to strand a lone tile left (got ' + JSON.stringify(grid) + ')');
const gcardSize = ruleDecls(/\.gcard\{height:100%;([^}]*)\}/);
ok(!!gcardSize && (gcardSize['flex'] || '') === '1 1 106px' && (gcardSize['max-width'] || '') === 'calc((100% - 16px)/3)',
  'SF3-90b: the tile carries the standard width itself (flex 1 1 106px, max-width one third of the row minus gaps) (got ' + JSON.stringify(gcardSize) + ')');
ok(!/\.grid:has\(> \.gcard/.test(html),
  'SF3-90c: no :has() override — the flex layout needs none (hidden tiles drop out of it)');

console.log(failures ? ('FAILURES: ' + failures) : 'ALL SMALLFIX3 CHECKS PASSED');
process.exit(failures ? 1 : 0);
