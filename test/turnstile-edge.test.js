'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const FUNCTION_PATH = path.join(__dirname, '..', 'supabase', 'functions', 'verify-turnstile', 'index.ts');
const ALLOWED_ORIGIN = 'https://jahez.swaken.net';

function env(overrides = {}) {
  const values = {
    TURNSTILE_SITE_KEY:'test-site-key',
    TURNSTILE_SECRET_KEY:'test-secret-key',
    TURNSTILE_EXPECTED_HOSTNAME:'jahez.swaken.net',
    TURNSTILE_ALLOWED_ORIGIN:ALLOWED_ORIGIN,
    ...overrides
  };
  return name => values[name] || '';
}

function request(method, body) {
  return new Request('https://example.supabase.co/functions/v1/verify-turnstile', {
    method,
    headers:{origin:ALLOWED_ORIGIN, 'content-type':'application/json', 'x-forwarded-for':'203.0.113.10'},
    body:body === undefined ? undefined : JSON.stringify(body)
  });
}

async function main() {
  const { createVerifyTurnstileHandler } = await import(pathToFileURL(FUNCTION_PATH).href);

  let siteverifyBody = '';
  const successHandler = createVerifyTurnstileHandler({
    getEnv:env(),
    fetchImpl:async (url, options) => {
      assert.strictEqual(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      siteverifyBody = options.body;
      return new Response(JSON.stringify({success:true, hostname:'jahez.swaken.net', action:'login'}), {status:200});
    }
  });

  const configResponse = await successHandler(request('GET'));
  assert.strictEqual(configResponse.status, 200);
  assert.deepStrictEqual(await configResponse.json(), {enabled:true, siteKey:'test-site-key'});

  const successResponse = await successHandler(request('POST', {token:'valid-token'}));
  assert.strictEqual(successResponse.status, 200);
  assert.deepStrictEqual(await successResponse.json(), {success:true});
  const sent = new URLSearchParams(siteverifyBody);
  assert.strictEqual(sent.get('secret'), 'test-secret-key');
  assert.strictEqual(sent.get('response'), 'valid-token');
  assert.strictEqual(sent.get('remoteip'), '203.0.113.10');

  const failedHandler = createVerifyTurnstileHandler({
    getEnv:env(),
    fetchImpl:async () => new Response(JSON.stringify({success:false, 'error-codes':['invalid-input-response']}), {status:200})
  });
  assert.strictEqual((await failedHandler(request('POST', {token:'bad-token'}))).status, 403);

  const wrongHostHandler = createVerifyTurnstileHandler({
    getEnv:env(),
    fetchImpl:async () => new Response(JSON.stringify({success:true, hostname:'attacker.example', action:'login'}), {status:200})
  });
  assert.strictEqual((await wrongHostHandler(request('POST', {token:'wrong-host'}))).status, 403);

  const missingHandler = createVerifyTurnstileHandler({getEnv:env({TURNSTILE_SECRET_KEY:''})});
  assert.strictEqual((await missingHandler(request('GET'))).status, 503);
  assert.strictEqual((await successHandler(request('POST', {}))).status, 400);

  console.log('Turnstile Edge Function: success, failure, hostname, and missing-config checks passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
