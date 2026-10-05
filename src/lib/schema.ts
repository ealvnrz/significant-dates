import { z } from 'astro/zod';
import { DEADLINE_TYPES, DEADLINE_STATUSES } from './calendar.ts';

export const TOPIC_IDS = [
  'spatial',
  'spatio-temporal',
  'geostatistics',
  'environmental',
  'bayesian',
  'computational',
  'biostatistics',
  'probability',
  'general',
  'data-science',
] as const;

export const REGIONS = [
  'Europe',
  'North America',
  'Latin America',
  'Asia',
  'Oceania',
  'Africa',
  'Online',
] as const;

export const FORMATS = ['in-person', 'hybrid', 'online'] as const;

/** The list starts here: meetings that ended earlier aren't recorded. */
export const LIST_START = '2026-10-01';

const day = (d: Date) => d.toISOString().slice(0, 10);
const dateOnly = z.union([z.date(), z.iso.date().transform(s => new Date(s))]);

// Every entry in src/data/conferences.yaml is validated against this schema at build time.
// A typo in a date or an unknown topic makes the build fail instead of publishing bad data.
export const conferenceSchema = z
    .object({
      name: z.string(),
      acronym: z.string().nullish(),
      start: dateOnly,
      end: dateOnly,
      /** The organisers call the dates provisional ("save the date", "tbc"). */
      tentative: z.boolean().default(false),
      city: z.string().nullish(),
      country: z.string().nullish(),
      countryCode: z
        .string()
        .regex(/^[A-Z]{2}$/, 'countryCode must be an uppercase ISO 3166-1 alpha-2 code')
        .nullish(),
      region: z.enum(REGIONS),
      lat: z.number().min(-90).max(90).nullish(),
      lon: z.number().min(-180).max(180).nullish(),
      url: z.url(),
      format: z.enum(FORMATS).default('in-person'),
      topics: z.array(z.enum(TOPIC_IDS)).default([]),
      description: z.string().nullish(),
      /** A caveat shown to visitors, e.g. "Submission expected around December". */
      note: z.string().nullish(),
      deadlineStatus: z.enum(DEADLINE_STATUSES),
      deadlines: z
        .array(
          z.object({
            label: z.string().min(1),
            types: z.array(z.enum(DEADLINE_TYPES)).min(1).refine(types => new Set(types).size === types.length, 'duplicate deadline types'),
            date: dateOnly,
            /** The date is inferred (e.g. the page gives a day and month but no year). */
            tentative: z.boolean().default(false),
          }),
        )
        .nullish()
        .transform((d) => d ?? []),
      /** When the dates were last verified at `source`. */
      checked: dateOnly,
      source: z.url(),
    })
    .superRefine((c, ctx) => {
      if ((c.deadlineStatus === 'published') !== (c.deadlines.length > 0)) {
        ctx.addIssue({ code: 'custom', path: ['deadlineStatus'], message: 'use published exactly when deadlines are recorded' });
      }
      if (c.deadlineStatus === 'not-announced' && !c.note) {
        ctx.addIssue({ code: 'custom', path: ['note'], message: 'explain the official evidence for unannounced dates' });
      }
      if (day(c.end) < LIST_START) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: `ended before ${LIST_START}, when the list starts` });
      }
      if (c.end < c.start) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: `end (${day(c.end)}) is before start (${day(c.start)})` });
      }
      c.deadlines.forEach((d, i) => {
        if (d.date > c.end) {
          ctx.addIssue({
            code: 'custom',
            path: ['deadlines', i, 'date'],
            message: `"${d.label}" (${day(d.date)}) is after the meeting ends (${day(c.end)})`,
          });
        }
      });
      if ((c.lat == null) !== (c.lon == null)) {
        ctx.addIssue({ code: 'custom', path: ['lat'], message: 'give both lat and lon, or neither' });
      }
      if (c.format !== 'online' && c.lat == null) {
        ctx.addIssue({ code: 'custom', path: ['lat'], message: `a ${c.format} meeting needs lat/lon for the map` });
      }
    });
