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

/** Keep geographic coordinates intact; coincident meetings share a popup. */
function groupByLocation(points: MapPoint[]): MapPoint[][] {
  const groups = new Map<string, MapPoint[]>();
  for (const p of points) {
    const key = `${p.lat},${p.lon}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

const popupContent = (p: MapPoint) => `<div class="popup">
  <p class="popup-when">${esc(p.when)}</p>
  <p class="popup-title">${esc(p.title)}</p>
  ${p.title !== p.name ? `<p class="popup-name">${esc(p.name)}</p>` : ''}
  <p class="popup-where">${p.flag ? `<img class="flag" src="/flags/${esc(p.flag)}.svg" alt="" width="18" height="13.5">` : ''}${esc(p.where)}</p>
  <p class="popup-links">
    <a href="${esc(p.url)}" target="_blank" rel="noopener">Website ↗</a>
    <button type="button" data-show-in-list="${esc(p.id)}">Show in list</button>
  </p>
</div>`;

export function createMap(el: HTMLElement, points: MapPoint[], onShowInList: (id: string) => void, onTileError: () => void = () => {}) {
  const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true, minZoom: 1 }).setView([20, 0], 2);

  // Leaflet stops click propagation inside popups, so wire the popup button directly.
  map.on('popupopen', (e) => {
    e.popup.getElement()?.querySelectorAll<HTMLButtonElement>('[data-show-in-list]').forEach((btn) => {
      btn.onclick = () => onShowInList(btn.dataset.showInList!);
    });
  });

  const base = L.tileLayer(tileUrl('Base'), {
    maxZoom: 16,
    attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  }).addTo(map);
  const labels = L.tileLayer(tileUrl('Reference'), { maxZoom: 16 }).addTo(map);
  base.on('tileerror', onTileError);
  labels.on('tileerror', onTileError);

  const markers = new Map<string, L.CircleMarker>();
  const locations = groupByLocation(points).map((group) => {
    const p = group[0];
    const marker = L.circleMarker([p.lat, p.lon], pinStyle());
    marker.bindTooltip('', { direction: 'top', offset: [0, -6] });
    marker.bindPopup('', { maxHeight: 260 });
    marker.on('mouseover', () => marker.setStyle(pinStyle(true)));
    marker.on('mouseout', () => marker.setStyle(pinStyle()));
    for (const point of group) markers.set(point.id, marker);
    return { group, marker };
  });

  const layer = L.featureGroup().addTo(map);

  // Only enable wheel zoom once the user interacts, so the page scroll isn't hijacked.
  map.on('click', () => map.scrollWheelZoom.enable());
  el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

  window.addEventListener('themechange', () => {
    base.setUrl(tileUrl('Base'));
    labels.setUrl(tileUrl('Reference'));
    for (const { marker } of locations) marker.setStyle(pinStyle());
  });

  new ResizeObserver(() => map.invalidateSize()).observe(el);

  return {
    setVisible(ids: Set<string>) {
      layer.clearLayers();
      let visibleMeetings = 0;
      for (const { group, marker } of locations) {
        const visible = group.filter(p => ids.has(p.id));
        if (!visible.length) continue;
        visibleMeetings += visible.length;
        marker.setTooltipContent(visible.map(p => esc(p.title)).join('<br>'));
        marker.setPopupContent(visible.map(popupContent).join('<hr>'));
        layer.addLayer(marker);
      }
      return visibleMeetings;
    },
    fit() {
      map.invalidateSize();
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 5, animate: false });
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
      map.setView(m.getLatLng(), 16, { animate: false });
      m.openPopup();
    },
  };
}
