# Rugby Play Designer

A free, browser-based tool for designing rugby plays: formations, player movements and phase-by-phase animation.

- **Live:** <https://playbook.samuelroiz.com>
- Built in about a week as a personal project.
- **Tech:** plain JavaScript ES modules and SVG, no framework, no build step, hosted on GitHub Pages.
- **Testing:** Node tests for the play logic, plus headless Chrome suites (desktop and phone) that drive the real app.

A browser whiteboard for drawing rugby plays: put attackers and defenders on a pitch, drag them around, draw runs, passes, kicks and other routes, and drop ball, ruck, scrum and lineout markers.

It is plain HTML, CSS, JavaScript (ES modules) and SVG. There is no framework and no build step, and the site needs no npm packages (they are only for the tests). This is **Stage 3**: a play has several phases, every play is kept in a **library** in the browser (see *Your plays*), and a play can be saved to and loaded from `.json` files. A play can start from a template. A phase, or every phase on one sheet, can be saved as a PNG, and the whole play as a PDF. Every change can be undone. The play can be animated phase by phase, and shown full screen in Present mode, with a pen to draw on it. A link can open the play on a given phase.

## Using it

- **Add attack / Add defender**: opens a small picker of the numbers (1–15) that team isn't using yet, with the next free one highlighted. Click a number, or press Enter (or click the highlighted one) for the next free number; Escape or clicking outside closes the picker and adds nobody. Then the status line says *Click where 12 stands*, and one click on the pitch places them there (one undo step). **Escape** instead puts them at their usual spot: each team lined up across the middle of the current view, or, if another player or the direction arrow is on that spot, the nearest clear spot beside it. Anything else done meanwhile (another button, a key) puts them at the usual spot first, so a picked number is never lost. Each team can have up to 15, and the button is greyed out when a team is full. The new player is put in every phase, at the same spot, whichever phase is shown.
- **Drag** players and markers with a mouse, finger or pen. A ball is always drawn above the players, so a player holding it never hides it.
- **Double-click (or double-tap)** a player to change its label, e.g. `10` or `FH`. A small box opens just above the player: **Enter** or clicking anywhere else saves, **Escape** cancels. The app never opens a browser popup (prompt, alert or confirm): questions such as "Delete phase 2?" are asked in its own box, with OK and Cancel.
- **Welcome**: on a first visit to the site in this browser, a Welcome box (styled like About) opens after the page loads: a one-line description, the team logo and *Made for <team name>* (if set), and three buttons: **Try an example** (as in About), **Start from a template** (opens the Templates picker) and **Start blank** (just closes it). **About this project** switches to the About box. Closing it any way (a button, the link, Escape or clicking outside) records under `rugby-play-designer.welcome-seen` in `localStorage` that it was seen, so it doesn't open again in this browser; About is the way to see the information again. It doesn't open by itself on a link to a phase (`#phase=`), in Present mode, or when storage is blocked (quietly, with no message). Like About, opening and closing it doesn't change the play, undo or the autosave.
- **About** at the right end of the top bar (in the **File** menu on a phone) opens a short box about the app, with a link to the source on GitHub. It never opens by itself, and opening or closing it doesn't change the play, undo or the autosave. Escape, **Close** or clicking outside closes it, and it is hidden in Present mode. **Try an example** opens a finished three-phase play, *Example: Scrum 12 crash* (`templates/example.json`, which isn't in the template picker), as a new play in the library, like a template. Then the box closes and the play runs once from phase 1 at 1×.
- **Team logo** (**File → Team logo…**) opens a box to set the team's logo: **Upload image…** (PNG, JPG or SVG, up to 2 MB), an optional **team name** (up to 40 characters), a preview, **Remove logo**, and **Show logo on exports** (on by default). Each change is kept straight away; Escape, **Close** or clicking outside closes the box.
  - The logo shows about 28 px tall left of the play name, in the top left corner in Present mode, and on exports while *Show logo on exports* is on (see *Save image* and *Save PDF*). If a team name is set, the About box says *Made for <team name>* above the GitHub link.
  - Pictures are shrunk to at most 512 px on their long side, keeping their shape (never enlarged). An SVG is cleaned first (scripts, event handlers, outside links and references, `foreignObject` and animation elements are removed) and then drawn to a PNG, so only PNG and JPEG pictures are ever stored.
  - It is a setting of this browser, not of the play: it's kept in `localStorage` under its own key (`rugby-play-designer.team-logo`, as a data URL), and never goes in the play, a saved `.json` file, the autosave, the undo history or the repo. Changing it is not an undo step. If it can't be stored (storage blocked or full), it is still used until the page is closed, and the box and the status line say *Couldn't save the logo setting in this browser.*
  - Until a logo is set in this browser, it uses `assets/sfv-logo.jpeg` with the team name *San Fernando Valley Rugby Club*. **Remove logo**, or uploading another, replaces that default in this browser only; the team name is a separate field. With the logo removed, the top bar, Present mode and every export look as they did without one.
- **? Tips** at the top of the sidebar opens a small popup of editing tips beside it. Clicking anywhere else or pressing Escape closes it. It floats over the page, so it never pushes the toolbar down.
- **The play's name** is at the top left. Clicking it (or its pencil) selects the whole name, so typing replaces it.
- **The status line** under the pitch shows the drawing hint and short messages such as *Saved Blind side.pdf* (a message takes the hint's place for a few seconds, and a new hint, e.g. on picking a route tool, clears the message), and the route key at its right end (see *Layers → Legend*). Nothing is drawn over the field, and the line keeps its height, so the pitch never changes size when a hint appears. On a phone the hint can take two lines, and the route key has a line of its own under it.
- **Layout**: the paddings around the pitch, the top bar, the status line and the phase bar are kept small so the pitch gets as much room as possible. Under 1100 px wide the phase bar drops its longer button labels (*Prev*, *Next*, *Move*, *phase*) and narrows the note, so it takes two rows rather than three. `tests/browser/usability.mjs` measures the pitch at 1080×720 and 1500×780 with the old spacing put back in the page and with the new, and prints both sizes each run. When this was written: 829×483 → 912×532 px at 1080×720, and 1074×626 → 1107×646 px at 1500×780.
- **The sidebar** fits a 1500×780 window without scrolling: the route types sit in two columns (each button its sample over its name), with tighter spacing, so Blitz and Delete are always in view.
- **Routes**: pick a route type, then press on the pitch and drag to where it ends. If you press within 2 m of a player's centre, the route starts from the nearest one: its start snaps onto them, it belongs to them and follows them when they move. That player gets a white ring while you draw (and, with a mouse, while you hover with a route tool), so you can see who it will attach to. Each type has its own colour as well as its line style: run yellow, pass white, kick orange (thick and dotted, with big dots), decoy light grey (thicker than a pass, in short dashes, so it shows on the grass), drift purple, blitz pink. Red and blue are kept for the teams. Every line has a thin dark outline so it reads on grass, white lines and the team colours.
- **Passes and kicks are drawn above the players**, so the ball's path stays visible over a crowd, e.g. a lineout throw drawn as a pass from the hooker down the line. Runs, drift, blitz and decoy stay under the players. Badges are above everything. Pressing a player under a pass still picks up the player: only the line's look is on top.
- **The route tool that's on** is shown near-black with a yellow edge, so it stands out from the others. As soon as one is picked, a hint in the status line under the pitch says what to do: with no player selected, *Drag from a player to draw a run, or click a player first*.
- **Click to draw from a player**: select a player, then pick a route type. A faint preview line runs from them to the pointer, and the hint says *Click where 12's run ends. Click again for another, Esc to stop* (for a pass, *… ends, or on a team-mate*; it says *defender 1* or *attacker 1* when both teams have that number). One click (or tap) on the pitch makes the route from that player. They stay selected and the tool stays on, so you can keep clicking to add more lines from them.
  - For a pass, clicking within 2 m of a team-mate ends the pass on them (they're ringed as you hover).
  - Clicking another player switches the start to them instead of ending the line there (for a pass, only an opponent does this, since a team-mate receives it). Pressing another player and dragging draws a route from them as usual, and they stay selected.
  - **Esc**, clicking the route tool again, or clicking empty pitch with no tool on stops it. Each route is one undo step, and undo keeps the player selected and the tool on.
  - With no player selected, pressing and dragging draws as before. A tap (without dragging) on a player while a route tool is on selects them, which starts click-to-draw.
  - On a phone there's no hover, so the preview shows while your finger is down; the route is made where you lift it.
- **Passes attach at both ends.** If you let go of a pass within 2 m of a team-mate of the passer, its end snaps onto them and they become the receiver (`to`). The receiver is ringed while you draw, as the passer is. A pass ending near an opponent or in open grass has a loose end. When the passer or the receiver moves, the pass follows at both ends. The line stops at the edge of the receiver's disc so the arrowhead shows.
- **Editing a route**: tap or click a route to select it and show its handles. These have large invisible touch areas, so they're easy to grab with a finger.
  - Drag the **end** dot to move where the route ends. For a pass, dropping it within 2 m of a team-mate attaches it to them (ringed while you drag), and dropping it further from everyone detaches it.
  - Drag the **start** dot to move where it begins. Dropping it within 2 m of a player attaches the route to the nearest one (they're ringed while you drag). Dropping it further from everyone detaches it.
  - Drag the yellow **middle** dot to bend the route.
  - Drag the **line** to move the whole route. This only works for routes not attached to a player at either end; attached routes move with their player.

  A tap on a handle that doesn't drag goes through to whatever is under it, such as a player or a badge.
- **Route action bar**: when a route is selected (and no route tool is on), a small bar appears next to it, clear of its handles. It starts with the route's step and the routes that start with it, e.g. *Step 2, together with: pass 9 to 10* (a player's other options are alternatives, so they aren't listed). Then **Label** (options only) opens the option box with the label field ready, **Make main** (options other than A), **Order** opens the order editor (the number box, or the option box at its order field for an option), and **Delete**.
- **Route order**: each route shows a small numbered badge beside its start, placed clear of the players, balls and other badges there. A new pass or kick gets the next number (the next step). A new run, decoy, drift or blitz gets the highest number so far (1 if there's none), so it moves together with the latest step; when it shares that step with other routes, the status line says *Runs with step 2. Change the number to run before or after.* Tap or click a badge to change its number in a small box (Enter or clicking away saves, Escape cancels). Deleting a route doesn't renumber the others. **Play** runs the routes in this order (see *Playing the play*).
- **Badge hover**: with the mouse over a badge, its route gets a white halo and every other route and badge fades, until the pointer leaves the badge. On a touch screen, tapping a badge does the same while its number box is open. It's only a hint: nothing is recorded, and it's off while playing and presenting.
- **Pass and kick options**: when a player has two or more passes and/or kicks in the same phase, they are alternatives, not a sequence. Drawing a second pass or kick from a player who already has one makes both options: the one already there is **A**, the new one **B**, the next **C**, and so on. They all take the order number of the first, and their badges read e.g. *2A*, *2B*. Each option's badge sits on its own route, a short way along it from the passer and just to one side, placed so it is clearly nearer its own route than any other option of that player. Runs and the other route types are never options.
  - **A is the main plan** and draws as normal. B, C … draw a little fainter, in their usual colours.
  - Tap an option's badge to open its box. Its title names the route, e.g. *Option A: Pass to 12* (the receiver's label) or *Option B: Kick*. While it's open that route is highlighted in yellow and the other routes fade, and on a computer the box sits on the side of the pitch away from it. The box has the **order number** (shared by all of that player's options, so changing it changes them all), a short **label** of up to 25 characters (e.g. *if 13 bites*), shown just past the end of the route (as large as a player's number, on screen and in exports), and **Make this the main option**, which makes it A and re-letters the others in their old order. Each save is one undo step.
  - Deleting an option closes the letters up (A, C → A, B). When only one is left it's a normal route again: its letter goes, and its label is no longer shown. Deleting a player removes passes to them, which re-letters the passer's options the same way. Moving a route's start onto another player takes it out of the first player's options and adds it to the new player's as the last letter.
  - **Add phase** and **Insert after** follow option A only (see below). Every export (PNG, all-phases PNG, PDF) shows options and labels as the pitch does. The previous-phase ghost shows only option A of each player, the plan the next phase was built from.
  - Older plays, without option letters, load and work as before. A player in an old play who already has two passes only gets letters when another pass or kick is drawn from them.
- **Set piece**: after choosing Scrum or Lineout (and who has the put-in or throw), the status line says *Click where the mark goes*, and the next click on the pitch places it there (one undo step), snapped as below. **Escape** (or anything else done meanwhile) cancels it. Each set piece always reuses the phase's ball nearest the mark, moving it into place, and only adds one if the phase has none.
- **Set piece → Scrum**: puts players 1–8 of both teams in a scrum formation: front row 1-2-3, locks 4-5, flankers 6-7, 8 at the back, each loosehead facing the opposing tighthead. Both 9s go on the put-in side: the put-in team's 9 next to the ball, the other 9 by their own pack. Players 1–9 that already exist are moved rather than duplicated, so a team never goes over 15. The 9s are part of the scrum and move with it. The ball is placed on the put-in side as an ordinary ball you can select, move or delete. The **S** block only shows while the scrum or one of its players is selected. Drag it to move the whole scrum, along with a ball at the scrum. The mark (where you click, or where you drag it) snaps across the pitch to the nearest of the left 15 m line, the middle or the right 15 m line; along the pitch it can go anywhere in the field of play. Players can still be dragged one at a time afterwards. Running the preset again moves the same players to the new scrum.
- **Set piece → Lineout**: forms the lineout where you click, using the phase's lineout marker (one is added if there isn't one). The marker snaps to the 5 m line of the touchline nearer the click, and its position along the pitch is the line of touch. It's the same formation as the Lineout template: 1, 4, 3, 6, 5, 8 and 7 of each team in two lines from 5 m in (attack on the side nearer their own try line), the throwing team's hooker on the touchline, the other hooker in the 5 m channel, and both 9s behind the lineout. The ball nearest the marker moves to the thrower (one is added if there's none). As with the scrum, players that exist are moved, not duplicated. It works at either touchline.

  The lineout then moves as a group, like the scrum. While the marker or one of its players is selected, an **L** block shows beside the defense's line. Drag it, or the marker itself (its half nearer touch), to move every player the preset placed, along with the ball at the thrower. It moves along the touchline only: it stays on the 5 m line of its own touchline, and far enough in for both lines to stay in the field of play. To set up at the other touchline, run the preset again and click by that touchline. Players can still be dragged one at a time afterwards and keep their offset. Running the scrum preset takes its players out of the lineout's group (and the other way round), so no player belongs to both. A lineout marker added on its own, without the preset, drags freely and moves nobody.
- **Select** by clicking a player, route or marker. **Delete** (key or button) removes it. **Esc** clears the selection and the route tool.
- **Full / Half** switches the view. Half shows exactly one half, touchline to touchline, and the pitch is sized to fill the space without showing any extra field. Switching to Half shows the half where most of the shown phase's players are: halfway (x = 50) to the dead ball line (x = 110), the half attack plays into, or the dead ball line at x = −10 to halfway (on a tie, the first). While in a half view, **⇄ Other half** beside Full / Half flips to the other one. The choice is kept in the play's `view` (`"half"` or `"half-own"`), so it's saved and undoable like other view changes. A player off the shown half gets a small arrow at the edge (halfway), in their team's colour with their number, pointing the way to them.
- **Horizontal / Vertical** turns the pitch. Vertical puts the try lines at the top and bottom, with x = 110 at the top. Only the view turns: the data stays the same, and numbers, labels and badges stay upright. It starts vertical on a phone held upright and horizontal otherwise, and follows the phone as it turns until you pick one yourself. Turning the pitch, by hand or by itself, is not an undo step: it doesn't clear Redo, and Undo never turns the pitch back.
- **Layers**:
  - *Distances* labels the lines like a real pitch (5m, 22, 10, 50). Halfway is labelled "50" only, and the 10 m labels sit further along their lines (20 m in from touch), so the three don't run together.
  - *Grid* adds a faint 5 m grid.
  - *Legend* shows or hides the route key, at the right end of the status line under the pitch, never over it, in every view and orientation (never shown in Present mode).
  - *Player size*: **Small**, **Medium** (the default) or **Large** scales player discs, their numbers and the route badges (0.8×, 1×, 1.2×). It's a setting of this browser, kept in `localStorage` (`rugby-play-designer.player-size`), not in the play, its files, the autosave or the undo history. Saved images and PDFs use the size on screen.
  - *Previous phase* draws the last phase's players as faint dashed outlines with their numbers, and its routes as faint lines in their usual colours, so you can see who moved where. None of it can be clicked, and the ghost routes have no order badges or handles, so they can't be mistaken for the current phase's. Saved images and PDFs never include it.

  - *Direction* shows **Attack** and an arrow in the attack's red near the bottom edge of the pitch, pointing the way attack plays (towards x = 110): right on a horizontal pitch, up on a vertical one. It's included in saved images and PDFs.

  Everything except Grid starts on.

### Templates

A new play (first visit, or **File → New play**) starts as an empty pitch with no players. **Templates** in the top bar opens a picker with a card per template: a small picture of its pitch, drawn from the template's own data, with its name under it. Picking one opens it as a new play in the library, so the play you had stays in Plays and nothing is asked. The template's view (full or half) is used, but it takes the orientation you have on now.

The starter templates (attack plays towards x = 110, as always):

- **Blank**: an empty pitch.
- **Backline attack**: all 15 attackers. A ruck 20 m in from the left touchline with 9 at it, the forwards in a pod off the ruck (two guarding the short side), and the backs in a flat-ish line out to 14 on the open side, with 11 on the short side and 15 deep.
- **Attack vs defense**: the same attack, and the defense in a flat line 3 m beyond the ruck, with their 9 behind it and 15 sweeping.
- **Scrum**: both packs and 9s from the scrum preset on the middle spot (attack's put-in), and both backlines 5 m behind their No. 8, on the put-in side, so each 10 stands on the same side of the scrum as their 9 and the 9 to 10 pass never crosses a pack.
- **Lineout**: the lineout preset (see *Set piece → Lineout*) at a marker 5 m in from touch on the attack's 10 m line, with the attack throwing in, and both backlines 10 m back, further infield than the 9s, so 9 to 10 is clear of the lineout.
- **Kick-off**: 10 kicking off from the centre spot with the attack spread behind halfway, and the receiving team spread in their half, 10 m or more back.

Players are discs 2.4 m across, which is wider than a real body, so tight formations (the scrum, the lineout) are spaced to stop the discs overlapping, as in the scrum preset.

#### Making your own template

Templates are ordinary play files in `templates/`, listed in `templates/index.json`:

```json
[
  { "name": "Blank", "file": "blank.json" },
  { "name": "Backline attack", "file": "backline-attack.json" }
]
```

To turn a play into a template, save it from the app (**File → Save file**), copy the `.json` into `templates/` and add a line for it to `index.json`. `name` is what the card shows, and the cards are in the order of the list. The play's own name, category, tags, view, phases, routes and markers all come with it. Templates are fetched from the site, so they work on GitHub Pages and on a local server, but not when `index.html` is opened as a file.

### Phases

The bar under the pitch shows the phase tabs (**1 2 3 … +**), **Prev** and **Next**, the play controls (see *Playing the play*), and "Phase 2 of 4". The **←** and **→** keys also go back and forward.

- **+** (after the tabs) adds a phase at the end, built from the last phase, whichever phase is shown.
- **Insert after** adds a phase straight after the current one, built from it. The phases after it are kept exactly as they were (positions, routes, notes, markers); only their numbers move up by one.
- A new phase is built the same way either way:
  - Each player with a run, drift, blitz or decoy starting on them moves to the end of that route. If a player has several, the highest order number wins.
  - The ball follows the passes and kicks and ends with the highest-order one. Options other than A (B, C …) are left out, so with options the ball follows A. If the phase has more than one ball, the one that moves is the ball nearest the start of the first pass or kick.
    - For a pass, the ball moves to the receiver, where they stand after their own run. The receiver is the pass's `to` player. If the pass has none, it's the nearest team-mate of the passer within 5 m of where the pass lands, with everyone where they stand at that point (after their runs up to the pass's order); if nobody is that close, the ball goes to the end of the pass.
    - For a kick, the ball goes to where the kick ends.
    - With no passes or kicks the ball stays where it is.
  - Routes aren't copied, so the new phase starts with none. Markers (ruck, scrum, lineout, ball) are copied.
  - The animation uses the same rules (they live in `js/model.js`), so it always moves the same ball to the same receiver as the next phase was built with.
- **◂ Move / Move ▸** swaps the current phase with its neighbour. It never changes what is in any phase. **Delete phase** asks first.
- Adding, inserting, moving and deleting a phase are each one undo step.
- The **note** box beside them belongs to the current phase. It keeps a usable width however many phases there are (the phase tabs scroll sideways instead), and grows with a long note to about four lines, wrapping it, before it scrolls. When the tabs, play controls and phase tools don't fit on one row, the tools and note move to a second row; on narrower screens the note gets a row of its own. In Present mode it is the caption under the pitch.
- Players belong to the whole play: deleting a player removes them from every phase, along with their routes and any passes to them, and takes them out of any scrum or lineout group.

### Playing the play

**Play** in the phase bar animates the play from the phase shown through to the last one.

- Within a phase, the routes run in badge order. Routes with the same order number start together; order 2 starts once everything in order 1 has finished.
- A player with a run, drift, blitz or decoy moves along the route's curve to its end. A player with two such routes does them one after the other.
- The ball travels along each pass or kick, starting once the passer has finished their own movement in that order step (so a player who runs and passes in step 1 runs first, then passes). Before that the ball is carried: a ball within 3 m of the passer at the start of the phase moves with them. A pass to a team-mate (`to`) ends in their hands, even if they're running. If a phase has a pass but no ball marker, a ball is drawn for the animation only.
- Only option **A** plays. B, C … stay faint and never move (in Present mode another option can be played, see below).
- A route's order badge disappears as soon as that route starts moving, and comes back when the play stops or another phase is shown.
- Then a short slide moves everyone, including players with no route, and the markers (ball, ruck …) to exactly where they are in the next phase, and that phase's routes play. Markers that aren't in the next phase fade out on the way.
- **Play / Pause**: the button (*▶ Play* / *⏸ Pause*, the icon first with the same gap before the label, in the phase bar and in Present mode) or the **space bar**. Pausing freezes the exact frame on screen, with Loop on or off, mid-route or mid-slide, and Play carries on from that moment. The frame gives way to the phase as it really is (so editing always uses real positions) when the play is changed, another phase is shown, or an edit starts: a press on the pitch, a new selection, or a route tool picked. After the last phase it stops on the last phase's final frame, and (with Loop off) the status line says **End of play** with a **Replay** button, until the play is edited, another phase is shown, or Play is pressed. Replay, or Play, starts again from phase 1.
- **Loop**: after the last phase, the play holds it for 1.5 seconds, then everyone slides back to their places in phase 1 (no jump) and it plays again. Turning Loop on or off while the last phase is showing keeps the frame where it is.
- **Step back / forward one phase**: **Prev** / **Next**, or the **←** / **→** keys (in Present mode, ‹ and ›; ⏮ goes back to phase 1). While playing, it carries on playing from the start of that phase; while paused, it just shows it. Clicking a phase tab works the same way. None of these (nor a `#phase` link) change the phase in the middle of a drag.
- **Speed**: 0.5×, 1× or 2×. 1× is an easy pace to follow on a TV (what used to be 0.5×): a run goes at about 3.5 m/s, a pass at 9 m/s and a kick at 11 m/s, within limits so that very short and very long routes stay watchable.
- While playing, editing is locked: nothing on the pitch can be dragged or drawn, and the tools, undo and redo (buttons and keys), Templates and the phase editing buttons are greyed out. The File menu, the play name, category and tags can't be used with the mouse or the keyboard (the menu is inert and the boxes are disabled, so Tab skips them), and the note can't be typed in. The previous-phase ghost is hidden. Pause (or the end of the play) returns to normal editing on the phase it stopped at. **Esc** pauses.
- Each animation frame only moves the players and markers whose place has changed (it uses `requestAnimationFrame`).

### Present mode

**Present** in the top bar shows the pitch alone, for a TV or a screen recording: full screen (when the browser allows it), with the toolbar, top bar, status line, phase bar and route key hidden, and the pitch as large as fits. The phase's note is a large caption under the pitch, always shown in full (the pitch gets smaller for a long note), and *Phase n of N* sits in the top right corner. The team logo, if there is one, sits small in the top left corner, clear of the caption and the controls.

- The play controls (⏮ to phase 1, ‹ previous phase, Play/Pause, › next phase, speed, Loop) sit between the pitch and the caption, with **I play**, **Pen**, the pen colours, **Undo stroke**, **Clear** and **Exit**, so they never cover the pitch or the note. They fade out (and so does the mouse pointer) after 2 seconds without mouse movement, and come back when the mouse moves. The keys work as usual: **Space**, **←** / **→**.
- **Option A / B / C**: when the phase shown has pass or kick options, a button for each appears. **Option B** plays that phase with B instead of A, so the ball follows B (B draws as the main option meanwhile), and stops at the end of the phase, since the next phase was built from A. **Option A**, the default, plays on as usual.
- **I play**: click a player on the pitch (or pick one from the list) and the rest of their team, with their routes, fades; the opposition stays at full strength. The chosen player gets a yellow ring. Clicking them again (or **None** in the list) clears it. It stays on through Play and phase changes, and goes when you leave Present mode.
- **Pen**: **P** (or the Pen button) turns on a freehand pen over the pitch, thick enough to see on a TV. Three colours: black with a white outline (the default), cyan (`#00e5ff`) with a dark outline, and magenta with a white outline; picking one also turns the pen on. None of them is a route's or a team's colour. Picking up the pen pauses the play, so you draw on a still picture. **Undo stroke** (or **Z** while the pen is on) takes back the last stroke. The marks stay, through phase changes, until **C** (or Clear); they aren't saved and go when you leave, and the pen goes back to black.
- Nothing can be edited while presenting: there are no hover hints, handles, selection highlights or tooltips, the ghost is hidden, and undo and redo (buttons and keys) do nothing.
- **Escape** (or Exit) leaves Present mode. Leaving stops the play and drops the paused frame, so editing is unlocked straight away on the phase shown. In full screen the browser's own Escape leaves full screen, and Present mode with it.

### Links to a phase

The address shows the phase being shown, e.g. `…/#phase=3`, and follows it as phases change (including while playing). Opening an address with `#phase=n` starts on that phase (a number past the end opens the last one). The play itself is the one this tab (or, in a new tab, the last one) had open, so the link is for coming back to a phase, or for sharing one together with the play's `.json` file.

### Your plays (the library)

Every play you make is kept in this browser, in a library of plays. **Your plays live only in this browser**, on this device: they aren't sent anywhere, there's no account, and clearing the browser's site data (or using another browser or device) means they aren't there. **Plays → Back up all plays** is how to keep them safe, or to move them to another device: it downloads one file with all of them, which **Restore from backup…** reads back in.

- **Storage**: plays are stored in IndexedDB, one record per play (an id, the play, the phase last shown, when it was created and last edited, and when it was deleted, if it's in Recently deleted). Where IndexedDB isn't available, localStorage is used instead (one key per play, `rugby-play-designer.play.<id>`). If neither can be used (storage blocked), the plays last until the page is closed, and the status line says *Plays can't be saved in this browser (storage is blocked). Use Plays → Back up all plays to keep your work.*
- **The open play is always one of the library's plays.** It's saved to its entry shortly after every change, and straight away when the page is hidden or closed. If a save fails because storage is full, the play stays on screen and in the library for this visit, and the status line says *Couldn't save: this browser's storage is full. Your play is still here: use Plays → Back up all plays to keep it.* Each tab remembers which play it has open, so a reload brings that one back; a new tab opens the last play opened in any tab.
- **First run**: a browser that used the designer before the library had one autosaved play (`rugby-play-designer.autosave` in localStorage). It's moved into the library as a play and opened, so nobody loses their current play; the old key is removed once it's safely stored. If it can't be read, it's kept under a backup key (`rugby-play-designer.autosave-backup`), a blank play opens, and the status line says *Your last play couldn't be opened. A backup was kept.* (The same message shows if a play can't be drawn when the page loads: it stays in the library and a blank play opens.)
- **Nothing is ever replaced by accident**: **File → New play**, choosing a template, **Try an example** and **Load file…** each make a new play in the library and open it, without asking, and the play you had stays in Plays as it was. (If the play you had is a completely empty *Untitled play*, it isn't kept, so the list doesn't fill up with empty plays.)
- **Plays** in the top bar (in the **File** menu on a phone) opens the list of every play, most recently edited first. Each row has a small picture of phase 1, the name, the category, the tags, how many phases and when it was last edited; the open play is marked *Open now*. A search box (names and tags) and a category filter narrow it. Each row has:
  - **Open** (or click the row): opens it, with a fresh undo history (the play you leave is saved first).
  - **Duplicate**: adds *<name> copy* to the list.
  - **Rename**: the name becomes a field in the row; Enter or clicking away saves, Escape cancels. Renaming the open play is an ordinary edit (one undo step).
  - **Delete**: moves it to **Recently deleted**, at the bottom of the list (collapsed), with **Restore** and **Delete forever** (which asks first). The last 20 deleted plays are kept; older ones go for good. Deleting the open play opens the most recently edited other one (or a new blank play).
- **Back up all plays** downloads `rugby-plays-backup-YYYY-MM-DD.json`, with every play in the library, Recently deleted ones marked as such. **Restore from backup…** reads such a file, checks every play like Load file does, and **adds** them to the library; it never changes a play that's there. A play whose id is already here is skipped if it's the same, or added with a new id and *(restored)* after its name if it differs. It then says what happened, e.g. *Added 12 plays, 2 skipped (already here)* (and how many couldn't be read, if any).
- **Two tabs**: they share the library, and each tab's Plays list follows changes made in the other. Tabs with different plays open never get in each other's way. If another tab changes the play open in this one, this tab asks *This play was changed in another tab*: **Use theirs** loads it (one undo step), **Keep mine** saves this one again. Nothing is saved here while the question is open. Another tab only moving between phases or turning the pitch doesn't count as a change.

### Undo and files

- **Undo / Redo** (top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) covers every change to the open play, including phases, labels, order numbers, name, note and details. Opening another play (from Plays, New play, a template, the example or Load file) starts a fresh undo history. A whole drag is one step, and so is a burst of typing in one box. Up to 200 steps are kept, fewer if the history would pass about 20 MB (the oldest go first). Turning the pitch isn't a step (see *Horizontal / Vertical*), and nor is anything that only shows a hint (hovering, the click-to-draw preview, rings). Undo and redo do nothing while playing, presenting or making a picture. History is cleared on refresh.
- The **File** menu holds the play's details (*category*: attack, defense, lineout or scrum; *tags*, comma separated) and:
  - **Plays…** (on a phone): the Plays list (see *Your plays*).
  - **New play**: opens a new blank play (the one you had stays in Plays).
  - **Save file**: downloads the play as `<play name>.json`. The name is cleaned of characters that aren't allowed in file names, and the JSON is pretty-printed.
  - **Load file…**: reads a `.json` play. It checks the file has `schemaVersion`, `players` and `phases`, and shows a short error if not. Every other field is checked too, and one of the wrong type is dropped or given its default, so a damaged or hand-edited file can't break the app (see *Coordinates and data*). It opens as a new play in the library (the one you had stays in Plays), and the status line says so.
  - **Save image (PNG)…**: asks *This phase* or *All phases*.

    *This phase* is the phase being shown, at twice its size on screen, in the current view and orientation, with the layers that are on (distances, grid, direction). If the Legend layer is on, the route key goes in a white strip under the pitch, never on it. With a team logo and *Show logo on exports* on, the logo sits in the top right corner, about 8% of the picture's width, in a white strip above the pitch (never on it). The previous-phase ghost, selection highlights and handles are always left out. It is named `<play name>-phase-<n>.png`. On a phone or tablet it opens the share sheet instead of downloading (on iPhone, *Save Image* puts it in Photos). If the share sheet can't open, the picture is shown in a box: press and hold it to save, or use *Open in new tab* or *Share…*.

    *All phases* is one PNG with the play name at the top (and the team logo, if it's shown on exports, in the top right corner at about 8% of the width, with the title row made taller so it never reaches a pitch) and every phase in a grid: one pitch per row for a horizontal play and 2 per row for a vertical one (or 1, for a single phase), so the pitches, players and badges are drawn large. Each tile is "Phase n" over the pitch, with the phase's note under it, cut to two lines with "…". The route key goes once under the grid (never on a pitch), if the Legend layer is on. Like the other pictures, it has no ghost, highlights or handles. It is named `<play name>-all-phases.png`, and goes to the share sheet on a phone or tablet, with the same fallback box. A play with a great many phases is drawn smaller so the picture stays under the size phones can make.
  - **Save PDF (all phases)**: downloads `<play name>.pdf` straight away (no print dialog), with one A4 page per phase. Each page has a header line with the play name on the left (with the team logo just left of it, if it's shown on exports) and its category and tags (e.g. *Attack · backs, set move*) on the right. Then comes the pitch picture, as large as fits: the full page width on a horizontal play, and the height left on a vertical one. It's made the same way as the PNG, so it has no ghost or handles, but its lines and distance labels are dark so they survive black and white printing (the screen keeps white lines). Under the pitch, "Phase n of N" is on the left and the route key on the right (if the Legend layer is on), then the phase's note. Horizontal plays get landscape pages and vertical ones portrait. A very long note is cut short with "…". The PDF's built-in font only covers Western European letters, so a name or note with anything else (macrons such as *ā*, other alphabets, emoji) is drawn as a picture of the text instead. On a phone or tablet it goes to the share sheet like the PNG (*Save to Files* on iPhone); if that can't open, a box offers *Open in new tab* and *Share…*.

    The PDF is made with [jsPDF](https://github.com/parallax/jsPDF) **4.2.1** (MIT licence), kept in the repo as `vendor/jspdf.umd.min.js` with its licence in `vendor/jspdf.LICENSE`. It isn't fetched from a CDN, and it is only loaded the first time you save a PDF, so ordinary page loads don't download it. To update it, replace both files from the `dist/jspdf.umd.min.js` and `LICENSE` of the new npm package and change the version here.

  Every save and export shows a short message in the status line, e.g. *Saved Blind side.pdf*. A PDF says *Making the PDF…* while it's being made. Each picture is made from a copy of the play taken when you ask for it, and editing is locked (as while playing) until it's ready, so a change can't end up half in it.

  Loading a play (from a file, a backup or the library) also repairs it: a player missing from a phase is given their spot from the nearest earlier phase, or the nearest later one if there is no earlier one. Older versions could leave a player out of some phases, e.g. one deleted and added back while on phase 1.

## Running it locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>.

## Running tests

The site needs no packages. The packages in `package.json` are dev-only, for the headless browser tests.

```sh
npm install   # once: puppeteer (downloads its own Chrome) and pdfjs-dist
npm test
```

`npm test` serves the repo on a free local port, then runs:

- `tests/*.test.js`: Node tests for the phase logic (building, adding, inserting and moving phases), the shared rules in `model.js` (the next phase and the animation agree on the ball and the receiver, chosen options, Loop's hold, the 1× pace), the animation timing and frames, pass/kick options, the undo history (200 steps, the size limit, turning the pitch), checking loaded files (every optional field with the wrong type), the play library's backup file and restoring from it, and the templates (each loads like a saved play; 9 to 10 clears the pack in the scrum and lineout; the About box's example loads, each of its phases is built from the one before by the Add Phase rules, and its passes are flat or backwards), set pieces placed at a click reusing the nearest ball, and the order number a new route gets. They need nothing but Node 22 or newer, so you can also run them alone with `node --test tests/*.test.js`. `tests/anim-play.mjs` is the small play the animation tests share.
- `tests/browser/suite.mjs`: headless Chrome on desktop and phone (touch). Any native browser dialog (prompt, alert, confirm) fails the run. It covers dragging, routes and passes, ghost routes, phases, undo/redo, autosave, save/load, templates and the picker, the number picker, renaming, set pieces, the direction arrow, badge placement (including option badges on their own routes), the option box title and highlight, the route action bar, passes and kicks drawn above the players, kick lines, renaming the play, the status line and Tips popup, the phase bar with many phases, tool hints, and the PNG (one phase and all phases) and PDF exports and their messages.
- `tests/browser/clickdraw.mjs`: click-to-draw routes from the selected player, and pass/kick options (lettering, deleting, labels, making one main, Add Phase following A, ghost and exports).
- `tests/browser/playback.mjs`: animation order (same-order routes start together, the ball leaves after the passer's run, order 2 waits), option B never animating, positions at the end of a phase's animation matching the next phase exactly, Play/Pause, step, speed and Loop with their buttons and keys, editing locked while playing and back after pausing, Present mode entering and leaving (layout, caption, corner count, nothing selected, controls fading), the I-play fade, the pen drawing and clearing, and `#phase` in the address. Then the coach-test fixes: Pause keeping the exact frame with Loop on, Loop's hold and slide back, the 1× pace, badges going as routes move, no legend in Present mode, ⏮ ‹ ›, the Option buttons, the pen pausing and keeping its marks, I play by clicking, the controls never covering a long caption, Exit stopping the play, and the Scrum template's 10s.
- `tests/browser/about.mjs`: the About box: where its button is (the top bar, or the File menu at 390 px), its text and GitHub link, closing it with Escape, Close and a click outside, hidden in Present mode, opening it changing nothing in the play, undo or autosave, and Try an example (opening it as a new play without asking, the play before kept, playing once at 1×).
- `tests/browser/welcome.mjs`: the Welcome box: it opens on a first visit and not on the next one, nor with `#phase=` in the address, in Present mode or with storage blocked; its text, logo and team line; each button (Try an example, as a new play with the play before kept; Start from a template; Start blank), the About this project link, Escape and a click outside, each recording it was seen and changing nothing in the play, undo or autosave; and the Play / Pause button's icon and label separated, icon first, at desktop, Present mode and 390 px phone widths. Every other suite marks the box as seen when it opens the page, so it never gets in their way.
- `tests/browser/usability.mjs`: the usability review fixes. At 1080×720 and 1500×780 it measures the pitch with the old spacing put back and with the new, checks it's bigger and fills its area, the phase bar's rows, and that the sidebar fits at 1500×780 with Delete and Blitz in view and the route types in two columns. Then the player size (each size, not in the play, undo or autosave, kept after a reload, used by the PNG), the decoy's look, the legend under the pitch in every view and orientation and hidden in Present mode, the pen colours (none a route or team colour), Undo stroke and Z, players placed by a click (Enter too), Escape's usual spot kept clear of other players and the direction arrow, set pieces placed by a click with the ball reused and Escape cancelling, the half views (which half, the toggle, the edge arrows, undo and reload), the badge hover and tap highlight, the order of new routes with the hint and the route bar's step text, and End of play with Replay; and a short check on a 390 px phone.
- `tests/browser/library.mjs`: the play library: the old autosave moved in on first run (once), New play, a template, Try an example and Load file each making a new play with the one before kept, the Plays list (order, thumbnails, details, the open play marked), search by name and tag, the category filter, Open (button and row) with a fresh undo history, Duplicate, Rename (Escape and Enter, and the open play), Delete, Restore and Delete forever, deleting the open play, Back up all plays, Restore from backup (skipped, *(restored)* copies, new plays, an invalid play, a file that isn't a backup), Recently deleted keeping 20, a reload, storage blocked, and Plays from the File menu on a 390 px phone. The tests reach the library through the test hook `window.rugbyLibrary`.
- `tests/browser/logo.mjs`: the team logo: the default logo and team name (top bar, About, the box, exports), uploading PNG and JPG and shrinking them to 512 px, small pictures not enlarged, files over 2 MB and other types refused, the preview, the team name in About (and its 40 character limit), Remove logo (and the default not coming back after a reload), Present mode's corner logo, storage failing, the logo never getting into the play, a saved file, the autosave or the undo history, a malicious SVG cleaned (no scripts, handlers or outside fetches) and stored as a PNG, and the PNG, all-phases PNG and PDF having the logo only while *Show logo on exports* is on.
- `tests/browser/stability.mjs`: damaged files (the wrong type in every optional field), empty and one-phase plays through Play, Present, PNG and PDF, a broken old autosave on startup (unreadable, and one whose first drawing fails), two tabs with the same play and with different plays, full storage, phase changes during a drag and a drag whose route vanishes, the paused frame giving way to edits, undo and the details locked while playing and presenting, turning the pitch without an undo step, the route bar's Order on a route with no order, deleting a scrum player, hover redraws recording nothing, one redraw per frame while dragging, and exports made from a copy with editing locked. The animation clock is stopped with the test hook `window.rugbyPlayback.timeScale = 0` and moved on with `rugbyPlayback.advance(ms)`, so these checks don't wait in real time; one run at `timeScale = 20` checks that it also plays by itself.

Downloads and screenshots go to a temporary folder; the path is printed at the start of each suite. To use your installed Chrome instead of puppeteer's, set `PUPPETEER_EXECUTABLE_PATH`, for example `PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm test`.

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, then pick your branch (e.g. `main`) and the `/ (root)` folder. Save.
4. After about a minute the site will be live at `https://<user>.github.io/<repo>/`.

All paths are relative, so the site also works from a project sub-path.

## Layout

```
index.html       page shell: top bar, toolbar, SVG
styles.css       layout (the toolbar moves to the bottom on phones) and SVG styling
js/app.js        play state, toolbar and phase bar wiring, redraw (which also records undo steps and autosaves)
js/pitch.js      pitch markings and screen-to-metre conversion
js/editor.js     dragging, drawing routes and editing them with handles, selecting
js/setpiece.js   scrum and lineout presets: formations, snapping the mark, moving each set piece's players and ball together
js/model.js      the shared play rules: route curves, ball routes, ids, rounding, which ball moves and who catches it
js/phases.js     building the next phase (players follow their runs, ball follows option A's pass or kick); add, insert, move
js/animate.js    animation timing and frames, as pure functions of the play and a time
js/playback.js   Play/Pause, speed, Loop, a chosen option; draws each frame by moving only what changed
js/present.js    Present mode: full screen layout, controls that fade, I play, the pen
js/options.js    pass/kick options: lettering A, B, C, closing up, making one the main option
js/history.js    undo/redo by snapshots of the play (200 steps, about 20 MB)
js/storage.js    saving and loading .json files, checking and repairing loaded plays, reading the old autosave
js/library.js    the play library: IndexedDB (or localStorage, or memory), keeping tabs in step, backup and restore
js/plays.js      the Plays panel: the list, search, filter, open, duplicate, rename, delete, Recently deleted
js/export.js     PNG of a phase, PNG of all phases in a grid, PDF of all phases (loads jsPDF on first use)
js/templates.js  fetching templates/index.json, the template plays and the About example, picker thumbnails
js/logo.js       the team logo setting: localStorage, reading and shrinking uploads, cleaning SVGs, the logo for exports
assets/          sfv-logo.jpeg, the default team logo
templates/       starter templates (play files) and index.json listing them; example.json, the About box's example
vendor/          jsPDF 4.2.1 (jspdf.umd.min.js) and its licence
tests/           *.test.js Node tests (phases, model rules, animation, options, history, loading files, templates);
                 anim-play.mjs, their shared play; run.mjs (npm test); browser/ headless Chrome suites
plays/<category>/  for saved plays (later stages)
```

## Coordinates and data

Everything is in metres. The SVG `viewBox` is in metres too.

- `x`: 0–100 between the try lines. In-goal runs from −10 to 0 and from 100 to 110.
- `y`: 0–70 from touchline to touchline.

The whole play is a single state object, exposed as `window.playState` for debugging:

```json
{
  "schemaVersion": 1,
  "name": "Untitled play",
  "category": "attack",
  "tags": ["backs", "set move"],
  "view": "full",
  "orientation": "horizontal",
  "players": [{ "id": "a10", "team": "attack", "label": "10" }],
  "phases": [{
    "note": "",
    "positions": { "a10": { "x": 58, "y": 25 } },
    "objects": [
      { "id": "o1", "type": "ball", "x": 60, "y": 25 },
      { "id": "o2", "type": "scrum", "x": 40, "y": 15, "putIn": "attack", "pack": ["a1", "a2", "…", "d8"] }
    ],
    "routes": [
      { "id": "r1", "type": "run", "from": "a10", "points": [[58, 25], [66, 29]], "curve": 0, "order": 1 },
      { "id": "r2", "type": "pass", "from": "a10", "to": "a12", "points": [[58, 25], [60, 35]], "curve": 0, "order": 2 }
    ]
  }]
}
```

- Player ids are `a1`–`a15` (attack) and `d1`–`d15` (defense). `label` is what gets drawn.
- A route's `from` is a player id, or `null` if it was drawn from open grass. A pass also has `to`: the receiver's id, or `null` for a loose end. Its last point sits on the receiver. Loading a play sets a `from` or `to` that names a player who isn't in the play to `null`.
- `curve` is how far, in metres, the middle of the route is pushed sideways from the straight line between its first and last point. Positive bends to the right of the direction of travel, as seen on screen. The route is drawn as a quadratic Bézier.
- A pass or kick that is one of a player's options has `option`: `"A"`, `"B"`, `"C"` …, and may have `optionLabel`, a string of up to 25 characters. Other routes have `option: null` (or no `option`, in older plays). A player's options in a phase share one `order`.
- A route's `order` is a whole number from 1 to 99 and sets the order routes run in. A new pass or kick gets one more than the highest existing order; a new run, decoy, drift or blitz gets the highest (1 if there's none). Numbers can repeat, and gaps are fine. Routes without `order` (older data) simply show no badge; **Order** in the route bar gives one the next number.
- Loading checks every optional field, and drops it (or uses its default) if it's the wrong type: `option` (a single capital letter, passes and kicks only), `optionLabel` (text, cut to 25 characters), `order` (a whole number of 1 or more), `curve` (a finite number, else 0), `pack` (a list of ids of players in the play), `putIn` and `throwIn` (`"attack"` or `"defense"`), `tags` (text only), `name` (cut to 60 characters) and `note` (text). Positions of players who aren't in the play are dropped, and missing or broken ones are filled in.
- `orientation` is `"horizontal"` or `"vertical"`. It only changes how the pitch is drawn: all coordinates stay in the same pitch metres. Vertical is a quarter turn anticlockwise, so pitch (x, y) is drawn at SVG (y, −x).
- A lineout made with the preset has `throwIn` (`"attack"` or `"defense"`) and `pack`, the ids of the players that move with it; its `y` is always 5 or 65. A plain `lineout` marker without `pack` is just a marker.
- A scrum made with the preset has `putIn` (`"attack"` or `"defense"`) and `pack`, the ids of the players that move with it. Its `x, y` is the mark between the front rows, with `y` always 15, 35 or 55. A plain `scrum` object without `pack` (older data) still draws as an "S" marker.
- `category` is one of `attack`, `defense`, `lineout` and `scrum`. `tags` is a list of strings.
- `phases` is in play order. Each phase has its own `note`, player `positions`, `objects` (markers) and `routes`. Players are listed once, in `players`, and every player has a position in every phase (loading fills in any that are missing).
- The team logo and team name are a setting of the browser (see *Team logo*), never part of a play.
- Which phase is being shown (also in the address as `#phase=n`), the layer checkboxes, the play speed, Loop and chosen option, Present mode and its pen drawings, and the undo history are view settings and aren't part of the play. The library stores the shown phase alongside the play. `orientation` is saved with the play but is a view choice too: turning the pitch is not an undo step.
- `schemaVersion` is still 1: `tags` and the newer fields are optional, and older plays load as they are.
