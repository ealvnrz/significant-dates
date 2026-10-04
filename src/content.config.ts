import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

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

// Every entry in src/data/conferences.yaml is validated against this schema at build time.
// A typo in a date or an unknown topic makes the build fail instead of publishing bad data.
const conferences = defineCollection({
  loader: file('src/data/conferences.yaml'),
  schema: z
    .object({
      name: z.string(),
      acronym: z.string().nullish(),
      start: z.coerce.date(),
      end: z.coerce.date(),
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
      deadlines: z
        .array(
          z.object({
            label: z.string(),
            date: z.coerce.date(),
            /** The date is inferred (e.g. the page gives a day and month but no year). */
            tentative: z.boolean().default(false),
          }),
        )
        .nullish()
        .transform((d) => d ?? []),
      /** When the dates were last verified at `source`. */
      checked: z.coerce.date().nullish(),
      source: z.url().nullish(),
    })
    .superRefine((c, ctx) => {
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
    }),
});

export const collections = { conferences };
