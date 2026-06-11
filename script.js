// Global state
let variablesConfig = null;
let datasetJSON = null;
let datasetGeoJSON = null;
let currentLevel = 'state'; // 'district' or 'state'
let isAnimating = false;
let lockedFeatureKey = null;

// Time Series State
let tsData = null;
let tsChart = null;
let tsSeason = 'annual';
let tsStartYear = 2015;
let tsEndYear = 2099;
let tsSelectedVar = 'precipitation';
let tsFullData = null; // Cache for time_series_data.json
let tsTriggeredByMap = false; // To show red line only on click
let tsPeriodMeans = {}; // For coloring the map in TS mode
let tsBaselines = {}; // For change calculation in TS mode
let tsBarChart = null;
let tsBarDataItems = []; // For bi-directional sync
let tsBarSort = 'az'; // Default Alphabetical A-Z
let tsVisibleStates = new Set(); // For filtering bars

function getTitleCaseYTitle(varCfg) {
    if (!varCfg) return '';
    const label = varCfg.label;
    const words = label.split(' ');
    const titleCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${titleCase} (${varCfg.unit})`;
}

// Data cache to avoid redundant fetches
const _dataCache = {};
let currentProjection = 'cmip6'; // 'cmip6' or 'cmip7'
let startZoom = 4.0;
let minZoomVal = 4;

// Guard flag for populateSearch to prevent duplicate listeners
let _searchInitialized = false;

// Stored reference for year-picker global click handler
let _yearPickerClickHandler = null;

const tsSeasonLabels = {
    'annual': 'Annual',
    'mam': 'MAM',
    'jjas': 'JJAS',
    'son': 'SON',
    'djf': 'DJF'
};

function parseStateCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return {};
    
    const headers = lines[0].split(',').map(h => h.trim());
    const data = {};
    
    const metrics = ["tas", "pr", "tasmax", "tasmin", "ws"];
    const seasons = ["annual", "mam", "jjas", "son", "djf"];
    const scenarios = ["ssp126", "ssp245", "ssp370", "ssp585"];
    
    // Initialize structure
    metrics.forEach(m => {
        data[m] = {};
        seasons.forEach(s => {
            data[m][s] = {};
            scenarios.forEach(sc => {
                data[m][s][sc] = [];
            });
        });
    });
    
    const seasonSuffixMap = {
        'annual': 'Annual',
        'mam': 'MAM',
        'jjas': 'JJAS',
        'son': 'SON',
        'djf': 'DJF'
    };
    
    // Precompute header mappings
    const headerMapping = [];
    metrics.forEach(m => {
        seasons.forEach(s => {
            scenarios.forEach(sc => {
                const csvHeader = `${currentProjection}_${m}_${sc}_${seasonSuffixMap[s]}`;
                const hIdx = headers.indexOf(csvHeader);
                if (hIdx !== -1) {
                    headerMapping.push({
                        metric: m,
                        season: s,
                        scenario: sc,
                        colIndex: hIdx
                    });
                }
            });
        });
    });
    
    const yearObjects = {};
    const yearLists = {};
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const values = line.split(',');
        if (values.length < headers.length) continue;
        
        const year = parseInt(values[0]);
        const region = values[1].trim();
        if (!year || !region) continue;
        
        for (let j = 0; j < headerMapping.length; j++) {
            const map = headerMapping[j];
            const valStr = values[map.colIndex];
            const val = (valStr === '' || valStr === undefined) ? null : parseFloat(valStr);
            
            const key = `${map.metric}_${map.season}_${map.scenario}_${year}`;
            if (!yearObjects[key]) {
                yearObjects[key] = { year: year };
                
                const listKey = `${map.metric}_${map.season}_${map.scenario}`;
                if (!yearLists[listKey]) yearLists[listKey] = [];
                yearLists[listKey].push(year);
            }
            yearObjects[key][region] = val;
        }
    }
    
    metrics.forEach(m => {
        seasons.forEach(s => {
            scenarios.forEach(sc => {
                const listKey = `${m}_${s}_${sc}`;
                const years = yearLists[listKey] || [];
                years.sort((a, b) => a - b);
                
                years.forEach(yr => {
                    const key = `${m}_${s}_${sc}_${yr}`;
                    data[m][s][sc].push(yearObjects[key]);
                });
            });
        });
    });
    
    return data;
}

function parseDistrictCSV(csvText, features) {
    const lines = csvText.split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    
    const metrics = ["tas", "tasmax", "tasmin", "pr"];
    const scenarios = ["ssp126", "ssp245", "ssp370", "ssp585"];
    
    const colMapping = [];
    metrics.forEach(m => {
        scenarios.forEach(sc => {
            const colName = `${currentProjection}_${m}_${sc}_Annual`;
            const colIdx = headers.indexOf(colName);
            if (colIdx !== -1) {
                colMapping.push({
                    metric: m,
                    scenario: sc,
                    colIdx: colIdx
                });
            }
        });
    });

    const parsedDistricts = [];

    for (let i = 0; i < features.length; i++) {
        const feat = features[i];
        const stateName = feat.properties.STATE_UT;
        const districtName = feat.properties.DISTRICT;

        const row = {
            STATE_UT: stateName,
            DISTRICT: districtName
        };

        const sums = new Array(48).fill(0);
        const counts = new Array(48).fill(0);

        const startLineIdx = (i + 1) * 85 + 1;

        for (let yearIdx = 0; yearIdx < 85; yearIdx++) {
            const lineIdx = startLineIdx + yearIdx;
            if (lineIdx >= lines.length) break;

            const line = lines[lineIdx];
            if (!line) continue;

            const columns = line.split(',');
            if (columns.length < headers.length) continue;

            const year = parseInt(columns[0]);
            if (!year) continue;

            let termIdx = -1;
            if (year >= 2025 && year <= 2036) termIdx = 0;
            else if (year >= 2050 && year <= 2070) termIdx = 1;
            else if (year >= 2081 && year <= 2099) termIdx = 2;

            if (termIdx !== -1) {
                const termOffset = termIdx * 16;
                for (let k = 0; k < colMapping.length; k++) {
                    const map = colMapping[k];
                    const valStr = columns[map.colIdx] ? columns[map.colIdx].trim() : '';
                    if (valStr && valStr !== 'NaN') {
                        const val = parseFloat(valStr);
                        if (!isNaN(val)) {
                            const idx = termOffset + k;
                            sums[idx] += val;
                            counts[idx] += 1;
                        }
                    }
                }
            }
        }

        const termNames = ['near', 'mid', 'long'];
        for (let termIdx = 0; termIdx < 3; termIdx++) {
            const termOffset = termIdx * 16;
            const termName = termNames[termIdx];
            for (let k = 0; k < colMapping.length; k++) {
                const map = colMapping[k];
                const idx = termOffset + k;
                const key = `${map.metric}_${map.scenario}_${termName}`;
                if (counts[idx] > 0) {
                    row[key] = sums[idx] / counts[idx];
                } else {
                    row[key] = null;
                }
            }
        }

        parsedDistricts.push(row);
    }

    return parsedDistricts;
}

async function loadStateTimeSeriesData() {
    if (tsFullData) return tsFullData;
    
    try {
        const resp = await fetch(`CSVs/${currentProjection}_state_anomalies.csv?v=${Date.now()}`);
        if (!resp.ok) throw new Error('CSV file not found');
        const csvText = await resp.text();
        tsFullData = parseStateCSV(csvText);
        return tsFullData;
    } catch (e) {
        console.error('Error loading state time series CSV:', e);
        throw e;
    }
}

function clearTimeSeriesChartsAndMaps() {
    if (tsChart) { tsChart.destroy(); tsChart = null; }
    if (tsBarChart) { tsBarChart.destroy(); tsBarChart = null; }
    
    tsPeriodMeans = {};
    
    const config = levelsCfg[currentLevel];
    for (const key of ['near', 'mid', 'long']) {
        if (geoLayers[key]) {
            geoLayers[key].eachLayer(layer => {
                const featureKey = config.keyGen(layer.feature.properties);
                const isHighlighted = (lockedFeatureKey === featureKey);
                layer.setStyle({
                    fillColor: '#e2e8f0', // default gray
                    fillOpacity: 1.0,
                    color: '#000000',
                    weight: isHighlighted ? 2.2 : 0.5,
                    opacity: 1.0
                });
                layer.closeTooltip();
            });
        }
    }
}

const stateAcronyms = {
    "ANDHRA PRADESH": "AP", "ARUNACHAL PRADESH": "AR", "ASSAM": "AS", "BIHAR": "BR",
    "CHANDIGARH": "CH", "CHHATTISGARH": "CG", "DADRA & NAGAR HAVELI & DAMAN & DIU": "DD",
    "DELHI": "DL", "GOA": "GA", "GUJARAT": "GJ", "HARYANA": "HR", "HIMACHAL PRADESH": "HP",
    "JAMMU AND KASHMIR": "JK", "JHARKHAND": "JH", "KARNATAKA": "KA", "KERALA": "KL",
    "LADAKH": "LA", "MADHYA PRADESH": "MP", "MAHARASHTRA": "MH", "MANIPUR": "MN",
    "MEGHALAYA": "ML", "MIZORAM": "MZ", "NAGALAND": "NL", "ODISHA": "OR",
    "PUDUCHERRY": "PY", "PUNJAB": "PB", "RAJASTHAN": "RJ", "SIKKIM": "SK",
    "TAMIL NADU": "TN", "TELANGANA": "TG", "TRIPURA": "TR", "UTTARAKHAND": "UK",
    "UTTAR PRADESH": "UP", "WEST BENGAL": "WB"
};

const terms = {
    'near': { id: 'near-term-header', label: 'Near-term', years: '(2025-2036)' },
    'mid': { id: 'mid-term-header', label: 'Mid-term', years: '(2050-2070)' },
    'long': { id: 'long-term-header', label: 'Long-term', years: '(2081-2099)' }
};

// Level configurations
const levelsCfg = {
    district: {
        variables: 'JSONs/District_VARIABLES.json',
        data: 'CSVs/cmip6_district_anomalies.csv',
        geojson: 'JSONs/districts_ultra_optimized.geojson',
        keyGen: (props) => `${(props.STATE_UT || "").trim()}|${(props.DISTRICT || "").trim()}`.toLowerCase(),
        rowKeyGen: (row) => `${row.STATE_UT.trim()}|${row.DISTRICT.trim()}`.toLowerCase(),
        placeholder: 'Search District...',
        tooltipName: (row) => (row.DISTRICT || "").toUpperCase(),
        tooltipState: (row) => row.STATE_UT,
        searchLabel: (row) => (row.DISTRICT || "").toUpperCase(),
        searchSub: (row) => row.STATE_UT
    },
    state: {
        variables: 'JSONs/State_VARIABLES.json',
        data: 'CSVs/cmip6_state_anomalies.csv',
        geojson: 'JSONs/state_ultra_optimized.geojson',
        keyGen: (props) => `${(props.STATE_UT || "").trim()}`.toLowerCase(),
        rowKeyGen: (row) => `${row.STATE_UT.trim()}`.toLowerCase(),
        placeholder: 'Search State...',
        tooltipName: (row) => row.STATE_UT,
        tooltipState: (row) => "",
        searchLabel: (row) => row.STATE_UT,
        searchSub: (row) => ""
    }
};

// Map containers and layers
const mapViews = {};
const geoLayers = {};
const layersMap = { 'near': {}, 'mid': {}, 'long': {} };

/**
 * Returns exact hex color for a given value based on discrete classification.
 */
function getColor(val, cfg) {
    if (val === null || val === undefined) return '#e2e8f0';
    const { colors, ticks } = cfg;
    const n = colors.length;
    const m = ticks.length - 1;
    if (m < 1) return colors[0] || '#e2e8f0';

    if (val <= ticks[0]) return colors[0];
    if (val >= ticks[m]) return colors[n - 1];

    for (let i = 0; i < m; i++) {
        if (val < ticks[i + 1]) {
            const intervalPct = (val - ticks[i]) / (ticks[i + 1] - ticks[i]);
            const colorsPerInterval = n / m;
            const colorIndex = Math.floor((i + intervalPct) * colorsPerInterval);
            return colors[Math.min(Math.max(0, colorIndex), n - 1)];
        }
    }
    return colors[n - 1];
}

/**
 * Builds legend bar gradient and ticks.
 */
function buildLegendBar(cfg) {
    const { colors, ticks } = cfg;
    const n = colors.length;
    const stops = colors.flatMap((c, i) => {
        return [`${c} ${(i / n * 100).toFixed(3)}%`, `${c} ${((i + 1) / n * 100).toFixed(3)}%`];
    });
    const gradient = `linear-gradient(to right, ${colors[0]} 0%, ${stops.join(', ')}, ${colors[n - 1]} 100%)`;
    return { gradient, ticks };
}

// Map Initialization
(() => {
    const width = window.innerWidth;
    // Unified default zoom for all screen sizes
    startZoom = 4.0;
    minZoomVal = 3.5;

    const center = [22.9734, 82.5];
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    // Define custom download map control class
    const DownloadControl = L.Control.extend({
        options: { position: 'topleft' },
        initialize: function (options) {
            L.Util.setOptions(this, options);
        },
        onAdd: function () {
            const term = this.options.term;
            const div = L.DomUtil.create('div', 'leaflet-control leaflet-download-control');
            div.innerHTML = `
                <a class="leaflet-download-btn" href="#" title="Download Map as PNG" role="button" aria-label="Download Map as PNG">
                    <img src="assets/icons/lucide-download.svg" alt="Download">
                </a>
            `;
            div.addEventListener('click', (e) => {
                e.preventDefault();
                window.openExportStudio('map-' + term);
            });
            L.DomEvent.disableClickPropagation(div);
            return div;
        }
    });

    // Define custom level switcher control class using the 3D Soap Slider
    const LevelControl = L.Control.extend({
        options: { position: 'topright' },
        onAdd: function () {
            const div = L.DomUtil.create('div', 'spatial-toggle');
            div.id = 'spatial-level-toggle';
            div.setAttribute('data-level', currentLevel);
            div.innerHTML = `
                <div class="toggle-track">
                    <div class="toggle-slider"></div>
                    <button class="toggle-opt ${currentLevel === 'state' ? 'active' : ''}" data-level="state">STATE</button>
                    <button class="toggle-opt ${currentLevel === 'district' ? 'active' : ''}" data-level="district">DISTRICT</button>
                </div>
            `;

            div.addEventListener('click', () => {
                const val = currentLevel === 'state' ? 'district' : 'state';
                currentLevel = val;
                lockedFeatureKey = null;

                // Sync all toggles across maps
                document.querySelectorAll('.spatial-toggle').forEach(el => {
                    el.setAttribute('data-level', val);
                    el.querySelectorAll('.toggle-opt').forEach(b => {
                        b.classList.toggle('active', b.dataset.level === val);
                    });
                });

                load();
            });

            L.DomEvent.disableClickPropagation(div);
            return div;
        }
    });


    ['near', 'mid', 'long'].forEach((term) => {
        const id = `map-${term}-term`;
        const el = document.getElementById(id);
        if (!el) return;
        const m = L.map(id, {
            zoomControl: false,
            attributionControl: true,
            minZoom: minZoomVal,
            maxZoom: 8,
            zoomSnap: 0.1
        }).setView(center, startZoom);
        L.control.zoom({ position: 'bottomleft' }).addTo(m);
        L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(m);
        mapViews[term] = m;

        // Add the level control to this map
        new LevelControl().addTo(m);

        // Add the download control to this map
        new DownloadControl({ term: term }).addTo(m);


        // Inject loader once
        const container = el.closest('.map-container');
        if (container && !container.querySelector('.map-loader')) {
            const loader = document.createElement('div');
            loader.className = 'map-loader';
            loader.innerHTML = '<div class="map-loader-ring"></div><span class="map-loader-label">Loading data…</span>';
            container.appendChild(loader);
        }
    });
})();

// Header Stats Initialization (Live Viewers & Lifetime Visits)
(() => {
    // Generate a simple unique session ID on page load
    const sessionId = Math.random().toString(36).substring(2, 9);

    // 1. Fetch Lifetime Visits from PHP backend
    fetch('visits.php')
        .then(res => {
            if (!res.ok) throw new Error('Network response error');
            return res.json();
        })
        .then(data => {
            const visitsEl = document.getElementById('visit-count');
            if (visitsEl && data.visits) {
                visitsEl.innerText = Number(data.visits).toLocaleString();
            }
        })
        .catch(err => {
            console.warn('Failed to load real-time visits from PHP:', err);
            // Fallback to offline localStorage if PHP is not responding
            let visits = parseInt(localStorage.getItem('iitm_esm_lifetime_visits') || '0', 10) + 1;
            localStorage.setItem('iitm_esm_lifetime_visits', visits);
            const visitsEl = document.getElementById('visit-count');
            if (visitsEl) visitsEl.innerText = visits.toLocaleString();
        });

    // 2. Live Viewers Heartbeat Polling via PHP backend
    const liveEl = document.getElementById('live-count');
    if (liveEl) {
        function sendHeartbeat() {
            fetch(`heartbeat.php?sessionId=${sessionId}`)
                .then(res => {
                    if (!res.ok) throw new Error('Network response error');
                    return res.json();
                })
                .then(data => {
                    if (data.activeViewers) {
                        liveEl.innerText = data.activeViewers;
                    }
                })
                .catch(err => {
                    console.warn('Heartbeat polling failed:', err);
                    // Fallback to a mock simulation if PHP is not responding
                    if (liveEl.innerText === '--' || liveEl.innerText === '') {
                        liveEl.innerText = '1';
                    }
                });
        }

        // Start heartbeat immediately, then ping every 20 seconds
        sendHeartbeat();
        setInterval(sendHeartbeat, 20000);
    }
})();

// Data Loading
async function load() {
    try {
        const config = levelsCfg[currentLevel];
        document.querySelectorAll('.map-container').forEach(c => c.classList.add('is-loading'));

        let rawData;

        // Use cache if available to avoid re-fetching large JSON files
        const cacheKey = `${currentLevel}_${currentProjection}`;
        if (_dataCache[cacheKey]) {
            variablesConfig = _dataCache[cacheKey].variables;
            rawData = _dataCache[cacheKey].data;
            datasetGeoJSON = _dataCache[cacheKey].geojson;
        } else {
            if (currentLevel === 'state') {
                const [vResp, gResp] = await Promise.all([
                    fetch(config.variables),
                    fetch(config.geojson)
                ]);
                variablesConfig = await vResp.json();
                datasetGeoJSON = await gResp.json();
                rawData = await loadStateTimeSeriesData();
            } else {
                const [vResp, dResp, gResp] = await Promise.all([
                    fetch(config.variables),
                    fetch(config.data.replace('cmip6', currentProjection)),
                    fetch(config.geojson)
                ]);
                variablesConfig = await vResp.json();
                const csvText = await dResp.text();
                datasetGeoJSON = await gResp.json();
                rawData = parseDistrictCSV(csvText, datasetGeoJSON.features);
            }

            _dataCache[cacheKey] = {
                variables: variablesConfig,
                data: rawData,
                geojson: datasetGeoJSON
            };
        }

        if (currentLevel === 'state') {
            tsFullData = rawData; // Cache for Time Series chart

            // Extract unique state names from the first available dataset (INDIA is always there)
            const firstVar = Object.keys(variablesConfig)[0];
            const jsKey = variablesConfig[firstVar].json_key;
            const sampleData = tsFullData[jsKey]['annual']['ssp126'];
            const stateNames = Object.keys(sampleData[0]).filter(k => k !== 'year' && k !== 'year_id');

            // Transform Time Series into Spatial Rows (Mean per Term)
            datasetJSON = stateNames.map(name => {
                const row = { STATE_UT: name };

                Object.keys(variablesConfig).forEach(varKey => {
                    const vCfg = variablesConfig[varKey];
                    const jKey = vCfg.json_key;

                    Object.keys(vCfg.scenarios).forEach(scen => {
                        const sKey = scen.toLowerCase();

                        Object.keys(terms).forEach(termKey => {
                            const [start, end] = terms[termKey].years.match(/\d{4}/g).map(Number);
                            const yearlyValues = tsFullData[jKey]?.['annual']?.[sKey];

                            if (yearlyValues) {
                                const period = yearlyValues.filter(d => d.year >= start && d.year <= end);
                                const vals = period.map(d => d[name]).filter(v => v !== null && !isNaN(v));
                                if (vals.length > 0) {
                                    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                                    row[`${jKey}_${sKey}_${termKey}`] = mean;
                                } else {
                                    row[`${jKey}_${sKey}_${termKey}`] = null;
                                }
                            }
                        });
                    });
                });
                return row;
            });
        } else {
            datasetJSON = rawData; // Districts still use the flat JSON format
        }

        window.dataLookup = {};
        datasetJSON.forEach(row => {
            window.dataLookup[config.rowKeyGen(row)] = row;
        });

        document.getElementById('district-search').placeholder = config.placeholder;
        initGeoLayers();
        populateSearch();
        updateDashboard();

        setTimeout(() => {
            document.querySelectorAll('.map-container.is-loading').forEach(c => c.classList.remove('is-loading'));
        }, 300);

        setTimeout(() => {
            Object.values(mapViews).forEach(m => m.invalidateSize());
            // Sync toggle UI state across all maps
            document.querySelectorAll('.spatial-toggle').forEach(toggle => {
                toggle.setAttribute('data-level', currentLevel);
                toggle.querySelectorAll('.toggle-opt').forEach(opt => {
                    opt.classList.toggle('active', opt.dataset.level === currentLevel);
                });
            });
            window.dispatchEvent(new Event('dashboardready'));
        }, 150);
    } catch (e) {
        console.error('Load failed:', e);
    }
}

function initGeoLayers() {
    const config = levelsCfg[currentLevel];
    ['near', 'mid', 'long'].forEach(term => {
        if (geoLayers[term]) mapViews[term].removeLayer(geoLayers[term]);
        layersMap[term] = {};

        geoLayers[term] = L.geoJSON(datasetGeoJSON, {
            style: { weight: 0.5, color: '#000000', fillOpacity: 1.0, fillColor: '#e2e8f0' },
            onEachFeature: (feature, layer) => {
                const featureKey = config.keyGen(feature.properties);
                layersMap[term][featureKey] = layer;

                layer.on('mouseover', (e) => { syncHover(featureKey, term, true, e.latlng); });
                layer.on('mousemove', (e) => { syncHover(featureKey, term, true, e.latlng); });
                layer.on('mouseout', () => { syncHover(featureKey, term, false); });
                layer.on('click', (e) => {
                    if (lockedFeatureKey === featureKey) clearSelection();
                    else selectFeature(featureKey, false, true); // true = trigger mode switch
                    L.DomEvent.stopPropagation(e);
                });
            }
        }).addTo(mapViews[term]);
    });
}

async function selectFeature(featureKey, panTo = false, triggerSwitch = false) {
    if (lockedFeatureKey) syncHover(lockedFeatureKey, null, false);
    lockedFeatureKey = featureKey;
    const layer = layersMap['near'][featureKey];
    if (!layer) return;

    const center = layer.getBounds().getCenter();
    if (panTo) Object.values(mapViews).forEach(m => m.panTo(center, { animate: true }));

    const searchInput = document.getElementById('district-search');
    const row = window.dataLookup[featureKey];
    if (searchInput && row) {
        const config = levelsCfg[currentLevel];
        const subText = config.searchSub(row);
        searchInput.value = config.searchLabel(row) + (subText ? `, ${subText}` : "");
        document.getElementById('clear-search')?.classList.add('visible');
    }

    // Handle Search/Selection Effect based on Mode
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    const viewToggle = document.getElementById('view-mode-toggle');

    if (triggerSwitch && currentLevel === 'state') {
        tsTriggeredByMap = true;
        if (viewToggle && !viewToggle.checked) {
            viewToggle.checked = true;
            viewToggle.dispatchEvent(new Event('change'));
        } else {
            await updateDashboard();
            syncHover(featureKey, null, true, center);
        }
    } else {
        if (isTimeSeries && currentLevel === 'state') {
            tsTriggeredByMap = true;
        }

        await updateDashboard();
        // Fully restore map highlighting and tooltips on search
        syncHover(featureKey, null, true, center);
    }
}

function clearSelection() {
    if (lockedFeatureKey) syncHover(lockedFeatureKey, null, false);
    lockedFeatureKey = null;
    tsTriggeredByMap = false; // Hide the state-specific trend line

    const input = document.getElementById('district-search');
    if (input) input.value = '';
    document.getElementById('clear-search')?.classList.remove('visible');

    // Recalibrate Maps to default India view
    Object.values(mapViews).forEach(m => {
        m.setView([22.9734, 82.5], startZoom, { animate: true });
    });

    updateDashboard();
}

function syncHover(featureKey, sourceTerm, isOver, latlng, source = 'map') {
    Object.keys(terms).forEach(term => {
        const layers = layersMap[term];
        const layer = featureKey ? layers[featureKey] : null;

        if (!isOver || !featureKey) {
            Object.keys(layers).forEach(k => {
                const l = layers[k];
                const isLocked = (lockedFeatureKey === k);
                l.setStyle({ 
                    weight: isLocked ? 2.2 : 0.5, 
                    color: '#000000' 
                });
                l.closeTooltip();
            });
        } else if (layer) {
            // Close other tooltips to prevent duplicates/stuck tooltips
            Object.keys(layers).forEach(k => {
                if (k !== featureKey) layers[k].closeTooltip();
            });

            const isLocked = (lockedFeatureKey === featureKey);
            layer.setStyle({ weight: isLocked ? 2.2 : 1.8, color: '#000000' });
            if (layer.bringToFront) layer.bringToFront();
            if (latlng) layer.openTooltip(latlng);
            else layer.openTooltip();
        }
    });

    // Bi-directional Sync with Bar Chart
    if (tsBarChart && source !== 'bar' && document.body.classList.contains('time-series-mode')) {
        if (isOver && featureKey) {
            const stateName = featureKey.toUpperCase();
            const idx = tsBarDataItems.findIndex(item => item.stateName.toUpperCase() === stateName);
            if (idx !== -1) {
                // Manually trigger tooltip at bar center if not interactive
                const meta = tsBarChart.getDatasetMeta(0);
                const element = meta.data[idx];
                const rect = tsBarChart.canvas.getBoundingClientRect();

                // Fake mouse positions for the external tooltip logic
                tsBarChart.canvas._lastMouseX = rect.left + window.pageXOffset + element.x;
                tsBarChart.canvas._lastMouseY = rect.top + window.pageYOffset + element.y;

                tsBarChart.setActiveElements([{ datasetIndex: 0, index: idx }]);
                tsBarChart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: element.x, y: element.y });
                tsBarChart.update();
            }
        } else {
            tsBarChart.setActiveElements([]);
            tsBarChart.tooltip.setActiveElements([], { x: 0, y: 0 });
            tsBarChart.update();
        }
    }
}

async function updateDashboard() {
    if (!variablesConfig || !datasetJSON) return;

    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';

    const mainEl = document.querySelector('main');
    const atmosConfig = {
        'SSP126': { p: 'rgba(0, 255, 0, 0.7)', s: 'rgba(0, 255, 0, 0.67)' },  // Literal Green
        'SSP245': { p: 'rgba(255, 255, 0, 0.7)', s: 'rgba(255, 255, 0, 0.67)' },   // Literal Yellow
        'SSP370': { p: 'rgba(255, 165, 0, 0.7)', s: 'rgba(255, 165, 0, 0.67)' },  // Literal Orange
        'SSP585': { p: 'rgba(255, 0, 0, 0.7)', s: 'rgba(255, 0, 0, 0.67)' }   // Literal Red
    };

    if (mainEl && atmosConfig[scenario]) {
        mainEl.style.setProperty('--plasma-1', atmosConfig[scenario].p);
        mainEl.style.setProperty('--plasma-2', atmosConfig[scenario].s);

        const baseColors = {
            'SSP126': 'rgba(34, 197, 94, 1)',
            'SSP245': 'rgba(234, 179, 8, 1)',
            'SSP370': 'rgba(249, 115, 22, 1)',
            'SSP585': 'rgba(239, 68, 68, 1)'
        };

        const baseColor = baseColors[scenario];

        document.documentElement.style.setProperty('--header-bleed', baseColor.replace('1)', '0.06)'));
        document.documentElement.style.setProperty('--button-bleed', baseColor.replace('1)', '0.10)'));
        document.documentElement.style.setProperty('--legend-bleed', baseColor.replace('1)', '0.04)'));
        document.documentElement.style.setProperty('--container-bleed', 'transparent');
        document.documentElement.style.setProperty('--border-bleed', baseColor.replace('1)', '0.70)'));
        document.documentElement.style.setProperty('--glow-bleed', baseColor.replace('1)', '0.15)'));

        const hdr = document.querySelector('header');
        if (hdr) {
            hdr.classList.remove('flare-active');
            document.documentElement.style.setProperty('--header-flare-color', baseColor.replace('1)', '0.80)'));
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    hdr.classList.add('flare-active');
                });
            });
        }
    }

    const isTimeSeries = document.body.classList.contains('time-series-mode');

    // Consolidate Time Series logic: Move data prep to beginning
    if (isTimeSeries) {
        // Force State level for TS mode as requested
        if (currentLevel !== 'state') {
            currentLevel = 'state';
            load(); // This will re-trigger updateDashboard
            return;
        }
        await updateTimeSeriesChart();
    }

    const varCfg = variablesConfig[metric];
    const scenCfg = varCfg?.scenarios[scenario];
    if (!scenCfg) return;

    const config = levelsCfg[currentLevel];
    const { ticks } = buildLegendBar(scenCfg);

    Object.keys(terms).forEach(key => {
        const hdr = document.getElementById(terms[key].id);
        if (hdr) {
            const isSmallScreen = window.innerWidth <= 1024;
            const variableLabel = isSmallScreen ? `${varCfg.json_key.toUpperCase()} CHANGE` : varCfg.label;
            if (isTimeSeries) {
                if (key === 'near') {
                    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
                    hdr.innerText = `${seasonLabel} ${variableLabel} ${scenario} (${tsStartYear}-${tsEndYear})`;
                }
            } else {
                hdr.innerText = `${terms[key].label} ${variableLabel} ${scenario} ${terms[key].years}`;
            }
        }

        geoLayers[key].eachLayer(layer => {
            const featureKey = config.keyGen(layer.feature.properties);
            const dataRow = window.dataLookup[featureKey];

            if (isTimeSeries) {
                const tsVal = (key === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
                layer.setStyle({
                    fillColor: getColor(tsVal, scenCfg),
                    fillOpacity: 1.0,
                    color: '#000000',
                    weight: (lockedFeatureKey === featureKey) ? 2.2 : 0.5,
                    opacity: 1.0
                });

                const formattedVal = tsVal !== null ? (tsVal > 0 ? `+${tsVal.toFixed(2)}` : tsVal.toFixed(2)) : 'N/A';
                const name = config.tooltipName(dataRow || { DISTRICT: layer.feature.properties.DISTRICT, STATE_UT: layer.feature.properties.STATE_UT });

                layer.bindTooltip(`
                    <div class="district-tooltip">
                        <span class="tooltip-val">${formattedVal} ${varCfg.unit}</span>
                        <span class="tooltip-dist">${name}</span>
                        <span class="tooltip-state">${tsStartYear}-${tsEndYear} Average</span>
                    </div>
                `, { sticky: false, direction: 'auto', offset: [0, -10], className: 'custom-tooltip-pane' });
            } else {
                const val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${key}`] : null;
                layer.setStyle({
                    fillColor: getColor(val, scenCfg),
                    fillOpacity: 1.0,
                    color: '#000000',
                    weight: (lockedFeatureKey === featureKey) ? 2.2 : 0.5,
                    opacity: 1.0
                });
                const formattedVal = val !== null ? (val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2)) : 'N/A';
                const name = config.tooltipName(dataRow || { DISTRICT: layer.feature.properties.DISTRICT, STATE_UT: layer.feature.properties.STATE_UT });
                const state = config.tooltipState(dataRow || { STATE_UT: layer.feature.properties.STATE_UT });

                layer.bindTooltip(`
                    <div class="district-tooltip">
                        <span class="tooltip-val">${formattedVal} ${varCfg.unit}</span>
                        <span class="tooltip-dist">${name}</span>
                        ${state ? `<span class="tooltip-state">${state}</span>` : ""}
                    </div>
                `, { sticky: false, direction: 'auto', offset: [0, -10], className: 'custom-tooltip-pane' });
            }
        });


        // Legend Sync
        const container = document.getElementById(`legend-${key}`);
        if (!container) return;
        container.querySelector('.legend-title').innerText = `${varCfg.label} (${varCfg.unit})`;
        const scaleEl = container.querySelector('.legend-scale');
        if (scaleEl) {
            const startColor = scenCfg.colors[0], endColor = scenCfg.colors[scenCfg.colors.length - 1];
            scaleEl.innerHTML = `
                <div class="legend-scale-arrow left"><svg viewBox="0 0 10 14" preserveAspectRatio="none"><path d="M10 0.5 L1 7 L10 13.5 Z" fill="${startColor}" stroke="black" stroke-width="1"/></svg></div>
                ${scenCfg.colors.map(c => `<div class="legend-scale-block" style="background:${c};"></div>`).join('')}
                <div class="legend-scale-arrow right"><svg viewBox="0 0 10 14" preserveAspectRatio="none"><path d="M0 0.5 L9 7 L0 13.5 Z" fill="${endColor}" stroke="black" stroke-width="1"/></svg></div>
            `;
        }

        let ticksEl = container.querySelector('.legend-ticks') || document.createElement('div');
        ticksEl.className = 'legend-ticks';
        if (!ticksEl.parentElement) scaleEl.after(ticksEl);
        ticksEl.innerHTML = ticks.map((v, i) => {
            const pct = (i / (ticks.length - 1)) * 100;
            const label = (v > 0 && metric === 'precipitation' ? '+' : '') + (v === 0 ? '0' : (metric === 'precipitation' ? v.toFixed(1) : Math.abs(v).toFixed(1)));
            return `<span class="legend-tick" style="left:${pct.toFixed(2)}%">${label}</span>`;
        }).join('');
        const old = container.querySelector('.legend-labels');
        if (old) old.style.display = 'none';
    });
}

async function updateTimeSeriesChart() {
    const metric = window.selectedMetric();
    const scenario = window.selectedScenario();
    const varCfg = variablesConfig[metric];
    if (!varCfg) return;
    const isMobile = window.innerWidth <= 1024;

    const canvas = document.getElementById('time-series-chart');
    const header = document.getElementById('mid-term-header');

    if (!canvas || !header) return;

    // 1. Determine Display State Name for Title
    let displayStateName = "INDIA";
    let stateKey = null;
    if (lockedFeatureKey) {
        const lookupKey = lockedFeatureKey.includes('|') ? lockedFeatureKey.split('|')[0] : lockedFeatureKey;
        const row = window.dataLookup[lookupKey];
        if (row && row.STATE_UT) {
            stateKey = row.STATE_UT.toUpperCase();
            displayStateName = row.STATE_UT;
        }
    }

    // 2. Initial/Update Header with Controls
    const effectiveTitleLoc = (stateKey && tsTriggeredByMap) ? displayStateName : "INDIA";
    const titleLabel = isMobile ? `${varCfg.json_key.toUpperCase()} CHANGE` : varCfg.label;
    if (!header.querySelector('.ts-control-group') || tsSelectedVar !== metric) {
        tsSelectedVar = metric;
        renderTimeSeriesHeader(header, effectiveTitleLoc, titleLabel, scenario);
    } else {
        const titleScen = header.querySelector('#ts-title-scenario');
        if (titleScen) titleScen.innerText = `(${scenario})`;
        const titleState = header.querySelector('#ts-title-state');
        if (titleState) titleState.innerText = effectiveTitleLoc;
        const titleVar = header.querySelector('#ts-title-varlabel');
        if (titleVar) titleVar.innerText = titleLabel;
    }

    // 3. Load Unified Data if needed
    if (!tsFullData) {
        try {
            tsFullData = await loadStateTimeSeriesData();
        } catch (e) {
            console.error('Time series fetch error:', e);
            clearTimeSeriesChartsAndMaps();
            return;
        }
    }

    // 4. Selection & Data Mapping
    const jsKey = varCfg.json_key;
    const scenKey = scenario.toLowerCase();
    const seasonKey = tsSeason;

    const rawArray = tsFullData[jsKey]?.[seasonKey]?.[scenKey];
    if (!rawArray || !rawArray.length) {
        tsPeriodMeans = {}; // Clear map data
        clearTimeSeriesChartsAndMaps();
        return;
    }

    const hasStateSelection = (stateKey && tsTriggeredByMap);

    // Process India Points (Always Green)
    const indiaPoints = rawArray
        .filter(d => d.year >= tsStartYear && d.year <= tsEndYear)
        .map(d => ({ x: d.year, y: d["INDIA"] }))
        .filter(p => p.y !== null && !isNaN(p.y));

    // Check if we have any valid data points
    const hasData = indiaPoints.length > 0 || (hasStateSelection && rawArray.some(d => d[stateKey] !== null && !isNaN(d[stateKey])));
    if (!hasData) {
        tsPeriodMeans = {}; // Clear map data
        clearTimeSeriesChartsAndMaps();
        return;
    }

    // 4.5 Calculate Period Means for Map Coloring
    const filteredRows = rawArray.filter(d => d.year >= tsStartYear && d.year <= tsEndYear);
    tsPeriodMeans = {};
    if (filteredRows.length > 0) {
        // Assume first row has all keys (States)
        const keys = Object.keys(filteredRows[0]).filter(k => k !== 'year' && k !== 'year_id');
        keys.forEach(k => {
            const vals = filteredRows.map(row => row[k]).filter(v => v !== null && !isNaN(v));
            if (vals.length > 0) {
                tsPeriodMeans[k] = vals.reduce((acc, v) => acc + v, 0) / vals.length;
            } else {
                tsPeriodMeans[k] = null;
            }
        });
    }

    const datasets = [];

    if (hasStateSelection) {
        const statePoints = rawArray
            .filter(d => d.year >= tsStartYear && d.year <= tsEndYear)
            .map(d => ({ x: d.year, y: d[stateKey] }))
            .filter(p => p.y !== null && !isNaN(p.y));

        datasets.push({
            label: displayStateName.toUpperCase(),
            data: statePoints,
            borderColor: '#ef4444',
            borderWidth: isMobile ? 1.2 : 3,
            pointRadius: isMobile ? 1.5 : 3,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#ef4444',
            pointBorderWidth: isMobile ? 1 : 2.5,
            pointHoverRadius: isMobile ? 3 : 5,
            pointHoverBackgroundColor: '#ef4444',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
            pointHitRadius: 10,
            fill: false,
            tension: 0.4,
            order: 1
        });
    }

    datasets.push({
        label: `INDIA`,
        data: indiaPoints,
        borderColor: '#22c55e',
        borderWidth: isMobile ? 1.2 : 3,
        pointRadius: hasStateSelection ? 0 : (isMobile ? 1.5 : 3),
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#22c55e',
        pointBorderWidth: isMobile ? 1 : 2.5,
        pointHoverRadius: isMobile ? 3 : 5,
        pointHoverBackgroundColor: '#22c55e',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2,
        pointHitRadius: 10,
        fill: false,
        tension: 0.4,
        order: 2
    });

    // 4.7 Calculate Unified Y-Axis Limits (Global across all scenarios for comparison)
    let yMin = null, yMax = null;
    const scenariosToPulse = ['ssp126', 'ssp245', 'ssp370', 'ssp585'];
    let allVals = [];

    scenariosToPulse.forEach(scen => {
        const scenData = tsFullData[jsKey]?.[seasonKey]?.[scen];
        if (scenData) {
            scenData.filter(d => d.year >= tsStartYear && d.year <= tsEndYear).forEach(d => {
                if (d["INDIA"] !== null && !isNaN(d["INDIA"])) allVals.push(d["INDIA"]);
                if (stateKey && tsTriggeredByMap && d[stateKey] !== null && !isNaN(d[stateKey])) allVals.push(d[stateKey]);
            });
        }
    });

    if (allVals.length > 0) {
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const pad = (max - min) * 0.12 || 0.1;
        yMin = min - pad;
        yMax = max + pad;
    } else {
        yMin = 0;
        yMax = 1;
    }

    // 5. Render Chart
    if (tsChart) tsChart.destroy();
    // Clean up orphaned tooltip element
    const oldTooltip = document.getElementById('chartjs-tooltip');
    if (oldTooltip) oldTooltip.remove();

    const ctx = canvas.getContext('2d');

    tsChart = new Chart(ctx, {
        type: 'line',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            parsing: {
                xAxisKey: 'x',
                yAxisKey: 'y'
            },
            scales: {
                x: {
                    type: 'linear',
                    min: tsStartYear === 2015 ? 2010 : Math.floor(tsStartYear / 5) * 5,
                    max: tsEndYear === 2099 ? 2100 : Math.ceil(tsEndYear / 5) * 5,
                    bounds: 'data',
                    grid: { display: false },
                    ticks: {
                        color: '#000000',
                        font: { weight: '750', size: isMobile ? 9 : 12 },
                        stepSize: 5,
                        minRotation: 90,
                        maxRotation: 90,
                        callback: val => val
                    },
                    border: { display: false },
                    title: {
                        display: true,
                        text: 'Year',
                        color: '#000000',
                        font: { weight: '800', size: isMobile ? 10 : 14 }
                    }
                },
                y: {
                    grid: {
                        color: (context) => context.tick.value === 0 ? '#000000' : 'rgba(0,0,0,0.03)',
                        lineWidth: (context) => (context.tick.value === 0) ? 1 : 1,
                        drawTicks: false
                    },
                    ticks: {
                        color: '#000000',
                        font: { weight: '750', size: isMobile ? 9 : 12 },
                        padding: isMobile ? 3 : 8
                    },
                    border: { display: true, color: '#000000', width: isMobile ? 1 : 2 },
                    suggestedMin: yMin !== null ? Math.min(0, yMin) : 0,
                    suggestedMax: yMax !== null ? yMax : undefined,
                    title: {
                        display: true,
                        text: getTitleCaseYTitle(varCfg),
                        color: '#000000',
                        font: { weight: '850', size: isMobile ? 9 : 16 },
                        padding: isMobile ? 4 : 15
                    }
                }
            },
            layout: {
                padding: { top: isMobile ? 2 : 0, bottom: isMobile ? 12 : 0, left: isMobile ? 0 : 5, right: isMobile ? 2 : 0 }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'center', // Center them but with a large gap
                    onClick: (e, legendItem, legend) => {
                        const index = legendItem.index;
                        const ci = legend.chart;
                        if (ci.isDatasetVisible(index)) {
                            ci.hide(index);
                        } else {
                            ci.show(index);
                        }
                    },
                    labels: {
                        boxWidth: isMobile ? 8 : 12,
                        boxHeight: isMobile ? 8 : 12,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        padding: isMobile ? 16 : 10,
                        font: {
                            size: isMobile ? 9.5 : 14,
                            weight: '850', // Heavier weight as in image
                            family: "'Outfit', sans-serif"
                        },
                        generateLabels: (chart) => {
                            const datasets = chart.data.datasets;
                            return datasets.map((ds, i) => {
                                const isVisible = chart.isDatasetVisible(i);
                                // Massive gap between items on desktop, but flush symbols to text
                                const labelText = i === 0 ? ds.label + (isMobile ? "     " : "                        ") : ds.label;
                                return {
                                    text: labelText,
                                    fillStyle: isVisible ? 'rgba(255, 255, 255, 1)' : 'transparent',
                                    strokeStyle: isVisible ? ds.borderColor : '#cbd5e1',
                                    lineWidth: 2.2,
                                    hidden: false,
                                    index: i,
                                    fontColor: isVisible ? ds.borderColor : '#cbd5e1',
                                    pointStyle: 'rectRounded'
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    enabled: false,
                    position: 'nearest',
                    external: function (context) {
                        let tooltipEl = document.getElementById('chartjs-tooltip');
                        if (!tooltipEl) {
                            tooltipEl = document.createElement('div');
                            tooltipEl.id = 'chartjs-tooltip';
                            tooltipEl.className = 'district-tooltip ts-custom-tooltip';
                            document.body.appendChild(tooltipEl);
                        }

                        const tooltipModel = context.tooltip;
                        if (tooltipModel.opacity === 0) {
                            tooltipEl.style.opacity = 0;
                            return;
                        }

                        if (tooltipModel.body) {
                            const year = tooltipModel.dataPoints[0].raw.x;
                            let html = `<div class="badge-year">${year}</div>`;

                            tooltipModel.dataPoints.forEach(dp => {
                                const val = dp.raw.y;
                                const isPos = val > 0;
                                const arrow = isPos ? '▲' : '▼';
                                const valStr = (isPos ? '+' : '') + val.toFixed(2);
                                let label = (dp.dataset.label === 'INDIA') ? 'IN' : (stateAcronyms[dp.dataset.label.toUpperCase()] || dp.dataset.label);

                                html += `
                                    <div class="badge-row">
                                        <span class="badge-label" style="color:${dp.dataset.borderColor}">${label}</span>
                                        <span class="badge-val" style="color:${dp.dataset.borderColor}">
                                            <span class="trend-icon">${arrow}</span> ${valStr}<small>${varCfg.unit}</small>
                                        </span>
                                    </div>
                                `;
                            });
                            tooltipEl.innerHTML = html;
                        }

                        const position = context.chart.canvas.getBoundingClientRect();
                        tooltipEl.style.opacity = 1;
                        tooltipEl.style.position = 'fixed';
                        tooltipEl.style.left = position.left + tooltipModel.caretX + 'px';
                        tooltipEl.style.top = position.top + tooltipModel.caretY - 95 + 'px';
                        tooltipEl.style.pointerEvents = 'none';
                        tooltipEl.style.transition = 'all 0.1s cubic-bezier(0.23, 1, 0.32, 1)';
                    }
                }
            }
        },
        plugins: [{
            id: 'verticalLine',
            afterDraw: chart => {
                if (chart.tooltip?._active?.length) {
                    let x = chart.tooltip._active[0].element.x;
                    let yAxis = chart.scales.y;
                    let ctx = chart.ctx;
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash([8, 4]); // Longer dashes for tech feel
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)'; // Deep slate crosshair
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }, {
            id: 'zeroLineTicks',
            beforeDraw: chart => {
                const { ctx, chartArea, scales } = chart;
                const xScale = scales.x;
                const yScale = scales.y;
                const yZeroPixel = yScale.getPixelForValue(0);
                if (yZeroPixel >= chartArea.top && yZeroPixel <= chartArea.bottom) {
                    ctx.save();
                    ctx.strokeStyle = '#000000';
                    const isPhone = window.innerWidth <= 767;
                    ctx.lineWidth = isPhone ? 0.5 : 1;
                    const tickHalfLength = isPhone ? 1.5 : 3;
                    xScale.ticks.forEach(tick => {
                        const xPixel = xScale.getPixelForValue(tick.value);
                        if (xPixel >= chartArea.left && xPixel <= chartArea.right) {
                            ctx.beginPath();
                            ctx.moveTo(xPixel, yZeroPixel - tickHalfLength);
                            ctx.lineTo(xPixel, yZeroPixel + tickHalfLength);
                            ctx.stroke();
                        }
                    });
                    ctx.restore();
                }
            }
        }]
    });

    // Hide tooltip when mouse leaves the chart canvas
    canvas.addEventListener('mouseleave', () => {
        const tip = document.getElementById('chartjs-tooltip');
        if (tip) tip.style.opacity = 0;
    }, { once: false });

    // 6. Render Bar Chart
    updateTimeSeriesBarChart(varCfg, scenario);
}

function updateTimeSeriesBarChart(varCfg, scenario) {
    const isMobile = window.innerWidth <= 1024;
    const canvas = document.getElementById('time-series-bar-chart');
    if (!canvas) return;

    // 1. Update Title in Header
    const barTitleEl = document.querySelector('#bar-graph-header span');
    if (barTitleEl) {
        if (isMobile) {
            barTitleEl.innerHTML = 'STATE-WISE COMPARISON BAR GRAPH';
        } else {
            const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
            barTitleEl.innerHTML = `State-Wise Comparison of <span style="font-weight:850; margin:0 4px;">${seasonLabel} ${varCfg.label}</span> <span style="font-weight:750; margin-right:4px;">(${scenario})</span> Averaged Between <span style="font-weight:850; margin-left:4px;">${tsStartYear} to ${tsEndYear}</span>`;
        }
        barTitleEl.style.color = '#000000';
    }

    // Prepare data
    let items = Object.keys(stateAcronyms)
        .map(stateName => {
            const acronym = stateAcronyms[stateName];
            const val = tsPeriodMeans[stateName.toUpperCase()] || null;
            return { stateName, acronym, val };
        })
        .filter(item => item.val !== null);

    // Filter by selection
    items = items.filter(item => tsVisibleStates.size === 0 || tsVisibleStates.has(item.stateName));

    // Sorting Logic
    if (tsBarSort === 'az') items.sort((a, b) => a.acronym.localeCompare(b.acronym));
    else if (tsBarSort === 'za') items.sort((a, b) => b.acronym.localeCompare(a.acronym));
    else if (tsBarSort === 'asc') items.sort((a, b) => a.val - b.val);
    else if (tsBarSort === 'desc') items.sort((a, b) => b.val - a.val);

    tsBarDataItems = items;

    // Decide between Acronyms and Full Names based on count
    const useFullNames = tsBarDataItems.length <= 10;
    const labels = tsBarDataItems.map(d => {
        if (!useFullNames) return d.acronym;
        // Convert to Title Case for better look
        return d.stateName.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    });
    const data = tsBarDataItems.map(d => d.val);

    // Calculate anchored Y-limits based on all scenarios (global bounds)
    let barYMin = null, barYMax = null;
    const scenariosToPulse = ['ssp126', 'ssp245', 'ssp370', 'ssp585'];
    let allScenarioMeans = [];

    scenariosToPulse.forEach(scen => {
        const scenData = tsFullData[varCfg.json_key]?.[tsSeason]?.[scen];
        if (scenData) {
            const scenFiltered = scenData.filter(d => d.year >= tsStartYear && d.year <= tsEndYear);
            if (scenFiltered.length > 0) {
                const keys = Object.keys(scenFiltered[0]).filter(k => k !== 'year' && k !== 'year_id');
                keys.forEach(k => {
                    const vals = scenFiltered.map(r => r[k]).filter(v => v !== null && !isNaN(v));
                    if (vals.length > 0) allScenarioMeans.push(vals.reduce((a, b) => a + b, 0) / vals.length);
                });
            }
        }
    });

    if (allScenarioMeans.length > 0) {
        const min = Math.min(...allScenarioMeans);
        const max = Math.max(...allScenarioMeans);
        const pad = (max - min) * 0.08 || 0.1;
        barYMin = min - pad;
        barYMax = max + pad;
    } else {
        barYMin = 0;
        barYMax = 1;
    }

    const ctx = canvas.getContext('2d');

    // Create Gradient for Bars
    const barGrad = ctx.createLinearGradient(0, 0, 0, 400);
    barGrad.addColorStop(0, '#3b82f6'); // Modern Blue
    barGrad.addColorStop(1, '#1d4ed8'); // Deep Blue

    // Track mouse for pointer-relative tooltip (guarded to prevent listener stacking)
    if (!canvas._mouseMoveAttached) {
        canvas.addEventListener('mousemove', (e) => {
            canvas._lastMouseX = e.clientX;
            canvas._lastMouseY = e.clientY;
        });
        canvas.addEventListener('mouseleave', () => {
            const tip = document.getElementById('chartjs-tooltip');
            if (tip) tip.style.opacity = 0;
        });
        canvas._mouseMoveAttached = true;
    }

    if (tsBarChart) {
        // Update existing chart instance dynamically to avoid canvas collapse and layout jerk
        tsBarChart.data.labels = labels;
        tsBarChart.data.datasets[0].label = varCfg.label;
        tsBarChart.data.datasets[0].data = data;
        tsBarChart.data.datasets[0].backgroundColor = barGrad;
        tsBarChart.data.datasets[0].categoryPercentage = isMobile ? 0.78 : 0.9;
        tsBarChart.data.datasets[0].barPercentage = isMobile ? 0.85 : 0.9;
 
        tsBarChart.options.scales.x.ticks.autoSkip = false;
        tsBarChart.options.scales.x.ticks.font.size = isMobile ? 7.5 : (useFullNames ? 14 : 12);
        tsBarChart.options.scales.x.ticks.maxRotation = isMobile ? 90 : 45;
        tsBarChart.options.scales.x.ticks.minRotation = isMobile ? 90 : 0;
        tsBarChart.options.scales.y.border = { display: true, color: '#000000', width: isMobile ? 1 : 2 };
        tsBarChart.options.scales.y.suggestedMin = barYMin !== null ? Math.min(0, barYMin) : 0;
        tsBarChart.options.scales.y.suggestedMax = barYMax !== null ? barYMax : undefined;
        tsBarChart.options.scales.y.title.display = true;
        tsBarChart.options.scales.y.title.text = getTitleCaseYTitle(varCfg);
        tsBarChart.options.scales.y.title.font = { size: isMobile ? 9 : 16, weight: '900' };
        tsBarChart.options.scales.y.title.padding = isMobile ? 8 : 15;
        tsBarChart.options.scales.y.ticks.font = { size: isMobile ? 9 : 12, weight: '750' };
        tsBarChart.options.scales.y.ticks.padding = isMobile ? 3 : 8;
        tsBarChart.options.layout.padding = {
            top: isMobile ? 2 : 0,
            bottom: isMobile ? 2 : 15,
            left: isMobile ? 8 : 5,
            right: isMobile ? 2 : 0
        };
 
        tsBarChart.update();
    } else {
        // Clean up orphaned tooltip element from bar chart
        const oldBarTooltip = document.getElementById('chartjs-tooltip');
        if (oldBarTooltip) oldBarTooltip.remove();

        tsBarChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: varCfg.label,
                    data: data,
                    backgroundColor: barGrad,
                    hoverBackgroundColor: '#60a5fa',
                    borderRadius: 6,
                    borderSkipped: false,
                    categoryPercentage: isMobile ? 0.78 : 0.9,
                    barPercentage: isMobile ? 0.85 : 0.9
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                },
                layout: {
                    padding: {
                        top: isMobile ? 2 : 0,
                        bottom: isMobile ? 2 : 15,
                        left: isMobile ? 0 : 5,
                        right: isMobile ? 2 : 0
                    }
                },
                onHover: (evt, elements, chart) => {
                    const activeChart = chart || evt.chart;
                    if (activeChart && activeChart.canvas) {
                        activeChart.canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const stateName = tsBarDataItems[idx].stateName;
                        const featureKey = Object.keys(window.dataLookup).find(k => k.toUpperCase() === stateName.toUpperCase());
                        if (featureKey) syncHover(featureKey, null, true, null, 'bar');
                    } else {
                        syncHover(null, null, false, null, 'bar');
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        position: 'nearest',
                        external: function (context) {
                            let tooltipEl = document.getElementById('chartjs-tooltip');
                            if (!tooltipEl) {
                                tooltipEl = document.createElement('div');
                                tooltipEl.id = 'chartjs-tooltip';
                                tooltipEl.className = 'district-tooltip ts-custom-tooltip';
                                document.body.appendChild(tooltipEl);
                            }

                            const tooltipModel = context.tooltip;
                            if (tooltipModel.opacity === 0) {
                                tooltipEl.style.opacity = 0;
                                return;
                            }

                            if (tooltipModel.body) {
                                const dp = tooltipModel.dataPoints[0];
                                const item = tsBarDataItems[dp.dataIndex];
                                const valStr = (item.val > 0 ? '+' : '') + item.val.toFixed(2);

                                tooltipEl.innerHTML = `
                                    <div class="tooltip-val" style="color:#2563eb; font-size:1.4rem;">${valStr} ${varCfg.unit}</div>
                                    <div class="tooltip-dist" style="font-weight:850; font-size:1rem;">${item.stateName}</div>
                                    <div class="tooltip-state">${tsStartYear}-${tsEndYear} Average</div>
                                `;
                            }

                            tooltipEl.style.opacity = 1;
                            tooltipEl.style.position = 'fixed';
                            // Move to current mouse pointer (using clientX/Y for iframe safety)
                            tooltipEl.style.left = (context.chart.canvas._lastMouseX || 0) + 'px';
                            tooltipEl.style.top = (context.chart.canvas._lastMouseY || 0) - 100 + 'px';
                            tooltipEl.style.pointerEvents = 'none';
                            tooltipEl.style.transition = 'opacity 0.1s ease';
                        }
                    }
                },
                onClick: (evt, elements) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const stateName = tsBarDataItems[idx].stateName;
                        const featureKey = Object.keys(window.dataLookup).find(k => k.toUpperCase() === stateName.toUpperCase());
                        if (featureKey) selectFeature(featureKey, true, true);
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            autoSkip: false,
                            font: { size: isMobile ? 7.5 : (useFullNames ? 14 : 12), weight: '900' },
                            color: '#000000',
                            padding: isMobile ? 3 : 6,
                            maxRotation: isMobile ? 90 : 45,
                            minRotation: isMobile ? 90 : 0
                        },
                        grid: { display: false },
                        border: { display: false }
                    },
                    y: {
                        grid: {
                            color: (context) => {
                                if (context.tick.value === 0) return data.some(v => v < 0) ? '#000000' : 'transparent';
                                return 'rgba(0,0,0,0.03)';
                            },
                            lineWidth: (context) => (context.tick.value === 0 && data.some(v => v < 0)) ? 1 : 1,
                            drawTicks: false
                        },
                        border: { display: true, color: '#000000', width: isMobile ? 1 : 2 },
                        suggestedMin: barYMin !== null ? Math.min(0, barYMin) : 0,
                        suggestedMax: barYMax !== null ? barYMax : undefined,
                        ticks: {
                            color: '#000000',
                            font: { weight: '750', size: isMobile ? 9 : 12 },
                            padding: isMobile ? 3 : 8
                        },
                        title: {
                            display: true,
                            text: getTitleCaseYTitle(varCfg),
                            font: { size: isMobile ? 9 : 16, weight: '900' },
                            color: '#000000',
                            padding: isMobile ? 4 : 15
                        }
                    }
                }
            }
        });
    }
}

function renderTimeSeriesHeader(container, stateName, varLabel, scenario) {
    const isMobile = window.innerWidth <= 1024;
    const seasons = isMobile ? [
        { id: 'annual', label: 'ANNUAL' },
        { id: 'mam', label: 'MAM' },
        { id: 'jjas', label: 'JJAS' },
        { id: 'son', label: 'SON' },
        { id: 'djf', label: 'DJF' }
    ] : [
        { id: 'annual', label: 'ANNUAL' },
        { id: 'mam', label: 'MAM (Mar-May)' },
        { id: 'jjas', label: 'JJAS (Jun-Sep)' },
        { id: 'son', label: 'SON (Sep-Nov)' },
        { id: 'djf', label: 'DJF (Dec-Feb)' }
    ];

    if (isMobile) {
        container.innerHTML = `
            <div class="ts-control-group" style="color:#000000; font-size: 0.72rem; font-weight: 850;">
                <div class="ts-header-row" style="display:inline-flex; align-items:center; gap:5px; justify-content:center; width:100%;">
                    <span>TIME SERIES</span>
                    <select class="ts-select" id="ts-season-select" style="font-weight:850;">
                        ${seasons.map(s => `<option value="${s.id}" ${tsSeason === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                    <div class="year-picker-container">
                        <button class="year-picker-btn" id="start-year-trigger" style="font-weight:850; font-size:0.72rem; padding: 2px 4px;">${tsStartYear}</button>
                        <div class="year-picker-popup" id="start-picker-popup">
                            <div class="picker-header"><span>Select Start Year</span></div>
                            <div class="year-grid" id="start-year-grid"></div>
                        </div>
                    </div>
                    <span style="font-weight:800; font-size:0.7rem; color:#000000;">TO</span>
                    <div class="year-picker-container">
                        <button class="year-picker-btn" id="end-year-trigger" style="font-weight:850; font-size:0.72rem; padding: 2px 4px;">${tsEndYear}</button>
                        <div class="year-picker-popup" id="end-picker-popup">
                            <div class="picker-header"><span>Select End Year</span></div>
                            <div class="year-grid" id="end-year-grid"></div>
                        </div>
                    </div>
                    <button id="download-line-chart" class="chart-download-btn" title="Download Line Chart as PNG">
                        <img src="assets/icons/lucide-download.svg" alt="Download">
                    </button>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="ts-control-group" style="color:#000000;">
                <div class="ts-header-row">
                    Time Series of <span id="ts-title-state" style="font-weight:850; margin:0 4px; color:#000000;">${stateName}</span> for 
                    <select class="ts-select" id="ts-season-select" style="margin-right:8px;">
                        ${seasons.map(s => `<option value="${s.id}" ${tsSeason === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                </div>
                <div class="ts-header-row">
                    <span id="ts-title-varlabel" style="margin-right:8px; color:#000000; font-weight:850;">${varLabel}</span>
                    <span id="ts-title-scenario" style="font-weight:750; margin-right:4px; color:#000000;">(${scenario})</span> 
                </div>
                <div class="ts-header-row" style="display:inline-flex; align-items:center; gap:6px; margin-left:8px;">
                    <div class="year-picker-container">
                        <button class="year-picker-btn" id="start-year-trigger">${tsStartYear}</button>
                        <div class="year-picker-popup" id="start-picker-popup">
                            <div class="picker-header"><span>Select Start Year</span></div>
                            <div class="year-grid" id="start-year-grid"></div>
                        </div>
                    </div>
                    <span style="font-weight:700; font-size:0.75rem; color:#000000;">to</span>
                    <div class="year-picker-container">
                        <button class="year-picker-btn" id="end-year-trigger">${tsEndYear}</button>
                        <div class="year-picker-popup" id="end-picker-popup">
                            <div class="picker-header"><span>Select End Year</span></div>
                            <div class="year-grid" id="end-year-grid"></div>
                        </div>
                    </div>
                    <button id="download-line-chart" class="chart-download-btn" title="Download Line Chart as PNG" style="margin-left:12px;">
                        <img src="assets/icons/lucide-download.svg" alt="Download">
                    </button>
                </div>
            </div>
        `;
    }

    const setupPicker = (type) => {
        const isStart = type === 'start';
        const trigger = container.querySelector(isStart ? '#start-year-trigger' : '#end-year-trigger');
        const popup = container.querySelector(isStart ? '#start-picker-popup' : '#end-picker-popup');
        const grid = container.querySelector(isStart ? '#start-year-grid' : '#end-year-grid');

        const render = () => {
            grid.innerHTML = '';
            for (let y = 2015; y <= 2099; y++) {
                const cell = document.createElement('button');
                cell.className = 'year-cell';
                cell.innerText = y;

                const otherVal = isStart ? tsEndYear : tsStartYear;
                const isInvalid = isStart ? (y > otherVal - 30) : (y < otherVal + 30);
                const isActive = (isStart && y === tsStartYear) || (!isStart && y === tsEndYear);

                if (isInvalid) cell.classList.add('disabled');
                if (isActive) cell.classList.add('active');

                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (isInvalid) return;
                    if (isStart) {
                        tsStartYear = y;
                        trigger.innerText = y;
                        popup.classList.remove('visible');
                        updateDashboard();
                        // Auto jump
                        const endTrigger = container.querySelector('#end-year-trigger');
                        setTimeout(() => endTrigger.click(), 150);
                    } else {
                        tsEndYear = y;
                        trigger.innerText = y;
                        popup.classList.remove('visible');
                        updateDashboard();
                    }
                });
                grid.appendChild(cell);
            }
        };

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.year-picker-popup').forEach(p => { if (p !== popup) p.classList.remove('visible'); });
            const willShow = !popup.classList.contains('visible');
            popup.classList.toggle('visible', willShow);
            if (willShow) render();
        });
    };

    setupPicker('start');
    setupPicker('end');

    // Remove previous global click handler before adding a new one (prevents leak)
    if (_yearPickerClickHandler) {
        document.removeEventListener('click', _yearPickerClickHandler);
    }
    _yearPickerClickHandler = (e) => {
        if (!e.target.closest('.year-picker-container')) {
            document.querySelectorAll('.year-picker-popup').forEach(p => p.classList.remove('visible'));
        }
    };
    document.addEventListener('click', _yearPickerClickHandler);

    container.querySelector('#ts-season-select').addEventListener('change', (e) => {
        tsSeason = e.target.value;
        updateDashboard();
    });

    const dlLineBtn = container.querySelector('#download-line-chart');
    if (dlLineBtn) {
        dlLineBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.openExportStudio('line-chart');
        });
    }
}

function populateSearch() {
    const input = document.getElementById('district-search');
    const container = document.getElementById('search-results');
    if (!input || !container || !datasetJSON) return;

    let selectedIdx = -1;
    let matches = [];

    const updateResults = () => {
        const cfg = levelsCfg[currentLevel]; // Always use current level
        const val = input.value.toLowerCase().trim();
        if (val.length < 1) { container.classList.remove('visible'); return; }
        matches = datasetJSON.filter(row => {
            const label = cfg.searchLabel(row).toLowerCase();
            const sub = cfg.searchSub(row).toLowerCase();
            return label.includes(val) || sub.includes(val);
        }).slice(0, 10);

        container.innerHTML = matches.map((row, i) => `
            <div class="search-item ${i === selectedIdx ? 'selected' : ''}" data-index="${i}">
                <div class="search-item-main">${cfg.searchLabel(row)}</div>
                ${cfg.searchSub(row) ? `<div class="search-item-sub">${cfg.searchSub(row)}</div>` : ""}
            </div>
        `).join('');
        container.classList.toggle('visible', matches.length > 0);
    };

    // Only attach DOM event listeners once; on subsequent calls just update closure refs
    if (!_searchInitialized) {
        input.addEventListener('focus', () => {
            const accordion = document.getElementById('mobile-filter-accordion');
            if (accordion && accordion.classList.contains('open')) {
                document.getElementById('filter-accordion-toggle')?.click();
            }
        });
        input.addEventListener('input', () => updateResults());
        input.addEventListener('keydown', (e) => {
            if (!container.classList.contains('visible')) return;
            const cfg = levelsCfg[currentLevel];
            if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = (selectedIdx + 1) % matches.length; updateResults(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = (selectedIdx - 1 + matches.length) % matches.length; updateResults(); }
            else if (e.key === 'Enter' && selectedIdx > -1) { selectFeature(cfg.rowKeyGen(matches[selectedIdx]), true); container.classList.remove('visible'); input.blur(); }
        });

        container.addEventListener('click', (e) => {
            const item = e.target.closest('.search-item');
            if (item) {
                const cfg = levelsCfg[currentLevel];
                const idx = parseInt(item.dataset.index);
                selectFeature(cfg.rowKeyGen(matches[idx]), true);
                container.classList.remove('visible');
            }
        });

        document.getElementById('clear-search')?.addEventListener('click', clearSelection);
        _searchInitialized = true;
    }
}


// Controls, View Transitions, and Initial Load
(() => {
    const metricSelect = document.getElementById('metric-select');
    const sspRadios = document.querySelectorAll('input[name="ssp"]');
    const labels = ['SSP126', 'SSP245', 'SSP370', 'SSP585'];

    window.selectedMetric = () => metricSelect?.value || 'mean_temp';
    window.selectedScenario = () => {
        const checked = Array.from(sspRadios).find(r => r.checked);
        return labels[parseInt(checked?.value || 3)];
    };

    if (metricSelect) {
        metricSelect.addEventListener('change', updateDashboard);
        metricSelect.addEventListener('change', () => {
            const accordion = document.getElementById('mobile-filter-accordion');
            if (accordion) accordion.classList.remove('open');
        });
    }
    if (sspRadios) sspRadios.forEach(r => r.addEventListener('change', updateDashboard));

    // View Mode Toggle Logic
    const viewToggle = document.getElementById('view-mode-toggle');
    if (viewToggle) {
        viewToggle.addEventListener('change', () => {
            const isTimeSeries = viewToggle.checked;
            
            // Auto-close control panel on mobile
            const accordion = document.getElementById('mobile-filter-accordion');
            if (accordion) accordion.classList.remove('open');

            const containers = document.querySelectorAll('.map-container');
            containers.forEach(c => c.classList.add('is-loading'));

            if (isTimeSeries) {
                // Entering Time Series: Immediate update
                document.body.classList.add('time-series-mode');
                // If checking manually (without triggerSwitch), ensure no red line
                if (!tsTriggeredByMap) {
                    // Logic to clear potential leftover or just keep it false
                }
                updateDashboard();
                setTimeout(() => {
                    Object.values(mapViews).forEach(m => {
                        m.invalidateSize();
                        if (lockedFeatureKey) {
                            const layer = layersMap['near'][lockedFeatureKey];
                            if (layer) {
                                m.setView(layer.getBounds().getCenter(), 5.5, { animate: false });
                                return;
                            }
                        }
                        m.setView([22.9734, 82.5], startZoom, { animate: false });
                    });
                    containers.forEach(c => c.classList.remove('is-loading'));
                    if (lockedFeatureKey) {
                        const layer = layersMap['near'][lockedFeatureKey];
                        if (layer) {
                            syncHover(lockedFeatureKey, null, true, layer.getBounds().getCenter());
                        }
                    }
                    if (tsChart) tsChart.resize();
                    if (tsBarChart) tsBarChart.resize();
                }, 800);
            } else {
                // Exiting Time Series: Sequence the layout first
                tsTriggeredByMap = false; // Reset when leaving
                document.body.classList.add('is-animating-spatial');
                document.body.classList.remove('time-series-mode');

                // Wait for the 0.7s card transition before restoring content
                setTimeout(() => {
                    document.body.classList.remove('is-animating-spatial');
                    // Reset specialized headers
                    const midHeader = document.getElementById('mid-term-header');
                    if (midHeader) midHeader.innerHTML = `${terms['mid'].label} (2050-2070)`;

                    updateDashboard();
                    Object.values(mapViews).forEach(m => {
                        m.invalidateSize();
                        if (lockedFeatureKey) {
                            const layer = layersMap['near'][lockedFeatureKey];
                            if (layer) {
                                m.setView(layer.getBounds().getCenter(), 5, { animate: false });
                                return;
                            }
                        }
                        m.setView([22.9734, 82.5], startZoom, { animate: false });
                    });
                    containers.forEach(c => c.classList.remove('is-loading'));
                    if (lockedFeatureKey) {
                        const layer = layersMap['near'][lockedFeatureKey];
                        if (layer) {
                            syncHover(lockedFeatureKey, null, true, layer.getBounds().getCenter());
                        }
                    }
                }, 800);
            }
        });
    }

    // Bar Chart Sort Listener
    document.getElementById('bar-sort-select')?.addEventListener('change', (e) => {
        tsBarSort = e.target.value;
        refreshBarChart();
    });

    // Bar Chart Filter Setup
    setupBarFilter();

    // Auto-trigger Time Series mode if mode=ts query parameter is present
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'ts') {
        const viewToggle = document.getElementById('view-mode-toggle');
        if (viewToggle) {
            viewToggle.checked = true;
            document.body.classList.add('time-series-mode');
        }
    }

    // Initial load
    load();
})();

function refreshBarChart() {
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    if (variablesConfig) {
        updateTimeSeriesBarChart(variablesConfig[metric], scenario);
    }
}

function setupBarFilter() {
    const list = document.getElementById('filter-states-list');
    const filterAll = document.getElementById('filter-all');
    const filterBtn = document.getElementById('bar-filter-btn');
    const filterMenu = document.getElementById('bar-filter-menu');
    if (!list) return;

    const states = Object.keys(stateAcronyms).sort();
    tsVisibleStates = new Set(states);

    list.innerHTML = states.map(s => `
        <label class="filter-option">
            <input type="checkbox" class="state-filter-check" value="${s}" checked>
            <span>${s}</span>
        </label>
    `).join('');

    const checks = list.querySelectorAll('.state-filter-check');

    const updateCount = () => {
        const count = tsVisibleStates.size;
        filterBtn.innerText = `Filter States (${count})`;
    };

    checks.forEach(chk => {
        chk.addEventListener('change', () => {
            if (chk.checked) {
                tsVisibleStates.add(chk.value);
            } else {
                // Minimum selection enforcement: Cannot have less than 2 states
                if (tsVisibleStates.size <= 2) {
                    chk.checked = true; // Re-check visually
                    return;
                }
                tsVisibleStates.delete(chk.value);
            }
            updateCount();
            refreshBarChart();
        });
    });

    filterBtn?.addEventListener('click', (e) => {
        filterMenu.classList.toggle('visible');
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (filterMenu && !filterMenu.contains(e.target)) filterMenu.classList.remove('visible');
    });
}

// Export Helper Functions
function downloadChartPNG(canvasId, filename) {
    const originalCanvas = document.getElementById(canvasId);
    if (!originalCanvas) return;

    // Create a temporary canvas in memory to paint a solid white background
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalCanvas.width;
    tempCanvas.height = originalCanvas.height;

    const ctx = tempCanvas.getContext('2d');
    
    // Fill background with solid white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Draw original transparent chart on top
    ctx.drawImage(originalCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = filename;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
}

function downloadMapPNG(term) {
    const mapContainer = document.getElementById(`map-${term}-term`);
    if (!mapContainer) return;
    
    // Temporarily hide map controls during capture so they don't block the map view
    const controls = mapContainer.querySelectorAll('.leaflet-control-container');
    controls.forEach(c => c.style.display = 'none');
    
    // Temporarily hide the basemap tile layer (streets, labels) for a clean vector shape export
    const tilePane = mapContainer.querySelector('.leaflet-tile-pane');
    if (tilePane) tilePane.style.display = 'none';
    
    // Temporarily force solid white background on map container to ensure export isn't transparent
    const originalBg = mapContainer.style.background;
    mapContainer.style.background = '#ffffff';
    
    domtoimage.toPng(mapContainer, {
        width: mapContainer.clientWidth,
        height: mapContainer.clientHeight,
        bgcolor: '#ffffff', // Ensures a solid white background in output PNG
        style: {
            transform: 'none',
            borderRadius: '0px'
        }
    })
    .then((dataUrl) => {
        const link = document.createElement('a');
        link.download = `map-${term}-term.png`;
        link.href = dataUrl;
        link.click();
        
        // Restore controls, tile layer visibility, and background
        controls.forEach(c => c.style.display = 'block');
        if (tilePane) tilePane.style.display = 'block';
        mapContainer.style.background = originalBg;
    })
    .catch((error) => {
        console.error('oops, something went wrong with map download!', error);
        // Restore on error
        controls.forEach(c => c.style.display = 'block');
        if (tilePane) tilePane.style.display = 'block';
        mapContainer.style.background = originalBg;
    });
}

// Setup static download listeners
(() => {
    const dlBarBtn = document.getElementById('download-bar-chart');
    if (dlBarBtn) {
        dlBarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.openExportStudio('bar-chart');
        });
    }
})();

// Helper to update dropdown button text dynamically based on screen width
function updateMetricDropdownButtonText(proj, val, fullLabelText) {
    const dropdownBtn = document.getElementById('metric-dropdown-btn');
    if (!dropdownBtn) return;
    
    const isMobile = window.innerWidth <= 767;
    if (isMobile) {
        const shortNames = {
            'mean_temp': 'tas',
            'max_temp': 'tasmax',
            'min_temp': 'tasmin',
            'precipitation': 'pr'
        };
        const shortName = shortNames[val] || val;
        dropdownBtn.querySelector('span').innerText = `${proj.toUpperCase()}-${shortName}`;
    } else {
        dropdownBtn.querySelector('span').innerText = `${proj.toUpperCase()} - ${fullLabelText}`;
    }
}

// Custom Dropdown JS Logic
(() => {
    const dropdown = document.getElementById('metric-custom-dropdown');
    const dropdownBtn = document.getElementById('metric-dropdown-btn');
    const hiddenSelect = document.getElementById('metric-select');
    if (!dropdown || !dropdownBtn || !hiddenSelect) return;

    // Toggle dropdown on button click
    dropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
            dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                item.classList.remove('open-submenu');
            });
        }
    });

    // Support mobile touch toggle for submenus
    const hasSubmenus = dropdown.querySelectorAll('.dropdown-item.has-submenu');
    hasSubmenus.forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.dropdown-submenu')) return;
            
            const isOpen = item.classList.contains('open-submenu');
            hasSubmenus.forEach(sib => sib.classList.remove('open-submenu'));
            if (!isOpen) {
                item.classList.add('open-submenu');
            }
            e.stopPropagation();
        });
    });

    // Handle submenu item clicks (CMIP6 variables)
    const submenuItems = dropdown.querySelectorAll('.submenu-item');
    submenuItems.forEach(subItem => {
        subItem.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = subItem.getAttribute('data-value');
            const labelText = subItem.textContent;

            // Update hidden select and trigger change event
            hiddenSelect.value = val;
            hiddenSelect.dispatchEvent(new Event('change'));

            const newProj = subItem.closest('.dropdown-item').id === 'cmip7-item' ? 'cmip7' : 'cmip6';
            if (currentProjection !== newProj) {
                currentProjection = newProj;
                tsFullData = null; // Clear cached state time series data so it reloads
            }

            // Update hidden select and trigger change event
            hiddenSelect.value = val;
            hiddenSelect.dispatchEvent(new Event('change'));

            // Update dropdown button text
            updateMetricDropdownButtonText(currentProjection, val, labelText);

            // Highlight active item
            dropdown.querySelectorAll('.submenu-item').forEach(sib => sib.classList.remove('active'));
            subItem.classList.add('active');

            // Close dropdown
            dropdown.classList.remove('open');
            hasSubmenus.forEach(sib => sib.classList.remove('open-submenu'));
        });
    });
})();

// CMIP7 Availability Checker
async function checkCMIP7Availability() {
    try {
        const resp = await fetch('CSVs/cmip7_district_anomalies.csv');
        if (resp.ok) {
            enableCMIP7Menu();
        }
    } catch (e) {
        console.log("CMIP7 file not available yet.");
    }
}

function enableCMIP7Menu() {
    const cmip7Item = document.getElementById('cmip7-item');
    if (!cmip7Item) return;

    const submenu = cmip7Item.querySelector('.dropdown-submenu');
    if (submenu) {
        submenu.classList.remove('coming-soon');
        submenu.innerHTML = `
            <div class="submenu-item" data-value="mean_temp">Mean Temperature</div>
            <div class="submenu-item" data-value="max_temp">Max Temperature</div>
            <div class="submenu-item" data-value="min_temp">Min Temperature</div>
            <div class="submenu-item" data-value="precipitation">Precipitation</div>
        `;

        // Attach click listeners to the dynamically added CMIP7 submenu items
        const newItems = submenu.querySelectorAll('.submenu-item');
        newItems.forEach(subItem => {
            subItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = subItem.getAttribute('data-value');
                const labelText = subItem.textContent;

                const dropdown = document.getElementById('metric-custom-dropdown');
                const dropdownBtn = document.getElementById('metric-dropdown-btn');
                const hiddenSelect = document.getElementById('metric-select');

                const newProj = 'cmip7';
                if (currentProjection !== newProj) {
                    currentProjection = newProj;
                    tsFullData = null; // Clear cached state time series data so it reloads
                }

                // Update hidden select and trigger change event
                hiddenSelect.value = val;
                hiddenSelect.dispatchEvent(new Event('change'));

                // Update dropdown button text
                updateMetricDropdownButtonText('cmip7', val, labelText);

                // Highlight active item
                dropdown.querySelectorAll('.submenu-item').forEach(sib => sib.classList.remove('active'));
                subItem.classList.add('active');

                // Close dropdown
                dropdown.classList.remove('open');
                dropdown.querySelectorAll('.dropdown-item').forEach(sib => sib.classList.remove('open-submenu'));
            });
        });
    }
}

// Trigger CMIP7 check on load
checkCMIP7Availability();

// Responsive & Mobile Layout Logic
(() => {
    const accordion = document.getElementById('mobile-filter-accordion');
    const toggleBtn = document.getElementById('filter-accordion-toggle');
    const accordionContent = document.getElementById('filter-accordion-content');
    const mapsRow = document.querySelector('.maps-row');
    const prevBtn = document.getElementById('carousel-prev-btn');
    const nextBtn = document.getElementById('carousel-next-btn');

    if (!accordion || !toggleBtn || !accordionContent) return;

    // Toggle Accordion Panel
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = accordion.classList.toggle('open');
        
        // Auto-close search suggestions when accordion opens
        if (isOpen) {
            const searchPopup = document.getElementById('search-results');
            if (searchPopup) searchPopup.classList.remove('visible');
        }
        
        // Trigger map invalidation after toggle animation to keep views sync'd
        setTimeout(() => {
            if (typeof mapViews !== 'undefined') {
                Object.values(mapViews).forEach(m => {
                    if (m) m.invalidateSize();
                });
            }
        }, 350);
    });

    let wasMobile = null;

    // Dynamic Controls Reshuffle based on screen width
    function handleResponsiveLayout() {
        const isMobile = window.innerWidth <= 1024;
        const searchContainer = document.getElementById('desktop-search-container');
        const controlsPanel = document.getElementById('controls-panel');
        const headerInner = document.querySelector('.header-inner');
        const viewToggleArea = document.getElementById('view-toggle-area');

        if (!searchContainer || !controlsPanel || !viewToggleArea) return;

        // Unified default zoom for all screen sizes
        startZoom = 4.0;
        minZoomVal = 3.5;

        if (isMobile !== wasMobile) {
            wasMobile = isMobile;
            if (isMobile) {
                if (accordionContent) {
                    const mobileRow = document.getElementById('mobile-controls-row');
                    if (mobileRow) mobileRow.appendChild(searchContainer);
                    accordionContent.appendChild(viewToggleArea);
                    accordionContent.appendChild(controlsPanel);
                }
            } else {
                if (headerInner) {
                    // Return elements to header in brand -> toggle -> search -> controls sequence
                    headerInner.appendChild(viewToggleArea);
                    headerInner.appendChild(searchContainer);
                    headerInner.appendChild(controlsPanel);
                }
                accordion.classList.remove('open');
            }
        }

        // Update metric dropdown button text dynamically for mobile/desktop layout
        const activeSubmenuItem = document.querySelector('.submenu-item.active');
        if (activeSubmenuItem) {
            const val = activeSubmenuItem.getAttribute('data-value');
            const labelText = activeSubmenuItem.textContent;
            updateMetricDropdownButtonText(currentProjection, val, labelText);
        }

        // Update map headers text if they exist and variablesConfig is loaded
        if (typeof mapViews !== 'undefined' && variablesConfig) {
            const metric = window.selectedMetric?.() || 'mean_temp';
            const scenario = window.selectedScenario?.() || 'SSP585';
            const varCfg = variablesConfig[metric];
            if (varCfg) {
                const isSmallScreen = window.innerWidth <= 1024;
                const variableLabel = isSmallScreen ? `${varCfg.json_key.toUpperCase()} CHANGE` : varCfg.label;
                const isTimeSeries = document.body.classList.contains('time-series-mode');
                Object.keys(terms).forEach(key => {
                    const hdr = document.getElementById(terms[key].id);
                    if (hdr) {
                        if (isTimeSeries) {
                            if (key === 'near') {
                                const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
                                hdr.innerText = `${seasonLabel} ${variableLabel} ${scenario} (${tsStartYear}-${tsEndYear})`;
                            }
                        } else {
                            hdr.innerText = `${terms[key].label} ${variableLabel} ${scenario} ${terms[key].years}`;
                        }
                    }
                });
            }
        }

        // Trigger map invalidation to let Leaflet update its bounds
        setTimeout(() => {
            if (typeof mapViews !== 'undefined') {
                Object.values(mapViews).forEach(m => {
                    if (m) {
                        m.setMinZoom(minZoomVal);
                        m.invalidateSize();
                    }
                });
            }
            if (isMobile) {
                updateCarouselArrows();
            }
            if (typeof tsChart !== 'undefined' && tsChart) tsChart.resize();
            if (typeof tsBarChart !== 'undefined' && tsBarChart) tsBarChart.resize();
        }, 300);
    }

    // Carousel Swipe / Navigation Arrows Syncing
    const termsList = ['near-term', 'mid-term', 'long-term'];
    let currentMobileIndex = 0;

    function updateCarouselArrowsForIndex(activeIndex) {
        if (!prevBtn || !nextBtn) return;

        // Hide/fade prev button at index 0
        if (activeIndex === 0) {
            prevBtn.style.opacity = '0';
            prevBtn.style.pointerEvents = 'none';
        } else {
            prevBtn.style.opacity = '1';
            prevBtn.style.pointerEvents = 'auto';
        }

        // Hide/fade next button at index 2 (last)
        if (activeIndex >= 2) {
            nextBtn.style.opacity = '0';
            nextBtn.style.pointerEvents = 'none';
        } else {
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'auto';
        }

        // Trigger map invalidation for active viewport map
        const termId = termsList[activeIndex];
        if (termId) {
            const termKey = termId.split('-')[0];
            if (typeof mapViews !== 'undefined' && mapViews[termKey]) {
                mapViews[termKey].invalidateSize();
            }
        }
    }

    function updateCarouselArrows() {
        const isMobile = window.innerWidth <= 1024;
        if (!isMobile || !mapsRow) return;

        const scrollLeft = mapsRow.scrollLeft;
        const width = mapsRow.clientWidth || window.innerWidth;
        const activeIndex = Math.round(scrollLeft / width);

        currentMobileIndex = activeIndex;
        updateCarouselArrowsForIndex(activeIndex);
    }

    if (mapsRow && prevBtn && nextBtn) {
        let programmaticScrolling = false;

        // Navigate prev
        prevBtn.addEventListener('click', () => {
            const prevIndex = Math.max(0, currentMobileIndex - 1);
            currentMobileIndex = prevIndex;
            const targetEl = document.getElementById(termsList[prevIndex]);
            if (targetEl) {
                programmaticScrolling = true;
                mapsRow.scrollTo({
                    left: targetEl.offsetLeft - mapsRow.offsetLeft - 8,
                    behavior: 'smooth'
                });
                updateCarouselArrowsForIndex(prevIndex);
                // Release guard after scroll animation completes
                setTimeout(() => { programmaticScrolling = false; }, 600);
            }
        });

        // Navigate next
        nextBtn.addEventListener('click', () => {
            const nextIndex = Math.min(2, currentMobileIndex + 1);
            currentMobileIndex = nextIndex;
            const targetEl = document.getElementById(termsList[nextIndex]);
            if (targetEl) {
                programmaticScrolling = true;
                mapsRow.scrollTo({
                    left: targetEl.offsetLeft - mapsRow.offsetLeft - 8,
                    behavior: 'smooth'
                });
                updateCarouselArrowsForIndex(nextIndex);
                // Release guard after scroll animation completes
                setTimeout(() => { programmaticScrolling = false; }, 600);
            }
        });

        // Sync Carousel Swipe -> Update Arrows (only for user-initiated swipes)
        let scrollTimeout;
        mapsRow.addEventListener('scroll', () => {
            if (programmaticScrolling) return; // Don't fight with button-triggered scrolls
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                updateCarouselArrows();
            }, 150);
        });
    }

    // Run layout adjustments on resize & load
    window.addEventListener('resize', handleResponsiveLayout);
    handleResponsiveLayout();
})();