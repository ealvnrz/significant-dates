// iCalendar (RFC 5545) files for "Add to calendar → Apple / Outlook": a meeting plus its
// deadlines. Dates are YYYY-MM-DD strings.

export type CalendarItem = {
  id: string;
  /** Full title, e.g. "JSM 2027 — 2027 Joint Statistical Meetings". */
  summary: string;
  /** Short title for deadline events, e.g. "JSM 2027". */
  short: string;
  start: string;
  end: string;
  location: string;
  url: string;
  description?: string | null;
  tentative?: boolean;
  deadlines: { label: string; date: string; tentative?: boolean }[];
};

/** The fields of a ConferenceJson (see lib/conferences.ts) that a calendar entry needs. */
type CalendarSource = Pick<CalendarItem, 'id' | 'start' | 'end' | 'url' | 'deadlines' | 'tentative' | 'description'> & {
  name: string;
  acronym?: string | null;
  where: string;
};

export function calendarItem(c: CalendarSource): CalendarItem {
  return {
    id: c.id,
    summary: c.acronym ? `${c.acronym} — ${c.name}` : c.name,
    short: c.acronym ?? c.name,
    start: c.start,
    end: c.end,
    location: c.where,
    url: c.url,
    description: c.description,
    tentative: c.tentative,
    deadlines: c.deadlines,
  };
}

const compact = (iso: string) => iso.replaceAll('-', '');
const nextDay = (iso: string) => new Date(Date.parse(iso) + 86_400_000).toISOString().slice(0, 10);

const escape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545: lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

function allDay(uid: string, stamp: string, start: string, end: string, fields: string[]): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@significant-dates`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(start)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(end))}`,
    ...fields,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

export function buildCalendar(items: CalendarItem[], { name, description }: { name: string; description: string }): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  const events = items.flatMap((c) => [
    allDay(c.id, stamp, c.start, c.end, [
      `SUMMARY:${escape(c.summary + (c.tentative ? ' (dates TBC)' : ''))}`,
      `LOCATION:${escape(c.location)}`,
      `DESCRIPTION:${escape([c.description, c.url].filter(Boolean).join('\n\n'))}`,
      `URL:${c.url}`,
    ]),
    ...c.deadlines.map((d, i) =>
      allDay(`${c.id}-deadline-${i}`, stamp, d.date, d.date, [
        `SUMMARY:${escape(`⏰ ${d.label} — ${c.short}${d.tentative ? ' (date TBC)' : ''}`)}`,
        `DESCRIPTION:${escape(c.url)}`,
        `URL:${c.url}`,
      ]),
    ),
  ]);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Significant Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name)}`,
    `X-WR-CALDESC:${escape(description)}`,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const ICS_HEADERS = { 'Content-Type': 'text/calendar; charset=utf-8' };
