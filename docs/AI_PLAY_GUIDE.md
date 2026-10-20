# Making plays: a guide for AI assistants

This guide is everything an AI needs to write a play file (`.json`) for the Rugby Play Designer (<https://playbook.samuelroiz.com>) without seeing the code. A file written to these rules opens with **File → Load file…** and plays correctly with **Play**.

## Putting a play into the app

1. Open the app and choose **File → Paste play…**.
2. Paste the play's JSON into the box (**Play JSON**).
3. Press **Import**. The play opens as a new play, and the play that was open stays in **Plays**. If the text isn't a usable play, the box says why and keeps the text so it can be fixed.

A `.json` file can be opened instead with **File → Load file…**.

## 1. The pitch

Everything is in metres.

- `x` runs along the pitch. The try lines are at x = 0 and x = 100. The in-goals run from −10 to 0 and from 100 to 110, so the dead ball lines are at x = −10 and x = 110.
- `y` runs across the pitch, from one touchline (y = 0) to the other (y = 70).
- **Attack always plays towards x = 110**, so a forward move for attack means a bigger x. Attack defends the try line at x = 0; defense defends x = 100 and plays towards x = −10.
- Lines across the pitch (fixed x): try lines 0 and 100, 5 m lines (dashed) 5 and 95, 22s 22 and 78, 10 m lines (dashed) 40 and 60, halfway 50.
- Lines along the pitch (fixed y), drawn from x = 0 to 100: the 5 m lines at y = 5 and 65, the 15 m lines at y = 15 and 55.
- The centre spot is (50, 35). The posts are on each try line at y = 32.2 and 37.8.
- Positions are kept to 0.1 m. Keep every player inside x −10 to 110 and y 0 to 70 (in practice y 1 to 69, so the disc stays on the grass).

Turning the pitch (vertical view) only changes how it is drawn. The data never changes.

## 2. The play file

```json
{
  "schemaVersion": 1,
  "name": "Short name",
  "category": "attack",
  "tags": ["backs"],
  "view": "full",
  "orientation": "horizontal",
  "players": [{ "id": "a10", "team": "attack", "label": "10" }],
  "phases": [{
    "note": "What happens in this phase.",
    "instructions": { "a10": "Flat, call for it early." },
    "cues": [{ "player": "a10", "step": 1, "text": "Call it!" }],
    "positions": { "a10": { "x": 40, "y": 30 } },
    "objects": [{ "id": "o1", "type": "ball", "x": 41.1, "y": 30.9 }],
    "routes": [{ "id": "r1", "type": "run", "from": "a10", "points": [[40, 30], [46, 28]], "curve": 0, "order": 1, "option": null }]
  }]
}
```

**Required**, or the file is refused: `schemaVersion` (use `1`), `players` (a list) and `phases` (a list with at least one phase). Every player needs `id` and `team`; every marker needs `id`, `type`, `x`, `y`; every route needs `id`, `type` and `points` (at least two `[x, y]` pairs). Anything else of the wrong type is quietly dropped or given its default, so a mistake there does not stop loading but does change the play.

### Top level

| Field | Values | Default |
|---|---|---|
| `name` | text, up to 60 characters | `"Untitled play"` |
| `category` | `"attack"`, `"defense"`, `"lineout"`, `"scrum"` | `"attack"` |
| `tags` | list of short texts | `[]` |
| `view` | `"full"`, `"half"` (x 50 to 110, the half attack plays into), `"half-own"` (x −10 to 50) | `"full"` |
| `orientation` | `"horizontal"`, `"vertical"` | `"horizontal"` |

### Players

- Listed once for the whole play, in `players`.
- Ids: `a1` to `a15` for attack, `d1` to `d15` for defense. The number is the shirt number. At most 15 per team, each id once.
- `team`: `"attack"` or `"defense"`, matching the id's letter.
- `label`: what is drawn on the disc, up to 3 characters. Use the shirt number as text (`"10"`).
- **Every player needs a position in every phase**, in that phase's `positions`, as `{ "x": …, "y": … }`. (Loading fills a missing one from the nearest earlier phase, which is rarely what you meant.)

### Markers (`objects`)

| `type` | What it is | Extra fields |
|---|---|---|
| `ball` | The ball. One per phase is normal. | none |
| `ruck` | A ruck, drawn as a 2 m circle with R. | none |
| `scrum` | The scrum mark, between the front rows. | `putIn` (`"attack"` or `"defense"`), `pack` (ids of the players that move with it) |
| `lineout` | The lineout mark on the 5 m line; its x is the line of touch. | `throwIn` (`"attack"` or `"defense"`), `pack` |

- Ids are `o1`, `o2` … and unique within a phase.
- **A marker keeps the same id in every phase it is in.** That is how the animation slides it from one phase to the next.
- Use the scrum and lineout exactly as in section 4: their `y` must be 15, 35 or 55 (scrum) and 5 or 65 (lineout), and `pack` lists the 18 players placed there.

### Routes

| `type` | Colour on screen | Moves its player? | Carries the ball? |
|---|---|---|---|
| `run` | yellow | yes | no |
| `pass` | white, dashed | no | yes |
| `kick` | orange, dotted | no | yes |
| `decoy` | grey, dashed | yes | no |
| `drift` | purple | yes | no |
| `blitz` | pink | yes | no |

Use drift and blitz for defenders: drift slides across, blitz rushes up.

| Field | Meaning |
|---|---|
| `id` | `r1`, `r2` … unique within the phase. |
| `from` | The player the route belongs to. `null` means it was drawn on open grass, and then it moves nobody. |
| `to` | Pass only: the receiver's id (a team-mate), or `null` for a loose pass. Do not put `to` on other types. |
| `points` | Exactly two points, `[[x1, y1], [x2, y2]]`. The first is where `from` stands at the start of the phase. For a pass, the second is where the receiver stands at the start of the phase. |
| `curve` | Metres the middle of the route is pushed sideways (0 is straight). For a route heading towards +x, positive bends towards bigger y. In general the middle moves `curve` metres along (−dy, dx) divided by the route's length. Keep it small, under a quarter of the length. |
| `order` | A whole number, 1 to 99. Sets when the route runs (see section 3). |
| `option` | Passes and kicks only: `"A"`, `"B"`, `"C"` … when the player has two or more passes or kicks in the phase. Otherwise `null`. |
| `optionLabel` | Only with `option`: up to 25 characters, e.g. `"if 13 bites"`. Shown at the end of the route. |

### Phases

`phases` is in play order. Each phase has `note` (text, the coach's caption), `positions`, `objects` and `routes`.

Two optional fields are for players following the play on their phone (a share link, see the README) or in a position's animation (**Save animation → Who**). Neither changes how the play moves, and the PNG and PDF exports don't show them. A new phase built from the one before starts with neither. Leave them out of a phase where nobody needs them.

`instructions`: each player's **job** in this phase, by player id, one short line. Up to 120 characters each; longer ones are cut, and empty ones and ids not in the play are dropped. It's shown large at the bottom of the phone, on at most two lines, so write a short command, not a paragraph (the `note` is for the coach's full explanation, which the phone shows on request). A player with no instruction gets one made from their routes in that phase, e.g. *Pass to 12*, *Take the pass from 10*, *Grubber*, *Chase the kick*, *Carry into contact*, *Drift across*, *Hold your spot*, or two of them joined (*Take the pass from 10, then carry into contact*). So only write one when it says more than that.

```json
"instructions": { "a10": "Flat, call for it early.", "a12": "Hit the gap between their 10 and 12." }
```

`cues`: short calls that pop up in a bubble next to the player as a step starts, e.g. `"JUMP!"`. Playback slows for a moment so they register. A list of `{ "player", "step", "text" }`:

| Field | Meaning |
|---|---|
| `player` | The player's id. Must be in the play, or the cue is dropped. |
| `step` | The route `order` number at which it pops up: when the first route with that order starts moving. A whole number from 1 to 99. Left out (or invalid), it is the order of the player's first route in this phase, or 1 if they have none. |
| `text` | Up to 30 characters, shown in capitals. Empty ones are dropped. |

A player can have several cues in a phase. Use them sparingly, for the moment that matters:

```json
"cues": [
  { "player": "a4", "step": 1, "text": "Jump!" },
  { "player": "a12", "step": 2, "text": "Hit it now" }
]
```

## 3. The rules the app uses

### Timing inside a phase

- Routes run in `order`: everything with the same number starts together, and order 2 starts once everything in order 1 has finished.
- A pass or kick leaves once its passer has finished their own run in that same order step. So "10 runs and passes" is a run and a pass from `a10`, both order 1.
- A player with two moving routes does them one after the other. The second one's first point should be where the first one ends.
- There is one ball, so passes and kicks happen one after another.
- At the start of a phase, the ball moves with the first passer if it is within 3 m of them. With no pass in the phase, it moves with the nearest player within 3 m. Put the ball 1.1 m in x and 0.9 m in y from the holder: holder at (x, y), ball at (x + 1.1, y + 0.9).
- A pass with a `to` ends in that player's hands, even if they are running.

### Options

- When one player has two or more passes or kicks in a phase, they are alternatives, not a sequence. Letter them `"A"`, `"B"` … and give them all the same `order`.
- **A is the plan.** Only A plays, and the next phase is built from A. B, C … are drawn fainter, and in Present mode the coach can play one instead, for that phase only.
- A lone pass or kick has `option: null`. Never give two passes from one player `null`: both would play, one after the other.

### Building the next phase

Each phase after the first is built from the one before:

1. **Positions.** Each player with a run, decoy, drift or blitz moves to the end of it. With several, the one with the highest order wins (equal orders: the one later in the list). Everyone else stays put.
2. **Ball.** Take the passes and kicks, leaving out options other than A, in order. The ball that moves is the one nearest the start of the first. It ends with the last one:
   - a pass: in the hands of the receiver (`to`), at the receiver's new position plus (1.1, 0.9). With no `to`, the receiver is the passer's nearest team-mate within 5 m of where the pass ends, with everyone where they are once runs up to the pass's order are done. If nobody is that close, the ball stops at the pass's end.
   - a kick: at the kick's end.
   - no pass or kick: the ball stays where it is.
3. **Markers** are copied unchanged, with the same ids.
4. **Routes** are not copied: the new phase starts with none. The note starts empty; write a new one.

Then you add the new phase's routes and note. Leave positions and markers exactly as built. If someone should be somewhere else, give them a run in the phase before. (A marker you add or remove in the new phase is fine: a new one appears when that phase starts, a removed one fades during the slide.)

When playing, the animation runs the phase's routes, then slides everyone to their positions in the next phase. If the next phase was built by these rules, nothing jumps.

### Rugby rules the file should respect

- **Passes go flat or backwards.** For attack, the receiver's x must be no bigger than the passer's x, both as drawn and where the two stand when the ball leaves (after their runs in earlier orders and in the pass's own order). For defense the opposite: the receiver's x no smaller. Kicks may go any way.
- **Space players at least 2.5 m apart**, centre to centre, at the start of every phase and at the ends of runs. Discs are 2.4 m across, wider than a real body. The one exception is the lineout preset, whose two lines stand 2.4 m apart.
- Keep runners clear of other players' discs along the way where you can.

## 4. Positions that look right

All of these are the app's own presets and templates. Copy the numbers.

### Scrum

The mark (mx, my) is between the front rows: mx anywhere from 0 to 100, my one of 15, 35 or 55. Attack's pack is on the −x side, defense's on the +x side.

| Player | Attack (aN) | Defense (dN) |
|---|---|---|
| 1 | (mx − 1.5, my − 2.5) | (mx + 1.5, my + 2.5) |
| 2 | (mx − 1.5, my) | (mx + 1.5, my) |
| 3 | (mx − 1.5, my + 2.5) | (mx + 1.5, my − 2.5) |
| 4 | (mx − 4, my − 1.25) | (mx + 4, my + 1.25) |
| 5 | (mx − 4, my + 1.25) | (mx + 4, my − 1.25) |
| 6 | (mx − 3.6, my − 3.9) | (mx + 3.6, my + 3.9) |
| 7 | (mx − 3.6, my + 3.9) | (mx + 3.6, my − 3.9) |
| 8 | (mx − 6.5, my) | (mx + 6.5, my) |

The 9s and the ball go on the put-in side:

| | Attack put-in | Defense put-in |
|---|---|---|
| a9 | (mx − 0.5, my − 6.6) | (mx − 2.5, my + 6.6) |
| d9 | (mx + 2.5, my − 6.6) | (mx + 0.5, my + 6.6) |
| ball | (mx, my − 4.7) | (mx, my + 4.7) |

The scrum object: `{ "id": "o1", "type": "scrum", "x": mx, "y": my, "putIn": "attack", "pack": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"] }`.

Backlines at a scrum on (50, 35), attack put-in (the Scrum template): a10 (37, 29), a12 (35.5, 22.5), a13 (34.5, 16), a14 (34, 8), a11 (37, 58), a15 (27, 30); d10 (63, 29), d12 (64.5, 22.5), d13 (65.5, 16), d11 (66, 8), d14 (63, 58), d15 (75, 32). The 10s are 13 m back from the mark and on the 9's side, so 9 to 10 never crosses a pack. For another mark in the middle, shift them all by the same amount; for a defense put-in, mirror them across the mark (y becomes 2·my − y) so the 10s stay on the 9s' side. At a 15 m mark (my = 15 or 55) there is no room to shift everyone: keep each 10 on their 9's side, 13 m back from the mark, and spread the rest of the backline towards the open side from there, at least 6 m behind their No. 8, so passes stay behind the pack.

### Lineout

The mark (lx, ly): lx from 3 to 97 is the line of touch, ly is 5 (near touchline, y = 0) or 65 (far touchline, y = 70). Let s = 1 and t = 0 at the near touchline, s = −1 and t = 70 at the far one.

- Both lines, from the front, are players 1, 4, 3, 6, 5, 8, 7. The k-th of them (k = 0 to 6) stands at y = ly + s·(1.2 + 2.5k). Attack's line is at x = lx − 1.2, defense's at x = lx + 1.2.
- The throwing hooker stands on the touchline: attack (lx − 0.5, t + 1.2·s), defense (lx + 0.5, t + 1.2·s). The other hooker is in the 5 m channel: attack (lx − 2.4, t + 2.6·s), defense (lx + 2.4, t + 2.6·s).
- 9s: a9 (lx − 3, ly + 19.5·s), d9 (lx + 3, ly + 19.5·s).
- Ball with the thrower: (lx + 0.6, t + 2.2·s) if attack throws, (lx − 0.6, t + 2.2·s) if defense throws.
- The object: `{ "id": "o1", "type": "lineout", "x": lx, "y": ly, "throwIn": "attack", "pack": ["a1", "a4", "a3", "a6", "a5", "a8", "a7", "a2", "a9", "d1", "d4", "d3", "d6", "d5", "d8", "d7", "d2", "d9"] }`.

The Lineout template, mark (40, 5), attack throwing: a1 (38.8, 6.2), a4 (38.8, 8.7), a3 (38.8, 11.2), a6 (38.8, 13.7), a5 (38.8, 16.2), a8 (38.8, 18.7), a7 (38.8, 21.2), a2 (39.5, 1.2), a9 (37, 24.5); d1 to d7 the same y at x = 41.2, d2 (42.4, 2.6), d9 (43, 24.5); ball (40.6, 2.2). Backs 10 m or more back, further infield than the 9s: a10 (29, 28), a12 (28, 35), a13 (27, 42), a14 (26, 54), a11 (24, 14), a15 (18, 40); d10 (51, 28), d12 (52, 35), d13 (53, 42), d11 (54, 54), d14 (58, 12), d15 (70, 40).

### Ruck and pods (the Backline attack template)

Ruck at (50, 20), attack on its −x side:

- Ruck marker (50, 20); ball at the back of it, (48, 20.9); a9 (46.6, 21.6) over the ball.
- Pod of three, 3 m behind the ruck and 2.8 m apart, on the open side: a1 (47, 24.5), a2 (47, 27.3), a3 (47, 30.1); second row a4 (44.5, 25.9), a5 (44.5, 28.7).
- Short-side guards: a6 (47.5, 15.5), a7 (47.5, 12.7), a8 (44.5, 17); a11 (44, 6) on the short wing.
- Backline, each a little deeper and 7 to 10 m wider: a10 (41, 33), a12 (39.5, 40), a13 (38.5, 47), a14 (37.5, 57); a15 deep at (32, 45).

### Flat defensive line (the Attack vs defense template)

3 m beyond the ruck (x = ruck x + 3), spaced about 4.5 m across the field: with the ruck at (50, 20), d14 (53, 8), d7 (53, 13), d1 (53, 17.5), d3 (53, 22.5), d2 (53, 27), d4 (53, 31.5), d5 (53, 36), d6 (53, 40.5), d8 (53, 45), d10 (53, 49.5), d12 (53, 54), d13 (53, 58.5), d11 (53, 64); d9 behind the ruck at (56.5, 20); d15 sweeping at (72, 40).

### Kick-off (the Kick-off template)

a10 at the centre spot (48.5, 35) with the ball on (50, 35); the chasers on x = 47 across the field, a few at x = 44, a15 at (30, 35). The receivers 10 m or more back: a front line at x = 61 to 66, the halves around x = 70 to 75, wings and 15 deep at x = 86 to 92.

## 5. Method

1. **Pick the closest template** in section 4 and copy its players and positions for phase 1. Add only the players the play needs, but keep both full teams for set pieces.
2. **Write phase 1's routes.** First point of each on its player. Passes end on the receiver, with `to`. Number the orders step by step, and give runs that happen with a pass the pass's order.
3. **Check passes** go flat or backwards, and players stay 2.5 m apart at the ends of runs.
4. **Build phase 2 by the rules in section 3**: copy positions, move each runner to their route's end, move the ball to the last A pass's receiver (new position + 1.1, + 0.9) or the kick's end, copy the markers, empty the routes, write the note.
5. **Write phase 2's routes** from those new positions, and repeat for each phase.
6. **Run the checklist** (section 6).

Keep plays short: 2 to 5 phases, each with one clear idea in its note.

## 6. Checklist

- [ ] `schemaVersion` is 1; `players` and `phases` are lists; there is at least one phase.
- [ ] Every player id is `a1` to `a15` or `d1` to `d15`, listed once, with the matching `team` and a label of up to 3 characters.
- [ ] Every player has a position in every phase, inside the pitch.
- [ ] Players are at least 2.5 m apart (the lineout's two lines may be 2.4 m).
- [ ] Every route has two points, an id unique in its phase, a known `type`, an `order` from 1 to 99, and a `from` that is in the play. Its first point is on its player.
- [ ] Every pass has `to` naming a team-mate, ends where that team-mate stands, and goes flat or backwards.
- [ ] A player with two or more passes or kicks in a phase has them lettered A, B … with one shared order. Everyone else's passes and kicks have `option: null`. `optionLabel` only on options.
- [ ] The ball starts within 3 m of the first passer (at their x + 1.1, y + 0.9).
- [ ] Each phase after the first matches what section 3 builds from the one before: positions, and every marker's id and place.
- [ ] Each marker keeps its id from phase to phase. Scrums and lineouts use the section 4 layouts, `y` values and `pack` lists.
- [ ] Every phase has a note a coach can read out.
- [ ] Any `instructions` name players in the play and are 120 characters or fewer: one short job each.
- [ ] Any `cues` name players in the play, have a `step` that is one of the phase's route orders, and text of 30 characters or fewer.
- [ ] `name` is 60 characters or fewer and `category` is one of the four.

## 7. Worked example: Scrum 12 crash

This is `templates/example.json`, the play behind **Try an example** in the About box, laid out more compactly (the data is identical).

```json
{
  "schemaVersion": 1,
  "name": "Example: Scrum 12 crash",
  "category": "scrum",
  "tags": ["example", "backs", "set move"],
  "view": "full",
  "orientation": "horizontal",
  "players": [
    { "id": "a1", "team": "attack", "label": "1" }, { "id": "a2", "team": "attack", "label": "2" }, { "id": "a3", "team": "attack", "label": "3" },
    { "id": "a4", "team": "attack", "label": "4" }, { "id": "a5", "team": "attack", "label": "5" }, { "id": "a6", "team": "attack", "label": "6" },
    { "id": "a7", "team": "attack", "label": "7" }, { "id": "a8", "team": "attack", "label": "8" }, { "id": "a9", "team": "attack", "label": "9" },
    { "id": "a10", "team": "attack", "label": "10" }, { "id": "a11", "team": "attack", "label": "11" }, { "id": "a12", "team": "attack", "label": "12" },
    { "id": "a13", "team": "attack", "label": "13" }, { "id": "a14", "team": "attack", "label": "14" }, { "id": "a15", "team": "attack", "label": "15" },
    { "id": "d1", "team": "defense", "label": "1" }, { "id": "d2", "team": "defense", "label": "2" }, { "id": "d3", "team": "defense", "label": "3" },
    { "id": "d4", "team": "defense", "label": "4" }, { "id": "d5", "team": "defense", "label": "5" }, { "id": "d6", "team": "defense", "label": "6" },
    { "id": "d7", "team": "defense", "label": "7" }, { "id": "d8", "team": "defense", "label": "8" }, { "id": "d9", "team": "defense", "label": "9" },
    { "id": "d10", "team": "defense", "label": "10" }, { "id": "d11", "team": "defense", "label": "11" }, { "id": "d12", "team": "defense", "label": "12" },
    { "id": "d13", "team": "defense", "label": "13" }, { "id": "d14", "team": "defense", "label": "14" }, { "id": "d15", "team": "defense", "label": "15" }
  ],
  "phases": [
    {
      "note": "9 passes to 10 off the scrum. The backs hold their depth.",
      "positions": {
        "a1": { "x": 48.5, "y": 32.5 }, "a2": { "x": 48.5, "y": 35 }, "a3": { "x": 48.5, "y": 37.5 }, "a4": { "x": 46, "y": 33.8 },
        "a5": { "x": 46, "y": 36.3 }, "a6": { "x": 46.4, "y": 31.1 }, "a7": { "x": 46.4, "y": 38.9 }, "a8": { "x": 43.5, "y": 35 },
        "a9": { "x": 49.5, "y": 28.4 }, "d1": { "x": 51.5, "y": 37.5 }, "d2": { "x": 51.5, "y": 35 }, "d3": { "x": 51.5, "y": 32.5 },
        "d4": { "x": 54, "y": 36.3 }, "d5": { "x": 54, "y": 33.8 }, "d6": { "x": 53.6, "y": 38.9 }, "d7": { "x": 53.6, "y": 31.1 },
        "d8": { "x": 56.5, "y": 35 }, "d9": { "x": 52.5, "y": 28.4 }, "a10": { "x": 37, "y": 29 }, "a12": { "x": 35.5, "y": 22.5 },
        "a13": { "x": 34.5, "y": 16 }, "a14": { "x": 34, "y": 8 }, "a11": { "x": 37, "y": 58 }, "a15": { "x": 27, "y": 30 },
        "d10": { "x": 63, "y": 29 }, "d12": { "x": 64.5, "y": 22.5 }, "d13": { "x": 65.5, "y": 16 }, "d11": { "x": 66, "y": 8 },
        "d14": { "x": 63, "y": 58 }, "d15": { "x": 75, "y": 32 }
      },
      "objects": [
        { "id": "o1", "type": "scrum", "x": 50, "y": 35, "putIn": "attack", "pack": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"] },
        { "id": "o2", "type": "ball", "x": 50, "y": 30.3 }
      ],
      "routes": [
        { "id": "r1", "type": "pass", "from": "a9", "points": [[49.5,28.4], [37,29]], "curve": 0, "order": 1, "option": null, "to": "a10" }
      ]
    },
    {
      "note": "10 runs at the line. A: short pass to 12. B: grubber in behind their 12 if they rush up.",
      "positions": {
        "a1": { "x": 48.5, "y": 32.5 }, "a2": { "x": 48.5, "y": 35 }, "a3": { "x": 48.5, "y": 37.5 }, "a4": { "x": 46, "y": 33.8 },
        "a5": { "x": 46, "y": 36.3 }, "a6": { "x": 46.4, "y": 31.1 }, "a7": { "x": 46.4, "y": 38.9 }, "a8": { "x": 43.5, "y": 35 },
        "a9": { "x": 49.5, "y": 28.4 }, "d1": { "x": 51.5, "y": 37.5 }, "d2": { "x": 51.5, "y": 35 }, "d3": { "x": 51.5, "y": 32.5 },
        "d4": { "x": 54, "y": 36.3 }, "d5": { "x": 54, "y": 33.8 }, "d6": { "x": 53.6, "y": 38.9 }, "d7": { "x": 53.6, "y": 31.1 },
        "d8": { "x": 56.5, "y": 35 }, "d9": { "x": 52.5, "y": 28.4 }, "a10": { "x": 37, "y": 29 }, "a12": { "x": 35.5, "y": 22.5 },
        "a13": { "x": 34.5, "y": 16 }, "a14": { "x": 34, "y": 8 }, "a11": { "x": 37, "y": 58 }, "a15": { "x": 27, "y": 30 },
        "d10": { "x": 63, "y": 29 }, "d12": { "x": 64.5, "y": 22.5 }, "d13": { "x": 65.5, "y": 16 }, "d11": { "x": 66, "y": 8 },
        "d14": { "x": 63, "y": 58 }, "d15": { "x": 75, "y": 32 }
      },
      "objects": [
        { "id": "o1", "type": "scrum", "x": 50, "y": 35, "putIn": "attack", "pack": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"] },
        { "id": "o2", "type": "ball", "x": 38.1, "y": 29.9 }
      ],
      "routes": [
        { "id": "r1", "type": "run", "from": "a10", "points": [[37,29], [40,27.5]], "curve": 0, "order": 1, "option": null },
        { "id": "r2", "type": "run", "from": "a12", "points": [[35.5,22.5], [39.5,21.5]], "curve": 0.4, "order": 1, "option": null },
        { "id": "r3", "type": "pass", "from": "a10", "points": [[37,29], [35.5,22.5]], "curve": 0, "order": 1, "option": "A", "to": "a12" },
        { "id": "r4", "type": "kick", "from": "a10", "points": [[37,29], [72,22]], "curve": 0, "order": 1, "option": "B", "optionLabel": "if 12 rushes up" },
        { "id": "r5", "type": "drift", "from": "d10", "points": [[63,29], [57,26.5]], "curve": 0, "order": 1, "option": null },
        { "id": "r6", "type": "drift", "from": "d12", "points": [[64.5,22.5], [58.5,21]], "curve": 0, "order": 1, "option": null },
        { "id": "r7", "type": "drift", "from": "d13", "points": [[65.5,16], [60,15.5]], "curve": 0, "order": 1, "option": null }
      ]
    },
    {
      "note": "12 carries hard into the gap between their 10 and 12.",
      "positions": {
        "a1": { "x": 48.5, "y": 32.5 }, "a2": { "x": 48.5, "y": 35 }, "a3": { "x": 48.5, "y": 37.5 }, "a4": { "x": 46, "y": 33.8 },
        "a5": { "x": 46, "y": 36.3 }, "a6": { "x": 46.4, "y": 31.1 }, "a7": { "x": 46.4, "y": 38.9 }, "a8": { "x": 43.5, "y": 35 },
        "a9": { "x": 49.5, "y": 28.4 }, "d1": { "x": 51.5, "y": 37.5 }, "d2": { "x": 51.5, "y": 35 }, "d3": { "x": 51.5, "y": 32.5 },
        "d4": { "x": 54, "y": 36.3 }, "d5": { "x": 54, "y": 33.8 }, "d6": { "x": 53.6, "y": 38.9 }, "d7": { "x": 53.6, "y": 31.1 },
        "d8": { "x": 56.5, "y": 35 }, "d9": { "x": 52.5, "y": 28.4 }, "a10": { "x": 40, "y": 27.5 }, "a12": { "x": 39.5, "y": 21.5 },
        "a13": { "x": 34.5, "y": 16 }, "a14": { "x": 34, "y": 8 }, "a11": { "x": 37, "y": 58 }, "a15": { "x": 27, "y": 30 },
        "d10": { "x": 57, "y": 26.5 }, "d12": { "x": 58.5, "y": 21 }, "d13": { "x": 60, "y": 15.5 }, "d11": { "x": 66, "y": 8 },
        "d14": { "x": 63, "y": 58 }, "d15": { "x": 75, "y": 32 }
      },
      "objects": [
        { "id": "o1", "type": "scrum", "x": 50, "y": 35, "putIn": "attack", "pack": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"] },
        { "id": "o2", "type": "ball", "x": 40.6, "y": 22.4 }
      ],
      "routes": [
        { "id": "r1", "type": "run", "from": "a12", "points": [[39.5,21.5], [55.5,23.7]], "curve": -0.5, "order": 1, "option": null },
        { "id": "r2", "type": "drift", "from": "d10", "points": [[57,26.5], [54.5,26.2]], "curve": 0, "order": 1, "option": null },
        { "id": "r3", "type": "drift", "from": "d12", "points": [[58.5,21], [55,21.3]], "curve": 0, "order": 1, "option": null }
      ]
    }
  ]
}
```

**Phase 1.** Both packs and 9s are the scrum layout from section 4 on the mark (50, 35), attack's put-in; the backlines are the Scrum template's. The ball (50, 30.3) is 2 m from a9 (49.5, 28.4), so a9 holds it. One route: a9 passes to a10, order 1, flat and backwards (x 49.5 to 37).

**Phase 2**, built from phase 1: nobody had a run, so the positions are the same. The last pass went to a10, so the ball is at a10 + (1.1, 0.9) = (38.1, 29.9). The scrum marker keeps its id `o1`, the ball `o2`. Routes, all order 1:

- a10 runs forward to (40, 27.5) and a12 runs on a slight curve to (39.5, 21.5). They start together.
- a10 has two ball routes, so they are options with the same order: A, a pass to a12 drawn from a10's start to a12's start; B, a kick in behind, labelled "if 12 rushes up". The pass leaves once a10's run ends, and it is still backwards then (a10 at x 40, a12 at x 39.5).
- d10, d12 and d13 drift towards the ball.

**Phase 3**, built from phase 2: a10, a12, d10, d12 and d13 are at the ends of their runs and drifts. Option A is the plan, so the ball goes to a12's new spot: (39.5, 21.5) + (1.1, 0.9) = (40.6, 22.4). There is no pass in phase 3, so a12 carries the ball (it is within 3 m of them). a12 runs hard to (55.5, 23.7) on a curve of −0.5, and d10 and d12 drift in to close the gap.

## 8. Asking for a play in plain words

A coach can describe a play with this template, and an AI can turn it into a file with the method in section 5. Leave out anything that doesn't matter; the AI uses the template positions for the rest.

```
Name: <short name, up to 60 characters>
Category: attack / defense / lineout / scrum
Where: <where on the pitch, e.g. "scrum on halfway, middle of the field, our put-in"
        or "ruck 20 m in from the left touchline, on our 10 m line">

Phase 1
  Start: <the set piece or shape, and anyone placed differently from the template>
  Moves: <in order, e.g. "1. 9 passes to 10. 2. 10 runs at the line and passes to 12;
          option B: 10 kicks in behind if their 12 rushes up">
  Instructions: <the note to show, e.g. "Backs hold their depth">
  Defense: <what the defense does, e.g. "flat line; 10, 12 and 13 drift">

Phase 2
  Start: built from phase 1 (or say what changes, e.g. "a ruck where 12 is tackled")
  Moves: ...
  Instructions: ...
  Defense: ...
```

The worked example, described this way:

```
Name: Example: Scrum 12 crash
Category: scrum
Where: scrum on halfway, middle of the field, our put-in

Phase 1
  Start: Scrum template
  Moves: 1. 9 passes to 10.
  Instructions: 9 passes to 10 off the scrum. The backs hold their depth.
  Defense: stays put

Phase 2
  Start: built from phase 1
  Moves: 1. 10 runs at the line and 12 runs a slight curve outside; then 10 passes to 12;
          option B: 10 kicks in behind, "if 12 rushes up".
  Instructions: 10 runs at the line. A: short pass to 12. B: grubber in behind their 12 if they rush up.
  Defense: 10, 12 and 13 drift towards the ball

Phase 3
  Start: built from phase 2
  Moves: 1. 12 carries hard into the gap.
  Instructions: 12 carries hard into the gap between their 10 and 12.
  Defense: 10 and 12 drift in to close the gap
```
