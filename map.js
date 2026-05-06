document.addEventListener('DOMContentLoaded', () => {
  let map, markersLayer, supabase;
  let debounceTimer;
  let currentApartments = [];
  let isLoading = false;
  const CACHE_TTL_MS = 5 * 60 * 1000;
  
  const els = {
    type: document.getElementById('filter-type'),
    rooms: document.getElementById('filter-rooms'),
    size: document.getElementById('filter-size'),
    budget: document.getElementById('filter-budget'),
    search: document.getElementById('search-filters')
  };

  function initSupabase() {
    return window.supabase.createClient(
      'https://jqqizmwjbfmtgldushlr.supabase.co',
      'sb_publishable_CDr9XJLEr-jYr2IlzvQOJw_zdjNIY91'
    );
  }

  function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let size, bg, color;
    if (count < 10) {
      size = 32; bg = '#e6f7f7'; color = '#2d8d8c';
    } else if (count < 50) {
      size = 40; bg = '#d4f0f0'; color = '#1a6b6a';
    } else {
      size = 48; bg = '#b2e8e7'; color = '#0f4f4e';
    }
    return L.divIcon({
      html: `<div style="width:${size}px;height:${size}px;background:${bg};color:${color};border:2px solid ${color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${size < 40 ? '13px' : '15px'};font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.12);">${count}</div>`,
      className: 'marker-cluster-custom',
      iconSize: L.point(size, size),
      iconAnchor: L.point(size / 2, size / 2)
    });
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true,
      fadeAnimation: true,
      zoomAnimation: true
    }).setView([52.5200, 13.4050], 11);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OSM & CARTO'
    }).addTo(map);

    markersLayer = L.markerClusterGroup({
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 60,
      animate: true,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: createClusterIcon
    }).addTo(map);
  }

  function getCacheKey() {
    const bounds = map.getBounds();
    return `flatly-${bounds.toBBoxString()}-${els.type.value}-${els.rooms.value || 'any'}-${els.size.value || 'any'}-${els.budget.value || 'any'}`;
  }

  function getCached(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > CACHE_TTL_MS) {
        sessionStorage.removeItem(key);
        return null;
      }
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

  async function loadApartments() {
    if (isLoading) return;
    if (!supabase) supabase = initSupabase();
    if (!markersLayer || !map) return;

    const cacheKey = getCacheKey();
    const cached = getCached(cacheKey);
    
    if (cached) {
      currentApartments = cached;
      renderMarkers(currentApartments);
      return;
    }

    isLoading = true;
    try {
      const bounds = map.getBounds();
      const type = els.type.value;
      const minRooms = parseInt(els.rooms.value) || 0;
      const minSize = parseInt(els.size.value) || 0;
      const maxPrice = parseFloat(els.budget.value) || Infinity;

      let query = supabase
        .from('apartments')
        .select('type, district, price, size, rooms, lat, lng')
        .gte('lat', bounds.getSouth()).lte('lat', bounds.getNorth())
        .gte('lng', bounds.getWest()).lte('lng', bounds.getEast())
        .gte('rooms', minRooms)
        .gte('size', minSize)
        .lte('price', maxPrice)
        .limit(300);

      if (type !== 'all') query = query.eq('type', type);

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

    const markersToAdd = [];
    apartments.forEach(apt => {
      if (!apt.lat || !apt.lng) return;
      const isRent = apt.type === 'rent';
      const color = isRent ? '#4fc9c8' : '#f59e0b';
      const districtLine = apt.district ? `<br>${apt.district}` : '';
      
      const marker = L.circleMarker([apt.lat, apt.lng], {
        radius: 7,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
      }).bindPopup(`<div style="font-size:14px;line-height:1.5;text-align:center;">
        ${apt.rooms} ${roomLabel} • ${apt.size} m²${districtLine}<br>
        <b>€${apt.price.toLocaleString()}${isRent ? '/mo' : ''}</b><br>
        <a href="https://t.me/flatly_berlin_bot" target="_blank" rel="noopener noreferrer" data-umami-event="Open Bot" class="popup-apply-btn">${applyLabel}</a>
      </div>`);
      
      markersToAdd.push(marker);
    });

    if (markersToAdd.length > 0) {
      markersLayer.addLayers(markersToAdd);
      markersLayer.refreshClusters();
    }
  }

  function syncLanguage() {
    const isDe = document.body.dataset.lang === 'de';
    const t = (en, de) => isDe ? de : en;
    document.getElementById('lbl-type').textContent = t('Type', 'Typ');
    document.getElementById('lbl-rooms').textContent = t('Min Rooms', 'Min. Zimmer');
    document.getElementById('lbl-size').textContent = t('Min Size (m²)', 'Min. Größe (m²)');
    document.getElementById('lbl-budget').textContent = t('Max Budget (€)', 'Max. Budget (€)');
    els.search.textContent = t('Search', 'Suchen');
    els.size.placeholder = isDe ? 'z.B. 50' : 'e.g. 50';
    els.budget.placeholder = isDe ? 'Beliebig' : 'Any';

    const update = (id, pairs) => {
      document.getElementById(id).querySelectorAll('option').forEach((opt, i) => {
        opt.textContent = t(pairs[i][0], pairs[i][1]);
      });
    };
    update('filter-type', [['All','Alle'],['Rent','Miete'],['Sale','Kauf']]);
    update('filter-rooms', [['Any','Egal'],['1+','1+'],['2+','2+'],['3+','3+'],['4+','4+']]);

    if (currentApartments.length > 0) {
      renderMarkers(currentApartments);
    }
  }

  function debounce(fn, delay) {
    return function(...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function bindEvents() {
    els.search?.addEventListener('click', loadApartments);
    
    const debouncedLoad = debounce(() => {
      if (map._popup && map.hasLayer(map._popup)) return;
      loadApartments();
    }, 250);
    
    map?.on('moveend', debouncedLoad);
    window.addEventListener('resize', () => {
      setTimeout(() => {
        if (map._loaded) map.invalidateSize({ animate: false });
      }, 100);
    });
    
    new MutationObserver(syncLanguage).observe(document.body, { attributes: true, attributeFilter: ['data-lang'] });
  }

  initMap();
  syncLanguage();
  bindEvents();
  loadApartments();
});