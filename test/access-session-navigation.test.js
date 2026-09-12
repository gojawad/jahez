'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const access = require('../portal-access');
const navigation = require('../session-navigation');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const permit = fs.readFileSync(path.join(root, 'import-permit.js'), 'utf8');
const collection = fs.readFileSync(path.join(root, 'experiments', 'bs-collection', 'collection-lab.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'import-permit-invoices.js'), 'utf8');

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`✔ ${name}`);
}

const profile = role => ({id:`${role}-id`, role, active:true});

(async () => {
  await check('admin can access import permit without assignments', () => assert.strictEqual(access.canAccessPortal('import_permit', profile('admin'), {portalKeys:[]}), true));
  await check('admin can access commercial collection without assignments', () => assert.strictEqual(access.canAccessPortal('commercial_collection', profile('admin')), true));
  await check('admin resolves every registered portal', () => assert.deepStrictEqual(access.resolveUserPortals(profile('admin')).map(item=>item.key), Object.keys(access.PORTALS)));
  await check('unknown portals remain denied for admin', () => assert.strictEqual(access.canAccessPortal('unknown', profile('admin')), false));
  await check('inactive admin is denied', () => assert.strictEqual(access.canAccessPortal('import_permit', {...profile('admin'),active:false}), false));
  await check('assigned employee can enter import permit', () => assert.strictEqual(access.canAccessPortal('import_permit', profile('staff'), {portalKeys:['import_permit']}), true));
  await check('unassigned employee cannot enter import permit', () => assert.strictEqual(access.canAccessPortal('import_permit', profile('staff'), {portalKeys:[]}), false));
  await check('role boundary still rejects unknown assigned roles', () => assert.strictEqual(access.canAccessPortal('commercial_collection', profile('unknown'), {portalKeys:['commercial_collection']}), false));
  await check('assigned finance viewer can retain collection preview access', () => assert.strictEqual(access.canAccessPortal('commercial_collection', profile('viewer'), {portalKeys:['commercial_collection']}), true));
  await check('missing employee permissions are fail closed', () => assert.strictEqual(access.canAccessPortal('import_permit', profile('editor')), false));

  await check('same-origin dashboard return is accepted', () => assert.strictEqual(navigation.safeInternalPath('/#v=dashboard','https://jahez.swaken.net'), '/#v=dashboard'));
  await check('same-origin BSGT finance return is accepted', () => assert.strictEqual(navigation.safeInternalPath('/#v=bsgtWorkspace&section=finance','https://jahez.swaken.net'), '/#v=bsgtWorkspace&section=finance'));
  await check('route ids are preserved', () => assert.strictEqual(navigation.safeInternalPath('/#v=clientProfiles&id=abc','https://jahez.swaken.net'), '/#v=clientProfiles&id=abc'));
  await check('trade file query is preserved', () => assert.strictEqual(navigation.safeInternalPath('/experiments/bs-collection/?tradeFileId=abc','https://jahez.swaken.net'), '/experiments/bs-collection/?tradeFileId=abc'));
  await check('external return target is rejected', () => assert.strictEqual(navigation.safeInternalPath('https://evil.example/#v=dashboard','https://jahez.swaken.net'), ''));
  await check('login return target is rejected', () => assert.strictEqual(navigation.safeInternalPath('/?login=1#v=dashboard','https://jahez.swaken.net'), ''));
  await check('landing page is not accepted as portal return', () => assert.strictEqual(navigation.safeInternalPath('/','https://jahez.swaken.net'), ''));
  await check('portal url carries encoded safe returnTo', () => assert.match(navigation.buildPortalUrl('/experiments/bs-collection/?tradeFileId=x','/#v=bsgtWorkspace&section=finance','https://jahez.swaken.net'), /returnTo=%2F%23v%3DbsgtWorkspace%26section%3Dfinance/));
  await check('unsafe returnTo falls back to dashboard', () => {
    const location={origin:'https://jahez.swaken.net',search:'?returnTo=https%3A%2F%2Fevil.example',assign(){}};
    assert.strictEqual(navigation.getSafePortalReturnPath({location,storage:null}), '/#v=dashboard');
  });
  await check('safe return navigation never uses browser history', () => {
    let assigned='';
    const location={origin:'https://jahez.swaken.net',search:'?returnTo=%2F%23v%3DbsgtWorkspace%26section%3Dfinance',assign:value=>{assigned=value;}};
    assert.strictEqual(navigation.navigateBackToJahez({location,storage:null}), '/#v=bsgtWorkspace&section=finance');
    assert.strictEqual(assigned, '/#v=bsgtWorkspace&section=finance');
  });

  await check('valid cached session restores as authenticated', async () => {
    const client={auth:{getSession:async()=>({data:{session:{user:{id:'u'},access_token:'a'}},error:null})}};
    assert.strictEqual((await navigation.restoreSession(client)).status, 'authenticated');
  });
  await check('missing session restores as unauthenticated', async () => {
    const client={auth:{getSession:async()=>({data:{session:null},error:null})}};
    assert.strictEqual((await navigation.restoreSession(client)).status, 'unauthenticated');
  });
  await check('transient session failure is retried', async () => {
    let calls=0;
    const client={auth:{getSession:async()=>++calls<2?Promise.reject(new Error('Failed to fetch')):({data:{session:{user:{id:'u'}}},error:null})}};
    assert.strictEqual((await navigation.restoreSession(client,{attempts:2})).status, 'authenticated');
    assert.strictEqual(calls,2);
  });
  await check('persistent network failure does not become unauthenticated', async () => {
    const client={auth:{getSession:async()=>Promise.reject(new Error('NetworkError'))}};
    assert.strictEqual((await navigation.restoreSession(client,{attempts:2})).status, 'network_error');
  });
  await check('invalid session errors are recognized', () => assert.strictEqual(navigation.isInvalidSessionError({status:401,message:'invalid token'}), true));

  await check('API 401 refreshes once and retries once', async () => {
    let requests=0,refreshes=0;
    const client={auth:{getSession:async()=>({data:{session:{access_token:'old'}}}),refreshSession:async()=>{refreshes++;return {data:{session:{access_token:'new'}},error:null};}}};
    const result=await navigation.fetchWithSessionRetry(client,async()=>({status:++requests===1?401:200}),'/api/test',{method:'GET'});
    assert.strictEqual(result.status,'ok'); assert.strictEqual(requests,2); assert.strictEqual(refreshes,1);
  });
  await check('API 403 does not refresh or sign out', async () => {
    let refreshes=0;
    const client={auth:{getSession:async()=>({data:{session:{access_token:'token'}}}),refreshSession:async()=>{refreshes++;}}};
    const result=await navigation.fetchWithSessionRetry(client,async()=>({status:403}),'/api/test',{method:'GET'});
    assert.strictEqual(result.status,'forbidden'); assert.strictEqual(refreshes,0);
  });
  await check('failed refresh stops before a duplicate retry', async () => {
    let requests=0;
    const client={auth:{getSession:async()=>({data:{session:{access_token:'old'}}}),refreshSession:async()=>({data:{session:null},error:new Error('invalid refresh token')})}};
    const result=await navigation.fetchWithSessionRetry(client,async()=>{requests++;return {status:401};},'/api/write',{method:'POST'});
    assert.strictEqual(result.status,'unauthenticated'); assert.strictEqual(requests,1);
  });

  await check('admin app views use a registered allow-list bypass', () => {
    assert.ok(app.includes('if(isAdmin()) return true;'));
    assert.ok(app.includes('if(!currentUser || !isRegisteredAppView(view)) return false;'));
    assert.ok(app.includes("document.getElementById(id)?.classList.contains('view')"));
  });
  await check('session events only react to SIGNED_OUT', () => assert.ok(app.includes("if(event !== 'SIGNED_OUT' || session) return;")));
  await check('refresh restores the current hash rather than dashboard', () => assert.ok(app.includes('restoreAuthenticatedLocation();')));
  await check('profile network failure does not sign out', () => assert.ok(!app.includes("if(!netIssue) await sb.auth.signOut()")));
  await check('import permit waits for access readiness without polling', () => {
    assert.ok(permit.includes('await window.JahezAccess.ready()'));
    assert.ok(!permit.includes('setInterval(() =>'));
  });
  await check('collection back uses safe return navigation', () => {
    assert.ok(collection.includes('navigateBackToJahez'));
    assert.ok(!collection.includes('window.history.back()'));
  });
  await check('collection network errors do not redirect to login', () => assert.ok(collection.includes("if(auth.status==='network_error'){ showPortalSessionRecovery")));
  await check('import permit API grants admin before assignment lookup', () => {
    assert.ok(api.indexOf("if (profile.role === 'admin') return profile") < api.indexOf('user_portal_permissions'));
  });
  await check('import permit API enforces employee assignment', () => assert.ok(api.includes("portal_key: 'eq.import_permit'")));

  assert.ok(checks >= 35);
  console.log(`\n${checks} access, session and navigation checks passed`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
