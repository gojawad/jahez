(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezSessionNavigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PORTAL_RETURN_KEY = 'jahez:portal-return';
  const TRANSIENT_ERROR = /failed to fetch|networkerror|network request|timeout|timed out|aborterror/i;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isTransientError(error) {
    return Boolean(error && (Number(error.status) === 0 || TRANSIENT_ERROR.test(error.message || String(error))));
  }

  function isInvalidSessionError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    return status === 401 || /invalid (?:jwt|token|session)|jwt expired|session.*not found|refresh token.*invalid/i.test(error?.message || String(error || ''));
  }

  async function restoreSession(client, options) {
    const attempts = Math.max(1, Number(options?.attempts) || 3);
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const { data, error } = await client.auth.getSession();
        if (data?.session?.user) return { status: 'authenticated', session: data.session, error: null };
        if (!error) return { status: 'unauthenticated', session: null, error: null };
        lastError = error;
        if (!isTransientError(error)) return { status: 'unauthenticated', session: null, error };
      } catch (error) {
        lastError = error;
        if (!isTransientError(error)) return { status: 'unauthenticated', session: null, error };
      }
      if (attempt < attempts - 1) await wait(450 * (attempt + 1));
    }
    return { status: 'network_error', session: null, error: lastError };
  }

  function safeInternalPath(value, origin) {
    if (!value || typeof value !== 'string') return '';
    try {
      const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://jahez.invalid');
      const target = new URL(value, baseOrigin);
      if (target.origin !== baseOrigin || target.protocol !== new URL(baseOrigin).protocol) return '';
      if (target.searchParams.get('login') === '1') return '';
      const rootRoute = target.pathname === '/' || /\/index\.html$/i.test(target.pathname);
      const standalonePortal = target.pathname.startsWith('/experiments/bs-collection/');
      if (!rootRoute && !standalonePortal) return '';
      if (rootRoute && (!target.hash || !new URLSearchParams(target.hash.slice(1)).get('v'))) return '';
      return target.pathname + target.search + target.hash;
    } catch (_) {
      return '';
    }
  }

  function buildPortalUrl(href, returnTo, origin) {
    const baseOrigin = origin || (typeof location !== 'undefined' ? location.origin : 'https://jahez.invalid');
    const target = new URL(href, baseOrigin);
    const safeReturn = safeInternalPath(returnTo, baseOrigin);
    if (safeReturn) target.searchParams.set('returnTo', safeReturn);
    return target.pathname + target.search + target.hash;
  }

  function getSafePortalReturnPath(options) {
    const currentLocation = options?.location || (typeof location !== 'undefined' ? location : null);
    const storage = options?.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const fallback = safeInternalPath(options?.fallback || '/#v=dashboard', currentLocation?.origin) || '/#v=dashboard';
    const fromQuery = currentLocation ? new URLSearchParams(currentLocation.search).get('returnTo') : '';
    const queryTarget = safeInternalPath(fromQuery, currentLocation?.origin);
    if (queryTarget) return queryTarget;
    try {
      const stored = safeInternalPath(storage?.getItem(PORTAL_RETURN_KEY), currentLocation?.origin);
      if (stored) return stored;
    } catch (_) {}
    return fallback;
  }

  function rememberPortalReturn(path, options) {
    const currentLocation = options?.location || (typeof location !== 'undefined' ? location : null);
    const storage = options?.storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    const safe = safeInternalPath(path, currentLocation?.origin);
    if (!safe) return '';
    try { storage?.setItem(PORTAL_RETURN_KEY, safe); } catch (_) {}
    return safe;
  }

  function navigateBackToJahez(options) {
    const currentLocation = options?.location || (typeof location !== 'undefined' ? location : null);
    const target = getSafePortalReturnPath(options);
    if (currentLocation && typeof currentLocation.assign === 'function') currentLocation.assign(target);
    return target;
  }

  async function fetchWithSessionRetry(client, fetcher, input, init) {
    const first = await client.auth.getSession();
    let session = first.data?.session;
    if (!session?.access_token) return { response: null, status: 'unauthenticated' };
    const send = token => fetcher(input, {
      ...(init || {}),
      headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` }
    });
    let response = await send(session.access_token);
    if (response.status !== 401) return { response, status: response.status === 403 ? 'forbidden' : 'ok' };
    const refreshed = await client.auth.refreshSession();
    session = refreshed.data?.session;
    if (refreshed.error || !session?.access_token) return { response, status: 'unauthenticated' };
    response = await send(session.access_token);
    return { response, status: response.status === 401 ? 'unauthenticated' : response.status === 403 ? 'forbidden' : 'ok' };
  }

  return Object.freeze({
    PORTAL_RETURN_KEY,
    isTransientError,
    isInvalidSessionError,
    restoreSession,
    safeInternalPath,
    buildPortalUrl,
    getSafePortalReturnPath,
    rememberPortalReturn,
    navigateBackToJahez,
    fetchWithSessionRetry
  });
});
