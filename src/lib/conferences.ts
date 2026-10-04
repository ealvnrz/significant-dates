// Pure helpers for conference data. No `astro:content` here, so the browser scripts can import
// this file too (data loading lives in ./data.ts).
import type { CollectionEntry } from 'astro:content';

export type ConferenceEntry = CollectionEntry<'conferences'>;
export type Conference = ConferenceEntry['data'] & { id: string };

export const TOPIC_LABELS: Record<string, string> = {
  spatial: 'Spatial',
  'spatio-temporal': 'Spatio-temporal',
  geostatistics: 'Geostatistics',
  environmental: 'Environmental',
  bayesian: 'Bayesian',
  computational: 'Computational',
  biostatistics: 'Biostatistics',
  probability: 'Probability',
  general: 'General',
  'data-science': 'Data science',
};

/**
 * Broad areas for the filter tabs. A meeting belongs to every area that any of its topics falls
 * in, so e.g. a spatial Bayesian workshop shows up under both "Spatial" and "Bayesian".
 */
export const AREAS = [
  { id: 'spatial', label: 'Spatial & environmental', topics: ['spatial', 'spatio-temporal', 'geostatistics', 'environmental'] },
  { id: 'bayesian', label: 'Bayesian', topics: ['bayesian'] },
  { id: 'computational', label: 'Computational & data science', topics: ['computational', 'data-science'] },
  { id: 'biostatistics', label: 'Biostatistics', topics: ['biostatistics'] },
  { id: 'probability', label: 'Probability', topics: ['probability'] },
  { id: 'general', label: 'General', topics: ['general'] },
] as const;

export const areasOf = (c: { topics: readonly string[] }) =>
  AREAS.filter((a) => c.topics.some((t) => (a.topics as readonly string[]).includes(t))).map((a) => a.id);

export const FORMAT_LABELS: Record<string, string> = {
  'in-person': 'In person',
  hybrid: 'Hybrid',
  online: 'Online',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YAML dates are parsed as UTC midnight, so always read them in UTC. */
export const iso = (d: Date) => d.toISOString().slice(0, 10);
const parts = (d: Date) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() });

export function formatDate(d: Date): string {
  const { y, m, day } = parts(d);
  return `${MONTHS[m]} ${day}, ${y}`;
}

/** "Jun 14–17, 2027" · "Jun 30 – Jul 3, 2027" · "Dec 30, 2026 – Jan 2, 2027" */
export function formatRange(start: Date, end: Date): string {
  const a = parts(start);
  const b = parts(end);
  if (iso(start) === iso(end)) return formatDate(start);
  if (a.y !== b.y) return `${formatDate(start)} – ${formatDate(end)}`;
  if (a.m !== b.m) return `${MONTHS[a.m]} ${a.day} – ${MONTHS[b.m]} ${b.day}, ${b.y}`;
  return `${MONTHS[a.m]} ${a.day}–${b.day}, ${a.y}`;
}

/** Date range without the year, for the list's date column: "Oct 13–16", "Jun 30 – Jul 3". */
export function formatRangeShort(start: Date, end: Date): string {
  const a = parts(start);
  const b = parts(end);
  if (iso(start) === iso(end)) return `${MONTHS[a.m]} ${a.day}`;
  if (a.m !== b.m || a.y !== b.y) return `${MONTHS[a.m]} ${a.day} – ${MONTHS[b.m]} ${b.day}`;
  return `${MONTHS[a.m]} ${a.day}–${b.day}`;
}

export function yearLabel(start: Date, end: Date): string {
  const a = start.getUTCFullYear();
  const b = end.getUTCFullYear();
  return a === b ? `${a}` : `${a}–${String(b).slice(2)}`;
}

export function location(c: Pick<Conference, 'format' | 'city' | 'country'>): string {
  if (c.format === 'online' && !c.city) return 'Online';
  return [c.city, c.country].filter(Boolean).join(', ');
}

const ATTENDANCE = {
  'in-person': 'https://schema.org/OfflineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode',
  online: 'https://schema.org/OnlineEventAttendanceMode',
} as const;

/** schema.org Event, so search engines can list the meeting in event results. */
export function eventJsonLd(c: Conference) {
  const place = c.city
    ? {
        '@type': 'Place',
        name: location(c),
        address: { '@type': 'PostalAddress', addressLocality: c.city, addressCountry: c.countryCode ?? c.country },
      }
    : null;
  const virtual = c.format !== 'in-person' ? { '@type': 'VirtualLocation', url: c.url } : null;
  return {
    '@type': 'Event',
    name: c.acronym && !c.name.includes(c.acronym) ? `${c.acronym}: ${c.name}` : c.name,
    startDate: iso(c.start),
    endDate: iso(c.end),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: ATTENDANCE[c.format],
    location: [place, virtual].filter(Boolean),
    url: c.url,
    ...(c.description ? { description: c.description } : {}),
  };
}
