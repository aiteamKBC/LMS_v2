/** Offline Chromium download proof using production CSV code and synthetic rows.
 * node frontend/scripts/verify-users-export-download.mjs <artifact-directory> [browser-executable]
 * No application server, authentication, backend or database is started.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { chromium } from '@playwright/test';
import xlsx from 'xlsx';

const output = process.argv[2];
assert.ok(output, 'An explicit artifact directory is required.');
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function compiled(relative) {
  return ts.transpileModule(await readFile(resolve(frontend, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const csvCode = await compiled('src/utils/bulkCsv.ts');
const exportCode = await compiled('src/pages/users/directoryExport.ts');
const browser = await chromium.launch({ headless: true,
  ...(process.argv[3] ? { executablePath: resolve(process.argv[3]) } : {}),
});
try {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  let networkAttempts = 0;
  await context.route('**/*', route => { networkAttempts++; return route.abort(); });
  await page.setContent('<button id="export">Export</button>');
  await page.addScriptTag({ content: `(() => {
    const csv = {}; new Function('exports', ${JSON.stringify(csvCode)})(csv);
    const directory = {};
    new Function('exports', 'require', ${JSON.stringify(exportCode)})(directory, name => {
      if (name === '@/utils/bulkCsv') return csv;
      throw new Error('Unexpected module: ' + name);
    });
    window.directoryExport = directory;
  })();` });
  await page.evaluate(() => {
    const users = Array.from({ length: 757 }, (_, i) => ({
      id: String(i + 1), name: i ? `Example User ${i + 1}` : 'متعلم, "مثال"\nسطر آخر',
      type: 'User', email: 'shared@example.test', source: 'commercial',
      group: 'Group A', programme: 'Programme A', cohort: 'Cohort A',
      subscriptionStatus: 'FullUser', programmeStatus: 'Delivery',
    }));
    users[1].name = '=1+1';
    document.querySelector('#export').onclick = () => window.directoryExport.exportUsersCsv(
      users, user => user.id === '1' ? 'Recorded' : 'Live Sessions', new Date('2026-11-01T12:30:00.000Z'),
    );
  });
  const downloading = page.waitForEvent('download');
  await page.click('#export');
  const download = await downloading;
  const filename = 'users-directory-2026-11-01T12-30-00-000Z.csv';
  assert.equal(download.suggestedFilename(), filename);
  await mkdir(resolve(output), { recursive: true });
  const target = resolve(output, filename);
  await download.saveAs(target);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(target);
  assert.deepEqual([...bytes.subarray(0, 3)], [239, 187, 191]);
  const book = xlsx.read(bytes, { type: 'buffer', raw: true });
  const rows = xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
  assert.equal(rows.length, 758);
  assert.equal(rows[0].length, 10);
  assert.equal(rows[1][1], 'متعلم, "مثال"\nسطر آخر');
  assert.equal(rows[2][1], "'=1+1");
  assert.equal(rows[757][0], '757');
  assert.equal(rows[1][9], 'Recorded');
  assert.equal(networkAttempts, 0);
  console.log(JSON.stringify({ status: 'PASS', browser: 'Chromium', actualDownload: true,
    records: 757, columns: 10, utf8BOM: true, unicodeRoundTrip: true,
    formulaProtected: true, networkAttempts, syntheticDataOnly: true, artifact: target }));
  await context.close();
} finally {
  await browser.close();
}
