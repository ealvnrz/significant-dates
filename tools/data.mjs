import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { conferenceSchema } from '../src/lib/schema.ts';
import { calendarDay } from '../src/lib/calendar.ts';

export function validateEntries(input, today = calendarDay()) {
  if (!Array.isArray(input)) throw new Error('The catalogue must be a YAML list.');
  const ids = new Set();
  return input.map(entry => {
    if (!entry || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '')) throw new Error('Each conference needs a stable lowercase id.');
    if (ids.has(entry.id)) throw new Error(`Duplicate conference id: ${entry.id}`);
    ids.add(entry.id);
    const parsed = conferenceSchema.safeParse(entry);
    if (!parsed.success) throw new Error(`${entry.id}: ${parsed.error.message}`);
    if (calendarDay(parsed.data.checked) > today) throw new Error(`${entry.id}: checked cannot be in the future`);
    return { id: entry.id, ...parsed.data };
  });
}

export async function loadEntries() {
  // Keep YAML date literals as strings so invalid dates cannot silently roll into another month.
  const raw = yaml.load(await readFile(new URL('../src/data/conferences.yaml', import.meta.url), 'utf8'), { schema: yaml.JSON_SCHEMA });
  return validateEntries(raw);
}
