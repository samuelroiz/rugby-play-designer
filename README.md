# Rugby Play Designer

A browser whiteboard for drawing rugby plays: put attackers and defenders on a pitch, drag them around, draw runs, passes, kicks and other routes, and drop ball, ruck, scrum and lineout markers.

It is plain HTML, CSS, JavaScript (ES modules) and SVG. There is no framework, no build step and no npm. This is **Stage 2a**: a play has several phases, and it is autosaved in the browser and can be saved to and loaded from `.json` files. A phase can be saved as a PNG, and the whole play as a PDF. Every change can be undone. Animation comes later.

## Using it

- **Add attack / Add defender**: adds the next free number (1–15) near the middle of the current view. Each team can have up to 15. The new player is put in every phase, at the same spot, whichever phase is shown.
- **Drag** players and markers with a mouse, finger or pen.
- **Double-click (or double-tap)** a player to change its label, e.g. `10` or `FH`.
- **Routes**: pick a route type, then press on the pitch and drag to where it ends. If you press within 2 m of a player's centre, the route starts from the nearest one: its start snaps onto them, it belongs to them and follows them when they move. That player gets a white ring while you draw (and, with a mouse, while you hover with a route tool), so you can see who it will attach to. Each type has its own colour as well as its line style: run yellow, pass white, kick orange, decoy grey, drift purple, blitz pink. Red and blue are kept for the teams.
- **Click to draw from a player**: select a player, then pick a route type. A faint preview line runs from them to the pointer, and a hint above the pitch says what to do (e.g. *Click where 12's run ends*; it says *defender 1* or *attacker 1* when both teams have that number). One click (or tap) on the pitch makes the route from that player. They stay selected and the tool stays on, so you can keep clicking to add more lines from them.
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
- **Route order**: each route shows a small numbered badge near its start. New routes get the next number (1, 2, 3 …). Tap or click a badge to change its number. Deleting a route doesn't renumber the others. Stage 3 animation will use this order.
- **Set piece → Scrum**: asks which team has the put-in, then puts players 1–8 of both teams in a scrum formation: front row 1-2-3, locks 4-5, flankers 6-7, 8 at the back, each loosehead facing the opposing tighthead. Players 1–8 that already exist are moved rather than duplicated, so a team never goes over 15. The ball is placed on the put-in side as an ordinary ball you can select, move or delete. Running the preset again reuses a ball already at the scrum instead of adding another. The **S** block only shows while the scrum or one of its players is selected. Drag it to move the whole scrum, along with a ball at the scrum. Across the pitch it snaps to the nearest of the left 15 m line, the middle or the right 15 m line. Along the pitch it can go anywhere in the field of play. Players can still be dragged one at a time afterwards. Running the preset again moves the same players to the new scrum.
- **Select** by clicking a player, route or marker. **Delete** (key or button) removes it. **Esc** clears the selection and the route tool.
- **Full / Half** switches the view. Half shows exactly halfway (x = 50) to the dead ball line (x = 110), touchline to touchline, and the pitch is sized to fill the space without showing any extra field.
- **Horizontal / Vertical** turns the pitch. Vertical puts the try lines at the top and bottom, with x = 110 at the top. Only the view turns: the data stays the same, and numbers, labels and badges stay upright. It starts vertical on a phone held upright and horizontal otherwise.
- **Layers**:
  - *Distances* labels the lines like a real pitch (5m, 22, 10, 50).
  - *Grid* adds a faint 5 m grid.
  - *Legend* shows or hides the route key.
  - *Previous phase* draws the last phase's players as faint dashed outlines with their numbers, and its routes as faint lines in their usual colours, so you can see who moved where. None of it can be clicked, and the ghost routes have no order badges or handles, so they can't be mistaken for the current phase's. Saved images and PDFs never include it.

  Everything except Grid starts on.

### Phases

The bar under the pitch shows the phase tabs (**1 2 3 … +**), **Prev** and **Next**, and "Phase 2 of 4". The **←** and **→** keys also go back and forward.

- **+** (after the tabs) adds a phase at the end, built from the last phase, whichever phase is shown.
- **Insert after** adds a phase straight after the current one, built from it. The phases after it are kept exactly as they were (positions, routes, notes, markers); only their numbers move up by one.
- A new phase is built the same way either way:
  - Each player with a run, drift, blitz or decoy starting on them moves to the end of that route. If a player has several, the highest order number wins.
  - If there are passes, the ball moves to the receiver of the highest-order pass, where they stand after their own run. The receiver is the pass's `to` player. If the pass has none, it's the nearest team-mate of the passer within 5 m of where the pass ends; if nobody is that close, the ball goes to the end of the pass. With no passes the ball stays where it is.
  - Routes aren't copied, so the new phase starts with none. Markers (ruck, scrum, lineout, ball) are copied.
- **◂ Move / Move ▸** swaps the current phase with its neighbour. It never changes what is in any phase. **Delete phase** asks first.
- Adding, inserting, moving and deleting a phase are each one undo step.
- The **note** box beside them belongs to the current phase.
- Players belong to the whole play: deleting a player removes them from every phase, along with their routes and any passes to them.

### Undo, autosave and files

- **Undo / Redo** (top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) covers every change to the play, including phases, labels, order numbers, name, note, details, New play and Load. A whole drag is one step, and so is a burst of typing in one box. At least 100 steps are kept. History is cleared on refresh.
- The play is **autosaved** in this browser (`localStorage`) shortly after every change, and straight away when the page is hidden or closed. It comes back when you reload. If storage is blocked (some private modes), everything else still works; it just isn't kept.
- The **File** menu holds the play's details (*category*: attack, defense, lineout or scrum; *tags*, comma separated) and:
  - **New play**: asks first, then starts a blank play.
  - **Save file**: downloads the play as `<play name>.json`. The name is cleaned of characters that aren't allowed in file names, and the JSON is pretty-printed.
  - **Load file…**: reads a `.json` play. It checks the file has `schemaVersion`, `players` and `phases`, and shows a short error if not. Loading replaces the current play after asking, and can be undone.
  - **Save image (PNG)**: the phase being shown, at twice its size on screen, in the current view and orientation, with the layers that are on (distances, grid, legend). The previous-phase ghost, selection highlights and handles are always left out. It is named `<play name>-phase-<n>.png`. On a phone or tablet it opens the share sheet instead of downloading (on iPhone, *Save Image* puts it in Photos). If the share sheet can't open, the picture is shown in a box: press and hold it to save, or use *Open in new tab* or *Share…*.
  - **Save PDF (all phases)**: downloads `<play name>.pdf` straight away (no print dialog), with one A4 page per phase: the play name, "Phase n of N", the pitch picture (made the same way as the PNG, so no ghost or handles) and the phase's note under it. Horizontal plays get landscape pages and vertical ones portrait. A very long note is cut short with "…". The PDF's built-in font only covers Western European letters, so a name or note with anything else (macrons such as *ā*, other alphabets, emoji) is drawn as a picture of the text instead. On a phone or tablet it goes to the share sheet like the PNG (*Save to Files* on iPhone); if that can't open, a box offers *Open in new tab* and *Share…*.

    The PDF is made with [jsPDF](https://github.com/parallax/jsPDF) **4.2.1** (MIT licence), kept in the repo as `vendor/jspdf.umd.min.js` with its licence in `vendor/jspdf.LICENSE`. It isn't fetched from a CDN, and it is only loaded the first time you save a PDF, so ordinary page loads don't download it. To update it, replace both files from the `dist/jspdf.umd.min.js` and `LICENSE` of the new npm package and change the version here.

  Loading a play (from a file or the autosave) also repairs it: a player missing from a phase is given their spot from the nearest earlier phase, or the nearest later one if there is no earlier one. Older versions could leave a player out of some phases, e.g. one deleted and added back while on phase 1.

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

- `tests/*.test.js`: Node tests for the phase logic (building, adding, inserting and moving phases). They need nothing but Node 22 or newer, so you can also run them alone with `node --test tests/*.test.js`.
- `tests/browser/suite.mjs`: headless Chrome on desktop and phone (touch). It covers dragging, routes and passes, ghost routes, phases, undo/redo, autosave, save/load, and the PNG/PDF exports.
- `tests/browser/clickdraw.mjs`: click-to-draw routes from the selected player.

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
js/setpiece.js   scrum preset: formation, snapping the mark, moving the pack and ball together
js/phases.js     building the next phase (players follow their runs, ball goes to the receiver); add, insert, move
js/history.js    undo/redo by snapshots of the play
js/storage.js    autosave, saving and loading .json files, checking and repairing loaded plays
js/export.js     PNG of a phase, PDF of all phases (loads jsPDF on first use)
vendor/          jsPDF 4.2.1 (jspdf.umd.min.js) and its licence
tests/           Node tests for the phase logic; run.mjs (npm test); browser/ headless Chrome suites
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
- A route's `order` is a whole number from 1 to 99 and sets the order routes run in. New routes get one more than the highest existing order. Numbers can repeat, and gaps are fine. Routes without `order` (older data) simply show no badge.
- `orientation` is `"horizontal"` or `"vertical"`. It only changes how the pitch is drawn: all coordinates stay in the same pitch metres. Vertical is a quarter turn anticlockwise, so pitch (x, y) is drawn at SVG (y, −x).
- A scrum made with the preset has `putIn` (`"attack"` or `"defense"`) and `pack`, the ids of the players that move with it. Its `x, y` is the mark between the front rows, with `y` always 15, 35 or 55. A plain `scrum` object without `pack` (older data) still draws as an "S" marker.
- `category` is one of `attack`, `defense`, `lineout` and `scrum`. `tags` is a list of strings.
- `phases` is in play order. Each phase has its own `note`, player `positions`, `objects` (markers) and `routes`. Players are listed once, in `players`, and every player has a position in every phase (loading fills in any that are missing).
- Which phase is being shown, the layer checkboxes, and the undo history are view settings and aren't part of the play. The autosave stores the shown phase alongside the play.
- `schemaVersion` is still 1: `tags` and the newer fields are optional, and older plays load as they are.
