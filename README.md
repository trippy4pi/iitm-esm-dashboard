# IITM-ESM Dashboard

A simple browser-based dashboard for visualizing IITM-ESM climate projections over Indian districts.

This project renders three synchronized choropleth maps (near/mid/long term) and lets you switch scenarios (SSP126/245/370/585) and variables. It uses Leaflet for maps and local JSON/GeoJSON data in the `JSONs/` folder.

## Features
- Three side-by-side Leaflet maps (Near / Mid / Long term)
- SSP scenario slider and metric buttons
- Synchronized tooltips and legends
- Works offline (data files are local) — Leaflet is loaded from CDN

## Quick start

1. Open `index.html` directly in a modern browser. For best results serve via a local HTTP server to avoid any browser file/CRS restrictions:

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

2. The UI controls are in the header: choose a metric and move the SSP slider (or use left/right arrow keys). Hover over a district on any of the three maps to view the tooltip (it will appear across all three maps).

## Files and data
- `index.html` — the main page
- `style.css` — styles
- `script.js` — main application logic
- `assets/` — images and favicon
- `JSONs/` — data and configuration
  - `VARIABLES.json` — variable metadata (labels, units, scenarios, color ramps)
  - `DATA.json` — tabular data keyed by state/district
  - `districts_ultra_optimized.geojson` — geometry used for maps

## Development notes
- The app expects district matching by both state and district name (see `script.js` where `window.dataLookup` is built using `STATE_UT|DISTRICT`). This helps disambiguate districts with the same name in different states.
- To add or edit variables, update `JSONs/VARIABLES.json` and adjust color/scale metadata there. `script.js` reads that file on load.
- Tooltips and legends are generated dynamically in `script.js` — see `updateDashboard()` and the map layer handlers in `initGeoLayers()`.

## Dependencies
- Leaflet (loaded from CDN in `index.html`). No build step required.

## DATA
Contact mailto:sarbhukanabhishek@gmail.com for the sample DATA.json file that I used.

## Contributing
Feel free to open issues or make PRs. Keep changes small and include screenshots for UI changes.

## License
This project is licensed under the MIT License — see the `LICENSE` file for details.
