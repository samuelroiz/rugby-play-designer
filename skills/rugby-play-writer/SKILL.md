---
name: rugby-play-writer
description: Writes, fixes and reviews rugby plays as .json files for the Rugby Play Designer app (playbook.samuelroiz.com). Use this whenever the user asks to write, design, build, fix, review or animate a rugby play, set piece, attacking or defensive move, exit, strike move, kick-chase, lineout, scrum or backline move, or mentions their playbook, play library or the Rugby Play Designer - even if they never say "skill" or "JSON". Also use it to turn a coach's one-line description ("box kick off our 22, 11 chases") into a loadable play with jobs and cues for the players.
---

# Rugby Play Writer

Turn a coach's description into a play file that the Rugby Play Designer loads and animates
correctly, that makes rugby sense, and that gives every player who matters a job. A play is JSON:
players on a pitch (metres, attack towards x = 110), phases, and routes (run, pass, kick, decoy,
drift, blitz) with order numbers. The app animates each phase and builds the next one from it by
fixed rules. The full format lives in `references/ai-play-guide.md` - read it before writing your
first play in a session (the live copy is at
https://playbook.samuelroiz.com/docs/AI_PLAY_GUIDE.md and wins if they ever differ).

## Workflow

### 1. Intake

`references/our-team.md` ships blank: it's for the user to fill in with their squad after installing.
Read `references/our-team.md`; if it's filled in (no "..." placeholders), shape kickers, calls and
targets to it. If key details are missing, ask at most 3 short questions, only about things that
change the play: where on the pitch, set piece or ruck, attack or defense, what each phase should
do. Otherwise choose sensibly and say what was assumed. A defensive system the defenders must
learn gets `category: "defense"` (the phone viewer then shows defenders first); everything else is
`attack`, `lineout` or `scrum` by its start.

### 2. Design - coach first, coordinates second

Before any JSON, sketch the play as a coach: what it's for, the read, who touches the ball, how
the defense reacts each phase. Check it makes rugby sense: passes can be thrown (receiver behind
the ball), kicks are realistic lengths with chasers who can arrive onside, spacing is honest,
defenders react rather than watch, and the back three sit deep against a kicking play.
`references/rugby-patterns.md` has the shapes and distances (field zones, depth, kick types,
chase layers, drift/blitz/umbrella). If the user's description has a problem - a forward pass
baked into the shape, a chaser who can't exist, a kick from the wrong zone - say so plainly and
offer the nearest version that works. Don't silently build nonsense.

### 3. Build

- Start phase 1 from the closest template in `assets/templates/` (backline-attack for ruck plays,
  attack-vs-defense for ball-in-hand vs a line, scrum, lineout, kick-off), shifted to the right
  spot on the pitch. Keep all 30 players for set pieces and anything with a defense; 15 only when
  the user wants attack-only shape work. `assets/examples/` holds two finished, validated plays
  (a bomb with a full chase, and a rush-beating grubber with A/B options) - pattern-match against
  them when unsure how something should look in JSON.
- Author phase 1 completely (positions, objects, routes). For later phases author only
  note/instructions/cues/routes (leave `positions: {}`, `objects: []` unless adding/removing a
  marker), then run `node scripts/build_phases.mjs play.json` - it computes every later phase's
  positions and ball exactly as the app would, so nothing can drift. Route points still start
  where the mover stands at that phase's start, so build phase by phase: write phase 1, build,
  read the printed phase 2 positions, write phase 2's routes, build again, and so on - or compute
  the ends yourself and let the script confirm.
- The rules that trip people: passes flat or backwards where the passer actually is at release
  (after their runs), not where they started; a pass's stored second point is the receiver's
  start-of-phase spot; options A/B share one order with A as the plan; a kick leaves after its
  kicker's run in the same order; chasers must start level with or behind the kicker.

### 4. Coaching layer

Give each player who matters a one-line job per phase (`instructions`, max 120 chars, imperative:
"Shut the inside door off the catch"). Skip players whose auto-generated job already says it.
Add 1-2 cues per play at the decisive moments (`cues`, max 30 chars, step must be one of the
phase's route orders). For a defense play, jobs and cues go to the d-players. Each phase's `note`
is the coach's caption, readable aloud.

### 5. Validate - every time, before handover

```
node scripts/validate_play.mjs play.json [--repo <path to rugby-play-designer checkout>]
```

Fix every ERROR and rerun until clean; read the warnings and fix the ones that are real (an
intentionally removed ruck marker is fine; an offside chaser is not). With `--repo` (or run from
inside the repo) it also loads the play through the app's own parser. Never hand over a play that
hasn't passed.

### 6. Hand over

Give the user: the `.json` file; how to load it (File → Paste play... and Import as a new play, or
File → Load file...; "Replace the open play" when this fixes a play already open); and a short
coach's summary - what the play is for, when to call it, what each key player must get right, and
anything assumed or changed from their description and why. If a browser is available, offer to
import it and watch the animation; what looks wrong in motion (overlaps, a late chaser, frozen
defenders) gets fixed and re-imported with "Replace the open play".
