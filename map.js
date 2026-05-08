document.addEventListener('DOMContentLoaded', () => {
  let map, markersLayer, supabase;
  let currentApartments = [];
  let isLoading = false;
  let selectedDistricts = new Set(['all']);
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const els = {
    type: document.getElementById('filter-type'),
    rooms: document.getElementById('filter-rooms'),
    size: document.getElementById('filter-size'),
    budget: document.getElementById('filter-budget'),
    search: document.getElementById('search-filters')
  };

  const districtCenters = {
    'Mitte': [52.5200, 13.4050],
    'Prenzlauer-Berg': [52.5380, 13.4240],
    'Kreuzberg': [52.4980, 13.4140],
    'Neukölln-Nord': [52.4850, 13.4350],
    'Neukölln-Süd': [52.4700, 13.4400],
    'Friedrichshain': [52.5150, 13.4540],
    'Charlottenburg-Wilmersdorf': [52.5050, 13.2900],
    'Schöneberg': [52.4870, 13.3520],
    'Tempelhof-Nord': [52.4700, 13.3850],
    'Tempelhof-Süd': [52.4550, 13.3900],
    'Treptow-Köpenick': [52.4450, 13.5700],
    'Steglitz-Zehlendorf': [52.4350, 13.2700],
    'Lichtenberg': [52.5150, 13.5000],
    'Marzahn-Hellersdorf': [52.5400, 13.5600],
    'Reinickendorf': [52.5800, 13.3200],
    'Spandau': [52.5350, 13.2000],
    'Pankow': [52.5700, 13.4100],
    'Wedding': [52.5500, 13.3600]
  };

  const districtCompetitiveness = {
    'Mitte': 0.08,
    'Kreuzberg': 0.09,
    'Friedrichshain': 0.10,
    'Prenzlauer-Berg': 0.11,
    'Charlottenburg-Wilmersdorf': 0.13,
    'Wedding': 0.14,
    'Schöneberg': 0.15,
    'Neukölln-Nord': 0.18,
    'Neukölln-Süd': 0.20,
    'Pankow': 0.22,
    'Tempelhof-Nord': 0.25,
    'Tempelhof-Süd': 0.26,
    'Lichtenberg': 0.35,
    'Steglitz-Zehlendorf': 0.36,
    'Reinickendorf': 0.38,
    'Spandau': 0.40,
    'Treptow-Köpenick': 0.42,
    'Marzahn-Hellersdorf': 0.48
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
    const districtsKey = Array.from(selectedDistricts).sort().join(',');
    return `flatly-${bounds.toBBoxString()}-${els.type.value}-${els.rooms.value || 'any'}-${els.size.value || 'any'}-${els.budget.value || 'any'}-${districtsKey}`;
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

  function fitMapToDistricts() {
    if (selectedDistricts.has('all') || selectedDistricts.size === 0) {
      map.flyTo([52.5200, 13.4050], 11, { duration: 1 });
      return;
    }
    const districts = Array.from(selectedDistricts);
    if (districts.length === 1) {
      const center = districtCenters[districts[0]];
      if (center) map.flyTo(center, 13, { duration: 1 });
      return;
    }

    const bounds = L.latLngBounds();
    districts.forEach(d => {
      const center = districtCenters[d];
      if (center) bounds.extend(center);
    });
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 13, animate: true, duration: 1 });
    }
  }

  function queryAfterMapMove() {
    map.once('moveend', () => {
      loadApartments();
    });
  }

  function calculateProbability() {
    const type = els.type.value;
    const minRooms = parseInt(els.rooms.value) || 0;
    const minSize = parseInt(els.size.value) || 0;
    const budgetRaw = els.budget.value.trim();
    const maxPrice = budgetRaw === '' ? Infinity : parseFloat(budgetRaw);
    let score = type === 'rent' ? 50 : 60;

    if (!selectedDistricts.has('all') && selectedDistricts.size > 0) {
      const districts = Array.from(selectedDistricts);
      const avgComp = districts.reduce((sum, d) => sum + (districtCompetitiveness[d] || 0.30), 0) / districts.length;
      const districtAdjustment = Math.round((avgComp - 0.28) * 50);
      score += districtAdjustment;
    } else {
      score += 12;
    }

    if (budgetRaw === '') {
      score += 15;
    } else {
      if (type === 'rent') {
        if (maxPrice >= 1800) {
          score += 8;
        } else if (maxPrice >= 1200) {
          score += 3;
        } else if (maxPrice >= 900) {
          score += 0;
        } else if (maxPrice >= 700) {
          score -= 10;
        } else {
          score -= 20;
        }
      } else {
        // Sale
        if (maxPrice >= 600000) {
          score += 8;
        } else if (maxPrice >= 400000) {
          score += 3;
        } else if (maxPrice >= 300000) {
          score += 0;
        } else if (maxPrice >= 250000) {
          score -= 8;
        } else {
          score -= 18;
        }
      }
    }

    if (minSize === 0) {
      score += 10;
    } else if (minSize <= 35) {
      score += 5;
    } else if (minSize <= 55) {
      score += 0;
    } else if (minSize <= 75) {
      score -= 5;
    } else {
      score -= 12;
    }

    if (minRooms === 0) {
      score += 8;
    } else if (minRooms === 1) {
      score += 5;
    } else if (minRooms === 2) {
      score += 0;
    } else if (minRooms === 3) {
      score -= 6;
    } else {
      score -= 12;
    }

    score = Math.max(5, Math.min(95, score));

    return score;
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
    let current = parseInt(scoreValue.textContent) || 0;
    if (isNaN(current)) current = 0;
    const step = score > current ? 1 : -1;
    const animate = () => {
      if (current !== score) {
        current += step;
        scoreValue.textContent = current;
        probFill.style.width = current + '%';
        if (current >= 60) probFill.style.background = 'linear-gradient(90deg, #22c55e, #4fc9c8)';
        else if (current >= 35) probFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        else probFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
        requestAnimationFrame(animate);
      }
    };
    animate();
    let text = '';
    if (score >= 70) {
      text = t('Great chances! Your criteria match many listings in the current market.', 'Gute Chancen! Deine Kriterien passen zu vielen Angeboten im aktuellen Markt.');
    } else if (score >= 45) {
      text = t('Moderate chances. Consider expanding districts or adjusting budget/size.', 'Mittlere Chancen. Erwäge, Bezirke zu erweitern oder Budget/Größe anzupassen.');
    } else {
      text = t('Tough market for these criteria. Try more districts or a higher budget.', 'Schwieriger Markt für diese Kriterien. Probiere mehr Bezirke oder ein höheres Budget.');
    }
    probText.innerHTML = `<span class="lang-en">${text}</span><span class="lang-de">${text}</span>`;
  }

  function initDistrictChips() {
    const chipsContainer = document.getElementById('districtChips');
    if (!chipsContainer) return;

    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.district-chip');
      if (!chip) return;

      const district = chip.dataset.district;

      if (district === 'all') {
        selectedDistricts = new Set(['all']);
        chipsContainer.querySelectorAll('.district-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      } else {
        selectedDistricts.delete('all');
        chipsContainer.querySelector('[data-district="all"]').classList.remove('active');

        if (selectedDistricts.has(district)) {
          selectedDistricts.delete(district);
          chip.classList.remove('active');
          if (selectedDistricts.size === 0) {
            selectedDistricts.add('all');
            chipsContainer.querySelector('[data-district="all"]').classList.add('active');
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
      const budgetVal = els.budget.value.trim();
      const maxPrice = budgetVal === '' ? Infinity : parseFloat(budgetVal);

      let query = supabase
        .from('apartments')
        .select('type, district, price, size, rooms, lat, lng')
        .gte('lat', bounds.getSouth()).lte('lat', bounds.getNorth())
        .gte('lng', bounds.getWest()).lte('lng', bounds.getEast())
        .gte('rooms', minRooms)
        .gte('size', minSize)
        .lte('price', maxPrice)
        .eq('type', type)
        .limit(300);

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

    const markersToAdd = [];
    apartments.forEach(apt => {
      if (!apt.lat || !apt.lng) return;
      const isRent = apt.type === 'rent';
      const color = isRent ? '#4fc9c8' : '#f59e0b';
      const districtLine = apt.district ? `<br>${apt.district}` : '';
      const roomsText = apt.rooms != null ? `${apt.rooms} ${roomLabel}` : roomLabel;
      const sizeText = apt.size != null ? `${apt.size} m²` : '';
      const specsText = [roomsText, sizeText].filter(Boolean).join(' • ');
      const priceText = apt.price != null ? `€${apt.price.toLocaleString()}${isRent ? '/mo' : ''}` : '';

      const marker = L.circleMarker([apt.lat, apt.lng], {
        radius: 7,
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
      }).bindPopup(`<div style="font-size:14px;line-height:1.5;text-align:center;">
        ${specsText}${districtLine}<br>
        <b>${priceText}</b><br>
        <a href="https://t.me/flatly_berlin_bot?start=default" onclick="window.location='tg://resolve?domain=flatly_berlin_bot&start=default'; setTimeout(()=>window.location='https://t.me/flatly_berlin_bot?start=default', 500); return false;" rel="noopener noreferrer" data-umami-event="Open Bot" class="popup-apply-btn">${applyLabel}</a>
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
    update('filter-rooms', [['Any','Egal'],['1+','1+'],['2+','2+'],['3+','3+'],['4+','4+']]);

    if (currentApartments.length > 0) {
      renderMarkers(currentApartments);
    }
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
      queryAfterMapMove();
      document.getElementById('probabilityPanel').style.display = 'block';
      document.getElementById('alertCtaBanner').style.display = 'flex';
    });

    window.addEventListener('resize', () => {
      setTimeout(() => {
        if (map._loaded) map.invalidateSize({ animate: false });
      }, 100);
    });

    new MutationObserver(syncLanguage).observe(document.body, { attributes: true, attributeFilter: ['data-lang'] });
  }

  initMap();
  initDistrictChips();
  syncLanguage();
  bindEvents();
  loadApartments();
});