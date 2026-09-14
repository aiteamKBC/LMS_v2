import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Local, synthetic visual check. Wizard responses are fulfilled in this process;
// every other API, external URL and mutation is blocked before it reaches a server.
const base = new URL(process.env.MONTHLY_SUBMISSION_CHECK_URL || 'http://127.0.0.1:3000').origin;
const output = resolve('screenshots/monthly-submission');
const wizardOnly = process.argv.includes('--wizard-only');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  // 720 CSS pixels exercises reflow equivalent to a 1440px window at 200% zoom.
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 720, height: 500 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const blockedRequests = [];
    const syntheticRequests = [];
    let wizardScenario = '';
    let savedDraft = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (wizardScenario && url.origin === base) {
        const json = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/learner_api/reflection/submissions/') {
          if (request.method() === 'GET' && url.searchParams.get('learnerId') === 'sample-learner'
            && ['sample-wizard', 'sample-wizard-restored'].includes(url.searchParams.get('activityId'))) {
            syntheticRequests.push('load-draft');
            return json({ submission: wizardScenario === 'wizard-draft' ? {
              ...savedDraft, status: 'draft', assignmentAnswer: 'Synthetic answer restored from the saved submission.',
              monthlyAssignment: { ...savedDraft.monthlyAssignment, step: 5, actionPlan: 'Synthetic saved next steps.' },
            } : null });
          }
          if (request.method() === 'POST') {
            const payload = request.postDataJSON();
            if (payload.learnerId === 'sample-learner' && ['sample-wizard', 'sample-wizard-restored'].includes(payload.activityId) && payload.submissionMode === 'draft') {
              savedDraft = payload;
              syntheticRequests.push('save-draft');
              return json({ id: 'synthetic-draft', status: 'draft' });
            }
          }
        }
        if (request.method() === 'GET' && url.pathname === '/learner_api/evidence/commercial/sample-learner/') return json({ results: [] });
        if (request.method() === 'GET' && url.pathname === '/learner_api/learner-detail/commercial/sample-learner/') return json({ ksbs: [], activityFeed: [], components: [] });
        if (request.method() === 'GET' && url.pathname === '/learner_api/calendar/commercial/sample-learner/') return json({ events: [] });
        if (request.method() === 'POST' && url.pathname === '/learner_api/reflection/monthly-reflections/' && request.postDataJSON()?.learnerId === 'sample-learner') {
          syntheticRequests.push('draft-suggestion');
          return json({});
        }
        if (request.method() === 'POST' && url.pathname === '/learner_api/reflection/assignment/check/' && request.postDataJSON()?.learnerId === 'sample-learner') {
          syntheticRequests.push('check');
          return json({ checks: ['answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours', 'reflection', 'benefit', 'impact', 'action', 'meeting', 'presentation']
            .map(key => ({ key, label: key === 'answer' ? 'Add your answer' : key === 'meeting' ? 'Choose your coaching meeting' : key, passed: !['answer', 'meeting'].includes(key) })) });
        }
      }
      if (url.origin !== base || /(?:_api\/|^\/api(?:\/|$))/.test(url.pathname) || request.method() !== 'GET') {
        blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (url.pathname === '/__monthly_submission') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>Monthly submission preview</title>
        <script type="module">import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;</script></head>
        <body><div id="root"></div><script type="module" src="/scripts/monthly-submission-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    if (!wizardOnly) {
    await page.goto(`${base}/__monthly_submission`);
    const continueLink = page.getByRole('link', { name: 'Continue assignment', exact: true }).first();
    await expect(continueLink).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'September 2026', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '4 assignments this month', exact: true })).toBeVisible();
    const summary = page.getByRole('region', { name: 'September 2026 assignment summary', exact: true });
    await expect(summary.getByText('2 need your work', { exact: true })).toBeVisible();
    await expect(summary.getByText('1 awaiting coach review', { exact: true })).toBeVisible();
    await expect(summary.getByText('1 complete', { exact: true })).toBeVisible();
    await expect(continueLink).toHaveAttribute('href', '/learner/monthly-submission/commercial/sample-learner/sample-draft?month=2026-09');
    await expect(page.getByRole('navigation', { name: 'Assignment months' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Choose a month' })).toHaveCount(0);
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
      .map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })));
    await page.screenshot({ path: resolve(output, `current-${viewport.width}.png`), fullPage: true });
    expect(overflow, 'Page content must fit the viewport').toEqual([]);
    // At 200% equivalent reflow, vertical scrolling remains normal.
    if (viewport.width !== 720) await expect(continueLink).toBeInViewport();
    await page.getByRole('link', { name: 'View other months', exact: true }).click();
    const chooser = page.getByRole('combobox', { name: 'Choose a month', exact: true });
    await expect(chooser).toBeVisible();
    await chooser.selectOption('2026-10');
    await expect(page.getByRole('heading', { name: 'October 2026', exact: true, level: 1 })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Start assignment', exact: true }).first()).toHaveAttribute('href', '/learner/monthly-submission/commercial/sample-learner/sample-october?month=2026-10');
    await page.screenshot({ path: resolve(output, `other-month-${viewport.width}.png`), fullPage: true });
    const archiveOverflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter(element => element.getBoundingClientRect().right > innerWidth + 1)
      .map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })));
    expect(archiveOverflow, 'Other months must fit the viewport').toEqual([]);
    await page.getByRole('link', { name: 'Back to current month', exact: true }).click();
    await expect(continueLink).toBeVisible();
    await expect(page.getByRole('heading', { name: 'September 2026', exact: true, level: 1 })).toBeFocused();
    await page.getByRole('link', { name: 'Read instructions', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Assignment instructions', exact: true, level: 1 })).toBeFocused();
    await expect(page.getByText('For your workplace marketing review, describe a practical example from your workplace. Explain what you did, what you learned and how you will use it in your next task.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `instructions-${viewport.width}.png`), fullPage: true });
    await page.goto(`${base}/__monthly_submission?scenario=empty-current`);
    await expect(page.getByRole('heading', { name: 'September 2026', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No assignments planned for September 2026', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start assignment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View October 2026', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `empty-current-${viewport.width}.png`), fullPage: true });
    }
    wizardScenario = 'wizard-new';
    await page.goto(`${base}/__monthly_submission?scenario=wizard-new`);
    await expect(page.getByText('Stage 1 of 4', { exact: true })).toBeVisible();
    const stageSelector = page.getByRole('combobox', { name: 'Assignment stage', exact: true });
    if (viewport.width < 640) {
      await expect(stageSelector).toBeVisible();
      await expect(stageSelector.getByRole('option')).toHaveCount(4);
    } else await expect(page.getByRole('navigation', { name: 'Assignment stages' }).getByRole('button')).toHaveCount(4);
    await expect(page.getByRole('heading', { name: 'What you need to do', exact: true })).toBeVisible();
    await expect(page.getByLabel(/Your answer \(/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit assignment', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `wizard-task-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page.getByText('Stage 2 of 4', { exact: true })).toBeVisible();
    const answer = page.getByLabel(/Your answer \(/);
    await answer.fill('This is a synthetic draft answer for the local visual test.');
    for (const field of await page.locator('textarea:not([disabled])').all()) {
      await field.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await field.focus();
      await expect(field).toBeFocused();
      expect(await field.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const footer = document.querySelector('.sticky.bottom-0')?.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, footer?.top ?? innerHeight) - Math.max(rect.top, 0);
        return visibleHeight >= Math.min(rect.height, 200);
      }), 'Every answer field can be read and focused above the sticky footer').toBe(true);
    }
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Supporting evidence (optional)', exact: true })).toBeVisible();
    expect(savedDraft.assignmentAnswer).toBe('This is a synthetic draft answer for the local visual test.');
    expect(savedDraft.submissionMode).toBe('draft');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `wizard-work-${viewport.width}.png`), fullPage: true });
    await page.getByRole('combobox', { name: 'Part of your work', exact: true }).selectOption('5');
    await expect(page.getByRole('heading', { name: 'Your next steps', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page.getByText('Stage 3 of 4', { exact: true })).toBeVisible();
    expect(syntheticRequests.filter(value => value === 'check')).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `wizard-meeting-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expect(page.getByText('Stage 4 of 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete your answer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit assignment', exact: true })).toBeDisabled();
    expect(syntheticRequests.filter(value => value === 'check')).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `wizard-check-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Complete your answer', exact: true }).click();
    await expect(answer).toHaveValue('This is a synthetic draft answer for the local visual test.');
    wizardScenario = 'wizard-draft';
    await page.goto(`${base}/__monthly_submission?scenario=wizard-draft`);
    await expect(page.getByText('Stage 2 of 4', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your action plan for next month (at least 20 words)', exact: true })).toHaveValue('Synthetic saved next steps.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}x${viewport.height}: ${wizardOnly ? '' : 'current-month overview, counts, chooser, focus, instructions, empty month; '}guided wizard, draft save/restore, meeting before checks, missing-answer navigation, no overflow; ${blockedRequests.length} requests blocked, ${syntheticRequests.length} requests fulfilled locally`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
