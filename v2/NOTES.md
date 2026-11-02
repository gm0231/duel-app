# v2 (ocgcore client) — Phase 1 architecture notes

## What this is
A human-vs-bot duel client on the proven ocgcore WASM build (edo9300/ygopro-core,
API v11). It replaces the PoC's player-0 bot with a human using a tap-based
phone UI; player 1 stays the PoC's simple bot. The current app at the repo root
is untouched; everything lives in `v2/`.

Files:
- `build/ocgcore.js`, `build/ocgcore.wasm` — copied unchanged from `poc/build/`.
- `data.json` — copied unchanged from `poc/data.json` (63 cards, 88 Lua scripts,
  Ishizu + Gate Guardian decks).
- `engine.js` — shared engine layer (browser + Node): message parsing, prompt
  parsing, response encoders, game-state mirror, bot policy, async duel driver.
- `client.js` — the browser UI (DOM). Loaded only by `index.html`.
- `index.html` — page + CSS (portrait, one screen, dark + antique gold).
- `test-node.js` — Node harness: full duel through engine.js with the bot
  policy standing in for the human. Verifies completion + 0 MSG_RETRY + card
  conservation at every prompt.
- `test-explore.js` — Node stress harness: pseudo-random-but-legal answers on
  both seats to exercise prompt types the conservative bot never reaches.

## How state sync works
The core (API v11) does not push UPDATE_DATA/UPDATE_CARD messages in this
embedding; the client mirrors the field from the event stream:
- `RELOAD_FIELD` (arrives at duel start) initializes LP and pile counts and
  zone occupancy.
- `MOVE` is the workhorse: every location change is accompanied by an explicit
  MSG_MOVE at the processor level. The mirror removes the card at the "from"
  loc_info (preferring exact sequence, falling back to first code match — hand
  order can shift silently in a few core paths) and inserts at the "to"
  loc_info. Moves to/from `LOCATION_OVERLAY` encode the host in the loc_info
  (host controller, host location | 0x80, host sequence, material index), so
  Xyz material counts per host are tracked exactly.
- `DRAW` (codes are broadcast), `SHUFFLE_HAND`/`SHUFFLE_EXTRA` (exact new
  order), `POS_CHANGE`, `SET`, `SUMMONING`/`SPSUMMONING`/`FLIPSUMMONING`,
  `SWAP`, `DECK_TOP`, `CONFIRM_CARDS` (reveal knowledge: opponent hand cards
  shown to player 0 are recorded) refine the mirror.
- LP comes from `LPUPDATE` (absolute) with `DAMAGE`/`RECOVER`/`PAY_LPCOST`
  applied as deltas (LPUPDATE follows and corrects).
- Chain state comes from `CHAINING` (push link), `CHAIN_SOLVING` (which link
  is resolving), `CHAIN_SOLVED`/`CHAIN_NEGATED`/`CHAIN_DISABLED` (per-link
  marks), `CHAIN_END` (clear).
- Card conservation (per player: deck+hand+extra+grave+removed+field+overlay
  materials == deck size) is asserted at every prompt boundary in
  `test-node.js`; it held for all 651 prompts of the verification duel.

Known mirror limits (Phase 1):
- On-field ATK/DEF shown are the printed values from `data.json`. The v11
  query API (OCG_DuelQuery*) is not exposed by the PoC WASM driver, so
  effect-modified ATK/DEF/counters on field cards are not reflected.
- Equip relations, card targets, and per-card effect states are not visualized
  (the messages are parsed only as log events where noted).

## Prompt protocol facts (from core sources, not docs)
- All layouts were taken from `playerop.cpp` / `operations.cpp` /
  `processor.cpp` / `field.cpp` of edo9300/ygopro-core and cross-checked
  against the PoC. Two traps worth remembering:
  - `SELECT_TRIBUTE` entries are 11 bytes (code, con, loc, seq u32,
    release_param) — they do NOT include the position u32 that
    `get_info_location()`-based entries have.
  - `ANNOUNCE_NUMBER`'s response is the INDEX of the chosen option, not its
    value (the PoC bot sent the value; it never fired in PoC duels).
- After an invalid response the core emits `MSG_RETRY` and waits for a new
  response to the SAME prompt — it does not re-send the prompt. The driver
  (`engine.js` Duel) therefore re-asks the answerer with `prompt.retryCount`
  incremented; the UI shows a "that selection was not accepted" notice and
  re-opens the prompt. Legal answers never trigger this (both Node harnesses
  run with 0 retries).
- Card-selection responses use the PoC-verified "type 2" encoding
  (i32 type=2, u32 count, u8 indices); cancel is i32 −1 where the core allows
  it. `SELECT_UNSELECT_CARD` uses the toggle encoding (i32 1, i32 index) and
  i32 −1 to finish/cancel. `SELECT_CHAIN` pass is i32 −1 (illegal when the
  core marks the prompt forced).

## Prompt → UI mapping
| Prompt | UI (EDOPro convention → phone adaptation) |
|---|---|
| SELECT_IDLECMD / SELECT_BATTLECMD | Actions live on the tapped card (action sheet listing exactly the core's legal actions for that card); phase advance is a persistent button; hand-shuffle etc. under a small menu button. Cards/piles with actions glow. |
| SELECT_PLACE / SELECT_DISFIELD | The actual board zones highlight; tap zones to choose (hard user requirement — no text lists). Chosen zones stay lit until the count is met. |
| SELECT_POSITION | Sheet with card-orientation previews (vertical/horizontal × face-up/down) for each position bit in the mask. |
| SELECT_CARD / SELECT_TRIBUTE | Bottom-sheet card grid with the shipped tray conventions: picked cards listed as chips (tap chip or card to unpick), confirm enabled only at a valid count/sum. Cancel button only when the core marks the prompt cancelable — mandatory prompts have no dismiss path at all. |
| SELECT_UNSELECT_CARD | Grid where tapping a card toggles it immediately (protocol is one toggle per response); selected cards shown tray-style; Finish (when finishable and min met) / Cancel (when cancelable). |
| SELECT_SUM | Same grid; must-select cards shown as locked chips; confirm enabled exactly when the core's own sum check (mirrored in `engine.js sumSelectionValid`) passes. |
| SELECT_COUNTER | Per-card steppers; confirm enabled when the allocated total equals the required count. |
| SORT_CARD / SORT_CHAIN | Ordered list with ↑/↓ per row; "keep order" (−1) always available. |
| SELECT_CHAIN | See "Chain interaction" below. |
| SELECT_YESNO / SELECT_EFFECTYN | Sheet with the source card name + location and large はい/いいえ (発動する/しない) buttons. |
| SELECT_OPTION | Numbered option buttons (see gaps: option description strings are core string-table IDs we cannot resolve yet). |
| ANNOUNCE_RACE / ANNOUNCE_ATTRIB | Toggle chips with JP race/attribute names; exactly N must be picked. |
| ANNOUNCE_NUMBER | Buttons showing the option values (response is the index). |
| ANNOUNCE_CARD | Scrollable grid of the 63 pool cards by name; if the core rejects the declaration (opcode filter), the prompt re-opens with the retry notice. |
| ROCK_PAPER_SCISSORS | ✌/✋/✊ buttons (values 1/2/3 = scissors/paper/rock per the core's win table). |
| anything else | Generic fallback sheet with an auto-answer button (bot policy) — no dead ends. |

## Chain interaction (binding design rules from the user)
- YGOPro/EDOPro conventions are the reference, not our inventions.
- The mid bar shows the chain as numbered links in chain order
  (① card, ② card, …). While the chain resolves, the link being solved is
  highlighted (from `CHAIN_SOLVING`), solved links get ✓, negated/disabled
  links are struck through — so resolution visibly proceeds link-by-link in
  reverse.
- The chain dock (bottom, above the hand — it never covers the player's own
  field) states what you are responding to: the current top link's card.
  Candidates are exactly the core's chainable entries, plus an explicit パス
  whenever the core allows passing. If the core offers no chainable card the
  dock does not appear (the driver answers pass directly); forced prompts
  show no pass button.
- Each candidate has a × ("このチェーンでは聞かない") toggle: an
  EDOPro-style ignore for the remainder of the current chain. This is a
  client-side presentation filter only — dismissed candidates are hidden and,
  if a later prompt in the same chain offers only dismissed cards, the client
  auto-answers pass (−1), which is a legal answer to SELECT_CHAIN whenever
  the prompt is not forced. Dismissals never apply to forced prompts, are
  shown greyed so they can be restored, and are cleared when the chain ends.
  Legality is unchanged: the client never answers anything the core did not
  ask, and never suppresses a prompt the core requires an answer to beyond
  answering "pass" where pass is legal.

## Phone adaptations / deviations from EDOPro (deliberate)
- Portrait one-screen board; opponent zones are NOT mirrored (sequences run
  left-to-right for both players, numbered) to keep tap→sequence mapping
  visually direct in this phase.
- Modal selections are bottom sheets (max ~62% height) instead of centered
  dialogs, so the opponent's field and the chain bar stay visible.
- The chain dock sits above the hand instead of as a center popup.
- No dialogue text for the opponent; the log line shows system events only.

## Audio wiring (Phase 1, minimal)
- Start screen BGM: `../assets/bgm/ishizu-upload.mp3` starts on the first
  pointer tap (autoplay policy), looped.
- Duel BGM: `../assets/bgm/ishizu-start.mp3` from duel start, looped.
- Click SE: `../assets/se/ui_click.mp3` on taps/buttons.
- Not wired yet: scene-based BGM switching, summon/attack/destroy SEs, VS SE.
  (All of these were wired in Phase 2 — see the Phase 2 section below.)

## Verification performed
- `node test-node.js` — full duel through engine.js (bot policy as the human
  seat): 72 turns, 651 prompts (299 human-seat / 352 bot-seat), winner P0 by
  deck-out — identical outcome to the proven PoC run. **0 MSG_RETRY.** Card
  conservation asserted at all 651 prompt boundaries: 0 violations; final
  totals 58/55 as expected.
- `node test-explore.js` — 3 pseudo-random legal-answer duels, all completed
  (LP finishes), **0 retries**, exercising SELECT_IDLECMD, SELECT_BATTLECMD,
  SELECT_CHAIN, SELECT_PLACE, SELECT_CARD, SELECT_TRIBUTE,
  SELECT_UNSELECT_CARD, SELECT_POSITION, SELECT_EFFECTYN, SELECT_YESNO,
  SELECT_OPTION, ANNOUNCE_CARD, ANNOUNCE_NUMBER.
  - This harness caught two real bugs during development, both fixed:
    the SELECT_TRIBUTE entry layout (11B, no position) and the driver's
    MSG_RETRY handling (re-answer the same prompt).
- Browser/UI layer: served statically (python http.server) with all
  referenced files returning 200. A jsdom smoke test loaded the real page,
  clicked デュエル開始, and auto-played the human seat purely through DOM
  clicks (action sheets, phase button, selection grids, chain dock, zone
  highlights): the duel completed — **49 turns, human seat won by LP
  (8000 vs −300), zero page errors**. (A first version of the auto-player
  timed out because it kept toggling the first grid card on/off; cycling
  through choices fixed the driver, not the UI.) jsdom is not a real
  browser — touch behavior, layout, and media playback on an actual phone
  remain unverified in this phase.
- NOT exercised by any harness (no card in these two decks triggers them in
  the test lines): SELECT_SUM, SELECT_COUNTER, SORT_CARD, SORT_CHAIN,
  SELECT_DISFIELD, ANNOUNCE_RACE, ANNOUNCE_ATTRIB, ROCK_PAPER_SCISSORS.
  Their parsers/encoders/UIs are implemented from the core sources and share
  the verified response primitives, but they are not yet proven in a live
  duel.

## Phase 2 (branch client-phase2)

### Item 1 — the "unexplained" ANNOUNCE_CARD at the opponent's draw phase: SOLVED
- Source: **Gravekeeper's Trap (98715423)**, the human's own face-up trap.
  Static audit of all 88 Lua scripts in the bundle: it is the ONLY script that
  calls `Duel.AnnounceCard`. Its ⑤ effect is a mandatory FIELD trigger
  (`EVENT_PREDRAW`, condition `Duel.IsTurnPlayer(1-tp)`): at the OPPONENT's
  pre-draw the trap's controller must declare a card name (filter: not an
  Extra-Deck-type card). On the opponent's rule draw the drawn card is shown
  to the controller; if it matches the declaration it is sent to the GY, then
  the opponent's hand is shuffled. The prompt is genuinely the human's — not
  a bot-seat leak.
- Reproduced exactly in Node (`test-investigate.js`): 7 events in one duel at
  turns 10/12/14/16/18/20/22 (the browser report said turns 12 and 14), every
  one phase=DRAW, turnPlayer=1, prompt.player=0, immediately preceded in the
  message stream by `CHAINING Gravekeeper's Trap by P0 @SZONE` — and card
  conservation held at every prompt boundary (0 violations), so the state
  mirror never desynced. The "unexplained" hand/GY/count changes in the
  browser run were real core events (this trap's draw-check GY send + hand
  shuffle, and other resolutions in the same window) that the Phase 1 UI
  applied silently.
- Fixes shipped regardless of cause:
  - **Prompt source context**: the driver now attaches `prompt.context` (the
    chain link being solved, else the newest link — sourced from the core's
    CHAINING stream) and every prompt UI shows it (selection grids, sort,
    counters, yes/no, options, announces, position, place hint, chain dock).
  - **Hand-change logging**: the state mirror now logs EVERY hand departure
    and arrival (discard, send to GY, banish, return to deck, add from
    GY/deck/field), every draw count, and every hand shuffle; also set and
    flip-summon lines that were missing.
  - **Declarable-only announce grid**: `isDeclarable()` in engine.js is a
    faithful port of the core's `is_declarable()` (playerop.cpp) running on
    exact BigInt opcodes (the parser now keeps u64 opcodes as BigInt). The
    announce grid offers only cards passing the prompt's own filter.
    Verified for all 63 pool cards against the real prompt opcode stream
    [TYPE_EXTRA=0x4802040, ISTYPE, NOT] (test-phase2 A/A2).

### Item 2 — live ATK/DEF via the core query API
- The driver (`poc/driver.cpp`, source kept at `build/driver.cpp`) now wraps
  `OCG_DuelQuery` (`poc_query_card`/`poc_query_ptr`/`poc_query_len`); the WASM
  was rebuilt with the existing `poc/build.sh` (wasm 1,334,518 bytes).
- `Duel.queryCard()` parses the core's TLV query records (card::get_infos
  format); `Duel.refreshFieldStats()` fills `curAtk/curDef/curLevel` on every
  occupied monster zone. The client refreshes at every prompt and every state
  update; board tiles show current values, printed values only until the
  first refresh lands.
- Verified (test-phase2 B): 2,649 occupied-zone observations across 2 explore
  duels — query code always matched the mirror, values always sane, and 517
  effect-modified sightings (e.g. Jirai Gumo 2100→1050 under Lost Wind).

### Item 3 — Japanese names and texts
- `gen-texts.js` extracts the old app's `def('slug', {...})` definitions from
  `../index.html` (official Japanese texts) and joins them via
  `~/workspace/ocgcore-poc/passcodes.json`. Result: `data.json` `names` are
  Japanese and a new `texts` section carries name+text for **63/63 cards —
  zero English fallbacks**. UI shows the text in action sheets, selection
  grids, and a read-only card-info sheet (tap a graveyard/removed/EX row).

### Item 4 — chain prompt fatigue (presentation only)
- Per-card **duel-long dismissal** ("このデュエル中は聞かない") on chain
  candidates, keyed like the existing per-chain dismissal. Implemented
  strictly as auto-answering pass (−1) when EVERY candidate of a
  SELECT_CHAIN belongs to dismissed classes; any other candidate (or a
  forced prompt) shows the dock normally. Never touches legality.
- Visible indicator: an amber chip flashes "自動パス：<card>" when an
  auto-pass fires, and persists as "自動パス設定中：N件（タップで管理）"
  while any dismissal is active. The management sheet (tap the chip, only
  when no prompt is open) and the dock's own "自動パス設定中" section both
  allow re-enabling. The per-chain × dismissal is unchanged.

### Item 5 — start choices
- Start screen: own deck (Ishizu / Gate Guardian), opponent deck, and
  先攻/後攻/ランダム. The core's first player is always seat 0, so a
  second-player human is seated at core seat 1 with the decks swapped
  (standard ygopro approach); all rendering, labels, piles and the result
  screen follow the human seat (`HP`). Engine support: `Duel` opts
  `deckP0/deckP1/humanTeam`, `GameState` takes per-seat decks and a
  `humanPlayer` for log wording. Verified at engine level (test-phase2 D:
  seat-swapped duel completes, per-seat totals 55/58 at all 220 prompts,
  retries 0) and in the jsdom click-through run 2.

### Item 6 — audio
- BGM: start = ishizu-upload; duel scenes from the state mirror's advantage
  signal — score = LP difference + face-up field ATK difference (live query
  values) — mapped to neutral/advantage/big-advantage/disadvantage/
  big-disadvantage (the last a random pick from voice-note-2 + mystical,
  as assigned), win → big-advantage track, loss → big-disadvantage pool.
  Hysteresis bands + 8 s minimum dwell + never switching while a prompt is
  open, so the signal cannot flap. A sound ON/OFF toggle sits on the start
  screen.
- SE: an event queue on the state mirror (set/summon/spsummon/flipsummon/
  activate/attack/damage/destroy/banish/recover/negate) is drained by the
  client into the user's files: set_card, activate_card, ui_click,
  vs_start (duel start), summon_circle/big/land, attribute attack sounds
  (atk_earth/water/fire/wind/light/dark, sword fallback), hit_big/
  hit_critical by damage size, destroy_blast (battle) / destroy_stone
  (effect), banish_warp, recover, negate_shield. Same-file cues are
  throttled to one per 150 ms. No generated audio anywhere.
- Caveat: jsdom/Node cannot play audio — wiring is code-level only; actual
  playback still needs a real-browser/phone check.

### Phase 2 verification
- `node test-node.js` — unchanged Phase 1 scripted duel: 72 turns, 651
  prompts, winner P0 deck-out, **0 MSG_RETRY**, conservation 651/651.
- `node test-explore.js` — PASS (0 retries).
- `node test-investigate.js` — item 1 evidence above (exit 0).
- `node test-phase2.js` — ALL CHECKS PASSED (declarable filter A/A2, live
  query B0–B4, announce context C, seat swap D1–D4).
- jsdom click-through (`test-ui.js`, needs jsdom via NODE_PATH): two full
  duels played purely through DOM clicks on the real page. Run 1 (defaults,
  先攻): 61 turns, deck-out finish, result screen reached, Japanese names
  rendered, the duel-dismissal control was exercised once and the auto-pass
  chip appeared. Run 2 (自分=Gate Guardian / 相手=Ishizu / 後攻, human on
  core seat 1): 72 turns, deck-out finish, result screen reached. In both
  runs the retry warning never appeared in any prompt container
  (MSG_RETRY proxy = 0) and nothing stalled. No ANNOUNCE_CARD prompt
  occurred in either clicker duel (the trap never stayed face-up under
  generic clicking) — its context/filter behavior is covered by
  test-investigate/test-phase2 instead. Note: an early version of this
  test false-flagged a retry by scanning document.body, which includes
  the client.js source text itself; the scan is now scoped to the prompt
  containers, and the same duel trajectories pass clean.

## Fix round 1 (branch client-fixes-1)

### Issue 1 — decks were never shuffled: PROVEN, FIXED
Browser verification reported spell/trap-only hands across sessions, with
monsters arriving only via search effects. Investigation:
- No shuffle existed anywhere: `engine.js` registered each deck with the
  core in `data.json` array order (same in the PoC driver, `duel.js`).
  In the ygopro family the deck order at registration is the client's
  responsibility; the core deals it verbatim, from the END of the list
  (last registered = top of deck).
- `data.json` stores both main decks grouped by type (monsters first,
  then spells, then traps) — so the dealt opening was always the array's
  spell/trap tail.
- Proof: a Node probe recording MSG_DRAW for both seats over 4 fresh
  module loads with 4 different duel seeds produced byte-identical draw
  sequences every time — e.g. the Ishizu seat opened 転生の予言 /
  巨神封じの矢 / 光の護封霊剣 / 運命の抱く爆弾 x2 and had drawn 墓守の罠 x3
  by turn 3 (the array tail, verbatim). The duel seed had no effect on
  deck order.
Fix (`engine.js`): `Duel.run()` now registers Fisher-Yates-shuffled
COPIES of both main and extra decks, fresh per duel. The RNG is
`crypto.getRandomValues` with unbiased rejection sampling
(`Math.random` fallback). `data.decks` is never mutated, so rematches
re-shuffle. `shuffledCopy` / `randBelow` are exported for tests.
Verification: the same probe now yields unrelated draw sequences per
run, with monsters throughout the opening hands; the full-duel Node
harness still completes with 0 retries and conservation intact.

### Issue 2 — chain 「パス」 appeared not to advance: mechanism found
The reported prompt (set メタバース during the opponent's turn, with a
パス button and a × dismiss control) was SELECT_CHAIN — only uiChain
renders those controls. Findings:
- Encodings are correct: the dock's pass sends i32 -1 (same as the bot's
  pass for SELECT_CHAIN); EFFECTYN/YESNO declines send i32 0. Both match
  the core protocol.
- Reproduction (Node; scripted Gate-Guardian human who sets S/T and
  passes every chain): across 6 full duels, MSG_RETRY total was 0 with
  empty retry attribution — a pass is NEVER rejected, so there is no
  retry/re-prompt loop, and the click path is not at fault either
  (the jsdom clicker presses #chain-pass through whole duels).
- The real mechanism: once the human has a set activatable card, the
  core issues a NEW SELECT_CHAIN at every fast-effect timing of the
  opponent's turn. In the reproduction duels the human received
  74–173 chain prompts during bot turns alone; 74–172 of them had a
  candidate set identical to the previous prompt (the same single set
  card, re-asked at DRAW — twice — STANDBY, MAIN1, END, ...). Each pass
  DID advance the game — to the next timing, which asked the same
  question again. uiChain rendered every one of those prompts
  identically (its context line falls back to 「効果への応答」 whenever
  the chain is empty and carried no turn/phase information), so two
  passes looked like "nothing changed". The duel-long dismissal
  appeared to "fix" it only because it auto-passes ALL such re-asks.
Fix (`client.js`, `index.html`): every shown chain dock now displays
the timing — turn owner + phase (e.g. 相手のターン・スタンバイ) — and a
per-turn confirmation counter （このターンN回目の確認） that increments
with each new prompt, and the dock plays a short arrival animation on
each NEW prompt (first draw only; dismissal redraws don't replay it).
The yes/no and effect-yes/no sheet received the same timing + counter
line (their decline path was audited as above: same recurring-timing
pattern is possible there, encoding is correct). Dismissal mechanics
are unchanged.

### Fix round 1 regression
- `node test-node.js` — PASS (full duel completes; 554 conservation
  checks, 0 violations; retries 0).
- `node test-explore.js` — PASS (0 retries).
- `node test-phase2.js` — ALL CHECKS PASSED (seat-swap duel included,
  retries 0).
- `node test-investigate.js` — PASS (exit 0).
- jsdom click-through (`test-ui.js`, NODE_PATH jsdom) — ALL UI CHECKS
  PASSED (run 1: 52 turns, deck-out win, duel-dismissal exercised once;
  run 2 seat-swap: 72 turns, deck-out; retry warning never seen in
  either run). Cautionary tale: the FIRST stock run of this round timed
  out in both duels. Root cause was in this round's own Issue 2 change —
  the dock's arrival animation was first implemented by appending an
  `arrive` class, which broke the exact `className === 'on'` contract
  the clicker (and potentially other tooling) uses to detect the open
  dock; a pace-0 probe showed the game blocked on a dock reading
  `className "on arrive"`. The animation now uses the Web Animations
  API (`element.animate`, guarded) and the class contract is restored;
  the unmodified stock suite then passed both runs within budget.


## Genesis format restrictions (branch client-genesis)

The duel now runs under the user's Genesis-equivalent restrictions on an
MR5 base. The flags live in `engine.js` (`FLAGS_GENESIS`) and are passed
verbatim to `OCG_DuelOptions` via `poc_create` in `v2/build/driver.cpp`
(the driver takes flags as a JS parameter, so no driver/WASM rebuild was
needed — `v2/build/ocgcore.wasm` is unchanged):

- `DUEL_EMZONE` (0x2000) removed -> no Extra Monster Zones. Core-side
  proof: without the flag, `field::get_tofield_count` always sets MZONE
  bits 5/6 in the unusable mask, so SELECT_PLACE never offers them and
  Extra-Deck summons route to main zones 0-4 (`get_useable_count_fromex`
  falls back to the non-rule4 path).
- `DUEL_PZONE` (0x800) removed -> no Pendulum Zones.
- `DUEL_1ST_TURN_DRAW` (0x200) stays absent -> the starting player does
  not draw on turn 1 (core `processor.cpp`: turn-1 draw only happens when
  this flag is set). All other base flags unchanged (incl. DUEL_FSX_MMZONE,
  so Fusion/Synchro/Xyz use main monster zones).

Measured before (MR5 flags) vs after (Genesis flags), `test-genesis.js`
(exploratory policy on both seats; deck order is crypto-shuffled per duel,
so figures are aggregates over independent duels):

- Turn-1 draw: starting player's hand at their first MAIN1 prompt was 5
  and their turn-1 maximum was 5 in all 15 complete baseline duels and
  all 6 Genesis duels; first-prompt hands were [5,5] every time. The restriction
  was ALREADY satisfied before this change (the PoC flag set never
  included DUEL_1ST_TURN_DRAW) and remains satisfied — measured, not
  assumed.
- Extra Monster Zones: baseline — 39 of 43 observed Extra-Deck monster
  appearances landed in seq 5/6, and 39 of 580 SELECT_PLACE/DISFIELD
  prompts offered an EMZ bit. After — 218 place prompts with 0 EMZ offers,
  13 Extra-Deck appearances, ALL in main zones (seqs {0:4, 1:3, 2:3,
  3:2, 4:1}), 0 in EMZ. MSG_RETRY 0 in every duel, all duels completed.
- UI: `client.js` renders only monster zones 0-4 for both players (the
  state mirror keeps its 7-slot arrays because RELOAD_FIELD always
  serializes 7; seq 5/6 can now never be offered or occupied). The dead
  `.slot.emz` styling was removed. Zone-tap mapping is unchanged (core
  sequences for main zones are 0-4 with or without the flag).

Card-pool audit (no deck changes): all 63 pool cards checked in
`data.json` — 0 Link (TYPE_LINK), 0 Pendulum (TYPE_PENDULUM), no nonzero
lscale/rscale, no link markers. Extra decks are Fusion 18 / Synchro 5 /
Xyz 6 (counting duplicates across both decks). Script audit of all 63
card scripts: no reference to linked zones, link markers, or an Extra
Monster Zone; no hardcoded seq 5/6. One non-issue hit:
`c36898537.lua` （メタファイズ・ホルス・ドラゴン） reads TYPE_PENDULUM only
as a flag on its Synchro materials (an optional bonus effect if a
Pendulum monster was used as material — impossible in this pool, and the
card functions fully without it).

Pre-existing issue found during verification (NOT caused by, and NOT
fixed by, this change — flagged for a later fix round): the state
mirror's Xyz-material accounting dips during inherent Xyz summons. Wire
evidence: materials move to loc 0xc0 (EXTRA|OVERLAY) with seq = the
host's Extra-Deck index while the host is still in the Extra Deck;
`engine.js` `_insertAt` credits OVERLAY units only to a host already in
`mzone[seq]`, so the materials go uncounted until they detach (loc
0x84/0x90), which restores the count. Consequences are display-side
only: the mirror's running total dips by the material count (and an Xyz
monster's materials badge under-reports) until detachment; if a duel
ends while an Xyz monster still holds materials, the mirror's final
total stays dipped (observed once: 57/58). The core state is always
consistent — duels complete with correct winners and MSG_RETRY 0. The
same artifact makes `test-phase2.js` check B2 (query code vs mirror
code) fail intermittently: it failed on unmodified main in 2 of 2
observed runs as well, so it is not a regression of this branch.

Regression on this branch: `test-node.js` PASS (644 conservation
checks, 0 violations, retries 0, final totals 58/55), `test-explore.js`
PASS, `test-genesis.js` PASS (6 duels), `test-phase2.js` all checks
pass except the pre-existing intermittent B2 above, `test-ui.js`
(jsdom click-through, NODE_PATH=/tmp/jsdomtest/node_modules) — ALL UI
CHECKS PASSED (both runs reached the result screen; run 2 seat-swapped
72 turns, deck-out; retry warning never shown, no stalls).

## Known gaps for later phases
- CPU intelligence: player 1 is the PoC's minimal legal bot (summon a
  level ≤4, otherwise advance phases; always passes chains unless forced).
  In Main 1 it takes the direct-to-End-Phase option whenever the core offers
  it, so it rarely enters battle; when it does, it attacks with the first
  available attacker. No tactics of any kind.
- Effects/presentation polish: no summon/attack animations, no target lines,
  no damage numbers; chain links are text chips. (Printed-only ATK/DEF was
  fixed in Phase 2 — board values are live from the core query.)
- SELECT_OPTION buttons are numbered placeholders — the core sends string
  table IDs (descriptions); a strings table is needed to label them.
- Genesis point limits: NOT applied — the format restrictions (no
  EMZ/PZONE, no first-turn draw, pool excludes Link/Pendulum) are in
  (see the Genesis section above), but per-card Genesis point costs and
  the 100-point deck budget are not enforced anywhere.
- Xyz materials mirror accounting: overlay units attached during an
  inherent Xyz summon are uncounted by the state mirror until they
  detach (see the Genesis section for wire-level evidence). Display-side
  only; core state is unaffected.
- Save/resume: none. Reloading restarts from the start screen.
- Turn timer, surrender, side decking: none. (Deck and first/second choice
  were added in Phase 2.)
- Opponent hand is shown as a count (backs in the top bar); revealed cards
  are tracked in state but only own-hand is rendered as tiles.
- jsdom click-through drives clicks generically (first available action);
  it proves reachability/completion of the UI paths, not usability quality.
- Phase 2 leftovers: audio playback itself is unverifiable in jsdom/Node
  (wiring only); BGM scene switching is driven by the LP+ATK score and has
  not been ear-checked on a phone; the chain duel-dismissal is keyed per
  candidate (code+location+sequence+effect desc), so the same card in a
  different zone is a separate dismissal entry.
