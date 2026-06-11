const EXPORT_QR_DATA_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIwAAACMAQAAAACGu3yTAAABQklEQVR4nKWWwW3lMBQDR0Huow7cf1nugK8C5vAXC2w2AT4s3UzgETQ9krXKtzUf3xV4U5q1FuwZ1tqz1np38H/pkzLMuNJ9U+a51wezGDq4uJj1/uAv0h4dHwz+INUZ73MvC3uurmtu7IHXyob8fdyQ57ls/yC2L2z7PBcJ1FANgR7k4qLDdgbAE74oAoJNmvg8F4lqDCnm5B0pAZM0RDzJ1SKhpkpzwARpkxCahnDWV4Vq68vyyCutaFIxz70+ZQNEltzXHOxHGgliYssZX8YW07w2+RET4fU1a8UjJmibShPTHHRPCrEWk55xn0aTpiCesvpiDAP0oK9VYHBlE5y3B3/uHtoWE5IcnattZg0OInsf/rcB7u6VtT26AwDkWteql0lOvYjjcN/XeNJ9mwZM7eF5HyCqNi+7M77+Wc/vhV+4agCvYD249AAAAABJRU5ErkJggg==";

const MAP_BOUNDS = {
    minLng: 68.0,
    maxLng: 97.5,
    minLat: 6.0,
    maxLat: 37.5
};

// Help helper to get Mercator coordinates
function projectMercator(lat, lng) {
    const x = lng;
    const latRad = (lat * Math.PI) / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y };
}

// Bounding box in Mercator coordinates
const boundsMercator = {
    min: projectMercator(MAP_BOUNDS.minLat, MAP_BOUNDS.minLng),
    max: projectMercator(MAP_BOUNDS.maxLat, MAP_BOUNDS.maxLng)
};

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

// Trigger export actions
async function triggerExportStudioAction() {
    const actionBtn = document.getElementById('export-action-btn');
    const titleInput = document.getElementById('export-title-input');
    const format = document.querySelector('input[name="export-format"]:checked')?.value || 'png';
    const scale = parseFloat(document.querySelector('input[name="export-quality"]:checked')?.value || '3.0');
    const includeQR = document.getElementById('export-qr-toggle')?.checked ?? true;
    
    const titleText = titleInput?.value || 'Climate Dashboard Export';
    
    if (actionBtn) {
        actionBtn.disabled = true;
        actionBtn.innerHTML = '<div class="export-studio-spinner"></div><span>Exporting...</span>';
    }
    
    try {
        if (format === 'csv') {
            await runExportCSV(currentExportSource, titleText);
        } else if (format === 'svg') {
            await runExportSVG(currentExportSource, titleText, includeQR);
        } else {
            await runExportPNG(currentExportSource, titleText, scale, includeQR);
        }
        closeExportStudio();
    } catch (err) {
        console.error('Export failed:', err);
        alert('Oops! Export failed. Please try again.');
    } finally {
        if (actionBtn) {
            actionBtn.disabled = false;
            actionBtn.innerHTML = `<span>Download ${format.toUpperCase()}</span>`;
        }
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
        
        tsChart.data.labels.forEach((year, idx) => {
            const row = [year];
            tsChart.data.datasets.forEach(ds => {
                const val = ds.data[idx];
                row.push(val !== undefined && val !== null ? val.toFixed(2) : '');
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
async function runExportSVG(source, titleText, includeQR) {
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    
    let svgContent = '';
    
    if (source === 'line-chart') {
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
            ds.data.forEach((val, idx) => {
                if (val !== null && val !== undefined) {
                    const yr = years[idx];
                    points.push(`${getSvgX(yr).toFixed(1)},${getSvgY(val).toFixed(1)}`);
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
        if (!tsBarChart) return;
        const yMin = tsBarChart.scales.y.min;
        const yMax = tsBarChart.scales.y.max;
        const yTicks = tsBarChart.scales.y.ticks.map(t => t.value);
        const items = tsBarDataItems;
        
        const svgWidth = 800;
        const svgHeight = 550;
        const padding = { top: 110, right: 40, bottom: 95, left: 70 };
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
        const termKey = source.replace('map-', '');
        const termLabel = terms[termKey]?.label || '';
        const termYears = terms[termKey]?.years || '';
        
        const bounds = getGeoJSONBounds(datasetGeoJSON);
        const minProj = projectMercator(bounds.minLat, bounds.minLng);
        const maxProj = projectMercator(bounds.maxLat, bounds.maxLng);
        
        const dx = maxProj.x - minProj.x;
        const dy = maxProj.y - minProj.y;
        const aspect = dx / dy;
        
        const svgWidth = 800;
        const svgHeight = 900;
        const paddingOffset = 40;
        
        const drawWidth = svgWidth - 2 * paddingOffset;
        const drawHeight = 550;
        
        let finalDrawWidth = drawWidth;
        let finalDrawHeight = drawHeight;
        
        if (drawWidth / drawHeight > aspect) {
            finalDrawWidth = drawHeight * aspect;
        } else {
            finalDrawHeight = drawWidth / aspect;
        }
        
        const offsetX = paddingOffset + (drawWidth - finalDrawWidth) / 2;
        const offsetY = 120 + (drawHeight - finalDrawHeight) / 2;
        
        const getSvgX = (lng) => {
            const proj = projectMercator(bounds.minLat, lng);
            return offsetX + ((proj.x - minProj.x) / (maxProj.x - minProj.x)) * finalDrawWidth;
        };
        const getSvgY = (lat) => {
            const proj = projectMercator(lat, bounds.minLng);
            return offsetY + finalDrawHeight - ((proj.y - minProj.y) / (maxProj.y - minProj.y)) * finalDrawHeight;
        };
        
        const projectFunc = (lat, lng) => ({
            x: getSvgX(lng),
            y: getSvgY(lat)
        });
        
        const subtitleText = `Scenario: ${scenario} | Season: ${seasonLabel} | Scale Level: ${currentLevel.toUpperCase()}`;
        const scenCfg = varCfg.scenarios[scenario];
        
        svgContent += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="100%">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#ffffff" />
    
    <text x="${svgWidth / 2}" y="45" font-family="Arial" font-size="20" font-weight="bold" text-anchor="middle" fill="#0f172a">${titleText}</text>
    <text x="${svgWidth / 2}" y="72" font-family="Arial" font-size="13" fill="#64748b" text-anchor="middle">${subtitleText}</text>
`;

        // Render GeoJSON polygons
        datasetGeoJSON.features.forEach(feature => {
            const featureKey = levelsCfg[currentLevel].keyGen(feature.properties);
            const dataRow = window.dataLookup[featureKey];
            
            let val = null;
            if (isTimeSeries) {
                val = (termKey === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
            } else {
                val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${termKey}`] : null;
            }
            
            const fillColor = window.getColor(val, scenCfg);
            const d = geojsonToSvgPath(feature.geometry, projectFunc);
            
            svgContent += `    <path d="${d}" fill="${fillColor}" stroke="#1e293b" stroke-width="0.5" stroke-linejoin="round" />\n`;
        });
        
        // Spatial Area Border Box
        svgContent += `    <rect x="${offsetX.toFixed(1)}" y="${offsetY.toFixed(1)}" width="${finalDrawWidth.toFixed(1)}" height="${finalDrawHeight.toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="1.5" />\n`;
        
        // Latitude / Longitude ticks
        const latTicks = [10, 15, 20, 25, 30, 35].filter(lat => lat >= bounds.minLat && lat <= bounds.maxLat);
        const lngTicks = [70, 75, 80, 85, 90, 95].filter(lng => lng >= bounds.minLng && lng <= bounds.maxLng);
        
        latTicks.forEach(lat => {
            const y = getSvgY(lat);
            svgContent += `    <line x1="${offsetX.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(offsetX - 6).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${(offsetX - 10).toFixed(1)}" y="${y.toFixed(1)}" font-family="Arial" font-size="10" font-weight="bold" text-anchor="end" dominant-baseline="middle" fill="#0f172a">${lat}°N</text>\n`;
        });
        
        lngTicks.forEach(lng => {
            const x = getSvgX(lng);
            svgContent += `    <line x1="${x.toFixed(1)}" y1="${(offsetY + finalDrawHeight).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(offsetY + finalDrawHeight + 6).toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${x.toFixed(1)}" y="${(offsetY + finalDrawHeight + 16).toFixed(1)}" font-family="Arial" font-size="10" font-weight="bold" text-anchor="middle" fill="#0f172a">${lng}°E</text>\n`;
        });
        
        // Color scale bar
        const barWidth = finalDrawWidth * 0.65;
        const barHeight = 14;
        const barX = offsetX + (finalDrawWidth - barWidth) / 2;
        const barY = offsetY + finalDrawHeight + 60;
        
        // CONTIGUOUS RECTANGLES FOR COMPATIBILITY
        const nColors = scenCfg.colors.length;
        const rectWidth = barWidth / nColors;
        scenCfg.colors.forEach((color, idx) => {
            const rx = barX + idx * rectWidth;
            svgContent += `    <rect x="${rx.toFixed(1)}" y="${barY.toFixed(1)}" width="${(rectWidth + 0.15).toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${color}" stroke="none" />\n`;
        });
        svgContent += `    <rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="none" stroke="#0f172a" stroke-width="1" />\n`;
        
        // Ticks for Color Bar
        const ticks = scenCfg.ticks;
        const minTick = ticks[0];
        const maxTick = ticks[ticks.length - 1];
        
        ticks.forEach(v => {
            const pct = (v - minTick) / (maxTick - minTick);
            const tx = barX + pct * barWidth;
            svgContent += `    <line x1="${tx.toFixed(1)}" y1="${(barY + barHeight).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(barY + barHeight + 4).toFixed(1)}" stroke="#0f172a" stroke-width="1" />\n`;
            svgContent += `    <text x="${tx.toFixed(1)}" y="${(barY + barHeight + 14).toFixed(1)}" font-family="Arial" font-size="9" text-anchor="middle" fill="#334155">${v.toFixed(1)}</text>\n`;
        });
        
        // Metric Unit below Color scale
        svgContent += `    <text x="${(barX + barWidth / 2).toFixed(1)}" y="${(barY + barHeight + 32).toFixed(1)}" font-family="Arial" font-size="11" font-weight="bold" text-anchor="middle" fill="#0f172a">${varCfg.label} Change (${varCfg.unit})</text>\n`;
    }
    
    // Add common footer & QR code to SVG bottom
    const svgHeight = source.startsWith('map-') ? 900 : (source === 'bar-chart' ? 550 : 600);
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
async function runExportPNG(source, titleText, scale, includeQR) {
    const metric = window.selectedMetric?.() || 'mean_temp';
    const scenario = window.selectedScenario?.() || 'SSP585';
    const varCfg = variablesConfig[metric];
    const seasonLabel = tsSeasonLabels[tsSeason] || tsSeason.toUpperCase();
    const isTimeSeries = document.body.classList.contains('time-series-mode');
    
    // Canvas sizing based on source
    const baseWidth = 800;
    const baseHeight = source.startsWith('map-') ? 900 : (source === 'bar-chart' ? 550 : 600);
    
    const width = baseWidth * scale;
    const height = baseHeight * scale;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
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
        if (!tsChart) return;
        const chartDataUrl = getHighDPIChartImage(tsChart, scale, 690, 400);
        const chartImg = await loadImage(chartDataUrl);
        ctx.drawImage(chartImg, 55 * scale, 95 * scale, 690 * scale, 400 * scale);
        
    } else if (source === 'bar-chart') {
        if (!tsBarChart) return;
        const chartDataUrl = getHighDPIChartImage(tsBarChart, scale, 690, 350);
        const chartImg = await loadImage(chartDataUrl);
        ctx.drawImage(chartImg, 55 * scale, 95 * scale, 690 * scale, 350 * scale);
        
    } else if (source.startsWith('map-')) {
        const termKey = source.replace('map-', '');
        
        // Calculate dynamic projection bounds for India dataset
        const bounds = getGeoJSONBounds(datasetGeoJSON);
        const minProj = projectMercator(bounds.minLat, bounds.minLng);
        const maxProj = projectMercator(bounds.maxLat, bounds.maxLng);
        
        const dx = maxProj.x - minProj.x;
        const dy = maxProj.y - minProj.y;
        const aspect = dx / dy;
        
        const paddingOffset = 40;
        const drawWidth = baseWidth - 2 * paddingOffset;
        const drawHeight = 550;
        
        let finalDrawWidth = drawWidth;
        let finalDrawHeight = drawHeight;
        
        if (drawWidth / drawHeight > aspect) {
            finalDrawWidth = drawHeight * aspect;
        } else {
            finalDrawHeight = drawWidth / aspect;
        }
        
        const offsetX = paddingOffset + (drawWidth - finalDrawWidth) / 2;
        const offsetY = 120 + (drawHeight - finalDrawHeight) / 2;
        
        // Lat/Lng to Canvas Coordinates Projection helper
        const getCanvasCoords = (lat, lng) => {
            const proj = projectMercator(lat, lng);
            const x = (offsetX + ((proj.x - minProj.x) / (maxProj.x - minProj.x)) * finalDrawWidth) * scale;
            const y = (offsetY + finalDrawHeight - ((proj.y - minProj.y) / (maxProj.y - minProj.y)) * finalDrawHeight) * scale;
            return { x, y };
        };
        
        const scenCfg = varCfg.scenarios[scenario];
        
        // Render features
        datasetGeoJSON.features.forEach(feature => {
            const featureKey = levelsCfg[currentLevel].keyGen(feature.properties);
            const dataRow = window.dataLookup[featureKey];
            
            let val = null;
            if (isTimeSeries) {
                val = (termKey === 'near') ? (tsPeriodMeans[featureKey.toUpperCase()] || null) : null;
            } else {
                val = dataRow ? dataRow[`${varCfg.json_key}_${scenario.toLowerCase()}_${termKey}`] : null;
            }
            
            const fillColor = window.getColor(val, scenCfg);
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 0.5 * scale;
            
            const geom = feature.geometry;
            if (geom.type === 'Polygon') {
                drawCanvasPolygon(ctx, geom.coordinates, getCanvasCoords);
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(polyCoords => {
                    drawCanvasPolygon(ctx, polyCoords, getCanvasCoords);
                });
            }
        });
        
        // Outer Border Box
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5 * scale;
        ctx.strokeRect(offsetX * scale, offsetY * scale, finalDrawWidth * scale, finalDrawHeight * scale);
        
        // Draw Ticks & Labels
        const latTicks = [10, 15, 20, 25, 30, 35].filter(lat => lat >= bounds.minLat && lat <= bounds.maxLat);
        const lngTicks = [70, 75, 80, 85, 90, 95].filter(lng => lng >= bounds.minLng && lng <= bounds.maxLng);
        
        ctx.strokeStyle = '#0f172a';
        ctx.fillStyle = '#0f172a';
        ctx.lineWidth = 1.0 * scale;
        ctx.font = `bold ${Math.round(10 * scale)}px Arial`;
        
        // Latitude Ticks
        latTicks.forEach(lat => {
            const { y } = getCanvasCoords(lat, bounds.minLng);
            ctx.beginPath();
            ctx.moveTo(offsetX * scale, y);
            ctx.lineTo((offsetX - 6) * scale, y);
            ctx.stroke();
            
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${lat}°N`, (offsetX - 10) * scale, y);
        });
        
        // Longitude Ticks
        lngTicks.forEach(lng => {
            const { x } = getCanvasCoords(bounds.minLat, lng);
            const yEdge = (offsetY + finalDrawHeight) * scale;
            ctx.beginPath();
            ctx.moveTo(x, yEdge);
            ctx.lineTo(x, yEdge + 6 * scale);
            ctx.stroke();
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${lng}°E`, x, yEdge + 10 * scale);
        });
        
        // Horizontal Color Legend
        const barWidth = finalDrawWidth * 0.65;
        const barHeight = 14;
        const barX = offsetX + (finalDrawWidth - barWidth) / 2;
        const barY = offsetY + finalDrawHeight + 60;
        
        // Draw Color Blocks
        const nColors = scenCfg.colors.length;
        const blockWidth = barWidth / nColors;
        scenCfg.colors.forEach((color, idx) => {
            ctx.fillStyle = color;
            ctx.fillRect(
                (barX + idx * blockWidth) * scale, 
                barY * scale, 
                (blockWidth + 0.15) * scale, 
                barHeight * scale
            );
        });
        
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.0 * scale;
        ctx.strokeRect(barX * scale, barY * scale, barWidth * scale, barHeight * scale);
        
        // Legend Ticks
        const ticks = scenCfg.ticks;
        const minTick = ticks[0];
        const maxTick = ticks[ticks.length - 1];
        
        ctx.fillStyle = '#334155';
        ctx.font = `${Math.round(9 * scale)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        ticks.forEach(v => {
            const pct = (v - minTick) / (maxTick - minTick);
            const tx = (barX + pct * barWidth) * scale;
            ctx.beginPath();
            ctx.moveTo(tx, (barY + barHeight) * scale);
            ctx.lineTo(tx, (barY + barHeight + 4) * scale);
            ctx.stroke();
            
            ctx.fillText(v.toFixed(1), tx, (barY + barHeight + 6) * scale);
        });
        
        // Variable Label
        ctx.fillStyle = '#0f172a';
        ctx.font = `bold ${Math.round(11 * scale)}px Arial`;
        ctx.fillText(`${varCfg.label} Change (${varCfg.unit})`, (barX + barWidth / 2) * scale, (barY + barHeight + 24) * scale);
    }
    
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
