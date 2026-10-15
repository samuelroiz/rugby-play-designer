# Rugby Play Designer

A browser whiteboard for drawing rugby plays: put attackers and defenders on a pitch, drag them around, draw runs, passes, kicks and other routes, and drop ball, ruck, scrum and lineout markers.

It is plain HTML, CSS, JavaScript (ES modules) and SVG. There is no framework, no build step and no npm. This is **Stage 1 ("Whiteboard")**: one phase per play. Phases, save/load and animation come later.

## Using it

- **Add attack / Add defender**: adds the next free number (1–15) near the middle of the current view. Each team can have up to 15.
- **Drag** players and markers with a mouse, finger or pen.
- **Double-click (or double-tap)** a player to change its label, e.g. `10` or `FH`.
- **Routes**: pick a route type, then press on the pitch and drag to where it ends. If you start on a player, the route belongs to that player and follows them when they move. Drag the dot in the middle of a route to bend it. Each type has its own colour as well as its line style: run yellow, pass white, kick orange, decoy grey, drift purple, blitz pink. Red and blue are kept for the teams.
- **Route order**: each route shows a small numbered badge near its start. New routes get the next number (1, 2, 3 …). Tap or click a badge to change its number. Deleting a route doesn't renumber the others. Stage 3 animation will use this order.
- **Set piece → Scrum**: asks which team has the put-in, then puts players 1–8 of both teams in a scrum formation: front row 1-2-3, locks 4-5, flankers 6-7, 8 at the back, each loosehead facing the opposing tighthead. Players 1–8 that already exist are moved rather than duplicated, so a team never goes over 15. The ball shows on the put-in side. Drag the **S** tab to move the whole scrum. Across the pitch it snaps to the nearest of the left 15 m line, the middle or the right 15 m line. Along the pitch it can go anywhere in the field of play. Players can still be dragged one at a time afterwards. Running the preset again moves the same players to the new scrum.
- **Select** by clicking a player, route or marker. **Delete** (key or button) removes it. **Esc** clears the selection and the route tool.
- **Full / Half** switches the view. Half shows exactly halfway (x = 50) to the dead ball line (x = 110), touchline to touchline, and the pitch is sized to fill the space without showing any extra field.
- **Horizontal / Vertical** turns the pitch. Vertical puts the try lines at the top and bottom, with x = 110 at the top. Only the view turns: the data stays the same, and numbers, labels and badges stay upright. It starts vertical on a phone held upright and horizontal otherwise.
- **Layers**: *Distances* labels the lines like a real pitch (5m, 22, 10, 50). *Grid* adds a faint 5 m grid. *Legend* shows or hides the route key. Distances and Legend start on.

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
js/app.js        play state, toolbar wiring, redraw
js/pitch.js      pitch markings and screen-to-metre conversion
js/editor.js     dragging, drawing and bending routes, editing route order, selecting
js/setpiece.js   scrum preset: formation, snapping the mark, moving the pack together
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
- The layer checkboxes (distances, grid, legend) are view settings and aren't part of the play.
