# Rugby Play Designer

A browser whiteboard for drawing rugby plays: put attackers and defenders on a pitch, drag them around, draw runs, passes, kicks and other routes, and drop ball, ruck, scrum and lineout markers.

It is plain HTML, CSS, JavaScript (ES modules) and SVG. There is no framework, no build step and no npm. This is **Stage 1 ("Whiteboard")**: one phase per play. Phases, save/load and animation come later.

## Using it

- **Add attack / Add defender**: adds the next free number (1–15) near the middle of the current view. Each team can have up to 15.
- **Drag** players and markers with a mouse, finger or pen.
- **Double-click (or double-tap)** a player to change its label, e.g. `10` or `FH`.
- **Routes**: pick a route type, then press on the pitch and drag to where it ends. If you start on a player, the route belongs to that player and follows them when they move. Drag the dot in the middle of a route to bend it.
- **Select** by clicking a player, route or marker. **Delete** (key or button) removes it. **Esc** clears the selection and the route tool.
- **Full pitch / Half pitch** switches the view.

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
js/editor.js     dragging, drawing and bending routes, selecting
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
  "players": [{ "id": "a10", "team": "attack", "label": "10" }],
  "phases": [{
    "note": "",
    "positions": { "a10": { "x": 58, "y": 25 } },
    "objects": [{ "id": "o1", "type": "ball", "x": 60, "y": 25 }],
    "routes": [{ "id": "r1", "type": "run", "from": "a10", "points": [[58, 25], [66, 29]], "curve": 0 }]
  }]
}
```

- Player ids are `a1`–`a15` (attack) and `d1`–`d15` (defense). `label` is what gets drawn.
- A route's `from` is a player id, or `null` if it was drawn from open grass.
- `curve` is how far, in metres, the middle of the route is pushed sideways from the straight line between its first and last point. Positive bends to the right of the direction of travel, as seen on screen. The route is drawn as a quadratic Bézier.
