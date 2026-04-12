// Initialize the same base map in three containers side-by-side
// Shift center slightly to the right (east) so India appears a bit more centered visually
const center = [22.9734, 82.5]; // adjusted India center (longitude shifted east)
const startZoom = 4.5; // default zoom

const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const tileOpts = {
    maxZoom: 8,
    attribution: '&copy; OpenStreetMap contributors'
};

['map-near-term', 'map-mid-term', 'map-long-term'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    // Ensure the container has an explicit height (Leaflet needs it)
    el.style.height = '100%';

    // set map options: enforce minimum zoom and allow fractional zoom (zoomSnap: 0)
    const mapOpts = {
        zoomControl: true,
        minZoom: 4.5,
        maxZoom: 8,
        zoomSnap: 0,
    };

    const m = L.map(id, mapOpts).setView(center, startZoom);
    L.tileLayer(tileUrl, tileOpts).addTo(m);
});

// Header control buttons logic
(() => {
    const buttons = Array.from(document.querySelectorAll('.ctrl-btn'));
    if (!buttons.length) return;

    // store current selection
    let current = null;

    function setActive(btn) {
        buttons.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        if (btn) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            current = btn.dataset.metric;
            // placeholder: application logic when metric changes
            console.log('Selected metric:', current);
        } else {
            current = null;
        }
    }

    // click + keyboard support
    buttons.forEach(b => {
        b.addEventListener('click', () => setActive(b));
        b.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActive(b);
            }
        });
    });

    // set 'Mean Temperature' as the default active metric
    const defaultBtn = buttons.find(b => b.dataset.metric === 'mean_temp') || buttons[0];
    setActive(defaultBtn);

    // expose current selection for other modules
    window.selectedMetric = () => current;
})();

// SSP scenario slider logic
(() => {
    const slider = document.getElementById('ssp-range');
    if (!slider) return;

    const labels = ['SSP126', 'SSP245', 'SSP370', 'SSP585'];
    // store current scenario index
    let currentIndex = Number(slider.value) || 3;

    function updateAria(val) {
        slider.setAttribute('aria-valuenow', String(val));
    }

    function announce(idx) {
        const name = labels[idx];
        console.log('Selected scenario:', name);
        // expose selected scenario
        window.selectedScenario = () => name;
    }

    // initialize
    updateAria(currentIndex);
    announce(currentIndex);

    slider.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        currentIndex = v;
        updateAria(v);
    });

    slider.addEventListener('change', (e) => {
        const v = Number(e.target.value);
        currentIndex = v;
        updateAria(v);
        announce(v);
    });
})();