const fs = require('fs');
const path = require('path');

const { chromium } = require(path.join(
  __dirname,
  '..',
  '..',
  'frontend',
  'node_modules',
  'playwright',
));

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'reports', 'martech_ssot_style_report_2026-10-04.md');
const htmlPath = path.join(root, 'reports', 'martech_ssot_visual_report_2026-10-04.html');
const pngPath = path.join(root, 'reports', 'martech_ssot_visual_report_2026-10-04.png');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function parseSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith('## '))?.slice(3) || '';
  const bullets = {};
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    const bullet = line.match(/^- \*\*([^*]+):\*\* (.*)$/);
    if (bullet) bullets[bullet[1]] = bullet[2];
    if (line.startsWith('| Aptem ID')) { inTable = true; continue; }
    if (inTable && /^\|\s*:?-{3,}/.test(line)) continue;
    const row = line.match(/^\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
    if (inTable && row) rows.push(row.slice(1));
  }
  return { title, bullets, rows };
}

function bullet(bullets, key) {
  return bullets[key] || '';
}

function sectionHtml(section) {
  const b = section.bullets;
  const rows = section.rows.map((row) => {
    const cells = row.map((cell, index) => {
      const positive = index === 4 && String(cell).trim().startsWith('+');
      const negative = index === 4 && String(cell).trim().startsWith('-');
      return `<td class="${positive ? 'positive' : negative ? 'negative' : ''}">${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<section class="group">
    <h2>${escapeHtml(section.title)}</h2>
    <div class="meta">
      <div><strong>Coach:</strong> ${escapeHtml(bullet(b, 'Coach'))}</div>
      ${bullet(b, 'Tutor') ? `<div><strong>Tutor:</strong> ${escapeHtml(bullet(b, 'Tutor'))}</div>` : ''}
      ${bullet(b, 'ملاحظة') ? `<div><strong>ملاحظة:</strong> ${escapeHtml(bullet(b, 'ملاحظة'))}</div>` : ''}
      <div><strong>عدد الطلاب:</strong> ${escapeHtml(bullet(b, 'عدد الطلاب'))}</div>
      <div><strong>Aptem:</strong> ${escapeHtml(bullet(b, 'Aptem الخام'))}</div>
      <div><strong>SSOT:</strong> ${escapeHtml(bullet(b, 'SSOT بعد الإصلاح'))}</div>
      <div><strong>الفرق:</strong> ${escapeHtml(bullet(b, 'الفرق'))}</div>
      <div><strong>التكرار:</strong> ${escapeHtml(bullet(b, 'التكرار'))}</div>
    </div>
    <table><thead><tr><th>Aptem ID</th><th>الطالب</th><th>Aptem</th><th>SSOT</th><th>الفرق</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

async function main() {
  const markdown = fs.readFileSync(source, 'utf8');
  const parts = markdown.split(/(?=^## Martech – )/m).filter((part) => part.trim());
  const sections = parts.filter((part) => part.startsWith('## Martech –')).map(parseSection);
  const review = markdown.split('## حالات متبقية للمراجعة')[1] || '';
  const reviewItems = review.split(/\r?\n/)
    .filter((line) => line.startsWith('- '))
    .map((line) => `<li>${escapeHtml(line.slice(2))}</li>`)
    .join('');

  const html = `<!doctype html><html lang="ar" dir="ltr"><head><meta charset="utf-8"><title>Martech SSOT Report</title>
  <style>
    *{box-sizing:border-box} body{margin:0;background:#eef1fb;font-family:"Segoe UI",Arial,sans-serif;color:#20242b;padding:28px}
    .page{width:980px;margin:0 auto;background:#eef1fb}.header{background:#dfe5f7;border:1px solid #c6cde3;border-radius:8px;padding:14px 20px;margin-bottom:14px}
    h1{font-size:24px;margin:0 0 4px;color:#273451}.sub{font-size:13px;color:#59647b}.group{background:#f5f7fd;border:1px solid #c6cde3;border-radius:6px;padding:14px 16px;margin:14px 0;box-shadow:0 1px 2px #ccd2e6}
    h2{font-size:20px;background:#cfd7ee;display:inline-block;padding:3px 8px;margin:0 0 8px;color:#273451}.meta{font-size:13px;line-height:1.6;margin:0 0 10px}.meta strong{color:#303946}.meta div:last-child{color:#9a4a2c}
    table{width:100%;border-collapse:collapse;background:white;font-size:12px} th{background:#e4e8f3;text-align:left;font-weight:700} th,td{border:1px solid #bfc4cf;padding:5px 7px;white-space:nowrap} td:nth-child(2){white-space:normal} td.positive{font-weight:700;color:#a04426} td.negative{font-weight:700;color:#326b9d}
    .review{background:#fff6e8;border:1px solid #e1bd84;border-radius:6px;padding:12px 16px;font-size:13px}.review h3{margin:0 0 6px;color:#8b4c1d}.review ul{margin:6px 0 0;padding-left:22px;line-height:1.6}.footer{font-size:11px;color:#667085;margin-top:12px}
  </style></head><body><main class="page"><div class="header"><h1>Martech — SSOT Report</h1><div class="sub">Write run 1719 · Database neondb · LMS exclusions 0</div></div>${sections.map(sectionHtml).join('')}<div class="review"><h3>حالات متبقية للمراجعة</h3><ul>${reviewItems}</ul></div><div class="footer">Generated from the verified post-write report. Pending duplicate corrections remain visible.</div></main></body></html>`;

  fs.writeFileSync(htmlPath, html, 'utf8');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.screenshot({ path: pngPath, fullPage: true });
  await browser.close();
  console.log(pngPath);
}

main().catch((error) => { console.error(error); process.exit(1); });
