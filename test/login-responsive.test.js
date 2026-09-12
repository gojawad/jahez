'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = 4100 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const TURNSTILE_FUNCTION = 'https://vthcmqqiexaedukduquv.supabase.co/functions/v1/verify-turnstile';
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const OUTPUT = path.join(__dirname, 'output');
const VIEWPORTS = [
  {width:360, height:800},
  {width:390, height:844},
  {width:393, height:852},
  {width:430, height:932},
  {width:768, height:1024},
  {width:1440, height:900}
];

function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function waitForServer(proc) {
  for(let attempt = 0; attempt < 50; attempt++){
    if(proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try{ if((await fetch(`${BASE}/healthz`)).ok) return; }catch{}
    await new Promise(resolve=>setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

async function main() {
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  fs.mkdirSync(OUTPUT, {recursive:true});
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env, PORT:String(PORT), BUILD_SHA:'responsive-test'},
    stdio:['ignore', 'inherit', 'inherit']
  });
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({
      executablePath,
      headless:true,
      args:['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP jahez.test 127.0.0.1']
    });
    for(const viewport of VIEWPORTS){
      const context = await browser.newContext({viewport, deviceScaleFactor:1});
      const page = await context.newPage();
      const pageErrors = [];
      const diagnostics = [];
      page.on('pageerror', error=>pageErrors.push(error.message));
      page.on('console', message=>{
        if(['error', 'warning'].includes(message.type())) diagnostics.push(`${message.type()}: ${message.text()}`);
      });
      page.on('requestfailed', request=>diagnostics.push(`request failed: ${request.url()} ${request.failure()?.errorText || ''}`));
      await page.route(`${TURNSTILE_FUNCTION}*`, async route=>{
        const commonHeaders = {
          'Access-Control-Allow-Origin':APP_ORIGIN,
          'Access-Control-Allow-Headers':'apikey, content-type',
          'Access-Control-Allow-Methods':'GET, POST, OPTIONS'
        };
        if(route.request().method() === 'OPTIONS'){
          await route.fulfill({status:204, headers:commonHeaders, body:''});
          return;
        }
        await route.fulfill({
          status:200,
          headers:{...commonHeaders, 'Content-Type':'application/json'},
          body:JSON.stringify({enabled:true, siteKey:TURNSTILE_TEST_SITE_KEY})
        });
      });
      await page.goto(APP_ORIGIN, {waitUntil:'networkidle'});
      await page.locator('#landingPage').waitFor({state:'visible'});
      const landingMetrics = await page.evaluate(()=>{
        const landing = document.getElementById('landingPage');
        const image = document.querySelector('.landing-visual img');
        const nav = document.querySelector('.landing-nav');
        const menu = document.getElementById('landingMenuButton');
        const actions = [...document.querySelectorAll('.landing-hero-actions .landing-action')];
        const imageBox = image.getBoundingClientRect();
        return {
          bodyClass:document.body.className,
          brandPrimary:getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
          brandDark:getComputedStyle(document.documentElement).getPropertyValue('--brand-dark').trim(),
          primaryBackground:getComputedStyle(document.querySelector('.landing-action.primary')).backgroundImage,
          loginHidden:document.getElementById('lockScreen').classList.contains('hidden'),
          horizontalOverflow:landing.scrollWidth - landing.clientWidth,
          imageCount:document.querySelectorAll('.landing-visual img').length,
          imageSrc:image.getAttribute('src'),
          imageDisplay:getComputedStyle(image).display,
          imageWidth:imageBox.width,
          imageHeight:imageBox.height,
          navDisplay:getComputedStyle(nav).display,
          menuDisplay:getComputedStyle(menu).display,
          actionWidths:actions.map(action=>action.getBoundingClientRect().width),
          actionContainerWidth:document.querySelector('.landing-hero-actions').getBoundingClientRect().width,
          registrationDisabled:[...document.querySelectorAll('#landingPage button[title*="مدير النظام"]')].every(button=>button.disabled),
          hasFakeStatistics:/12,500|1,200|99\.9%/.test(landing.textContent)
        };
      });

      assert.ok(landingMetrics.bodyClass.includes('landing-active'), `${viewport.width}px must start on the public landing page`);
      assert.strictEqual(landingMetrics.brandPrimary.toUpperCase(), '#EA1B23');
      assert.strictEqual(landingMetrics.brandDark.toUpperCase(), '#D01119');
      assert.ok(landingMetrics.primaryBackground.includes('rgb(234, 27, 35)'));
      assert.ok(landingMetrics.primaryBackground.includes('rgb(208, 17, 25)'));
      assert.strictEqual(landingMetrics.loginHidden, true, `${viewport.width}px login must stay hidden until requested`);
      assert.ok(landingMetrics.horizontalOverflow <= 0, `${viewport.width}px landing page has horizontal overflow`);
      assert.strictEqual(landingMetrics.imageCount, 1, `${viewport.width}px must render one logistics image`);
      assert.strictEqual(landingMetrics.imageSrc, 'jahez-login-bsgt.png', `${viewport.width}px must use the approved BSGT image`);
      assert.notStrictEqual(landingMetrics.imageDisplay, 'none', `${viewport.width}px landing image must remain visible`);
      assert.ok(landingMetrics.imageWidth > 0 && landingMetrics.imageHeight > 0, `${viewport.width}px landing image must have usable dimensions`);
      assert.strictEqual(landingMetrics.registrationDisabled, true, 'registration must not link to a fake flow');
      assert.strictEqual(landingMetrics.hasFakeStatistics, false, 'unverified production statistics must stay hidden');
      if(viewport.width <= 767){
        assert.strictEqual(landingMetrics.navDisplay, 'none', `${viewport.width}px desktop navigation must be collapsed`);
        assert.notStrictEqual(landingMetrics.menuDisplay, 'none', `${viewport.width}px mobile menu button must be visible`);
        assert.ok(landingMetrics.actionWidths.every(width=>Math.abs(width - landingMetrics.actionContainerWidth) <= 1), `${viewport.width}px landing actions must be full width`);
        assert.ok(landingMetrics.imageHeight >= 240 && landingMetrics.imageHeight <= 321, `${viewport.width}px mobile image height must stay in the approved range`);
      }
      if(viewport.width >= 1024){
        assert.notStrictEqual(landingMetrics.navDisplay, 'none', `${viewport.width}px desktop navigation must be visible`);
        assert.strictEqual(landingMetrics.menuDisplay, 'none', `${viewport.width}px desktop menu button must be hidden`);
      }
      await page.screenshot({path:path.join(OUTPUT, `landing-${viewport.width}.png`), fullPage:false});

      if(viewport.width === 1440){
        const dashboardTheme = await page.evaluate(()=>{
          document.body.classList.remove('landing-active', 'login-active');
          document.getElementById('landingPage').hidden = true;
          document.getElementById('lockScreen').classList.add('hidden');
          currentUser = {username:'theme-test', displayName:'معاينة الهوية', role:'admin'};
          records = [];
          renderDashboard();
          document.querySelectorAll('.view').forEach(view=>view.classList.remove('active'));
          document.getElementById('viewDashboard').classList.add('active');
          const root = getComputedStyle(document.documentElement);
          return {
            heroImage:document.querySelector('.shipment-dashboard .db-hero-image')?.getAttribute('src'),
            heroShadeBackground:getComputedStyle(document.querySelector('.shipment-dashboard .db-hero-shade')).backgroundImage,
            statBackground:getComputedStyle(document.querySelector('.shipment-dashboard .db-stat')).backgroundColor,
            insightBackground:getComputedStyle(document.querySelector('.db-insight')).backgroundImage,
            chartStroke:document.querySelector('.db-chart path[stroke]')?.getAttribute('stroke'),
            brandPrimary:root.getPropertyValue('--brand-primary').trim(),
            brandDark:root.getPropertyValue('--brand-dark').trim()
          };
        });
        assert.strictEqual(dashboardTheme.heroImage, 'jahez-login-bsgt.png');
        assert.ok(dashboardTheme.heroShadeBackground.includes('rgba(13, 24, 37'));
        assert.strictEqual(dashboardTheme.statBackground, 'rgb(255, 255, 255)');
        assert.ok(dashboardTheme.insightBackground.includes('rgb(23, 33, 45)'));
        assert.strictEqual(dashboardTheme.chartStroke.toUpperCase(), '#EA1B23');
        assert.strictEqual(dashboardTheme.brandPrimary.toUpperCase(), '#EA1B23');
        assert.strictEqual(dashboardTheme.brandDark.toUpperCase(), '#D01119');
        await page.screenshot({path:path.join(OUTPUT, 'dashboard-brand-1440.png'), fullPage:false});
        await page.evaluate(()=>showLanding());
      }

      await page.locator('#landingLoginBtn').click();
      await page.locator('#lockScreen').waitFor({state:'visible'});
      try{
        await page.locator('#turnstileWidget input[name="cf-turnstile-response"]').waitFor({state:'attached', timeout:15000});
      }catch(error){
        const state = await page.evaluate(()=>({
          url:location.href,
          title:document.title,
          note:document.getElementById('loginSecurityNote')?.textContent || '',
          widget:document.getElementById('turnstileWidget')?.innerHTML.slice(0, 300) || ''
        }));
        throw new Error(`Turnstile widget did not render at ${viewport.width}px: ${JSON.stringify({state, diagnostics})}`);
      }
      await page.waitForTimeout(650);
      const metrics = await page.evaluate(()=>{
        const rect = selector=>{
          const box = document.querySelector(selector).getBoundingClientRect();
          return {top:box.top, bottom:box.bottom, left:box.left, right:box.right, width:box.width, height:box.height};
        };
        const hero = document.querySelector('#lockScreen .lock-image-panel');
        const widget = document.getElementById('turnstileWrap');
        return {
          viewportWidth:innerWidth,
          heroCount:document.querySelectorAll('#lockScreen .lock-image-panel').length,
          heroDisplay:getComputedStyle(hero).display,
          heroImage:getComputedStyle(hero, '::after').backgroundImage,
          heroBackgroundSize:getComputedStyle(hero, '::after').backgroundSize,
          heroFillImage:getComputedStyle(hero, '::before').backgroundImage,
          heroFillSize:getComputedStyle(hero, '::before').backgroundSize,
          lock:rect('#lockScreen'),
          panel:rect('#lockScreen .lock-form-panel'),
          card:rect('#loginForm'),
          logo:rect('#lockLogo'),
          cardTransform:getComputedStyle(document.getElementById('loginForm')).transform,
          horizontalOverflow:document.documentElement.scrollWidth - innerWidth,
          widgetOverflow:widget.scrollWidth - widget.clientWidth,
          widgetRenderedWidth:(document.querySelector('#turnstileWidget iframe') || document.querySelector('#turnstileWidget > div'))?.getBoundingClientRect().width || 0,
          loginButtonBackground:getComputedStyle(document.getElementById('lockBtn')).backgroundImage
        };
      });

      assert.strictEqual(metrics.heroCount, 1, `${viewport.width}px must not duplicate the hero`);
      assert.ok(metrics.horizontalOverflow <= 0, `${viewport.width}px has horizontal overflow`);
      assert.ok(metrics.widgetOverflow <= 0, `${viewport.width}px Turnstile container overflows`);
      assert.ok(metrics.widgetRenderedWidth > 0 && metrics.widgetRenderedWidth <= metrics.card.width, `${viewport.width}px Turnstile widget must fit the form`);
      assert.ok(metrics.logo.top >= 0, `${viewport.width}px logo is clipped at the top`);
      assert.ok(metrics.card.top >= 0 && metrics.card.bottom <= viewport.height + 1, `${viewport.width}px login card must fit the viewport`);
      assert.ok(metrics.loginButtonBackground.includes('rgb(234, 27, 35)'));
      assert.ok(metrics.loginButtonBackground.includes('rgb(208, 17, 25)'));
      assert.deepStrictEqual(pageErrors, [], `${viewport.width}px page errors: ${pageErrors.join(', ')}`);

      if(viewport.width <= 899){
        assert.strictEqual(metrics.heroDisplay, 'none', `${viewport.width}px hero must be hidden`);
        assert.ok(Math.abs(metrics.panel.width - metrics.viewportWidth) <= 1, `${viewport.width}px panel must fill the viewport`);
        assert.ok(metrics.card.left >= 19 && metrics.card.right <= metrics.viewportWidth - 19, `${viewport.width}px card must respect mobile padding`);
        assert.ok(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(metrics.cardTransform), `${viewport.width}px must not scale the desktop layout`);
      }else{
        assert.notStrictEqual(metrics.heroDisplay, 'none', 'desktop hero must remain visible');
        assert.ok(metrics.heroImage.includes('jahez-login-bsgt.png'), `desktop must use the new BSGT hero image, received ${metrics.heroImage.slice(0, 120)}`);
        assert.ok(metrics.heroBackgroundSize.endsWith('contain'), 'desktop login hero must keep the approved image sharp and uncropped');
        assert.ok(metrics.heroFillImage.includes('jahez-login-bsgt.png'), 'desktop login hero must fill its side edges from the approved image');
        assert.strictEqual(metrics.heroFillSize, 'cover', 'only the soft background layer may cover the login panel');
        assert.ok(metrics.panel.width > 0 && metrics.panel.width < metrics.viewportWidth, 'desktop login panel must keep split layout');
      }

      await page.screenshot({path:path.join(OUTPUT, `login-${viewport.width}.png`), fullPage:false});
      await page.evaluate(()=>document.getElementById('loginForm').requestSubmit());
      assert.strictEqual(
        await page.locator('#lockErr').textContent(),
        'اضغط زر تسجيل الدخول للمتابعة.',
        `${viewport.width}px programmatic/password-manager submit must not start authentication`
      );
      await context.close();
      console.log(`Login responsive ${viewport.width}px: passed`);
    }
  }finally{
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
