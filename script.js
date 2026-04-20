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
let tsStartYear = 1950;
let tsEndYear = 2099;
let tsSelectedVar = 'precipitation';

const terms = {
    'near': { id: 'near-term-header', label: 'Near-term', years: '(2025-2036)' },
    'mid': { id: 'mid-term-header', label: 'Mid-term', years: '(2050-2070)' },
    'long': { id: 'long-term-header', label: 'Long-term', years: '(2081-2100)' }
};

// Level configurations
const levelsCfg = {
    district: {
        variables: 'JSONs/District_VARIABLES.json',
        data: 'JSONs/District_DATA.json',
        geojson: 'JSONs/districts_ultra_optimized.geojson',
        keyGen: (props) => `${(props.STATE_UT || "").trim()}|${(props.DISTRICT || "").trim()}`.toLowerCase(),
        rowKeyGen: (row) => `${row.STATE_UT.trim()}|${row.DISTRICT.trim()}`.toLowerCase(),
        placeholder: 'Search District...',
        tooltipName: (row) => row.DISTRICT,
        tooltipState: (row) => row.STATE_UT,
        searchLabel: (row) => row.DISTRICT,
        searchSub: (row) => row.STATE_UT
    },
    state: {
        variables: 'JSONs/State_VARIABLES.json',
        data: 'JSONs/State_DATA.json',
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
    const w = window.innerWidth;
    const isMobile = w <= 768;
    const startZoom = isMobile ? (w < 400 ? 3.4 : 3.6) : 4.5;
    const center = isMobile ? [22.5, 82.5] : [22.9734, 82.5];
    const tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

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
            minZoom: isMobile ? 3 : 4,
            maxZoom: 8,
            zoomSnap: 0.1
        }).setView(center, startZoom);
        L.control.zoom({ position: 'bottomleft' }).addTo(m);
        L.tileLayer(tileUrl, {
            attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(m);
        mapViews[term] = m;

        // Add the level control to this map
        new LevelControl().addTo(m);


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

// Data Loading
async function load() {
    try {
        const config = levelsCfg[currentLevel];
        document.querySelectorAll('.map-container').forEach(c => c.classList.add('is-loading'));

        const [vResp, dResp, gResp] = await Promise.all([
            fetch(config.variables),
            fetch(config.data),
            fetch(config.geojson)
        ]);

        variablesConfig = await vResp.json();
        datasetJSON = await dResp.json();
        datasetGeoJSON = await gResp.json();

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

                layer.on('mouseover', (e) => { if (!lockedFeatureKey) syncHover(featureKey, term, true, e.latlng); });
                layer.on('mousemove', (e) => { if (!lockedFeatureKey) syncHover(featureKey, term, true, e.latlng); });
                layer.on('mouseout', () => { if (!lockedFeatureKey) syncHover(null, term, false); });
                layer.on('click', (e) => {
                    if (lockedFeatureKey === featureKey) clearSelection();
                    else selectFeature(featureKey, false, true); // true = trigger mode switch
                    L.DomEvent.stopPropagation(e);
                });
            }
        }).addTo(mapViews[term]);
    });
}

function selectFeature(featureKey, panTo = false, triggerSwitch = false) {
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

    // Trigger Time Series Mode on selection (Map Click + State Level only)
    const viewToggle = document.getElementById('view-mode-toggle');
    if (triggerSwitch && currentLevel === 'state' && viewToggle && !viewToggle.checked) {
        viewToggle.checked = true;
        viewToggle.dispatchEvent(new Event('change'));
    } else {
        // Just update UI (handles highlights/pan or already-on states)
        updateDashboard();
        // Ensure tooltips/styles are applied AFTER dashboard update
        syncHover(featureKey, null, true, center);
    }
}

function clearSelection() {
    if (lockedFeatureKey) syncHover(lockedFeatureKey, null, false);
    lockedFeatureKey = null;
    const input = document.getElementById('district-search');
    if (input) input.value = '';
    document.getElementById('clear-search')?.classList.remove('visible');
}

function syncHover(featureKey, sourceTerm, isOver, latlng) {
    Object.keys(terms).forEach(term => {
        const layer = featureKey ? layersMap[term][featureKey] : null;
        if (!layer) {
            Object.values(layersMap[term]).forEach(l => {
                l.setStyle({ weight: 0.5, color: '#000000' });
                l.closeTooltip();
            });
            return;
        }

        if (isOver) {
            layer.setStyle({ weight: 2.2, color: '#000000' });
            if (layer.bringToFront) layer.bringToFront();
            if (latlng) layer.openTooltip(latlng);
        } else {
            layer.setStyle({ weight: 0.5, color: '#000000' });
            layer.closeTooltip();
        }
    });
}

function updateDashboard() {
    if (!variablesConfig || !datasetJSON) return;
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const scenCfg = varCfg?.scenarios[scenario];
    if (!scenCfg) return;

    const config = levelsCfg[currentLevel];
    const { ticks } = buildLegendBar(scenCfg);

    Object.keys(terms).forEach(key => {
        const hdr = document.getElementById(terms[key].id);
        if (hdr) {
            if (isTimeSeries) {
                if (key === 'near') hdr.innerText = 'Test Left Frame';
                else if (key === 'mid') {
                    let title = 'Test Big Rectangle';
                    if (lockedFeatureKey) {
                        const row = window.dataLookup[lockedFeatureKey];
                        if (row) {
                            title += ` - ${levelsCfg[currentLevel].tooltipName(row)}`;
                        }
                    }
                    hdr.innerText = title;
                }
            } else {
                hdr.innerText = `${terms[key].label} ${varCfg.label} ${scenario} ${terms[key].years}`;
            }
        }

        geoLayers[key].eachLayer(layer => {
            const featureKey = config.keyGen(layer.feature.properties);
            const dataRow = window.dataLookup[featureKey];
            const val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${key}`] : null;

            layer.setStyle({
                fillColor: getColor(val, scenCfg),
                fillOpacity: isTimeSeries ? 0 : 1.0,
                opacity: isTimeSeries ? 0 : 1.0
            });

            if (isTimeSeries) {
                layer.unbindTooltip();
            } else {
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
            const label = (v > 0 && metric !== 'mean_temp' ? '+' : '') + (v === 0 ? '0' : v.toFixed(1));
            return `<span class="legend-tick" style="left:${pct.toFixed(2)}%">${label}</span>`;
        }).join('');
        const old = container.querySelector('.legend-labels');
        if (old) old.style.display = 'none';
    });

    // Update Time Series components if active
    if (isTimeSeries) {
        updateTimeSeriesChart();
    }
}

async function updateTimeSeriesChart() {
    const metric = window.selectedMetric();
    const scenario = window.selectedScenario();
    const varCfg = variablesConfig[metric];
    if (!varCfg) return;

    const canvas = document.getElementById('time-series-chart');
    const noDataOverlay = document.getElementById('no-data-overlay');
    const header = document.getElementById('mid-term-header');

    if (!canvas || !header) return;

    // 1. Initial/Update Header with Controls
    if (!header.querySelector('.ts-control-group') || tsSelectedVar !== metric) {
        tsSelectedVar = metric;
        renderTimeSeriesHeader(header, varCfg.label, scenario);
    } else {
        // Sync scenario in title if already rendered
        const titleScen = header.querySelector('#ts-title-scenario');
        if (titleScen) titleScen.innerText = `(${scenario})`;
    }

    // 2. Load Data if needed (or if metric changed)
    const fileName = `JSONs/${varCfg.json_key}_time_series.json`;
    try {
        const resp = await fetch(fileName);
        if (!resp.ok) throw new Error('File not found');
        tsData = await resp.json();
        noDataOverlay.classList.remove('visible');
    } catch (e) {
        console.warn(`Time series data missing: ${fileName}`);
        tsData = null;
        noDataOverlay.classList.add('visible');
        if (tsChart) { tsChart.destroy(); tsChart = null; }
        return;
    }

    // 3. Filter & Process Data
    const dataKey = `${varCfg.json_key}-${scenario.toLowerCase()}-${tsSeason}`;
    const filtered = tsData.filter(d => d.Year >= tsStartYear && d.Year <= tsEndYear);
    const labels = filtered.map(d => d.Year);
    const values = filtered.map(d => d[dataKey]);

    // 4. Render Chart
    if (tsChart) tsChart.destroy();

    const ctx = canvas.getContext('2d');
    tsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `${varCfg.label} (${scenario})`,
                data: values,
                borderColor: '#2563eb',
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 10,
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#000',
                        font: { weight: 'normal', size: 10 }
                    },
                    border: { color: '#000', width: 2 },
                    title: {
                        display: true,
                        text: 'Year',
                        color: '#0f172a',
                        font: { weight: 'bold', size: 12 }
                    }
                },
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        color: '#000',
                        font: { weight: 'normal', size: 11 }
                    },
                    border: { color: '#000', width: 2 },
                    suggestedMin: 0,
                    title: {
                        display: true,
                        text: `${varCfg.label} (${varCfg.unit})`,
                        color: '#0f172a',
                        font: { weight: 'bold', size: 12 }
                    }
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
                            const year = tooltipModel.title[0];
                            const raw = parseFloat(tooltipModel.body[0].lines[0].split(': ')[1]);
                            const prefix = raw > 0 ? '+' : '';
                            const val = prefix + raw.toFixed(2);
                            tooltipEl.innerHTML = `
                                <div class="tooltip-val">${val} ${varCfg.unit}</div>
                                <div class="tooltip-dist">${year}</div>
                            `;
                        }

                        const position = context.chart.canvas.getBoundingClientRect();
                        tooltipEl.style.opacity = 1;
                        tooltipEl.style.position = 'absolute';
                        tooltipEl.style.left = position.left + window.pageXOffset + tooltipModel.caretX + 'px';
                        tooltipEl.style.top = position.top + window.pageYOffset + tooltipModel.caretY - 80 + 'px';
                        tooltipEl.style.pointerEvents = 'none';
                        tooltipEl.style.transition = 'all 0.05s ease';
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
                    ctx.setLineDash([5, 5]);
                    ctx.moveTo(x, yAxis.top);
                    ctx.lineTo(x, yAxis.bottom);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }]
    });
}

function renderTimeSeriesHeader(container, varLabel, scenario) {
    const seasons = [
        { id: 'annual', label: 'Annual' },
        { id: 'mam', label: 'MAM (Mar-May)' },
        { id: 'jjas', label: 'JJAS (Jun-Sep)' },
        { id: 'on', label: 'ON (Oct-Nov)' },
        { id: 'djf', label: 'DJF (Dec-Feb)' }
    ];

    const yearOptions = [];
    for (let y = 1950; y <= 2099; y++) yearOptions.push(y);

    container.innerHTML = `
        <div class="ts-control-group">
            Time Series for 
            <select class="ts-select" id="ts-season-select">
                ${seasons.map(s => `<option value="${s.id}" ${tsSeason === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
            ${varLabel} <span id="ts-title-scenario">(${scenario})</span> between
            <select class="ts-select" id="ts-start-year">
                ${yearOptions.map(y => `<option value="${y}" ${tsStartYear === y ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
            and
            <select class="ts-select" id="ts-end-year">
                ${yearOptions.map(y => `<option value="${y}" ${tsEndYear === y ? 'selected' : ''}>${y}</option>`).join('')}
            </select>
        </div>
    `;

    // Listeners
    container.querySelector('#ts-season-select').addEventListener('change', (e) => {
        tsSeason = e.target.value;
        updateTimeSeriesChart();
    });
    container.querySelector('#ts-start-year').addEventListener('change', (e) => {
        tsStartYear = parseInt(e.target.value);
        updateTimeSeriesChart();
    });
    container.querySelector('#ts-end-year').addEventListener('change', (e) => {
        tsEndYear = parseInt(e.target.value);
        updateTimeSeriesChart();
    });
}

function populateSearch() {
    const input = document.getElementById('district-search');
    const container = document.getElementById('search-results');
    const config = levelsCfg[currentLevel];
    if (!input || !container || !datasetJSON) return;

    let selectedIdx = -1;
    let matches = [];

    const updateResults = () => {
        const val = input.value.toLowerCase().trim();
        if (val.length < 1) { container.classList.remove('visible'); return; }
        matches = datasetJSON.filter(row => {
            const label = config.searchLabel(row).toLowerCase();
            const sub = config.searchSub(row).toLowerCase();
            return label.includes(val) || sub.includes(val);
        }).slice(0, 10);

        container.innerHTML = matches.map((row, i) => `
            <div class="search-item ${i === selectedIdx ? 'selected' : ''}" data-index="${i}">
                <span>${config.searchLabel(row)}</span>
                ${config.searchSub(row) ? `<span class="state-label">${config.searchSub(row)}</span>` : ""}
            </div>
        `).join('');
        container.classList.toggle('visible', matches.length > 0);
    };

    input.addEventListener('input', updateResults);
    input.addEventListener('keydown', (e) => {
        if (!container.classList.contains('visible')) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = (selectedIdx + 1) % matches.length; updateResults(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = (selectedIdx - 1 + matches.length) % matches.length; updateResults(); }
        else if (e.key === 'Enter' && selectedIdx > -1) { selectFeature(config.rowKeyGen(matches[selectedIdx]), true); container.classList.remove('visible'); input.blur(); }
    });

    container.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (item) {
            const idx = parseInt(item.dataset.index);
            selectFeature(config.rowKeyGen(matches[idx]), true);
            container.classList.remove('visible');
        }
    });

    document.getElementById('clear-search')?.addEventListener('click', clearSelection);
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

    if (metricSelect) metricSelect.addEventListener('change', updateDashboard);
    if (sspRadios) sspRadios.forEach(r => r.addEventListener('change', updateDashboard));

    // View Mode Toggle Logic
    const viewToggle = document.getElementById('view-mode-toggle');
    if (viewToggle) {
        viewToggle.addEventListener('change', () => {
            const isTimeSeries = viewToggle.checked;
            const containers = document.querySelectorAll('.map-container');
            containers.forEach(c => c.classList.add('is-loading'));

            if (isTimeSeries) {
                // Entering Time Series: Immediate update
                document.body.classList.add('time-series-mode');
                updateDashboard();
                setTimeout(() => {
                    Object.values(mapViews).forEach(m => m.invalidateSize());
                    containers.forEach(c => c.classList.remove('is-loading'));
                }, 750);
            } else {
                // Exiting Time Series: Sequence the layout first
                document.body.classList.add('is-animating-spatial');
                document.body.classList.remove('time-series-mode');

                // Wait for the 0.7s card transition before restoring content
                setTimeout(() => {
                    document.body.classList.remove('is-animating-spatial');
                    // Reset specialized headers
                    const midHeader = document.getElementById('mid-term-header');
                    if (midHeader) midHeader.innerHTML = `${terms['mid'].label} (2050-2070)`;

                    updateDashboard();
                    Object.values(mapViews).forEach(m => m.invalidateSize());
                    containers.forEach(c => c.classList.remove('is-loading'));
                }, 750);
            }
        });
    }

    // Initial load
    load();
})();