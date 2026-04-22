const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const DB_HTML = path.join(__dirname, 'db_preview.html');

const targets = [
  {
    name: 'frontend-home.png',
    url: 'http://127.0.0.1:5173/',
    viewport: { width: 1440, height: 900 },
    waitFor: 'networkidle',
    extraWaitMs: 800,
  },
  {
    name: 'backend-api-docs.png',
    url: 'http://127.0.0.1:8000/docs',
    viewport: { width: 1440, height: 900 },
    waitFor: 'networkidle',
    extraWaitMs: 1200,
  },
  {
    name: 'database.png',
    url: 'file://' + DB_HTML,
    viewport: { width: 1280, height: 900 },
    waitFor: 'load',
    extraWaitMs: 200,
    fullPage: true,
  },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const ctx = await browser.newContext({
      viewport: t.viewport,
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    const page = await ctx.newPage();
    console.log(`→ ${t.url}`);
    await page.goto(t.url, { waitUntil: t.waitFor, timeout: 30000 });
    await page.waitForTimeout(t.extraWaitMs || 0);
    const outPath = path.join(OUT, t.name);
    await page.screenshot({ path: outPath, fullPage: t.fullPage === true });
    console.log(`   saved ${outPath}`);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
