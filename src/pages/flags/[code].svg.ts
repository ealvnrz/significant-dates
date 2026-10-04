import type { APIRoute, GetStaticPaths } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConferences } from '../../lib/data';

// Country flags (from the flag-icons package, MIT), published only for the countries in the data:
// /flags/cl.svg, /flags/jp.svg, … Flag emoji would be simpler, but Windows doesn't draw them.
const FLAGS = join(process.cwd(), 'node_modules', 'flag-icons', 'flags', '4x3');

export const getStaticPaths = (async () => {
  const codes = new Set((await getConferences()).flatMap((c) => (c.countryCode ? [c.countryCode.toLowerCase()] : [])));
  return [...codes].map((code) => ({ params: { code } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) =>
  new Response(await readFile(join(FLAGS, `${params.code}.svg`)), {
    headers: { 'Content-Type': 'image/svg+xml' },
  });
