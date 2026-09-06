// يحوّل HTML فاتورة بحر سواكن إلى PDF حقيقي بمحرك طباعة Chrome.
//
// على Vercel كان هذا يعتمد على خدمة Browserless المدفوعة. على الاستضافة الذاتية
// يُستخدم Chromium المثبت داخل الحاوية مباشرة، ويبقى Browserless خياراً بديلاً
// عند ضبط BROWSERLESS_TOKEN.

const DEFAULT_BROWSERLESS_PDF_ENDPOINT = 'https://production-sfo.browserless.io/pdf';
const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' }
};

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body));
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON request body.')); }
    });
    req.on('error', reject);
  });
}

async function renderWithBrowserless(html, token) {
  const endpoint = String(process.env.BROWSERLESS_PDF_ENDPOINT || DEFAULT_BROWSERLESS_PDF_ENDPOINT).replace(/\/$/, '');
  const response = await fetch(`${endpoint}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, options: PDF_OPTIONS })
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Browserless PDF failed (${response.status}): ${details || response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// متصفح واحد مشترك يُفتح عند أول طلب ويُعاد استخدامه.
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require('playwright-core');
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }).then(browser => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }, error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function renderLocally(html) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // networkidle حتى تُحمَّل الخطوط الخارجية قبل الطباعة.
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 60000 });
    await page.emulateMedia({ media: 'print' });
    return await page.pdf(PDF_OPTIONS);
  } finally {
    await context.close();
  }
}

module.exports = async function renderBsgtPdf(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const { html } = await readRequestBody(req);
    if (typeof html !== 'string' || !html.trim()) {
      return res.status(400).json({ error: 'Invoice HTML is required.' });
    }
    if (html.length > 2_000_000) {
      return res.status(413).json({ error: 'Invoice HTML is too large to render.' });
    }

    const token = process.env.BROWSERLESS_TOKEN;
    const pdf = token ? await renderWithBrowserless(html, token) : await renderLocally(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('BSGT PDF render failed:', error.message);
    return res.status(502).json({ error: 'Could not render the BSGT invoice PDF.' });
  }
};
