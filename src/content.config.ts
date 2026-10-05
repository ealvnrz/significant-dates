import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { conferenceSchema } from './lib/schema';

export { TOPIC_IDS, REGIONS, FORMATS, LIST_START } from './lib/schema';

export const collections = {
  conferences: defineCollection({
    loader: file('src/data/conferences.yaml'),
    schema: conferenceSchema,
  }),
};
