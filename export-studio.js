const EXPORT_QR_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIwAAACMAQAAAACGu3yTAAABQklEQVR4nKWWwW3lMBQDR0Huow7cf1nugK8C5vAXC2w2AT4s3UzgETQ9krXKtzUf3xV4U5q1FuwZ1tqz1np38H/pkzLMuNJ9U+a51wezGDq4uJj1/uAv0h4dHwz+INUZ73MvC3uurmtu7IHXyob8fdyQ57ls/yC2L2z7PBcJ1FANgR7k4qLDdgbAE74oAoJNmvg8F4lqDCnm5B0pAZM0RDzJ1SKhpkpzwARpkxCahnDWV4Vq68vyyCutaFIxz70+ZQNEltzXHOxHGgliYssZX8YW07w2+RET4fU1a8UjJmibShPTHHRPCrEWk55xn0aTpiCesvpiDAP0oK9VYHBlE5y3B3/uHtoWE5IcnattZg0OInsf/rcB7u6VtT26AwDkWteql0lOvYjjcN/XeNJ9mwZM7eF5HyCqNi+7M77+Wc/vhV+4agCvYD249AAAAABJRU5ErkJggg==";

const MAP_BOUNDS = {
    minLng: 65.0,
    maxLng: 100.0,
    minLat: 5.0,
    maxLat: 40.0
};

// Equirectangular projection helper (direct lat/lng scale — fills canvas correctly)
// Returns normalised 0-1 coords based on actual data bounds
function makeProjector(bounds, drawX, drawY, drawW, drawH) {
    const lngSpan = bounds.maxLng - bounds.minLng;
    const latSpan = bounds.maxLat - bounds.minLat;
    // Stretch to fill, Y is flipped (lat increases upward)
    return function(lat, lng) {
        return {
            x: drawX + ((lng - bounds.minLng) / lngSpan) * drawW,
            y: drawY + drawH - ((lat - bounds.minLat) / latSpan) * drawH
        };
    };
}

// Helper to calculate exact bounds of GeoJSON features
function getGeoJSONBounds(geojson) {
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    geojson.features.forEach(f => {
        const processCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                const lng = coords[0];
                const lat = coords[1];
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else {
                coords.forEach(processCoords);
            }
        };
        processCoords(f.geometry.coordinates);
    });
    return { minLng, maxLng, minLat, maxLat };
}

// Helper to load image
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
    });
}

// Helper to trigger direct download via blob
function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// File naming helper
function getExportFilename(source, titleText, ext) {
    const now = new Date();
    const ts = [
        String(now.getDate()).padStart(2, '0'),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getFullYear()).slice(-2),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ].join('');
    
    const metric = window.selectedMetric?.() || 'mean_temp';
    const varCfg = variablesConfig[metric];
    const jsKey = varCfg?.json_key || 'tas';
    const scenario = (window.selectedScenario?.() || 'SSP585').toLowerCase();
    const season = tsSeason.toLowerCase();
    
    let type = 'viz';
    if (source.startsWith('map-')) {
        type = `map-${source.replace('map-', '')}`;
    } else if (source === 'line-chart') {
        type = 'chart-line';
    } else if (source === 'bar-chart') {
        type = 'chart-bar';
    }
    
    return `${type}_${jsKey}-${scenario}-${season}-${ts}.${ext}`;
}

// Render offscreen High DPI chart
function getHighDPIChartImage(originalChart, scale, width, height) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    
    const exportConfig = {
        type: originalChart.config.type,
        data: originalChart.config.data,
        options: {
            ...originalChart.config.options,
            responsive: false,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: scale
        },
        plugins: originalChart.config.plugins
    };
    
    const tempChart = new Chart(tempCanvas, exportConfig);
    const dataUrl = tempCanvas.toDataURL('image/png');
    tempChart.destroy();
    return dataUrl;
}

// Global modal state variables
let currentExportSource = null;

// Open Export Studio
window.openExportStudio = function(source) {
    currentExportSource = source;
    
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    
    let defaultTitle = '';
    
    if (source === 'line-chart') {
        let displayStateName = "INDIA";
        if (lockedFeatureKey) {
            const lookupKey = lockedFeatureKey.includes('|') ? lockedFeatureKey.split('|')[0] : lockedFeatureKey;
            const row = window.dataLookup[lookupKey];
            if (row && row.STATE_UT) {
                displayStateName = row.STATE_UT;
            }
        }
        defaultTitle = `${varCfg.label} Time Series for ${displayStateName} (${tsStartYear}-${tsEndYear})`;
    } else if (source === 'bar-chart') {
        defaultTitle = `${varCfg.label} Comparison by State/UT under ${scenario} (${seasonLabel})`;
    } else if (source.startsWith('map-')) {
        const termKey = source.replace('map-', '');
        const termLabel = terms[termKey]?.label || '';
        const termYears = terms[termKey]?.years || '';
        defaultTitle = `${varCfg.label} Change under ${scenario} (${seasonLabel}) - ${termLabel} ${termYears}`;
    }
    
    const overlay = document.getElementById('export-studio-overlay');
    if (!overlay) return;
    
    // Populate Modal
    populateExportStudioModal(source, defaultTitle);
    
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('show'), 10);
    
    // Event listeners
    document.getElementById('export-studio-close-btn').onclick = closeExportStudio;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeExportStudio();
    };
    
    document.getElementById('export-action-btn').onclick = triggerExportStudioAction;
};

// Close Export Studio
function closeExportStudio() {
    const overlay = document.getElementById('export-studio-overlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 300);
}

// Populate HTML Structure
function populateExportStudioModal(source, defaultTitle) {
    const isChart = source.includes('chart');
    const modal = document.getElementById('export-studio-modal');
    
    modal.innerHTML = `
        <div class="export-studio-header">
            <h3 class="export-studio-title">Export Studio</h3>
            <button class="export-studio-close" id="export-studio-close-btn">&times;</button>
        </div>
        
        <div class="export-studio-group">
            <label class="export-studio-label" for="export-title-input">Export Title</label>
            <input type="text" id="export-title-input" class="export-studio-input" value="${defaultTitle}">
        </div>
        
        <div class="export-studio-group">
            <label class="export-studio-label">Export Format</label>
            <div class="export-studio-formats">
                <label class="export-studio-format-pill">
                    <input type="radio" name="export-format" value="png" checked>
                    <span class="export-studio-format-pill-content">PNG</span>
                </label>
                <label class="export-studio-format-pill">
                    <input type="radio" name="export-format" value="svg">
                    <span class="export-studio-format-pill-content">SVG</span>
                </label>
                <label class="export-studio-format-pill">
                    <input type="radio" name="export-format" value="csv">
                    <span class="export-studio-format-pill-content">CSV</span>
                </label>
            </div>
        </div>
        
        <div class="export-studio-group" id="export-options-group">
            <div id="quality-selector-group">
                <label class="export-studio-label">Image Resolution</label>
                <div class="export-studio-qualities">
                    <label class="export-studio-quality-pill">
                        <input type="radio" name="export-quality" value="1.5">
                        <span class="export-studio-quality-pill-content">Standard (150 DPI)</span>
                    </label>
                    <label class="export-studio-quality-pill">
                        <input type="radio" name="export-quality" value="3.0" checked>
                        <span class="export-studio-quality-pill-content">High (300 DPI)</span>
                    </label>
                    <label class="export-studio-quality-pill">
                        <input type="radio" name="export-quality" value="4.5">
                        <span class="export-studio-quality-pill-content">Presentation (450 DPI)</span>
                    </label>
                </div>
            </div>
            
            <label class="export-studio-toggle-group" id="qr-toggle-container">
                <input type="checkbox" id="export-qr-toggle" checked>
                <span class="export-studio-toggle-text">Include Verification QR Code</span>
            </label>
        </div>
        
        <button class="export-studio-btn" id="export-action-btn">
            <span>Download PNG</span>
        </button>
    `;
    
    const formatRadios = modal.querySelectorAll('input[name="export-format"]');
    const optionsGroup = modal.querySelector('#export-options-group');
    const qualityGroup = modal.querySelector('#quality-selector-group');
    const qrContainer = modal.querySelector('#qr-toggle-container');
    const actionBtn = modal.querySelector('#export-action-btn');
    
    formatRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const format = radio.value;
            actionBtn.querySelector('span').innerText = `Download ${format.toUpperCase()}`;
            
            if (format === 'csv') {
                optionsGroup.style.display = 'none';
            } else if (format === 'svg') {
                optionsGroup.style.display = 'block';
                qualityGroup.style.display = 'none';
                qrContainer.style.display = 'flex';
            } else {
                optionsGroup.style.display = 'block';
                qualityGroup.style.display = 'flex';
                qrContainer.style.display = 'flex';
            }
        });
    });
}

// ── Progress Overlay ─────────────────────────────────────────────────────────
function showExportProgress() {
    const modal = document.getElementById('export-studio-modal');
    modal.innerHTML = `
        <div class="export-studio-header">
            <h3 class="export-studio-title">Export Studio</h3>
        </div>
        <div class="export-progress-wrap">
            <div class="export-progress-icon">⬇</div>
            <div class="export-progress-stage" id="exp-stage">Preparing…</div>
            <div class="export-progress-track">
                <div class="export-progress-bar" id="exp-bar" style="width:0%"></div>
                <div class="export-progress-shimmer"></div>
            </div>
            <div class="export-progress-pct" id="exp-pct">0%</div>
        </div>
    `;
}

let _expAnimFrame = null;
let _expTarget = 0;
let _expCurrent = 0;

function setExportProgress(pct, label) {
    _expTarget = pct;
    const stageEl = document.getElementById('exp-stage');
    const pctEl   = document.getElementById('exp-pct');
    if (stageEl && label) stageEl.textContent = label;

    // Smoothly animate bar to target
    if (_expAnimFrame) cancelAnimationFrame(_expAnimFrame);
    const animate = () => {
        _expCurrent += (_expTarget - _expCurrent) * 0.12;
        if (Math.abs(_expTarget - _expCurrent) < 0.3) _expCurrent = _expTarget;
        const bar = document.getElementById('exp-bar');
        if (bar) bar.style.width = _expCurrent.toFixed(1) + '%';
        if (pctEl) pctEl.textContent = Math.round(_expCurrent) + '%';
        if (_expCurrent < _expTarget) _expAnimFrame = requestAnimationFrame(animate);
    };
    _expAnimFrame = requestAnimationFrame(animate);
}

// Helper for deliberate existential delays
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Yield to browser so progress bar can repaint
function yieldFrame() {
    return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}

// Trigger export actions
async function triggerExportStudioAction() {
    const titleInput = document.getElementById('export-title-input');
    const format     = document.querySelector('input[name="export-format"]:checked')?.value || 'png';
    const scale      = parseFloat(document.querySelector('input[name="export-quality"]:checked')?.value || '3.0');
    const includeQR  = document.getElementById('export-qr-toggle')?.checked ?? true;
    const titleText  = titleInput?.value || 'Climate Dashboard Export';

    // Switch modal to progress view
    showExportProgress();
    _expCurrent = 0; _expTarget = 0;

    try {
        if (format === 'csv') {
            setExportProgress(10, 'Compiling regional climate data attributes…');
            await sleep(1000);
            setExportProgress(30, 'Fact: India has reached nearly 50% installed non-fossil fuel electricity capacity…');
            await sleep(1200);
            setExportProgress(50, 'Fact: India aims to expand its non-fossil energy capacity to 500 GW by 2030…');
            await sleep(1400);
            setExportProgress(70, 'Formatting data cells according to ISO standard layout…');
            await sleep(1200);
            setExportProgress(85, 'Validating tabular datasets for policy & analytical export…');
            await sleep(1200);
            setExportProgress(95, 'Structuring output CSV fields…');
            await sleep(1000);
            await runExportCSV(currentExportSource, titleText);
        } else if (format === 'svg') {
            await runExportSVG(currentExportSource, titleText, includeQR, setExportProgress, yieldFrame);
        } else {
            await runExportPNG(currentExportSource, titleText, scale, includeQR, setExportProgress, yieldFrame);
        }
        // Hold at 100% briefly then close
        setExportProgress(100, 'Download starting…');
        await sleep(1200);
        closeExportStudio();
    } catch (err) {
        console.error('Export failed:', err);
        closeExportStudio();
        alert('Export failed — please try again.');
    }
}


// CSV Export Logic
async function runExportCSV(source, titleText) {
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    
    let csvContent = '';
    
    if (source === 'line-chart') {
        if (!tsChart) return;
        csvContent += `\uFEFF# Title: ${titleText}\n`;
        csvContent += `# Variable: ${varCfg.label}, Scenario: ${scenario}, Season: ${seasonLabel}\n`;
        
        const headers = ['Year'];
        tsChart.data.datasets.forEach(ds => headers.push(ds.label));
        csvContent += headers.join(',') + '\n';
        
        tsChart.data.labels.forEach(year => {
            const row = [year];
            tsChart.data.datasets.forEach(ds => {
                const point = ds.data.find(d => d.x === year);
                const numVal = point ? point.y : null;
                row.push(numVal !== undefined && numVal !== null ? numVal.toFixed(2) : '');
            });
            csvContent += row.join(',') + '\n';
        });
        
    } else if (source === 'bar-chart') {
        csvContent += `\uFEFF# Title: ${titleText}\n`;
        csvContent += `# Variable: ${varCfg.label}, Scenario: ${scenario}, Season: ${seasonLabel}\n`;
        csvContent += `State/UT,Abbreviation,Value (${varCfg.unit})\n`;
        
        tsBarDataItems.forEach(item => {
            csvContent += `"${item.stateName}",${item.acronym},${item.val !== null ? item.val.toFixed(2) : ''}\n`;
        });
        
    } else if (source.startsWith('map-')) {
        const termKey = source.replace('map-', '');
        const termLabel = terms[termKey]?.label || '';
        const termYears = terms[termKey]?.years || '';
        const config = levelsCfg[currentLevel];
        
        csvContent += `\uFEFF# Title: ${titleText}\n`;
        csvContent += `# Variable: ${varCfg.label}, Scenario: ${scenario}, Season: ${seasonLabel}, Period: ${termLabel} ${termYears}\n`;
        csvContent += `${currentLevel === 'state' ? 'State' : 'District'},Value (${varCfg.unit})\n`;
        
        if (geoLayers[termKey]) {
            geoLayers[termKey].eachLayer(layer => {
                const featureKey = config.keyGen(layer.feature.properties);
                const dataRow = window.dataLookup[featureKey];
                
                let val = null;
                if (isTimeSeries) {
                    val = (termKey === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
                } else {
                    val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${termKey}`] : null;
                }
                
                const name = config.tooltipName(dataRow || { DISTRICT: layer.feature.properties.DISTRICT, STATE_UT: layer.feature.properties.STATE_UT });
                csvContent += `"${name}",${val !== null ? val.toFixed(2) : ''}\n`;
            });
        }
    }
    
    const filename = getExportFilename(source, titleText, 'csv');
    triggerDownload(csvContent, filename, 'text/csv;charset=utf-8;');
}

// SVG Export Logic
async function runExportSVG(source, titleText, includeQR, onProgress, yieldFn) {
    onProgress = onProgress || (() => {});
    yieldFn    = yieldFn    || (() => Promise.resolve());
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    
    onProgress(5, 'Preparing export…');
    await sleep(800);
    let svgContent = '';
    
    if (source === 'line-chart') {
        onProgress(10, 'Initializing vector canvas context…');
        await sleep(1000);
        onProgress(25, 'Reality: Observed average temperatures in India have risen by 0.7°C since 1901…');
        await sleep(1200);
        onProgress(45, 'Risk: Monsoon variability directly impacts rainfed agriculture across India…');
        await sleep(1400);
        onProgress(65, 'Hope: Decarbonization pathways help stabilize long-term temperature trajectories…');
        await sleep(1200);
        onProgress(85, 'Hope: National policies aim for substantial emission intensity reductions by 2030…');
        await sleep(1000);
        onProgress(95, 'Applying chart styling and formatting vector nodes…');
        await sleep(800);
        if (!tsChart) return;
        const yMin = tsChart.scales.y.min;
        const yMax = tsChart.scales.y.max;
        const yTicks = tsChart.scales.y.ticks.map(t => t.value);
        const years = tsChart.data.labels;
        const minYear = years[0];
        const maxYear = years[years.length - 1];
        
        const svgWidth = 800;
        const svgHeight = 600;
        const padding = { top: 110, right: 50, bottom: 90, left: 70 };
        const plotWidth = svgWidth - padding.left - padding.right;
        const plotHeight = svgHeight - padding.top - padding.bottom;
        
        const getSvgX = (yr) => padding.left + ((yr - minYear) / (maxYear - minYear)) * plotWidth;
        const getSvgY = (val) => padding.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        const subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Period: ${tsStartYear}-${tsEndYear}`;
        
        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#ffffff" />
    
    <text x="${svgWidth / 2}" y="45" font-family="Arial" font-size="20" font-weight="bold" text-anchor="middle" fill="#0f172a">${titleText}</text>
    <text x="${svgWidth / 2}" y="72" font-family="Arial" font-size="13" fill="#64748b" text-anchor="middle">${subtitleText}</text>
    
    <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" />
`;

        // Horizontal Gridlines & Labels
        yTicks.forEach(tick => {
            const y = getSvgY(tick);
            svgContent += `    <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(svgWidth - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2,2" />\n`;
            svgContent += `    <text x="${(padding.left - 12).toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial" font-size="11" text-anchor="end" dominant-baseline="middle" fill="#64748b">${tick.toFixed(1)}</text>\n`;
        });
        
        // Vertical Gridlines & Labels (Every 10 years)
        for (let yr = Math.ceil(minYear / 10) * 10; yr <= maxYear; yr += 10) {
            const x = getSvgX(yr);
            svgContent += `    <line x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${(svgHeight - padding.bottom).toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2,2" />\n`;
            svgContent += `    <text x="${x.toFixed(1)}" y="${(svgHeight - padding.bottom + 18).toFixed(1)}" font-family="Arial" font-size="11" text-anchor="middle" fill="#64748b">${yr}</text>\n`;
        }
        
        // Axis Titles
        svgContent += `    <text x="${(padding.left + plotWidth / 2).toFixed(1)}" y="${(svgHeight - padding.bottom + 48).toFixed(1)}" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">Year</text>\n`;
        svgContent += `    <text transform="rotate(-90)" x="-${(padding.top + plotHeight / 2).toFixed(1)}" y="${(padding.left - 50).toFixed(1)}" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">${varCfg.label} Change (${varCfg.unit})</text>\n`;
        
        // Draw lines
        tsChart.data.datasets.forEach(ds => {
            let points = [];
            ds.data.forEach(pt => {
                if (pt && pt.y !== null && pt.y !== undefined) {
                    points.push(`${getSvgX(pt.x).toFixed(1)},${getSvgY(pt.y).toFixed(1)}`);
                }
            });
            if (points.length > 0) {
                svgContent += `    <polyline points="${points.join(' ')}" fill="none" stroke="${ds.borderColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />\n`;
            }
        });
        
        // Draw Legend (top right)
        let legendX = svgWidth - padding.right;
        tsChart.data.datasets.forEach((ds, idx) => {
            legendX -= 130;
            svgContent += `    <rect x="${legendX}" y="88" width="16" height="10" fill="${ds.borderColor}" rx="2" />\n`;
            svgContent += `    <text x="${legendX + 22}" y="97" font-family="Arial" font-size="11" fill="#334155" font-weight="bold">${ds.label}</text>\n`;
        });
        
    } else if (source === 'bar-chart') {
        onProgress(10, 'Initializing vector canvas context…');
        await sleep(1000);
        onProgress(25, 'Reality: Temperature anomalies in India have become more pronounced since 2000…');
        await sleep(1200);
        onProgress(45, 'Risk: Heatwave duration is projected to increase substantially by mid-century…');
        await sleep(1400);
        onProgress(65, 'Hope: Scaling grid storage and solar capacity reduces reliance on fossil fuels…');
        await sleep(1200);
        onProgress(85, 'Hope: India targets net-zero carbon emissions by 2070…');
        await sleep(1000);
        onProgress(95, 'Drawing chart geometries and preparing final rendering…');
        await sleep(800);
        if (!tsBarChart) return;
        const yMin = tsBarChart.scales.y.min;
        const yMax = tsBarChart.scales.y.max;
        const yTicks = tsBarChart.scales.y.ticks.map(t => t.value);
        const items = tsBarDataItems;
        
        const svgWidth = 800;
        const svgHeight = 550;
        const padding = { top: 110, right: 110, bottom: 95, left: 70 };
        const plotWidth = svgWidth - padding.left - padding.right;
        const plotHeight = svgHeight - padding.top - padding.bottom;
        
        const getSvgY = (val) => padding.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        const subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Period: 2015-2099 Anomalies`;
        
        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#ffffff" />
    
    <text x="${svgWidth / 2}" y="45" font-family="Arial" font-size="20" font-weight="bold" text-anchor="middle" fill="#0f172a">${titleText}</text>
    <text x="${svgWidth / 2}" y="72" font-family="Arial" font-size="13" fill="#64748b" text-anchor="middle">${subtitleText}</text>
    
    <rect x="${padding.left}" y="${padding.top}" width="${plotWidth}" height="${plotHeight}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" />
`;

        // Horizontal Gridlines & Labels
        yTicks.forEach(tick => {
            const y = getSvgY(tick);
            svgContent += `    <line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${(svgWidth - padding.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2,2" />\n`;
            svgContent += `    <text x="${(padding.left - 12).toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial" font-size="11" text-anchor="end" dominant-baseline="middle" fill="#64748b">${tick.toFixed(1)}</text>\n`;
        });
        
        const nBars = items.length;
        const gapFraction = 0.22;
        const groupWidth = plotWidth / nBars;
        const barWidth = groupWidth * (1 - gapFraction);
        const barGap = groupWidth * gapFraction;
        const useFullNames = nBars <= 10;
        const scenCfg = varCfg.scenarios[scenario];
        
        items.forEach((item, idx) => {
            const x = padding.left + idx * groupWidth + barGap / 2;
            const yVal = item.val || 0;
            const y = getSvgY(Math.max(0, yVal));
            const zeroY = getSvgY(0);
            const barHeight = Math.abs(getSvgY(yVal) - zeroY);
            
            const fillColor = window.getColor(yVal, scenCfg);
            
            svgContent += `    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${fillColor}" rx="3" stroke="#ffffff" stroke-width="0.5" />\n`;
            
            const labelText = useFullNames 
                ? item.stateName.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                : item.acronym;
                
            svgContent += `    <text x="${(x + barWidth / 2).toFixed(1)}" y="${(svgHeight - padding.bottom + 16).toFixed(1)}" font-family="Arial" font-size="${nBars > 20 ? 8 : 10}" text-anchor="end" dominant-baseline="middle" fill="#475569" transform="rotate(-45, ${(x + barWidth / 2).toFixed(1)}, ${(svgHeight - padding.bottom + 16).toFixed(1)})">${labelText}</text>\n`;
        });
        
        // Axis Title
        svgContent += `    <text transform="rotate(-90)" x="-${(padding.top + plotHeight / 2).toFixed(1)}" y="${(padding.left - 50).toFixed(1)}" font-family="Arial" font-size="13" font-weight="bold" text-anchor="middle" fill="#0f172a">${varCfg.label} Change (${varCfg.unit})</text>\n`;
        
    } else if (source.startsWith('map-')) {
        onProgress(5, 'Loading district boundaries from GeoJSON data…');
        await sleep(1000);
        onProgress(10, 'Reality: Climate changes are regional, requiring local-level adaptation planning…');
        await sleep(1200);
        onProgress(15, 'Applying equirectangular projection to geographic coordinate system…');
        await sleep(1200);
        const termKey = source.replace('map-', '');
        const termLabel = terms[termKey]?.label || '';
        const termYears = terms[termKey]?.years || '';

        // --- Layout ---
        // Padding: left for lat labels, bottom for lng labels
        const svgWidth  = 800;
        const svgHeight = 980;
        const padLeft   = 68;   // room for lat tick labels
        const padRight  = 20;
        const padTop    = 100;  // title + subtitle
        const padBottom = 160;  // colorbar + footer

        const drawW = svgWidth  - padLeft - padRight;
        const drawH = svgHeight - padTop  - padBottom;

        const bounds = MAP_BOUNDS;

        // Equirectangular: preserve aspect (lngSpan/latSpan corrected for cosine)
        const lngSpan    = bounds.maxLng - bounds.minLng;
        const latSpan    = bounds.maxLat - bounds.minLat;
        const midLat     = (bounds.minLat + bounds.maxLat) / 2;
        const cosCorrect = Math.cos((midLat * Math.PI) / 180);
        const geoAspect  = (lngSpan * cosCorrect) / latSpan;
        const canvAspect = drawW / drawH;

        let finalW = drawW, finalH = drawH;
        if (geoAspect < canvAspect) {
            finalW = drawH * geoAspect;
        } else {
            finalH = drawW / geoAspect;
        }
        const offX = padLeft + (drawW - finalW) / 2;
        const offY = padTop  + (drawH - finalH) / 2;

        const projectFunc = makeProjector(bounds, offX, offY, finalW, finalH);
        const getSvgX = lng => projectFunc(bounds.minLat, lng).x;
        const getSvgY = lat => projectFunc(lat, bounds.minLng).y;

        const subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Scale Level: ${currentLevel.toUpperCase()}`;
        const scenCfg = varCfg.scenarios[scenario];

        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#ffffff" />
    <text x="${(svgWidth/2).toFixed(1)}" y="46" font-family="Arial" font-size="18" font-weight="bold" text-anchor="middle" fill="#0f172a">${titleText}</text>
    <text x="${(svgWidth/2).toFixed(1)}" y="70" font-family="Arial" font-size="12" fill="#64748b" text-anchor="middle">${subtitleText}</text>
`;

        onProgress(18, 'Rendering regions…');
        await yieldFn();
        const totalFeatures = datasetGeoJSON.features.length;
        const CHUNK = Math.max(5, Math.ceil(totalFeatures / 12));
        const thoughts = [
            "Risk: Climate models project up to 4.4°C temp rise in India by 2099 under high emissions…",
            "Risk: Glacial melt threatens water flow stability in Ganges, Indus & Brahmaputra basins…",
            "Risk: Sea level rise poses severe risks to Mumbai, Chennai, and other coastal hubs…",
            "Risk: Rainfed crop yields could drop up to 15% by 2050 without active adaptation…",
            "Risk: Heatwaves in India are projected to increase 2.5x in duration by mid-century…",
            "Risk: Extreme rainfall and flash flood events are rising in the Himalayan region…",
            "Hope: India has committed to achieving net-zero emissions by 2070…",
            "Hope: India's solar energy capacity has grown rapidly, exceeding 70 GW…",
            "Hope: India targets 500 GW of non-fossil fuel capacity by 2030…",
            "Hope: National Green Hydrogen Mission aims to accelerate clean fuels transition…",
            "Hope: Climate-resilient agricultural practices are being adopted across dryland states…",
            "Hope: Clean energy transitions can create millions of sustainable green jobs in India…"
        ];
        for (let i = 0; i < totalFeatures; i++) {
            const feature    = datasetGeoJSON.features[i];
            const featureKey = levelsCfg[currentLevel].keyGen(feature.properties);
            const dataRow    = window.dataLookup[featureKey];
            let val = null;
            if (isTimeSeries) {
                val = (termKey === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
            } else {
                val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${termKey}`] : null;
            }
            const fillColor = window.getColor(val, scenCfg);
            const d = geojsonToSvgPath(feature.geometry, projectFunc);
            svgContent += `    <path d="${d}" fill="${fillColor}" stroke="#1e293b" stroke-width="0.5" stroke-linejoin="round" />\n`;
            if ((i + 1) % CHUNK === 0 || i === totalFeatures - 1) {
                const chunkIndex = Math.min(thoughts.length - 1, Math.floor(((i + 1) / totalFeatures) * thoughts.length));
                const thought = thoughts[chunkIndex];
                const pct = 18 + ((i + 1) / totalFeatures) * 60;
                onProgress(pct, `${thought} (${Math.round((i+1)/totalFeatures*100)}%)`);
                await sleep(550);
            }
        }

        onProgress(82, 'Drawing national boundary lines and styling coordinate borders…');
        await sleep(1000);
        // --- Map border ---
        svgContent += `    <rect x="${offX.toFixed(1)}" y="${offY.toFixed(1)}" width="${finalW.toFixed(1)}" height="${finalH.toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="1.5" />\n`;

        // --- Lat/Lon ticks every 5° ---
        const step = 5;
        const latStart = Math.ceil(bounds.minLat / step) * step;
        const lngStart = Math.ceil(bounds.minLng / step) * step;

        for (let lat = latStart; lat <= bounds.maxLat; lat += step) {
            const y = getSvgY(lat);
            svgContent += `    <line x1="${offX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(offX-6).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${(offX-9).toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial" font-size="10" font-weight="bold" text-anchor="end" dominant-baseline="middle" fill="#0f172a">${lat}°N</text>\n`;
        }
        for (let lng = lngStart; lng <= bounds.maxLng; lng += step) {
            const x = getSvgX(lng);
            svgContent += `    <line x1="${x.toFixed(1)}" y1="${(offY+finalH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(offY+finalH+6).toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${x.toFixed(1)}" y="${(offY+finalH+16).toFixed(1)}" font-family="Arial" font-size="10" font-weight="bold" text-anchor="middle" fill="#0f172a">${lng}°E</text>\n`;
        }

        // --- Colorbar ---
        const arrowW  = 14;
        const barW    = finalW * 0.7;
        const barH    = 16;
        const barX    = offX + (finalW - barW) / 2;
        const barY    = offY + finalH + 50;

        const scenCfgColors = scenCfg.colors;
        const nColors  = scenCfgColors.length;
        const rectW    = barW / nColors;
        scenCfgColors.forEach((color, idx) => {
            const rx = barX + idx * rectW;
            svgContent += `    <rect x="${rx.toFixed(1)}" y="${barY.toFixed(1)}" width="${(rectW+0.2).toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" stroke="none" />\n`;
        });
        // outline
        svgContent += `    <rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="1" />\n`;

        // Left arrow (pointing left = "below minimum")
        const arrowLX = barX - arrowW;
        const arrowMY = barY + barH / 2;
        svgContent += `    <polygon points="${arrowLX.toFixed(1)},${arrowMY.toFixed(1)} ${barX.toFixed(1)},${barY.toFixed(1)} ${barX.toFixed(1)},${(barY+barH).toFixed(1)}" fill="${scenCfgColors[0]}" stroke="#0f172a" stroke-width="1" stroke-linejoin="round" />\n`;

        // Right arrow (pointing right = "above maximum")
        const arrowRX = barX + barW + arrowW;
        svgContent += `    <polygon points="${arrowRX.toFixed(1)},${arrowMY.toFixed(1)} ${(barX+barW).toFixed(1)},${barY.toFixed(1)} ${(barX+barW).toFixed(1)},${(barY+barH).toFixed(1)}" fill="${scenCfgColors[nColors-1]}" stroke="#0f172a" stroke-width="1" stroke-linejoin="round" />\n`;

        // Ticks
        const ticks   = scenCfg.ticks;
        const minTick = ticks[0];
        const maxTick = ticks[ticks.length - 1];
        ticks.forEach(v => {
            const pct = (v - minTick) / (maxTick - minTick);
            const tx  = barX + pct * barW;
            svgContent += `    <line x1="${tx.toFixed(1)}" y1="${(barY+barH).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(barY+barH+5).toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${tx.toFixed(1)}" y="${(barY+barH+15).toFixed(1)}" font-family="Arial" font-size="9" text-anchor="middle" fill="#334155">${v.toFixed(1)}</text>\n`;
        });

        // Label
        svgContent += `    <text x="${(barX+barW/2).toFixed(1)}" y="${(barY+barH+34).toFixed(1)}" font-family="Arial" font-size="11" font-weight="bold" text-anchor="middle" fill="#0f172a">${varCfg.label} Change (${varCfg.unit})</text>\n`;
        
        onProgress(90, 'Constructing linear colorbar scale…');
        await sleep(1000);
        onProgress(93, 'Adding verification QR code layer…');
        await sleep(1000);
    }
    
    onProgress(96, 'Finalising vector nodes and file compilation…');
    await sleep(800);
    // Add common footer & QR code to SVG bottom
    const svgHeight = source.startsWith('map-') ? 980 : (source === 'bar-chart' ? 550 : 600);
    const svgWidth = 800;
    
    svgContent += `    <text x="40" y="${svgHeight - 45}" font-family="Arial" font-size="10" fill="#64748b">Source: Bias Corrected 0.25°×0.25° product developed at CCCR, IITM Pune</text>\n`;
    svgContent += `    <text x="40" y="${svgHeight - 28}" font-family="Arial" font-size="10" fill="#64748b">Generated via IITM ESM Climate Dashboard | cccr.tropmet.res.in/esm/dashboard.php</text>\n`;
    
    if (includeQR) {
        svgContent += `    <image x="${svgWidth - 95}" y="${svgHeight - 85}" width="55" height="55" href="${EXPORT_QR_DATA_URI}" />\n`;
    }
    
    svgContent += `</svg>`;
    
    const filename = getExportFilename(source, titleText, 'svg');
    triggerDownload(svgContent, filename, 'image/svg+xml;charset=utf-8');
}

// Convert GeoJSON geometry to SVG Path
function geojsonToSvgPath(geom, projectFunc) {
    let d = '';
    if (geom.type === 'Polygon') {
        geom.coordinates.forEach(ring => {
            ring.forEach((coord, idx) => {
                const pt = projectFunc(coord[1], coord[0]);
                if (idx === 0) d += ` M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                else d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
            });
            d += ' Z';
        });
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(polyCoords => {
            polyCoords.forEach(ring => {
                ring.forEach((coord, idx) => {
                    const pt = projectFunc(coord[1], coord[0]);
                    if (idx === 0) d += ` M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                    else d += ` L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                });
                d += ' Z';
            });
        });
    }
    return d;
}

// PNG Export Logic
async function runExportPNG(source, titleText, scale, includeQR, onProgress, yieldFn) {
    onProgress = onProgress || (() => {});
    yieldFn    = yieldFn    || (() => Promise.resolve());
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    
    // Canvas sizing based on source
    const baseWidth = 800;
    const baseHeight = source.startsWith('map-') ? 980 : (source === 'bar-chart' ? 550 : 600);
    
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    onProgress(5, 'Preparing canvas…');
    await yieldFn();

    // Solid white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // Title
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(20 * scale)}px Arial`;
    ctx.fillText(titleText, width / 2, 28 * scale);
    
    // Subtitle
    let subtitleText = '';
    if (source === 'line-chart') {
        subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Period: ${tsStartYear}-${tsEndYear}`;
    } else if (source === 'bar-chart') {
        subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Period: 2015-2099 Anomalies`;
    } else {
        subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Scale Level: ${currentLevel.toUpperCase()}`;
    }
    
    ctx.fillStyle = '#64748b';
    ctx.font = `${Math.round(13 * scale)}px Arial`;
    ctx.fillText(subtitleText, width / 2, 60 * scale);
    
    // Draw Visualization
    if (source === 'line-chart') {
        onProgress(10, 'Initializing vector canvas context…');
        await sleep(1000);
        onProgress(25, 'Reality: Observed average temperatures in India have risen by 0.7°C since 1901…');
        await sleep(1200);
        onProgress(45, 'Risk: Monsoon variability directly impacts rainfed agriculture across India…');
        await sleep(1400);
        onProgress(65, 'Hope: Decarbonization pathways help stabilize long-term temperature trajectories…');
        await sleep(1200);
        onProgress(85, 'Hope: National policies aim for substantial emission intensity reductions by 2030…');
        await sleep(1000);
        onProgress(95, 'Applying chart styling and formatting vector nodes…');
        await sleep(800);
        if (!tsChart) return;
        const chartDataUrl = getHighDPIChartImage(tsChart, scale, 690, 400);
        const chartImg = await loadImage(chartDataUrl);
        ctx.drawImage(chartImg, 55 * scale, 95 * scale, 690 * scale, 400 * scale);
        
    } else if (source === 'bar-chart') {
        onProgress(10, 'Initializing vector canvas context…');
        await sleep(1000);
        onProgress(25, 'Reality: Temperature anomalies in India have become more pronounced since 2000…');
        await sleep(1200);
        onProgress(45, 'Risk: Heatwave duration is projected to increase substantially by mid-century…');
        await sleep(1400);
        onProgress(65, 'Hope: Scaling grid storage and solar capacity reduces reliance on fossil fuels…');
        await sleep(1200);
        onProgress(85, 'Hope: India targets net-zero carbon emissions by 2070…');
        await sleep(1000);
        onProgress(95, 'Drawing chart geometries and preparing final rendering…');
        await sleep(800);
        if (!tsBarChart) return;
        const chartDataUrl = getHighDPIChartImage(tsBarChart, scale, 620, 350);
        const chartImg = await loadImage(chartDataUrl);
        ctx.drawImage(chartImg, 55 * scale, 95 * scale, 620 * scale, 350 * scale);
        
    } else if (source.startsWith('map-')) {
        onProgress(5, 'Loading district boundaries from GeoJSON data…');
        await sleep(1000);
        onProgress(10, 'Reality: Climate changes are regional, requiring local-level adaptation planning…');
        await sleep(1200);
        onProgress(15, 'Applying equirectangular projection to geographic coordinate system…');
        await sleep(1200);
        const termKey = source.replace('map-', '');

        // --- Layout (matches SVG version) ---
        const padLeft   = 68;
        const padRight  = 20;
        const padTop    = 100;
        const padBottom = 160;

        const drawW = baseWidth  - padLeft - padRight;
        const drawH = baseHeight - padTop  - padBottom;

        const bounds = MAP_BOUNDS;
        const lngSpan    = bounds.maxLng - bounds.minLng;
        const latSpan    = bounds.maxLat - bounds.minLat;
        const midLat     = (bounds.minLat + bounds.maxLat) / 2;
        const cosCorrect = Math.cos((midLat * Math.PI) / 180);
        const geoAspect  = (lngSpan * cosCorrect) / latSpan;
        const canvAspect = drawW / drawH;

        let finalW = drawW, finalH = drawH;
        if (geoAspect < canvAspect) { finalW = drawH * geoAspect; }
        else                        { finalH = drawW / geoAspect; }

        const offX = padLeft + (drawW - finalW) / 2;
        const offY = padTop  + (drawH - finalH) / 2;

        // Equirectangular projector returning canvas pixels (already scaled)
        const projector = makeProjector(bounds, offX, offY, finalW, finalH);
        const getCanvasCoords = (lat, lng) => {
            const p = projector(lat, lng);
            return { x: p.x * scale, y: p.y * scale };
        };
        const getCanvasX = lng => projector(bounds.minLat, lng).x * scale;
        const getCanvasY = lat => projector(lat, bounds.minLng).y * scale;

        const scenCfg = varCfg.scenarios[scenario];

        // --- Render features ---
        onProgress(18, 'Rendering regions…');
        await yieldFn();
        const totalFeatures = datasetGeoJSON.features.length;
        const CHUNK = Math.max(5, Math.ceil(totalFeatures / 12));
        const thoughts = [
            "Risk: Climate models project up to 4.4°C temp rise in India by 2099 under high emissions…",
            "Risk: Glacial melt threatens water flow stability in Ganges, Indus & Brahmaputra basins…",
            "Risk: Sea level rise poses severe risks to Mumbai, Chennai, and other coastal hubs…",
            "Risk: Rainfed crop yields could drop up to 15% by 2050 without active adaptation…",
            "Risk: Heatwaves in India are projected to increase 2.5x in duration by mid-century…",
            "Risk: Extreme rainfall and flash flood events are rising in the Himalayan region…",
            "Hope: India has committed to achieving net-zero emissions by 2070…",
            "Hope: India's solar energy capacity has grown rapidly, exceeding 70 GW…",
            "Hope: India targets 500 GW of non-fossil fuel capacity by 2030…",
            "Hope: National Green Hydrogen Mission aims to accelerate clean fuels transition…",
            "Hope: Climate-resilient agricultural practices are being adopted across dryland states…",
            "Hope: Clean energy transitions can create millions of sustainable green jobs in India…"
        ];
        for (let i = 0; i < totalFeatures; i++) {
            const feature    = datasetGeoJSON.features[i];
            const featureKey = levelsCfg[currentLevel].keyGen(feature.properties);
            const dataRow    = window.dataLookup[featureKey];
            let val = null;
            if (isTimeSeries) {
                val = (termKey === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
            } else {
                val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${termKey}`] : null;
            }
            ctx.fillStyle   = window.getColor(val, scenCfg);
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth   = 0.5 * scale;
            const geom = feature.geometry;
            if (geom.type === 'Polygon') {
                drawCanvasPolygon(ctx, geom.coordinates, getCanvasCoords);
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(pc => drawCanvasPolygon(ctx, pc, getCanvasCoords));
            }
            if ((i + 1) % CHUNK === 0 || i === totalFeatures - 1) {
                const chunkIndex = Math.min(thoughts.length - 1, Math.floor(((i + 1) / totalFeatures) * thoughts.length));
                const thought = thoughts[chunkIndex];
                const pct = 18 + ((i + 1) / totalFeatures) * 60;
                onProgress(pct, `${thought} (${Math.round((i+1)/totalFeatures*100)}%)`);
                await sleep(550);
            }
        }

        onProgress(82, 'Drawing national boundary lines and styling coordinate borders…');
        await sleep(1000);
        // --- Border ---
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth   = 1.5 * scale;
        ctx.strokeRect(offX * scale, offY * scale, finalW * scale, finalH * scale);

        // --- Lat/Lon ticks every 5° ---
        ctx.strokeStyle = '#0f172a';
        ctx.fillStyle   = '#0f172a';
        ctx.lineWidth   = 1.0 * scale;
        ctx.font        = `bold ${Math.round(10 * scale)}px Arial`;

        const step = 5;
        const latStart = Math.ceil(bounds.minLat / step) * step;
        const lngStart = Math.ceil(bounds.minLng / step) * step;

        for (let lat = latStart; lat <= bounds.maxLat; lat += step) {
            const y = getCanvasY(lat);
            ctx.beginPath();
            ctx.moveTo(offX * scale, y);
            ctx.lineTo((offX - 6) * scale, y);
            ctx.stroke();
            ctx.textAlign    = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${lat}°N`, (offX - 9) * scale, y);
        }
        for (let lng = lngStart; lng <= bounds.maxLng; lng += step) {
            const x    = getCanvasX(lng);
            const yBot = (offY + finalH) * scale;
            ctx.beginPath();
            ctx.moveTo(x, yBot);
            ctx.lineTo(x, yBot + 6 * scale);
            ctx.stroke();
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${lng}°E`, x, yBot + 8 * scale);
        }

        // --- Colorbar ---
        const arrowW = 14;
        const barW   = finalW * 0.7;
        const barH   = 16;
        const barX   = offX + (finalW - barW) / 2;
        const barY   = offY + finalH + 50;

        const nColors  = scenCfg.colors.length;
        const blockW   = barW / nColors;
        scenCfg.colors.forEach((color, idx) => {
            ctx.fillStyle = color;
            ctx.fillRect((barX + idx * blockW) * scale, barY * scale, (blockW + 0.2) * scale, barH * scale);
        });
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth   = 1.0 * scale;
        ctx.strokeRect(barX * scale, barY * scale, barW * scale, barH * scale);

        // Left arrow
        const arrowMY = (barY + barH / 2) * scale;
        ctx.fillStyle   = scenCfg.colors[0];
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth   = 1.0 * scale;
        ctx.beginPath();
        ctx.moveTo((barX - arrowW) * scale, arrowMY);
        ctx.lineTo(barX * scale, barY * scale);
        ctx.lineTo(barX * scale, (barY + barH) * scale);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Right arrow
        ctx.fillStyle = scenCfg.colors[nColors - 1];
        ctx.beginPath();
        ctx.moveTo((barX + barW + arrowW) * scale, arrowMY);
        ctx.lineTo((barX + barW) * scale, barY * scale);
        ctx.lineTo((barX + barW) * scale, (barY + barH) * scale);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        // Ticks
        const ticks   = scenCfg.ticks;
        const minTick = ticks[0];
        const maxTick = ticks[ticks.length - 1];
        ctx.fillStyle    = '#334155';
        ctx.font         = `${Math.round(9 * scale)}px Arial`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ticks.forEach(v => {
            const pct = (v - minTick) / (maxTick - minTick);
            const tx  = (barX + pct * barW) * scale;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth   = 1.0 * scale;
            ctx.beginPath();
            ctx.moveTo(tx, (barY + barH) * scale);
            ctx.lineTo(tx, (barY + barH + 5) * scale);
            ctx.stroke();
            ctx.fillStyle = '#334155';
            ctx.fillText(v.toFixed(1), tx, (barY + barH + 7) * scale);
        });

        // Label
        ctx.fillStyle    = '#0f172a';
        ctx.font         = `bold ${Math.round(11 * scale)}px Arial`;
        ctx.textAlign    = 'center';
        ctx.fillText(`${varCfg.label} Change (${varCfg.unit})`, (barX + barW / 2) * scale, (barY + barH + 26) * scale);
        
        onProgress(90, 'Constructing linear colorbar scale…');
        await sleep(1000);
        onProgress(93, 'Adding verification QR code layer…');
        await sleep(1000);
    }
    
    onProgress(96, 'Finalising vector nodes and file compilation…');
    await sleep(800);
    // Footer texts
    ctx.fillStyle = '#64748b';
    ctx.font = `${Math.round(10 * scale)}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Source: Bias Corrected 0.25°×0.25° product developed at CCCR, IITM Pune', 40 * scale, height - 42 * scale);
    ctx.fillText('Generated via IITM ESM Climate Dashboard | cccr.tropmet.res.in/esm/dashboard.php', 40 * scale, height - 25 * scale);
    
    // QR Code
    if (includeQR) {
        const qrImg = await loadImage(EXPORT_QR_DATA_URI);
        const qrSize = 55 * scale;
        ctx.drawImage(qrImg, width - qrSize - 40 * scale, height - qrSize - 40 * scale, qrSize, qrSize);
    }
    
    // Trigger download
    const filename = getExportFilename(source, titleText, 'png');
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Helper: draw polygon on Canvas
function drawCanvasPolygon(ctx, rings, projectFunc) {
    ctx.beginPath();
    rings.forEach(ring => {
        ring.forEach((coord, coordIdx) => {
            const { x, y } = projectFunc(coord[1], coord[0]);
            if (coordIdx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
    });
    ctx.fill('evenodd');
    ctx.stroke();
}
