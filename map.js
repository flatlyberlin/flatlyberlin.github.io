document.addEventListener('DOMContentLoaded', () => {
  let map, markersLayer, supabase;
  let debounceTimer;

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

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true
    }).setView([52.5200, 13.4050], 11);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OSM & CARTO'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

  async function loadApartments() {
    if (!supabase) supabase = initSupabase();
    if (!markersLayer) return;

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
    if (error) return console.error('Supabase:', error.message);
    if (!data || data.length === 0) return renderMarkers([]);

    renderMarkers(data);
  }

  function renderMarkers(apartments) {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    apartments.forEach(apt => {
      if (!apt.lat || !apt.lng) return;
      const isRent = apt.type === 'rent';
      const color = isRent ? '#4fc9c8' : '#f59e0b';
      const districtLine = apt.district ? `<br>${apt.district}` : '';
      const applyLabel = document.body.dataset.lang === 'de' ? 'Bewerben' : 'Apply';
      L.circleMarker([apt.lat, apt.lng], {
        radius: 7, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9
      })
      .bindPopup(`<div style="font-size:14px; line-height:1.5; text-align:center;">
        ${apt.rooms} Zimmer • ${apt.size} m²${districtLine}<br>
        <b>€${apt.price.toLocaleString()}${isRent ? '/mo' : ''}</b><br>
        <a href="https://t.me/flatly_berlin_bot" target="_blank" rel="noopener noreferrer" data-umami-event="Open Bot" class="popup-apply-btn">${applyLabel}</a>
      </div>`)
      .addTo(markersLayer);
    });
  }

  function syncLanguage() {
    const isDe = document.body.dataset.lang === 'de';
    const t = (en, de) => isDe ? de : en;

    document.getElementById('lbl-type').textContent = t('Type', 'Typ');
    document.getElementById('lbl-rooms').textContent = t('Min Rooms', 'Min. Zimmer');
    document.getElementById('lbl-size').textContent = t('Size (m²)', 'Größe (m²)');
    document.getElementById('lbl-budget').textContent = t('Max Budget (€)', 'Max. Budget (€)');
    els.search.textContent = t('Search', 'Suchen');

    const update = (id, pairs) => {
      document.getElementById(id).querySelectorAll('option').forEach((opt, i) => {
        opt.textContent = t(pairs[i][0], pairs[i][1]);
      });
    };
    update('filter-type', [['All','Alle'],['Rent','Miete'],['Sale','Kauf']]);
    update('filter-rooms', [['Any','Egal'],['1+','1+'],['2+','2+'],['3+','3+'],['4+','4+']]);
    update('filter-size', [['Any','Egal'],['30+','30+'],['50+','50+'],['70+','70+'],['100+','100+']]);
    const applyLabel = isDe ? 'Bewerben' : 'Apply';
    document.querySelectorAll('.leaflet-popup .popup-apply-btn').forEach(btn => btn.textContent = applyLabel);
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
    }, 300);

    map?.on('moveend', debouncedLoad);
    new MutationObserver(syncLanguage).observe(document.body, { attributes: true, attributeFilter: ['data-lang'] });
  }

  initMap();
  syncLanguage();
  bindEvents();
  loadApartments();
});