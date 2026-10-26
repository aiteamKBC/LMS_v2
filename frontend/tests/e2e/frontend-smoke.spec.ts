import { expect, test } from '@playwright/test';
import { accountForProject, useSyntheticSession } from './support/syntheticSession';

test('renders the signed-out authentication surface', async ({ page }) => {
  await useSyntheticSession(page, null);
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to Workspace' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft' })).toBeEnabled();
});

test('hydrates a synthetic account without contacting a backend', async ({ page }, testInfo) => {
  const account = accountForProject(testInfo.project.name);
  await useSyntheticSession(page, account);
  await page.goto('/access-required');

  await expect(page.getByRole('heading', { name: "You don't have access yet" })).toBeVisible();
  await expect(page.getByText(account.displayName, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request access' })).toBeEnabled();
});

test('redirects a signed-out visitor away from protected routes', async ({ page }) => {
  await useSyntheticSession(page, null);
  await page.goto('/workspace/admin');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
