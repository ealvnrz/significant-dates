import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, javaScriptEnabled }) => {
  // Use fallback fonts so UI checks do not depend on an external font service.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  if (javaScriptEnabled) {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
  }
});

test('unknown information is distinct from closed submissions and open registration', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#f-search')).toBeVisible();
  await expect(page.locator('#conf-bnp15-2027 [data-next-deadline]')).toHaveText('No deadline information recorded');
  await page.locator('#f-search').fill('COBAL');
  await page.locator('#f-deadline-type').selectOption('submission');
  await expect(page.locator('#conf-cobal-ebeb-2027 [data-next-deadline]')).toHaveText('Recorded deadlines closed');
  await page.getByRole('button', { name: 'I can still submit a paper / abstract', exact: true }).click();
  await expect(page.locator('#conf-cobal-ebeb-2027')).toBeHidden();
  await page.getByRole('button', { name: 'I can still register', exact: true }).click();
  await expect(page.locator('#conf-cobal-ebeb-2027')).toBeVisible();
  await expect(page.locator('#conf-cobal-ebeb-2027 [data-next-deadline]')).toContainText('Early-bird registration');
});

test('month filters match event overlaps and selected deadline months independently of sorting', async ({ page }) => {
  await page.goto('/?q=BNP15&from=2027-07');
  await expect(page.locator('#conf-bnp15-2027')).toBeVisible();
  await expect(page.locator('[data-result-count]')).toContainText('Showing 1');
  await page.goto('/?q=Spatial%20Statistics%202027&deadline=submission&month=deadline&from=2027-01&sort=deadline');
  await expect(page.locator('#conf-spatial-statistics-2027')).toBeVisible();
  await expect(page.locator('#conf-spatial-statistics-2027 [data-next-deadline]')).toContainText('Jan 29, 2027');
  await page.getByRole('radio', { name: 'By date', exact: true }).click();
  await expect(page.locator('#conf-spatial-statistics-2027')).toBeVisible();
  await page.locator('#f-month-mode').selectOption('conference');
  await expect(page.locator('#conf-spatial-statistics-2027')).toBeHidden();
});

test('URLs restore controls and native details open through shared links', async ({ page }) => {
  await page.goto('/?deadline=registration&open=1&month=deadline&from=2026-11&sort=deadline');
  await expect(page.locator('#f-deadline-type')).toHaveValue('registration');
  await expect(page.locator('#f-month-mode')).toHaveValue('deadline');
  await expect(page.locator('#f-open')).toBeChecked();
  await expect(page.getByRole('radio', { name: 'By deadline', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/?q=no-such-conference#conf-bnp15-2027');
  await expect(page.locator('#conf-bnp15-2027')).toBeVisible();
  await expect(page.locator('#details-bnp15-2027')).toHaveAttribute('open', '');
});

test('native details open and close with a pointer', async ({ page }) => {
  await page.goto('/');
  const details = page.locator('#details-spatial-statistics-2027');
  await expect(details).not.toHaveAttribute('open', '');
  await details.locator('summary').click();
  await expect(details.locator('.r-deadlines')).toBeVisible();
  await details.locator('summary').click();
  await expect(details.locator('.r-deadlines')).toBeHidden();
});

test.describe('without JavaScript', () => {
  // Keep the configured device, reduced motion and automatic context cleanup.
  test.use({ javaScriptEnabled: false });

  for (const moving of [false, true]) {
    test(`essential content and native details work${moving ? ' during layout movement' : ''}`, async ({ page }) => {
      if (moving) {
        // Exercise the same unstable-element path as a late font/layout change.
        await page.route('**/', async route => {
          const response = await route.fetch();
          const body = (await response.text()).replace('</head>', `<style>
            @keyframes move-summary { from { transform: translateX(0); } to { transform: translateX(8px); } }
            #details-spatial-statistics-2027 > summary {
              animation: move-summary 1s linear 2 alternate !important;
            }
          </style></head>`);
          await route.fulfill({ response, body });
        });
      }
      await page.goto('/');
      await expect(page.locator('#f-search')).toBeHidden();
      await expect(page.locator('[data-map-toggle]')).toBeHidden();
      const details = page.locator('#details-spatial-statistics-2027');
      const summary = details.locator('summary');
      await expect(summary).toBeVisible();
      await expect(details).not.toHaveAttribute('open', '');
      // Pointer retries use page timers, which cannot run with JavaScript disabled.
      // Native keyboard activation still exercises the browser's <details> behavior.
      await summary.press('Enter');
      await expect(details).toHaveAttribute('open', '');
      await expect(details.locator('.r-deadlines')).toBeVisible();
      await expect(details.locator('.dl-date').first()).toHaveText('Jan 29, 2027');
      await summary.press('Space');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(details.locator('.r-deadlines')).toBeHidden();
      await expect(page.locator('#conf-bnp15-2027 [data-next-deadline]')).toHaveText('No deadline information recorded');
    });
  }
});

test('map is lazy and a failed map download leaves filters usable', async ({ page }) => {
  const mapRequests: string[] = [];
  await page.route(/\/_astro\/map\.[^/]+\.js$/, route => { mapRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.locator('#f-search')).toBeVisible();
  expect(mapRequests).toHaveLength(0);
  await page.locator('[data-map-toggle]').click();
  await expect(page.locator('[data-map-status]')).toContainText('The map could not load');
  expect(mapRequests.length).toBeGreaterThan(0);
  await page.locator('#f-search').fill('BNP15');
  await expect(page.locator('[data-result-count]')).toContainText('Showing 1');
  await expect(page.locator('#conf-bnp15-2027')).toBeVisible();
});

test('day changes move rows both ways and update deadline status without losing filters', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-04T23:59:00Z'));
  await page.goto('/?q=WSA');
  // The build is from a later date: restore an event ending on October 4.
  await expect(page.locator('#upcoming-list #conf-ysm-30-2026')).toHaveCount(1);
  await page.clock.setFixedTime(new Date('2026-10-06T00:01:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#past-list #conf-ysm-30-2026')).toHaveCount(1);
  await expect(page.locator('[data-status-day]')).toHaveText('2026-10-06');
  await expect(page.locator('#f-search')).toHaveValue('WSA');
  await expect(page.locator('#conf-wsa-2026 .r-deadlines li[data-date="2026-10-05"] [data-status]')).toHaveText('Closed');
  // Moving the clock backwards exercises the reverse classification as well.
  await page.clock.setFixedTime(new Date('2026-10-04T12:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#upcoming-list #conf-ysm-30-2026')).toHaveCount(1);
});

test('keyboard sorting and mobile layout remain usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const dateSort = page.getByRole('radio', { name: 'By date', exact: true });
  await dateSort.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'By deadline', exact: true })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#conferences').scrollIntoViewIfNeeded();
  await page.goto('/?q=Spatial%20Statistics%202027#conf-spatial-statistics-2027');
  await expect(page.locator('#details-spatial-statistics-2027')).toHaveAttribute('open', '');
  await page.locator('#conf-spatial-statistics-2027').scrollIntoViewIfNeeded();
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const detailsBounds = await page.locator('#details-spatial-statistics-2027 .r-details-body').boundingBox();
  expect(detailsBounds!.x).toBeGreaterThanOrEqual(0);
  expect(detailsBounds!.x + detailsBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
});

test('a loaded map stays linked to filtered rows even if tiles are unavailable', async ({ page }) => {
  await page.route('https://server.arcgisonline.com/**', route => route.abort());
  await page.goto('/?q=BNP15');
  await page.locator('[data-map-toggle]').click();
  await expect(page.locator('#map .leaflet-interactive')).toHaveCount(1);
  await expect(page.locator('[data-map-status]')).toContainText('Map tiles are unavailable');
  await page.locator('#map .leaflet-interactive').click();
  await page.getByRole('button', { name: 'Show in list', exact: true }).click();
  await expect(page.locator('#details-bnp15-2027')).toHaveAttribute('open', '');
  await page.locator('#f-search').fill('no matching meeting');
  await expect(page.locator('#map .leaflet-interactive')).toHaveCount(0);
});

test('a tab left open across UTC midnight refreshes automatically', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-04T23:59:50Z') });
  await page.goto('/?q=WSA');
  await expect(page.locator('[data-status-day]')).toHaveText('2026-10-04');
  await page.clock.fastForward(31_000);
  await expect(page.locator('[data-status-day]')).toHaveText('2026-10-05');
  await expect(page.locator('#past-list #conf-ysm-30-2026')).toHaveCount(1);
  await expect(page.locator('#f-search')).toHaveValue('WSA');
});
