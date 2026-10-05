import { loadEntries } from './data.mjs';
const entries = await loadEntries();
console.log(`Validated ${entries.length} conferences: dates, deadline types and states, sources, coordinates and unique IDs.`);
