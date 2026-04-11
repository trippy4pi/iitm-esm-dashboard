const map = L.map('map').setView([22.9734, 78.6569], 5); // India center

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 8,
    minZoom: 5,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);