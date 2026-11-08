'use strict';
/* test-cardart.js — regression for per-card illustrations (decided
   2026-11-03: the user supplies an image per card, applied as each
   arrives; unlisted cards keep the shared placeholder art).
   Contract under test:
   - CARD_ART maps passcode -> art slug; files live in
     ../assets/card-art-<slug>-s.jpg (small surfaces) and
     ../assets/card-art-<slug>.jpg (big cut-in card).
   - Cropping rule (user, 2026-11-03): keep the TOP, cut from the
     bottom — artInline/artCss pin background-position to center top,
     and the delivered files are top-anchored crops.
   - Focus exceptions (user ruling 2026-11-05): a painting whose
     subject sits so low that the wide BIG-art bands would crop it
     away may shift its band position, that card only — ART_FOCUS,
     keyed by slug, consulted for the BIG file only (bands + cut-in
     cards). Three slugs qualified in the full pass (measured over
     all 26): chaospod 'center 85%', luce / luce-ishizu
     'center 38%'. A 4th arrived with the 20th delivery, measured
     the same way on its own: minerva — originally 'center 40%'
     for the enthroned v1 painting (face at ~43% of the frame);
     re-measured at 'center 20%' for the floating v2 painting
     (2026-11-05 replacement): center top leaves her face at the
     pop band's bottom edge with the chin clipped, the old 40%
     cuts her eyes off, 20% centers the face in both bands.
     A 5th arrived with her deck-scoped override, judged
     separately like luce / luce-ishizu: minerva-ishizu —
     in the Egyptian painting her face sits at the same height
     as on the v2 plain painting (eyes ~29% of the big file),
     so center top again leaves her mouth and chin outside
     the pop band, and 'center 20%' centers face, torso and
     owl in both bands (reproductions: minerva-ishizu-band-
     {sheet,pop}-{top,20}.jpg in the cropfix folder).
     A 6th arrived with the 21st delivery's deck-scoped
     override, judged separately like the other pairs:
     castel-ishizu — the plain painting needs no exception
     (his head sits high), but the Egyptian painting's tall
     nemes headdress pushes his face lower (face and beak
     ~29-37% of the big file), so center top leaves the
     beak outside the pop band, and 'center 20%' seats the
     whole head mid-band in both bands (reproductions:
     castel-ishizu-band-{sheet,pop}-{top,20}.jpg in the
     cropfix folder).
     A 7th arrived with the 22nd delivery:
     baromett — her face sits mid-frame (eyes ~47% of the
     big file), so center top leaves the sheet band showing
     wool, horn and vines with the face cut off at its
     bottom edge, and the pop band shows rainbow light and
     vine curls with the sheep essentially absent;
     'center 40%' seats the whole head — horns, face,
     muzzle — mid-band in both bands (reproductions:
     baromett-band-{sheet,pop}-{top,30,40,50}.jpg in the
     cropfix folder, with -before / -after aliases for
     the top / 40% pair).
     An 8th arrived with the 22nd delivery's deck-scoped
     override, judged separately like the other pairs:
     baromett-ishizu — in the Egyptian painting her face
     sits mid-frame just as in the plain one (eyes ~50%
     of the big file), so center top again leaves the
     pop band showing rainbow light and vine curls with
     the sheep essentially absent, and 'center 40%' —
     the same value as the plain painting — seats the
     whole head, golden crown, horns, face, muzzle and
     ankh collar mid-band in both bands (reproductions:
     baromett-ishizu-band-{sheet,pop}-{top,40,50}.jpg in
     the cropfix folder, with -before / -after aliases
     for the top / 40% pair).
     The small file keeps center top on every surface
     (CAF block).
   - Surfaces: board tile art (face-visible states only), hand,
     resident preview, selection-grid cards, FX ghosts, cut-in big
     cards. An opponent's face-down card must NEVER receive the art
     (information asymmetry — inline background-image would outrank
     the .back stylesheet rule, so the apply-side condition is the
     only guard).
   - Preload: both decks' listed art is warmed from deck-select
     time (boot + deck change + start click), so no surface flashes
     blank or '?'.
   - Deck-scoped overrides (user decision 2026-11-03): DECK_ART
     maps deck id -> passcode -> slug and wins over CARD_ART when
     a surface supplies the deck context of the card instance
     (the seat that owns it — seatDeckKeys, set at duel start).
     Entries: Mori (36745317) is 'mori-ishizu', Hana (62133026)
     is 'hana-ishizu' and Oka (9350312) is 'oka-ishizu' inside
     the Ishizu deck only; in any other deck context they resolve
     to their plain art. The 4th entry is the sisters' spell,
     《春化精の花冠》 (14108995, 14th delivery): plain art 'kakan'
     (the forest painting) in CARD_ART, 'kakan-ishizu' (the
     Egyptian variant) in DECK_ART under ishizu. The 5th entry
     is 《地久神－カルボン》 (15079028, 15th delivery): plain art
     'carbon' (the bare stone giant) in CARD_ART, 'carbon-ishizu'
     (the gold-and-hieroglyph regalia) in DECK_ART under ishizu
     — the first MONSTER with an override. The 6th entry is
     《生きる偲びのシルキィ》 (55702233, 16th delivery): plain
     art 'silky' (the translucent girl in a room) in CARD_ART,
     'silky-ishizu' (the same girl in Egyptian dress at a
     temple) in DECK_ART under ishizu. The 7th entry is
     《宵闇のルーチェ》 (45409943, 19th delivery): plain art
     'luce' (the white-winged painting) in CARD_ART,
     'luce-ishizu' (the all-gold Egyptian form) in DECK_ART
     under ishizu — the first EXTRA-deck monster and the
     first keycard with an override. The 8th entry is
     《ライトロード・セイント ミネルバ》 (30100551,
     20th delivery follow-up): plain art 'minerva' (the
     floating cathedral painting) in CARD_ART,
     'minerva-ishizu' (the Egyptian temple variant —
     blue-and-gold feathered wings, hieroglyph pillars)
     in DECK_ART under ishizu — the second EXTRA-deck
     monster with an override, not a keycard. The 9th entry
     is 《鳥銃士カステル》 (82633039, 21st delivery
     follow-up): plain art 'castel' (the purple-winged
     musketeer over the canyon) in CARD_ART, 'castel-ishizu'
     (the Egyptian variant — nemes headdress, the Nile and
     pyramids below) in DECK_ART under ishizu — the third
     EXTRA-deck monster with an override, not a keycard.
     The 10th entry is 《神羊樹バロメット》 (62967433,
     22nd delivery follow-up): plain art 'baromett' (the
     white sheep asleep in the vines) in CARD_ART,
     'baromett-ishizu' (the Egyptian variant — golden
     crown and ankh collar, lotus and the Nile below)
     in DECK_ART under ishizu — the fourth EXTRA-deck
     monster with an override, not a keycard.
     The 11th entry is 《冥府の執行者 プルート》
     (37706769, 23rd delivery follow-up): plain art
     'pluto' (the purple-winged executor with his star
     orb) in CARD_ART, 'pluto-ishizu' (the Egyptian
     variant — gold-and-hieroglyph regalia, the ankh
     sphere, the golden celestial dome with its scarab)
     in DECK_ART under ishizu — the fifth EXTRA-deck
     monster with an override, not a keycard.
     The 12th entry is 《マナドゥム・トリロスークタ》
     (21368273, 24th delivery follow-up): plain art
     'trilo' (the silver-armoured knight with the
     golden light sword) in CARD_ART, 'trilo-ishizu'
     (the Egyptian variant — goddess regalia with
     the sun-disc headdress and ankh sword, temple
     and the Nile below) in DECK_ART under ishizu
     — the sixth EXTRA-deck monster with an override,
     not a keycard.
     The opponent face-down rule binds the overrides exactly
     like the base art.
   - The 17th delivery (2026-11-04) is 《メタファイズ・
     ホルス・ドラゴン》 (36898537): plain art 'horus' (the
     silver mechanical dragon over the moonlit Nile) in
     CARD_ART, NO deck-scoped override — and the first
     EXTRA-deck monster to carry individual art, so its home
     surfaces are the EX pile sheet / card info / resident
     preview and any field tile after a Synchro summon.
   - The 18th delivery (2026-11-04) is 《墓守の罠》
     (98715423): plain art 'hakamori' (the white-robed
     Egyptian priestess in a temple, rainbow light) in
     CARD_ART, NO deck-scoped override — the first TRAP with
     individual art, and one of the two keycard-activation
     presentation targets, so its BIG file is also the
     cut-in-grade stage art (test-keycardact pins that side).
   - The 19th delivery (2026-11-05) is 《宵闇のルーチェ》
     (45409943): plain art 'luce' (the white-and-gold winged
     figure with the halo spire and coin discs over a night
     sky) in CARD_ART — an EXTRA-deck monster like the 17th,
     and an Ishizu KEYCARD, so its BIG file is also the
     summon cut-in / Keycard BGM stage art. The same day's
     follow-up delivery adds her deck-scoped override (the
     7th DECK_ART entry above): inside the Ishizu deck she
     resolves to 'luce-ishizu', the all-gold Egyptian form
     (golden wings, Eye-of-Horus shields, pyramids and the
     Nile below); any other deck context keeps 'luce'.
   - The 20th delivery (2026-11-05) is 《ライトロード・
     セイント ミネルバ》 (30100551): plain art 'minerva'
     (the winged saint with her owl; v2 painting — floating
     in the cathedral — replaced v1 the same day) in CARD_ART,
     NOT a keycard — the second EXTRA-deck monster of the
     Ishizu deck with individual art (x2 in the v11 EX).
     A same-day follow-up adds her deck-scoped override
     (the 8th DECK_ART entry): inside the Ishizu deck she
     resolves to 'minerva-ishizu', the Egyptian temple
     variant; any other deck context keeps 'minerva'.
     She is also the 4th ART_FOCUS entry ('center 20%'),
     and the variant is the 5th ('center 20%', measured
     separately — see above).
   - The 21st delivery (2026-11-06) is 《鳥銃士カステル》
     (82633039): plain art 'castel' (the purple-winged
     bird musketeer over the canyon) in CARD_ART, NOT a
     keycard — the third EXTRA-deck monster of the Ishizu
     deck with individual art (x3 in the v11 EX). Band
     check, measured like the others: his head (crest
     ~12%, eyes ~26%, beak ~29-33% of the big file) sits
     high enough that center top frames head and torso in
     the sheet band and crest, helmet, eye and beak in the
     pop band, so NO ART_FOCUS entry for the plain art
     (reproductions: castel-band-{sheet,pop}-top.jpg in
     the cropfix folder). A follow-up the same day (#21b)
     adds his deck-scoped override (the 9th DECK_ART
     entry): inside the Ishizu deck he resolves to
     'castel-ishizu', the Egyptian variant (nemes
     headdress, the Nile and pyramids below); any other
     deck context keeps 'castel'. The variant is also
     the 6th ART_FOCUS entry ('center 20%', measured
     separately — see above): the tall headdress pushes
     his face lower (face and beak ~29-37% of the big
     file), so center top leaves the beak outside the
     pop band. CAF1 grows to six entries.
   - The 22nd delivery (2026-11-06) is 《神羊樹バロメット》
     (62967433): plain art 'baromett' (the white sheep with
     curled horns asleep in the vines) in CARD_ART, NOT a
     keycard — the fourth EXTRA-deck monster of the Ishizu
     deck with individual art (x1 in the v11 EX), initially
     with no deck-scoped override. The painting is the first
     delivered at 3:4 (1086x1448) instead of 2:3, so the
     big file cannot take the usual full-width window: it
     keeps the FULL height and takes the 640:882 window
     horizontally (x=35, width 1051 — the 35px comes off
     the left edge, background only; horns, face and body
     are untouched). The small file is the standard
     top-anchored square (candidates at y=120 / y=180 were
     compared; y=0 already frames face and body, so the
     standing rule holds). She is also the 7th ART_FOCUS
     entry ('center 40%') — see above. CAF1 grows to
     seven entries. A follow-up the same day (#22b)
     adds her deck-scoped override (the 10th DECK_ART
     entry): inside the Ishizu deck she resolves to
     'baromett-ishizu', the Egyptian variant (golden
     crown and ankh collar, lotus and the Nile below);
     any other deck context keeps 'baromett'. The
     variant painting is again 3:4 (1086x1448), so its
     big file takes the same horizontal full-height
     window (x=35, width 1051 — in fact the only start
     that keeps both the golden crown tip, ~85px in
     from the left, and the right-edge vine heart
     whole); the small file is the standard
     top-anchored square. The variant is also the 8th
     ART_FOCUS entry ('center 40%', measured separately
     — see above). CAF1 grows to eight entries.
   - The 23rd delivery (2026-11-06) is 《冥府の執行者
     プルート》 (37706769): plain art 'pluto' (the
     purple-winged executor holding a star orb over a
     cratered planet) in CARD_ART, NOT a keycard — the
     fifth EXTRA-deck monster of the Ishizu deck with
     individual art (x2 in the v11 EX), initially with
     NO deck-scoped override. Band check, measured like
     the others: his face sits high (eyes ~19%, chin
     ~25% of the big file), so center top frames head,
     wings, torso and the orb in the sheet band and the
     whole face in the pop band — NO ART_FOCUS entry
     (reproductions: pluto-band-{sheet,pop}-top.jpg in
     the cropfix folder). CAF1 stays at eight entries.
     His registration also moves test-cardview's
     unlisted-EX exemplar role on to 《マナドゥム・
     トリロスークタ》 (21368273).
     A follow-up the same day (#23b) adds his
     deck-scoped override (the 11th DECK_ART entry):
     inside the Ishizu deck he resolves to
     'pluto-ishizu', the Egyptian variant (gold-and-
     hieroglyph regalia, the ankh sphere, the golden
     celestial dome with its scarab); any other deck
     context keeps 'pluto'. The variant was band-
     measured separately like the other pairs: his
     face sits high in the Egyptian painting too
     (eyes ~19%, chin ~24% of the big file), so
     center top seats the whole face mid-band in both
     bands — NO ART_FOCUS entry for the variant
     either (reproductions: pluto-ishizu-band-
     {sheet,pop}-{top,20}.jpg in the cropfix folder).
     CAF1 stays at eight entries.
   - The 24th delivery (2026-11-06) is 《マナドゥム・
     トリロスークタ》 (21368273): plain art 'trilo'
     (the silver-armoured knight with the flowing
     lavender hair-veil and the golden light sword) in
     CARD_ART, NOT a keycard — the sixth EXTRA-deck
     monster of the Ishizu deck with individual art
     (x1 in the v11 EX), initially with NO deck-scoped
     override.
     Band check, measured like the others: his face
     sits high (eyes ~17-19% of the big file), so
     center top frames helmet, face, torso and sword
     in the sheet band and the whole helmeted head in
     the pop band — NO ART_FOCUS entry (reproductions:
     trilo-band-{sheet,pop}-top.jpg in the cropfix
     folder). CAF1 stays at eight entries. His
     registration also moves test-cardview's
     unlisted-EX exemplar role on to 《マスターフレア・
     ヒュペリオン》 (63101468) — now the only EX card
     of the Ishizu deck still without individual art.
     A follow-up the same day (#24b) adds his
     deck-scoped override (the 12th DECK_ART entry):
     inside the Ishizu deck he resolves to
     'trilo-ishizu', the Egyptian variant (goddess
     regalia — sun-disc headdress, the ankh sword,
     the golden sphere, temple and the Nile below);
     any other deck context keeps 'trilo'. The
     variant was band-measured separately like the
     other pairs: the face sits high in the Egyptian
     painting too (eyes ~18%, chin ~22% of the big
     file), so center top seats the sun disc,
     headdress and whole face mid-band in both
     bands, and a 20% shift only pushes the disc
     and headdress out of the frame — NO ART_FOCUS
     entry for the variant either (reproductions:
     trilo-ishizu-band-{sheet,pop}-{top,20}.jpg in
     the cropfix folder). CAF1 stays at eight
     entries.
   - The 25th delivery (2026-11-06) is 《マスター
     フレア・ヒュペリオン》 (63101468): plain art
     'hyperion' (the gold-and-crimson armoured titan
     wreathed in golden flame, the winged helmet with
     its single blue eye) in CARD_ART — the seventh
     EXTRA-deck monster of the Ishizu deck with
     individual art (x1 in the v11 EX), with NO
     deck-scoped override. NOT a keycard: the user
     removed him from the keycard list, so no keycard
     list or keycard test is touched by this round.
     Band check, measured like the others: his
     helmeted head sits high (crest ~4%, masked face
     ~10-13% of the big file), so center top frames
     helmet, face, torso and both clawed hands in the
     sheet band and the whole helmeted head in the
     pop band — NO ART_FOCUS entry (reproductions:
     hyperion-band-{sheet,pop}-top.jpg in the cropfix
     folder). CAF1 stays at eight entries. His
     registration completes the Ishizu EXTRA deck —
     every card in it now has individual art — so
     test-cardview's unlisted-EX exemplar role crosses
     to the GG deck: 《迷宮の魔戦車》 (99551425), the
     GG EXTRA deck's only card that is neither a
     keycard nor art-registered.
     A follow-up the same day (#25b) adds his
     deck-scoped override (the 13th DECK_ART entry):
     inside the Ishizu deck he resolves to
     'hyperion-ishizu', the Egyptian variant (the
     same flame-wreathed titan in full pharaonic
     regalia — a sun-disc crown on its cobra
     standard, hieroglyph pauldron and chest
     panels, a winged sun-disc collar, a hieroglyph
     sash bearing the ankh, the temple roofline
     with its Anubis statues and the Nile below);
     any other deck context keeps 'hyperion'. He
     stays NOT a keycard in either painting — no
     keycard list or test is touched. The variant
     was band-measured separately like the other
     pairs: his crowned head sits high there too
     (sun-disc crown ~2-8%, masked face ~10-14% of
     the big file), so center top seats crown,
     helmeted head, collar and torso mid-band in
     both bands, while the 20% candidate pushes
     the sun disc out of both bands' tops — NO
     ART_FOCUS entry for the variant either
     (reproductions: hyperion-ishizu-band-
     {sheet,pop}-{top,20}.jpg in the cropfix
     folder). CAF1 stays at eight entries.
   - The 26th delivery (2026-11-06) is 《現世と冥界の
     逆転》 (17484499): plain art 'gensei' (the red
     skeleton warrior and the blue armored warrior
     swapping places inside the vortex between the
     living world and the underworld) in CARD_ART —
     the second TRAP with individual art (x1 in the
     v11 main deck), with NO deck-scoped override.
     She is an Ishizu KEYCARD that fires on
     ACTIVATION: the keycardact stage art resolves
     this BIG file through CARD_ART exactly like
     《墓守の罠》 (pinned in test-keycardact KA3c);
     the keycard lists themselves are untouched —
     17484499 was already in KEYCARD_ACTIVATE_CODES.
     Band check, measured like the others: the
     painting has no human face; its subjects are
     the two warriors mid-frame (the skeleton's
     skull at ~26-33% of the big file, its ribcage
     to ~45%), so center top keeps the skeleton in
     the sheet band but leaves the pop band showing
     the paradise window and the vortex with only
     the demon blade, one arm and the crown of the
     skull at its bottom edge — the subject
     essentially absent there. 'center 30%' seats
     the skeleton's head and ribcage mid-band in
     both bands (40% starts clipping the blade and
     head at the pop band's top), so she takes the
     9th ART_FOCUS entry ('center 30%';
     reproductions: gensei-band-{sheet,pop}-
     {top,30,40}.jpg in the cropfix folder, with
     -before / -after aliases for the top / 30%
     pair). CAF1 grows to nine entries. Her
     registration also retires her from this file's
     UNLISTED exemplar role (see below): the role
     passes to 《転生の予言》 (46652477), another
     real Ishizu main-deck card (x1) with no
     individual art.
   - The 28th delivery (2026-11-07) is 《おろかな副葬》
     (35726888): plain art 'fukuso' (a hand risen from
     the grave gripping a bouquet of white flowers
     before a tombstone in a purple graveyard, dropped
     rings beside it) in CARD_ART — a SPELL (x2 in the
     v11 main deck), not a keycard. It also adds her
     deck-scoped override (the 15th DECK_ART entry):
     'fukuso-ishizu' (an Egyptian tomb — a mummified
     hand gripping white lilies over a gold winged
     collar with an ankh pendant, under a
     hieroglyph-carved stele) in DECK_ART under
     ishizu. Band check, measured like the others:
     BOTH paintings' subjects sit LOW — the plain
     painting's hand and bouquet at ~53-87% of the big
     file, the Egyptian painting's hand and lilies
     spanning ~32-90% — so center top leaves the pop
     band on the tombstone / stele alone with the
     subject absent and clips the hand at the sheet
     band's bottom edge. The plain painting takes the
     10th ART_FOCUS entry ('center 80%': hand and
     bouquet seated in the pop band, whole in the
     sheet band) and the variant the 11th ('center
     65%': the gripping hand and gold collar in the
     pop band, the whole subject in the sheet band).
     CAF1 grows to eleven entries.
   - The 29th delivery (2026-11-07) is 《墓穴の道連れ》
     (16435215): plain art 'michizure' (a robed man
     dragged down by a giant stone hand in a graveyard,
     clutching two cards in his free hand) in CARD_ART
     — a SPELL (x1 in the v11 main deck), not a
     keycard, with NO deck-scoped override. The
     painting was delivered at 1025x1535 (1px over the
     standard size in both dimensions), so the big
     file applies the standard crop by ratio and the
     small file is the standard top-anchored square.
     Band check, measured like the others: the
     subjects sit MID-frame — the man's screaming face
     at ~33-45% of the big file and the stone fist
     gripping his leg at ~55-67% — so center top
     leaves the pop band on the night sky, the robe
     and one reaching hand with the face just below
     its bottom edge. It takes the 12th ART_FOCUS
     entry ('center 50%': face and fist seated in the
     pop band, the whole scene in the sheet band).
     CAF1 grows to twelve entries.
   - The 30th delivery (2026-11-07) is 《巨神封じの矢》
     (67037924): plain art 'kyoshin' (a blue-haired
     archer drawing a great white winged bow against a
     bellowing giant in swirling green wind) in
     CARD_ART — a SPELL (x1 in the v11 main deck), not
     a keycard. It also adds her deck-scoped override
     (the 16th DECK_ART entry): 'kyoshin-ishizu' (a
     white-robed archer with a golden bow loosing a
     shining arrow at the blue giant god looming over
     an Egyptian temple) in DECK_ART under ishizu.
     Band check, measured like the others: BOTH
     archers' faces sit MID-frame — the plain
     painting's head at ~30-42% of the big file (face
     ~34-40%), the Egyptian painting's hooded face at
     ~37-44% — so center top leaves the pop band on
     the giant / the giant god alone with the archer
     essentially absent. The plain painting takes the
     13th ART_FOCUS entry ('center 40%': the whole
     head and drawing arms in the pop band, head,
     torso, bow and the giant's face in the sheet
     band) and the variant the 14th ('center 40%':
     hooded head, face and golden bow in the pop
     band, the whole figure, the god and the temple
     in the sheet band). CAF1 grows to fourteen
     entries.
   - The 31st delivery (2026-11-07) is 《光の護封霊剣》
     (78625592): plain art 'gofuu' (three golden
     swords with star guards standing in green
     radiating light, the great sword at center) in
     CARD_ART — a SPELL (x1 in the v11 main deck),
     not a keycard, with NO deck-scoped override.
     Band check, measured like the others: the great
     central sword's star guard spans ~35-52% of the
     big file (gem ~44%), mid-frame, not high, and
     its pommel tops out at ~33% — so center top
     leaves the pop band on the light burst and the
     two flanking swords' star tops with only the
     central pommel tips at its bottom edge, the
     main subject cropped away. It takes the 15th
     ART_FOCUS entry ('center 40%': the central star
     guard seated mid pop band, all three guards
     and most of the blades in the sheet band).
     CAF1 grows to fifteen entries.
   - The 32nd delivery (2026-11-07) is 《騒動》
     (51612489): plain art 'soudo' (three green
     goblins fleeing a towering shadow monster
     under a crimson sky, the lead goblin large in
     the foreground) in CARD_ART — a TRAP (x1 in
     the v11 main deck), not a keycard, with NO
     deck-scoped override. Band check, measured
     like the others: the foreground goblin's face
     spans ~37-56% of the big file, mid-frame, not
     high (the shadow monster's glowing face sits
     high at ~10-20%) — so center top leaves the
     pop band on the shadow monster alone with the
     goblin's face entirely below its bottom edge.
     It takes the 16th ART_FOCUS entry ('center
     40%': the goblin's whole face seated in the
     pop band, his whole figure and the monster in
     the sheet band). CAF1 grows to sixteen
     entries.
   - The 33rd delivery (2026-11-07) is 《転生の予言》
     (46652477): plain art 'yogen' (a hooded fortune
     teller holding a glowing card over her table,
     candles and a crystal ball beside her) in
     CARD_ART — a SPELL (x1 in the v11 main deck),
     not a keycard. It also adds her deck-scoped
     override (the 17th DECK_ART entry):
     'yogen-ishizu' (a glowing golden pentagram
     with a card floating at its center, raised
     over a golden cauldron by a hooded figure with
     clawed hands) in DECK_ART under ishizu. The
     Ishizu painting is the second delivered at 3:4
     (1086x1448), so its big file follows the
     baromett method (full height kept, the 640:882
     window taken horizontally at x=35, width
     1051); the small file is the standard
     top-anchored square. The same delivery also
     registers 《魔法再生》 (29228529, not in the
     current pool) on the 'yogen-ishizu' slug in
     CARD_ART — by the user's instruction it REUSES
     the pentagram painting as its common art and
     shares its files, exactly like 《生贄の抱く爆弾》
     on 'bakudan-ishizu' in the 27th delivery.
     Band check, measured like the others: the
     fortune teller's visible face spans ~34-39%
     of the big file (her hooded head ~15-42%)
     with the glowing card she holds at ~46-56%,
     mid-frame, not high — so center top leaves
     the pop band on the curtains and skulls with
     her face just below its bottom edge and the
     glowing card entirely out. She takes the 17th
     ART_FOCUS entry ('center 40%': face, candles
     and the glowing card seated in the pop band,
     head, face, card and both hands in the sheet
     band). The pentagram painting is judged
     separately: its star spans ~22-65% of the big
     file with the card at its center at ~40-50%
     — center top leaves the pop band on the hood
     and clawed hands with only the star's top
     point showing, its center and card cropped
     away. It takes the 18th ART_FOCUS entry
     ('center 30%': the star from its top point
     through the central card, with the figure's
     glowing eyes, seated in the pop band, and
     star, card, hands and cauldron in the sheet
     band; 'center 40%' was measured and rejected
     — it clips the star's top point and the
     figure's eyes). CAF1 grows to eighteen
     entries. Her registration also retires her
     from this file's UNLISTED exemplar role (see
     below): the role passes to 《天至る叛逆》
     (71593652, Mutiny in the Sky), another real
     Ishizu main-deck card (x2) with no individual
     art.
   - The 34th delivery (2026-11-07) is 《死者蘇生》
     (83764718): plain art 'sosei' (a green ankh
     floating in a burst of blue light) in CARD_ART
     — a SPELL (x1 in the v11 main deck), not a
     keycard, with NO deck-scoped override. The
     registered passcode is the NORMAL printing the
     Ishizu deck runs; the Mai deck's Magic Card
     printing is a different passcode and stays
     untouched. Band check, measured like the
     others: the ankh is one tall subject spanning
     ~16-84% of the big file (loop ~16-52%,
     crossbar ~45-58%) with the star core at its
     junction at ~49-54%, mid-frame, not high — so
     center top leaves the pop band on the light
     rays and the loop's top arc alone, the ankh
     itself essentially absent, and cuts the
     ankh's bottom tip out of the sheet band. It
     takes the 19th ART_FOCUS entry ('center 40%':
     the loop's lower half, the whole crossbar and
     the star core seated in the pop band, the
     whole ankh framed in the sheet band; 'center
     50%' was measured and rejected — its pop
     window loses almost all of the loop). CAF1
     grows to nineteen entries.
   - The 35th delivery (2026-11-08) is 《天至る叛逆》
     (71593652): plain art 'hangyaku' (a white-robed
     figure with black wings flying up toward the
     sun) in CARD_ART — a TRAP (x2 in the v11 main
     deck), not a keycard — PLUS the 18th DECK_ART
     entry ('hangyaku-ishizu', the Egyptian painting
     of a gold-and-teal armored figure gazing up at
     the sun; the second TRAP with an override, after
     Bakudan). This registration completes the
     Ishizu deck: every card in its main and extra
     decks now has individual art. Band check,
     measured like the others: on the plain painting
     the sun sits at ~10-24% of the big file, the
     hair/head mass at ~34-52% and the torso with
     its red-gem sash at ~50-62%, so center top
     leaves the pop band on the sun and the great
     wing with the figure essentially absent; it
     takes the 20th ART_FOCUS entry ('center 40%':
     head and upper body seated in the pop band,
     sun and figure framed together in the sheet
     band; 'center 30%' measured and rejected — the
     torso rides the pop band's bottom edge). On
     the Egyptian painting the helmeted head spans
     ~28-42% and the chest/shoulder armor ~40-60%,
     so center top leaves the pop band on the sun
     and clouds with only the helmet crest tips
     showing; the variant takes the 21st ART_FOCUS
     entry ('center 30%': the head seated mid-band,
     sun and red-gem guards framed in the sheet
     band; 'center 40%' measured and rejected — the
     crest rides the pop band's top edge and the sun
     leaves the pop band). CAF1 grows to twenty-one
     entries. Mutiny's registration also retires it
     from this file's UNLISTED exemplar role (see
     below): with the Ishizu deck complete, the role
     crosses to the GG deck — 《テラ・フォーミング》
     (73628505, Terraforming), a real GG main-deck
     card (x2) with no individual art.
   Method: boot the real client in jsdom (harness as test-setvis),
   paint a fabricated board through the client's own render() and
   assert the DOM contract in one synchronous eval. */
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

const MUDORA = 99937011, AGIDO = 62320425, KELBEK = 25926710, KELDO = 63542003, ZOLGA = 31525442, CARDAN = 86605515, SPHINX = 46148485, TAIYOU = 38699854, TSUKI = 14087893, CHAOSPOD = 79106360, OKA = 9350312, HANA = 62133026, MORI = 36745317, KAKAN = 14108995, CARBON = 15079028, SILKY = 55702233, HORUS = 36898537, HAKAMORI = 98715423, LUCE = 45409943, MINERVA = 30100551, CASTEL = 82633039, BAROMETT = 62967433, PLUTO = 37706769, TRILO = 21368273, HYPERION = 63101468, GENSEI = 17484499, FUKUSO = 35726888, MICHIZURE = 16435215, KYOSHIN = 67037924, GOFUU = 78625592, SOUDO = 51612489, YOGEN = 46652477, SOSEI = 83764718, HANGYAKU = 71593652;
// The unlisted exemplar moved Zolga -> Sphinx (5th delivery) ->
// Mori (after the 7th) -> Carbon (after the 13th) -> Shilkey
// (after the 15th) -> the deck's CLASSIC 《アギド》 16135253
// -> 《現世と冥界の逆転》 17484499 -> 《転生の予言》 46652477
// (after the 26th) -> 《天至る叛逆》 71593652 (after the
// 33rd), and Mutiny gained art in the 35th delivery —
// which completes the Ishizu deck, so no Ishizu card can
// hold the role any more. The role crosses to the GG deck:
// 《テラ・フォーミング》 73628505 (Terraforming), a real GG
// main-deck card (x2) with no individual art. Usable on
// every fallback surface (tile / hand / preview / ghost),
// like every exemplar before it.
const UNLISTED = 73628505;

// ---- delivered art files (existence + top-anchored dimensions) ----
for (const [f, w, h] of [['card-art-mudora-s.jpg', 320, 320], ['card-art-mudora.jpg', 640, 882],
                         ['card-art-agido-s.jpg', 320, 320], ['card-art-agido.jpg', 640, 882],
                         ['card-art-kelbek-s.jpg', 320, 320], ['card-art-kelbek.jpg', 640, 882],
                         ['card-art-keldo-s.jpg', 320, 320], ['card-art-keldo.jpg', 640, 882],
                         ['card-art-zolga-s.jpg', 320, 320], ['card-art-zolga.jpg', 640, 882],
                         ['card-art-cardan-s.jpg', 320, 320], ['card-art-cardan.jpg', 640, 882],
                         ['card-art-sphinx-s.jpg', 320, 320], ['card-art-sphinx.jpg', 640, 882],
                         ['card-art-taiyou-s.jpg', 320, 320], ['card-art-taiyou.jpg', 640, 882],
                         ['card-art-tsuki-s.jpg', 320, 320], ['card-art-tsuki.jpg', 640, 882],
                         ['card-art-chaospod-s.jpg', 320, 320], ['card-art-chaospod.jpg', 640, 882],
                         ['card-art-oka-s.jpg', 320, 320], ['card-art-oka.jpg', 640, 882],
                         ['card-art-hana-s.jpg', 320, 320], ['card-art-hana.jpg', 640, 882],
                         ['card-art-mori-s.jpg', 320, 320], ['card-art-mori.jpg', 640, 882],
                         ['card-art-mori-ishizu-s.jpg', 320, 320], ['card-art-mori-ishizu.jpg', 640, 882],
                         ['card-art-hana-ishizu-s.jpg', 320, 320], ['card-art-hana-ishizu.jpg', 640, 882],
                         ['card-art-oka-ishizu-s.jpg', 320, 320], ['card-art-oka-ishizu.jpg', 640, 882],
                         ['card-art-kakan-s.jpg', 320, 320], ['card-art-kakan.jpg', 640, 882],
                         ['card-art-kakan-ishizu-s.jpg', 320, 320], ['card-art-kakan-ishizu.jpg', 640, 882],
                         ['card-art-carbon-s.jpg', 320, 320], ['card-art-carbon.jpg', 640, 882],
                         ['card-art-carbon-ishizu-s.jpg', 320, 320], ['card-art-carbon-ishizu.jpg', 640, 882],
                         ['card-art-silky-s.jpg', 320, 320], ['card-art-silky.jpg', 640, 882],
                         ['card-art-silky-ishizu-s.jpg', 320, 320], ['card-art-silky-ishizu.jpg', 640, 882],
                         ['card-art-horus-s.jpg', 320, 320], ['card-art-horus.jpg', 640, 882],
                         ['card-art-hakamori-s.jpg', 320, 320], ['card-art-hakamori.jpg', 640, 882],
                         ['card-art-luce-s.jpg', 320, 320], ['card-art-luce.jpg', 640, 882],
                         ['card-art-luce-ishizu-s.jpg', 320, 320], ['card-art-luce-ishizu.jpg', 640, 882],
                         ['card-art-minerva-s.jpg', 320, 320], ['card-art-minerva.jpg', 640, 882],
                         ['card-art-minerva-ishizu-s.jpg', 320, 320], ['card-art-minerva-ishizu.jpg', 640, 882],
                         ['card-art-castel-s.jpg', 320, 320], ['card-art-castel.jpg', 640, 882],
                         ['card-art-castel-ishizu-s.jpg', 320, 320], ['card-art-castel-ishizu.jpg', 640, 882],
                         ['card-art-baromett-s.jpg', 320, 320], ['card-art-baromett.jpg', 640, 882],
                         ['card-art-baromett-ishizu-s.jpg', 320, 320], ['card-art-baromett-ishizu.jpg', 640, 882],
                         ['card-art-pluto-s.jpg', 320, 320], ['card-art-pluto.jpg', 640, 882],
                         ['card-art-pluto-ishizu-s.jpg', 320, 320], ['card-art-pluto-ishizu.jpg', 640, 882],
                         ['card-art-trilo-s.jpg', 320, 320], ['card-art-trilo.jpg', 640, 882],
                         ['card-art-trilo-ishizu-s.jpg', 320, 320], ['card-art-trilo-ishizu.jpg', 640, 882],
                         ['card-art-hyperion-s.jpg', 320, 320], ['card-art-hyperion.jpg', 640, 882],
                         ['card-art-hyperion-ishizu-s.jpg', 320, 320], ['card-art-hyperion-ishizu.jpg', 640, 882],
                         ['card-art-gensei-s.jpg', 320, 320], ['card-art-gensei.jpg', 640, 882],
                         ['card-art-fukuso-s.jpg', 320, 320], ['card-art-fukuso.jpg', 640, 882],
                         ['card-art-fukuso-ishizu-s.jpg', 320, 320], ['card-art-fukuso-ishizu.jpg', 640, 882],
                         ['card-art-michizure-s.jpg', 320, 320], ['card-art-michizure.jpg', 640, 882],
                         ['card-art-kyoshin-s.jpg', 320, 320], ['card-art-kyoshin.jpg', 640, 882],
                         ['card-art-kyoshin-ishizu-s.jpg', 320, 320], ['card-art-kyoshin-ishizu.jpg', 640, 882],
                         ['card-art-gofuu-s.jpg', 320, 320], ['card-art-gofuu.jpg', 640, 882],
                         ['card-art-soudo-s.jpg', 320, 320], ['card-art-soudo.jpg', 640, 882],
                         ['card-art-yogen-s.jpg', 320, 320], ['card-art-yogen.jpg', 640, 882],
                         ['card-art-yogen-ishizu-s.jpg', 320, 320], ['card-art-yogen-ishizu.jpg', 640, 882],
                         ['card-art-sosei-s.jpg', 320, 320], ['card-art-sosei.jpg', 640, 882],
                         ['card-art-hangyaku-s.jpg', 320, 320], ['card-art-hangyaku.jpg', 640, 882],
                         ['card-art-hangyaku-ishizu-s.jpg', 320, 320], ['card-art-hangyaku-ishizu.jpg', 640, 882]]) {
  const p = path.join(V2, '..', 'assets', f);
  ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'CA0: ' + f + ' delivered (>10KB)');
}
ok(data.decks.ishizu.main.filter(c => c === MUDORA).length === 3, 'CA0b: the Ishizu deck runs 3 copies of Mudora');
ok(data.decks.ishizu.main.filter(c => c === AGIDO).length === 0 &&
   data.decks.ishizu.main.filter(c => c === 16135253).length === 1,
  'CA0c: recipe v11 — the deck runs the CLASSIC Agido (16135253) x1; per the user ruling of 2026-11-04 the classic card aliases the Ancient Guard Agido art (see CA7b2/CA7c)');
ok(data.decks.ishizu.main.filter(c => c === KELBEK).length === 1, 'CA0d: the Ishizu deck runs 1 copy of Kelbek');
ok(data.decks.ishizu.main.filter(c => c === KELDO).length === 3, 'CA0e: the Ishizu deck runs 3 copies of Keldo');
ok(data.decks.ishizu.main.filter(c => c === ZOLGA).length === 1, 'CA0f: the Ishizu deck runs 1 copy of Zolga');
ok(data.decks.ishizu.main.filter(c => c === CARDAN).length === 3, 'CA0g: the Ishizu deck runs 3 copies of Cardan');
ok(data.decks.ishizu.main.filter(c => c === SPHINX).length === 1, 'CA0h: the Ishizu deck runs 1 copy of Sphinx');
ok(data.decks.ishizu.main.filter(c => c === TAIYOU).length === 1, 'CA0i: the Ishizu deck runs 1 copy of Taiyou');
ok(data.decks.ishizu.main.filter(c => c === TSUKI).length === 1, 'CA0j: the Ishizu deck runs 1 copy of Tsuki');
ok(data.decks.ishizu.main.filter(c => c === CHAOSPOD).length === 2, 'CA0k: the Ishizu deck runs 2 copies of Chaos Pod');
ok(data.decks.ishizu.main.filter(c => c === OKA).length === 1, 'CA0l: the Ishizu deck runs 1 copy of Oka');
ok(data.decks.ishizu.main.filter(c => c === HANA).length === 2, 'CA0m: the Ishizu deck runs 2 copies of Hana');
ok(data.decks.ishizu.main.filter(c => c === MORI).length === 3, 'CA0n: the Ishizu deck runs 3 copies of Mori');
ok(data.decks.gg.main.filter(c => c === UNLISTED).length === 2, 'CA0o: the GG deck runs 2 copies of the unlisted exemplar (Terraforming — the role crossed decks in the 35th delivery, when Mutiny in the Sky gained art and completed the Ishizu deck)');
ok(data.decks.ishizu.main.filter(c => c === CARBON).length === 3, 'CA0p: the Ishizu deck runs 3 copies of Carbon');
ok(data.decks.ishizu.main.filter(c => c === KAKAN).length === 1, 'CA0q: the Ishizu deck runs 1 copy of Kakan (Vernusylph Flower Crown)');
ok(!data.decks.gg.main.includes(KAKAN) && !data.decks.gg.extra.includes(KAKAN), 'CA0r: the GG deck does NOT run Kakan (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === SILKY).length === 2, 'CA0s: the Ishizu deck runs 2 copies of Silky');
ok(!data.decks.gg.main.includes(SILKY) && !data.decks.gg.extra.includes(SILKY), 'CA0t: the GG deck does NOT run Silky (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === HORUS).length === 2, 'CA0u: the Ishizu EXTRA deck runs 2 copies of Horus (17th delivery — the first EX monster with individual art)');
ok(!data.decks.gg.main.includes(HORUS) && !data.decks.gg.extra.includes(HORUS), 'CA0v: the GG deck does NOT run Horus (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === HAKAMORI).length === 3, 'CA0w: the Ishizu deck runs 3 copies of Hakamori-no-Wana (18th delivery — the first trap with individual art)');
ok(!data.decks.gg.main.includes(HAKAMORI) && !data.decks.gg.extra.includes(HAKAMORI), 'CA0x: the GG deck does NOT run Hakamori (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === LUCE).length === 3, 'CA0y: the Ishizu EXTRA deck runs 3 copies of Luce (19th delivery — an Ishizu keycard)');
ok(!data.decks.gg.main.includes(LUCE) && !data.decks.gg.extra.includes(LUCE), 'CA0z: the GG deck does NOT run Luce (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === MINERVA).length === 2, 'CA0z2: the Ishizu EXTRA deck runs 2 copies of Minerva (20th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(MINERVA) && !data.decks.gg.extra.includes(MINERVA), 'CA0z3: the GG deck does NOT run Minerva (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === CASTEL).length === 3, 'CA0z4: the Ishizu EXTRA deck runs 3 copies of Castel (21st delivery — recipe v11)');
ok(!data.decks.gg.main.includes(CASTEL) && !data.decks.gg.extra.includes(CASTEL), 'CA0z5: the GG deck does NOT run Castel (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === BAROMETT).length === 1, 'CA0z6: the Ishizu EXTRA deck runs 1 copy of Baromett (22nd delivery — recipe v11)');
ok(!data.decks.gg.main.includes(BAROMETT) && !data.decks.gg.extra.includes(BAROMETT), 'CA0z7: the GG deck does NOT run Baromett (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === PLUTO).length === 2, 'CA0z8: the Ishizu EXTRA deck runs 2 copies of Pluto (23rd delivery — recipe v11)');
ok(!data.decks.gg.main.includes(PLUTO) && !data.decks.gg.extra.includes(PLUTO), 'CA0z9: the GG deck does NOT run Pluto (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === TRILO).length === 1, 'CA0z10: the Ishizu EXTRA deck runs 1 copy of Trilosukuta (24th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(TRILO) && !data.decks.gg.extra.includes(TRILO), 'CA0z11: the GG deck does NOT run Trilosukuta (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.extra.filter(c => c === HYPERION).length === 1, 'CA0z12: the Ishizu EXTRA deck runs 1 copy of Hyperion (25th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(HYPERION) && !data.decks.gg.extra.includes(HYPERION), 'CA0z13: the GG deck does NOT run Hyperion (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === GENSEI).length === 1, 'CA0z14: the Ishizu deck runs 1 copy of Gensei to Meikai no Gyakuten (26th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(GENSEI) && !data.decks.gg.extra.includes(GENSEI), 'CA0z15: the GG deck does NOT run Gensei (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === FUKUSO).length === 2, 'CA0z16: the Ishizu deck runs 2 copies of Oroka na Fukuso (28th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(FUKUSO) && !data.decks.gg.extra.includes(FUKUSO), 'CA0z17: the GG deck does NOT run Fukuso (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === MICHIZURE).length === 1, 'CA0z18: the Ishizu deck runs 1 copy of Hakaana no Michizure (29th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(MICHIZURE) && !data.decks.gg.extra.includes(MICHIZURE), 'CA0z19: the GG deck does NOT run Michizure (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === KYOSHIN).length === 1, 'CA0z20: the Ishizu deck runs 1 copy of Kyoshin Fuuji no Ya (30th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(KYOSHIN) && !data.decks.gg.extra.includes(KYOSHIN), 'CA0z21: the GG deck does NOT run Kyoshin (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === YOGEN).length === 1, 'CA0z22: the Ishizu deck runs 1 copy of Tensei no Yogen (33rd delivery — recipe v11)');
ok(!data.decks.gg.main.includes(YOGEN) && !data.decks.gg.extra.includes(YOGEN), 'CA0z23: the GG deck does NOT run Yogen (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === SOSEI).length === 1, 'CA0z24: the Ishizu deck runs 1 copy of Shisha Sosei (34th delivery — recipe v11, the normal printing 83764718)');
ok(!data.decks.gg.main.includes(SOSEI) && !data.decks.gg.extra.includes(SOSEI), 'CA0z25: the GG deck does NOT run Shisha Sosei (code-only surfaces resolve its deck membership unambiguously to Ishizu)');
ok(data.decks.ishizu.main.filter(c => c === HANGYAKU).length === 2, 'CA0z26: the Ishizu deck runs 2 copies of Hangyaku (35th delivery — recipe v11)');
ok(!data.decks.gg.main.includes(HANGYAKU) && !data.decks.gg.extra.includes(HANGYAKU), 'CA0z27: the GG deck does NOT run Hangyaku (code-only surfaces resolve its deck membership unambiguously to Ishizu)');

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
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'CA1: client boots');

  // ---- helper contract (pure, synchronous) ----
  const helpers = window.eval(`(() => ({
    slug: CARD_ART[${MUDORA}],
    small: cardArtFile(${MUDORA}, false),
    big: cardArtFile(${MUDORA}, true),
    inline: artInline(${MUDORA}),
    inlineBig: artInline(${MUDORA}, true),
    css: artCss(${MUDORA}),
    unlistedInline: artInline(${UNLISTED}),
    unlistedFile: cardArtFile(${UNLISTED}, false),
    nullInline: artInline(null),
    preloaded: [...artPreloaded],
    agidoSlug: CARD_ART[${AGIDO}],
    agidoInline: artInline(${AGIDO}),
    classicAgidoSlug: CARD_ART[16135253],
    classicAgidoInline: artInline(16135253),
    kelbekSlug: CARD_ART[${KELBEK}],
    kelbekInline: artInline(${KELBEK}),
    keldoSlug: CARD_ART[${KELDO}],
    keldoInline: artInline(${KELDO}),
    zolgaSlug: CARD_ART[${ZOLGA}],
    zolgaInline: artInline(${ZOLGA}),
    cardanSlug: CARD_ART[${CARDAN}],
    cardanInline: artInline(${CARDAN}),
    sphinxSlug: CARD_ART[${SPHINX}],
    sphinxInline: artInline(${SPHINX}),
    taiyouSlug: CARD_ART[${TAIYOU}],
    taiyouInline: artInline(${TAIYOU}),
    tsukiSlug: CARD_ART[${TSUKI}],
    tsukiInline: artInline(${TSUKI}),
    chaoospodSlug: CARD_ART[${CHAOSPOD}],
    chaoospodInline: artInline(${CHAOSPOD}),
    okaSlug: CARD_ART[${OKA}],
    okaInline: artInline(${OKA}),
    hanaSlug: CARD_ART[${HANA}],
    hanaInline: artInline(${HANA}),
    moriSlug: CARD_ART[${MORI}],
    moriInline: artInline(${MORI}),
    deckArtMori: DECK_ART.ishizu && DECK_ART.ishizu[${MORI}],
    moriIshizuSmall: cardArtFile(${MORI}, false, 'ishizu'),
    moriIshizuBig: cardArtFile(${MORI}, true, 'ishizu'),
    moriIshizuInline: artInline(${MORI}, false, 'ishizu'),
    moriGg: cardArtFile(${MORI}, false, 'gg'),
    moriNoCtx: cardArtFile(${MORI}, false),
    mudoraIshizu: cardArtFile(${MUDORA}, false, 'ishizu'),
    deckArtHana: DECK_ART.ishizu && DECK_ART.ishizu[${HANA}],
    hanaIshizuSmall: cardArtFile(${HANA}, false, 'ishizu'),
    hanaIshizuBig: cardArtFile(${HANA}, true, 'ishizu'),
    hanaGg: cardArtFile(${HANA}, false, 'gg'),
    deckArtOka: DECK_ART.ishizu && DECK_ART.ishizu[${OKA}],
    okaIshizuSmall: cardArtFile(${OKA}, false, 'ishizu'),
    okaIshizuBig: cardArtFile(${OKA}, true, 'ishizu'),
    okaGg: cardArtFile(${OKA}, false, 'gg'),
    kakanSlug: CARD_ART[${KAKAN}],
    kakanInline: artInline(${KAKAN}),
    deckArtKakan: DECK_ART.ishizu && DECK_ART.ishizu[${KAKAN}],
    kakanIshizuSmall: cardArtFile(${KAKAN}, false, 'ishizu'),
    kakanIshizuBig: cardArtFile(${KAKAN}, true, 'ishizu'),
    kakanIshizuInline: artInline(${KAKAN}, false, 'ishizu'),
    kakanGg: cardArtFile(${KAKAN}, false, 'gg'),
    carbonSlug: CARD_ART[${CARBON}],
    carbonInline: artInline(${CARBON}),
    deckArtCarbon: DECK_ART.ishizu && DECK_ART.ishizu[${CARBON}],
    carbonIshizuSmall: cardArtFile(${CARBON}, false, 'ishizu'),
    carbonIshizuBig: cardArtFile(${CARBON}, true, 'ishizu'),
    carbonIshizuInline: artInline(${CARBON}, false, 'ishizu'),
    carbonGg: cardArtFile(${CARBON}, false, 'gg'),
    silkySlug: CARD_ART[${SILKY}],
    silkyInline: artInline(${SILKY}),
    deckArtSilky: DECK_ART.ishizu && DECK_ART.ishizu[${SILKY}],
    silkyIshizuSmall: cardArtFile(${SILKY}, false, 'ishizu'),
    silkyIshizuBig: cardArtFile(${SILKY}, true, 'ishizu'),
    silkyIshizuInline: artInline(${SILKY}, false, 'ishizu'),
    silkyGg: cardArtFile(${SILKY}, false, 'gg'),
    horusSlug: CARD_ART[${HORUS}],
    horusInline: artInline(${HORUS}),
    horusSmall: cardArtFile(${HORUS}, false),
    horusBig: cardArtFile(${HORUS}, true),
    horusDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${HORUS}],
    horusIshizu: cardArtFile(${HORUS}, false, 'ishizu'),
    hakamoriSlug: CARD_ART[${HAKAMORI}],
    hakamoriInline: artInline(${HAKAMORI}),
    hakamoriSmall: cardArtFile(${HAKAMORI}, false),
    hakamoriBig: cardArtFile(${HAKAMORI}, true),
    hakamoriDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${HAKAMORI}],
    hakamoriIshizu: cardArtFile(${HAKAMORI}, false, 'ishizu'),
    luceSlug: CARD_ART[${LUCE}],
    luceInline: artInline(${LUCE}),
    luceSmall: cardArtFile(${LUCE}, false),
    luceBig: cardArtFile(${LUCE}, true),
    luceDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${LUCE}],
    luceIshizu: cardArtFile(${LUCE}, false, 'ishizu'),
    luceIshizuSmall: cardArtFile(${LUCE}, false, 'ishizu'),
    luceIshizuBig: cardArtFile(${LUCE}, true, 'ishizu'),
    luceIshizuInline: artInline(${LUCE}, false, 'ishizu'),
    luceGg: cardArtFile(${LUCE}, false, 'gg'),
    minervaSlug: CARD_ART[${MINERVA}],
    minervaInline: artInline(${MINERVA}),
    minervaSmall: cardArtFile(${MINERVA}, false),
    minervaBig: cardArtFile(${MINERVA}, true),
    minervaDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${MINERVA}],
    minervaIshizu: cardArtFile(${MINERVA}, false, 'ishizu'),
    minervaIshizuSmall: cardArtFile(${MINERVA}, false, 'ishizu'),
    minervaIshizuBig: cardArtFile(${MINERVA}, true, 'ishizu'),
    minervaIshizuInline: artInline(${MINERVA}, false, 'ishizu'),
    minervaGg: cardArtFile(${MINERVA}, false, 'gg'),
    castelSlug: CARD_ART[${CASTEL}],
    castelInline: artInline(${CASTEL}),
    castelSmall: cardArtFile(${CASTEL}, false),
    castelBig: cardArtFile(${CASTEL}, true),
    castelDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${CASTEL}],
    castelIshizu: cardArtFile(${CASTEL}, false, 'ishizu'),
    castelIshizuSmall: cardArtFile(${CASTEL}, false, 'ishizu'),
    castelIshizuBig: cardArtFile(${CASTEL}, true, 'ishizu'),
    castelIshizuInline: artInline(${CASTEL}, false, 'ishizu'),
    castelGg: cardArtFile(${CASTEL}, false, 'gg'),
    baromettSlug: CARD_ART[${BAROMETT}],
    baromettInline: artInline(${BAROMETT}),
    baromettSmall: cardArtFile(${BAROMETT}, false),
    baromettBig: cardArtFile(${BAROMETT}, true),
    baromettDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${BAROMETT}],
    baromettIshizu: cardArtFile(${BAROMETT}, false, 'ishizu'),
    baromettIshizuSmall: cardArtFile(${BAROMETT}, false, 'ishizu'),
    baromettIshizuBig: cardArtFile(${BAROMETT}, true, 'ishizu'),
    baromettIshizuInline: artInline(${BAROMETT}, false, 'ishizu'),
    baromettGg: cardArtFile(${BAROMETT}, false, 'gg'),
    plutoSlug: CARD_ART[${PLUTO}],
    plutoInline: artInline(${PLUTO}),
    plutoSmall: cardArtFile(${PLUTO}, false),
    plutoBig: cardArtFile(${PLUTO}, true),
    plutoDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${PLUTO}],
    plutoIshizu: cardArtFile(${PLUTO}, false, 'ishizu'),
    plutoIshizuSmall: cardArtFile(${PLUTO}, false, 'ishizu'),
    plutoIshizuBig: cardArtFile(${PLUTO}, true, 'ishizu'),
    plutoIshizuInline: artInline(${PLUTO}, false, 'ishizu'),
    plutoGg: cardArtFile(${PLUTO}, false, 'gg'),
    triloSlug: CARD_ART[${TRILO}],
    triloInline: artInline(${TRILO}),
    triloSmall: cardArtFile(${TRILO}, false),
    triloBig: cardArtFile(${TRILO}, true),
    triloDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${TRILO}],
    triloIshizu: cardArtFile(${TRILO}, false, 'ishizu'),
    triloIshizuSmall: cardArtFile(${TRILO}, false, 'ishizu'),
    triloIshizuBig: cardArtFile(${TRILO}, true, 'ishizu'),
    triloIshizuInline: artInline(${TRILO}, false, 'ishizu'),
    triloGg: cardArtFile(${TRILO}, false, 'gg'),
    hyperionSlug: CARD_ART[${HYPERION}],
    hyperionInline: artInline(${HYPERION}),
    hyperionSmall: cardArtFile(${HYPERION}, false),
    hyperionBig: cardArtFile(${HYPERION}, true),
    hyperionDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${HYPERION}],
    hyperionIshizu: cardArtFile(${HYPERION}, false, 'ishizu'),
    hyperionIshizuSmall: cardArtFile(${HYPERION}, false, 'ishizu'),
    hyperionIshizuBig: cardArtFile(${HYPERION}, true, 'ishizu'),
    hyperionIshizuInline: artInline(${HYPERION}, false, 'ishizu'),
    hyperionGg: cardArtFile(${HYPERION}, false, 'gg'),
    genseiSlug: CARD_ART[${GENSEI}],
    genseiInline: artInline(${GENSEI}),
    genseiSmall: cardArtFile(${GENSEI}, false),
    genseiBig: cardArtFile(${GENSEI}, true),
    genseiDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${GENSEI}],
    genseiIshizu: cardArtFile(${GENSEI}, false, 'ishizu'),
    genseiGg: cardArtFile(${GENSEI}, false, 'gg'),
    fukusoSlug: CARD_ART[${FUKUSO}],
    fukusoInline: artInline(${FUKUSO}),
    fukusoSmall: cardArtFile(${FUKUSO}, false),
    fukusoBig: cardArtFile(${FUKUSO}, true),
    fukusoDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${FUKUSO}],
    fukusoIshizuSmall: cardArtFile(${FUKUSO}, false, 'ishizu'),
    fukusoIshizuBig: cardArtFile(${FUKUSO}, true, 'ishizu'),
    fukusoIshizuInline: artInline(${FUKUSO}, false, 'ishizu'),
    fukusoGg: cardArtFile(${FUKUSO}, false, 'gg'),
    michizureSlug: CARD_ART[${MICHIZURE}],
    michizureInline: artInline(${MICHIZURE}),
    michizureSmall: cardArtFile(${MICHIZURE}, false),
    michizureBig: cardArtFile(${MICHIZURE}, true),
    michizureDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${MICHIZURE}],
    michizureIshizu: cardArtFile(${MICHIZURE}, false, 'ishizu'),
    michizureGg: cardArtFile(${MICHIZURE}, false, 'gg'),
    kyoshinSlug: CARD_ART[${KYOSHIN}],
    kyoshinInline: artInline(${KYOSHIN}),
    kyoshinSmall: cardArtFile(${KYOSHIN}, false),
    kyoshinBig: cardArtFile(${KYOSHIN}, true),
    kyoshinDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${KYOSHIN}],
    kyoshinIshizuSmall: cardArtFile(${KYOSHIN}, false, 'ishizu'),
    kyoshinIshizuBig: cardArtFile(${KYOSHIN}, true, 'ishizu'),
    kyoshinIshizuInline: artInline(${KYOSHIN}, false, 'ishizu'),
    kyoshinGg: cardArtFile(${KYOSHIN}, false, 'gg'),
    gofuuSlug: CARD_ART[${GOFUU}],
    gofuuInline: artInline(${GOFUU}),
    gofuuSmall: cardArtFile(${GOFUU}, false),
    gofuuBig: cardArtFile(${GOFUU}, true),
    gofuuDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${GOFUU}],
    gofuuIshizu: cardArtFile(${GOFUU}, false, 'ishizu'),
    gofuuGg: cardArtFile(${GOFUU}, false, 'gg'),
    soudoSlug: CARD_ART[${SOUDO}],
    soudoInline: artInline(${SOUDO}),
    soudoSmall: cardArtFile(${SOUDO}, false),
    soudoBig: cardArtFile(${SOUDO}, true),
    soudoDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${SOUDO}],
    soudoIshizu: cardArtFile(${SOUDO}, false, 'ishizu'),
    soudoGg: cardArtFile(${SOUDO}, false, 'gg'),
    yogenSlug: CARD_ART[${YOGEN}],
    yogenInline: artInline(${YOGEN}),
    yogenSmall: cardArtFile(${YOGEN}, false),
    yogenBig: cardArtFile(${YOGEN}, true),
    yogenDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${YOGEN}],
    yogenIshizuSmall: cardArtFile(${YOGEN}, false, 'ishizu'),
    yogenIshizuBig: cardArtFile(${YOGEN}, true, 'ishizu'),
    yogenIshizuInline: artInline(${YOGEN}, false, 'ishizu'),
    yogenGg: cardArtFile(${YOGEN}, false, 'gg'),
    soseiSlug: CARD_ART[${SOSEI}],
    soseiInline: artInline(${SOSEI}),
    soseiSmall: cardArtFile(${SOSEI}, false),
    soseiBig: cardArtFile(${SOSEI}, true),
    soseiDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${SOSEI}],
    soseiIshizu: cardArtFile(${SOSEI}, false, 'ishizu'),
    soseiGg: cardArtFile(${SOSEI}, false, 'gg'),
    hangyakuSlug: CARD_ART[${HANGYAKU}],
    hangyakuInline: artInline(${HANGYAKU}),
    hangyakuSmall: cardArtFile(${HANGYAKU}, false),
    hangyakuBig: cardArtFile(${HANGYAKU}, true),
    hangyakuDeckArt: DECK_ART.ishizu && DECK_ART.ishizu[${HANGYAKU}],
    hangyakuIshizuSmall: cardArtFile(${HANGYAKU}, false, 'ishizu'),
    hangyakuIshizuBig: cardArtFile(${HANGYAKU}, true, 'ishizu'),
    hangyakuIshizuInline: artInline(${HANGYAKU}, false, 'ishizu'),
    hangyakuGg: cardArtFile(${HANGYAKU}, false, 'gg'),
    focusTable: ART_FOCUS,
    focusChaosBig: artCss(${CHAOSPOD}, true),
    focusChaosSmall: artCss(${CHAOSPOD}, false),
    focusLuceBig: artCss(${LUCE}, true),
    focusLuceBigIshizu: artCss(${LUCE}, true, 'ishizu'),
    focusLuceBigGg: artCss(${LUCE}, true, 'gg'),
    focusLuceSmallIshizu: artCss(${LUCE}, false, 'ishizu'),
    focusMudoraBig: artCss(${MUDORA}, true),
    focusPosUnlisted: artPosition(${UNLISTED}, true),
    focusApplyChaos: (() => { const d = document.createElement('div'); artApply(d, ${CHAOSPOD}, true); return d.style.backgroundPosition; })(),
    focusApplyMudora: (() => { const d = document.createElement('div'); artApply(d, ${MUDORA}, true); return d.style.backgroundPosition; })(),
    focusApplyChaosSmall: (() => { const d = document.createElement('div'); artApply(d, ${CHAOSPOD}, false); return d.style.backgroundPosition; })(),
    focusMinervaBig: artCss(${MINERVA}, true),
    focusMinervaSmall: artCss(${MINERVA}, false),
    focusApplyMinerva: (() => { const d = document.createElement('div'); artApply(d, ${MINERVA}, true); return d.style.backgroundPosition; })(),
    focusMinervaBigIshizu: artCss(${MINERVA}, true, 'ishizu'),
    focusMinervaBigGg: artCss(${MINERVA}, true, 'gg'),
    focusMinervaSmallIshizu: artCss(${MINERVA}, false, 'ishizu'),
    focusApplyMinervaIshizu: (() => { const d = document.createElement('div'); artApply(d, ${MINERVA}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusCastelBig: artCss(${CASTEL}, true),
    focusCastelSmall: artCss(${CASTEL}, false),
    focusApplyCastel: (() => { const d = document.createElement('div'); artApply(d, ${CASTEL}, true); return d.style.backgroundPosition; })(),
    focusCastelBigIshizu: artCss(${CASTEL}, true, 'ishizu'),
    focusCastelBigGg: artCss(${CASTEL}, true, 'gg'),
    focusCastelSmallIshizu: artCss(${CASTEL}, false, 'ishizu'),
    focusApplyCastelIshizu: (() => { const d = document.createElement('div'); artApply(d, ${CASTEL}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusBaromettBig: artCss(${BAROMETT}, true),
    focusBaromettSmall: artCss(${BAROMETT}, false),
    focusApplyBaromett: (() => { const d = document.createElement('div'); artApply(d, ${BAROMETT}, true); return d.style.backgroundPosition; })(),
    focusBaromettBigIshizu: artCss(${BAROMETT}, true, 'ishizu'),
    focusBaromettBigGg: artCss(${BAROMETT}, true, 'gg'),
    focusBaromettSmallIshizu: artCss(${BAROMETT}, false, 'ishizu'),
    focusApplyBaromettIshizu: (() => { const d = document.createElement('div'); artApply(d, ${BAROMETT}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusPlutoBig: artCss(${PLUTO}, true),
    focusPlutoSmall: artCss(${PLUTO}, false),
    focusApplyPluto: (() => { const d = document.createElement('div'); artApply(d, ${PLUTO}, true); return d.style.backgroundPosition; })(),
    focusPlutoBigIshizu: artCss(${PLUTO}, true, 'ishizu'),
    focusPlutoBigGg: artCss(${PLUTO}, true, 'gg'),
    focusPlutoSmallIshizu: artCss(${PLUTO}, false, 'ishizu'),
    focusApplyPlutoIshizu: (() => { const d = document.createElement('div'); artApply(d, ${PLUTO}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusTriloBig: artCss(${TRILO}, true),
    focusTriloSmall: artCss(${TRILO}, false),
    focusApplyTrilo: (() => { const d = document.createElement('div'); artApply(d, ${TRILO}, true); return d.style.backgroundPosition; })(),
    focusTriloBigIshizu: artCss(${TRILO}, true, 'ishizu'),
    focusTriloBigGg: artCss(${TRILO}, true, 'gg'),
    focusTriloSmallIshizu: artCss(${TRILO}, false, 'ishizu'),
    focusApplyTriloIshizu: (() => { const d = document.createElement('div'); artApply(d, ${TRILO}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusHyperionBig: artCss(${HYPERION}, true),
    focusHyperionSmall: artCss(${HYPERION}, false),
    focusApplyHyperion: (() => { const d = document.createElement('div'); artApply(d, ${HYPERION}, true); return d.style.backgroundPosition; })(),
    focusHyperionBigIshizu: artCss(${HYPERION}, true, 'ishizu'),
    focusHyperionBigGg: artCss(${HYPERION}, true, 'gg'),
    focusHyperionSmallIshizu: artCss(${HYPERION}, false, 'ishizu'),
    focusApplyHyperionIshizu: (() => { const d = document.createElement('div'); artApply(d, ${HYPERION}, true, 'ishizu'); return d.style.backgroundPosition; })(),
    focusGenseiBig: artCss(${GENSEI}, true),
    focusGenseiSmall: artCss(${GENSEI}, false),
    focusApplyGensei: (() => { const d = document.createElement('div'); artApply(d, ${GENSEI}, true); return d.style.backgroundPosition; })(),
    focusFukusoBig: artCss(${FUKUSO}, true),
    focusFukusoSmall: artCss(${FUKUSO}, false),
    focusApplyFukuso: (() => { const d = document.createElement('div'); artApply(d, ${FUKUSO}, true); return d.style.backgroundPosition; })(),
    focusFukusoBigIshizu: artCss(${FUKUSO}, true, 'ishizu'),
    focusFukusoSmallIshizu: artCss(${FUKUSO}, false, 'ishizu'),
    focusMichizureBig: artCss(${MICHIZURE}, true),
    focusMichizureSmall: artCss(${MICHIZURE}, false),
    focusApplyMichizure: (() => { const d = document.createElement('div'); artApply(d, ${MICHIZURE}, true); return d.style.backgroundPosition; })(),
    focusKyoshinBig: artCss(${KYOSHIN}, true),
    focusKyoshinSmall: artCss(${KYOSHIN}, false),
    focusApplyKyoshin: (() => { const d = document.createElement('div'); artApply(d, ${KYOSHIN}, true); return d.style.backgroundPosition; })(),
    focusKyoshinBigIshizu: artCss(${KYOSHIN}, true, 'ishizu'),
    focusKyoshinSmallIshizu: artCss(${KYOSHIN}, false, 'ishizu'),
    focusGofuuBig: artCss(${GOFUU}, true),
    focusGofuuSmall: artCss(${GOFUU}, false),
    focusApplyGofuu: (() => { const d = document.createElement('div'); artApply(d, ${GOFUU}, true); return d.style.backgroundPosition; })(),
    focusSoudoBig: artCss(${SOUDO}, true),
    focusSoudoSmall: artCss(${SOUDO}, false),
    focusApplySoudo: (() => { const d = document.createElement('div'); artApply(d, ${SOUDO}, true); return d.style.backgroundPosition; })(),
    focusYogenBig: artCss(${YOGEN}, true),
    focusYogenSmall: artCss(${YOGEN}, false),
    focusApplyYogen: (() => { const d = document.createElement('div'); artApply(d, ${YOGEN}, true); return d.style.backgroundPosition; })(),
    focusYogenBigIshizu: artCss(${YOGEN}, true, 'ishizu'),
    focusYogenSmallIshizu: artCss(${YOGEN}, false, 'ishizu'),
    focusSoseiBig: artCss(${SOSEI}, true),
    focusSoseiSmall: artCss(${SOSEI}, false),
    focusApplySosei: (() => { const d = document.createElement('div'); artApply(d, ${SOSEI}, true); return d.style.backgroundPosition; })(),
    focusHangyakuBig: artCss(${HANGYAKU}, true),
    focusHangyakuSmall: artCss(${HANGYAKU}, false),
    focusApplyHangyaku: (() => { const d = document.createElement('div'); artApply(d, ${HANGYAKU}, true); return d.style.backgroundPosition; })(),
    focusHangyakuBigIshizu: artCss(${HANGYAKU}, true, 'ishizu'),
    focusHangyakuSmallIshizu: artCss(${HANGYAKU}, false, 'ishizu'),
  }))()`);
  ok(helpers.agidoSlug === 'agido' && helpers.agidoInline.includes('card-art-agido-s.jpg') && helpers.agidoInline.includes('background-position:center top'), 'CA7b: Agido maps and stamps like Mudora');
  ok(helpers.classicAgidoSlug === 'agido' && helpers.classicAgidoInline.includes('card-art-agido-s.jpg'), 'CA7b2: user ruling 2026-11-04 — the CLASSIC Agido (16135253) aliases the same agido art');
  ok(helpers.kelbekSlug === 'kelbek' && helpers.kelbekInline.includes('card-art-kelbek-s.jpg') && helpers.kelbekInline.includes('background-position:center top'), 'CA7d: Kelbek maps and stamps like the others');
  ok(helpers.keldoSlug === 'keldo' && helpers.keldoInline.includes('card-art-keldo-s.jpg') && helpers.keldoInline.includes('background-position:center top'), 'CA7f: Keldo maps and stamps like the others');
  ok(helpers.zolgaSlug === 'zolga' && helpers.zolgaInline.includes('card-art-zolga-s.jpg') && helpers.zolgaInline.includes('background-position:center top'), 'CA7h: Zolga maps and stamps like the others');
  ok(helpers.cardanSlug === 'cardan' && helpers.cardanInline.includes('card-art-cardan-s.jpg') && helpers.cardanInline.includes('background-position:center top'), 'CA7j: Cardan maps and stamps like the others');
  ok(helpers.sphinxSlug === 'sphinx' && helpers.sphinxInline.includes('card-art-sphinx-s.jpg') && helpers.sphinxInline.includes('background-position:center top'), 'CA7l: Sphinx maps and stamps like the others');
  ok(helpers.taiyouSlug === 'taiyou' && helpers.taiyouInline.includes('card-art-taiyou-s.jpg') && helpers.taiyouInline.includes('background-position:center top'), 'CA7n: Taiyou maps and stamps like the others');
  ok(helpers.tsukiSlug === 'tsuki' && helpers.tsukiInline.includes('card-art-tsuki-s.jpg') && helpers.tsukiInline.includes('background-position:center top'), 'CA7p: Tsuki maps and stamps like the others');
  ok(helpers.chaoospodSlug === 'chaospod' && helpers.chaoospodInline.includes('card-art-chaospod-s.jpg') && helpers.chaoospodInline.includes('background-position:center top'), 'CA7r: Chaos Pod maps and stamps like the others');
  ok(helpers.okaSlug === 'oka' && helpers.okaInline.includes('card-art-oka-s.jpg') && helpers.okaInline.includes('background-position:center top'), 'CA7t: Oka maps and stamps like the others');
  ok(helpers.hanaSlug === 'hana' && helpers.hanaInline.includes('card-art-hana-s.jpg') && helpers.hanaInline.includes('background-position:center top'), 'CA7u: Hana maps and stamps like the others');
  ok(helpers.moriSlug === 'mori' && helpers.moriInline.includes('card-art-mori-s.jpg') && helpers.moriInline.includes('background-position:center top'), 'CA7v: Mori maps and stamps like the others');
  ok(helpers.slug === 'mudora', 'CA2: CARD_ART maps Mudora -> mudora');
  ok(helpers.small === '../assets/card-art-mudora-s.jpg' && helpers.big === '../assets/card-art-mudora.jpg', 'CA3: art files resolve (small + big)');
  ok(helpers.inline.includes('card-art-mudora-s.jpg') && helpers.inline.includes('background-position:center top'), 'CA4: artInline pins the top (crop rule: keep top, cut bottom)');
  ok(helpers.inlineBig.includes('card-art-mudora.jpg') && !helpers.inlineBig.includes('-s.jpg'), 'CA5: big surface uses the big file');
  ok(helpers.unlistedInline === '' && helpers.unlistedFile === null && helpers.nullInline === '', 'CA6: unlisted/null codes fall back (empty = placeholder CSS untouched)');
  ok(helpers.preloaded.includes('../assets/card-art-mudora-s.jpg') && helpers.preloaded.includes('../assets/card-art-mudora.jpg'), 'CA7: boot preloads both sizes for the default decks');
  ok(helpers.preloaded.includes('../assets/card-art-agido-s.jpg') && helpers.preloaded.includes('../assets/card-art-agido.jpg'),
    'CA7c: user ruling 2026-11-04 — classic Agido (16135253) is deck membership for the agido art via the alias, so both sizes ARE preloaded');
  ok(helpers.preloaded.includes('../assets/card-art-kelbek-s.jpg') && helpers.preloaded.includes('../assets/card-art-kelbek.jpg'), 'CA7e: boot preloads Kelbek too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-keldo-s.jpg') && helpers.preloaded.includes('../assets/card-art-keldo.jpg'), 'CA7g: boot preloads Keldo too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-zolga-s.jpg') && helpers.preloaded.includes('../assets/card-art-zolga.jpg'), 'CA7i: boot preloads Zolga too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-cardan-s.jpg') && helpers.preloaded.includes('../assets/card-art-cardan.jpg'), 'CA7k: boot preloads Cardan too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-sphinx-s.jpg') && helpers.preloaded.includes('../assets/card-art-sphinx.jpg'), 'CA7m: boot preloads Sphinx too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-taiyou-s.jpg') && helpers.preloaded.includes('../assets/card-art-taiyou.jpg'), 'CA7o: boot preloads Taiyou too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-tsuki-s.jpg') && helpers.preloaded.includes('../assets/card-art-tsuki.jpg'), 'CA7q: boot preloads Tsuki too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-chaospod-s.jpg') && helpers.preloaded.includes('../assets/card-art-chaospod.jpg'), 'CA7s: boot preloads Chaos Pod too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-oka-s.jpg') && helpers.preloaded.includes('../assets/card-art-oka.jpg'), 'CA7w: boot preloads Oka too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-hana-s.jpg') && helpers.preloaded.includes('../assets/card-art-hana.jpg'), 'CA7x: boot preloads Hana too (same deck)');
  ok(helpers.preloaded.includes('../assets/card-art-mori-s.jpg') && helpers.preloaded.includes('../assets/card-art-mori.jpg'), 'CA7y: boot preloads Mori too (same deck)');
  ok(helpers.deckArtMori === 'mori-ishizu', 'CA7z1: DECK_ART registers Mori -> mori-ishizu for the Ishizu deck only');
  ok(helpers.moriIshizuSmall === '../assets/card-art-mori-ishizu-s.jpg' && helpers.moriIshizuBig === '../assets/card-art-mori-ishizu.jpg' && helpers.moriIshizuInline.includes('card-art-mori-ishizu-s.jpg'), 'CA7z2: Ishizu context resolves Mori to the Egyptian art (small + big)');
  ok(helpers.moriGg === '../assets/card-art-mori-s.jpg' && helpers.moriNoCtx === '../assets/card-art-mori-s.jpg', 'CA7z3: GG / no context resolves Mori to the plain art (override is deck-scoped, not global)');
  ok(helpers.mudoraIshizu === '../assets/card-art-mudora-s.jpg', 'CA7z4: cards without an override keep their base art in Ishizu context');
  ok(helpers.preloaded.includes('../assets/card-art-mori-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-mori-ishizu.jpg'), 'CA7z6: boot preloads the deck-scoped Mori art too (Ishizu is a selected deck)');
  ok(helpers.deckArtHana === 'hana-ishizu', 'CA7z7: DECK_ART registers Hana -> hana-ishizu for the Ishizu deck (2nd entry, same mechanism)');
  ok(helpers.hanaIshizuSmall === '../assets/card-art-hana-ishizu-s.jpg' && helpers.hanaIshizuBig === '../assets/card-art-hana-ishizu.jpg', 'CA7z8: Ishizu context resolves Hana to the Egyptian art (small + big)');
  ok(helpers.hanaGg === '../assets/card-art-hana-s.jpg', 'CA7z9: GG context resolves Hana to the plain art');
  ok(helpers.preloaded.includes('../assets/card-art-hana-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-hana-ishizu.jpg'), 'CA7z10: boot preloads the deck-scoped Hana art too');
  ok(helpers.deckArtOka === 'oka-ishizu', 'CA7z11: DECK_ART registers Oka -> oka-ishizu for the Ishizu deck (3rd entry — the sisters are complete)');
  ok(helpers.okaIshizuSmall === '../assets/card-art-oka-ishizu-s.jpg' && helpers.okaIshizuBig === '../assets/card-art-oka-ishizu.jpg', 'CA7z12: Ishizu context resolves Oka to the Egyptian art (small + big)');
  ok(helpers.okaGg === '../assets/card-art-oka-s.jpg', 'CA7z13: GG context resolves Oka to the plain art');
  ok(helpers.preloaded.includes('../assets/card-art-oka-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-oka-ishizu.jpg'), 'CA7z14: boot preloads the deck-scoped Oka art too');
  ok(helpers.carbonSlug === 'carbon' && helpers.carbonInline.includes('card-art-carbon-s.jpg') && helpers.carbonInline.includes('background-position:center top'), 'CA7z15: Carbon maps and stamps like the others (15th delivery)');
  ok(helpers.preloaded.includes('../assets/card-art-carbon-s.jpg') && helpers.preloaded.includes('../assets/card-art-carbon.jpg'), 'CA7z16: boot preloads Carbon too (same deck)');
  ok(helpers.deckArtCarbon === 'carbon-ishizu', 'CA7z21: DECK_ART registers Carbon -> carbon-ishizu for the Ishizu deck (5th entry, first MONSTER with an override)');
  ok(helpers.carbonIshizuSmall === '../assets/card-art-carbon-ishizu-s.jpg' && helpers.carbonIshizuBig === '../assets/card-art-carbon-ishizu.jpg' && helpers.carbonIshizuInline.includes('card-art-carbon-ishizu-s.jpg'), 'CA7z22: Ishizu context resolves Carbon to the regalia art (small + big)');
  ok(helpers.carbonGg === '../assets/card-art-carbon-s.jpg', 'CA7z23: GG context resolves Carbon to the plain stone art');
  ok(helpers.preloaded.includes('../assets/card-art-carbon-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-carbon-ishizu.jpg'), 'CA7z24: boot preloads the deck-scoped Carbon art too');
  ok(helpers.silkySlug === 'silky' && helpers.silkyInline.includes('card-art-silky-s.jpg') && helpers.silkyInline.includes('background-position:center top'), 'CA7z25: Silky maps and stamps like the others (16th delivery)');
  ok(helpers.preloaded.includes('../assets/card-art-silky-s.jpg') && helpers.preloaded.includes('../assets/card-art-silky.jpg'), 'CA7z26: boot preloads Silky too (same deck)');
  ok(helpers.deckArtSilky === 'silky-ishizu', 'CA7z27: DECK_ART registers Silky -> silky-ishizu for the Ishizu deck (6th entry)');
  ok(helpers.silkyIshizuSmall === '../assets/card-art-silky-ishizu-s.jpg' && helpers.silkyIshizuBig === '../assets/card-art-silky-ishizu.jpg' && helpers.silkyIshizuInline.includes('card-art-silky-ishizu-s.jpg'), 'CA7z28: Ishizu context resolves Silky to the Egyptian-dress art (small + big)');
  ok(helpers.silkyGg === '../assets/card-art-silky-s.jpg', 'CA7z29: GG context resolves Silky to the plain room art');
  ok(helpers.preloaded.includes('../assets/card-art-silky-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-silky-ishizu.jpg'), 'CA7z30: boot preloads the deck-scoped Silky art too');
  ok(helpers.horusSlug === 'horus' && helpers.horusInline.includes('card-art-horus-s.jpg') && helpers.horusInline.includes('background-position:center top'), 'CA7z31: Horus maps and stamps like the others (17th delivery)');
  ok(helpers.horusSmall === '../assets/card-art-horus-s.jpg' && helpers.horusBig === '../assets/card-art-horus.jpg', 'CA7z32: Horus art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-horus-s.jpg') && helpers.preloaded.includes('../assets/card-art-horus.jpg'), 'CA7z33: boot preloads Horus too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.horusDeckArt === undefined && helpers.horusIshizu === '../assets/card-art-horus-s.jpg', 'CA7z34: Horus has NO deck-scoped override — plain registration, Ishizu context keeps the base art');
  ok(helpers.hakamoriSlug === 'hakamori' && helpers.hakamoriInline.includes('card-art-hakamori-s.jpg') && helpers.hakamoriInline.includes('background-position:center top'), 'CA7z35: Hakamori maps and stamps like the others (18th delivery)');
  ok(helpers.hakamoriSmall === '../assets/card-art-hakamori-s.jpg' && helpers.hakamoriBig === '../assets/card-art-hakamori.jpg', 'CA7z36: Hakamori art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-hakamori-s.jpg') && helpers.preloaded.includes('../assets/card-art-hakamori.jpg'), 'CA7z37: boot preloads Hakamori too (main-deck membership warms the art from deck-select time)');
  ok(helpers.hakamoriDeckArt === undefined && helpers.hakamoriIshizu === '../assets/card-art-hakamori-s.jpg', 'CA7z38: Hakamori has NO deck-scoped override — plain registration, Ishizu context keeps the base art');
  ok(helpers.luceSlug === 'luce' && helpers.luceInline.includes('card-art-luce-s.jpg') && helpers.luceInline.includes('background-position:center top'), 'CA7z39: Luce maps and stamps like the others (19th delivery)');
  ok(helpers.luceSmall === '../assets/card-art-luce-s.jpg' && helpers.luceBig === '../assets/card-art-luce.jpg', 'CA7z40: Luce art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-luce-s.jpg') && helpers.preloaded.includes('../assets/card-art-luce.jpg'), 'CA7z41: boot preloads Luce too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.luceDeckArt === 'luce-ishizu', 'CA7z42: DECK_ART registers Luce -> luce-ishizu for the Ishizu deck (7th entry — the first EXTRA-deck monster and the first keycard with an override)');
  ok(helpers.luceIshizuSmall === '../assets/card-art-luce-ishizu-s.jpg' && helpers.luceIshizuBig === '../assets/card-art-luce-ishizu.jpg' && helpers.luceIshizuInline.includes('card-art-luce-ishizu-s.jpg'), 'CA7z43: Ishizu context resolves Luce to the all-gold Egyptian art (small + big)');
  ok(helpers.luceGg === '../assets/card-art-luce-s.jpg', 'CA7z44: GG context resolves Luce to the plain white-winged art');
  ok(helpers.preloaded.includes('../assets/card-art-luce-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-luce-ishizu.jpg'), 'CA7z45: boot preloads the deck-scoped Luce art too (EXTRA-deck membership warms it)');
  ok(helpers.minervaSlug === 'minerva' && helpers.minervaInline.includes('card-art-minerva-s.jpg') && helpers.minervaInline.includes('background-position:center top'), 'CA7z46: Minerva maps and stamps like the others (20th delivery)');
  ok(helpers.minervaSmall === '../assets/card-art-minerva-s.jpg' && helpers.minervaBig === '../assets/card-art-minerva.jpg', 'CA7z47: Minerva art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-minerva-s.jpg') && helpers.preloaded.includes('../assets/card-art-minerva.jpg'), 'CA7z48: boot preloads Minerva too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.minervaDeckArt === 'minerva-ishizu', 'CA7z50: DECK_ART registers Minerva -> minerva-ishizu for the Ishizu deck (8th entry — the second EXTRA-deck monster with an override)');
  ok(helpers.minervaIshizuSmall === '../assets/card-art-minerva-ishizu-s.jpg' && helpers.minervaIshizuBig === '../assets/card-art-minerva-ishizu.jpg' && helpers.minervaIshizuInline.includes('card-art-minerva-ishizu-s.jpg'), 'CA7z51: Ishizu context resolves Minerva to the Egyptian temple art (small + big)');
  ok(helpers.minervaGg === '../assets/card-art-minerva-s.jpg', 'CA7z52: GG context resolves Minerva to the plain floating-cathedral art');
  ok(helpers.preloaded.includes('../assets/card-art-minerva-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-minerva-ishizu.jpg'), 'CA7z53: boot preloads the deck-scoped Minerva art too (EXTRA-deck membership warms it)');
  ok(helpers.castelSlug === 'castel' && helpers.castelInline.includes('card-art-castel-s.jpg') && helpers.castelInline.includes('background-position:center top'), 'CA7z54: Castel maps and stamps like the others (21st delivery)');
  ok(helpers.castelSmall === '../assets/card-art-castel-s.jpg' && helpers.castelBig === '../assets/card-art-castel.jpg', 'CA7z55: Castel art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-castel-s.jpg') && helpers.preloaded.includes('../assets/card-art-castel.jpg'), 'CA7z56: boot preloads Castel too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.castelDeckArt === 'castel-ishizu', 'CA7z57: DECK_ART registers Castel -> castel-ishizu for the Ishizu deck (9th entry — the third EXTRA-deck monster with an override)');
  ok(helpers.castelIshizuSmall === '../assets/card-art-castel-ishizu-s.jpg' && helpers.castelIshizuBig === '../assets/card-art-castel-ishizu.jpg' && helpers.castelIshizuInline.includes('card-art-castel-ishizu-s.jpg'), 'CA7z58: Ishizu context resolves Castel to the Egyptian art (small + big)');
  ok(helpers.castelGg === '../assets/card-art-castel-s.jpg', 'CA7z59: GG context resolves Castel to the plain canyon art');
  ok(helpers.preloaded.includes('../assets/card-art-castel-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-castel-ishizu.jpg'), 'CA7z60: boot preloads the deck-scoped Castel art too (EXTRA-deck membership warms it)');
  ok(helpers.baromettSlug === 'baromett' && helpers.baromettInline.includes('card-art-baromett-s.jpg') && helpers.baromettInline.includes('background-position:center top'), 'CA7z61: Baromett maps and stamps like the others (22nd delivery)');
  ok(helpers.baromettSmall === '../assets/card-art-baromett-s.jpg' && helpers.baromettBig === '../assets/card-art-baromett.jpg', 'CA7z62: Baromett art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-baromett-s.jpg') && helpers.preloaded.includes('../assets/card-art-baromett.jpg'), 'CA7z63: boot preloads Baromett too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.baromettDeckArt === 'baromett-ishizu', 'CA7z64: DECK_ART registers Baromett -> baromett-ishizu for the Ishizu deck (10th entry — the fourth EXTRA-deck monster with an override)');
  ok(helpers.baromettIshizuSmall === '../assets/card-art-baromett-ishizu-s.jpg' && helpers.baromettIshizuBig === '../assets/card-art-baromett-ishizu.jpg' && helpers.baromettIshizuInline.includes('card-art-baromett-ishizu-s.jpg'), 'CA7z65: Ishizu context resolves Baromett to the Egyptian art (small + big)');
  ok(helpers.baromettGg === '../assets/card-art-baromett-s.jpg', 'CA7z66: GG context resolves Baromett to the plain vine art');
  ok(helpers.preloaded.includes('../assets/card-art-baromett-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-baromett-ishizu.jpg'), 'CA7z67: boot preloads the deck-scoped Baromett art too (EXTRA-deck membership warms it)');
  ok(helpers.plutoSlug === 'pluto' && helpers.plutoInline.includes('card-art-pluto-s.jpg') && helpers.plutoInline.includes('background-position:center top'), 'CA7z68: Pluto maps and stamps like the others (23rd delivery)');
  ok(helpers.plutoSmall === '../assets/card-art-pluto-s.jpg' && helpers.plutoBig === '../assets/card-art-pluto.jpg', 'CA7z69: Pluto art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-pluto-s.jpg') && helpers.preloaded.includes('../assets/card-art-pluto.jpg'), 'CA7z70: boot preloads Pluto too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.plutoDeckArt === 'pluto-ishizu', 'CA7z71: DECK_ART registers Pluto -> pluto-ishizu for the Ishizu deck (11th entry — the fifth EXTRA-deck monster with an override)');
  ok(helpers.plutoIshizuSmall === '../assets/card-art-pluto-ishizu-s.jpg' && helpers.plutoIshizuBig === '../assets/card-art-pluto-ishizu.jpg' && helpers.plutoIshizuInline.includes('card-art-pluto-ishizu-s.jpg'), 'CA7z72: Ishizu context resolves Pluto to the Egyptian art (small + big)');
  ok(helpers.plutoGg === '../assets/card-art-pluto-s.jpg', 'CA7z73: GG context resolves Pluto to the plain star-orb art');
  ok(helpers.preloaded.includes('../assets/card-art-pluto-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-pluto-ishizu.jpg'), 'CA7z74: boot preloads the deck-scoped Pluto art too (EXTRA-deck membership warms it)');
  ok(helpers.triloSlug === 'trilo' && helpers.triloInline.includes('card-art-trilo-s.jpg') && helpers.triloInline.includes('background-position:center top'), 'CA7z75: Trilosukuta maps and stamps like the others (24th delivery)');
  ok(helpers.triloSmall === '../assets/card-art-trilo-s.jpg' && helpers.triloBig === '../assets/card-art-trilo.jpg', 'CA7z76: Trilosukuta art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-trilo-s.jpg') && helpers.preloaded.includes('../assets/card-art-trilo.jpg'), 'CA7z77: boot preloads Trilosukuta too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.triloDeckArt === 'trilo-ishizu', 'CA7z78: DECK_ART registers Trilosukuta -> trilo-ishizu for the Ishizu deck (12th entry — the sixth EXTRA-deck monster with an override)');
  ok(helpers.triloIshizuSmall === '../assets/card-art-trilo-ishizu-s.jpg' && helpers.triloIshizuBig === '../assets/card-art-trilo-ishizu.jpg' && helpers.triloIshizuInline.includes('card-art-trilo-ishizu-s.jpg'), 'CA7z79: Ishizu context resolves Trilosukuta to the Egyptian art (small + big)');
  ok(helpers.triloGg === '../assets/card-art-trilo-s.jpg', 'CA7z80: GG context resolves Trilosukuta to the plain silver-knight art');
  ok(helpers.preloaded.includes('../assets/card-art-trilo-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-trilo-ishizu.jpg'), 'CA7z81: boot preloads the deck-scoped Trilosukuta art too (EXTRA-deck membership warms it)');
  ok(helpers.hyperionSlug === 'hyperion' && helpers.hyperionInline.includes('card-art-hyperion-s.jpg') && helpers.hyperionInline.includes('background-position:center top'), 'CA7z82: Hyperion maps and stamps like the others (25th delivery)');
  ok(helpers.hyperionSmall === '../assets/card-art-hyperion-s.jpg' && helpers.hyperionBig === '../assets/card-art-hyperion.jpg', 'CA7z83: Hyperion art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-hyperion-s.jpg') && helpers.preloaded.includes('../assets/card-art-hyperion.jpg'), 'CA7z84: boot preloads Hyperion too (EXTRA-deck membership warms the art from deck-select time)');
  ok(helpers.hyperionDeckArt === 'hyperion-ishizu', 'CA7z86: DECK_ART registers Hyperion -> hyperion-ishizu for the Ishizu deck (13th entry — the seventh EXTRA-deck monster with an override)');
  ok(helpers.hyperionIshizuSmall === '../assets/card-art-hyperion-ishizu-s.jpg' && helpers.hyperionIshizuBig === '../assets/card-art-hyperion-ishizu.jpg' && helpers.hyperionIshizuInline.includes('card-art-hyperion-ishizu-s.jpg'), 'CA7z87: Ishizu context resolves Hyperion to the Egyptian art (small + big)');
  ok(helpers.hyperionGg === '../assets/card-art-hyperion-s.jpg', 'CA7z88: GG context resolves Hyperion to the plain flame art');
  ok(helpers.preloaded.includes('../assets/card-art-hyperion-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-hyperion-ishizu.jpg'), 'CA7z89: boot preloads the deck-scoped Hyperion art too (EXTRA-deck membership warms it)');
  ok(helpers.genseiSlug === 'gensei' && helpers.genseiInline.includes('card-art-gensei-s.jpg') && helpers.genseiInline.includes('background-position:center top'), 'CA7z90: Gensei maps and stamps like the others (26th delivery)');
  ok(helpers.genseiSmall === '../assets/card-art-gensei-s.jpg' && helpers.genseiBig === '../assets/card-art-gensei.jpg', 'CA7z91: Gensei art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-gensei-s.jpg') && helpers.preloaded.includes('../assets/card-art-gensei.jpg'), 'CA7z92: boot preloads Gensei too (main-deck membership warms the art from deck-select time)');
  ok(helpers.genseiDeckArt === undefined && helpers.genseiIshizu === '../assets/card-art-gensei-s.jpg' && helpers.genseiGg === '../assets/card-art-gensei-s.jpg', 'CA7z93: Gensei has NO deck-scoped override — plain registration, every deck context keeps the base art');
  ok(helpers.fukusoSlug === 'fukuso' && helpers.fukusoInline.includes('card-art-fukuso-s.jpg') && helpers.fukusoInline.includes('background-position:center top'), 'CA7z94: Fukuso maps and stamps like the others (28th delivery)');
  ok(helpers.fukusoSmall === '../assets/card-art-fukuso-s.jpg' && helpers.fukusoBig === '../assets/card-art-fukuso.jpg', 'CA7z95: Fukuso art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-fukuso-s.jpg') && helpers.preloaded.includes('../assets/card-art-fukuso.jpg'), 'CA7z96: boot preloads Fukuso too (main-deck membership warms the art from deck-select time)');
  ok(helpers.fukusoDeckArt === 'fukuso-ishizu', 'CA7z97: DECK_ART registers Fukuso -> fukuso-ishizu for the Ishizu deck (15th entry — the second SPELL with an override)');
  ok(helpers.fukusoIshizuSmall === '../assets/card-art-fukuso-ishizu-s.jpg' && helpers.fukusoIshizuBig === '../assets/card-art-fukuso-ishizu.jpg' && helpers.fukusoIshizuInline.includes('card-art-fukuso-ishizu-s.jpg'), 'CA7z98: Ishizu context resolves Fukuso to the Egyptian art (small + big)');
  ok(helpers.fukusoGg === '../assets/card-art-fukuso-s.jpg', 'CA7z99: GG context resolves Fukuso to the plain graveyard art');
  ok(helpers.preloaded.includes('../assets/card-art-fukuso-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-fukuso-ishizu.jpg'), 'CA7z100: boot preloads the deck-scoped Fukuso art too');
  ok(helpers.michizureSlug === 'michizure' && helpers.michizureInline.includes('card-art-michizure-s.jpg') && helpers.michizureInline.includes('background-position:center top'), 'CA7z101: Michizure maps and stamps like the others (29th delivery)');
  ok(helpers.michizureSmall === '../assets/card-art-michizure-s.jpg' && helpers.michizureBig === '../assets/card-art-michizure.jpg', 'CA7z102: Michizure art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-michizure-s.jpg') && helpers.preloaded.includes('../assets/card-art-michizure.jpg'), 'CA7z103: boot preloads Michizure too (main-deck membership warms the art from deck-select time)');
  ok(helpers.michizureDeckArt === undefined && helpers.michizureIshizu === '../assets/card-art-michizure-s.jpg' && helpers.michizureGg === '../assets/card-art-michizure-s.jpg', 'CA7z104: Michizure has NO deck-scoped override — plain registration, every deck context keeps the base art');
  ok(helpers.kyoshinSlug === 'kyoshin' && helpers.kyoshinInline.includes('card-art-kyoshin-s.jpg') && helpers.kyoshinInline.includes('background-position:center top'), 'CA7z105: Kyoshin maps and stamps like the others (30th delivery)');
  ok(helpers.kyoshinSmall === '../assets/card-art-kyoshin-s.jpg' && helpers.kyoshinBig === '../assets/card-art-kyoshin.jpg', 'CA7z106: Kyoshin art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-kyoshin-s.jpg') && helpers.preloaded.includes('../assets/card-art-kyoshin.jpg'), 'CA7z107: boot preloads Kyoshin too (main-deck membership warms the art from deck-select time)');
  ok(helpers.kyoshinDeckArt === 'kyoshin-ishizu', 'CA7z108: DECK_ART registers Kyoshin -> kyoshin-ishizu for the Ishizu deck (16th entry — the third SPELL with an override)');
  ok(helpers.kyoshinIshizuSmall === '../assets/card-art-kyoshin-ishizu-s.jpg' && helpers.kyoshinIshizuBig === '../assets/card-art-kyoshin-ishizu.jpg' && helpers.kyoshinIshizuInline.includes('card-art-kyoshin-ishizu-s.jpg'), 'CA7z109: Ishizu context resolves Kyoshin to the Egyptian art (small + big)');
  ok(helpers.kyoshinGg === '../assets/card-art-kyoshin-s.jpg', 'CA7z110: GG context resolves Kyoshin to the plain archer art');
  ok(helpers.preloaded.includes('../assets/card-art-kyoshin-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-kyoshin-ishizu.jpg'), 'CA7z111: boot preloads the deck-scoped Kyoshin art too');
  ok(helpers.gofuuSlug === 'gofuu' && helpers.gofuuInline.includes('card-art-gofuu-s.jpg') && helpers.gofuuInline.includes('background-position:center top'), 'CA7z112: Gofuu maps and stamps like the others (31st delivery)');
  ok(helpers.gofuuSmall === '../assets/card-art-gofuu-s.jpg' && helpers.gofuuBig === '../assets/card-art-gofuu.jpg', 'CA7z113: Gofuu art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-gofuu-s.jpg') && helpers.preloaded.includes('../assets/card-art-gofuu.jpg'), 'CA7z114: boot preloads Gofuu too (main-deck membership warms the art from deck-select time)');
  ok(helpers.gofuuDeckArt === undefined && helpers.gofuuIshizu === '../assets/card-art-gofuu-s.jpg' && helpers.gofuuGg === '../assets/card-art-gofuu-s.jpg', 'CA7z115: Gofuu has NO deck-scoped override — plain registration, every deck context keeps the base art');
  ok(helpers.soudoSlug === 'soudo' && helpers.soudoInline.includes('card-art-soudo-s.jpg') && helpers.soudoInline.includes('background-position:center top'), 'CA7z116: Soudo maps and stamps like the others (32nd delivery)');
  ok(helpers.soudoSmall === '../assets/card-art-soudo-s.jpg' && helpers.soudoBig === '../assets/card-art-soudo.jpg', 'CA7z117: Soudo art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-soudo-s.jpg') && helpers.preloaded.includes('../assets/card-art-soudo.jpg'), 'CA7z118: boot preloads Soudo too (main-deck membership warms the art from deck-select time)');
  ok(helpers.soudoDeckArt === undefined && helpers.soudoIshizu === '../assets/card-art-soudo-s.jpg' && helpers.soudoGg === '../assets/card-art-soudo-s.jpg', 'CA7z119: Soudo has NO deck-scoped override — plain registration, every deck context keeps the base art');
  ok(helpers.yogenSlug === 'yogen' && helpers.yogenInline.includes('card-art-yogen-s.jpg') && helpers.yogenInline.includes('background-position:center top'), 'CA7z120: Yogen maps and stamps like the others (33rd delivery)');
  ok(helpers.yogenSmall === '../assets/card-art-yogen-s.jpg' && helpers.yogenBig === '../assets/card-art-yogen.jpg', 'CA7z121: Yogen art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-yogen-s.jpg') && helpers.preloaded.includes('../assets/card-art-yogen.jpg'), 'CA7z122: boot preloads Yogen too (main-deck membership warms the art from deck-select time)');
  ok(helpers.yogenDeckArt === 'yogen-ishizu', 'CA7z123: DECK_ART registers Yogen -> yogen-ishizu for the Ishizu deck (17th entry — the fourth SPELL with an override)');
  ok(helpers.yogenIshizuSmall === '../assets/card-art-yogen-ishizu-s.jpg' && helpers.yogenIshizuBig === '../assets/card-art-yogen-ishizu.jpg' && helpers.yogenIshizuInline.includes('card-art-yogen-ishizu-s.jpg'), 'CA7z124: Ishizu context resolves Yogen to the pentagram art (small + big)');
  ok(helpers.yogenGg === '../assets/card-art-yogen-s.jpg', 'CA7z125: GG context resolves Yogen to the plain fortune teller art');
  ok(helpers.preloaded.includes('../assets/card-art-yogen-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-yogen-ishizu.jpg'), 'CA7z126: boot preloads the deck-scoped Yogen art too');
  ok(helpers.soseiSlug === 'sosei' && helpers.soseiInline.includes('card-art-sosei-s.jpg') && helpers.soseiInline.includes('background-position:center top'), 'CA7z127: Sosei maps and stamps like the others (34th delivery)');
  ok(helpers.soseiSmall === '../assets/card-art-sosei-s.jpg' && helpers.soseiBig === '../assets/card-art-sosei.jpg', 'CA7z128: Sosei art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-sosei-s.jpg') && helpers.preloaded.includes('../assets/card-art-sosei.jpg'), 'CA7z129: boot preloads Sosei too (main-deck membership warms the art from deck-select time)');
  ok(helpers.soseiDeckArt === undefined && helpers.soseiIshizu === '../assets/card-art-sosei-s.jpg' && helpers.soseiGg === '../assets/card-art-sosei-s.jpg', 'CA7z130: Sosei has NO deck-scoped override — plain registration, every deck context keeps the base art');
  ok(helpers.hangyakuSlug === 'hangyaku' && helpers.hangyakuInline.includes('card-art-hangyaku-s.jpg') && helpers.hangyakuInline.includes('background-position:center top'), 'CA7z131: Hangyaku maps and stamps like the others (35th delivery)');
  ok(helpers.hangyakuSmall === '../assets/card-art-hangyaku-s.jpg' && helpers.hangyakuBig === '../assets/card-art-hangyaku.jpg', 'CA7z132: Hangyaku art files resolve (small + big)');
  ok(helpers.preloaded.includes('../assets/card-art-hangyaku-s.jpg') && helpers.preloaded.includes('../assets/card-art-hangyaku.jpg'), 'CA7z133: boot preloads Hangyaku too (main-deck membership warms the art from deck-select time)');
  ok(helpers.hangyakuDeckArt === 'hangyaku-ishizu', 'CA7z134: DECK_ART registers Hangyaku -> hangyaku-ishizu for the Ishizu deck (18th entry — the second TRAP with an override, after Bakudan)');
  ok(helpers.hangyakuIshizuSmall === '../assets/card-art-hangyaku-ishizu-s.jpg' && helpers.hangyakuIshizuBig === '../assets/card-art-hangyaku-ishizu.jpg' && helpers.hangyakuIshizuInline.includes('card-art-hangyaku-ishizu-s.jpg'), 'CA7z135: Ishizu context resolves Hangyaku to the Egyptian art (small + big)');
  ok(helpers.hangyakuGg === '../assets/card-art-hangyaku-s.jpg', 'CA7z136: GG context resolves Hangyaku to the plain flying-figure art');
  ok(helpers.preloaded.includes('../assets/card-art-hangyaku-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-hangyaku-ishizu.jpg'), 'CA7z137: boot preloads the deck-scoped Hangyaku art too');
  // ---- focus exceptions (user ruling 2026-11-05): ART_FOCUS shifts
  // the BIG-file band position for the three measured slugs only ----
  ok(Object.keys(helpers.focusTable).length === 21 && helpers.focusTable.hangyaku === 'center 40%' && helpers.focusTable['hangyaku-ishizu'] === 'center 30%' && helpers.focusTable.chaospod === 'center 85%' && helpers.focusTable.luce === 'center 38%' && helpers.focusTable['luce-ishizu'] === 'center 38%' && helpers.focusTable.minerva === 'center 20%' && helpers.focusTable['minerva-ishizu'] === 'center 20%' && helpers.focusTable['castel-ishizu'] === 'center 20%' && helpers.focusTable.baromett === 'center 40%' && helpers.focusTable['baromett-ishizu'] === 'center 40%' && helpers.focusTable.gensei === 'center 30%' && helpers.focusTable.fukuso === 'center 80%' && helpers.focusTable['fukuso-ishizu'] === 'center 65%' && helpers.focusTable.michizure === 'center 50%' && helpers.focusTable.kyoshin === 'center 40%' && helpers.focusTable['kyoshin-ishizu'] === 'center 40%' && helpers.focusTable.gofuu === 'center 40%' && helpers.focusTable.soudo === 'center 40%' && helpers.focusTable.yogen === 'center 40%' && helpers.focusTable['yogen-ishizu'] === 'center 30%' && helpers.focusTable.sosei === 'center 40%', 'CAF1: ART_FOCUS holds exactly the twenty-one measured exceptions (chaospod 85%, luce / luce-ishizu 38%, minerva / minerva-ishizu / castel-ishizu 20%, baromett / baromett-ishizu 40%, gensei 30%, fukuso 80%, fukuso-ishizu 65%, michizure 50%, kyoshin / kyoshin-ishizu 40%, gofuu 40%, soudo 40%, yogen 40%, yogen-ishizu 30%, sosei 40%, hangyaku 40%, hangyaku-ishizu 30%)');
  ok(helpers.focusChaosBig.includes('card-art-chaospod.jpg') && helpers.focusChaosBig.includes('background-position:center 85%'), 'CAF2: Chaos Pod BIG art carries its focus position (center 85%)');
  ok(helpers.focusChaosSmall.includes('card-art-chaospod-s.jpg') && helpers.focusChaosSmall.includes('background-position:center top'), 'CAF3: Chaos Pod SMALL art keeps center top (the exception is big-file only)');
  ok(helpers.focusLuceBig.includes('card-art-luce.jpg') && helpers.focusLuceBig.includes('background-position:center 38%'), 'CAF4: Luce BIG art carries its focus position (center 38%)');
  ok(helpers.focusLuceBigIshizu.includes('card-art-luce-ishizu.jpg') && helpers.focusLuceBigIshizu.includes('background-position:center 38%'), 'CAF5: Luce in the Ishizu deck resolves the gold art WITH its own focus entry (slug-keyed, not code-keyed)');
  ok(helpers.focusLuceBigGg.includes('card-art-luce.jpg') && !helpers.focusLuceBigGg.includes('ishizu') && helpers.focusLuceBigGg.includes('background-position:center 38%'), 'CAF6: Luce in any other deck keeps the plain art and the same focus position');
  ok(helpers.focusLuceSmallIshizu.includes('card-art-luce-ishizu-s.jpg') && helpers.focusLuceSmallIshizu.includes('background-position:center top'), 'CAF7: the deck-variant SMALL art keeps center top too');
  ok(helpers.focusMudoraBig.includes('card-art-mudora.jpg') && helpers.focusMudoraBig.includes('background-position:center top'), 'CAF8: a non-exception BIG art (Mudora) keeps center top — the rule did not move');
  ok(helpers.focusPosUnlisted === 'center top', 'CAF9: an unlisted code resolves the default position (no crash, no leak of the table)');
  ok(helpers.focusApplyChaos === 'center 85%' && helpers.focusApplyMudora === 'center top' && helpers.focusApplyChaosSmall === 'center top', 'CAF10: artApply (cut-in / ghost path) agrees with artCss: exception for the big file, center top otherwise');
  ok(helpers.focusMinervaBig.includes('card-art-minerva.jpg') && helpers.focusMinervaBig.includes('background-position:center 20%'), 'CAF11: Minerva BIG art carries her focus position (center 20% — re-measured on the v2 painting, 2026-11-05)');
  ok(helpers.focusMinervaSmall.includes('card-art-minerva-s.jpg') && helpers.focusMinervaSmall.includes('background-position:center top'), 'CAF12: Minerva SMALL art keeps center top (the exception is big-file only)');
  ok(helpers.focusApplyMinerva === 'center 20%', 'CAF13: artApply agrees with artCss for Minerva (big file, center 20%)');
  ok(helpers.focusMinervaBigIshizu.includes('card-art-minerva-ishizu.jpg') && helpers.focusMinervaBigIshizu.includes('background-position:center 20%'), 'CAF14: Minerva in the Ishizu deck resolves the Egyptian art WITH its own focus entry (slug-keyed, center 20% — measured on the Egyptian painting)');
  ok(helpers.focusMinervaBigGg.includes('card-art-minerva.jpg') && !helpers.focusMinervaBigGg.includes('ishizu') && helpers.focusMinervaBigGg.includes('background-position:center 20%'), 'CAF15: Minerva in any other deck keeps the plain art and the same focus position');
  ok(helpers.focusMinervaSmallIshizu.includes('card-art-minerva-ishizu-s.jpg') && helpers.focusMinervaSmallIshizu.includes('background-position:center top'), 'CAF16: the deck-variant SMALL art keeps center top too');
  ok(helpers.focusApplyMinervaIshizu === 'center 20%', 'CAF17: artApply agrees with artCss for the Ishizu-deck Minerva (big file, center 20%)');
  ok(helpers.focusCastelBig.includes('card-art-castel.jpg') && helpers.focusCastelBig.includes('background-position:center top'), 'CAF18: the PLAIN Castel BIG art keeps center top — measured 2026-11-06: his head sits high (eyes ~26% of the big file), so both bands frame it and the plain painting has NO focus exception');
  ok(helpers.focusCastelSmall.includes('card-art-castel-s.jpg') && helpers.focusCastelSmall.includes('background-position:center top') && helpers.focusApplyCastel === 'center top', 'CAF19: the PLAIN Castel SMALL art and the artApply path also keep center top');
  ok(helpers.focusCastelBigIshizu.includes('card-art-castel-ishizu.jpg') && helpers.focusCastelBigIshizu.includes('background-position:center 20%'), 'CAF20: Castel in the Ishizu deck resolves the Egyptian art WITH its own focus entry (slug-keyed, center 20% — measured on the Egyptian painting: the tall nemes headdress pushes his face to ~29-37% of the big file)');
  ok(helpers.focusCastelBigGg.includes('card-art-castel.jpg') && !helpers.focusCastelBigGg.includes('ishizu') && helpers.focusCastelBigGg.includes('background-position:center top'), 'CAF21: Castel in any other deck keeps the plain art at center top (the exception is keyed to the variant slug only)');
  ok(helpers.focusCastelSmallIshizu.includes('card-art-castel-ishizu-s.jpg') && helpers.focusCastelSmallIshizu.includes('background-position:center top'), 'CAF22: the deck-variant SMALL art keeps center top too');
  ok(helpers.focusApplyCastelIshizu === 'center 20%', 'CAF23: artApply agrees with artCss for the Ishizu-deck Castel (big file, center 20%)');
  ok(helpers.focusBaromettBig.includes('card-art-baromett.jpg') && helpers.focusBaromettBig.includes('background-position:center 40%'), 'CAF24: Baromett BIG art carries her focus position (center 40% — measured 2026-11-06: her face sits mid-frame, eyes ~47% of the big file, so center top shows wool and vines in the sheet band and leaves the sheep essentially out of the pop band)');
  ok(helpers.focusBaromettSmall.includes('card-art-baromett-s.jpg') && helpers.focusBaromettSmall.includes('background-position:center top'), 'CAF25: Baromett SMALL art keeps center top (the exception is big-file only)');
  ok(helpers.focusApplyBaromett === 'center 40%', 'CAF26: artApply agrees with artCss for Baromett (big file, center 40%)');
  ok(helpers.focusBaromettBigIshizu.includes('card-art-baromett-ishizu.jpg') && helpers.focusBaromettBigIshizu.includes('background-position:center 40%'), 'CAF27: Baromett in the Ishizu deck resolves the Egyptian art WITH its own focus entry (slug-keyed, center 40% — measured on the Egyptian painting: her face sits mid-frame, eyes ~50% of the big file, so center top leaves the sheep essentially out of the pop band)');
  ok(helpers.focusBaromettBigGg.includes('card-art-baromett.jpg') && !helpers.focusBaromettBigGg.includes('ishizu') && helpers.focusBaromettBigGg.includes('background-position:center 40%'), 'CAF28: Baromett in any other deck keeps the plain art and the same focus position');
  ok(helpers.focusBaromettSmallIshizu.includes('card-art-baromett-ishizu-s.jpg') && helpers.focusBaromettSmallIshizu.includes('background-position:center top'), 'CAF29: the deck-variant SMALL art keeps center top too');
  ok(helpers.focusApplyBaromettIshizu === 'center 40%', 'CAF30: artApply agrees with artCss for the Ishizu-deck Baromett (big file, center 40%)');
  ok(helpers.focusPlutoBig.includes('card-art-pluto.jpg') && helpers.focusPlutoBig.includes('background-position:center top'), 'CAF31: the Pluto BIG art keeps center top — measured 2026-11-06: his face sits high (eyes ~19%, chin ~25% of the big file), so both bands frame head, wings and orb and the plain painting has NO focus exception');
  ok(helpers.focusPlutoSmall.includes('card-art-pluto-s.jpg') && helpers.focusPlutoSmall.includes('background-position:center top') && helpers.focusApplyPluto === 'center top', 'CAF32: the Pluto SMALL art and the artApply path also keep center top');
  ok(helpers.focusPlutoBigIshizu.includes('card-art-pluto-ishizu.jpg') && helpers.focusPlutoBigIshizu.includes('background-position:center top'), 'CAF33: Pluto in the Ishizu deck resolves the Egyptian art at center top — measured separately on the Egyptian painting (2026-11-06): his face sits high there too (eyes ~19%, chin ~24% of the big file), so both bands frame the whole face and the variant has NO focus exception either');
  ok(helpers.focusPlutoBigGg.includes('card-art-pluto.jpg') && !helpers.focusPlutoBigGg.includes('ishizu') && helpers.focusPlutoBigGg.includes('background-position:center top'), 'CAF34: Pluto in any other deck keeps the plain art at center top');
  ok(helpers.focusPlutoSmallIshizu.includes('card-art-pluto-ishizu-s.jpg') && helpers.focusPlutoSmallIshizu.includes('background-position:center top') && helpers.focusApplyPlutoIshizu === 'center top', 'CAF35: the deck-variant SMALL art and the artApply path keep center top too');
  ok(helpers.focusTriloBig.includes('card-art-trilo.jpg') && helpers.focusTriloBig.includes('background-position:center top'), 'CAF36: the Trilosukuta BIG art keeps center top — measured 2026-11-06: his face sits high (eyes ~17-19% of the big file), so both bands frame helmet, face and torso and the plain painting has NO focus exception');
  ok(helpers.focusTriloSmall.includes('card-art-trilo-s.jpg') && helpers.focusTriloSmall.includes('background-position:center top') && helpers.focusApplyTrilo === 'center top', 'CAF37: the Trilosukuta SMALL art and the artApply path also keep center top');
  ok(helpers.focusTriloBigIshizu.includes('card-art-trilo-ishizu.jpg') && helpers.focusTriloBigIshizu.includes('background-position:center top'), 'CAF38: Trilosukuta in the Ishizu deck resolves the Egyptian art at center top — measured separately on the Egyptian painting (2026-11-06): the face sits high there too (eyes ~18%, chin ~22% of the big file), so both bands frame sun disc, headdress and the whole face and the variant has NO focus exception either');
  ok(helpers.focusTriloBigGg.includes('card-art-trilo.jpg') && !helpers.focusTriloBigGg.includes('ishizu') && helpers.focusTriloBigGg.includes('background-position:center top'), 'CAF39: Trilosukuta in any other deck keeps the plain art at center top');
  ok(helpers.focusTriloSmallIshizu.includes('card-art-trilo-ishizu-s.jpg') && helpers.focusTriloSmallIshizu.includes('background-position:center top') && helpers.focusApplyTriloIshizu === 'center top', 'CAF40: the deck-variant SMALL art and the artApply path keep center top too');
  ok(helpers.focusHyperionBig.includes('card-art-hyperion.jpg') && helpers.focusHyperionBig.includes('background-position:center top'), 'CAF41: the Hyperion BIG art keeps center top — measured 2026-11-06: his helmeted head sits high (crest ~4%, masked face ~10-13% of the big file), so both bands frame helmet, face and torso and the plain painting has NO focus exception');
  ok(helpers.focusHyperionSmall.includes('card-art-hyperion-s.jpg') && helpers.focusHyperionSmall.includes('background-position:center top') && helpers.focusApplyHyperion === 'center top', 'CAF42: the Hyperion SMALL art and the artApply path also keep center top');
  ok(helpers.focusHyperionBigIshizu.includes('card-art-hyperion-ishizu.jpg') && helpers.focusHyperionBigIshizu.includes('background-position:center top'), 'CAF43: Hyperion in the Ishizu deck resolves the Egyptian art at center top — measured separately on the Egyptian painting (2026-11-06): his crowned head sits high there too (sun-disc crown ~2-8%, masked face ~10-14% of the big file), so both bands frame crown, head and torso and the variant has NO focus exception either');
  ok(helpers.focusHyperionBigGg.includes('card-art-hyperion.jpg') && !helpers.focusHyperionBigGg.includes('ishizu') && helpers.focusHyperionBigGg.includes('background-position:center top'), 'CAF44: Hyperion in any other deck keeps the plain art at center top');
  ok(helpers.focusHyperionSmallIshizu.includes('card-art-hyperion-ishizu-s.jpg') && helpers.focusHyperionSmallIshizu.includes('background-position:center top') && helpers.focusApplyHyperionIshizu === 'center top', 'CAF45: the deck-variant SMALL art and the artApply path keep center top too');
  ok(helpers.focusGenseiBig.includes('card-art-gensei.jpg') && helpers.focusGenseiBig.includes('background-position:center 30%'), 'CAF46: Gensei BIG art carries its focus position (center 30% — measured 2026-11-06: the two warriors sit mid-frame, the skeleton skull at ~26-33% of the big file, so center top leaves the pop band showing the paradise window and vortex with the subject essentially absent)');
  ok(helpers.focusGenseiSmall.includes('card-art-gensei-s.jpg') && helpers.focusGenseiSmall.includes('background-position:center top'), 'CAF47: Gensei SMALL art keeps center top (the exception is big-file only)');
  ok(helpers.focusApplyGensei === 'center 30%', 'CAF48: artApply agrees with artCss for Gensei (big file, center 30%)');
  ok(helpers.focusFukusoBig.includes('card-art-fukuso.jpg') && helpers.focusFukusoBig.includes('background-position:center 80%'), 'CAF49: Fukuso BIG art carries its focus position (center 80% — measured 2026-11-07: the subject sits LOW, the grave hand and its bouquet at ~53-87% of the big file, so center top leaves the pop band on the tombstone and night sky with the subject entirely absent)');
  ok(helpers.focusFukusoSmall.includes('card-art-fukuso-s.jpg') && helpers.focusFukusoSmall.includes('background-position:center top') && helpers.focusApplyFukuso === 'center 80%', 'CAF50: Fukuso SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusFukusoBigIshizu.includes('card-art-fukuso-ishizu.jpg') && helpers.focusFukusoBigIshizu.includes('background-position:center 65%') && helpers.focusFukusoSmallIshizu.includes('card-art-fukuso-ishizu-s.jpg') && helpers.focusFukusoSmallIshizu.includes('background-position:center top'), 'CAF51: Fukuso in the Ishizu deck resolves the Egyptian art WITH its own focus entry (center 65% — measured separately on the Egyptian painting: the mummified hand and lilies span ~32-90% of the big file); the deck-variant SMALL art keeps center top');
  ok(helpers.focusMichizureBig.includes('card-art-michizure.jpg') && helpers.focusMichizureBig.includes('background-position:center 50%'), 'CAF52: Michizure BIG art carries its focus position (center 50% — measured 2026-11-07: the subjects sit MID-frame, the dragged man\'s screaming face at ~33-45% of the big file and the stone fist gripping his leg at ~55-67%, so center top leaves the pop band on the night sky, the robe and one reaching hand with the face just below its bottom edge)');
  ok(helpers.focusMichizureSmall.includes('card-art-michizure-s.jpg') && helpers.focusMichizureSmall.includes('background-position:center top') && helpers.focusApplyMichizure === 'center 50%', 'CAF53: Michizure SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusKyoshinBig.includes('card-art-kyoshin.jpg') && helpers.focusKyoshinBig.includes('background-position:center 40%'), 'CAF54: Kyoshin BIG art carries its focus position (center 40% — measured 2026-11-07: the subject sits MID-frame, the blue-haired archer\'s head at ~30-42% of the big file (face ~34-40%), so center top leaves the pop band on the bellowing giant (face ~8-24%) and the bow\'s upper wing with her face just below its bottom edge)');
  ok(helpers.focusKyoshinSmall.includes('card-art-kyoshin-s.jpg') && helpers.focusKyoshinSmall.includes('background-position:center top') && helpers.focusApplyKyoshin === 'center 40%', 'CAF55: Kyoshin SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusKyoshinBigIshizu.includes('card-art-kyoshin-ishizu.jpg') && helpers.focusKyoshinBigIshizu.includes('background-position:center 40%') && helpers.focusKyoshinSmallIshizu.includes('card-art-kyoshin-ishizu-s.jpg') && helpers.focusKyoshinSmallIshizu.includes('background-position:center top'), 'CAF56: Kyoshin in the Ishizu deck resolves the Egyptian art WITH its own focus entry (center 40% — measured separately on the Egyptian painting: the white-robed archer\'s hooded face at ~37-44% of the big file, so center top leaves the pop band on the blue giant god and the temple pillars with the archer entirely absent); the deck-variant SMALL art keeps center top');
  ok(helpers.focusGofuuBig.includes('card-art-gofuu.jpg') && helpers.focusGofuuBig.includes('background-position:center 40%'), 'CAF57: Gofuu BIG art carries its focus position (center 40% — measured 2026-11-07: the great central sword\'s star guard spans ~35-52% of the big file (gem ~44%) with its pommel topping out at ~33%, so center top leaves the pop band on the green light burst and the two flanking swords\' star tops with only the central pommel tips at its bottom edge — the main subject cropped away)');
  ok(helpers.focusGofuuSmall.includes('card-art-gofuu-s.jpg') && helpers.focusGofuuSmall.includes('background-position:center top') && helpers.focusApplyGofuu === 'center 40%', 'CAF58: Gofuu SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusSoudoBig.includes('card-art-soudo.jpg') && helpers.focusSoudoBig.includes('background-position:center 40%'), 'CAF59: Soudo BIG art carries its focus position (center 40% — measured 2026-11-07: the foreground goblin\'s face spans ~37-56% of the big file, mid-frame, so center top leaves the pop band on the shadow monster alone (its glowing face at ~10-20%) with the goblin\'s face entirely below its bottom edge)');
  ok(helpers.focusSoudoSmall.includes('card-art-soudo-s.jpg') && helpers.focusSoudoSmall.includes('background-position:center top') && helpers.focusApplySoudo === 'center 40%', 'CAF60: Soudo SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusYogenBig.includes('card-art-yogen.jpg') && helpers.focusYogenBig.includes('background-position:center 40%'), 'CAF61: Yogen BIG art carries its focus position (center 40% — measured 2026-11-07: the fortune teller\'s visible face sits at ~34-39% of the big file (hooded head ~15-42%) with the glowing card she holds at ~46-56%, so center top leaves the pop band on the curtains and skulls with her face just below its bottom edge and the glowing card entirely out)');
  ok(helpers.focusYogenSmall.includes('card-art-yogen-s.jpg') && helpers.focusYogenSmall.includes('background-position:center top') && helpers.focusApplyYogen === 'center 40%', 'CAF62: Yogen SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusYogenBigIshizu.includes('card-art-yogen-ishizu.jpg') && helpers.focusYogenBigIshizu.includes('background-position:center 30%') && helpers.focusYogenSmallIshizu.includes('card-art-yogen-ishizu-s.jpg') && helpers.focusYogenSmallIshizu.includes('background-position:center top'), 'CAF63: Yogen in the Ishizu deck resolves the pentagram art WITH its own focus entry (center 30% — measured separately on the pentagram painting: the golden star spans ~22-65% of the big file with the card at its center at ~40-50%, so center top leaves the pop band on the hood and clawed hands with only the star\'s top point showing, its center and card cropped away; center 40% was rejected — it clips the star\'s top point and the figure\'s eyes); the deck-variant SMALL art keeps center top');
  ok(helpers.focusSoseiBig.includes('card-art-sosei.jpg') && helpers.focusSoseiBig.includes('background-position:center 40%'), 'CAF64: Sosei BIG art carries its focus position (center 40% — measured 2026-11-07: the green ankh spans ~16-84% of the big file with the star core at its junction at ~49-54%, mid-frame, so center top leaves the pop band on the light rays and the loop\'s top arc alone — the ankh itself essentially absent — and cuts the ankh\'s bottom tip out of the sheet band)');
  ok(helpers.focusSoseiSmall.includes('card-art-sosei-s.jpg') && helpers.focusSoseiSmall.includes('background-position:center top') && helpers.focusApplySosei === 'center 40%', 'CAF65: Sosei SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusHangyakuBig.includes('card-art-hangyaku.jpg') && helpers.focusHangyakuBig.includes('background-position:center 40%'), 'CAF66: Hangyaku BIG art carries its focus position (center 40% — measured 2026-11-08: the sun sits at ~10-24% of the big file, the flying figure\'s hair/head mass at ~34-52% and its torso with the red-gem sash at ~50-62%, so center top leaves the pop band on the sun and the great black wing alone — the figure itself essentially absent)');
  ok(helpers.focusHangyakuSmall.includes('card-art-hangyaku-s.jpg') && helpers.focusHangyakuSmall.includes('background-position:center top') && helpers.focusApplyHangyaku === 'center 40%', 'CAF67: Hangyaku SMALL art keeps center top (the exception is big-file only) and artApply agrees with artCss');
  ok(helpers.focusHangyakuBigIshizu.includes('card-art-hangyaku-ishizu.jpg') && helpers.focusHangyakuBigIshizu.includes('background-position:center 30%') && helpers.focusHangyakuSmallIshizu.includes('card-art-hangyaku-ishizu-s.jpg') && helpers.focusHangyakuSmallIshizu.includes('background-position:center top'), 'CAF68: Hangyaku in the Ishizu deck resolves the Egyptian art WITH its own focus entry (center 30% — measured separately on the Egyptian painting: the armored figure\'s helmeted head spans ~28-42% of the big file with chest and shoulder armor at ~40-60%, so center top leaves the pop band on the sun and clouds with only the helmet crest tips at its bottom edge; center 40% was rejected — the crest rides the pop band\'s top edge and the sun leaves the pop band); the deck-variant SMALL art keeps center top');
  ok(helpers.kakanSlug === 'kakan' && helpers.kakanInline.includes('card-art-kakan-s.jpg') && helpers.kakanInline.includes('background-position:center top'), 'CA7aa: Kakan maps and stamps like the others (plain art = the forest painting)');
  ok(helpers.preloaded.includes('../assets/card-art-kakan-s.jpg') && helpers.preloaded.includes('../assets/card-art-kakan.jpg'), 'CA7ab: boot preloads Kakan too (same deck)');
  ok(helpers.deckArtKakan === 'kakan-ishizu', 'CA7z17: DECK_ART registers Kakan -> kakan-ishizu for the Ishizu deck (4th entry, first SPELL with an override)');
  ok(helpers.kakanIshizuSmall === '../assets/card-art-kakan-ishizu-s.jpg' && helpers.kakanIshizuBig === '../assets/card-art-kakan-ishizu.jpg' && helpers.kakanIshizuInline.includes('card-art-kakan-ishizu-s.jpg'), 'CA7z18: Ishizu context resolves Kakan to the Egyptian art (small + big)');
  ok(helpers.kakanGg === '../assets/card-art-kakan-s.jpg', 'CA7z19: GG context resolves Kakan to the plain forest art');
  ok(helpers.preloaded.includes('../assets/card-art-kakan-ishizu-s.jpg') && helpers.preloaded.includes('../assets/card-art-kakan-ishizu.jpg'), 'CA7z20: boot preloads the deck-scoped Kakan art too');

  doc.getElementById('startbtn').click();
  for (let i = 0; i < 120 && doc.querySelectorAll('.slot').length < 10; i++)
    await new Promise(r => setTimeout(r, 50));
  const seatDecks = window.eval(`seatDeckKeys.slice()`);
  ok(seatDecks[0] === 'ishizu' && seatDecks[1] === 'gg', 'CA7z5: duel start records each seat’s deck key (seat 0 = Ishizu, seat 1 = GG by default)');

  // ---- fabricated board through the client's own render() ----
  const res = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MUDORA}, 0x1);  // own face-up ATK Mudora
      b.players[0].mzone[1] = mon(${MUDORA}, 0x4);  // own face-up DEF Mudora (2nd copy)
      b.players[0].mzone[2] = mon(${UNLISTED}, 0x1); // own face-up unlisted exemplar (no art)
      b.players[0].mzone[3] = mon(${KELDO}, 0x1);   // own face-up Keldo (4th delivery; the 2nd-delivery Agido left the pool in recipe v11, so it can no longer be fabricated from DATA)
      b.players[0].mzone[4] = mon(${KELBEK}, 0x1);  // own face-up Kelbek (3rd delivery)
      b.players[1].mzone[0] = mon(${MUDORA}, 0x1);  // opp face-up Mudora (public: art shows)
      b.players[1].mzone[1] = mon(${MUDORA}, 0x8);  // opp face-down DEF Mudora (MUST stay hidden)
      b.players[1].mzone[2] = mon(${KELDO}, 0x1);   // opp face-up Keldo (4th delivery; own row is full)
      b.players[1].mzone[3] = mon(${ZOLGA}, 0x1);   // opp face-up Zolga (5th delivery)
      b.players[1].mzone[4] = mon(${CARDAN}, 0x1);  // opp face-up Cardan (6th delivery)
      b.players[0].hand = [{ code: ${MUDORA} }, { code: ${UNLISTED} }, { code: ${KELDO} }, { code: ${ZOLGA} }, { code: ${CARDAN} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${MUDORA}, null);
      const pvMudora = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${ZOLGA}, null);
      const pvZolga = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${UNLISTED}, null);
      const pvUnlisted = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      const ghost = fxGhostEl(${MUDORA}, false, 40, 55);
      const ghostBack = fxGhostEl(${MUDORA}, true, 40, 55);
      const ghostUnlisted = fxGhostEl(${UNLISTED}, false, 40, 55);
      return {
        ownAtk: artOf('0:4:0'), ownDef: artOf('0:4:1'), ownUnlisted: artOf('0:4:2'), ownAgido: artOf('0:4:3'), ownKelbek: artOf('0:4:4'),
        oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), oppKeldo: artOf('1:4:2'), oppZolga: artOf('1:4:3'), oppCardan: artOf('1:4:4'),
        handImgs, pvMudora, pvZolga, pvUnlisted,
        ghost: ghost.style.backgroundImage || '', ghostPos: ghost.style.backgroundPosition || '',
        ghostBack: ghostBack.style.backgroundImage || '', ghostUnlisted: ghostUnlisted.style.backgroundImage || '',
      };
    })()
  `);
  ok(res.ownAtk !== null && res.ownDef !== null && res.oppDown !== null, 'CA8: non-vacuity — fabricated tiles rendered');
  ok(res.ownAtk.includes('card-art-mudora-s.jpg'), 'CA9: own face-up Mudora tile shows the individual art');
  ok(res.ownDef.includes('card-art-mudora-s.jpg'), 'CA10: every copy is covered (2nd Mudora, face-up DEF)');
  ok(res.ownUnlisted === '', 'CA11: unlisted card tile keeps the placeholder (no inline art)');
  ok(res.ownAgido !== null && res.ownAgido.includes('card-art-keldo-s.jpg'), 'CA11b: the fourth tile (Keldo) shows its own art (slug, not Mudora’s)');
  ok(res.ownKelbek !== null && res.ownKelbek.includes('card-art-kelbek-s.jpg'), 'CA11c: Kelbek tile shows its own art');
  ok(res.oppKeldo !== null && res.oppKeldo.includes('card-art-keldo-s.jpg'), 'CA11d: Keldo tile shows its own art');
  ok(res.oppZolga !== null && res.oppZolga.includes('card-art-zolga-s.jpg'), 'CA11e: Zolga tile shows its own art');
  ok(res.oppCardan !== null && res.oppCardan.includes('card-art-cardan-s.jpg'), 'CA11f: Cardan tile shows its own art');
  ok(res.oppUp.includes('card-art-mudora-s.jpg'), 'CA12: opponent face-up Mudora shows the art (public information)');
  ok(res.oppDown === '' && !String(res.oppDown).includes('mudora'), 'CA13: opponent FACE-DOWN Mudora gets NO art (asymmetry / no leak)');
  const hMudora = res.handImgs.find(h => h.code === String(MUDORA));
  const hUnlisted = res.handImgs.find(h => h.code === String(UNLISTED));
  ok(!!hMudora && hMudora.style.includes('card-art-mudora-s.jpg'), 'CA14: hand Mudora shows the art');
  const hKeldo = res.handImgs.find(h => h.code === String(KELDO));
  ok(!!hKeldo && hKeldo.style.includes('card-art-keldo-s.jpg'), 'CA14b: hand Keldo shows the art');
  const hZolga = res.handImgs.find(h => h.code === String(ZOLGA));
  ok(!!hZolga && hZolga.style.includes('card-art-zolga-s.jpg'), 'CA14c: hand Zolga shows the art');
  const hCardan = res.handImgs.find(h => h.code === String(CARDAN));
  ok(!!hCardan && hCardan.style.includes('card-art-cardan-s.jpg'), 'CA14d: hand Cardan shows the art');
  ok(!!hUnlisted && hUnlisted.style === '', 'CA15: hand unlisted card keeps the placeholder');
  ok(res.pvMudora.includes('card-art-mudora-s.jpg'), 'CA16: resident preview shows the art for Mudora');
  ok(res.pvZolga.includes('card-art-zolga-s.jpg'), 'CA16b: resident preview shows the art for Zolga');
  ok(res.pvUnlisted === '', 'CA17: resident preview falls back for unlisted cards');
  ok(res.ghost.includes('card-art-mudora-s.jpg') && res.ghostPos.includes('top'), 'CA18: face-up FX ghost carries the art, top-pinned');
  ok(res.ghostBack === '' && res.ghostUnlisted === '', 'CA19: face-down and unlisted ghosts get no art');

  // ---- Sphinx board (7th delivery): both rows above are full, so
  // she gets her own fabricated board — face-up tile + hand +
  // preview carry the art, and her own face-down tile on the
  // opponent's side must NOT (she is a keycard; the asymmetry
  // contract applies to her exactly like the others) ----
  const res2 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${SPHINX}, 0x1);  // own face-up ATK Sphinx
      b.players[0].mzone[1] = mon(${CHAOSPOD}, 0x1); // own face-up ATK Chaos Pod (10th delivery, same board)
      b.players[1].mzone[0] = mon(${SPHINX}, 0x8);  // opp face-down DEF Sphinx (MUST stay hidden)
      b.players[0].hand = [{ code: ${SPHINX} }, { code: ${CHAOSPOD} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${SPHINX}"] .himg');
      const hPod = document.querySelector('#hand .hcard[data-code="${CHAOSPOD}"] .himg');
      setPreview(${SPHINX}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${CHAOSPOD}, null);
      const pvPod = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), ownPod: artOf('0:4:1'), oppDown: artOf('1:4:0'), hand: h ? (h.getAttribute('style') || '') : null, handPod: hPod ? (hPod.getAttribute('style') || '') : null, pv, pvPod };
    })()
  `);
  ok(res2.ownUp !== null && res2.oppDown !== null, 'CA20: non-vacuity — Sphinx board rendered');
  ok(res2.ownUp.includes('card-art-sphinx-s.jpg'), 'CA11g: Sphinx tile shows its own art');
  ok(res2.oppDown === '' && !String(res2.oppDown).includes('sphinx'), 'CA13b: opponent FACE-DOWN Sphinx gets NO art (asymmetry / no leak)');
  ok(res2.hand !== null && res2.hand.includes('card-art-sphinx-s.jpg'), 'CA14e: hand Sphinx shows the art');
  ok(res2.pv.includes('card-art-sphinx-s.jpg'), 'CA16c: resident preview shows the art for Sphinx');
  ok(res2.ownPod !== null && res2.ownPod.includes('card-art-chaospod-s.jpg'), 'CA11j: Chaos Pod tile shows its own art');
  ok(res2.handPod !== null && res2.handPod.includes('card-art-chaospod-s.jpg'), 'CA14h: hand Chaos Pod shows the art');
  ok(res2.pvPod.includes('card-art-chaospod-s.jpg'), 'CA16f: resident preview shows the art for Chaos Pod');

  // ---- Books board (8th/9th deliveries — the first SPELLS with
  // art): surfaces are the S/T zone, the hand and the preview.
  // Own face-up S/T shows the art; own SET S/T carries the art
  // UNDER the setown veil (the ghost the owner reads); opponent
  // set S/T gets NO art and NO veil (asymmetry, as ever) ----
  const res3 = window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${TAIYOU}, 0xa);  // own SET Taiyou (veil ghost)
      b.players[0].szone[1] = st(${TSUKI}, 0x5);   // own face-up Tsuki
      b.players[1].szone[0] = st(${TSUKI}, 0xa);   // opp SET Tsuki (MUST stay hidden)
      b.players[0].hand = [{ code: ${TAIYOU} }, { code: ${TSUKI} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${TAIYOU}, null);
      const pvTaiyou = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${TSUKI}, null);
      const pvTsuki = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownSetTaiyou: tileOf('0:8:0'), ownUpTsuki: tileOf('0:8:1'), oppSetTsuki: tileOf('1:8:0'), handImgs, pvTaiyou, pvTsuki };
    })()
  `);
  ok(res3.ownSetTaiyou !== null && res3.ownUpTsuki !== null && res3.oppSetTsuki !== null, 'CA21: non-vacuity — books board rendered');
  ok(res3.ownUpTsuki.art !== null && res3.ownUpTsuki.art.includes('card-art-tsuki-s.jpg') && !res3.ownUpTsuki.veil, 'CA11h: own face-up Tsuki S/T tile shows its own art');
  ok(res3.ownSetTaiyou.art !== null && res3.ownSetTaiyou.art.includes('card-art-taiyou-s.jpg') && res3.ownSetTaiyou.veil && res3.ownSetTaiyou.cls.split(/\s+/).includes('setown'), 'CA11i: own SET Taiyou carries its art under the setown veil (owner ghost)');
  ok(res3.oppSetTsuki.art === '' && !res3.oppSetTsuki.veil && !String(res3.oppSetTsuki.art).includes('tsuki'), 'CA13c: opponent SET Tsuki gets NO art and NO veil (asymmetry / no leak)');
  const hTaiyou = res3.handImgs.find(h => h.code === String(TAIYOU));
  const hTsuki = res3.handImgs.find(h => h.code === String(TSUKI));
  ok(!!hTaiyou && hTaiyou.style.includes('card-art-taiyou-s.jpg'), 'CA14f: hand Taiyou shows the art');
  ok(!!hTsuki && hTsuki.style.includes('card-art-tsuki-s.jpg'), 'CA14g: hand Tsuki shows the art');
  ok(res3.pvTaiyou.includes('card-art-taiyou-s.jpg'), 'CA16d: resident preview shows the art for Taiyou');
  ok(res3.pvTsuki.includes('card-art-tsuki-s.jpg'), 'CA16e: resident preview shows the art for Tsuki');

  // ---- Hakamori board (18th delivery — the first TRAP with
  // art): same S/T surfaces as the Books, plus the asymmetry
  // that matters most for a trap — the opponent's SET copy
  // stays fully hidden. The big file's stage life (the keycard
  // activation cut-in) is pinned in test-keycardact ----
  const res3b = window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${HAKAMORI}, 0xa);  // own SET Hakamori (veil ghost)
      b.players[0].szone[1] = st(${HAKAMORI}, 0x5);  // own face-up Hakamori
      b.players[1].szone[0] = st(${HAKAMORI}, 0xa);  // opp SET Hakamori (MUST stay hidden)
      b.players[0].hand = [{ code: ${HAKAMORI} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${HAKAMORI}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownSet: tileOf('0:8:0'), ownUp: tileOf('0:8:1'), oppSet: tileOf('1:8:0'), handImgs, pv };
    })()
  `);
  ok(res3b.ownSet !== null && res3b.ownUp !== null && res3b.oppSet !== null, 'CA22: non-vacuity — Hakamori board rendered');
  ok(res3b.ownUp.art !== null && res3b.ownUp.art.includes('card-art-hakamori-s.jpg') && !res3b.ownUp.veil, 'CA11k: own face-up Hakamori S/T tile shows its own art');
  ok(res3b.ownSet.art !== null && res3b.ownSet.art.includes('card-art-hakamori-s.jpg') && res3b.ownSet.veil && res3b.ownSet.cls.split(/\s+/).includes('setown'), 'CA11l: own SET Hakamori carries its art under the setown veil (owner ghost)');
  ok(res3b.oppSet.art === '' && !res3b.oppSet.veil && !String(res3b.oppSet.art).includes('hakamori'), 'CA13o: opponent SET Hakamori gets NO art and NO veil (asymmetry / no leak)');
  const hHaka = res3b.handImgs.find(h => h.code === String(HAKAMORI));
  ok(!!hHaka && hHaka.style.includes('card-art-hakamori-s.jpg'), 'CA14i: hand Hakamori shows the art');
  ok(res3b.pv.includes('card-art-hakamori-s.jpg'), 'CA16z: resident preview shows the art for Hakamori');

  // ---- Vernusylph board (11th-13th deliveries — the three
  // sisters): own face-up tiles, hand and preview carry each
  // sister's own art (mind the mapping: Oka = the pink-haired
  // fairy, Hana = the white rabbit, Mori = the forest boy), and
  // an opponent face-down Mori must NOT (asymmetry). Seat 0 is
  // playing the Ishizu deck in this boot, so Mori's surfaces
  // carry her DECK-SCOPED Egyptian art (mori-ishizu); the
  // flipped-seat fixture below pins the non-Ishizu fallback ----
  const res4 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${OKA}, 0x1);   // own face-up Oka
      b.players[0].mzone[1] = mon(${HANA}, 0x1);  // own face-up Hana
      b.players[0].mzone[2] = mon(${MORI}, 0x1);  // own face-up Mori
      b.players[1].mzone[0] = mon(${MORI}, 0x8);  // opp face-down DEF Mori (MUST stay hidden)
      b.players[0].hand = [{ code: ${OKA} }, { code: ${HANA} }, { code: ${MORI} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${OKA}, null);
      const pvOka = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, null);
      const pvHana = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${MORI}, null);
      const pvMori = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownOka: artOf('0:4:0'), ownHana: artOf('0:4:1'), ownMori: artOf('0:4:2'), oppDownMori: artOf('1:4:0'), handImgs, pvOka, pvHana, pvMori };
    })()
  `);
  ok(res4.ownOka !== null && res4.ownHana !== null && res4.ownMori !== null && res4.oppDownMori !== null, 'CA22: non-vacuity — Vernusylph board rendered');
  ok(res4.ownOka.includes('card-art-oka-ishizu-s.jpg'), 'CA11k: Oka tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.ownHana.includes('card-art-hana-ishizu-s.jpg'), 'CA11l: Hana tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.ownMori.includes('card-art-mori-ishizu-s.jpg'), 'CA11m: Mori tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res4.oppDownMori === '' && !String(res4.oppDownMori).includes('mori'), 'CA13d: opponent FACE-DOWN Mori gets NO art (asymmetry / no leak)');
  const hOka = res4.handImgs.find(h => h.code === String(OKA));
  const hHana = res4.handImgs.find(h => h.code === String(HANA));
  const hMori = res4.handImgs.find(h => h.code === String(MORI));
  ok(!!hOka && hOka.style.includes('card-art-oka-ishizu-s.jpg'), 'CA14i: hand Oka (Ishizu deck) shows the deck-scoped art');
  ok(!!hHana && hHana.style.includes('card-art-hana-ishizu-s.jpg'), 'CA14j: hand Hana (Ishizu deck) shows the deck-scoped art');
  ok(!!hMori && hMori.style.includes('card-art-mori-ishizu-s.jpg'), 'CA14k: hand Mori (Ishizu deck) shows the deck-scoped art');
  ok(res4.pvOka.includes('card-art-oka-ishizu-s.jpg'), 'CA16g: resident preview shows the deck-scoped art for Oka (unique deck membership: Ishizu)');
  ok(res4.pvHana.includes('card-art-hana-ishizu-s.jpg'), 'CA16h: resident preview shows the deck-scoped art for Hana (unique deck membership: Ishizu)');
  ok(res4.pvMori.includes('card-art-mori-ishizu-s.jpg'), 'CA16i: resident preview shows the deck-scoped art for Mori (unique deck membership: Ishizu)');

  // ---- Kakan board (14th delivery — 《春化精の花冠》, a SPELL,
  // and the first spell with a deck-scoped override): surfaces
  // are the S/T zone, the hand and the preview, like the books.
  // Seat 0 plays Ishizu in this boot, so every public surface
  // carries the EGYPTIAN variant (kakan-ishizu); own SET Kakan
  // carries it under the veil like the books, and the opponent's
  // SET Kakan gets neither art nor veil ----
  const res6 = window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${KAKAN}, 0x5);  // own face-up Kakan (Ishizu deck context)
      b.players[0].szone[1] = st(${KAKAN}, 0xa);  // own SET Kakan (veil ghost)
      b.players[1].szone[0] = st(${KAKAN}, 0xa);  // opp SET Kakan (MUST stay hidden)
      b.players[0].hand = [{ code: ${KAKAN} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const h = document.querySelector('#hand .hcard[data-code="${KAKAN}"] .himg');
      setPreview(${KAKAN}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: tileOf('0:8:0'), ownSet: tileOf('0:8:1'), oppSet: tileOf('1:8:0'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(res6.ownUp !== null && res6.ownSet !== null && res6.oppSet !== null, 'CA24: non-vacuity — Kakan board rendered');
  ok(res6.ownUp.art !== null && res6.ownUp.art.includes('card-art-kakan-ishizu-s.jpg') && !res6.ownUp.veil, 'CA11t: own face-up Kakan S/T tile in the Ishizu deck shows the DECK-SCOPED Egyptian art');
  ok(res6.ownSet.art !== null && res6.ownSet.art.includes('card-art-kakan-ishizu-s.jpg') && res6.ownSet.veil && res6.ownSet.cls.split(/\s+/).includes('setown'), 'CA11u: own SET Kakan carries the deck-scoped art under the setown veil (owner ghost, like the books)');
  ok(res6.oppSet.art === '' && !res6.oppSet.veil && !String(res6.oppSet.art).includes('kakan'), 'CA13h: opponent SET Kakan gets NO art and NO veil (asymmetry / no leak)');
  ok(res6.hand !== null && res6.hand.includes('card-art-kakan-ishizu-s.jpg'), 'CA14o: hand Kakan (Ishizu deck) shows the deck-scoped art');
  ok(res6.pv.includes('card-art-kakan-ishizu-s.jpg'), 'CA16p: resident preview shows the deck-scoped art for Kakan (unique deck membership: Ishizu)');

  // ---- Deck-scoped override, flipped seats (fixture): the SAME
  // Mori card under a NON-Ishizu deck context must fall back to
  // the plain art, while the seat actually playing Ishizu keeps
  // the Egyptian art — the override follows the deck, not the
  // chair. (The real pool has no second deck containing Mori, so
  // the non-Ishizu context is fabricated by swapping the recorded
  // seat deck keys; instance surfaces resolve from those keys.) ----
  const res5 = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 (human side) now "plays" GG; seat 1 plays Ishizu
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MORI}, 0x1);  // Mori under a GG deck context (fixture)
      b.players[1].mzone[0] = mon(${MORI}, 0x1);  // Mori in the Ishizu deck (seat 1)
      b.players[1].mzone[1] = mon(${MORI}, 0x8);  // opp face-down Mori, Ishizu context (MUST stay hidden)
      b.players[0].mzone[1] = mon(${HANA}, 0x1);  // Hana under a GG deck context (fixture)
      b.players[1].mzone[2] = mon(${HANA}, 0x1);  // Hana in the Ishizu deck (seat 1)
      b.players[1].mzone[3] = mon(${HANA}, 0x8);  // opp face-down Hana, Ishizu context (MUST stay hidden)
      b.players[0].mzone[2] = mon(${OKA}, 0x1);   // Oka under a GG deck context (fixture)
      b.players[1].mzone[4] = mon(${OKA}, 0x1);   // Oka in the Ishizu deck (seat 1)
      b.players[0].hand = [{ code: ${MORI} }, { code: ${HANA} }, { code: ${OKA} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${MORI}"] .himg');
      const hHana = document.querySelector('#hand .hcard[data-code="${HANA}"] .himg');
      const hOka = document.querySelector('#hand .hcard[data-code="${OKA}"] .himg');
      setPreview(${MORI}, { con: 0, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${MORI}, { con: 1, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, { con: 0, loc: E.LOC.MZONE, seq: 1 });
      const pvHanaSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${HANA}, { con: 1, loc: E.LOC.MZONE, seq: 2 });
      const pvHanaSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${OKA}, { con: 0, loc: E.LOC.MZONE, seq: 2 });
      const pvOkaSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${OKA}, { con: 1, loc: E.LOC.MZONE, seq: 4 });
      const pvOkaSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: artOf('0:4:0'), ishizuTile: artOf('1:4:0'), ishizuDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1,
               ggHanaTile: artOf('0:4:1'), ishizuHanaTile: artOf('1:4:2'), ishizuHanaDown: artOf('1:4:3'), handHana: hHana ? (hHana.getAttribute('style') || '') : null, pvHanaSeat0, pvHanaSeat1,
               ggOkaTile: artOf('0:4:2'), ishizuOkaTile: artOf('1:4:4'), handOka: hOka ? (hOka.getAttribute('style') || '') : null, pvOkaSeat0, pvOkaSeat1 };
    })()
  `);
  ok(res5.ggTile !== null && res5.ishizuTile !== null && res5.ishizuDown !== null, 'CA23: non-vacuity — flipped-seat Mori board rendered');
  ok(res5.ggTile.includes('card-art-mori-s.jpg') && !res5.ggTile.includes('mori-ishizu'), 'CA11n: Mori under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuTile.includes('card-art-mori-ishizu-s.jpg'), 'CA11o: Mori in the Ishizu deck shows the Egyptian art even on the opponent’s seat (deck, not chair)');
  ok(res5.ishizuDown === '' && !String(res5.ishizuDown).includes('mori'), 'CA13e: opponent FACE-DOWN Mori gets NO art even in Ishizu context (asymmetry binds the override too)');
  ok(res5.hand !== null && res5.hand.includes('card-art-mori-s.jpg') && !res5.hand.includes('mori-ishizu'), 'CA14l: hand Mori under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvSeat0.includes('card-art-mori-s.jpg') && !res5.pvSeat0.includes('mori-ishizu'), 'CA16j: preview of a GG-context Mori (instance ref) shows the plain art');
  ok(res5.pvSeat1.includes('card-art-mori-ishizu-s.jpg'), 'CA16k: preview of an Ishizu-context Mori (instance ref) shows the Egyptian art');
  ok(res5.ggHanaTile !== null && res5.ggHanaTile.includes('card-art-hana-s.jpg') && !res5.ggHanaTile.includes('hana-ishizu'), 'CA11p: Hana under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuHanaTile !== null && res5.ishizuHanaTile.includes('card-art-hana-ishizu-s.jpg'), 'CA11q: Hana in the Ishizu deck shows the Egyptian art on the opponent’s seat too');
  ok(res5.ishizuHanaDown === '' && !String(res5.ishizuHanaDown).includes('hana'), 'CA13f: opponent FACE-DOWN Hana gets NO art even in Ishizu context (asymmetry binds the 2nd override too)');
  ok(res5.handHana !== null && res5.handHana.includes('card-art-hana-s.jpg') && !res5.handHana.includes('hana-ishizu'), 'CA14m: hand Hana under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvHanaSeat0.includes('card-art-hana-s.jpg') && !res5.pvHanaSeat0.includes('hana-ishizu'), 'CA16l: preview of a GG-context Hana (instance ref) shows the plain art');
  ok(res5.pvHanaSeat1.includes('card-art-hana-ishizu-s.jpg'), 'CA16m: preview of an Ishizu-context Hana (instance ref) shows the Egyptian art');
  ok(res5.ggOkaTile !== null && res5.ggOkaTile.includes('card-art-oka-s.jpg') && !res5.ggOkaTile.includes('oka-ishizu'), 'CA11r: Oka under a non-Ishizu deck context falls back to the plain art (tile)');
  ok(res5.ishizuOkaTile !== null && res5.ishizuOkaTile.includes('card-art-oka-ishizu-s.jpg'), 'CA11s: Oka in the Ishizu deck shows the Egyptian art on the opponent’s seat too');
  ok(res5.handOka !== null && res5.handOka.includes('card-art-oka-s.jpg') && !res5.handOka.includes('oka-ishizu'), 'CA14n: hand Oka under a non-Ishizu deck context falls back to the plain art');
  ok(res5.pvOkaSeat0.includes('card-art-oka-s.jpg') && !res5.pvOkaSeat0.includes('oka-ishizu'), 'CA16n: preview of a GG-context Oka (instance ref) shows the plain art');
  ok(res5.pvOkaSeat1.includes('card-art-oka-ishizu-s.jpg'), 'CA16o: preview of an Ishizu-context Oka (instance ref) shows the Egyptian art');

  // Oka face-down on the Ishizu seat (the flipped board above is
  // out of rendered monster slots, so she gets a minimal board):
  // the asymmetry binds the 3rd override exactly like the others.
  const res5b = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu'];
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[1].mzone[0] = mon(${OKA}, 0x8);  // opp face-down Oka, Ishizu context (MUST stay hidden)
      render(b);
      const slot = document.querySelector('.slot[data-zone="1:4:0"]');
      const a = slot && slot.querySelector('.tile .art');
      const out = a ? (a.getAttribute('style') || '') : null;
      seatDeckKeys = saved;
      return out;
    })()
  `);
  ok(res5b === '' && !String(res5b).includes('oka'), 'CA13g: opponent FACE-DOWN Oka gets NO art even in Ishizu context (asymmetry binds the 3rd override too)');

  // ---- Carbon board (15th delivery): until now Carbon WAS the
  // unlisted exemplar, so he gets the full-surface treatment on
  // his own fabricated board — own face-up tile, hand and
  // preview carry the art, and an opponent face-down Carbon
  // must NOT (asymmetry, as ever). Seat 0 plays the Ishizu
  // deck in this boot, so his surfaces carry the DECK-SCOPED
  // regalia art; the flipped-seat fixture below pins the
  // plain stone fallback for other deck contexts ----
  const res8 = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${CARBON}, 0x1);  // own face-up ATK Carbon
      b.players[1].mzone[0] = mon(${CARBON}, 0x8);  // opp face-down DEF Carbon (MUST stay hidden)
      b.players[0].hand = [{ code: ${CARBON} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${CARBON}"] .himg');
      setPreview(${CARBON}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppDown: artOf('1:4:0'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(res8.ownUp !== null && res8.oppDown !== null, 'CA26: non-vacuity — Carbon board rendered');
  ok(res8.ownUp.includes('card-art-carbon-ishizu-s.jpg'), 'CA11x: Carbon tile in the Ishizu deck (seat 0) shows the DECK-SCOPED regalia art');
  ok(res8.oppDown === '' && !String(res8.oppDown).includes('carbon'), 'CA13j: opponent FACE-DOWN Carbon gets NO art (asymmetry / no leak)');
  ok(res8.hand !== null && res8.hand.includes('card-art-carbon-ishizu-s.jpg'), 'CA14q: hand Carbon (Ishizu deck) shows the deck-scoped art');
  ok(res8.pv.includes('card-art-carbon-ishizu-s.jpg'), 'CA16s: resident preview shows the deck-scoped art for Carbon (unique deck membership: Ishizu)');

  // ---- Carbon, flipped seats (fixture): the 5th override
  // under the same lens — a Carbon instance owned by a
  // NON-Ishizu deck context falls back to the plain stone art
  // on the tile, the hand and the preview, while the Ishizu
  // seat keeps the regalia variant; the Ishizu seat's
  // face-down Carbon stays invisible (asymmetry binds the
  // 5th override too). (Fabricated: the GG deck does not run
  // Carbon, exactly like the sisters' fixture above.) ----
  const res9 = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 now "plays" GG; seat 1 plays Ishizu
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${CARBON}, 0x1);  // Carbon under a GG deck context (fixture)
      b.players[1].mzone[0] = mon(${CARBON}, 0x1);  // Carbon in the Ishizu deck (seat 1)
      b.players[1].mzone[1] = mon(${CARBON}, 0x8);  // opp face-down Carbon, Ishizu context (MUST stay hidden)
      b.players[0].hand = [{ code: ${CARBON} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${CARBON}"] .himg');
      setPreview(${CARBON}, { con: 0, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${CARBON}, { con: 1, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: artOf('0:4:0'), ishizuTile: artOf('1:4:0'), ishizuDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1 };
    })()
  `);
  ok(res9.ggTile !== null && res9.ishizuTile !== null && res9.ishizuDown !== null, 'CA27: non-vacuity — flipped-seat Carbon board rendered');
  ok(res9.ggTile.includes('card-art-carbon-s.jpg') && !res9.ggTile.includes('carbon-ishizu'), 'CA11y: Carbon under a non-Ishizu deck context falls back to the plain stone art (tile)');
  ok(res9.ishizuTile.includes('card-art-carbon-ishizu-s.jpg'), 'CA11z: Carbon in the Ishizu deck shows the regalia art even on the opponent’s seat (deck, not chair)');
  ok(res9.ishizuDown === '' && !String(res9.ishizuDown).includes('carbon'), 'CA13k: opponent FACE-DOWN Carbon gets NO art even in Ishizu context (asymmetry binds the 5th override too)');
  ok(res9.hand !== null && res9.hand.includes('card-art-carbon-s.jpg') && !res9.hand.includes('carbon-ishizu'), 'CA14r: hand Carbon under a non-Ishizu deck context falls back to the plain art');
  ok(res9.pvSeat0.includes('card-art-carbon-s.jpg') && !res9.pvSeat0.includes('carbon-ishizu'), 'CA16t: preview of a GG-context Carbon (instance ref) shows the plain art');
  ok(res9.pvSeat1.includes('card-art-carbon-ishizu-s.jpg'), 'CA16u: preview of an Ishizu-context Carbon (instance ref) shows the regalia art');

  // ---- Silky board (16th delivery): until now Silky WAS the
  // unlisted exemplar, so she gets the full-surface treatment
  // on her own fabricated board — own face-up tile, hand and
  // preview carry the art, and an opponent face-down Silky
  // must NOT (asymmetry, as ever). Seat 0 plays the Ishizu
  // deck in this boot, so her surfaces carry the DECK-SCOPED
  // Egyptian-dress art; the flipped-seat fixture below pins
  // the plain room-art fallback for other deck contexts ----
  const res10 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${SILKY}, 0x1);  // own face-up ATK Silky
      b.players[1].mzone[0] = mon(${SILKY}, 0x8);  // opp face-down DEF Silky (MUST stay hidden)
      b.players[0].hand = [{ code: ${SILKY} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${SILKY}"] .himg');
      setPreview(${SILKY}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppDown: artOf('1:4:0'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(res10.ownUp !== null && res10.oppDown !== null, 'CA28: non-vacuity — Silky board rendered');
  ok(res10.ownUp.includes('card-art-silky-ishizu-s.jpg'), 'CA11aa: Silky tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian-dress art');
  ok(res10.oppDown === '' && !String(res10.oppDown).includes('silky'), 'CA13l: opponent FACE-DOWN Silky gets NO art (asymmetry / no leak)');
  ok(res10.hand !== null && res10.hand.includes('card-art-silky-ishizu-s.jpg'), 'CA14s: hand Silky (Ishizu deck) shows the deck-scoped art');
  ok(res10.pv.includes('card-art-silky-ishizu-s.jpg'), 'CA16v: resident preview shows the deck-scoped art for Silky (unique deck membership: Ishizu)');

  // ---- Silky, flipped seats (fixture): the 6th override
  // under the same lens — a Silky instance owned by a
  // NON-Ishizu deck context falls back to the plain room art
  // on the tile, the hand and the preview, while the Ishizu
  // seat keeps the Egyptian variant; the Ishizu seat's
  // face-down Silky stays invisible (asymmetry binds the
  // 6th override too). (Fabricated: the GG deck does not run
  // Silky, exactly like Carbon's fixture above.) ----
  const res11 = await window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 now "plays" GG; seat 1 plays Ishizu
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${SILKY}, 0x1);  // Silky under a GG deck context (fixture)
      b.players[1].mzone[0] = mon(${SILKY}, 0x1);  // Silky in the Ishizu deck (seat 1)
      b.players[1].mzone[1] = mon(${SILKY}, 0x8);  // opp face-down Silky, Ishizu context (MUST stay hidden)
      b.players[0].hand = [{ code: ${SILKY} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${SILKY}"] .himg');
      setPreview(${SILKY}, { con: 0, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${SILKY}, { con: 1, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: artOf('0:4:0'), ishizuTile: artOf('1:4:0'), ishizuDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1 };
    })()
  `);
  ok(res11.ggTile !== null && res11.ishizuTile !== null && res11.ishizuDown !== null, 'CA29: non-vacuity — flipped-seat Silky board rendered');
  ok(res11.ggTile.includes('card-art-silky-s.jpg') && !res11.ggTile.includes('silky-ishizu'), 'CA11ab: Silky under a non-Ishizu deck context falls back to the plain room art (tile)');
  ok(res11.ishizuTile.includes('card-art-silky-ishizu-s.jpg'), 'CA11ac: Silky in the Ishizu deck shows the Egyptian art even on the opponent’s seat (deck, not chair)');
  ok(res11.ishizuDown === '' && !String(res11.ishizuDown).includes('silky'), 'CA13m: opponent FACE-DOWN Silky gets NO art even in Ishizu context (asymmetry binds the 6th override too)');
  ok(res11.hand !== null && res11.hand.includes('card-art-silky-s.jpg') && !res11.hand.includes('silky-ishizu'), 'CA14t: hand Silky under a non-Ishizu deck context falls back to the plain art');
  ok(res11.pvSeat0.includes('card-art-silky-s.jpg') && !res11.pvSeat0.includes('silky-ishizu'), 'CA16w: preview of a GG-context Silky (instance ref) shows the plain art');
  ok(res11.pvSeat1.includes('card-art-silky-ishizu-s.jpg'), 'CA16x: preview of an Ishizu-context Silky (instance ref) shows the Egyptian art');
  // ---- Kakan, flipped seats (fixture): the 4th override under
  // the same lens as the sisters — a Kakan instance owned by a
  // NON-Ishizu deck context falls back to the plain forest art
  // on the S/T tile, the hand and the preview, while the Ishizu
  // seat keeps the Egyptian variant; the Ishizu seat's SET
  // Kakan stays invisible (asymmetry binds the 4th override).
  // (Fabricated: the GG deck does not run Kakan, exactly like
  // the sisters' fixture above.) ----
  const res7 = window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 now "plays" GG; seat 1 plays Ishizu
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${KAKAN}, 0x5);  // Kakan under a GG deck context (fixture)
      b.players[1].szone[0] = st(${KAKAN}, 0x5);  // Kakan in the Ishizu deck (seat 1)
      b.players[1].szone[1] = st(${KAKAN}, 0xa);  // opp SET Kakan, Ishizu context (MUST stay hidden)
      b.players[0].hand = [{ code: ${KAKAN} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const h = document.querySelector('#hand .hcard[data-code="${KAKAN}"] .himg');
      setPreview(${KAKAN}, { con: 0, loc: E.LOC.SZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${KAKAN}, { con: 1, loc: E.LOC.SZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: tileOf('0:8:0'), ishizuTile: tileOf('1:8:0'), ishizuSet: tileOf('1:8:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1 };
    })()
  `);
  ok(res7.ggTile !== null && res7.ishizuTile !== null && res7.ishizuSet !== null, 'CA25: non-vacuity — flipped-seat Kakan board rendered');
  ok(res7.ggTile.art !== null && res7.ggTile.art.includes('card-art-kakan-s.jpg') && !res7.ggTile.art.includes('kakan-ishizu'), 'CA11v: Kakan under a non-Ishizu deck context falls back to the plain forest art (S/T tile)');
  ok(res7.ishizuTile.art !== null && res7.ishizuTile.art.includes('card-art-kakan-ishizu-s.jpg'), 'CA11w: Kakan in the Ishizu deck shows the Egyptian art even on the opponent’s seat (deck, not chair)');
  ok(res7.ishizuSet.art === '' && !res7.ishizuSet.veil && !String(res7.ishizuSet.art).includes('kakan'), 'CA13i: opponent SET Kakan gets NO art and NO veil even in Ishizu context (asymmetry binds the 4th override too)');
  ok(res7.hand !== null && res7.hand.includes('card-art-kakan-s.jpg') && !res7.hand.includes('kakan-ishizu'), 'CA14p: hand Kakan under a non-Ishizu deck context falls back to the plain art');
  ok(res7.pvSeat0.includes('card-art-kakan-s.jpg') && !res7.pvSeat0.includes('kakan-ishizu'), 'CA16q: preview of a GG-context Kakan (instance ref) shows the plain art');
  ok(res7.pvSeat1.includes('card-art-kakan-ishizu-s.jpg'), 'CA16r: preview of an Ishizu-context Kakan (instance ref) shows the Egyptian art');

  // ---- Horus board (17th delivery): the first EXTRA-deck
  // monster with individual art. A plain CARD_ART registration
  // (no override), so every deck context resolves to the same
  // 'horus' painting. Fabricated post-summon board: own
  // face-up tile and the resident preview carry the art, an
  // opponent face-up Horus (public information) carries it
  // too, and an opponent FACE-DOWN Horus must NOT (asymmetry,
  // as ever — an EX monster's identity is hidden while it is
  // face-down exactly like any other card). ----
  const res12 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${HORUS}, 0x1);  // own face-up ATK Horus (post-Synchro)
      b.players[1].mzone[0] = mon(${HORUS}, 0x1);  // opp face-up Horus (public: art shows)
      b.players[1].mzone[1] = mon(${HORUS}, 0x8);  // opp face-down DEF Horus (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${HORUS}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res12.ownUp !== null && res12.oppUp !== null && res12.oppDown !== null, 'CA30: non-vacuity — Horus board rendered');
  ok(res12.ownUp.includes('card-art-horus-s.jpg'), 'CA11ad: own face-up Horus tile shows the new art (17th delivery)');
  ok(res12.oppUp.includes('card-art-horus-s.jpg'), 'CA11ae: opponent FACE-UP Horus shows the art too (public information)');
  ok(res12.oppDown === '' && !String(res12.oppDown).includes('horus'), 'CA13n: opponent FACE-DOWN Horus gets NO art (asymmetry / no leak)');
  ok(res12.pv.includes('card-art-horus-s.jpg'), 'CA16y: resident preview shows the Horus art (unique deck membership: Ishizu)');

  // ---- Luce board (19th delivery + its deck-scoped
  // override): an EXTRA-deck monster and an Ishizu keycard.
  // Seat 0 plays the Ishizu deck in this boot, so her own
  // surfaces carry the DECK-SCOPED all-gold art
  // (luce-ishizu); the opponent's face-up Luce sits under
  // the GG deck context and keeps the plain 'luce' painting
  // (public information shows the art of the OWNER's deck);
  // an opponent FACE-DOWN Luce must NOT carry any art
  // (asymmetry, as ever). The flipped-seat fixture below
  // pins the same split from the other chair. ----
  const res13 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${LUCE}, 0x1);  // own face-up ATK Luce (post-Synchro)
      b.players[1].mzone[0] = mon(${LUCE}, 0x1);  // opp face-up Luce (public: art shows)
      b.players[1].mzone[1] = mon(${LUCE}, 0x8);  // opp face-down DEF Luce (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${LUCE}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res13.ownUp !== null && res13.oppUp !== null && res13.oppDown !== null, 'CA31: non-vacuity — Luce board rendered');
  ok(res13.ownUp.includes('card-art-luce-ishizu-s.jpg'), 'CA11af: own face-up Luce tile in the Ishizu deck (seat 0) shows the DECK-SCOPED all-gold art');
  ok(res13.oppUp.includes('card-art-luce-s.jpg') && !res13.oppUp.includes('luce-ishizu'), 'CA11ag: opponent FACE-UP Luce under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res13.oppDown === '' && !String(res13.oppDown).includes('luce'), 'CA13p: opponent FACE-DOWN Luce gets NO art (asymmetry / no leak)');
  ok(res13.pv.includes('card-art-luce-ishizu-s.jpg'), 'CA16z2: resident preview shows the deck-scoped Luce art (unique deck membership: Ishizu)');

  // ---- Luce, flipped seats (fixture): the 7th override
  // under the same lens as Carbon's and Silky's — a Luce
  // instance owned by a NON-Ishizu deck context falls back
  // to the plain white-winged art on the tile, the hand and
  // the preview, while the Ishizu seat keeps the all-gold
  // variant; the Ishizu seat's face-down Luce stays
  // invisible (asymmetry binds the 7th override too).
  // (Fabricated post-summon, exactly like res13: the GG
  // deck does not run Luce, so the non-Ishizu context is
  // fabricated by swapping the recorded seat deck keys.) ----
  const res14 = await window.eval(`
    (() => {
      const saved = seatDeckKeys;
      seatDeckKeys = ['gg', 'ishizu']; // seat 0 now "plays" GG; seat 1 plays Ishizu
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${LUCE}, 0x1);  // Luce under a GG deck context (fixture)
      b.players[1].mzone[0] = mon(${LUCE}, 0x1);  // Luce in the Ishizu deck (seat 1)
      b.players[1].mzone[1] = mon(${LUCE}, 0x8);  // opp face-down Luce, Ishizu context (MUST stay hidden)
      b.players[0].hand = [{ code: ${LUCE} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${LUCE}"] .himg');
      setPreview(${LUCE}, { con: 0, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat0 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      setPreview(${LUCE}, { con: 1, loc: E.LOC.MZONE, seq: 0 });
      const pvSeat1 = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      seatDeckKeys = saved;
      return { ggTile: artOf('0:4:0'), ishizuTile: artOf('1:4:0'), ishizuDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pvSeat0, pvSeat1 };
    })()
  `);
  ok(res14.ggTile !== null && res14.ishizuTile !== null && res14.ishizuDown !== null, 'CA32: non-vacuity — flipped-seat Luce board rendered');
  ok(res14.ggTile.includes('card-art-luce-s.jpg') && !res14.ggTile.includes('luce-ishizu'), 'CA11ah: Luce under a non-Ishizu deck context falls back to the plain white-winged art (tile)');
  ok(res14.ishizuTile.includes('card-art-luce-ishizu-s.jpg'), 'CA11ai: Luce in the Ishizu deck shows the all-gold art even on the opponent’s seat (deck, not chair)');
  ok(res14.ishizuDown === '' && !String(res14.ishizuDown).includes('luce'), 'CA13q: opponent FACE-DOWN Luce gets NO art even in Ishizu context (asymmetry binds the 7th override too)');
  ok(res14.hand !== null && res14.hand.includes('card-art-luce-s.jpg') && !res14.hand.includes('luce-ishizu'), 'CA14u: hand Luce under a non-Ishizu deck context falls back to the plain art');
  ok(res14.pvSeat0.includes('card-art-luce-s.jpg') && !res14.pvSeat0.includes('luce-ishizu'), 'CA16z3: preview of a GG-context Luce (instance ref) shows the plain art');
  ok(res14.pvSeat1.includes('card-art-luce-ishizu-s.jpg'), 'CA16z4: preview of an Ishizu-context Luce (instance ref) shows the all-gold art');

  // ---- Minerva board (20th delivery + its deck-scoped
  // override, the 8th DECK_ART entry): an EXTRA-deck
  // monster. Seat 0 plays the Ishizu deck in this boot, so
  // her own tile and the code-only resident preview carry
  // the DECK-SCOPED Egyptian art (minerva-ishizu); the
  // opponent's face-up Minerva sits under the GG deck
  // context and keeps the plain 'minerva' painting; an
  // opponent FACE-DOWN Minerva must NOT carry any art
  // (asymmetry binds the 8th override too). ----
  const res15 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MINERVA}, 0x1);  // own face-up ATK Minerva (post-Synchro)
      b.players[1].mzone[0] = mon(${MINERVA}, 0x1);  // opp face-up Minerva (public: art shows)
      b.players[1].mzone[1] = mon(${MINERVA}, 0x8);  // opp face-down DEF Minerva (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${MINERVA}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res15.ownUp !== null && res15.oppUp !== null && res15.oppDown !== null, 'CA33: non-vacuity — Minerva board rendered');
  ok(res15.ownUp.includes('card-art-minerva-ishizu-s.jpg'), 'CA11aj: own face-up Minerva tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res15.oppUp.includes('card-art-minerva-s.jpg') && !res15.oppUp.includes('minerva-ishizu'), 'CA11ak: opponent FACE-UP Minerva under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res15.oppDown === '' && !String(res15.oppDown).includes('minerva'), 'CA13r: opponent FACE-DOWN Minerva gets NO art (asymmetry / no leak)');
  ok(res15.pv.includes('card-art-minerva-ishizu-s.jpg'), 'CA16z5: resident preview shows the deck-scoped Minerva art (unique deck membership: Ishizu)');

  // ---- Castel board (21st delivery + #21b override):
  // an EXTRA-deck monster whose owner-deck resolution
  // mirrors the Minerva board above: seat 0 (Ishizu)
  // shows the DECK-SCOPED Egyptian art (castel-ishizu);
  // the opponent's face-up Castel under the GG deck
  // context keeps the plain art; an opponent FACE-DOWN
  // Castel must NOT carry any art. ----
  const res16 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${CASTEL}, 0x1);  // own face-up ATK Castel (post-Xyz)
      b.players[1].mzone[0] = mon(${CASTEL}, 0x1);  // opp face-up Castel (public: art shows)
      b.players[1].mzone[1] = mon(${CASTEL}, 0x8);  // opp face-down DEF Castel (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${CASTEL}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res16.ownUp !== null && res16.oppUp !== null && res16.oppDown !== null, 'CA34: non-vacuity — Castel board rendered');
  ok(res16.ownUp.includes('card-art-castel-ishizu-s.jpg'), 'CA11al: own face-up Castel tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res16.oppUp.includes('card-art-castel-s.jpg') && !res16.oppUp.includes('castel-ishizu'), 'CA11am: opponent FACE-UP Castel under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res16.oppDown === '' && !String(res16.oppDown).includes('castel'), 'CA13s: opponent FACE-DOWN Castel gets NO art (asymmetry / no leak)');
  ok(res16.pv.includes('card-art-castel-ishizu-s.jpg'), 'CA16z6: resident preview shows the deck-scoped Castel art (unique deck membership: Ishizu)');

  // ---- Baromett board (22nd delivery + #22b override):
  // an EXTRA-deck monster whose owner-deck resolution
  // mirrors the Castel board above: seat 0 (Ishizu)
  // shows the DECK-SCOPED Egyptian art (baromett-ishizu);
  // the opponent's face-up Baromett under the GG deck
  // context keeps the plain art; an opponent FACE-DOWN
  // Baromett must NOT carry any art. ----
  const res17 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${BAROMETT}, 0x1);  // own face-up ATK Baromett (post-Xyz)
      b.players[1].mzone[0] = mon(${BAROMETT}, 0x1);  // opp face-up Baromett (public: art shows)
      b.players[1].mzone[1] = mon(${BAROMETT}, 0x8);  // opp face-down DEF Baromett (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${BAROMETT}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res17.ownUp !== null && res17.oppUp !== null && res17.oppDown !== null, 'CA35: non-vacuity — Baromett board rendered');
  ok(res17.ownUp.includes('card-art-baromett-ishizu-s.jpg'), 'CA11an: own face-up Baromett tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res17.oppUp.includes('card-art-baromett-s.jpg') && !res17.oppUp.includes('baromett-ishizu'), 'CA11ao: opponent FACE-UP Baromett under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res17.oppDown === '' && !String(res17.oppDown).includes('baromett'), 'CA13t: opponent FACE-DOWN Baromett gets NO art (asymmetry / no leak)');
  ok(res17.pv.includes('card-art-baromett-ishizu-s.jpg'), 'CA16z7: resident preview shows the deck-scoped Baromett art (unique deck membership: Ishizu)');

  // ---- Pluto board (23rd delivery + #23b override):
  // an EXTRA-deck monster whose owner-deck resolution
  // mirrors the Baromett board above: seat 0 (Ishizu)
  // shows the DECK-SCOPED Egyptian art (pluto-ishizu);
  // the opponent's face-up Pluto under the GG deck
  // context keeps the plain art; an opponent FACE-DOWN
  // Pluto must NOT carry any art. ----
  const res18 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${PLUTO}, 0x1);  // own face-up ATK Pluto (post-Xyz)
      b.players[1].mzone[0] = mon(${PLUTO}, 0x1);  // opp face-up Pluto (public: art shows)
      b.players[1].mzone[1] = mon(${PLUTO}, 0x8);  // opp face-down DEF Pluto (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${PLUTO}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res18.ownUp !== null && res18.oppUp !== null && res18.oppDown !== null, 'CA36: non-vacuity — Pluto board rendered');
  ok(res18.ownUp.includes('card-art-pluto-ishizu-s.jpg'), 'CA11ap: own face-up Pluto tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res18.oppUp.includes('card-art-pluto-s.jpg') && !res18.oppUp.includes('pluto-ishizu'), 'CA11aq: opponent FACE-UP Pluto under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res18.oppDown === '' && !String(res18.oppDown).includes('pluto'), 'CA13u: opponent FACE-DOWN Pluto gets NO art (asymmetry / no leak)');
  ok(res18.pv.includes('card-art-pluto-ishizu-s.jpg'), 'CA16z8: resident preview shows the deck-scoped Pluto art (unique deck membership: Ishizu)');

  // ---- Trilosukuta board (24th delivery + #24b override):
  // an EXTRA-deck monster whose owner-deck resolution
  // mirrors the Baromett board above: seat 0 (Ishizu)
  // shows the DECK-SCOPED Egyptian art (trilo-ishizu);
  // the opponent's face-up Trilosukuta under the GG deck
  // context keeps the plain art; an opponent FACE-DOWN
  // Trilosukuta must NOT carry any art. ----
  const res19 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${TRILO}, 0x1);  // own face-up ATK Trilosukuta (post-Synchro)
      b.players[1].mzone[0] = mon(${TRILO}, 0x1);  // opp face-up Trilosukuta (public: art shows)
      b.players[1].mzone[1] = mon(${TRILO}, 0x8);  // opp face-down DEF Trilosukuta (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${TRILO}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res19.ownUp !== null && res19.oppUp !== null && res19.oppDown !== null, 'CA37: non-vacuity — Trilosukuta board rendered');
  ok(res19.ownUp.includes('card-art-trilo-ishizu-s.jpg'), 'CA11ar: own face-up Trilosukuta tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res19.oppUp.includes('card-art-trilo-s.jpg') && !res19.oppUp.includes('trilo-ishizu'), 'CA11as: opponent FACE-UP Trilosukuta under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res19.oppDown === '' && !String(res19.oppDown).includes('trilo'), 'CA13v: opponent FACE-DOWN Trilosukuta gets NO art (asymmetry / no leak)');
  ok(res19.pv.includes('card-art-trilo-ishizu-s.jpg'), 'CA16z9: resident preview shows the deck-scoped Trilosukuta art (unique deck membership: Ishizu)');

  // ---- 25th delivery board: Hyperion (63101468), the
  // seventh EXTRA-deck monster with individual art —
  // follow-up #25b gives him a deck-scoped override:
  // the own tile (seat 0, Ishizu deck) shows the
  // DECK-SCOPED Egyptian art (hyperion-ishizu); the
  // opponent's face-up tile under the GG deck context
  // shows the plain 'hyperion' art; an opponent
  // FACE-DOWN Hyperion must NOT carry any art. ----
  const res20 = await window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${HYPERION}, 0x1);  // own face-up ATK Hyperion (post-Synchro)
      b.players[1].mzone[0] = mon(${HYPERION}, 0x1);  // opp face-up Hyperion (public: art shows)
      b.players[1].mzone[1] = mon(${HYPERION}, 0x8);  // opp face-down DEF Hyperion (MUST stay hidden)
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      setPreview(${HYPERION}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), pv };
    })()
  `);
  ok(res20.ownUp !== null && res20.oppUp !== null && res20.oppDown !== null, 'CA38: non-vacuity — Hyperion board rendered');
  ok(res20.ownUp.includes('card-art-hyperion-ishizu-s.jpg'), 'CA11at: own face-up Hyperion tile in the Ishizu deck (seat 0) shows the DECK-SCOPED Egyptian art');
  ok(res20.oppUp.includes('card-art-hyperion-s.jpg') && !res20.oppUp.includes('hyperion-ishizu'), 'CA11au: opponent FACE-UP Hyperion under the GG deck context shows the plain art (public information, owner-deck resolution)');
  ok(res20.oppDown === '' && !String(res20.oppDown).includes('hyperion'), 'CA13w: opponent FACE-DOWN Hyperion gets NO art (asymmetry / no leak)');
  ok(res20.pv.includes('card-art-hyperion-ishizu-s.jpg'), 'CA16z10: resident preview shows the deck-scoped Hyperion art (unique deck membership: Ishizu)');

  // ---- 26th delivery board: Gensei to Meikai no
  // Gyakuten (17484499), the second TRAP with individual
  // art — plain registration, NO deck-scoped override:
  // the same S/T surfaces as Hakamori (own SET under the
  // setown veil, own face-up, hand, preview), and the
  // asymmetry that matters most for a trap — the
  // opponent's SET copy stays fully hidden. The big
  // file's stage life (the keycard activation cut-in)
  // is pinned in test-keycardact ----
  const res21 = await window.eval(`
    (() => {
      const st = (code, pos) => ({ code, pos, materials: 0 });
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].szone[0] = st(${GENSEI}, 0xa);  // own SET Gensei (veil ghost)
      b.players[0].szone[1] = st(${GENSEI}, 0x5);  // own face-up Gensei
      b.players[1].szone[0] = st(${GENSEI}, 0xa);  // opp SET Gensei (MUST stay hidden)
      b.players[0].hand = [{ code: ${GENSEI} }];
      render(b);
      const tileOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const t = slot && slot.querySelector('.tile');
        if (!t) return null;
        const a = t.querySelector('.art');
        return { cls: t.className, veil: !!t.querySelector('.veil'), art: a ? (a.getAttribute('style') || '') : null };
      };
      const handImgs = [...document.querySelectorAll('#hand .hcard')].map(h => ({ code: h.dataset.code, style: (h.querySelector('.himg') || {}).getAttribute ? (h.querySelector('.himg').getAttribute('style') || '') : '' }));
      setPreview(${GENSEI}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownSet: tileOf('0:8:0'), ownUp: tileOf('0:8:1'), oppSet: tileOf('1:8:0'), handImgs, pv };
    })()
  `);
  ok(res21.ownSet !== null && res21.ownUp !== null && res21.oppSet !== null, 'CA39: non-vacuity — Gensei board rendered');
  ok(res21.ownUp.art !== null && res21.ownUp.art.includes('card-art-gensei-s.jpg') && !res21.ownUp.veil, 'CA11av: own face-up Gensei S/T tile shows its own art');
  ok(res21.ownSet.art !== null && res21.ownSet.art.includes('card-art-gensei-s.jpg') && res21.ownSet.veil && res21.ownSet.cls.split(/\s+/).includes('setown'), 'CA11aw: own SET Gensei carries its art under the setown veil (owner ghost)');
  ok(res21.oppSet.art === '' && !res21.oppSet.veil && !String(res21.oppSet.art).includes('gensei'), 'CA13x: opponent SET Gensei gets NO art and NO veil (asymmetry / no leak)');
  const hGensei = res21.handImgs.find(h => h.code === String(GENSEI));
  ok(!!hGensei && hGensei.style.includes('card-art-gensei-s.jpg'), 'CA14v: hand Gensei shows the art');
  ok(res21.pv.includes('card-art-gensei-s.jpg'), 'CA16z11: resident preview shows the art for Gensei');

  // ---- standard art (STD_ART): the Super Quant built-in's 26
  // cards carry no user-supplied painting; per the 2026-11-04
  // ruling they resolve to the passcode's YGOPRODeck cropped
  // illustration, delivered locally as card-art-std-<code>
  // (big 640x882 / small 320x320). Field report 2026-11-08:
  // before this they showed the shared placeholder on every
  // surface. The registration is scoped to exactly these 26
  // codes — the pre-existing pool's display must not move
  // (the UNLISTED exemplar above stays unlisted). ----
  const SQ = [...new Set([...data.decks.superquant.main, ...data.decks.superquant.extra])];
  ok(SQ.length === 26, 'CASQ0: the Super Quant deck has 26 unique cards');
  for (const c of SQ) {
    for (const suf of ['.jpg', '-s.jpg']) {
      const p = path.join(V2, '..', 'assets', 'card-art-std-' + c + suf);
      ok(fs.existsSync(p) && fs.statSync(p).size > 10000, 'CASQ0f: card-art-std-' + c + suf + ' delivered (>10KB)');
    }
  }
  const MAGNUS = 84025439;
  const sqHelp = window.eval(`(() => {
    const codes = ${JSON.stringify(SQ)};
    const res = codes.map(c => ({
      code: c,
      inCardArt: Object.prototype.hasOwnProperty.call(CARD_ART, c),
      std: STD_ART[c] || null,
      small: cardArtFile(c, false),
      big: cardArtFile(c, true),
      inline: artInline(c),
    }));
    preloadCardArt(['superquant']);
    return { res, preloaded: [...artPreloaded], unlistedStd: STD_ART[${UNLISTED}] || null, unlistedFile: cardArtFile(${UNLISTED}, false) };
  })()`);
  ok(sqHelp.res.every(r => !r.inCardArt && r.std === 'std-' + r.code), 'CASQ1: every Super Quant card resolves through STD_ART (none is in CARD_ART)');
  ok(sqHelp.res.every(r => r.small === '../assets/card-art-std-' + r.code + '-s.jpg' && r.big === '../assets/card-art-std-' + r.code + '.jpg'), 'CASQ2: cardArtFile returns the std files (small + big) for all 26');
  ok(sqHelp.res.every(r => r.inline.includes('card-art-std-' + r.code + '-s.jpg')), 'CASQ3: artInline carries the std art for all 26 (no surface falls back to the placeholder)');
  ok(SQ.every(c => sqHelp.preloaded.includes('../assets/card-art-std-' + c + '-s.jpg') && sqHelp.preloaded.includes('../assets/card-art-std-' + c + '.jpg')), 'CASQ4: selecting the Super Quant deck preloads both std sizes (deck-select preload, no blank flash)');
  ok(sqHelp.unlistedStd === null && sqHelp.unlistedFile === null, 'CASQ5: scoping — the GG unlisted exemplar stays unlisted in STD_ART too (existing 63 cards\u2019 display unchanged)');
  const resSQ = window.eval(`
    (() => {
      const mon = (code, pos) => { const d = DATA.cards[code]; return { code, pos, materials: 0, curAtk: d.atk, curDef: d.def }; };
      const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
      const b = { players: [P(), P()], phaseName: '', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], lastAttack: null };
      b.players[0].mzone[0] = mon(${MAGNUS}, 0x1);  // own face-up Magnus
      b.players[1].mzone[0] = mon(${MAGNUS}, 0x1);  // opp face-up Magnus (public)
      b.players[1].mzone[1] = mon(${MAGNUS}, 0x8);  // opp face-down Magnus (MUST stay hidden)
      b.players[0].hand = [{ code: ${MAGNUS} }];
      render(b);
      const artOf = (zone) => {
        const slot = document.querySelector('.slot[data-zone="' + zone + '"]');
        const a = slot && slot.querySelector('.tile .art');
        return a ? (a.getAttribute('style') || '') : null;
      };
      const h = document.querySelector('#hand .hcard[data-code="${MAGNUS}"] .himg');
      setPreview(${MAGNUS}, null);
      const pv = (document.querySelector('#preview .pv-art') || {}).getAttribute ? (document.querySelector('#preview .pv-art').getAttribute('style') || '') : '';
      return { ownUp: artOf('0:4:0'), oppUp: artOf('1:4:0'), oppDown: artOf('1:4:1'), hand: h ? (h.getAttribute('style') || '') : null, pv };
    })()
  `);
  ok(resSQ.ownUp !== null && resSQ.oppUp !== null && resSQ.oppDown !== null, 'CASQ6: non-vacuity — Magnus board rendered');
  ok(resSQ.ownUp.includes('card-art-std-84025439-s.jpg'), 'CASQ7: own face-up Magnus tile shows the std art');
  ok(resSQ.oppUp.includes('card-art-std-84025439-s.jpg'), 'CASQ8: opponent FACE-UP Magnus shows the std art (public information)');
  ok(resSQ.oppDown === '' && !String(resSQ.oppDown).includes('std-84025439'), 'CASQ9: opponent FACE-DOWN Magnus gets NO art (asymmetry / no leak)');
  ok(resSQ.hand !== null && resSQ.hand.includes('card-art-std-84025439-s.jpg'), 'CASQ10: hand Magnus shows the std art');
  ok(resSQ.pv.includes('card-art-std-84025439-s.jpg'), 'CASQ11: resident preview shows the std art for Magnus');

  window.close();
  console.log(failures === 0 ? 'ALL CARDART CHECKS PASSED' : failures + ' CARDART CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
