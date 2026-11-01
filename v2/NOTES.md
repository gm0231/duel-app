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

## Known gaps for later phases
- CPU intelligence: player 1 is the PoC's minimal legal bot (summon a
  level ≤4, otherwise advance phases; always passes chains unless forced).
  In Main 1 it takes the direct-to-End-Phase option whenever the core offers
  it, so it rarely enters battle; when it does, it attacks with the first
  available attacker. No tactics of any kind.
- Effects/presentation polish: printed ATK/DEF only; no summon/attack
  animations, no target lines, no damage numbers; chain links are text chips.
- SELECT_OPTION buttons are numbered placeholders — the core sends string
  table IDs (descriptions); a strings table is needed to label them.
- Genesis restrictions (no EMZ/Link/Pendulum, no first-turn draw, point
  limits): NOT applied — duels run MR5 as in the PoC, per phase instructions.
  The restriction path (duel flags + pool limits) is a later phase.
- Save/resume: none. Reloading restarts from the start screen.
- Turn timer, surrender, deck choice (human is always Ishizu, bot always
  Gate Guardian), side decking: none.
- Opponent hand is shown as a count (backs in the top bar); revealed cards
  are tracked in state but only own-hand is rendered as tiles.
- jsdom smoke test drives clicks generically (first available action); it
  proves reachability/completion of the UI paths, not usability quality.
