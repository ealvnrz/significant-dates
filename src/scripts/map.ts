import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = {
  id: string;
  title: string;
  name: string;
  lat: number;
  lon: number;
  when: string;
  where: string;
  /** Lowercase ISO country code, for /flags/xx.svg. */
  flag: string | null;
  url: string;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const isDark = () => document.documentElement.dataset.theme === 'dark';

// Esri's neutral "Canvas" basemaps: no API key, and made for thematic overlays like this one.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const tileUrl = (kind: 'Base' | 'Reference') =>
  `${ESRI}/World_${isDark() ? 'Dark' : 'Light'}_Gray_${kind}/MapServer/tile/{z}/{y}/{x}`;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pinStyle = (active = false): L.CircleMarkerOptions => ({
  radius: active ? 10 : 6,
  weight: 2,
  color: cssVar('--bg') || '#0e1013',
  fillColor: cssVar('--accent') || '#8db2ff',
  fillOpacity: 1,
});

/** Spread meetings that share a city so every pin stays clickable. */
function spread(points: MapPoint[]): MapPoint[] {
  const groups = new Map<string, MapPoint[]>();
  for (const p of points) {
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()].flatMap((g) =>
    g.length === 1
      ? g
      : g.map((p, i) => {
          const a = (2 * Math.PI * i) / g.length;
          return { ...p, lat: p.lat + 0.12 * Math.sin(a), lon: p.lon + 0.12 * Math.cos(a) };
        }),
  );
}

export function createMap(el: HTMLElement, points: MapPoint[], onShowInList: (id: string) => void) {
  const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true, minZoom: 1 }).setView([20, 0], 2);

  // Leaflet stops click propagation inside popups, so wire the popup button directly.
  map.on('popupopen', (e) => {
    const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>('[data-show-in-list]');
    if (btn) btn.onclick = () => onShowInList(btn.dataset.showInList!);
  });

  const base = L.tileLayer(tileUrl('Base'), {
    maxZoom: 16,
    attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  }).addTo(map);
  const labels = L.tileLayer(tileUrl('Reference'), { maxZoom: 16 }).addTo(map);

  const markers = new Map<string, L.CircleMarker>();
  for (const p of spread(points)) {
    const marker = L.circleMarker([p.lat, p.lon], pinStyle());
    marker.bindTooltip(esc(p.title), { direction: 'top', offset: [0, -6] });
    marker.bindPopup(
      `<div class="popup">
        <p class="popup-when">${esc(p.when)}</p>
        <p class="popup-title">${esc(p.title)}</p>
        ${p.title !== p.name ? `<p class="popup-name">${esc(p.name)}</p>` : ''}
        <p class="popup-where">${p.flag ? `<img class="flag" src="/flags/${esc(p.flag)}.svg" alt="" width="18" height="13.5">` : ''}${esc(p.where)}</p>
        <p class="popup-links">
          <a href="${esc(p.url)}" target="_blank" rel="noopener">Website ↗</a>
          <button type="button" data-show-in-list="${esc(p.id)}">Show in list</button>
        </p>
      </div>`,
    );
    marker.on('mouseover', () => marker.setStyle(pinStyle(true)));
    marker.on('mouseout', () => marker.setStyle(pinStyle()));
    markers.set(p.id, marker);
  }

  const layer = L.featureGroup().addTo(map);

  // Only enable wheel zoom once the user interacts, so the page scroll isn't hijacked.
  map.on('click', () => map.scrollWheelZoom.enable());
  el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

  window.addEventListener('themechange', () => {
    base.setUrl(tileUrl('Base'));
    labels.setUrl(tileUrl('Reference'));
    for (const m of markers.values()) m.setStyle(pinStyle());
  });

  new ResizeObserver(() => map.invalidateSize()).observe(el);

  return {
    setVisible(ids: Set<string>) {
      layer.clearLayers();
      for (const [id, m] of markers) if (ids.has(id)) layer.addLayer(m);
      return layer.getLayers().length;
    },
    fit() {
      map.invalidateSize();
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 5 });
    },
    highlight(id: string, on: boolean) {
      const m = markers.get(id);
      if (!m || !layer.hasLayer(m)) return;
      m.setStyle(pinStyle(on));
      if (on) {
        m.bringToFront();
        m.openTooltip();
      } else {
        m.closeTooltip();
      }
    },
    locate(id: string) {
      const m = markers.get(id);
      if (!m) return;
      map.invalidateSize();
      if (!layer.hasLayer(m)) layer.addLayer(m);
      map.setView(m.getLatLng(), 5);
      m.openPopup();
    },
  };
}
