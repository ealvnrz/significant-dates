import type { APIRoute, GetStaticPaths } from 'astro';
import { getConferences } from '../../lib/data';
import { toJson, type Conference } from '../../lib/conferences';
import { buildCalendar, calendarItem, ICS_HEADERS } from '../../lib/ics';

// One .ics file per meeting (the meeting plus its deadlines), for "Add to calendar → Apple / Outlook".
export const getStaticPaths = (async () =>
  (await getConferences()).map((c) => ({ params: { id: c.id }, props: { c } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ c: Conference }> = ({ props: { c } }) =>
  new Response(
    buildCalendar([calendarItem(toJson(c))], { name: c.acronym ?? c.name, description: c.name }),
    { headers: ICS_HEADERS },
  );
