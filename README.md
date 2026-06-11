# IITM-ESM Climate Dashboard

A high-performance web dashboard for visualizing IITM-ESM climate projections over India (states and districts).

## Local Development
To run the dashboard locally:
```bash
# Serve the project root directory
python3 -m http.server 8000
```
Then open `http://localhost:8000` in your web browser.

## Tech Stack
* Core: HTML5, CSS3, JavaScript (ES6+)
* Libraries: Leaflet.js (mapping), Chart.js (analytics)
* Features: Offline support via Service Worker, PWA installation, Export Studio (PNG/SVG/CSV)
