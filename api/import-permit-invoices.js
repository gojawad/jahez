'use strict';

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DATA_DIR = process.env.JAHEZ_DATA_DIR || path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'import-permit-invoices.json');
const ALLOWED_ROLES = new Set(['admin', 'editor', 'staff', 'bsgt_user']);
const MAX_ITEMS = 10;
let writeQueue = Promise.resolve();

function readRequestBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body));
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 250_000) reject(Object.assign(new Error('Request too large.'), { status: 413 }));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function serviceHeaders() {
  const headers = { apikey: SERVICE_KEY };
  if (!SERVICE_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

async function authorize(req) {
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('يلزم تسجيل الدخول.'), { status: 401 });
  if (!SERVICE_KEY) throw Object.assign(new Error('خدمة الحفظ غير مضبوطة على الخادم.'), { status: 503 });

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${match[1]}` }
  });
  if (!userResponse.ok) throw Object.assign(new Error('انتهت جلسة الدخول. سجّل الدخول مرة أخرى.'), { status: 401 });
  const user = await userResponse.json();
  const profileQuery = new URLSearchParams({ select: 'id,email,display_name,role,active', id: `eq.${user.id}`, limit: '1' });
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${profileQuery}`, { headers: serviceHeaders() });
  if (!profileResponse.ok) throw new Error(`Profile lookup failed (${profileResponse.status}).`);
  const [profile] = await profileResponse.json();
  if (!profile || profile.active === false || !ALLOWED_ROLES.has(profile.role)) {
    throw Object.assign(new Error('ليست لديك صلاحية استخدام بوابة فاتورة إذن الاستيراد.'), { status: 403 });
  }
  return profile;
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(STORE_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveStore(records) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(tempPath, STORE_PATH);
}

const cleanText = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const cleanNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

function normalizePayload(input) {
  const data = input && typeof input === 'object' ? input : {};
  const items = Array.isArray(data.items) ? data.items.slice(0, MAX_ITEMS).map(item => ({
    commodityId: cleanText(item.commodityId, 30),
    description: cleanText(item.description, 250),
    category: cleanText(item.category, 180),
    hsCode: cleanText(item.hsCode, 12),
    unit: cleanText(item.unit, 8),
    quantity: cleanNumber(item.quantity),
    amount: cleanNumber(item.amount)
  })) : [];
  if (!cleanText(data.proformaNo, 50) || !/^\d{4}-\d{2}-\d{2}$/.test(cleanText(data.proformaDate, 10))) {
    throw Object.assign(new Error('رقم وتاريخ الفاتورة مطلوبان.'), { status: 400 });
  }
  if (!cleanText(data.consignee) || !cleanText(data.consigneeAddress) || !cleanText(data.portDischarge) || !cleanText(data.countryOrigin)) {
    throw Object.assign(new Error('بيانات المرسل إليه والوصول وبلد المنشأ مطلوبة.'), { status: 400 });
  }
  if (!items.length || items.some(item => !item.commodityId || !item.description || !/^\d{6,10}$/.test(item.hsCode) || !item.unit || !item.quantity || !item.amount)) {
    throw Object.assign(new Error('بيانات السلع غير مكتملة أو غير صحيحة.'), { status: 400 });
  }
  return {
    proformaNo: cleanText(data.proformaNo, 50),
    proformaDate: cleanText(data.proformaDate, 10),
    consignee: cleanText(data.consignee),
    consigneeAddress: cleanText(data.consigneeAddress, 800),
    portDischarge: cleanText(data.portDischarge),
    countryOrigin: cleanText(data.countryOrigin),
    currency: cleanText(data.currency, 8).toUpperCase(),
    incoterm: cleanText(data.incoterm),
    paymentTerm: cleanText(data.paymentTerm, 500),
    bankId: cleanText(data.bankId, 80),
    weight: cleanText(data.weight, 100),
    items
  };
}

function nextReference(records) {
  const year = new Date().getFullYear();
  const prefix = `BSGT-IP-${year}-`;
  const sequence = records.reduce((max, record) => {
    const match = String(record.reference || '').match(new RegExp(`^${prefix}(\\d{4,})$`));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

function publicRecord(record) {
  return {
    id: record.id,
    reference: record.reference,
    ownerId: record.ownerId,
    ownerName: record.ownerName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    data: record.data
  };
}

async function saveInvoice(profile, body) {
  const payload = normalizePayload(body.data);
  const requestedId = cleanText(body.id, 80);
  let result;
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const records = await loadStore();
    const now = new Date().toISOString();
    if (requestedId) {
      const index = records.findIndex(record => record.id === requestedId);
      if (index < 0) throw Object.assign(new Error('الفاتورة المحفوظة غير موجودة.'), { status: 404 });
      if (profile.role !== 'admin' && records[index].ownerId !== profile.id) {
        throw Object.assign(new Error('لا يمكنك تعديل فاتورة أنشأها مستخدم آخر.'), { status: 403 });
      }
      records[index] = { ...records[index], data: payload, updatedAt: now };
      result = publicRecord(records[index]);
    } else {
      const record = {
        id: globalThis.crypto.randomUUID(),
        reference: nextReference(records),
        ownerId: profile.id,
        ownerName: cleanText(profile.display_name || profile.email, 160),
        createdAt: now,
        updatedAt: now,
        data: payload
      };
      records.push(record);
      result = publicRecord(record);
    }
    await saveStore(records);
  });
  await writeQueue;
  return result;
}

module.exports = async function importPermitInvoices(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const profile = await authorize(req);
    if (req.method === 'GET') {
      const records = (await loadStore())
        .filter(record => profile.role === 'admin' || record.ownerId === profile.id)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map(publicRecord);
      return res.status(200).json({ records });
    }
    if (req.method === 'POST') {
      const body = await readRequestBody(req);
      const record = await saveInvoice(profile, body);
      return res.status(200).json({ record });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('import permit invoices', error);
    return res.status(status).json({ error: status >= 500 ? 'تعذر حفظ فواتير إذن الاستيراد الآن.' : error.message });
  }
};
