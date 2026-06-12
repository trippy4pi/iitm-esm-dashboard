# IITM ESM Climate Projections Dashboard

![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)
![Status](https://img.shields.io/badge/status-Production_Ready-success.svg)

## Overview
The **IITM ESM Dashboard** is an interactive, high-performance WebGIS application designed to visualize high-resolution climate projections across India. It provides researchers, policymakers, and the general public with intuitive, dynamic tools to explore projected climate changes across various scenarios (SSPs) and timeframes, seamlessly comparing CMIP6 and CMIP7 data.

This application is built entirely with vanilla web technologies (HTML, CSS, JS) emphasizing extreme performance, mobile responsiveness, and zero dependency on heavy frontend frameworks, making it blazing fast to load and interact with.

## Key Features

### 🗺️ Spatial Visualizations (WebGIS)
- **Interactive Choropleth Maps**: Powered by Leaflet.js, dynamically visualizing climate metrics across Indian states and districts.
- **Variable Selection**: Instantly switch between Mean Temperature (`tas`), Max Temperature (`tasmax`), Min Temperature (`tasmin`), and Precipitation (`pr`).
- **Seasonality & Timeframes**: View Annual, MAM, JJAS, SON, and DJF slices.
- **Smart Tooltips**: Glassmorphic tooltips providing precise data readouts on hover.

### 📈 Time Series & Analytics
- **Dynamic Line Charts**: Powered by Chart.js, plotting temporal climate trends up to the year 2100.
- **Spatial Bar Charts**: Instantly compare climate data across all states side-by-side.
- **Bi-directional Sync**: Hovering over the map highlights the corresponding state on the bar chart, and vice versa.
- **Smart Crosshairs**: Precision tracking on time-series charts that intelligently respond to user touch/mouse inputs.

### 📸 Built-in Export Studio
- **IITM ESM MAP EXPORTER**: Download high-resolution, presentation-ready PNGs of the map view complete with legends, titles, and branding.
- **IITM ESM PLOT EXPORTER**: Export pristine charts for research papers or presentations.
- Fully offline rendering via `dom-to-image`.

### 📱 Responsive & Progressive
- **Mobile-First UX**: Complex controls gracefully collapse into highly intuitive flex-layouts (e.g., 71-29 split header, swipeable carousel cards).
- **Progressive Web App (PWA)**: Built-in `sw.js` Service Worker caches assets for rapid loads and offline resilience.

### 📊 Live Analytics Engine
- **Live Viewers Tracking**: Lightweight, database-free PHP heartbeat system (`heartbeat.php`) tracks active sessions in real-time.
- **Lifetime Visits**: Safe, concurrency-protected PHP tracker (`visits.php`) using `flock()` to guarantee accurate metrics even under heavy traffic.

## Architecture & Technology Stack
- **Frontend**: HTML5, CSS3 (Vanilla, CSS Variables for theming), JavaScript (ES6+).
- **Mapping Engine**: [Leaflet.js](https://leafletjs.com/) (v1.9.4)
- **Charting Engine**: [Chart.js](https://www.chartjs.org/) (v4+)
- **Exporting**: dom-to-image
- **Backend (Analytics only)**: PHP 7.4+

## Deployment
This dashboard is completely static (with the exception of the lightweight PHP analytic counters) and can be deployed on any standard Apache/Nginx web server.

1. Clone the repository.
2. Ensure the `JSONs/` directory has write permissions (`chmod 777 JSONs/`) so the PHP scripts can update `lifetime_visits.txt` and `active_sessions.json`.
3. Serve via your web server. 

## Processing Climate Anomalies Locally
The repository includes `anomaly_script.py` which calculates climate anomalies from raw NetCDF daily datasets for states and districts.

### 1. Installation
Install the required Python packages in your local environment using the provided `requirements.txt`:
```bash
pip install -r requirements.txt
```

### 2. Execution
1. Place your NetCDF daily datasets inside a local directory named `daily_data/` (or configure a custom path using the `DAILY_DATA_PATH` environment variable).
2. Ensure the state and district GeoJSON boundary files are located at `JSONs/state_ultra_optimized.geojson` and `JSONs/districts_ultra_optimized.geojson`.
3. Run the script:
```bash
python anomaly_script.py
```

## Version History
- **v1.0.1**: Fixed caching issues causing district maps for Max and Min temperature variables to display empty/blank layouts on returning user visits. Implemented strict version query strings to bypass Service Worker caches for variables configs, geojson features, and district CSV files.
- **v1.0.0**: Initial Production Release. Includes all core visualizations, robust mobile layouts, PWA caching, Export Studio, and live tracking.
