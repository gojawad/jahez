const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;

type EnvGetter = (name: string) => string | undefined;
type FetchLike = typeof fetch;

interface HandlerOptions {
  getEnv?: EnvGetter;
  fetchImpl?: FetchLike;
}

interface TurnstileResult {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: unknown;
}

interface DenoRuntime {
  env: { get(name: string): string | undefined };
}

function json(body: Record<string, unknown>, status: number, headers: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{...Object.fromEntries(new Headers(headers)), 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
  });
}

function defaultGetEnv(name: string) {
  const runtime = (globalThis as typeof globalThis & {Deno?: DenoRuntime}).Deno;
  return runtime?.env.get(name) || '';
}

function corsHeaders(request: Request, allowedOrigin: string): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const responseOrigin = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin':responseOrigin,
    'Access-Control-Allow-Headers':'apikey, authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin'
  };
}

function clientIp(request: Request) {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return (request.headers.get('cf-connecting-ip') || forwarded || '').slice(0, 80);
}

export function createVerifyTurnstileHandler(options: HandlerOptions = {}) {
  const getEnv = options.getEnv || defaultGetEnv;
  const fetchImpl = options.fetchImpl || fetch;

  return async function handleVerifyTurnstile(request: Request) {
    const siteKey = String(getEnv('TURNSTILE_SITE_KEY') || '').trim();
    const secretKey = String(getEnv('TURNSTILE_SECRET_KEY') || '').trim();
    const expectedHostname = String(getEnv('TURNSTILE_EXPECTED_HOSTNAME') || 'jahez.swaken.net').trim();
    const allowedOrigin = String(getEnv('TURNSTILE_ALLOWED_ORIGIN') || 'https://jahez.swaken.net').trim();
    const headers = corsHeaders(request, allowedOrigin);

    if(request.method === 'OPTIONS') return new Response(null, {status:204, headers});

    const origin = request.headers.get('origin') || '';
    if(origin && origin !== allowedOrigin){
      return json({success:false}, 403, headers);
    }

    if(!siteKey || !secretKey){
      console.error('Turnstile environment variables are missing.');
      return json({success:false, enabled:false}, 503, headers);
    }

    if(request.method === 'GET'){
      return json({enabled:true, siteKey}, 200, headers);
    }
    if(request.method !== 'POST'){
      return json({success:false}, 405, {...headers, Allow:'GET, POST, OPTIONS'});
    }

    let payload: {token?: unknown};
    try{ payload = await request.json(); }
    catch{ return json({success:false}, 400, headers); }
    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    if(!token || token.length > MAX_TOKEN_LENGTH){
      return json({success:false}, 400, headers);
    }

    const form = new URLSearchParams({secret:secretKey, response:token});
    const remoteIp = clientIp(request);
    if(remoteIp) form.set('remoteip', remoteIp);
    form.set('idempotency_key', crypto.randomUUID());

    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 8000);
    try{
      const response = await fetchImpl(SITEVERIFY_URL, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:form.toString(),
        signal:controller.signal
      });
      if(!response.ok) throw new Error(`Siteverify returned ${response.status}`);
      const result = await response.json() as TurnstileResult;
      const hostnameMatches = !expectedHostname || result.hostname === expectedHostname;
      const actionMatches = result.action === 'login';
      if(result.success === true && hostnameMatches && actionMatches){
        return json({success:true}, 200, headers);
      }
      console.warn('Turnstile validation rejected.', {
        hostname:result.hostname || '',
        action:result.action || '',
        errorCodes:Array.isArray(result['error-codes']) ? result['error-codes'] : []
      });
      return json({success:false}, 403, headers);
    }catch(error){
      const message = error instanceof Error ? error.message : 'unknown error';
      console.error('Turnstile siteverify request failed:', message);
      return json({success:false}, 502, headers);
    }finally{
      clearTimeout(timeout);
    }
  };
}

export default {fetch:createVerifyTurnstileHandler()};
