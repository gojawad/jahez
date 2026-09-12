(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.JAHEZ_PERMISSION_REGISTRY = api.REGISTRY;
    root.JahezPermissions = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REGISTRY = Object.freeze([
    Object.freeze({
      key: 'general', label: 'الصلاحيات العامة', description: 'الوصول إلى العمليات والشحنات وبروفايلات الشركات.', icon: 'shield',
      permissions: Object.freeze([
        Object.freeze({key:'operations_center.view', label:'مركز العمليات', description:'عرض مركز العمليات العام.'}),
        Object.freeze({key:'shipments.create', label:'إنشاء شحنة', description:'إنشاء شحنات جديدة.'}),
        Object.freeze({key:'shipments.edit', label:'تعديل الشحنات', description:'تعديل بيانات الشحنات الحالية.', dependsOn:Object.freeze([])}),
        Object.freeze({key:'shipments.delete', label:'حذف الشحنات', description:'حذف شحنة وفق قواعد النظام الحالية.', sensitive:true}),
        Object.freeze({key:'client_profiles.view', label:'بروفايل الشركات', description:'مشاهدة بروفايلات الشركات وملفاتها.'}),
        Object.freeze({key:'client_profiles.edit', label:'تعديل بروفايل الشركات', description:'رفع وتعديل وأرشفة بيانات وملفات الشركات.', dependsOn:Object.freeze(['client_profiles.view'])})
      ])
    }),
    Object.freeze({
      key: 'portals', label: 'بوابات النظام', description: 'الدخول إلى البوابات المتخصصة.', icon: 'grid',
      permissions: Object.freeze([
        Object.freeze({key:'import_permit.view', label:'فاتورة إذن الاستيراد', description:'الدخول إلى بوابة فواتير إذن الاستيراد.'}),
        Object.freeze({key:'commercial_collection.view', label:'بوابة التحصيل التجاري', description:'الدخول إلى بوابة التحصيل التجاري.'})
      ])
    }),
    Object.freeze({
      key: 'bsgt', label: 'مساحة BSGT', description: 'صلاحيات أقسام مساحة بحر سواكن.', icon: 'ship',
      permissions: Object.freeze([
        Object.freeze({key:'bsgt.operations.view', label:'عرض مرحلة العمليات', description:'مشاهدة شحنات ومستندات العمليات.'}),
        Object.freeze({key:'bsgt.operations.edit', label:'تعديل مرحلة العمليات', description:'إنشاء وتعديل إجراءات مرحلة العمليات.', dependsOn:Object.freeze(['bsgt.operations.view'])}),
        Object.freeze({key:'bsgt.operation_center.view', label:'مركز عمليات BSGT', description:'عرض مركز العمليات داخل مساحة BSGT فقط.'}),
        Object.freeze({key:'bsgt.finance.view', label:'عرض المالية', description:'مشاهدة ملفات المرحلة المالية.'}),
        Object.freeze({key:'bsgt.finance.edit', label:'تعديل المالية', description:'تنفيذ إجراءات المرحلة المالية.', dependsOn:Object.freeze(['bsgt.finance.view'])}),
        Object.freeze({key:'bsgt.management.view', label:'عرض الإدارة', description:'مشاهدة مرحلة الإدارة والاعتماد.'}),
        Object.freeze({key:'bsgt.management.edit', label:'تعديل واعتماد الإدارة', description:'تنفيذ إجراءات الإدارة والاعتماد.', dependsOn:Object.freeze(['bsgt.management.view'])}),
        Object.freeze({key:'bsgt.relations.view', label:'عرض العلاقات التجارية', description:'مشاهدة مرحلة العلاقات التجارية.'}),
        Object.freeze({key:'bsgt.relations.edit', label:'تعديل العلاقات التجارية', description:'تنفيذ إجراءات العلاقات التجارية.', dependsOn:Object.freeze(['bsgt.relations.view'])})
      ])
    }),
    Object.freeze({
      key: 'sensitive', label: 'إجراءات حساسة', description: 'إجراءات إضافية لا تتجاوز قواعد سلامة الـ Workflow.', icon: 'lock',
      permissions: Object.freeze([
        Object.freeze({key:'shipment_documents.delete', label:'حذف مستند مرفوع', description:'حذف مستند عمليات مرفوع في المرحلة المسموحة.', sensitive:true}),
        Object.freeze({key:'package.merge', label:'دمج الحزمة', description:'دمج الحزمة بعد تحقق شروط القبول النهائي.', sensitive:true}),
        Object.freeze({key:'contracts.edit', label:'تعديل العقود', description:'الدخول إلى محرر عقد بحر سواكن.', sensitive:true}),
        Object.freeze({key:'client_assets.use', label:'استخدام أختام وتوقيعات العملاء', description:'إدراج أصول العميل المعتمدة داخل العقد.', sensitive:true})
      ])
    })
  ]);

  const ENTRIES = Object.freeze(REGISTRY.flatMap(group => group.permissions));
  const ENTRY_BY_KEY = new Map(ENTRIES.map(entry => [entry.key, entry]));
  const ALL_KEYS = Object.freeze(ENTRIES.map(entry => entry.key));
  const WRITE_KEYS = Object.freeze([
    'shipments.create', 'shipments.edit', 'shipments.delete',
    'client_profiles.edit',
    'bsgt.operations.edit', 'bsgt.finance.edit',
    'bsgt.management.edit', 'bsgt.relations.edit',
    'shipment_documents.delete', 'package.merge',
    'contracts.edit', 'client_assets.use'
  ]);
  const PRESETS = Object.freeze({
    operations: Object.freeze({label:'موظف العمليات', keys:Object.freeze(['bsgt.operations.view','bsgt.operations.edit','bsgt.operation_center.view','import_permit.view','client_profiles.view'])}),
    finance: Object.freeze({label:'موظف المالية', keys:Object.freeze(['bsgt.finance.view','bsgt.finance.edit','commercial_collection.view'])}),
    management: Object.freeze({label:'موظف الإدارة', keys:Object.freeze(['bsgt.management.view','bsgt.management.edit','package.merge'])}),
    relations: Object.freeze({label:'موظف العلاقات التجارية', keys:Object.freeze(['bsgt.relations.view','bsgt.relations.edit'])})
  });

  function normalizeKeys(keys) {
    const selected = new Set((Array.isArray(keys) ? keys : []).filter(key => ENTRY_BY_KEY.has(key)));
    let changed = true;
    while (changed) {
      changed = false;
      Array.from(selected).forEach(key => {
        (ENTRY_BY_KEY.get(key)?.dependsOn || []).forEach(dependency => {
          if (!selected.has(dependency)) { selected.add(dependency); changed = true; }
        });
      });
    }
    return ALL_KEYS.filter(key => selected.has(key));
  }

  function legacyKeys(portalKeys, workspaceRows) {
    const keys = [];
    (Array.isArray(portalKeys) ? portalKeys : []).forEach(portalKey => {
      const key = `${portalKey}.view`;
      if (ENTRY_BY_KEY.has(key)) keys.push(key);
    });
    (Array.isArray(workspaceRows) ? workspaceRows : []).forEach(row => {
      const section = String(row?.section || '').trim();
      const viewKey = `bsgt.${section}.view`;
      const editKey = `bsgt.${section}.edit`;
      if (row?.can_view !== false && ENTRY_BY_KEY.has(viewKey)) keys.push(viewKey);
      if (section === 'operations' && row?.can_view !== false) keys.push('bsgt.operation_center.view');
      if (row?.can_edit === true && ENTRY_BY_KEY.has(editKey)) keys.push(editKey);
    });
    return normalizeKeys(keys);
  }

  function createContext(initial = {}) {
    let state = {profile:null, rows:[], portalKeys:[], workspaceRows:[]};
    function configure(next = {}) {
      state = {
        profile: next.profile || null,
        rows: Array.isArray(next.rows) ? next.rows.slice() : [],
        portalKeys: Array.isArray(next.portalKeys) ? next.portalKeys.slice() : [],
        workspaceRows: Array.isArray(next.workspaceRows) ? next.workspaceRows.slice() : []
      };
      return context;
    }
    function allowedKeys() {
      const profile = state.profile;
      if (!profile || profile.active === false) return [];
      if (profile.role === 'admin') return ALL_KEYS.slice();
      const explicit = new Map(state.rows.map(row => [String(row?.permission_key || ''), row?.allowed !== false]));
      const initialized = profile.featurePermissionsInitialized === true
        || profile.feature_permissions_initialized === true;
      const legacy = initialized ? new Set() : new Set(legacyKeys(state.portalKeys, state.workspaceRows));
      const selected = normalizeKeys(ALL_KEYS.filter(key => explicit.has(key) ? explicit.get(key) : legacy.has(key)));
      if (profile.role !== 'viewer') return selected;
      return selected.filter(key => !WRITE_KEYS.includes(key));
    }
    function can(key) { return allowedKeys().includes(key); }
    const context = Object.freeze({configure, can, canAny:keys=>(keys || []).some(can), canAll:keys=>(keys || []).every(can), allowedKeys, snapshot:()=>({...state, rows:state.rows.slice(), portalKeys:state.portalKeys.slice(), workspaceRows:state.workspaceRows.slice()})});
    return configure(initial);
  }

  const singleton = createContext();
  return Object.freeze({
    REGISTRY, ENTRIES, ALL_KEYS, WRITE_KEYS, PRESETS, normalizeKeys, legacyKeys, createContext,
    configure: singleton.configure,
    can: singleton.can,
    canAny: singleton.canAny,
    canAll: singleton.canAll,
    allowedKeys: singleton.allowedKeys,
    snapshot: singleton.snapshot
  });
});
