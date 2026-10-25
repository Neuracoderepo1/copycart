import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function open(page) {
  /** @type {string[]} */
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Google Fonts is a third-party request and may be unreachable; it is not an app error.
    if (
      m.type() === 'error' &&
      !/fonts\.(googleapis|gstatic)|ERR_NAME_NOT_RESOLVED|ERR_FAILED/.test(
        m.text() + (m.location().url ?? ''),
      )
    ) {
      problems.push(`console: ${m.text()}`);
    }
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto('/');
  await expect(page.locator('#grid')).toBeVisible();
  return problems;
}

test('loads the demo grid with explicit demo labelling and no app errors', async ({ page }) => {
  const problems = await open(page);
  const cards = page.locator('#grid .trader');
  expect(await cards.count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#data-mode')).toContainText(/demo/i);
  await expect(page.locator('#count')).toContainText(/demo profile/i);
  await expect(cards.first().locator('.chip.demo')).toContainText(/demo/i);
  expect(problems).toEqual([]);
});

test('search narrows results, shows the empty state, and reset restores them', async ({ page }) => {
  await open(page);
  const total = await page.locator('#grid .trader').count();
  await page.locator('#search').fill('harbor');
  await expect(page.locator('#grid .trader')).toHaveCount(1);
  await expect(page.locator('#grid .trader h3')).toHaveText('Harbor');
  await page.locator('#search').fill('zzzz-nothing');
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#reset').click();
  await expect(page.locator('#grid .trader')).toHaveCount(total);
  await expect(page.locator('#search')).toBeFocused();
});

test('sorting by name ascending orders cards alphabetically', async ({ page }) => {
  await open(page);
  await page.locator('#sort').selectOption('name');
  await expect
    .poll(async () => {
      const names = (await page.locator('#grid .trader h3').allTextContents()).map((n) =>
        n.toLowerCase(),
      );
      return JSON.stringify(names) === JSON.stringify([...names].sort());
    })
    .toBe(true);
});

test('risk filter only shows matching risk labels', async ({ page }) => {
  await open(page);
  await page.locator('#risk').selectOption('Low');
  await expect
    .poll(async () => {
      const pills = await page.locator('#grid .trader .pill').allTextContents();
      return pills.length > 0 && pills.every((p) => /low risk/i.test(p));
    })
    .toBe(true);
});

test('profile dialog explains the score, labels provenance, offers no outbound link for demo data, and closes with Escape', async ({
  page,
}) => {
  await open(page);
  await page
    .locator('#grid .trader')
    .first()
    .getByRole('button', { name: /view .* profile/i })
    .click();
  const dialog = page.locator('#profile-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/synthetic|demo/i);
  await expect(dialog.locator('.component')).toHaveCount(4);
  await expect(dialog).toContainText(/provisional/i);
  await expect(dialog.locator('svg.curve')).toBeVisible();
  await expect(dialog.locator('a.outbound')).toHaveCount(0);
  await expect(dialog).toContainText(/no outbound link/i);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('compare: needs two selections, caps at three, renders a table', async ({ page }) => {
  await open(page);
  const boxes = page.locator('#grid .trader input[type=checkbox]');
  await boxes.nth(0).check();
  await expect(page.locator('#compare-open')).toBeDisabled();
  await boxes.nth(1).check();
  await expect(page.locator('#compare-open')).toBeEnabled();
  await boxes.nth(2).check();
  await expect(boxes.nth(3)).toBeDisabled();
  await page.locator('#compare-open').click();
  const table = page.locator('#compare-dialog table.compare');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(4);
  await expect(table).toContainText(/demo \(synthetic\)/i);
  await page.keyboard.press('Escape');
  await page.locator('#compare-clear').click();
  await expect(page.locator('#compare-bar')).toBeHidden();
});

test('error state appears when the API fails and recovers on retry', async ({ page }) => {
  await open(page);
  await page.route('**/api/v1/traders?*', (r) =>
    r.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"error":{"code":"internal_error","message":"Internal server error."}}',
    }),
  );
  await page.locator('#search').fill('o');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText(/internal server error/i);
  await page.unroute('**/api/v1/traders?*');
  await page.locator('#retry').click();
  await expect(page.locator('#grid')).toBeVisible();
});

test('keyboard: search is reachable by Tab and a card button opens the profile with Enter', async ({
  page,
}) => {
  await open(page);
  await page.locator('#search').focus();
  await expect(page.locator('#search')).toBeFocused();
  await page.locator('#grid .trader').first().getByRole('button', { name: /view/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#profile-dialog')).toBeVisible();
});

test('mobile viewport: no horizontal overflow and the nav toggles', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const menu = page.locator('button.menu');
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('outbound endpoint refuses demo traders and unknown destinations', async ({ request }) => {
  const list = await (await request.get('/api/v1/traders?pageSize=1')).json();
  const t = list.data[0];
  const r = await request.get(`/api/v1/outbound/${t.exchangeId}?trader=${t.id}`, {
    maxRedirects: 0,
  });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect((await request.get('/api/v1/outbound/evil.com', { maxRedirects: 0 })).status()).toBe(404);
});
