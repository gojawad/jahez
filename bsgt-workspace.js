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
      key: 'financialCenter',
      label: 'المركز المالي',
      icon: 'bank',
      permissionKey: 'bsgt.financial_center.view',
      editPermissionKey: 'bsgt.financial_center.edit',
      message: 'إدارة الحسابات والتكاليف والتحصيلات المرتبطة بالعمليات'
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
    }),
    Object.freeze({
      key: 'tradeFiles',
      label: 'ملفات العمليات التجارية',
      icon: 'briefcase',
      permissionKeys: ['bsgt.finance.view', 'bsgt.management.view', 'bsgt.relations.view'],
      message: 'سجل ملفات العمليات التجارية وتفاصيلها ومستنداتها للعرض فقط.'
    }),
    Object.freeze({
      key: 'bankSent',
      label: 'الملفات المُرسلة للبنك',
      icon: 'plane',
      permissionKey: 'bsgt.bank_sent.view',
      message: 'سجل الإرسال للبنك والبحث حسب البنك والعميل.'
    }),
    Object.freeze({
      key: 'operationCenter',
      label: 'مركز العمليات',
      icon: 'folder',
      permissionKey: 'bsgt.operation_center.view',
      message: 'متابعة عمليات بحر سواكن من مركز العمليات الموحد.'
    }),
    Object.freeze({
      key: 'archiveCenter',
      label: 'مركز الأرشيف',
      icon: 'archive',
      // Reuses the existing archive permission; no new permission key is introduced.
      permissionKey: 'shipments.delete',
      message: 'الشحنات والملفات التجارية والمستندات الموقّعة المؤرشفة، بلا حذف وقابلة للاستعادة.'
    })
  ]);
  const SECTION_KEYS = Object.freeze(SECTIONS.map(section => section.key));
  // Sections that never become the default landing section: users keep opening the
  // same first section as before when anything else is available to them.
  const NON_DEFAULT_SECTION_KEYS = Object.freeze(['financialCenter', 'archiveCenter']);
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
        const canView = (section.permissionKeys || [section.permissionKey]).some(key => featurePermissions.featureKeys.includes(key));
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
    if (['finance','management','relations'].some(section => bySection.has(section))) {
      bySection.set('tradeFiles', Object.freeze({section:'tradeFiles',canView:true,canEdit:false}));
    }
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
    // The financial center never becomes the default landing section when another
    // section is available: users keep opening the same first section as before.
    return allowed.find(section => section.key === requested)?.key
      || allowed.find(section => !NON_DEFAULT_SECTION_KEYS.includes(section.key))?.key
      || allowed[0].key;
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
    NON_DEFAULT_SECTION_KEYS,
    LEGACY_SECTION_KEYS,
    normalizePermission,
    resolvePermissions,
    allowedSections,
    permissionFor,
    resolveSection,
    resolveBsgtCompanyId
  });
});
