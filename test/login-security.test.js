'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const nativeFetch = global.fetch;
const rateFile = path.join(os.tmpdir(), `jahez-login-rate-${process.pid}.json`);

process.env.NODE_ENV = 'test';
process.env.TURNSTILE_SITE_KEY = 'site-key-for-test';
process.env.TURNSTILE_SECRET_KEY = 'secret-key-for-test';
process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
process.env.LOGIN_RATE_LIMIT_FILE = rateFile;

global.fetch = async (url, options = {}) => {
  if (String(url).includes('challenges.cloudflare.com')) {
    const token = new URLSearchParams(String(options.body || '')).get('response');
    return new Response(JSON.stringify({ success: token === 'valid-turnstile', hostname: 'localhost' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  if (String(url).includes('/auth/v1/token')) {
    const body = JSON.parse(String(options.body || '{}'));
    if (body.password !== 'correct-password') {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    return new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user-1', email: body.email }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

const loginSecurity = require('../api/login-security');

function adaptResponse(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
}

async function main() {
  const server = http.createServer((req, res) => {
    adaptResponse(res);
    loginSecurity(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (email, password, turnstileToken = 'valid-turnstile') => nativeFetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, turnstileToken })
  });

  try {
    const configResponse = await nativeFetch(base);
    const config = await configResponse.json();
    assert.strictEqual(configResponse.status, 200);
    assert.deepStrictEqual(config, {
      enabled: true,
      siteKey: 'site-key-for-test',
      developmentBypass: false
    });

    const challengeFailure = await post('challenge@example.com', 'correct-password', 'invalid-turnstile');
    assert.strictEqual(challengeFailure.status, 400);

    const success = await post('success@example.com', 'correct-password');
    const successBody = await success.json();
    assert.strictEqual(success.status, 200);
    assert.strictEqual(successBody.session.user.email, 'success@example.com');

    for (let attempt = 1; attempt <= 4; attempt++) {
      const failure = await post('limited@example.com', 'wrong-password');
      const failureBody = await failure.json();
      assert.strictEqual(failure.status, 401);
      assert.strictEqual(failureBody.error, 'بيانات الدخول غير صحيحة.');
    }
    const fifthFailure = await post('limited@example.com', 'wrong-password');
    assert.strictEqual(fifthFailure.status, 429);
    assert.ok(Number(fifthFailure.headers.get('retry-after')) > 0);

    const blocked = await post('limited@example.com', 'correct-password');
    assert.strictEqual(blocked.status, 429);
    console.log('✔ login security verifies Turnstile and returns a Supabase session');
    console.log('✔ login security rate-limits five failed attempts with HTTP 429');
  } finally {
    await new Promise(resolve => server.close(resolve));
    global.fetch = nativeFetch;
    await fs.promises.rm(rateFile, { force: true });
  }
}

main().catch(error => {
  global.fetch = nativeFetch;
  console.error(error);
  process.exitCode = 1;
});
