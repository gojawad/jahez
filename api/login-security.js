'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_EXPECTED_HOSTNAME = process.env.TURNSTILE_EXPECTED_HOSTNAME || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.JAHEZ_DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = process.env.LOGIN_RATE_LIMIT_FILE || path.join(DATA_DIR, 'login-rate-limits.json');
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_BODY_BYTES = 20_000;

let writeQueue = Promise.resolve();

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch { return Promise.reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error('Request too large.'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const cloudflareIp = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cloudflareIp) return cloudflareIp.slice(0, 80);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.socket?.remoteAddress || 'unknown').slice(0, 80);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').slice(0, 320);
}

function rateKey(ip, email) {
  return crypto.createHash('sha256').update(`${ip}\0${email}`).digest('hex');
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(STORE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object'
      ? parsed
      : { version: 1, entries: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, entries: {} };
    throw error;
  }
}

async function saveStore(store) {
  await fs.promises.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(tempPath, STORE_PATH);
}

function pruneStore(store, now) {
  for (const [key, entry] of Object.entries(store.entries)) {
    const failures = Array.isArray(entry.failures)
      ? entry.failures.filter(value => Number.isFinite(value) && value > now - WINDOW_MS)
      : [];
    const blockedUntil = Number(entry.blockedUntil) || 0;
    if (!failures.length && blockedUntil <= now) delete store.entries[key];
    else store.entries[key] = { failures, blockedUntil };
  }
}

async function mutateStore(mutator) {
  let result;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const store = await loadStore();
    const now = Date.now();
    pruneStore(store, now);
    result = await mutator(store, now);
    await saveStore(store);
  });
  await writeQueue;
  return result;
}

async function checkRateLimit(key) {
  return mutateStore((store, now) => {
    const entry = store.entries[key] || { failures: [], blockedUntil: 0 };
    const retryAfterMs = Math.max(0, Number(entry.blockedUntil || 0) - now);
    return { limited: retryAfterMs > 0, retryAfterMs };
  });
}

async function recordFailure(key) {
  return mutateStore((store, now) => {
    const entry = store.entries[key] || { failures: [], blockedUntil: 0 };
    entry.failures.push(now);
    if (entry.failures.length >= MAX_FAILURES) entry.blockedUntil = now + BLOCK_MS;
    store.entries[key] = entry;
    return {
      limited: entry.blockedUntil > now,
      retryAfterMs: Math.max(0, entry.blockedUntil - now)
    };
  });
}

async function clearFailures(key) {
  return mutateStore(store => { delete store.entries[key]; });
}

async function verifyTurnstile(token, ip) {
  const form = new URLSearchParams({
    secret: TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: ip
  });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) return false;
  const result = await response.json();
  if (!result.success) return false;
  return !TURNSTILE_EXPECTED_HOSTNAME || result.hostname === TURNSTILE_EXPECTED_HOSTNAME;
}

async function authenticateWithSupabase(email, password, captchaToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      gotrue_meta_security: { captcha_token: captchaToken }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data.access_token || !data.refresh_token || !data.user) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
    token_type: data.token_type,
    user: data.user
  };
}

function configuration() {
  const enabled = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY && SUPABASE_KEY);
  return {
    enabled,
    siteKey: enabled ? TURNSTILE_SITE_KEY : '',
    developmentBypass: !IS_PRODUCTION && !enabled
  };
}

module.exports = async function loginSecurity(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method === 'GET') return res.status(200).json(configuration());
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const config = configuration();
    if (!config.enabled) {
      return res.status(503).json({ error: 'حماية تسجيل الدخول غير مهيأة على الخادم.' });
    }

    const body = await readRequestBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const token = String(body.turnstileToken || '').trim().slice(0, 4096);
    if (!email || !password || password.length > 4096 || !token) {
      return res.status(400).json({ error: 'تعذر التحقق من طلب تسجيل الدخول.' });
    }

    const ip = clientIp(req);
    const key = rateKey(ip, email);
    const currentLimit = await checkRateLimit(key);
    if (currentLimit.limited) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(currentLimit.retryAfterMs / 1000))));
      return res.status(429).json({ error: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.' });
    }

    let turnstileValid = false;
    try { turnstileValid = await verifyTurnstile(token, ip); }
    catch { return res.status(503).json({ error: 'تعذر تشغيل التحقق الأمني الآن. حاول بعد قليل.' }); }
    if (!turnstileValid) {
      return res.status(400).json({ error: 'لم يكتمل التحقق الأمني. أعد المحاولة.' });
    }

    let session;
    try { session = await authenticateWithSupabase(email, password, token); }
    catch { return res.status(503).json({ error: 'تعذر الاتصال بخدمة الدخول الآن. حاول بعد قليل.' }); }
    if (!session) {
      const failure = await recordFailure(key);
      if (failure.limited) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(failure.retryAfterMs / 1000))));
        return res.status(429).json({ error: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.' });
      }
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    await clearFailures(key);
    return res.status(200).json({ session });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      error: status >= 500 ? 'تعذر تسجيل الدخول الآن. حاول بعد قليل.' : 'تعذر التحقق من طلب تسجيل الدخول.'
    });
  }
};

module.exports._test = {
  normalizeEmail,
  rateKey,
  pruneStore,
  configuration,
  constants: { WINDOW_MS, BLOCK_MS, MAX_FAILURES }
};
