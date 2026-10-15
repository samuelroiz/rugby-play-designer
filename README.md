# Rugby Play Designer

A browser whiteboard for drawing rugby plays: put attackers and defenders on a pitch, drag them around, draw runs, passes, kicks and other routes, and drop ball, ruck, scrum and lineout markers.

It is plain HTML, CSS, JavaScript (ES modules) and SVG. There is no framework, no build step and no npm. This is **Stage 2a**: a play has several phases, and it is autosaved in the browser and can be saved to and loaded from `.json` files. Phases can be saved as a PNG or printed to a PDF. Every change can be undone. Animation comes later.

## Using it

- **Add attack / Add defender**: adds the next free number (1–15) near the middle of the current view. Each team can have up to 15. The new player is put in every phase, at the same spot, whichever phase is shown.
- **Drag** players and markers with a mouse, finger or pen.
- **Double-click (or double-tap)** a player to change its label, e.g. `10` or `FH`.
- **Routes**: pick a route type, then press on the pitch and drag to where it ends. If you press within 2 m of a player's centre, the route starts from the nearest one: its start snaps onto them, it belongs to them and follows them when they move. That player gets a white ring while you draw (and, with a mouse, while you hover with a route tool), so you can see who it will attach to. Each type has its own colour as well as its line style: run yellow, pass white, kick orange, decoy grey, drift purple, blitz pink. Red and blue are kept for the teams.
- **Editing a route**: tap or click a route to select it and show its handles. These have large invisible touch areas, so they're easy to grab with a finger.
  - Drag the **end** dot to move where the route ends.
  - Drag the **start** dot to move where it begins. Dropping it within 2 m of a player attaches the route to the nearest one (they're ringed while you drag). Dropping it further from everyone detaches it.
  - Drag the yellow **middle** dot to bend the route.
  - Drag the **line** to move the whole route. This only works for routes not attached to a player; attached routes move with their player.

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
  - *Previous phase* draws the last phase's players as faint dashed outlines with their numbers, so you can see who moved where. They can't be clicked.

  Everything except Grid starts on.

### Phases

The bar under the pitch shows the phase tabs (**1 2 3 … +**), **Prev** and **Next**, and "Phase 2 of 4". The **←** and **→** keys also go back and forward.

- **+** adds a phase straight after the current one, built from it:
  - Each player with a run, drift, blitz or decoy starting on them moves to the end of that route. If a player has several, the highest order number wins.
  - If there are passes, the ball moves to the receiver of the highest-order pass. The receiver is the nearest team-mate of the passer within 5 m of where the pass ends, after their own run. If nobody is that close, the ball goes to the end of the pass. Otherwise the ball stays where it is.
  - Routes aren't copied, so the new phase starts with none. Markers (ruck, scrum, lineout, ball) are copied.
- **◂ Move / Move ▸** moves the current phase left or right. **Delete phase** asks first.
- The **note** box beside them belongs to the current phase.
- Players belong to the whole play: deleting a player removes them from every phase.

### Undo, autosave and files

- **Undo / Redo** (top bar, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z) covers every change to the play, including phases, labels, order numbers, name, note, details, New play and Load. A whole drag is one step, and so is a burst of typing in one box. At least 100 steps are kept. History is cleared on refresh.
- The play is **autosaved** in this browser (`localStorage`) shortly after every change, and straight away when the page is hidden or closed. It comes back when you reload. If storage is blocked (some private modes), everything else still works; it just isn't kept.
- The **File** menu holds the play's details (*category*: attack, defense, lineout or scrum; *tags*, comma separated) and:
  - **New play**: asks first, then starts a blank play.
  - **Save file**: downloads the play as `<play name>.json`. The name is cleaned of characters that aren't allowed in file names, and the JSON is pretty-printed.
  - **Load file…**: reads a `.json` play. It checks the file has `schemaVersion`, `players` and `phases`, and shows a short error if not. Loading replaces the current play after asking, and can be undone.
  - **Save image (PNG)**: the phase being shown, at twice its size on screen, in the current view and orientation, with the layers that are on (distances, grid, legend, previous phase). Selection highlights and handles are left out. It is named `<play name>-phase-<n>.png`. On a phone or tablet it opens the share sheet instead of downloading (on iPhone, *Save Image* puts it in Photos). If the share sheet can't open, the picture is shown in a box: press and hold it to save, or use *Open in new tab* or *Share…*.
  - **Save PDF (all phases)**: opens the browser's print dialog with one page per phase: the play name, the pitch, "Phase n of N" and the phase's note. Choose *Save as PDF* as the printer. Horizontal plays print landscape and vertical ones portrait. No library is used: it is a print-only view of the page.

  Loading a play (from a file or the autosave) also repairs it: a player missing from a phase is given their spot from the nearest earlier phase, or the nearest later one if there is no earlier one. Older versions could leave a player out of some phases, e.g. one deleted and added back while on phase 1.

## Running it locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>.

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
js/phases.js     building the next phase (players follow their runs, ball follows the last pass)
js/history.js    undo/redo by snapshots of the play
js/storage.js    autosave, saving and loading .json files, checking and repairing loaded plays
js/export.js     PNG of a phase, print view for the PDF
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
    "routes": [{ "id": "r1", "type": "run", "from": "a10", "points": [[58, 25], [66, 29]], "curve": 0, "order": 1 }]
  }]
}
```

- Player ids are `a1`–`a15` (attack) and `d1`–`d15` (defense). `label` is what gets drawn.
- A route's `from` is a player id, or `null` if it was drawn from open grass.
- `curve` is how far, in metres, the middle of the route is pushed sideways from the straight line between its first and last point. Positive bends to the right of the direction of travel, as seen on screen. The route is drawn as a quadratic Bézier.
- A route's `order` is a whole number from 1 to 99 and sets the order routes run in. New routes get one more than the highest existing order. Numbers can repeat, and gaps are fine. Routes without `order` (older data) simply show no badge.
- `orientation` is `"horizontal"` or `"vertical"`. It only changes how the pitch is drawn: all coordinates stay in the same pitch metres. Vertical is a quarter turn anticlockwise, so pitch (x, y) is drawn at SVG (y, −x).
- A scrum made with the preset has `putIn` (`"attack"` or `"defense"`) and `pack`, the ids of the players that move with it. Its `x, y` is the mark between the front rows, with `y` always 15, 35 or 55. A plain `scrum` object without `pack` (older data) still draws as an "S" marker.
- `category` is one of `attack`, `defense`, `lineout` and `scrum`. `tags` is a list of strings.
- `phases` is in play order. Each phase has its own `note`, player `positions`, `objects` (markers) and `routes`. Players are listed once, in `players`, and every player has a position in every phase (loading fills in any that are missing).
- Which phase is being shown, the layer checkboxes, and the undo history are view settings and aren't part of the play. The autosave stores the shown phase alongside the play.
- `schemaVersion` is still 1: `tags` and the newer fields are optional, and older plays load as they are.
