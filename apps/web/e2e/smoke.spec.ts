import { expect, test } from '@playwright/test';

test('landing discloses leverage and links to login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Canadian Smith Manoeuvre' })).toBeVisible();
  await expect(page.getByText(/borrowed HELOC funds/i)).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('protected routes redirect to login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
