'use strict';
/* test-cardview.js — regression for the card-view round
   (user, 2026-11-04: "cards you look at should show their
   picture properly — the detail you open from the board, the
   graveyard list, and so on").
   Contract under test:
   - openCardInfo (the read-only detail sheet) leads with the
     BIG art: cardArtFile(code, true) as an inline background on
     .infoart, background-position pinned to center top (the
     standing keep-the-top crop rule) — except the ART_FOCUS
     slugs (user ruling 2026-11-05: chaospod / luce /
     luce-ishizu, plus minerva and minerva-ishizu from the
     20th delivery and its deck-override follow-up, plus
     castel-ishizu from the 21st delivery's deck-override
     follow-up, plus baromett from the 22nd delivery and
     baromett-ishizu from its deck-override follow-up), whose
     bands shift so the subject is inside the band
     (CV15-CV23b). Unlisted cards get NO
     inline image — the .infoart class background is the shared
     placeholder, the same fallback the FX big card uses.
   - Deck-scoped art resolves on the detail sheet exactly like
     the resident preview resolves a bare code (deckKeyOfCode):
     Mori inside the Ishizu deck shows the big mori-ishizu file.
   - Pile sheets (grave / removed / EX) lead each known card's
     row with a .pthumb thumbnail (the SMALL art file, the
     instance seat's deck context). A hidden card (code null —
     face-down banished) keeps the bare '？' row: no thumbnail
     element, no name, data-info empty, click does nothing.
   - The opponent's EX sheet stays count-only: no rows, no
     thumbnails, nothing to resolve.
   - Row -> detail flow is unchanged: tapping a known row opens
     the detail sheet (now with the big art on top).
   - openInfoPop (the FLOATING detail: board taps, chain rows,
     grid 詳細 buttons, confirm-sheet rows) leads with the same
     BIG art on a .popart band — it was the one detail surface
     still text-only. Deck context resolves like setPreview: the
     instance's seat when a ref names one, else deckKeyOfCode.
     Unlisted cards get NO inline image (the .popart class
     background is the shared placeholder). A null code still
     never opens the pop (the secrecy guard upstream is intact).
   - The meta line names the spell/trap KIND (detail-info round,
     user report 2026-11-08): cardTypeLabel derives the official
     compound name from the type bitmask — 通常魔法/通常罠 spelled
     out, never omitted — and cardMetaLine carries it on the
     detail sheet, the pop, the zone sheet and the resident
     preview. Pool-wide, all 144 cards resolve a non-empty meta
     line (CV-DI1..14).
   Method: boot the real client in jsdom (harness as
   test-cardart), fabricate a duel state, open the real sheets
   and assert the DOM contract. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };

const MUDORA = 99937011, KELBEK = 25926710, MORI = 36745317, HORUS = 36898537;
const UNLISTED = 73628505;      // テラ・フォーミング (Terraforming) — GG main, no individual art (see test-cardart; the exemplar role sat with Mutiny in the Sky 71593652 until the 35th delivery gave it art and completed the Ishizu deck, so the role crossed to the GG deck, 2026-11-08)
const LABYRINTH = 99551425;     // 迷宮の魔戦車 (Labyrinth Tank) — GG EX, no individual art (the unlisted-EX exemplar role sat with Luce 45409943 until the 19th delivery, then with Pluto 37706769 until the 23rd, then with Trilosukuta 21368273 until the 24th, then with Hyperion 63101468 until the 25th delivery, 2026-11-06 — Hyperion's registration completes the Ishizu EXTRA deck, so the role crosses to the GG deck: Labyrinth Tank is its only EX card that is neither a keycard nor art-registered)
const HYPERION = 63101468;      // マスターフレア・ヒュペリオン — 25th delivery (2026-11-06), plain CARD_ART with NO focus exception (his helmeted head sits high, crest ~4% / masked face ~10-13% of the big file, so center top frames helmet, face and torso in both bands); NOT a keycard (removed from the keycard list by the user's decision); follow-up (#25b) adds the 13th DECK_ART entry ('hyperion-ishizu', the Egyptian variant) with NO focus exception of its own either (measured separately — his crowned head sits high in the Egyptian painting too, sun-disc crown ~2-8% / masked face ~10-14% of the big file)
const TRILO = 21368273;         // マナドゥム・トリロスークタ — 24th delivery (2026-11-06), plain CARD_ART with NO focus exception (his face sits high, ~17-19% of the big file, so center top frames helmet, face and torso in both bands); follow-up (#24b) adds the 12th DECK_ART entry ('trilo-ishizu', the Egyptian variant) with NO focus exception of its own either (measured separately — the face sits high in the Egyptian painting too, eyes ~18% / chin ~22% of the big file, sun disc and headdress framed at center top)
const PLUTO = 37706769;         // 冥府の執行者 プルート — 23rd delivery (2026-11-06), plain CARD_ART with NO focus exception (his face sits high, ~16-25% of the big file, so center top frames head, wings and the star orb in both bands); follow-up (#23b) adds the 11th DECK_ART entry ('pluto-ishizu', the Egyptian variant) with NO focus exception of its own either (measured separately — his face sits high in the Egyptian painting too, eyes ~19% / chin ~24% of the big file)
const CHAOSPOD = 79106360, LUCE = 45409943; // ART_FOCUS exemplars (focus-exception round, 2026-11-05)
const MINERVA = 30100551;       // ライトロード・セイント ミネルバ — 20th delivery (2026-11-05), plain CARD_ART + the 4th ART_FOCUS entry ('center 20%' on the v2 painting); same-day follow-up adds the 8th DECK_ART entry ('minerva-ishizu', the Egyptian temple variant) with its own 5th ART_FOCUS entry ('center 20%', measured separately)
const CASTEL = 82633039;        // 鳥銃士カステル — 21st delivery (2026-11-06), plain CARD_ART with NO focus exception (his head sits high); follow-up (#21b) adds the 9th DECK_ART entry ('castel-ishizu', the Egyptian variant) with its own 6th ART_FOCUS entry ('center 20%', measured separately — the tall nemes headdress pushes his face lower than on the plain painting)
const BAROMETT = 62967433;      // 神羊樹バロメット — 22nd delivery (2026-11-06), plain CARD_ART + the 7th ART_FOCUS entry ('center 40%' — her face sits mid-frame, eyes ~47% of the big file, so center top leaves the sheep essentially out of the pop band); follow-up (#22b) adds the 10th DECK_ART entry ('baromett-ishizu', the Egyptian variant) with its own 8th ART_FOCUS entry ('center 40%', measured separately — in the Egyptian painting her face sits mid-frame just as in the plain one, eyes ~50% of the big file)
const GENSEI = 17484499;        // 現世と冥界の逆転 — 26th delivery (2026-11-06), plain CARD_ART with NO deck-scoped override + the 9th ART_FOCUS entry ('center 30%' — the two warriors sit mid-frame, the skeleton skull at ~26-33% of the big file, so center top leaves the pop band showing the paradise window and vortex with the subject essentially absent); an Ishizu keycard that fires on ACTIVATION (the keycardact stage art is pinned in test-keycardact KA3c)
const SOSEI = 83764718, TSUKI = 14087893, KAKAN = 14108995, LABYWALL = 34771947, HAKAMORI = 98715423, TSUKOKU = 40605147; // spell/trap classification exemplars (detail-info round, 2026-11-08): 通常魔法 / 速攻魔法 / 永続魔法 / フィールド魔法 / 永続罠 / カウンター罠 — GENSEI doubles as the 通常罠 exemplar

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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CV0: client boots');
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  const rows = () => [...doc.querySelectorAll('#sheet .sortrow')];
  const rowFor = (code) => rows().find(r => r.dataset.info === String(code));

  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null, deckTop: [null, null] };
    seatDeckKeys = ['ishizu', 'gg'];
    b.players[0].grave = [${UNLISTED}, ${MUDORA}];            // listed at the top (list renders reversed)
    b.players[0].removed = [null, ${KELBEK}];                 // a face-down banished (null) + a known card
    b.players[0].extra = [{ code: ${LABYRINTH} }, { code: ${HORUS} }];
    b.players[1].grave = [${KELBEK}];
    b.players[1].extra = [{ code: ${HORUS} }, { code: ${LABYRINTH} }]; // never rendered as rows (count only)
    duelState = b; render(b);
    return true;
  })()`);

  // ---- grave sheet (own): thumbnails on known rows ----
  window.eval('openPileSheet("grave", 0)');
  {
    const rM = rowFor(MUDORA), rU = rowFor(UNLISTED);
    ok(!!rM, 'CV1: grave sheet lists the Mudora row');
    const thM = rM && rM.querySelector('.pthumb');
    ok(!!thM, 'CV1b: the Mudora row leads with a thumbnail');
    ok(!!thM && thM.style.backgroundImage.includes('card-art-mudora-s.jpg'), 'CV1c: the thumbnail is the SMALL Mudora art file');
    ok(!!thM && thM.style.backgroundPosition === 'center top', 'CV1d: the thumbnail keeps the top-anchored crop (center top)');
    const thU = rU && rU.querySelector('.pthumb');
    ok(!!thU, 'CV2: the unlisted row still carries a thumbnail frame (placeholder surface)');
    ok(!!thU && thU.style.backgroundImage === '', 'CV2b: the unlisted thumbnail has NO inline image (class placeholder fallback, like tiles)');
    ok(!!rU && rU.textContent.includes(data.names[UNLISTED]), 'CV2c: the unlisted row still names its (public) card');
  }

  // ---- removed sheet (own): hidden row stays bare ----
  window.eval('openPileSheet("removed", 0)');
  {
    const rK = rowFor(KELBEK);
    const thK = rK && rK.querySelector('.pthumb');
    ok(!!thK && thK.style.backgroundImage.includes('card-art-kelbek-s.jpg'), 'CV3: the removed sheet thumbnails the known Kelbek row');
    const hidden = rows().find(r => r.dataset.info === '');
    ok(!!hidden, 'CV3b: the face-down banished row is present');
    ok(!!hidden && !hidden.querySelector('.pthumb'), 'CV3c: the hidden row has NO thumbnail element');
    ok(!!hidden && hidden.textContent.includes('？') && !hidden.textContent.includes(data.names[KELBEK]) && rows().length === 2, 'CV3d: the hidden row shows only ？ (no name leaks)');
    const before = doc.getElementById('sheet').innerHTML;
    click(hidden);
    ok(doc.getElementById('sheet').innerHTML === before, 'CV3e: tapping the hidden row opens nothing');
  }

  // ---- EX sheet (own): thumbnails, deck context on the seat ----
  window.eval('openPileSheet("extra", 0)');
  {
    const rH = rowFor(HORUS), rL = rowFor(LABYRINTH);
    const thH = rH && rH.querySelector('.pthumb');
    ok(!!thH && thH.style.backgroundImage.includes('card-art-horus-s.jpg'), 'CV4: the EX sheet thumbnails Horus with its small art');
    const thL = rL && rL.querySelector('.pthumb');
    ok(!!thL && thL.style.backgroundImage === '', 'CV4b: the unlisted EX row thumbnail is the bare placeholder surface');
  }

  // ---- EX sheet (opponent): count only, nothing resolves ----
  window.eval('openPileSheet("extra", 1)');
  {
    ok(rows().length === 0 && !doc.querySelector('#sheet .pthumb'), 'CV5: the opponent EX sheet has no rows and no thumbnails (count only)');
    ok(doc.getElementById('sheet').textContent.includes('見られません'), 'CV5b: the opponent EX sheet keeps its count-only wording');
  }

  // ---- grave sheet (opponent): public pile, thumbnails too ----
  window.eval('openPileSheet("grave", 1)');
  {
    const rK = rowFor(KELBEK);
    const thK = rK && rK.querySelector('.pthumb');
    ok(!!thK && thK.style.backgroundImage.includes('card-art-kelbek-s.jpg'), 'CV6: the opponent grave (public) thumbnails its rows as well');
  }

  // ---- detail sheet: the big art leads ----
  window.eval('openCardInfo(' + MUDORA + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art, 'CV7: the detail sheet leads with a big-art block');
    ok(!!art && art.style.backgroundImage.includes('card-art-mudora.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV7b: the detail art is the BIG Mudora file (not the small one)');
    ok(!!art && art.style.backgroundPosition === 'center top', 'CV7c: the detail art keeps the top-anchored crop (center top)');
    const sheetHtml = doc.getElementById('sheet').innerHTML;
    ok(sheetHtml.indexOf('infoart') < sheetHtml.indexOf('cardtext'), 'CV7d: name/text follow below the art');
    ok(doc.getElementById('sheet').textContent.includes(data.names[MUDORA]), 'CV7e: the detail still names the card');
  }
  window.eval('openCardInfo(' + UNLISTED + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage === '', 'CV8: an unlisted card\'s detail art is the bare placeholder surface (no inline image)');
  }
  window.eval('openCardInfo(' + MORI + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-mori-ishizu.jpg'), 'CV9: Mori in the Ishizu deck resolves the deck-scoped BIG art on the detail sheet');
  }

  // ---- row -> detail flow unchanged ----
  window.eval('openPileSheet("grave", 0)');
  click(rowFor(MUDORA));
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-mudora.jpg'), 'CV10: tapping a grave row still opens the detail, now with the big art');
    ok(doc.getElementById('sheet').textContent.includes(data.names[MUDORA]), 'CV10b: the opened detail is Mudora\'s');
  }

  // ---- floating pop (openInfoPop): the big art band leads ----
  window.eval('openInfoPop(' + MUDORA + ')');
  {
    const pop = doc.getElementById('infopop');
    const art = pop.querySelector('.popart');
    ok(!!art, 'CV11: the floating pop leads with a big-art band');
    ok(!!art && art.style.backgroundImage.includes('card-art-mudora.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV11b: the pop art is the BIG Mudora file (not the small one)');
    ok(!!art && art.style.backgroundPosition === 'center top', 'CV11c: the pop art keeps the top-anchored crop (center top)');
    ok(pop.innerHTML.indexOf('popart') < pop.innerHTML.indexOf('cardtext'), 'CV11d: name/text follow below the pop art');
    ok(pop.textContent.includes(data.names[MUDORA]), 'CV11e: the pop still names the card');
  }
  window.eval('openInfoPop(' + UNLISTED + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage === '', 'CV12: an unlisted card\'s pop art is the bare placeholder surface (no inline image)');
  }
  window.eval('openInfoPop(' + MORI + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-mori-ishizu.jpg'), 'CV13: a bare-code pop resolves the deck-scoped BIG art (Mori in the Ishizu deck)');
  }
  window.eval('openInfoPop(' + MORI + ', { con: 1, loc: 4, seq: 0 })');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-mori.jpg') && !art.style.backgroundImage.includes('ishizu'), 'CV13b: a ref pop resolves the art by the instance seat (Mori on the GG seat = plain art)');
  }
  window.eval('closeInfoPop()');
  window.eval('openInfoPop(null)');
  {
    const pop = doc.getElementById('infopop');
    ok(pop.className !== 'on' && !pop.querySelector('.popart'), 'CV14: a null code never opens the pop (secrecy guard intact)');
  }

  // ---- spell/trap classification on the meta line (detail-info
  // round, user report 2026-11-08: the detail never said what KIND
  // of spell or trap a card is). cardTypeLabel derives the official
  // compound name from the type bitmask — the plain case included
  // (通常魔法 / 通常罠, never omitted) — and cardMetaLine carries it
  // on every surface that shows the line (detail sheet, floating
  // pop, zone sheet, resident preview). Pool-wide: every card in
  // data.json resolves a non-empty meta line (monsters via
  // attribute / race / level, spells and traps via the label). ----
  {
    const labels = window.eval(`(() => ({
      sosei: cardTypeLabel(${SOSEI}), tsuki: cardTypeLabel(${TSUKI}), kakan: cardTypeLabel(${KAKAN}),
      labywall: cardTypeLabel(${LABYWALL}), gensei: cardTypeLabel(${GENSEI}),
      hakamori: cardTypeLabel(${HAKAMORI}), tsukoku: cardTypeLabel(${TSUKOKU}),
      monster: cardTypeLabel(${MUDORA}),
      coverage: (() => { let empty = 0, st = 0, mon = 0;
        for (const id of Object.keys(DATA.cards)) { if (!cardMetaLine(+id)) empty++; if (cardTypeLabel(+id)) st++; else mon++; }
        return { empty, st, mon, total: Object.keys(DATA.cards).length }; })()
    }))()`);
    ok(labels.sosei === '通常魔法', 'CV-DI1: a plain spell labels 通常魔法 (the plain case is spelled out, not omitted)');
    ok(labels.tsuki === '速攻魔法', 'CV-DI2: Book of Moon labels 速攻魔法');
    ok(labels.kakan === '永続魔法', 'CV-DI3: Vernusylph Corolla labels 永続魔法');
    ok(labels.labywall === 'フィールド魔法', 'CV-DI4: Labyrinth Wall Shadow labels フィールド魔法');
    ok(labels.gensei === '通常罠', 'CV-DI5: Exchange of the Spirit labels 通常罠');
    ok(labels.hakamori === '永続罠', 'CV-DI6: Gravekeeper\'s Trap labels 永続罠');
    ok(labels.tsukoku === 'カウンター罠', 'CV-DI7: Solemn Strike (神の通告) labels カウンター罠');
    ok(labels.monster === '', 'CV-DI8: a monster gets no spell/trap label (its meta line is attribute / race / level)');
    ok(labels.coverage.empty === 0 && labels.coverage.total === 144, 'CV-DI9: pool-wide, every one of the 144 cards resolves a non-empty meta line');
    ok(labels.coverage.st === 52 && labels.coverage.mon === 92, 'CV-DI10: coverage split is 52 spells/traps labelled + 92 monsters on the attribute line');
  }
  window.eval('openCardInfo(' + GENSEI + ')');
  {
    const sub = doc.querySelector('#sheet .sub');
    ok(!!sub && sub.textContent.includes('通常罠'), 'CV-DI11: the detail sheet meta line names the trap kind (通常罠)');
  }
  window.eval('openCardInfo(' + MUDORA + ')');
  {
    const sub = doc.querySelector('#sheet .sub');
    ok(!!sub && sub.textContent.includes('地属性／天使族／レベル4'), 'CV-DI12: the monster detail meta line is unchanged (属性／種族／レベル)');
    ok(!!sub && sub.textContent.includes('攻1500／守1800'), 'CV-DI12b: the monster stats line is unchanged');
  }
  window.eval('openInfoPop(' + TSUKI + ')');
  {
    const sub = doc.querySelector('#infopop .sub');
    ok(!!sub && sub.textContent.includes('速攻魔法'), 'CV-DI13: the floating pop meta line names the spell kind (速攻魔法)');
  }
  window.eval('closeInfoPop()');
  {
    const pv = window.eval('(() => { setPreview(' + SOSEI + ', null); return document.getElementById("preview").innerHTML; })()');
    ok(pv.includes('通常魔法'), 'CV-DI14: the resident preview meta line names the spell kind too (shared cardMetaLine)');
  }

  // ---- focus exceptions on the real bands (user ruling 2026-11-05) ----
  window.eval('openCardInfo(' + CHAOSPOD + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-chaospod.jpg'), 'CV15: the Chaos Pod detail art is the BIG file');
    ok(!!art && art.style.backgroundPosition === 'center 85%', 'CV15b: the Chaos Pod detail band shifts to its focus exception (center 85%) — the pod itself sits inside the band');
  }
  window.eval('openInfoPop(' + CHAOSPOD + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundPosition === 'center 85%', 'CV16: the Chaos Pod pop band uses the same focus exception');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + LUCE + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-luce-ishizu.jpg') && art.style.backgroundPosition === 'center 38%', 'CV17: Luce (unique to the Ishizu deck here) detail band shows the gold art at its focus position (center 38%)');
  }
  window.eval('openCardInfo(' + MINERVA + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-minerva-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV18: Minerva (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (8th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center 20%', 'CV18b: the Minerva detail band shifts to the variant\'s own focus exception (center 20%) — on the Egyptian painting her face sits at the same height as the v2 plain painting, centered in the band');
  }
  window.eval('openInfoPop(' + MINERVA + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-minerva-ishizu.jpg'), 'CV19: the Minerva pop band shows the deck-scoped BIG art too');
    ok(!!art && art.style.backgroundPosition === 'center 20%', 'CV19b: the Minerva pop band uses the variant\'s focus exception (center top pushes her face to the band bottom edge, mouth and chin outside)');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + CASTEL + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-castel-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV20: Castel (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (9th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center 20%', 'CV20b: the Castel detail band shifts to the variant\'s own focus exception (center 20%) — on the Egyptian painting the tall nemes headdress pushes his face lower than on the plain painting, centered in the band');
  }
  window.eval('openInfoPop(' + CASTEL + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-castel-ishizu.jpg'), 'CV21: the Castel pop band shows the deck-scoped BIG art too');
    ok(!!art && art.style.backgroundPosition === 'center 20%', 'CV21b: the Castel pop band uses the variant\'s focus exception (center top leaves his face at the band bottom edge, beak outside)');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + BAROMETT + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-baromett-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV22: Baromett (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (10th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center 40%', 'CV22b: the Baromett detail band shifts to the variant\'s own focus exception (center 40%) — on the Egyptian painting her face sits mid-frame just as in the plain one, centered in the band');
  }
  window.eval('openInfoPop(' + BAROMETT + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-baromett-ishizu.jpg'), 'CV23: the Baromett pop band shows the deck-scoped BIG art too');
    ok(!!art && art.style.backgroundPosition === 'center 40%', 'CV23b: the Baromett pop band uses the variant\'s focus exception (center top shows rainbow light and vine curls, the sheep essentially absent)');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + PLUTO + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-pluto-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV24: Pluto (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (11th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center top', 'CV24b: the Pluto detail band keeps center top (no focus exception for the variant either — measured separately: his face sits high in the Egyptian painting too, eyes ~19% / chin ~24% of the big file, framed mid-band)');
  }
  window.eval('openInfoPop(' + PLUTO + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-pluto-ishizu.jpg') && art.style.backgroundPosition === 'center top', 'CV24c: the Pluto pop band shows the deck-scoped BIG art at center top too');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + TRILO + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-trilo-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV25: Trilosukuta (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (12th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center top', 'CV25b: the Trilosukuta detail band keeps center top (no focus exception for the variant either — measured separately: the face sits high in the Egyptian painting too, eyes ~18% / chin ~22% of the big file, framed mid-band with sun disc and headdress)');
  }
  window.eval('openInfoPop(' + TRILO + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-trilo-ishizu.jpg') && art.style.backgroundPosition === 'center top', 'CV25c: the Trilosukuta pop band shows the deck-scoped BIG art at center top too');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + HYPERION + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-hyperion-ishizu.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV26: Hyperion (unique to the Ishizu deck here) detail art is the deck-scoped BIG file (13th DECK_ART entry)');
    ok(!!art && art.style.backgroundPosition === 'center top', 'CV26b: the Hyperion detail band keeps center top (no focus exception for the variant either — measured separately: his crowned head sits high in the Egyptian painting too, sun-disc crown ~2-8% / masked face ~10-14% of the big file, framed mid-band)');
  }
  window.eval('openInfoPop(' + HYPERION + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-hyperion-ishizu.jpg') && art.style.backgroundPosition === 'center top', 'CV26c: the Hyperion pop band shows the deck-scoped BIG art at center top too');
  }
  window.eval('closeInfoPop()');
  window.eval('openCardInfo(' + GENSEI + ')');
  {
    const art = doc.querySelector('#sheet .infoart');
    ok(!!art && art.style.backgroundImage.includes('card-art-gensei.jpg') && !art.style.backgroundImage.includes('-s.jpg'), 'CV27: Gensei detail art is the plain BIG file (26th delivery — no deck-scoped override)');
    ok(!!art && art.style.backgroundPosition === 'center 30%', 'CV27b: the Gensei detail band shifts to its own focus exception (center 30%) — the two warriors sit mid-frame, centered in the band');
  }
  window.eval('openInfoPop(' + GENSEI + ')');
  {
    const art = doc.querySelector('#infopop .popart');
    ok(!!art && art.style.backgroundImage.includes('card-art-gensei.jpg') && art.style.backgroundPosition === 'center 30%', 'CV27c: the Gensei pop band shows the BIG art at the same focus exception (center top shows the paradise window and vortex, the warriors essentially absent)');
  }
  window.eval('closeInfoPop()');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(2); });
