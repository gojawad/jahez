'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = 4700 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';

function chromiumPath() {
  return [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

async function waitForServer(processHandle) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (processHandle.exitCode !== null) throw new Error(`server exited with ${processHandle.exitCode}`);
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

function fakeJwt(exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'mobile-admin', exp, aud: 'authenticated' })}.signature`;
}

async function prepareContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const profile = { id: 'mobile-admin', email: 'admin@example.test', display_name: 'مدير الموبايل', role: 'admin', active: true, photo_url: '' };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  await context.addInitScript(({ profile, expiresAt, token }) => {
    localStorage.setItem('shipdocs-auth', JSON.stringify({
      access_token: token,
      refresh_token: 'refresh-token',
      expires_at: expiresAt,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: profile.id, email: profile.email, aud: 'authenticated', role: 'authenticated' }
    }));
  }, { profile, expiresAt, token: fakeJwt(expiresAt) });

  for (const pattern of ['https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**', 'https://unpkg.com/**']) {
    await context.route(pattern, route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  }
  await context.route(`${SUPABASE_ORIGIN}/**`, route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Content-Type': 'application/json'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (url.pathname === '/rest/v1/profiles') return route.fulfill({ status: 200, headers, body: JSON.stringify([profile]) });
    if (url.pathname === '/rest/v1/companies') return route.fulfill({ status: 200, headers, body: JSON.stringify([{ id: 'bsgt-company', name_ar: 'بحر سواكن', name_en: 'Bahar Swaken', settings: {} }]) });
    if (url.pathname === '/rest/v1/shipments') return route.fulfill({ status: 200, headers, body: '[]' });
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Range': '0-0/0' }, body: '' });
    return route.fulfill({ status: 200, headers, body: '[]' });
  });
  return context;
}

async function main() {
  const executablePath = chromiumPath();
  if (!executablePath) throw new Error('Chrome or Edge was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BUILD_SHA: 'mobile-responsive-test' },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP jahez.test 127.0.0.1']
    });
    const context = await prepareContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${APP_ORIGIN}/#v=dashboard`, { waitUntil: 'domcontentloaded' });
    await page.locator('body.mobile-app-ready #viewDashboard.active').waitFor({ timeout: 20000 });
    const output = path.join(__dirname, 'output');
    fs.mkdirSync(output, { recursive: true });

    for (const width of [360, 390, 393, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 950 });
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        header: getComputedStyle(document.getElementById('mobileAppHeader')).display,
        bottom: getComputedStyle(document.getElementById('mobileBottomNav')).display,
        sidebar: document.querySelector('.app-sidebar').getBoundingClientRect().toJSON(),
        bodyPaddingRight: getComputedStyle(document.body).paddingRight,
        bodyZoom: getComputedStyle(document.body).zoom,
        viewportFit: document.querySelector('meta[name="viewport"]').content
      }));
      assert.ok(metrics.overflow <= 1, `${width}px page overflowed by ${metrics.overflow}px`);
      assert.ok(metrics.viewportFit.includes('viewport-fit=cover'));
      if (width <= 1023) {
        assert.strictEqual(metrics.header, 'grid', `${width}px mobile header must be visible`);
        assert.strictEqual(metrics.bodyPaddingRight, '0px');
        assert.ok(['1', '100%'].includes(metrics.bodyZoom), `${width}px body zoom must be reset`);
        assert.ok(metrics.sidebar.left >= width, `${width}px drawer must start outside the viewport: ${JSON.stringify(metrics.sidebar)}`);
      } else {
        assert.strictEqual(metrics.header, 'none', `${width}px desktop header must stay untouched`);
        assert.strictEqual(metrics.bottom, 'none', `${width}px desktop bottom navigation must be hidden`);
        assert.ok(metrics.sidebar.left < width, `${width}px desktop sidebar must remain visible`);
      }
      assert.strictEqual(metrics.bottom, width <= 767 ? 'flex' : 'none', `${width}px bottom navigation breakpoint is incorrect`);
      await page.screenshot({ path: path.join(output, `mobile-app-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileDrawerTrigger').click();
    await page.waitForTimeout(300);
    assert.ok(await page.locator('body').evaluate(node => node.classList.contains('mobile-drawer-open')));
    const openDrawer = await page.locator('.app-sidebar').boundingBox();
    assert.ok(openDrawer && openDrawer.x >= 0 && openDrawer.x + openDrawer.width <= 391, `drawer must fit the mobile viewport: ${JSON.stringify(openDrawer)}`);
    await page.locator('#mobileDrawerClose').click();
    await page.locator('[data-mobile-view="records"]').click();
    await page.locator('#viewRecords.active').waitFor();
    assert.ok(page.url().includes('#v=records'));
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    assert.strictEqual(await page.locator('[data-mobile-view="records"]').getAttribute('aria-current'), 'page');
    assert.ok((await page.locator('#mobilePageTitle').textContent()).includes('الشحنات'));
    await page.screenshot({ path: path.join(output, 'mobile-app-records-390.png'), fullPage: true });

    const routeViews = ['dashboard', 'tasks', 'createShip', 'records', 'operationCenter', 'bsgtWorkspace', 'activityLog', 'money', 'wallet', 'clientProfiles', 'admin'];
    for (const view of routeViews) {
      await page.evaluate(target => window.switchView(target), view);
      await page.waitForTimeout(100);
      const routeMetrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        active: document.querySelector('.view.active')?.id || ''
      }));
      assert.ok(routeMetrics.active, `${view} must keep an active application view`);
      assert.ok(routeMetrics.overflow <= 1, `${view} overflowed mobile by ${routeMetrics.overflow}px`);
    }

    await page.evaluate(() => window.switchView('dashboard'));
    await page.locator('#mobileProfileButton').click();
    await page.locator('#profileOverlay.open').waitFor();
    const profileCard = await page.locator('#profileOverlay .detail-card').boundingBox();
    assert.ok(profileCard && profileCard.x >= 0 && profileCard.x + profileCard.width <= 391, 'mobile profile sheet must fit the viewport');
    await page.locator('#profileOverlay .close-x').click();
    assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(' | ')}`);
    await context.close();
    console.log('Mobile application responsive shell: passed');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
