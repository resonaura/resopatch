/**
 * Puppeteer performance probe for Resopatch canvas lag.
 * Usage: node scripts/perf-profile.mjs
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const BASE = process.env.RESOPATCH_URL ?? 'http://localhost:5173';
const PASS = process.env.RESOPATCH_PASS ?? 'admin';
const WAIT_MS = Number(process.env.PERF_WAIT_MS ?? 30000);

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

  // Enable submit if still disabled
  await page.evaluate(() => {
    const b = document.querySelector('button[type="submit"]');
    if (b) b.removeAttribute('disabled');
  });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 30000 });
  return true;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLines = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/CableRouter|route|LONG|worker|libavoid|Error|error|Couldn't create edge|autoLayout|longtask/i.test(text)) {
      consoleLines.push(`[${msg.type()}] ${text.slice(0, 300)}`);
    }
  });
  page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

  await page.evaluateOnNewDocument(() => {
    window.__perf = {
      longTasks: [],
      workers: 0,
      workerUrls: [],
      routeLogs: [],
      setStateHeavy: [],
      consoleEdgeWarns: 0,
    };

    const OrigWorker = window.Worker;
    window.Worker = function (...args) {
      window.__perf.workers += 1;
      window.__perf.workerUrls.push(String(args[0]));
      const w = new OrigWorker(...args);
      const origPost = w.postMessage.bind(w);
      w.postMessage = (data, ...rest) => {
        window.__perf.routeLogs.push({
          t: Math.round(performance.now()),
          kind: 'postMessage',
          id: data?.id,
          edges: data?.edges?.length,
          obstacles: data?.obstacles?.length,
        });
        return origPost(data, ...rest);
      };
      w.addEventListener('message', (ev) => {
        window.__perf.routeLogs.push({
          t: Math.round(performance.now()),
          kind: 'message',
          id: ev.data?.id,
          ok: ev.data?.ok,
          routes: ev.data?.routes?.length,
          error: ev.data?.error,
        });
      });
      return w;
    };
    window.Worker.prototype = OrigWorker.prototype;

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({
            ms: Math.round(e.duration),
            at: Math.round(e.startTime),
            name: e.name,
          });
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* ignore */
    }

    // Time sync setState-ish: wrap MessageChannel / queueMicrotask not enough.
    // Time requestAnimationFrame callbacks.
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      origRaf((t) => {
        const t0 = performance.now();
        const r = cb(t);
        const dt = performance.now() - t0;
        if (dt > 30) {
          window.__perf.setStateHeavy.push({ kind: 'raf', ms: Math.round(dt), at: Math.round(t0) });
        }
        return r;
      });
  });

  const client = await page.createCDPSession();
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 100 }); // microseconds in CDP? Actually Chrome uses microseconds, 100 = 0.1ms

  console.log('→ open', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(800);

  console.log('→ login');
  const didLogin = await login(page);
  console.log('  logged in:', didLogin);

  await client.send('Profiler.start');

  console.log('→ wait for react-flow');
  await page.waitForSelector('.react-flow', { timeout: 45000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node').length > 5,
    { timeout: 45000 },
  );

  console.log(`→ observe ${WAIT_MS}ms after canvas ready`);
  await sleep(WAIT_MS);

  const profile = await client.send('Profiler.stop');

  const snap = await page.evaluate(() => {
    const longs = [...(window.__perf?.longTasks ?? [])].sort((a, b) => b.ms - a.ms);
    const resources = performance
      .getEntriesByType('resource')
      .filter((e) => /obstacle|libavoid|routeWorker|edgeRouting|PatchCanvas|Constructor|autoLayout|RoutedEdge/.test(e.name))
      .map((e) => ({
        name: e.name.replace(location.origin, '').split('?')[0],
        ms: +e.duration.toFixed(1),
        size: e.transferSize,
      }));

    return {
      longs,
      longSum: longs.reduce((s, x) => s + x.ms, 0),
      longMax: longs[0]?.ms ?? 0,
      workers: window.__perf?.workers ?? 0,
      workerUrls: window.__perf?.workerUrls ?? [],
      routeLogs: window.__perf?.routeLogs ?? [],
      heavyRaf: window.__perf?.setStateHeavy ?? [],
      resources,
      nodes: document.querySelectorAll('.react-flow__node').length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      paths: document.querySelectorAll('path').length,
      images: document.querySelectorAll('image, img').length,
      mem: performance.memory
        ? {
            usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
            totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
          }
        : null,
    };
  });

  // Aggregate CPU profile
  const pNodes = profile.profile?.nodes ?? [];
  const samples = profile.profile?.samples ?? [];
  const timeDeltas = profile.profile?.timeDeltas ?? [];
  const selfTime = new Map();
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = timeDeltas[i] ?? 0;
    selfTime.set(id, (selfTime.get(id) ?? 0) + dt);
  }
  const byFn = new Map();
  for (const n of pNodes) {
    const t = selfTime.get(n.id) ?? 0;
    if (t < 2000) continue; // skip <2ms
    const name = n.callFrame?.functionName || '(anonymous)';
    const url = (n.callFrame?.url || '').replace(/\?.*$/, '');
    const short = url.includes('/src/') ? url.split('/src/').pop() : url.split('/').slice(-2).join('/');
    const key = `${name} @ ${short}:${n.callFrame?.lineNumber ?? '?'}`;
    byFn.set(key, (byFn.get(key) ?? 0) + t);
  }
  const topFns = [...byFn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000) }));

  // Filter interesting app code
  const appFns = topFns.filter(
    (f) =>
      /src\/|edgeRouting|libavoid|route|autoLayout|PatchCanvas|RoutedEdge|dagre|obstacle|Worker|findPath|computeRoutes|bundleFan|sampleAlong|finalize|stubRoutes/.test(
        f.fn,
      ),
  );

  const report = { snap, topFns, appFns, sampleCount: samples.length, consoleLines: consoleLines.slice(-100) };
  fs.writeFileSync(new URL('../.perf-report.json', import.meta.url), JSON.stringify(report, null, 2));

  console.log('\n========== PERF REPORT ==========\n');
  console.log('Canvas nodes/edges:', snap.nodes, snap.edges, 'paths:', snap.paths, 'images:', snap.images);
  console.log('Workers:', snap.workers, snap.workerUrls);
  console.log('Long tasks count/max/sum:', snap.longs.length, snap.longMax, snap.longSum);
  console.log('Top long tasks:\n', JSON.stringify(snap.longs.slice(0, 15), null, 2));
  console.log('Route worker logs:\n', JSON.stringify(snap.routeLogs, null, 2));
  console.log('Heavy rAF:\n', JSON.stringify(snap.heavyRaf.slice(0, 20), null, 2));
  console.log('Resources:\n', JSON.stringify(snap.resources, null, 2));
  console.log('App CPU hotspots:\n', JSON.stringify(appFns.slice(0, 30), null, 2));
  console.log('Top CPU overall:\n', JSON.stringify(topFns.slice(0, 20), null, 2));
  console.log('Mem:', snap.mem);
  console.log('Console (filtered) count', consoleLines.length);
  console.log(consoleLines.slice(0, 40).join('\n'));
  console.log('\nWrote .perf-report.json');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
