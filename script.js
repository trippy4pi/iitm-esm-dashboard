// Global state
let variablesConfig = null;
let districtData = null;
let districtGeoJSON = null;
let isAnimating = false;
const terms = {
    'near': { id: 'near-term-header', label: 'Near-term', years: '(2025-2036)' },
    'mid': { id: 'mid-term-header', label: 'Mid-term', years: '(2050-2070)' },
    'long': { id: 'long-term-header', label: 'Long-term', years: '(2081-2100)' }
};

// Map containers and layers
const mapViews = {};
const geoLayers = {};
const layersMap = { 'near': {}, 'mid': {}, 'long': {} };

// 1. Color Interpolation Logic
function parseHex(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

function interpolate(c1, c2, factor) {
    const r = Math.round(c1[0] + factor * (c2[0] - c1[0]));
    const g = Math.round(c1[1] + factor * (c2[1] - c1[1]));
    const b = Math.round(c1[2] + factor * (c2[2] - c1[2]));
    return `rgb(${r},${g},${b})`;
}

function getColor(val, scenarioConfig) {
    if (val === null || val === undefined) return '#e2e8f0';
    const { min, max, colors } = scenarioConfig;
    const factor = Math.max(0, Math.min(1, (val - min) / (max - min)));

    const parsed = colors.map(parseHex);
    if (parsed.length === 2) return interpolate(parsed[0], parsed[1], factor);

    // Multi-color interpolation (e.g. 3 or 4 colors)
    const segmentCount = parsed.length - 1;
    const segment = Math.floor(factor * segmentCount * 0.999);
    const segmentFactor = (factor * segmentCount) - segment;
    return interpolate(parsed[segment], parsed[segment + 1], segmentFactor);
}

// 2. Map Initialization
(() => {
    // Zoom & center adapt to screen size so India fits across all viewports
    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = w <= 768;

    // On mobile the map container is taller but narrower → need lower zoom to fit India
    // On desktop 3:4 portrait cards → zoom 4.5 works well
    const startZoom = isMobile
        ? (w < 400 ? 3.4 : 3.6)   // small phone / regular phone
        : 4.5;                      // desktop (unchanged)

    // Geographic centre of India — shows both Kashmir and Kanyakumari
    const center = isMobile
        ? [22.5, 82.5]
        : [22.9734, 82.5];          // desktop (unchanged)

    const tileUrl = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'; // cleaner tiles
    const tileOpts = { attribution: '&copy; CartoDB' };

    ['near', 'mid', 'long'].forEach((term) => {
        const id = `map-${term}-term`;
        const el = document.getElementById(id);
        if (!el) return;
        const minZoom = isMobile ? 3 : 4;
        const m = L.map(id, { zoomControl: true, minZoom, maxZoom: 8, zoomSnap: 0.1 }).setView(center, startZoom);
        L.tileLayer(tileUrl, tileOpts).addTo(m);
        mapViews[term] = m;

        // Inject loading overlay
        const container = el.closest('.map-container');
        if (container) {
            container.classList.add('is-loading');
            const loader = document.createElement('div');
            loader.className = 'map-loader';
            loader.innerHTML = `
                <div class="map-loader-ring"></div>
                <span class="map-loader-label">Loading data…</span>
            `;
            container.appendChild(loader);
        }
    });
})();

// 3. Data Loading
async function load() {
    try {
        console.log('Loading configuration and data...');
        const [vResp, dResp, gResp] = await Promise.all([
            fetch('JSONs/VARIABLES.json'),
            fetch('JSONs/DATA.json'),
            fetch('JSONs/districts_ultra_optimized.geojson') // Using optimized version for performance
        ]);

        variablesConfig = await vResp.json();
        districtData = await dResp.json();
        districtGeoJSON = await gResp.json();

        // Create fast lookup
        window.dataLookup = {};
        districtData.forEach(row => {
            const key = `${row.STATE_UT.trim()}|${row.DISTRICT.trim()}`.toLowerCase();
            window.dataLookup[key] = row;
        });

        initGeoLayers();
        updateDashboard();

        // Remove loading overlays — remove DOM element after fade-out so hidden containers don't re-show it
        setTimeout(() => {
            document.querySelectorAll('.map-container.is-loading').forEach(c => {
                c.classList.remove('is-loading');
                const loader = c.querySelector('.map-loader');
                if (loader) setTimeout(() => loader.remove(), 550); // remove after 500ms CSS transition
            });
        }, 200);

        // Invalidate Leaflet sizes after layout settles (fixes rendering in flex containers / mobile)
        setTimeout(() => {
            Object.values(mapViews).forEach(m => m.invalidateSize());
            // Trigger mobile display reset after maps are ready
            window.dispatchEvent(new Event('dashboardready'));
        }, 150);
    } catch (e) {
        console.error('Initial load failed:', e);
    }
}

function initGeoLayers() {
    ['near', 'mid', 'long'].forEach(term => {
        geoLayers[term] = L.geoJSON(districtGeoJSON, {
            // Default: thin black outline, light fill
            style: { weight: 0.5, color: '#000000', fillOpacity: 0.85, fillColor: '#e2e8f0' },
            onEachFeature: (feature, layer) => {
                const props = feature.properties;
                const featureKey = `${(props.STATE_UT || "").trim()}|${(props.DISTRICT || "").trim()}`.toLowerCase();
                layersMap[term][featureKey] = layer;

                // Sync hover events across all maps
                layer.on('mouseover', function (e) {
                    syncHover(featureKey, term, true, e.latlng);
                });
                layer.on('mousemove', function (e) {
                    syncHover(featureKey, term, true, e.latlng);
                });
                layer.on('mouseout', function () {
                    syncHover(featureKey, term, false);
                });
            }
        }).addTo(mapViews[term]);
    });
    // syncMaps removed — each map pans/zooms independently
}

// All three maps get both the border highlight AND their own tooltip
function syncHover(featureKey, sourceTerm, isOver, latlng) {
    Object.keys(layersMap).forEach(term => {
        const layer = layersMap[term][featureKey];
        if (!layer) return;

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
    if (!variablesConfig || !districtData || !districtGeoJSON) return;

    const metric = window.selectedMetric?.();
    const scenario = window.selectedScenario?.();
    const varCfg = variablesConfig[metric];
    const scenCfg = varCfg?.scenarios[scenario];
    if (!scenCfg) return;

    const legendTitle = `${varCfg.label} (${varCfg.unit})`;

    // Update UI Elements
    Object.keys(terms).forEach(key => {
        const titleEl = document.getElementById(terms[key].id);
        titleEl.innerText = `${terms[key].label} ${varCfg.label} ${scenario} ${terms[key].years}`;

        // Per-term scale config: prefer terms[key] if defined, else fall back to top-level scenCfg
        const termCfg = scenCfg.terms?.[key]
            ? { ...scenCfg, min: scenCfg.terms[key].min, max: scenCfg.terms[key].max }
            : scenCfg;

        // Update Choropleth Style
        geoLayers[key].eachLayer(layer => {
            const props = layer.feature.properties;
            const lookupKey = `${(props.STATE_UT || "").trim()}|${(props.DISTRICT || "").trim()}`.toLowerCase();
            const dataRow = window.dataLookup[lookupKey];

            // Key format: [json_key]_ssp[126/245/370/585]_[near/mid/long]
            const valKey = `${varCfg.json_key}_${scenario.toLowerCase()}_${key}`;
            const val = dataRow ? dataRow[valKey] : null;

            layer.setStyle({
                fillColor: getColor(val, termCfg),
                fillOpacity: 0.85
            });

            // Update Tooltip Content with modern formatting and sign for anomalies
            const formattedVal = val !== null ? (val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2)) : 'N/A';
            const tooltipContent = `
                <div class="district-tooltip">
                    <span class="tooltip-val">${formattedVal} ${varCfg.unit}</span>
                    <span class="tooltip-dist">${props.DISTRICT}</span>
                    <span class="tooltip-state">${props.STATE_UT}</span>
                </div>
            `;
            layer.bindTooltip(tooltipContent, {
                sticky: false,
                direction: 'auto',
                offset: [0, -10],
                className: 'custom-tooltip-pane'
            });
        });

        // Update this term's legend with its own min/max
        const legendId = `legend-${key}`;
        const container = document.getElementById(legendId);
        if (!container) return;

        const titleEl2 = container.querySelector('.legend-title');
        if (titleEl2) titleEl2.innerText = legendTitle;

        container.querySelector('.legend-scale').style.background =
            `linear-gradient(to right, ${scenCfg.colors.join(',')})`;

        const minVal = termCfg.min;
        const maxVal = termCfg.max;
        const minStr = minVal > 0 ? `+${minVal}` : `${minVal}`;
        const maxStr = maxVal > 0 ? `+${maxVal}` : `${maxVal}`;

        container.querySelector('span[id$="-min-label"]').innerText = `${minStr} ${varCfg.unit}`;
        container.querySelector('span[id$="-max-label"]').innerText = `${maxStr} ${varCfg.unit}`;
    });
}

// 4. Controls Logic
(() => {
    const buttons = document.querySelectorAll('.ctrl-btn');
    const slider = document.getElementById('ssp-range');
    const mapsRow = document.querySelector('.maps-row');
    const prevBtn = document.getElementById('prev-scenario');
    const nextBtn = document.getElementById('next-scenario');
    const labels = ['SSP126', 'SSP245', 'SSP370', 'SSP585'];

    let currentMetric = 'mean_temp';
    let lastValue = Number(slider.value);

    function setMetric(metric, force = false) {
        if (!force && currentMetric === metric) return;
        currentMetric = metric;
        buttons.forEach(b => b.classList.toggle('active', b.dataset.metric === metric));
        updateDashboard();
    }

    function fastUpdate(val) {
        slider.value = val;
        const container = slider.closest('.scenario-slider');
        if (container) container.className = `scenario-slider ssp-${val}`;
    }

    window.selectedMetric = () => currentMetric;
    window.selectedScenario = () => labels[slider.value];

    async function navigate(newVal) {
        if (isAnimating || newVal === lastValue) return;
        isAnimating = true;
        const isFwd = (newVal > lastValue && !(lastValue === 0 && newVal === 3)) || (lastValue === 3 && newVal === 0);

        mapsRow.classList.add(isFwd ? 'slide-out-left' : 'slide-out-right');
        await new Promise(r => setTimeout(r, 400));

        fastUpdate(newVal);
        lastValue = newVal;
        updateDashboard();

        mapsRow.style.transition = 'none';
        mapsRow.classList.remove('slide-out-left', 'slide-out-right');
        mapsRow.classList.add(isFwd ? 'slide-in-right' : 'slide-in-left');
        void mapsRow.offsetWidth;
        mapsRow.style.transition = '';
        mapsRow.classList.remove('slide-in-right', 'slide-in-left');
        setTimeout(() => isAnimating = false, 400);
    }

    buttons.forEach(b => b.addEventListener('click', () => setMetric(b.dataset.metric)));
    slider.addEventListener('input', (e) => fastUpdate(e.target.value));
    slider.addEventListener('change', (e) => navigate(Number(e.target.value)));

    prevBtn?.addEventListener('click', () => navigate((lastValue - 1 + 4) % 4));
    nextBtn?.addEventListener('click', () => navigate((lastValue + 1) % 4));

    // Highlight arrow buttons while arrow keys are held, and trigger navigation
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') {
            prevBtn.classList.add('pressed');
            prevBtn.click();
        }
        if (e.key === 'ArrowRight') {
            nextBtn.classList.add('pressed');
            nextBtn.click();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft') prevBtn.classList.remove('pressed');
        if (e.key === 'ArrowRight') nextBtn.classList.remove('pressed');
    });

    // If the window loses focus (alt-tab etc), clear pressed states so they don't stick
    window.addEventListener('blur', () => {
        prevBtn.classList.remove('pressed');
        nextBtn.classList.remove('pressed');
    });

    setMetric('mean_temp', true);
    fastUpdate(lastValue);
    load();
})();

// Mobile: collapsible controls toggle
(() => {
    const toggleBtn = document.getElementById('controls-toggle');
    const panel = document.getElementById('controls-panel');
    if (!toggleBtn || !panel) return;

    toggleBtn.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('open');
        toggleBtn.classList.toggle('open', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
    });
})();

// Mobile: map term switcher (dots + prev/next arrows)
(() => {
    const termOrder = ['near', 'mid', 'long'];
    const termLabels = { near: 'Near-term', mid: 'Mid-term', long: 'Long-term' };
    let currentTermIdx = 0;

    const prevBtn = document.getElementById('mobile-prev-term');
    const nextBtn = document.getElementById('mobile-next-term');
    const termLabel = document.getElementById('mobile-term-label');
    const dots = Array.from(document.querySelectorAll('.mobile-map-dots .dot'));

    function isMobile() { return window.innerWidth <= 768; }

    let isAnimating = false;

    function showTerm(idx) {
        if (!isMobile() || isAnimating) return;
        const prevIdx = currentTermIdx;
        if (idx === prevIdx) return;

        const isFwd = idx > prevIdx;
        const outClass = isFwd ? 'mobile-slide-out-left' : 'mobile-slide-out-right';
        const inClass = isFwd ? 'mobile-slide-in-right' : 'mobile-slide-in-left';

        const outContainer = document.getElementById(`${termOrder[prevIdx]}-term`);
        const inContainer = document.getElementById(`${termOrder[idx]}-term`);
        if (!outContainer || !inContainer) return;

        isAnimating = true;
        currentTermIdx = idx;
        const termKey = termOrder[idx];

        // Slide out old
        outContainer.classList.add(outClass);

        setTimeout(() => {
            outContainer.style.display = 'none';
            outContainer.classList.remove(outClass);

            // Slide in new
            inContainer.style.display = '';
            inContainer.classList.add(inClass);
            setTimeout(() => inContainer.classList.remove(inClass), 240);

            // Update dots label
            if (termLabel) termLabel.textContent = termLabels[termKey];
            dots.forEach((d, i) => d.classList.toggle('active', i === idx));

            // Leaflet resize
            const map = mapViews[termKey];
            if (map) setTimeout(() => map.invalidateSize(), 50);

            isAnimating = false;
        }, 230);
    }

    function showTermInstant(idx) {
        currentTermIdx = idx;
        const termKey = termOrder[idx];
        termOrder.forEach((t, i) => {
            const container = document.getElementById(`${t}-term`);
            if (container) container.style.display = (i === idx) ? '' : 'none';
        });
        if (termLabel) termLabel.textContent = termLabels[termKey];
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
        const map = mapViews[termKey];
        if (map) setTimeout(() => map.invalidateSize(), 50);
    }

    function resetMobileDisplay() {
        if (isMobile()) {
            showTermInstant(currentTermIdx);
        } else {
            // Desktop: show all
            termOrder.forEach(t => {
                const container = document.getElementById(`${t}-term`);
                if (container) container.style.display = '';
            });
        }
    }

    if (prevBtn) prevBtn.addEventListener('click', () => showTerm((currentTermIdx - 1 + 3) % 3));
    if (nextBtn) nextBtn.addEventListener('click', () => showTerm((currentTermIdx + 1) % 3));
    dots.forEach((dot, i) => dot.addEventListener('click', () => showTerm(i)));

    window.addEventListener('resize', resetMobileDisplay);
    window.addEventListener('dashboardready', resetMobileDisplay);

    // Run after load so mapViews are populated
    document.addEventListener('DOMContentLoaded', () => setTimeout(resetMobileDisplay, 100));
    // Also run after data load (maps initialized)
    window.addEventListener('load', () => setTimeout(resetMobileDisplay, 300));
})();


// Tooltip portal helper: create a tooltip element in <body> so it escapes map stacking contexts
(() => {
    function createPortal(html) {
        const d = document.createElement('div');
        d.className = 'tooltip-portal';
        d.innerHTML = html;
        document.body.appendChild(d);
        return d;
    }

    function positionPortal(portal, triggerRect) {
        const pad = 8;
        const portalRect = portal.getBoundingClientRect();
        const minGap = 8;
        const spaceRight = window.innerWidth - triggerRect.right - minGap;
        const spaceLeft = triggerRect.left - minGap;
        const spaceBelow = window.innerHeight - triggerRect.bottom - minGap;
        const spaceAbove = triggerRect.top - minGap;

        let left, top;

        // Prefer opening to the right so tooltips don't overlap map controls (zoom etc.)
        if (spaceRight >= portalRect.width) {
            left = triggerRect.right + pad;
            top = triggerRect.top + (triggerRect.height - portalRect.height) / 2;
        } else if (spaceLeft >= portalRect.width) {
            // fallback: open to the left
            left = triggerRect.left - pad - portalRect.width;
            top = triggerRect.top + (triggerRect.height - portalRect.height) / 2;
        } else if (spaceBelow >= portalRect.height) {
            // fallback: below
            left = triggerRect.left + triggerRect.width / 2 - portalRect.width / 2;
            top = triggerRect.bottom + pad;
        } else if (spaceAbove >= portalRect.height) {
            // fallback: above
            left = triggerRect.left + triggerRect.width / 2 - portalRect.width / 2;
            top = triggerRect.top - pad - portalRect.height;
        } else {
            // last resort: clamp inside viewport
            left = Math.min(Math.max(minGap, triggerRect.left + triggerRect.width / 2 - portalRect.width / 2), window.innerWidth - portalRect.width - minGap);
            top = Math.min(Math.max(minGap, triggerRect.bottom + pad), window.innerHeight - portalRect.height - minGap);
        }

        // Clamp values to viewport
        left = Math.max(minGap, Math.min(left, window.innerWidth - portalRect.width - minGap));
        top = Math.max(minGap, Math.min(top, window.innerHeight - portalRect.height - minGap));

        portal.style.left = `${left}px`;
        portal.style.top = `${top}px`;
    }

    function initTooltips() {
        const triggers = Array.from(document.querySelectorAll('.info-tooltip'));
        triggers.forEach(trigger => {
            const tooltip = trigger.querySelector('.tooltip-text');
            if (!tooltip) return;
            let portal = null;
            let onWindowChange = null;

            function show() {
                if (portal) return;
                portal = createPortal(tooltip.innerHTML);
                portal.setAttribute('role', 'tooltip');
                positionPortal(portal, trigger.getBoundingClientRect());
                onWindowChange = () => positionPortal(portal, trigger.getBoundingClientRect());
                window.addEventListener('resize', onWindowChange);
                window.addEventListener('scroll', onWindowChange, true);
                trigger.setAttribute('aria-expanded', 'true');
            }

            function hide() {
                if (portal) {
                    portal.remove();
                    portal = null;
                }
                if (onWindowChange) {
                    window.removeEventListener('resize', onWindowChange);
                    window.removeEventListener('scroll', onWindowChange, true);
                    onWindowChange = null;
                }
                trigger.setAttribute('aria-expanded', 'false');
            }

            trigger.addEventListener('mouseenter', show);
            trigger.addEventListener('mouseleave', hide);
            trigger.addEventListener('focusin', show);
            trigger.addEventListener('focusout', hide);
            // click toggles
            trigger.addEventListener('click', (e) => {
                if (portal) hide(); else show();
            });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTooltips);
    else initTooltips();
})();