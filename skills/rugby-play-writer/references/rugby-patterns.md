# Rugby patterns for play writing

Practical numbers and shapes for plays that make rugby sense in the Rugby Play Designer. All
coordinates follow the app: metres, attack plays towards x = 110, y = 0 and 70 are the touchlines.
The layouts here match the app's own presets (ai-play-guide.md section 4); copy those numbers for
phase 1 and spend your judgement on the routes.

## Field zones: what to call where

- Own 22 (x < 22): exits. Box kick, long clearance, up-and-under. No fancy strike moves here.
- Own half (x 22-50): pressure kicks (bomb, box), one-pass carries, territory.
- Their half (x 50-78): strike plays, grubbers and cross-field kicks behind a rush, wide shifts.
- Their 22 (x > 78): close-range power (pods, picks), set-piece strikes, cross-field to the wing.

A ruck's open side is the side with more grass: from y, the open side is towards 70 if y < 35,
towards 0 if y > 35. Put the backline on the open side, guards (6, 7, 8) on the short side.

## Depth and spacing (attack, off a ruck at (rx, ry), open side towards +y)

From the Backline attack template (ruck at (50, 20)) - shift everything with the ruck:

- 9 over the ball: ruck + (-3.4, +1.6). Ball at the back: ruck + (-2, +0.9).
- Front pod of 3 (1, 2, 3): 3 m behind the ruck, 2.8 m apart across. Second row (4, 5) 2.5 m
  deeper, in the seams.
- Guards on the short side: 6, 7 about 2.5 m behind the gain line, 8 deeper; 11 on the short wing.
- Backline, each a touch deeper and 7-10 m wider than the last: 10 at ruck + (-9, +13),
  12 (-10.5, +20), 13 (-11.5, +27), 14 (-12.5, +37). 15 deep behind midfield (-18, +25).
- First receiver 8-10 m behind the gain line. Flat means quick but less time; France-style strike
  plays run 10 and 12 flatter (6-8 m), kick plays sit deeper (10-12 m).

Keep everyone 2.5 m or more apart at every phase start and at the ends of runs (the discs are
2.4 m wide). Thread runs through the gaps between defenders; a run through a stationary disc looks
wrong when animated.

## Defensive shapes (defense plays towards -x)

Flat line 3 m off the ruck (x = ruck + 3 from attack's view), ~4.5 m between defenders, 13 in the
line, 9 behind the ruck, 15 sweeping 15-20 m back. Copy the Attack vs defense template's line and
shift it. Match the line to the story:

- Drift: the line slides across (drift routes, 4-8 m, angled to the open side), fullback balances.
  Use against wide shifts. Weakness: inside carries.
- Blitz / rush: 10, 12, 13 fly up (blitz routes, 5-8 m forward, slightly in). Wings often stay up
  too, so the backfield is just 15 and one pendulum wing. Weakness: the space in behind - grubbers
  and chips. Line the blitzing d10/d12/d13 up opposite the attack's 10/12/13; the template's
  generic line is not man-matched, so move them.
- Umbrella: 13 shoots ahead of the line to cut the wide pass while 10 and 12 hold - an arrow shape.
  Use near their own line or against a telegraphed wide ball. Weakness: the 13 channel if the
  shooter misses.

Defenders must react in every phase or the play looks dead: the line drifts/blitzes as the ball
moves, the backfield reshuffles on a kick (catcher to the ball, nearest wing across behind him,
line folding back). For a kicking play, start the back three DEEP: both wings 15-20 m behind the
line and 15 another 5-10 m behind them, not stood in the line.

## Kicks: real distances and shapes

Distances are in the air, from where the kicker stands at release (after any run). The app names
kicks by length (js/jobs.js): < 15 m reads "Grubber", >= 35 m "Long kick", a 9's kick or one from
beside a ruck "Box kick", >= 20 m across and further across than forward "Cross-field kick".

- Grubber: 8-14 m, into the space behind a rushing midfield. Chasers: the nearest two backs.
- Chip: 10-15 m over the line, regather by the kicker or 13.
- Box kick (9, from the ruck): 20-30 m, down the short side, hang time for a contest. One chaser
  (the near wing) contests, the line walks up connected.
- Bomb / up-and-under (10 or 15): 25-35 m, high. One contester arrives at the landing spot.
- Territorial / clearance: 35-50 m, usually to touch or deep corners. Nobody contests; the line
  chases up connected.
- Cross-field: 20-40 m across, to the far wing standing wide. Flat-ish trajectory.

Chase rules that keep a kick honest:
- The main chaser's run ends within a metre or two of where the kick lands, so they arrive.
- A 30 m+ chase run is fine (bombs hang), but give the chaser a head start: their run starts with
  the kicker's step, not after the kick.
- Only players BEHIND the kicker at the kick may chase (offside). Pods standing in front hold
  still that phase and advance in the next one, once the contest has happened.
- Build the chase in layers: contester at the ball, one inside (shuts the inside escape), two more
  connected 10-15 m behind, one sweeper deep for the return kick.

## Set pieces

Copy the guide's section 4 layouts exactly (scrum y 15/35/55, lineout y 5/65, pack lists of 18).
Off a scrum, 9-to-10 is the stock start; the backline strikes with 12 on a crash or 13 wide.
Off a lineout: catch-and-drive (maul), off-the-top to 9 to 10, or a peel - the ball tapped to a
receiver who attacks round the front or the tail with a pod. For a tail peel, 8 or the back
jumper pops to a wrapping forward or 9; the backline holds width as a decoy. After the lineout
wins the ball, phase 2 usually starts the backline move; don't cram catch, transfer and strike
into one phase.

## Phases, options, jobs and cues

- 2-5 phases, one idea per phase, written in the note like a coach talking.
- Options: A is the plan and the next phase follows it. Use B for the read ("if they rush" /
  "if they hold"), same order number, label 25 characters max. Remember the B pass must still be
  legal: check where the passer and receiver actually are when it would leave.
- Jobs (instructions): one short command per attacker who matters, 120 characters max, in the
  team's voice ("Chase flat out, time your jump"). Skip players whose auto-job ("Pass to 12",
  "Hold your spot") already says it. For a defense-category play, write them for the defenders.
- Cues: 1-2 per play at the moments that decide it ("JUMP!", "STAY DEEP", "READ THE RUSH"),
  30 characters max, at a step that exists. Playback slows when one pops, so don't scatter them.

## Mistakes that keep coming back

- Forward pass at release: the receiver stood level at the start drifts in front once the passer
  runs. Check where both stand when the ball leaves, not where they start. Flat France-style
  passes need the receiver clearly behind the passer's run end.
- A second pass/kick from the same player with option null: both play, one after the other.
- Chasers who start in front of the kicker (offside), or whose run stops 10 m short of the ball.
- Defenders frozen while a kick sails over them, or a back three stood flat for a kicking play.
- Phase n+1 positions that don't match phase n's routes - never hand-compute these; author
  phase 1 plus routes and let scripts/build_phases.mjs build the rest.
- Players inside 2.5 m at a phase start or at the ends of runs, and runs drawn through a
  stationary defender's disc.
- A ruck marker left behind after play has moved 30 m on: remove it in the phase where it stops
  mattering (it fades out), or keep it only while the story is still about that ruck.
- A carry that sets a new ruck but the ball stays with the carrier: a phase with no pass or kick
  leaves the ball where it is. Model the tackle-and-place as a short backwards pass from the
  carrier to 9 at the end of the carry phase, add the new ruck marker (a NEW id) in the next
  phase, and remove the old one when it stops mattering.
- Set-piece spacing only holds while the marker does: the lineout's 2.4 m exemption ends the
  moment the lineout marker is removed, so retire the two front lines onside (and apart) in the
  same phase the marker goes. Same idea for a scrum breaking up.
- Shifting a template across the pitch can push the deep players off it: the lineout template's
  backs shifted to a mark on their 22 put the defending 15 past x = 100. After any shift, clamp
  the backfield to the pitch (x -10..110, y 1..69) and to rugby sense.
- Pop pass meant to be caught at pace, but the receiver's run is short: he finishes before the
  ball arrives and catches it standing. Start him deeper or lengthen his run; the validator warns
  about this.
- The app's scrum preset packs 6 on the far side from the put-in. For a "6 breaks on their 10"
  call, swap 6 and 7 in the preset (openside flanker on the ball side) and say so in the summary.
