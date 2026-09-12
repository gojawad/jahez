(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezPortalAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACCESS_MESSAGE_KEY = 'jahez:portal-access-message';

  const PORTALS = Object.freeze({
    commercial_collection: Object.freeze({
      key: 'commercial_collection',
      label: 'بوابة التحصيل التجاري',
      href: '/experiments/bs-collection/',
      icon: 'bank',
      allowedRoles: Object.freeze(['admin', 'editor', 'staff', 'viewer', 'bsgt_user'])
    }),
    import_permit: Object.freeze({
      key: 'import_permit',
      label: 'فاتورة إذن الاستيراد',
      href: '/?portal=import-permit-records&permitView=history#v=bsgt',
      icon: 'invoice',
      allowedRoles: Object.freeze(['admin', 'editor', 'staff', 'bsgt_user'])
    })
  });

  // Kept for migration/backfill compatibility. Runtime navigation resolves
  // registered portals directly so a new portal only needs one registration.
  const ROLE_PORTALS = Object.freeze({
    admin: Object.freeze(['commercial_collection', 'import_permit']),
    editor: Object.freeze(['import_permit']),
    staff: Object.freeze(['import_permit']),
    viewer: Object.freeze([]),
    bsgt_user: Object.freeze(['commercial_collection'])
  });

  const VALID_ROLES = Object.freeze(Object.keys(ROLE_PORTALS));

  function activeProfile(profile) {
    return Boolean(profile && profile.active !== false && typeof profile.role === 'string');
  }

  function hasExplicitPermission(portalKey, permissions) {
    if (!permissions) return false;
    if (Array.isArray(permissions.featureKeys)) return permissions.featureKeys.includes(`${portalKey}.view`);
    return Array.isArray(permissions.portalKeys) && permissions.portalKeys.includes(portalKey);
  }

  function isAdmin(profile) {
    return activeProfile(profile) && profile.role === 'admin';
  }

  function canAccessPortal(portalKey, profile, permissions) {
    const portal = PORTALS[portalKey];
    if (!portal || !activeProfile(profile)) return false;
    if (isAdmin(profile)) return true;
    if (!VALID_ROLES.includes(profile.role)) return false;
    return hasExplicitPermission(portalKey, permissions);
  }

  function publicPortal(portal) {
    return portal ? {
      key: portal.key,
      label: portal.label,
      href: portal.href,
      icon: portal.icon,
      allowed: true
    } : null;
  }

  function resolveUserPortals(profile, permissions) {
    if (!activeProfile(profile)) return [];
    return Object.keys(PORTALS)
      .filter(key => canAccessPortal(key, profile, permissions))
      .map(key => publicPortal(PORTALS[key]));
  }

  function resolveUserPortal(profile, permissions) {
    return resolveUserPortals(profile, permissions)[0] || null;
  }

  return Object.freeze({
    ACCESS_MESSAGE_KEY,
    PORTALS,
    ROLE_PORTALS,
    VALID_ROLES,
    isAdmin,
    canAccessPortal,
    resolveUserPortal,
    resolveUserPortals
  });
});
