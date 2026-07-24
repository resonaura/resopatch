/**
 * Open ResoPatch in Chromium, wait for cable routes, dump diagnostics + screenshots.
 * Usage: node scripts/dump-routes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = process.env.RESOPATCH_URL ?? 'http://localhost:5173';
const PASS = process.env.RESOPATCH_PASS ?? 'admin';
const OUT = process.env.DUMP_OUT ?? path.resolve('.route-dump');
const HEADLESS = process.env.HEADLESS !== '0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.waitForSelector('input[type="password"]', { timeout: 15000 }).catch(() => null);
  const hasLogin = await page.$('input[type="password"]');
  if (!hasLogin) return false;

  await page.evaluate((pass) => {
    const i = document.querySelector('input[type="password"]');
    if (!i) return;
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(i, pass);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, PASS);

  await page.evaluate(() => {
    const b = document.querySelector('button[type="submit"]');
    if (b) b.removeAttribute('disabled');
  });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), {
    timeout: 30000,
  });
  return true;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: HEADLESS,
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const consoleLines = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/ResoPatch routes|Error|error|pickBest|route/i.test(t)) {
      consoleLines.push(`[${msg.type()}] ${t.slice(0, 500)}`);
    }
  });
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  console.log('→', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  const didLogin = await login(page);
  console.log('login:', didLogin);

  // Wait for React Flow canvas + routes dump
  await page.waitForSelector('.react-flow', { timeout: 60000 });
  console.log('canvas present, waiting for route dump…');

  let dump = null;
  for (let i = 0; i < 40; i++) {
    dump = await page.evaluate(() => window.__resopatchLastRouteDump ?? null);
    if (dump && dump.edgeCount > 0) break;
    await sleep(500);
  }

  if (!dump) {
    // try force arrange if button exists
    const arranged = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const b = buttons.find((el) => /arrange|разлож|layout/i.test(el.textContent || ''));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    console.log('clicked Arrange:', arranged);
    for (let i = 0; i < 40; i++) {
      dump = await page.evaluate(() => window.__resopatchLastRouteDump ?? null);
      if (dump && dump.edgeCount > 0) break;
      await sleep(500);
    }
  }

  // Fit view / zoom out a bit for screenshot
  await page.evaluate(() => {
    // try react-flow controls fit
    const fit = document.querySelector('.react-flow__controls-fitview');
    if (fit) fit.click();
  });
  await sleep(800);

  const shotPath = path.join(OUT, 'canvas.png');
  await page.screenshot({ path: shotPath, fullPage: false });
  console.log('screenshot:', shotPath);

  // Second shot of the flow viewport only
  const flow = await page.$('.react-flow');
  if (flow) {
    await flow.screenshot({ path: path.join(OUT, 'flow.png') });
  }

  dump = await page.evaluate(() => window.__resopatchLastRouteDump ?? null);

  if (dump) {
    const jsonPath = path.join(OUT, 'routes.json');
    fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2));
    console.log('dump:', jsonPath);
    console.log('edges:', dump.edgeCount, 'nodes:', dump.nodeCount);
    console.log('nonOrtho:', dump.nonOrthoEdges?.length ?? 0);
    console.log('stacks:', dump.overlaps?.length ?? 0);

    // Analyze windings
    const windy = (dump.edges || [])
      .map((e) => ({
        id: e.id,
        bends: e.bendCount,
        pts: e.points?.length,
        len: e.length,
        side: `${e.sourceSide}>${e.targetSide}`,
        src: e.source,
        tgt: e.target,
      }))
      .sort((a, b) => b.bends - a.bends || b.pts - a.pts);

    console.log('\n=== worst windings (by bends) ===');
    for (const w of windy.slice(0, 15)) {
      console.log(
        `  bends=${w.bends} pts=${w.pts} len=${w.len} ${w.side} ${w.id.slice(0, 40)} ${w.src.slice(0, 8)}→${w.tgt.slice(0, 8)}`,
      );
    }

    const avgBends =
      windy.length === 0 ? 0 : windy.reduce((s, w) => s + w.bends, 0) / windy.length;
    const highBends = windy.filter((w) => w.bends >= 6).length;
    console.log(`\navg bends: ${avgBends.toFixed(1)} · edges with ≥6 bends: ${highBends}/${windy.length}`);

    fs.writeFileSync(
      path.join(OUT, 'summary.json'),
      JSON.stringify(
        {
          edgeCount: dump.edgeCount,
          nodeCount: dump.nodeCount,
          nonOrtho: dump.nonOrthoEdges?.length ?? 0,
          stacks: dump.overlaps?.length ?? 0,
          avgBends,
          highBends,
          worst: windy.slice(0, 20),
          topStacks: (dump.overlaps || []).slice(0, 20),
        },
        null,
        2,
      ),
    );
  } else {
    console.error('NO ROUTE DUMP — routes never computed or log not installed');
  }

  fs.writeFileSync(path.join(OUT, 'console.txt'), consoleLines.join('\n'));
  console.log('console lines:', consoleLines.length);

  if (process.env.KEEP_OPEN === '1') {
    console.log('KEEP_OPEN=1 — browser stays for 60s');
    await sleep(60000);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
