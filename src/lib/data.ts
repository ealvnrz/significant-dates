import { getCollection } from 'astro:content';
import type { Conference } from './conferences';

export async function getConferences(): Promise<Conference[]> {
  const entries = await getCollection('conferences');
  return entries
    .map((e) => ({ ...e.data, id: e.id, deadlines: [...e.data.deadlines].sort((a, b) => +a.date - +b.date) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
