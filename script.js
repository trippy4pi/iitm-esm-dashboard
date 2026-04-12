// Global state and configuration
let variablesConfig = null;
let isAnimating = false;

const terms = {
    'near': { id: 'near-term-header', label: 'Near-term (2025-2036)' },
    'mid': { id: 'mid-term-header', label: 'Mid-term (2050-2070)' },
    'long': { id: 'long-term-header', label: 'Long-term (2081-2100)' }
};

// Initialize Leaflet maps once
const mapViews = {};
(() => {
    const center = [22.9734, 82.5];
    const startZoom = 4.5;
    const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileOpts = { maxZoom: 8, attribution: '&copy; OpenStreetMap contributors' };

    ['near', 'mid', 'long'].forEach((term) => {
        const id = `map-${term}-term`;
        const el = document.getElementById(id);
        if (!el) return;
        el.style.height = '100%';
        const m = L.map(id, { zoomControl: true, minZoom: 4.5, maxZoom: 8, zoomSnap: 0 }).setView(center, startZoom);
        L.tileLayer(tileUrl, tileOpts).addTo(m);
        mapViews[term] = m;
    });
})();

async function loadConfig() {
    try {
        const response = await fetch('JSONs/VARIABLES.json');
        variablesConfig = await response.json();
        updateDashboard();
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

function updateDashboard() {
    if (!variablesConfig) return;
    const metric = window.selectedMetric?.();
    const scenario = window.selectedScenario?.();
    if (!metric || !scenario) return;

    const config = variablesConfig[metric];
    const data = config?.scenarios[scenario];
    if (!data) return;

    Object.keys(terms).forEach(key => {
        document.getElementById(terms[key].id).innerText = `${scenario} ${terms[key].label}`;
    });

    ['legend-near', 'legend-mid', 'legend-long'].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.querySelector('.legend-scale').style.background = `linear-gradient(to right, ${data.colors.join(',')})`;
        container.querySelector('span[id$="-min-label"]').innerText = `${data.min} ${config.unit}`;
        container.querySelector('span[id$="-max-label"]').innerText = `${data.max} ${config.unit}`;
    });
}

// Controls Logic
(() => {
    const buttons = document.querySelectorAll('.ctrl-btn');
    const slider = document.getElementById('ssp-range');
    const mapsRow = document.querySelector('.maps-row');
    const prevBtn = document.getElementById('prev-scenario');
    const nextBtn = document.getElementById('next-scenario');
    const labels = ['SSP126', 'SSP245', 'SSP370', 'SSP585'];

    let currentMetric = 'mean_temp';
    let lastScenarioValue = Number(slider.value);

    function setMetric(metric, force = false) {
        if (!force && currentMetric === metric) return;
        currentMetric = metric;
        buttons.forEach(b => {
            const active = b.dataset.metric === metric;
            b.classList.toggle('active', active);
            b.setAttribute('aria-pressed', String(active));
        });
        updateDashboard();
    }

    // High speed update for labels/colors (during dragging)
    function fastScenarioUpdate(val) {
        slider.value = val;
        const container = slider.closest('.scenario-slider');
        if (container) {
            container.className = `scenario-slider ssp-${val}`;
        }
    }

    window.selectedMetric = () => currentMetric;
    window.selectedScenario = () => labels[slider.value];

    async function transitionToScenario(newVal) {
        if (isAnimating || newVal === lastScenarioValue) return;
        isAnimating = true;

        const increment = newVal > lastScenarioValue || (lastScenarioValue === 3 && newVal === 0);
        // Special case for looping: if moving from 3 to 0, it's an "increment" (right)
        // If moving from 0 to 3, it's a "decrement" (left)
        const isActuallyForward = (newVal > lastScenarioValue && !(lastScenarioValue === 0 && newVal === 3)) || (lastScenarioValue === 3 && newVal === 0);

        mapsRow.classList.add(isActuallyForward ? 'slide-out-left' : 'slide-out-right');
        await new Promise(r => setTimeout(r, 400));

        fastScenarioUpdate(newVal);
        lastScenarioValue = newVal;
        updateDashboard();

        mapsRow.style.transition = 'none';
        mapsRow.classList.remove('slide-out-left', 'slide-out-right');
        mapsRow.classList.add(isActuallyForward ? 'slide-in-right' : 'slide-in-left');
        void mapsRow.offsetWidth;

        mapsRow.style.transition = '';
        mapsRow.classList.remove('slide-in-right', 'slide-in-left');
        setTimeout(() => isAnimating = false, 400);
    }

    buttons.forEach(b => b.addEventListener('click', () => setMetric(b.dataset.metric)));

    // Slider: Dragging updates UI, Release triggers animation & data
    slider.addEventListener('input', (e) => fastScenarioUpdate(e.target.value));
    slider.addEventListener('change', (e) => transitionToScenario(Number(e.target.value)));

    prevBtn?.addEventListener('click', () => {
        const newVal = (lastScenarioValue - 1 + 4) % 4;
        transitionToScenario(newVal);
    });
    nextBtn?.addEventListener('click', () => {
        const newVal = (lastScenarioValue + 1) % 4;
        transitionToScenario(newVal);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') prevBtn.click();
        if (e.key === 'ArrowRight') nextBtn.click();
    });

    // Init with highlights
    setMetric('mean_temp', true);
    fastScenarioUpdate(lastScenarioValue);
    loadConfig();
})();