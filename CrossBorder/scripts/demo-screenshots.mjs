/**
 * Capture demo viewport screenshots for Flows A–E (RW-008 / RW-008b).
 * Requires Vite on :9000 and playwright-core + Chromium cache.
 */
import pkg from '/tmp/node_modules/playwright-core/index.js';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const { chromium } = pkg;

function findChrome() {
  const base = join(process.env.HOME, 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium')).reverse()) {
    const roots = [
      join(base, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      join(base, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
      join(base, dir, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
    ];
    const hit = roots.find((p) => existsSync(p));
    if (hit) return hit;
  }
  return null;
}

const outDir = join(process.cwd(), 'demo/recordings');
mkdirSync(outDir, { recursive: true });

const executablePath = findChrome();
if (!executablePath) {
  console.error('No Playwright Chromium found — run: npx playwright install chromium');
  process.exit(1);
}

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
];

const flows = [
  { id: 'A', tabs: ['Dashboard'], file: 'flow-a-dashboard' },
  { id: 'B', tabs: ['Compliance Hub'], file: 'flow-b-compliance' },
  { id: 'C', tabs: ['Payroll', 'Payroll & HR'], file: 'flow-c-payroll' },
  { id: 'D', tabs: ['People'], file: 'flow-d-people' },
  { id: 'E', tabs: ['Filing Calendar'], file: 'flow-e-filing' },
];

const browser = await chromium.launch({ headless: true, executablePath });
const results = [];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto('http://127.0.0.1:9000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    try {
      localStorage.setItem(
        'suez_app_session',
        JSON.stringify({
          role: 'admin',
          displayName: 'Demo Admin',
          email: 'admin@demo.test',
          orgId: 'org-demo',
          loggedInAt: new Date().toISOString(),
        }),
      );
      localStorage.setItem('suez_ff_ff_people_module', 'true');
      localStorage.setItem('nav_sidebar_collapsed', 'false');
      sessionStorage.setItem('suez_access_role', 'owner');
    } catch {
      /* ignore */
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  for (const flow of flows) {
    let ok = false;
    let matchedTab = flow.tabs[0];
    try {
      const openNav = page.getByRole('button', { name: /Open navigation/i });
      if (await openNav.count()) {
        await openNav.first().click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
      }
      const expand = page.getByRole('button', { name: /Expand sidebar/i });
      if (await expand.count()) {
        await expand.first().click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      for (const tab of flow.tabs) {
        matchedTab = tab;
        let btn = page.getByRole('button', { name: tab, exact: true });
        if (!(await btn.count())) {
          btn = page.locator(`button.sidebar-item[data-label="${tab}"]`);
        }
        if (await btn.count()) {
          await btn.first().click({ timeout: 4000 });
          await page.waitForTimeout(1200);
          ok = true;
          break;
        }
      }
    } catch {
      ok = false;
    }
    const path = join(outDir, `${flow.file}-${vp.name}.png`);
    await page.screenshot({ path, fullPage: false });
    results.push({ flow: flow.id, viewport: vp.name, path, ok, tab: matchedTab });
  }
  await page.close();
}

await browser.close();

const report = {
  meta: {
    artifact: 'demo_screenshots',
    rework_ids: ['RW-008', 'RW-008b'],
    generated_at: new Date().toISOString(),
  },
  results,
  note: 'Automated viewport captures for Flows A–E (desktop + tablet).',
};
writeFileSync(join(outDir, 'screenshot_report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(process.cwd(), 'context/reports/demo_screenshots.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
