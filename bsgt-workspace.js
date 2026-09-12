(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JahezBsgtWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SECTIONS = Object.freeze([
    Object.freeze({
      key: 'operations',
      label: 'العمليات',
      icon: 'ship',
      permissionKey: 'bsgt.operations.view',
      editPermissionKey: 'bsgt.operations.edit',
      message: 'سيتم هنا إدارة شحنات BSGT ومرحلة تجهيز المستندات.'
    }),
    Object.freeze({
      key: 'operationCenter',
      label: 'مركز العمليات',
      icon: 'folder',
      permissionKey: 'bsgt.operation_center.view',
      message: 'متابعة عمليات بحر سواكن من مركز العمليات الموحد.'
    }),
    Object.freeze({
      key: 'finance',
      label: 'المالية',
      icon: 'bank',
      permissionKey: 'bsgt.finance.view',
      editPermissionKey: 'bsgt.finance.edit',
      message: 'سيتم هنا إنشاء وإدارة ملفات العمليات التجارية والإرسال للبنك.'
    }),
    Object.freeze({
      key: 'management',
      label: 'الإدارة',
      icon: 'shield',
      permissionKey: 'bsgt.management.view',
      editPermissionKey: 'bsgt.management.edit',
      message: 'سيتم هنا مراجعة المستندات والتوقيع والقبول النهائي.'
    }),
    Object.freeze({
      key: 'relations',
      label: 'العلاقات التجارية',
      icon: 'users',
      permissionKey: 'bsgt.relations.view',
      editPermissionKey: 'bsgt.relations.edit',
      message: 'سيتم هنا استكمال المرفقات والإرسال للبنك المحصل.'
    })
  ]);
  const SECTION_KEYS = Object.freeze(SECTIONS.map(section => section.key));
  const LEGACY_SECTION_KEYS = Object.freeze(['operations', 'finance', 'management', 'relations']);

  function normalizePermission(row) {
    const section = String(row?.section || '').trim();
    if (!LEGACY_SECTION_KEYS.includes(section) || row?.can_view === false) return null;
    return Object.freeze({
      section,
      canView: true,
      canEdit: row?.can_edit === true
    });
  }

  function resolvePermissions(profile, rows, featurePermissions) {
    if (!profile || profile.active === false) return Object.freeze([]);
    if (profile.role === 'admin') {
      return Object.freeze(SECTIONS.map(section => Object.freeze({
        section:section.key,
        canView:true,
        canEdit:Boolean(section.editPermissionKey)
      })));
    }
    if (featurePermissions && Array.isArray(featurePermissions.featureKeys)) {
      return Object.freeze(SECTIONS.map(section => {
        const canView = featurePermissions.featureKeys.includes(section.permissionKey);
        if (!canView) return null;
        return Object.freeze({
          section:section.key,
          canView:true,
          canEdit:Boolean(section.editPermissionKey && featurePermissions.featureKeys.includes(section.editPermissionKey))
        });
      }).filter(Boolean));
    }
    const canEditAssignedSection = ['editor', 'staff', 'bsgt_user'].includes(profile.role);
    const bySection = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const permission = normalizePermission(row);
      if (permission) bySection.set(permission.section, Object.freeze({
        section: permission.section,
        canView: true,
        canEdit: canEditAssignedSection && permission.canEdit
      }));
    });
    return Object.freeze(SECTION_KEYS.map(section => bySection.get(section)).filter(Boolean));
  }

  function allowedSections(profile, rows, featurePermissions) {
    const allowed = new Set(resolvePermissions(profile, rows, featurePermissions).map(permission => permission.section));
    return SECTIONS.filter(section => allowed.has(section.key));
  }

  function permissionFor(section, profile, rows, featurePermissions) {
    return resolvePermissions(profile, rows, featurePermissions).find(permission => permission.section === section) || null;
  }

  function resolveSection(requested, profile, rows, featurePermissions) {
    const allowed = allowedSections(profile, rows, featurePermissions);
    if (!allowed.length) return null;
    return allowed.find(section => section.key === requested)?.key || allowed[0].key;
  }

  function resolveBsgtCompanyId(companies) {
    const list = Array.isArray(companies) ? companies : [];
    const normalized = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const match = list.find(company => {
      const ar = normalized(company?.name_ar || company?.nameAr);
      const en = normalized(company?.name_en || company?.nameEn);
      return /بحر\s*سواكن/.test(ar) || /bahar\s*swaken/.test(en);
    });
    return match?.id || null;
  }

  return Object.freeze({
    SECTIONS,
    SECTION_KEYS,
    LEGACY_SECTION_KEYS,
    normalizePermission,
    resolvePermissions,
    allowedSections,
    permissionFor,
    resolveSection,
    resolveBsgtCompanyId
  });
});
