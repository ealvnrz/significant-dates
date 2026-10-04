// @ts-check
import { defineConfig } from 'astro/config';

// On Vercel, VERCEL_PROJECT_PRODUCTION_URL holds the production domain (without https://), also
// in preview builds. It enables the canonical URL and the Open Graph link; elsewhere they're left out.
const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: domain ? `https://${domain}` : undefined,
});
