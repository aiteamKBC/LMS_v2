import { clickText, STAMP } from './lib-wizard.mjs';

// Steps 1-3 of the wizard, shared by every scenario below.
export async function fillProgramme(page, name = `QA Programme ${STAMP}`) {
  await page.locator('input[placeholder*="Project Controls Technician"]').first().fill(name);
  await page.waitForTimeout(400);
  await page.locator('input[placeholder*="L4"]').first().fill('L4');
  await page.waitForTimeout(400);
  await clickText(page, /^KSB Standards$/);
  await page.waitForTimeout(1200);
  await clickText(page, /Associate Project Manager/);
  await page.waitForTimeout(800);
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(2000);
}

export async function fillCohort(page, name = `QA Cohort ${STAMP}`, months = '6') {
  await clickText(page, /Add cohort/);
  await page.waitForTimeout(1800);
  await page.locator('input[placeholder*="Jan 2026 Cohort"]').first().fill(name);
  await page.waitForTimeout(500);
  const dur = page.locator('input[type=number]').first();
  if (await dur.count()) {
    await dur.fill(months);
    await page.waitForTimeout(600);
  }
  await clickText(page, /Next: Group/);
  await page.waitForTimeout(2200);
}

export async function fillGroup(page, name = 'QA Group A') {
  await clickText(page, /Add group/);
  await page.waitForTimeout(1800);
  await page.locator('input[placeholder*="Wednesday AM"]').first().fill(name);
  await page.waitForTimeout(600);
  await clickText(page, /Next: Modules/);
  await page.waitForTimeout(2500);
}

// Adds a "Create New Module" shell. The Modules step has two "Add Module"
// buttons; the first (toolbar) is the reliable one.
export async function addModule(page, { name = 'QA Module 1', sessions = '4' } = {}) {
  await page.locator('button').filter({ hasText: /^Add Module$/ }).first().click();
  await page.waitForTimeout(2200);
  await page.locator('button').filter({ hasText: /Create New Module/ }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('input[placeholder*="Example"]').last().fill(name);
  await page.waitForTimeout(600);
  const nums = page.locator('input[type=number]');
  if (await nums.count()) {
    await nums.first().fill(sessions);
    await page.waitForTimeout(1500);
  }
  return name;
}
