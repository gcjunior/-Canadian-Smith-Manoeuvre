import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dashboard evidence for the Edmonton demo.
 * Requires API + web and a seeded household (optionally with Completed cycle).
 * Screenshots: DEMO_EVIDENCE=1 → apps/demo/evidence/edmonton-dashboard-completed.png
 */
test.describe('Edmonton demo dashboard', () => {
  test('login as Edmonton household and show Completed when cycle finished', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Canadian Smith Manoeuvre' })).toBeVisible();

    const tenant = page.locator('#tenant');
    await expect(tenant).toBeVisible();
    const options = tenant.locator('option');
    const count = await options.count();
    let edmontonValue: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const text = (await options.nth(i).textContent()) ?? '';
      if (/edmonton/i.test(text)) {
        edmontonValue = await options.nth(i).getAttribute('value');
        break;
      }
    }
    if (!edmontonValue) {
      test.skip(true, 'Edmonton demo tenant not seeded — run pnpm demo:seed or @csm/demo test');
      return;
    }

    await tenant.selectOption(edmontonValue);
    await page.getByRole('button', { name: /continue|sign in/i }).click();
    await page.waitForURL(/dashboard|operations/);
    await page.goto('/dashboard');

    const completed = page.getByText('Completed', { exact: true });
    if ((await completed.count()) === 0) {
      test.skip(true, 'Cycle not Completed yet — finish monthly conversion first');
      return;
    }
    await expect(completed.first()).toBeVisible();

    if (process.env.DEMO_EVIDENCE === '1') {
      const dir = path.resolve(process.cwd(), '../demo/evidence');
      fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({
        path: path.join(dir, 'edmonton-dashboard-completed.png'),
        fullPage: true,
      });
    }
  });
});
