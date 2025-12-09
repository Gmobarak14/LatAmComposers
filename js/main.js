let map;
let composersData = [];
let allLayers = {}; // { composerId: { lines: [], markers: [], color: '#...' } }
let activeComposerId = null;
let lastSelectedComposerId = null;

// Color palette
const PALETTE = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
  '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000',
  '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'
];

// STUDIO DATA VARIABLES
let studiosData = [];       
let studioLayers = {};      

// --- Data helpers ---
function extractCityFromLabel(label) {
  if (!label) return 'Location';
  const inMatch = label.match(/\b(?:in|at|to)\s+([A-Z][\wÀ-ú.\- ]{1,60})/);
  if (inMatch && inMatch[1]) return inMatch[1].trim();
  const first = label.split(/[,-–—]/)[0].trim();
  return first || 'Location';
}
function getCityForRoute(route) {
  if (route && route.city && typeof route.city === 'string' && route.city.trim().length > 0) {
    return route.city.trim();
  }
  return extractCityFromLabel(route && route.label);
}

// --- Map helpers ---
function normalizeLatLng(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return coord;
  const lng = Number(coord[0]);
  const lat = Number(coord[1]);
  return [lat, lng];
}

// --- Sidebar ---
function buildSidebar() {
  const listEl = document.getElementById('composer-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (let idx = 0; idx < composersData.length; idx++) {
    const composer = composersData[idx];
    const color = PALETTE[idx % PALETTE.length];

    // Sidebar item container
    const item = document.createElement('div');
    item.className = 'composer-item';
    item.dataset.id = composer.id;

    // Top row (swatch, name, meta, caret)
    const topRow = document.createElement('div');
    topRow.className = 'composer-top';

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = color;

    const textWrap = document.createElement('div');
    textWrap.className = 'composer-text';

    const name = document.createElement('div');
    name.className = 'composer-name';
    name.textContent = composer.name;

    const meta = document.createElement('div');
    meta.className = 'composer-meta';
    const lifeSpan =
      (composer.birthYear || '') +
      (composer.deathYear ? ' – ' + composer.deathYear : '');
    meta.textContent = `${composer.country || ''} ${lifeSpan}`.trim();

    textWrap.appendChild(name);
    textWrap.appendChild(meta);

    const caretwrap = document.createElement('div');
    caretwrap.className = 'caret';
    caretwrap.innerHTML = '▾';

    topRow.appendChild(swatch);
    topRow.appendChild(textWrap);
    topRow.appendChild(caretwrap);

    // Dropdown: bio + city/date list
    const dropdown = document.createElement('div');
    dropdown.className = 'composer-dropdown';

    // Short bio (always show, even if empty)
    const bio = document.createElement('div');
    bio.className = 'composer-bio';
    bio.textContent = composer.bio ? composer.bio : '';
    dropdown.appendChild(bio);

    // City/date list
    if (Array.isArray(composer.routes) && composer.routes.length > 0) {
      const cityList = document.createElement('div');
      cityList.className = 'composer-city-list';
      composer.routes.forEach((route, rIdx) => {
        const cityItem = document.createElement('div');
        cityItem.className = 'composer-city-item';
        cityItem.textContent = `${getCityForRoute(route)}${route.years ? ' • ' + route.years : ''}`;
        cityItem.tabIndex = 0;
        cityItem.addEventListener('click', (ev) => {
          ev.stopPropagation();
          // Only focus the route, do NOT call setActiveComposer again (avoids double fitBounds)
          focusRoute(composer.id, rIdx);
        });
        cityList.appendChild(cityItem);
      });
      dropdown.appendChild(cityList);
    }

    // Toggle dropdown logic
    topRow.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const wasExpanded = item.classList.contains('expanded');
      document.querySelectorAll('.composer-item.expanded').forEach(el => {
        el.classList.remove('expanded');
        if (el.querySelector('.composer-dropdown')) {
          el.querySelector('.composer-dropdown').style.maxHeight = null;
        }
      });
      if (!wasExpanded) {
        setGlobalView(false);
        lastSelectedComposerId = composer.id;
        setActiveComposer(composer.id);
        item.classList.add('expanded');
        dropdown.style.maxHeight = dropdown.scrollHeight + "px";
      } else {
        item.classList.remove('expanded');
        dropdown.style.maxHeight = null;
      }
    });

    // Keyboard accessibility
    topRow.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        topRow.click();
      }
      if (ev.key === 'Escape') {
        item.classList.remove('expanded');
        dropdown.style.maxHeight = null;
      }
    });

    // Highlight on hover
    topRow.addEventListener('mouseover', () => highlightComposer(composer.id, true));
    topRow.addEventListener('mouseout', () => highlightComposer(composer.id, false));

    item.appendChild(topRow);
    item.appendChild(dropdown);
    listEl.appendChild(item);
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', function closeDropdowns(ev) {
    if (!ev.target.closest('.composer-item')) {
      document.querySelectorAll('.composer-item.expanded').forEach(el => {
        el.classList.remove('expanded');
        if (el.querySelector('.composer-dropdown')) {
          el.querySelector('.composer-dropdown').style.maxHeight = null;
        }
      });
    }
  }, { once: true });
}

// --- Route focusing helper ---
function focusRoute(composerId, routeIndex) {
  const layers = allLayers[composerId];
  if (!layers) return;

  const marker = layers.markers && layers.markers[routeIndex];
  const line = layers.lines && layers.lines[routeIndex];

  // emphasize the route briefly
  if (line) {
    line.setStyle({ weight: 8 });
    if (line.bringToFront) line.bringToFront();
  }

  const restoreLine = () => {
    if (line && line.setStyle) line.setStyle({ weight: 3.5 });
  };

  if (marker && marker.getLatLng) {
    const latlng = marker.getLatLng();
    const targetZoom = Math.max(6, map.getZoom());
    const zoomTo = Math.min(map.getMaxZoom ? map.getMaxZoom() : 12, targetZoom);

    map.flyTo(latlng, zoomTo, { duration: 1.0, easeLinearity: 0.25 });

    map.once('moveend', () => {
      if (marker.bringToFront) marker.bringToFront();
      marker.openPopup();
    });

    setTimeout(restoreLine, 1400);
  } else if (line) {
    const bounds = line.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.flyToBounds(bounds.pad(0.3), { duration: 1.0 });

      map.once('moveend', () => {
        if (line.bringToFront) line.bringToFront();
        if (line.openPopup) line.openPopup();
      });

      setTimeout(restoreLine, 1400);
    } else {
      restoreLine();
    }
  } else {
    restoreLine();
  }
}

// --- Map drawing ---
function animateRouteLine(line) {
  requestAnimationFrame(() => {
    const path = line._path;
    if (!path) return;
    path.classList.add('route-flow');
    path.style.strokeDasharray = '10 14';
    path.style.strokeDashoffset = '0';
    path.style.animationDuration = '10s'; // uniform & slightly slower
  });
}

function drawComposersOnMap() {
  Object.values(allLayers).forEach((obj) => {
    obj.lines.forEach((line) => map.removeLayer(line));
    obj.markers.forEach((m) => map.removeLayer(m));
  });
  allLayers = {};

  composersData.forEach((composer, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const layers = { lines: [], markers: [], color };

    (composer.routes || []).forEach((route) => {
      const fromLatLng = normalizeLatLng(route.from || route.center || []);
      const toLatLng = normalizeLatLng(route.to || route.center || []);
      if (!Array.isArray(fromLatLng) || fromLatLng.length < 2 || !Array.isArray(toLatLng) || toLatLng.length < 2) return;

      const line = L.polyline([fromLatLng, toLatLng], {
        color,
        weight: 3.5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
        className: 'route-flow'
      }).addTo(map);
      layers.lines.push(line);
      animateRouteLine(line);

      const marker = L.circleMarker(toLatLng, {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 1,
        weight: 1
      }).addTo(map);
      layers.markers.push(marker);

      const clip = (() => {
        if (Object.prototype.hasOwnProperty.call(route, 'clipIndex')) {
          const ci = route.clipIndex;
          if (ci === null || (typeof ci === 'string' && ci.toLowerCase() === 'none')) return null;
          const ciNum = Number(ci);
          if (!Number.isNaN(ciNum) && composer.clips && composer.clips[ciNum]) return composer.clips[ciNum];
          return route.clip || null;
        }
        return route.clip || (composer.clips && composer.clips[0]) || null;
      })();

      const popupHtml = `
        <div class="composer-popup">
          <strong style="color:${color}">${composer.name}</strong><br />
          <span>${route.years || ''}</span><br />
          <div class="route-label">${route.label || ''}</div>
          ${
            clip
              ? `
            <div><em>${clip.title}</em> (${clip.year})</div>
            <audio controls preload="none">
              <source src="${clip.url}" type="audio/mpeg" />
            </audio>`
              : ''
          }
        </div>
      `;

      marker.bindPopup(popupHtml);
      line.bindPopup(popupHtml);

      // Attach audio handlers for background music
      attachPopupAudioHandlers(marker);
      attachPopupAudioHandlers(line);

      line.on('mouseover', () => line.setStyle({ weight: 6 }));
      line.on('mouseout', () => line.setStyle({ weight: 3.5 }));
    });

    allLayers[composer.id] = layers;
  });
}

// Draw studio circle(s) — big animated region over New York
function drawStudiosOnMap() {
  // Remove existing
  Object.values(studioLayers).forEach(s => {
    if (s.fill) map.removeLayer(s.fill);
    if (s.ring) map.removeLayer(s.ring);
  });
  studioLayers = {};

  (studiosData || []).forEach((studio) => {
    const center = Array.isArray(studio.center) && studio.center.length >= 2
      ? normalizeLatLng(studio.center)
      : null;
    if (!center) return;

    // Smaller pixel radius so studios don’t overpower composer markers
    const pixelRadius = 24; // was 36

    const fill = L.circleMarker(center, {
      radius: pixelRadius,
      color: '#0f172a',
      weight: 0,
      fillColor: 'rgba(99,102,241,0.25)',
      fillOpacity: 0.25,
      className: 'studio-circle',
      interactive: false
    }).addTo(map);

    const ring = L.circleMarker(center, {
      radius: pixelRadius,
      color: '#0f172a',
      weight: 4,             // was 24; slightly thicker but reasonable
      fillOpacity: 0,
      className: 'studio-ring',
      interactive: true
    }).addTo(map);

    ring.on('mouseover', () => {
      fill._path?.classList.add('highlighted');
      ring._path?.classList.add('highlighted');
    });
    ring.on('mouseout', () => {
      fill._path?.classList.remove('highlighted');
      ring._path?.classList.remove('highlighted');
    });
    ring.on('click', (e) => {
      setActiveStudio(studio.id);
      setSidebarTab('studios');      // switch tab when coming from map
      openStudioInSidebar(studio.id); // fly + show bio
      e.originalEvent?.stopPropagation();
    });

    studioLayers[studio.id] = { fill, ring };
  });
}

// Studios sidebar
function buildStudiosSidebar() {
  const listEl = document.getElementById('studio-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  (studiosData || []).forEach((studio) => {
    const item = document.createElement('div');
    item.className = 'studio-item';
    item.dataset.id = studio.id;

    const name = document.createElement('div');
    name.className = 'studio-name';
    name.textContent = studio.name;

    const meta = document.createElement('div');
    meta.className = 'studio-meta';
    meta.textContent = studio.years || '';

    const bio = document.createElement('div');
    bio.className = 'studio-bio';
    bio.style.display = 'none';
    bio.textContent = studio.bio || '';

    item.appendChild(name);
    if (studio.years) item.appendChild(meta);
    item.appendChild(bio);

    // Hover highlight: use fill/ring
    item.addEventListener('mouseover', () => {
      const layer = studioLayers[studio.id];
      layer?.fill?._path?.classList.add('highlighted');
      layer?.ring?._path?.classList.add('highlighted');
      layer?.ring?.bringToFront?.();
      layer?.fill?.bringToFront?.();
    });
    item.addEventListener('mouseout', () => {
      const layer = studioLayers[studio.id];
      layer?.fill?._path?.classList.remove('highlighted');
      layer?.ring?._path?.classList.remove('highlighted');
    });

    // Click: open + thicken ring
    item.addEventListener('click', () => {
      setSidebarTab('studios');
      setActiveStudio(studio.id);     // ensure ring thickens from sidebar click
      openStudioInSidebar(studio.id);
    });

    listEl.appendChild(item);
  });
}

// Open studio bio, zoom to its circle
function openStudioInSidebar(studioId) {
  const listEl = document.getElementById('studio-list');
  if (listEl) {
    listEl.querySelectorAll('.studio-item').forEach(item => {
      const show = item.dataset.id === studioId;
      const bio = item.querySelector('.studio-bio');
      if (bio) bio.style.display = show ? 'block' : 'none';
      item.classList.toggle('active', show);
    });
  }

  const layer = studioLayers[studioId];
  // Prefer the ring for bounds, fallback to fill
  const circle = layer?.ring || layer?.fill;
  if (circle) {
    // Bring visuals to front
    if (layer.fill?.bringToFront) layer.fill.bringToFront();
    if (layer.ring?.bringToFront) layer.ring.bringToFront();

    // Fly to the studio with a gentle padding
    const bounds = circle.getBounds();
    if (bounds && bounds.isValid && bounds.isValid()) {
      map.flyToBounds(bounds.pad(0.08), { duration: 1.0, easeLinearity: 0.25 });
    } else {
      // Fallback: center on latlng
      const latlng = circle.getLatLng();
      if (latlng) map.flyTo(latlng, Math.max(6, map.getZoom()), { duration: 1.0 });
    }
  }

  setActiveStudio(studioId);
}

// --- Focus/Global logic ---
let isInGlobalView = true; // Track state

function isGlobalView() {
  return isInGlobalView;
}

function setGlobalView(enabled) {
  isInGlobalView = !!enabled;
  const btn = document.getElementById('global-view-btn');
  if (btn) {
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.querySelector('.btn-label').textContent = enabled ? 'Global View' : 'Focus';
  }
  if (enabled) {
    lastSelectedComposerId = activeComposerId;
    activeComposerId = null;
    // Sidebar highlight
    document.querySelectorAll('.composer-item').forEach((el) => el.classList.remove('active'));
    // Show all composers
    Object.values(allLayers).forEach((layers) => {
      layers.lines.forEach((line) => {
        if (!map.hasLayer(line)) line.addTo(map);
        line.setStyle({ opacity: 1, weight: 3.5 });
      });
      layers.markers.forEach((marker) => {
        if (!map.hasLayer(marker)) marker.addTo(map);
        marker.setStyle({ opacity: 1, fillOpacity: 1, radius: 6 });
      });
    });
    fitAllComposers();
  } else {
    // If leaving global view, focus last selected composer or first
    let focusId = lastSelectedComposerId;
    if (!focusId && composersData.length > 0) focusId = composersData[0].id;
    if (focusId) setActiveComposer(focusId);
  }
}

function setActiveComposer(composerId, options = {}) {
  isInGlobalView = false;
  activeComposerId = composerId;

  // Sidebar highlight
  document.querySelectorAll('.composer-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === composerId);
  });

  // Show only this composer's layers; hide others
  Object.entries(allLayers).forEach(([id, layers]) => {
    const visible = id === composerId;
    layers.lines.forEach((line) => {
      if (visible) {
        if (!map.hasLayer(line)) line.addTo(map);
        line.setStyle({ opacity: 1, weight: 3.5 });
      } else {
        map.removeLayer(line);
      }
    });
    layers.markers.forEach((marker) => {
      if (visible) {
        if (!map.hasLayer(marker)) marker.addTo(map);
        marker.setStyle({ opacity: 1, fillOpacity: 1, radius: 6 });
      } else {
        map.removeLayer(marker);
      }
    });
  });

  // Zoom to this composer's routes unless options.fitBounds === false
  if (options.fitBounds === false) return;
  const layers = allLayers[composerId];
  if (!layers) return;
  const group = L.featureGroup([...layers.lines, ...layers.markers]);
  const bounds = group.getBounds();
  if (bounds.isValid && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.3));
  }
}

function bindUi() {
  const searchInput = document.getElementById('composer-search');
  if (searchInput) {
    searchInput.addEventListener('input', (ev) => {
      applySearchFilter(ev.target.value);
    });
  }

  // Tabs
  const tabComposers = document.getElementById('tab-composers');
  const tabStudios = document.getElementById('tab-studios');
  const panelComposers = document.getElementById('panel-composers');
  const panelStudios = document.getElementById('panel-studios');

  if (tabComposers && tabStudios && panelComposers && panelStudios) {
    const activate = (which) => {
      const isComp = which === 'composers';
      tabComposers.classList.toggle('active', isComp);
      tabStudios.classList.toggle('active', !isComp);
      tabComposers.setAttribute('aria-selected', isComp ? 'true' : 'false');
      tabStudios.setAttribute('aria-selected', !isComp ? 'true' : 'false');
      panelComposers.hidden = !isComp;
      panelStudios.hidden = isComp;

      // Optional: adjust search placeholder per tab
      const input = document.getElementById('composer-search');
      if (input) {
        input.placeholder = isComp ? 'Search composers or places…' : 'Search studios…';
      }

      if (isComp) {
        resetStudiosAppearance(); // NEW: return all studio rings to default when switching tabs
      }
    };

    tabComposers.addEventListener('click', () => activate('composers'));
    tabStudios.addEventListener('click', () => activate('studios'));
  }

  const globalBtn = document.getElementById('global-view-btn');
  if (globalBtn) {
    globalBtn.addEventListener('click', () => {
      setGlobalView(true);
    });
  }
}

// --- Map init ---
function initMap() {
  const worldBounds = L.latLngBounds([-85, -180], [85, 180]);
  map = L.map('map', {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 12,
    maxBounds: worldBounds,
    maxBoundsViscosity: 0.9
    // removed preferCanvas so SVG is used (needed for dash animation)
  }).setView([-15, -60], 3);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    detectRetina: true
  }).addTo(map);

  // Explicitly add an SVG renderer layer (ensures SVG paths)
  L.svg().addTo(map);
}

// --- Main ---
async function loadComposers() {
  const res = await fetch('data/composers.json');
  if (!res.ok) throw new Error('Failed to load composers.json');
  let text = await res.text();
  text = text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const parsed = JSON.parse(text);

  // If JSON is { studios:[], ...composersArray }, split safely
  if (Array.isArray(parsed)) {
    composersData = parsed;
    studiosData = []; // none
  } else {
    studiosData = Array.isArray(parsed.studios) ? parsed.studios : [];
    // composers are everything else (try common keys or fallback)
    if (Array.isArray(parsed.composers)) {
      composersData = parsed.composers;
    } else {
      // fallback: if file previously was array, try known key; else empty
      composersData = Array.isArray(parsed.items) ? parsed.items : [];
    }
  }
}

async function bootstrap() {
  try {
    initMap();
    await loadComposers();
    drawComposersOnMap();
    buildSidebar();

    // Studios
    drawStudiosOnMap();
    buildStudiosSidebar();

    bindUi();
    setGlobalView(true);

    setupBackgroundAudio(); // NEW
  } catch (err) {
    const listEl = document.getElementById('composer-list');
    if (listEl) {
      listEl.innerHTML = `<div class="error-state">Could not load the page: ${err.message || err}</div>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);

function fitAllComposers() {
  const group = L.featureGroup([]);
  Object.values(allLayers).forEach((layers) => {
    (layers.lines || []).forEach((line) => group.addLayer(line));
    (layers.markers || []).forEach((marker) => group.addLayer(marker));
  });
  const bounds = group.getBounds();
  if (bounds && bounds.isValid && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.25));
  } else {
    map.setView([-15, -60], 3);
  }
}

function applySearchFilter(query) {
  const needle = (query || '').toLowerCase().trim();
  document.querySelectorAll('.composer-item').forEach((item) => {
    // Find the composer in data
    const composer = composersData.find(c => c.id === item.dataset.id);
    if (!composer) {
      item.style.display = '';
      return;
    }
    // Gather all searchable fields
    let hay = (composer.name || '') + ' ' + (composer.bio || '');
    if (Array.isArray(composer.routes)) {
      composer.routes.forEach(route => {
        hay += ' ' + (getCityForRoute(route) || '') + ' ' + (route.label || '');
      });
    }
    hay = hay.toLowerCase();
    item.style.display = hay.includes(needle) ? '' : 'none';
  });
}

// --- Timeline logic ---
let currentTimelineYear = 2000; // default to max

function filterMapByTimeline(year) {
  if (!isGlobalView()) return; // Only filter in global view

  Object.entries(allLayers).forEach(([composerId, layers]) => {
    const composer = composersData.find(c => c.id === composerId);
    if (!composer) return;

    (composer.routes || []).forEach((route, idx) => {
      // Try to parse the start year from route.years (e.g. "1966-1969" -> 1966)
      let routeYear = null;
      if (route.years) {
        const match = route.years.match(/\d{4}/);
        if (match) routeYear = parseInt(match[0], 10);
      }
      const marker = layers.markers[idx];
      const line = layers.lines[idx];
      const show = routeYear && routeYear <= year;
      if (marker) {
        if (show) {
          if (!map.hasLayer(marker)) marker.addTo(map);
        } else {
          map.removeLayer(marker);
        }
      }
      if (line) {
        if (show) {
          if (!map.hasLayer(line)) {
            line.addTo(map);
            animateRouteLine(line); // re-init animation on re-add
          }
        } else {
          map.removeLayer(line);
        }
      }
    });
  });
}

function updateTimelineYearIndicator() {
  const range = document.getElementById('timeline-range');
  const indicator = document.getElementById('timeline-year-indicator');
  const wrap = document.querySelector('#timeline-bar .timeline-wrap');
  if (!range || !indicator || !wrap) return;

  const min = parseInt(range.min, 10);
  const max = parseInt(range.max, 10);
  const val = parseInt(range.value, 10);
  const percent = (val - min) / (max - min);

  // Use the slider’s actual width
  const sliderRect = range.getBoundingClientRect();
  const sliderWidth = sliderRect.width;

  // Thumb width must match CSS
  const thumbWidth = 18;
  const halfThumb = thumbWidth / 2;

  // Position centered above thumb, relative to the wrap
  const leftPx = percent * (sliderWidth - thumbWidth) + halfThumb;

  indicator.style.left = `${leftPx}px`;
  indicator.textContent = val;
}

function setupTimeline() {
  const range = document.getElementById('timeline-range');
  if (!range) return;

  const onInput = (e) => {
    const year = parseInt(e.target.value, 10);
    currentTimelineYear = year;
    filterMapByTimeline(year);
    updateTimelineYearIndicator();
  };

  range.addEventListener('input', onInput);
  range.addEventListener('change', updateTimelineYearIndicator);

  // smooth follow while dragging
  let rafId = null;
  const tick = () => {
    updateTimelineYearIndicator();
    rafId = requestAnimationFrame(tick);
  };
  range.addEventListener('pointerdown', () => {
    if (!rafId) rafId = requestAnimationFrame(tick);
  });
  window.addEventListener('pointerup', () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    updateTimelineYearIndicator();
  }, { passive: true });

  // initial position
  updateTimelineYearIndicator();
}

// ensure init runs and indicator updates
document.addEventListener('DOMContentLoaded', () => {
  setupTimeline();
  updateTimelineYearIndicator();
  const timeline = document.getElementById('timeline-bar');
  if (timeline) timeline.style.display = isGlobalView() ? 'flex' : 'none';
});

// Patch setGlobalView to reset timeline filter
const _setGlobalView = setGlobalView;
setGlobalView = function(enabled) {
  _setGlobalView(enabled);
  const timeline = document.getElementById('timeline-bar');
  if (timeline) {
    timeline.style.display = enabled ? 'flex' : 'none';
  }
  if (enabled) {
    // Reset timeline to max (2000) when entering global view
    const range = document.getElementById('timeline-range');
    if (range) {
      range.value = 2000;
      currentTimelineYear = 2000;
      filterMapByTimeline(currentTimelineYear);
    }
  } else {
    // In focus mode, show all routes for the composer
    drawComposersOnMap();
  }
};

// Add (or replace) highlightComposer to speed animation on hover
function highlightComposer(composerId, highlight) {
  const layers = allLayers[composerId];
  if (!layers) return;
  (layers.lines || []).forEach(line => {
    const path = line._path;
    if (!path) return;
    if (highlight) {
      line.setStyle({ weight: 6, opacity: 1 });
      path.classList.add('highlighted');
      if (line.bringToFront) line.bringToFront();
    } else {
      line.setStyle({ weight: 3.5, opacity: 1 });
      path.classList.remove('highlighted');
    }
  });
  (layers.markers || []).forEach(m => {
    try { m.setStyle({ radius: highlight ? 9 : 6 }); } catch(e){}
  });
}

// If any lines were added before CSS loaded, re-normalize once map is ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    Object.values(allLayers).forEach(layers => {
      (layers.lines || []).forEach(line => animateRouteLine(line));
    });
  }, 250);
});

// NEW STUDIO DATA LOGIC

let activeStudioId = null;

// Reset all studio rings to default thickness and visuals
function resetStudiosAppearance() {
  Object.values(studioLayers).forEach(({ ring, fill }) => {
    // Default ring stroke thickness (matches your current baseline)
    ring?.setStyle({ weight: 4 });
    // Remove any active/highlight classes on both layers
    ring?._path?.classList.remove('active', 'highlighted');
    fill?._path?.classList.remove('active', 'highlighted');
  });
  activeStudioId = null;
}

// Helper: switch tabs programmatically
function setSidebarTab(which) {
  const tabComposers = document.getElementById('tab-composers');
  const tabStudios = document.getElementById('tab-studios');
  const panelComposers = document.getElementById('panel-composers');
  const panelStudios = document.getElementById('panel-studios');
  if (!tabComposers || !tabStudios || !panelComposers || !panelStudios) return;

  const isComp = which === 'composers';
  tabComposers.classList.toggle('active', isComp);
  tabStudios.classList.toggle('active', !isComp);
  tabComposers.setAttribute('aria-selected', isComp ? 'true' : 'false');
  tabStudios.setAttribute('aria-selected', !isComp ? 'true' : 'false');
  panelComposers.hidden = !isComp;
  panelStudios.hidden = isComp;

  const input = document.getElementById('composer-search');
  if (input) input.placeholder = isComp ? 'Search composers or places…' : 'Search studios…';

  // When switching to Composers, reset all studio rings to default thickness
  if (isComp) resetStudiosAppearance();
}

// Thicken ring robustly (waits for SVG path if needed)
function setActiveStudio(studioId) {
  // reset previous
  if (activeStudioId && studioLayers[activeStudioId]?.ring) {
    studioLayers[activeStudioId].ring.setStyle({ weight: 4 });
    studioLayers[activeStudioId].ring._path?.classList.remove('active');
  }
  activeStudioId = studioId;

  const layer = studioLayers[studioId];
  if (!layer?.ring) return;

  // Apply Leaflet style immediately
  layer.ring.setStyle({ weight: 6 });
  layer.fill?.bringToFront?.();
  layer.ring?.bringToFront?.();

  // If the SVG path isn’t ready, try next frame
  const ensurePath = () => {
    const path = layer.ring._path;
    if (path) {
      path.classList.add('active'); // CSS stroke-width:6 for visual sync
    } else {
      requestAnimationFrame(ensurePath);
    }
  };
  ensurePath();

  // Highlight studio item in sidebar
  const listEl = document.getElementById('studio-list');
  if (listEl) {
    listEl.querySelectorAll('.studio-item').forEach(item => {
      const isActive = item.dataset.id === studioId;
      item.classList.toggle('active', isActive);
      const bio = item.querySelector('.studio-bio');
      if (bio) bio.style.display = isActive ? 'block' : 'none';
    });
  }
}

// Background music controller
let bgAudio;

// Smooth fade helpers
function fadeOutAudio(el, durationMs = 250) {
  if (!el) return;
  const startVol = el.volume;
  const steps = Math.max(1, Math.floor(durationMs / 16));
  let i = 0;
  const tick = () => {
    i++;
    el.volume = Math.max(0, startVol * (1 - i / steps));
    if (i < steps) {
      requestAnimationFrame(tick);
    } else {
      el.pause();
      el.volume = startVol; // restore for next play
    }
  };
  requestAnimationFrame(tick);
}
function fadeInAudio(el, targetVol = 0.4, durationMs = 250) {
  if (!el) return;
  el.volume = 0;
  el.play().catch(() => {});
  const steps = Math.max(1, Math.floor(durationMs / 16));
  let i = 0;
  const tick = () => {
    i++;
    el.volume = Math.min(targetVol, (targetVol * i) / steps);
    if (i < steps) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Start background audio after first user interaction to satisfy autoplay policies.
 * Ensures smooth, gapless looping by preloading and a loop guard.
 */
function setupBackgroundAudio() {
  bgAudio = document.getElementById('bg-music');
  if (!bgAudio) return;

  bgAudio.loop = true;
  bgAudio.preload = 'auto';

  // Some browsers introduce a tiny gap at loop point; guard against it
  bgAudio.addEventListener('timeupdate', () => {
    if (!bgAudio.duration || isNaN(bgAudio.duration)) return;
    // If within the last 120ms, jump to 0 to avoid an audible gap
    if (bgAudio.currentTime > 0 && (bgAudio.duration - bgAudio.currentTime) < 0.12) {
      bgAudio.currentTime = 0;
      if (bgAudio.paused) bgAudio.play().catch(() => {});
    }
  });

  const start = () => {
    // Safely attempt play; ignore rejections (browser policies)
    bgAudio.volume = 0.3;
    bgAudio.play().catch(() => {});
    window.removeEventListener('click', start);
    window.removeEventListener('keydown', start);
    window.removeEventListener('touchstart', start, { passive: true });
  };
  window.addEventListener('click', start);
  window.addEventListener('keydown', start);
  window.addEventListener('touchstart', start, { passive: true });
}

/**
 * Pause background when any composer audio plays; resume when it ends or popup closes.
 * Uses fade to avoid abrupt transitions.
 */
function wireComposerAudioEvents(popupContainer) {
  if (!popupContainer) return;
  const audioEls = popupContainer.querySelectorAll('audio');
  audioEls.forEach((audio) => {
    audio.addEventListener('play', () => { fadeOutAudio(bgAudio, 220); });
    audio.addEventListener('ended', () => {
      // small delay to avoid stutter
      setTimeout(() => fadeInAudio(bgAudio, 0.4, 220), 80);
    });
    audio.addEventListener('pause', () => {
      // If user paused the clip, resume bg music
      setTimeout(() => fadeInAudio(bgAudio, 0.4, 220), 80);
    });
  });
}

// Hook Leaflet popup open/close to manage bg music resume on close
function attachPopupAudioHandlers(layer) {
  if (!layer || !layer.bindPopup) return;
  layer.on('popupopen', (e) => {
    const container = e.popup.getElement()?.querySelector('.leaflet-popup-content');
    wireComposerAudioEvents(container);
  });
  layer.on('popupclose', () => {
    // Resume background if no other clip is currently playing
    const anyPlaying = Array.from(document.querySelectorAll('.composer-popup audio'))
      .some(a => !a.paused);
    if (!anyPlaying) {
      fadeInAudio(bgAudio, 0.4, 220);
    }
  });
}