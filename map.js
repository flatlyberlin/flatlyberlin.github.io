document.addEventListener('DOMContentLoaded', () => {
  let map, markersLayer, supabase;
  let currentApartments = [];
  let isLoading = false;
  let selectedDistricts = new Set(['all']);
  const CACHE_TTL_MS = 5 * 60 * 1000;
  const MAX_CLUSTER_RADIUS = 40;

  const els = {
    type: document.getElementById('filter-type'),
    rooms: document.getElementById('filter-rooms'),
    size: document.getElementById('filter-size'),
    budget: document.getElementById('filter-budget'),
    search: document.getElementById('search-filters')
  };

  const districts = {
    'Mitte': { c: [52.5200, 13.4050], comp: 0.08 },
    'Prenzlauer-Berg': { c: [52.5380, 13.4240], comp: 0.11 },
    'Kreuzberg': { c: [52.4980, 13.4140], comp: 0.09 },
    'Neukölln-Nord': { c: [52.4850, 13.4350], comp: 0.18 },
    'Neukölln-Süd': { c: [52.4700, 13.4400], comp: 0.20 },
    'Friedrichshain': { c: [52.5150, 13.4540], comp: 0.10 },
    'Charlottenburg-Wilmersdorf': { c: [52.5050, 13.2900], comp: 0.13 },
    'Schöneberg': { c: [52.4870, 13.3520], comp: 0.15 },
    'Tempelhof-Nord': { c: [52.4700, 13.3850], comp: 0.25 },
    'Tempelhof-Süd': { c: [52.4550, 13.3900], comp: 0.26 },
    'Treptow-Köpenick': { c: [52.4450, 13.5700], comp: 0.42 },
    'Steglitz-Zehlendorf': { c: [52.4350, 13.2700], comp: 0.36 },
    'Lichtenberg': { c: [52.5150, 13.5000], comp: 0.35 },
    'Marzahn-Hellersdorf': { c: [52.5400, 13.5600], comp: 0.48 },
    'Reinickendorf': { c: [52.5800, 13.3200], comp: 0.38 },
    'Spandau': { c: [52.5350, 13.2000], comp: 0.40 },
    'Pankow': { c: [52.5700, 13.4100], comp: 0.22 },
    'Wedding': { c: [52.5500, 13.3600], comp: 0.14 }
  };

  function initSupabase() {
    return window.supabase.createClient(
      'https://jqqizmwjbfmtgldushlr.supabase.co',
      'sb_publishable_CDr9XJLEr-jYr2IlzvQOJw_zdjNIY91'
    );
  }

  function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    const [size, bg, color] = count < 10 ? [32, '#e6f7f7', '#2d8d8c'] :
                               count < 50 ? [40, '#d4f0f0', '#1a6b6a'] :
                                            [48, '#b2e8e7', '#0f4f4e'];
    return L.divIcon({
      html: `<div style="width:${size}px;height:${size}px;background:${bg};color:${color};border:2px solid ${color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${size<40?13:15}px;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.12);">${count}</div>`,
      className: 'marker-cluster-custom',
      iconSize: L.point(size, size),
      iconAnchor: L.point(size/2, size/2)
    });
  }

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: true }).setView([52.52, 13.405], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OSM & CARTO' }).addTo(map);
    markersLayer = L.markerClusterGroup({ spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true, maxClusterRadius: MAX_CLUSTER_RADIUS, iconCreateFunction: createClusterIcon }).addTo(map);
  }

  function getCacheKey() {
    const b = map.getBounds();
    const d = Array.from(selectedDistricts).sort().join(',');
    return `flatly-${b.toBBoxString()}-${els.type.value}-${els.rooms.value||'any'}-${els.size.value||'any'}-${els.budget.value.trim()||'any'}-${d}`;
  }

  function getCached(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null; }
      return entry.data;
    } catch { return null; }
  }

  function setCached(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        Object.keys(sessionStorage).forEach(k => { if (k.startsWith('flatly-')) sessionStorage.removeItem(k); });
        try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
      }
    }
  }

  function fitMapToDistricts() {
    if (selectedDistricts.has('all') || !selectedDistricts.size) {
      map.flyTo([52.52, 13.405], 11, { duration: 1 }); return;
    }
    const dArr = Array.from(selectedDistricts);
    if (dArr.length === 1) {
      const c = districts[dArr[0]]?.c;
      if (c) map.flyTo(c, 13, { duration: 1 }); return;
    }
    const bounds = L.latLngBounds();
    dArr.forEach(d => { const c = districts[d]?.c; if (c) bounds.extend(c); });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60,60], maxZoom: 13, animate: true, duration: 1 });
  }

  function calculateProbability() {
    const type = els.type.value;
    const minRooms = parseInt(els.rooms.value) || 0;
    const minSize = parseInt(els.size.value) || 0;
    const budgetRaw = els.budget.value.trim();
    const maxPrice = budgetRaw === '' ? Infinity : parseFloat(budgetRaw);
    let score = type === 'rent' ? 50 : 60;

    if (!selectedDistricts.has('all') && selectedDistricts.size > 0) {
      const avgComp = Array.from(selectedDistricts).reduce((s, d) => s + (districts[d]?.comp ?? 0.30), 0) / selectedDistricts.size;
      score += Math.round((avgComp - 0.28) * 50);
    } else {
      score += 12;
    }

    if (budgetRaw === '') {
      score += 15;
    } else {
      const tiers = type === 'rent'
        ? [[1800,8],[1200,3],[900,0],[700,-10],[0,-20]]
        : [[600000,8],[400000,3],[300000,0],[250000,-8],[0,-18]];
      for (const [thr, adj] of tiers) {
        if (maxPrice >= thr) { score += adj; break; }
      }
    }

    if (minSize === 0) {
      score += 10;
    } else {
      for (const [thr, adj] of [[35,5],[55,0],[75,-5],[Infinity,-12]]) {
        if (minSize <= thr) { score += adj; break; }
      }
    }

    if (minRooms === 0) {
      score += 8;
    } else {
      for (const [thr, adj] of [[1,5],[2,0],[3,-6],[Infinity,-12]]) {
        if (minRooms <= thr) { score += adj; break; }
      }
    }

    return Math.max(5, Math.min(95, score));
  }

  function updateProbabilityPanel() {
    const panel = document.getElementById('probabilityPanel');
    const scoreValue = document.getElementById('scoreValue');
    const probFill = document.getElementById('probabilityFill');
    const probText = document.getElementById('probabilityText');
    const isDe = document.body.dataset.lang === 'de';
    const t = (en, de) => isDe ? de : en;

    panel.classList.add('active');
    const score = calculateProbability();
    scoreValue.textContent = score;
    probFill.style.width = score + '%';
    probFill.style.background = score >= 60 ? 'linear-gradient(90deg,#22c55e,#4fc9c8)' :
                                score >= 35 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' :
                                              'linear-gradient(90deg,#ef4444,#f87171)';

    let text = score >= 70 ? t('Great chances! Your criteria match many listings in the current market.','Gute Chancen! Deine Kriterien passen zu vielen Angeboten im aktuellen Markt.') :
               score >= 45 ? t('Moderate chances. Consider expanding districts or adjusting budget/size.','Mittlere Chancen. Erwäge, Bezirke zu erweitern oder Budget/Größe anzupassen.') :
                             t('Tough market for these criteria. Try more districts or a higher budget.','Schwieriger Markt für diese Kriterien. Probiere mehr Bezirke oder ein höheres Budget.');
    probText.innerHTML = `<span class="lang-en">${text}</span><span class="lang-de">${text}</span>`;
  }

  function initDistrictChips() {
    const container = document.getElementById('districtChips');
    if (!container) return;
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.district-chip');
      if (!chip) return;
      const district = chip.dataset.district;
      if (district === 'all') {
        selectedDistricts = new Set(['all']);
        container.querySelectorAll('.district-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      } else {
        selectedDistricts.delete('all');
        container.querySelector('[data-district="all"]').classList.remove('active');
        if (selectedDistricts.has(district)) {
          selectedDistricts.delete(district);
          chip.classList.remove('active');
          if (!selectedDistricts.size) {
            selectedDistricts.add('all');
            container.querySelector('[data-district="all"]').classList.add('active');
          }
        } else {
          selectedDistricts.add(district);
          chip.classList.add('active');
        }
      }
    });
  }

  async function loadApartments() {
    if (isLoading) return;
    if (!supabase) supabase = initSupabase();
    if (!markersLayer || !map) return;

    const cacheKey = getCacheKey();
    const cached = getCached(cacheKey);
    if (cached) { currentApartments = cached; renderMarkers(currentApartments); return; }

    isLoading = true;
    try {
      const b = map.getBounds();
      const type = els.type.value;
      const minRooms = parseInt(els.rooms.value) || 0;
      const minSize = parseInt(els.size.value) || 0;
      const budgetVal = els.budget.value.trim();
      const maxPrice = budgetVal === '' ? Infinity : parseFloat(budgetVal);

      let query = supabase.from('apartments')
        .select('type,district,price,size,rooms,lat,lng')
        .gte('lat', b.getSouth()).lte('lat', b.getNorth())
        .gte('lng', b.getWest()).lte('lng', b.getEast())
        .gte('rooms', minRooms).gte('size', minSize).lte('price', maxPrice)
        .eq('type', type).limit(300);

      if (!selectedDistricts.has('all') && selectedDistricts.size > 0) {
        query = query.in('district', Array.from(selectedDistricts));
      }

      const { data, error } = await query;
      if (error) { console.error('Supabase:', error.message); return; }
      currentApartments = data || [];
      setCached(cacheKey, currentApartments);
      renderMarkers(currentApartments);
    } finally {
      isLoading = false;
    }
  }

  function renderMarkers(apartments) {
    if (!map || !markersLayer || !map._loaded) return;
    markersLayer.clearLayers();
    const isDe = document.body.dataset.lang === 'de';
    const roomLabel = isDe ? 'Zimmer' : 'Rooms';
    const applyLabel = isDe ? 'Bewerben' : 'Apply';
    const tgLink = `href="https://t.me/flatly_berlin_bot?start=default" onclick="window.location='tg://resolve?domain=flatly_berlin_bot&start=default'; setTimeout(()=>window.location='https://t.me/flatly_berlin_bot?start=default',500); return false;"`;

    const markers = apartments.map(apt => {
      if (!apt.lat || !apt.lng) return null;
      const isRent = apt.type === 'rent';
      const specs = [apt.rooms != null ? `${apt.rooms} ${roomLabel}` : '', apt.size != null ? `${apt.size} m²` : ''].filter(Boolean).join(' • ');
      const price = apt.price != null ? `€${apt.price.toLocaleString()}${isRent ? '/mo' : ''}` : '';
      const district = apt.district ? `<br>${apt.district}` : '';
      const popup = `<div style="font-size:14px;line-height:1.5;text-align:center;">${specs}${district}<br><b>${price}</b><br><a ${tgLink} rel="noopener noreferrer" data-umami-event="Open Bot" class="popup-apply-btn">${applyLabel}</a></div>`;
      return L.circleMarker([apt.lat, apt.lng], { radius: 6, fillColor: '#e6f7f7', color: '#2d8d8c', weight: 2, fillOpacity: 0.9 }).bindPopup(popup);
    }).filter(Boolean);

    if (markers.length) {
      markersLayer.addLayers(markers);
      markersLayer.refreshClusters();
    }
  }

  function syncLanguage() {
    const isDe = document.body.dataset.lang === 'de';
    const t = (en, de) => isDe ? de : en;
    document.getElementById('lbl-type').textContent = t('Type','Typ');
    document.getElementById('lbl-rooms').textContent = t('Min Rooms','Min. Zimmer');
    document.getElementById('lbl-size').textContent = t('Min Size (m²)','Min. Größe (m²)');
    document.getElementById('lbl-budget').textContent = t('Max Budget (€)','Max. Budget (€)');
    els.search.textContent = t('Search','Suchen');
    els.size.placeholder = isDe ? 'z.B. 50' : 'e.g. 50';
    els.budget.placeholder = isDe ? 'Beliebig' : 'Any';

    const roomsSelect = document.getElementById('filter-rooms');
    const roomOpts = [['Any','Egal'],['1+','1+'],['2+','2+'],['3+','3+'],['4+','4+']];
    roomsSelect.querySelectorAll('option').forEach((opt, i) => { if (roomOpts[i]) opt.textContent = t(roomOpts[i][0], roomOpts[i][1]); });

    if (currentApartments.length) renderMarkers(currentApartments);
  }

  function bindEvents() {
    document.querySelectorAll('.type-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        els.type.value = btn.dataset.value;
      });
    });

    els.search?.addEventListener('click', () => {
      fitMapToDistricts();
      updateProbabilityPanel();
      map.once('moveend', () => loadApartments());
      document.getElementById('probabilityPanel').style.display = 'block';
      document.getElementById('alertCtaBanner').style.display = 'flex';
    });

    window.addEventListener('resize', () => {
      setTimeout(() => { if (map._loaded) map.invalidateSize({ animate: false }); }, 100);
    });

    new MutationObserver(syncLanguage).observe(document.body, { attributes: true, attributeFilter: ['data-lang'] });
  }

  initMap();
  initDistrictChips();
  syncLanguage();
  bindEvents();
  loadApartments();
});