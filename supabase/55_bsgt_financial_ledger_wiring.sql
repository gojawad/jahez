-- BSGT Financial Center — Phase 2b: wiring the phase-1 transitions to the ledger (migration 55).
-- Additive: new columns on fin_file_ledger_state, four new RPCs, one replaced guard, and a ledger-aware
-- CREATE OR REPLACE of transition_bsgt_financial_file whose behaviour is UNCHANGED for files without a
-- ledger or with ledger_mode = 'pre_ledger'. Activation (enable_fin_file_vouchers) exists but is NOT
-- called here: file-linked vouchers stay disabled until the deployment review. Money: unconstrained
-- numeric, outputs as text. Rollback (commented at the end) restores the exact phase-1 function.
begin;

-- ===== 0) فحص مسبق =====
do $$
begin
  if to_regclass('public.fin_file_ledger_state') is null or to_regprocedure('public.fin_client_deposit(uuid,uuid)') is null
     or to_regprocedure('public.fin_file_ledger_totals(uuid)') is null or to_regprocedure('public.post_fin_voucher(uuid,bigint,text)') is null
     or to_regprocedure('public.reverse_fin_voucher(uuid,bigint,text)') is null then
    raise exception 'Migration 54 (ledger foundation) must be applied first';
  end if;
  if to_regclass('public.bsgt_financial_files') is null or not exists (select 1 from pg_constraint where conname = 'bff_state_stamps_check')
     or not exists (select 1 from pg_constraint where conname = 'bsgt_financial_file_events_event_type_check') then
    raise exception 'Phase-1 constraint bff_state_stamps_check is missing — refusing to run';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'fin_file_ledger_state' and column_name = 'refund_due_sdg')
     or to_regprocedure('public.enable_fin_file_vouchers()') is not null then
    raise exception 'Migration 55 objects already exist — refusing to run';
  end if;
end $$;

-- ===== 1) استحقاق الرد (يُثبَّت لحظة الإخفاق) والتخصيص المعتمد =====
alter table public.fin_file_ledger_state
  add column refund_due_sdg numeric,
  add column refund_due_at timestamptz,
  add column refund_due_seq bigint,
  add column refund_allocated_sdg numeric,
  add column refund_allocation_voucher_ids uuid[],                -- سندات التخصيص المحددة التي اعتُمدت (بنسخها)
  add column refund_allocation_lock_versions bigint[],
  add column refund_allocation_approved_at timestamptz,
  add column refund_allocation_approved_by uuid references public.profiles(id) on delete restrict,
  add column refund_allocation_reason text,
  add constraint fin_file_ledger_refund_check check (
    (refund_due_sdg is null) = (refund_due_at is null) and (refund_due_sdg is null) = (refund_due_seq is null)
    and (refund_due_sdg is null or (refund_due_sdg >= 0 and refund_due_sdg <> 'NaN'::numeric))
    and (refund_allocated_sdg is null or (refund_allocated_sdg >= 0 and refund_due_sdg is not null))
    and ((refund_allocated_sdg is null) = (refund_allocation_approved_at is null))
    and ((refund_allocated_sdg is null) = (refund_allocation_voucher_ids is null)));

-- الحارس: الاستحقاق لا يتغير بعد تثبيته (يُستبدل حارس 54 بنسخة تضيف هذا الشرط فقط)
create or replace function public.fin_file_ledger_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by); new.updated_at := now(); new.lock_version := old.lock_version + 1;
  new.financial_file_id := old.financial_file_id; new.company_id := old.company_id; new.ledger_mode := old.ledger_mode;
  new.opened_at := old.opened_at; new.opened_by := old.opened_by;
  if old.delivery_confirmed_at is not null and (new.delivery_confirmed_at is distinct from old.delivery_confirmed_at or new.delivery_confirmed_by is distinct from old.delivery_confirmed_by) then
    raise exception 'Delivery confirmation cannot be changed once recorded';
  end if;
  if (new.approved_bank_cost_sdg is distinct from old.approved_bank_cost_sdg or new.approved_permit_cost_sdg is distinct from old.approved_permit_cost_sdg)
     and public.fin_file_has_posted(old.financial_file_id, 'settlement') then
    raise exception 'Approved costs are frozen after settlement; use a cost adjustment voucher';
  end if;
  if old.refund_due_at is not null and (new.refund_due_sdg is distinct from old.refund_due_sdg or new.refund_due_at is distinct from old.refund_due_at or new.refund_due_seq is distinct from old.refund_due_seq) then
    raise exception 'Refund due is fixed at the moment of failure';
  end if;
  return new;
end $$;

-- ===== 1ب) قيد الحالة/الأختام في جدول المرحلة 1: حالات الرد لا تشترط ختم التحويل الكامل =====
-- الملف بدفتر يمكن أن يُخفق بعد قبض جزئي بلا client_transferred_at ويُردّ له من السندات، وأن يُدفع للبنك ويُسلَّم قبل تحويل العميل
-- (bank_paid/completed بلا ختم تحويل)؛ الدالة تبقي شرط الختم للملفات بلا دفتر.
-- (تعديل قيد فقط: لا بيانات ولا أعمدة تتغير؛ الـ Rollback يعيد نص القيد الأصلي حرفياً)
alter table public.bsgt_financial_files drop constraint bff_state_stamps_check;
alter table public.bsgt_financial_files add constraint bff_state_stamps_check check (
    (status = 'draft' and approved_at is null and client_transferred_at is null and bank_paid_at is null
       and completed_at is null and failed_at is null and refund_started_at is null and refunded_at is null and closed_at is null)
    or (status = 'pending_client_transfer' and approved_at is not null and client_transferred_at is null and bank_paid_at is null and failed_at is null and closed_at is null)
    or (status = 'client_transferred' and approved_at is not null and client_transferred_at is not null and bank_paid_at is null and failed_at is null and closed_at is null)
    or (status = 'bank_paid' and approved_at is not null and bank_paid_at is not null and completed_at is null and failed_at is null and closed_at is null)
    or (status = 'completed' and approved_at is not null and bank_paid_at is not null and completed_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and refund_started_at is null and refunded_at is null
       and (closed_at is null or client_transferred_at is null))
    or (status = 'refund_in_progress' and failed_at is not null and refund_started_at is not null and refunded_at is null and closed_at is null)
    or (status = 'refunded' and failed_at is not null and refund_started_at is not null and refunded_at is not null)
);

-- ===== 1ج) أنواع أحداث الملف المالي: إضافة أحداث التصحيح الموثق (Rollback يعيد القائمة الأصلية) =====
alter table public.bsgt_financial_file_events drop constraint bsgt_financial_file_events_event_type_check;
alter table public.bsgt_financial_file_events add constraint bsgt_financial_file_events_event_type_check check (event_type in ('created','draft_updated','bank_details_updated','invoices_synced',
    'invoice_confirmed','client_confirmed','approved','reopened','client_transfer_confirmed','bank_payment_confirmed',
    'completed','failed','refund_started','refunded','closed',
    'client_transfer_reverted','bank_payment_reverted','refund_reopened'));

-- ===== 2) المساعدات =====
-- ردود نقدية مرحّلة (غير معكوسة) بعد لحظة الإخفاق
create function public.fin_refunds_after(p_file uuid, p_seq bigint)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.amount), 0) from public.fin_vouchers v
   where v.financial_file_id = p_file and v.voucher_type = 'refund' and v.status = 'posted' and v.posted_seq > coalesce(p_seq, 0);
$$;
-- قبض مرحّل (غير معكوس) بعد لحظة الإخفاق: أموال جديدة واجبة الرد تُضاف إلى الاستحقاق دون تغيير اللقطة الأصلية
create function public.fin_receipts_after(p_file uuid, p_seq bigint)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.amount), 0) from public.fin_vouchers v
   where v.financial_file_id = p_file and v.voucher_type = 'receipt' and v.status = 'posted' and v.posted_seq > coalesce(p_seq, 0);
$$;
-- مجموعة سندات التخصيص الصادرة المرحّلة بعد الإخفاق (معرّفات مرتبة + نسخها) — الاعتماد يُربط بها
create function public.fin_allocation_set(p_file uuid, p_seq bigint, out o_ids uuid[], out o_versions bigint[], out o_total numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(v.id order by v.id), '{}'::uuid[]), coalesce(array_agg(v.lock_version order by v.id), '{}'::bigint[]), coalesce(sum(v.amount), 0)
    from public.fin_vouchers v
   where v.financial_file_id = p_file and v.voucher_type = 'balance_transfer' and v.status = 'posted' and v.posted_seq > coalesce(p_seq, 0);
$$;
-- هل اعتماد التخصيص ما زال صالحاً؟ (نفس المجموعة تماماً بنفس النسخ: أي عكس أو سند جديد يُبطله)
create function public.fin_allocation_approval_valid(s public.fin_file_ledger_state)
returns boolean language sql stable security definer set search_path = public as $$
  select s.refund_allocation_voucher_ids is not null
     and (select a.o_ids = s.refund_allocation_voucher_ids and a.o_versions = s.refund_allocation_lock_versions and a.o_total = s.refund_allocated_sdg
            from public.fin_allocation_set(s.financial_file_id, s.refund_due_seq) a);
$$;
-- تخصيصات صادرة مرحّلة بعد لحظة الإخفاق (لا تُعدّ رداً إلا باعتماد صريح)
create function public.fin_allocations_after(p_file uuid, p_seq bigint)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.amount), 0) from public.fin_vouchers v
   where v.financial_file_id = p_file and v.voucher_type = 'balance_transfer' and v.status = 'posted' and v.posted_seq > coalesce(p_seq, 0);
$$;

-- حالة الرد لملف (كل الأرقام نصوص)
create function public.fin_file_refund_status(p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.fin_file_ledger_state%rowtype; f public.bsgt_financial_files%rowtype;
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  select * into f from public.bsgt_financial_files where id = p_file and company_id = public.fin_company();
  if not found then raise exception 'Financial file not found'; end if;
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file;
  return jsonb_build_object(
    'ledger_mode', s.ledger_mode,
    'refund_due_sdg', s.refund_due_sdg::text, 'refund_due_at', s.refund_due_at,
    'received_after_failure_sdg', public.fin_receipts_after(p_file, s.refund_due_seq)::text,
    'refund_total_due_sdg', (coalesce(s.refund_due_sdg, 0) + public.fin_receipts_after(p_file, s.refund_due_seq))::text,
    'refunded_cash_sdg', public.fin_refunds_after(p_file, s.refund_due_seq)::text,
    'allocated_after_failure_sdg', public.fin_allocations_after(p_file, s.refund_due_seq)::text,
    'refund_allocated_approved_sdg', s.refund_allocated_sdg::text, 'refund_allocation_approved_at', s.refund_allocation_approved_at,
    'refund_allocation_valid', case when s.refund_allocated_sdg is null then null else public.fin_allocation_approval_valid(s) end,
    'refund_remaining_sdg', (coalesce(s.refund_due_sdg, 0) + public.fin_receipts_after(p_file, s.refund_due_seq) - public.fin_refunds_after(p_file, s.refund_due_seq)
                             - case when s.refund_allocated_sdg is not null and public.fin_allocation_approval_valid(s) then s.refund_allocated_sdg else 0 end)::text,
    'recoverable_outstanding_sdg', public.fin_file_role_net(p_file, 'recoverable')::text);
end $$;

-- ===== 3) RPCs الجديدة =====
-- التفعيل: يُنفَّذ مرة واحدة بعد النشر والمراجعة (لا يُستدعى هنا)
create function public.enable_fin_file_vouchers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid := public.fin_company(); r public.fin_ledger_settings%rowtype;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  perform public.fin_system_account('client_control');   -- الدليل مبذور أولاً
  insert into public.fin_ledger_settings (company_id, file_vouchers_enabled, updated_by) values (c, true, auth.uid())
    on conflict (company_id) do update set file_vouchers_enabled = true, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  perform public.fin_log('file_ledger', c, 'file_vouchers_enabled', null, null, null, null, null);
  return jsonb_build_object('settings', to_jsonb(r));
end $$;

-- اعتماد صريح: العميل اختار تخصيص أمانته (بعد الإخفاق) لملف آخر بدل الرد النقدي — يُوصف تخصيصاً لا رداً
create function public.approve_fin_refund_allocation(p_file uuid, p_expected_lock_version bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype; v_alloc numeric; a record;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Reason is required'; end if;
  f := public.fin_lock_file(p_file);
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file for update;
  if not found then raise exception 'Ledger is not opened for this financial file'; end if;
  if p_expected_lock_version is null or s.lock_version <> p_expected_lock_version then
    raise exception 'File ledger version changed (expected %, current %); reload and retry', p_expected_lock_version, s.lock_version; end if;
  if s.refund_due_sdg is null then raise exception 'No refund is due on this file (not failed under the ledger)'; end if;
  if f.status = 'refunded' then raise exception 'Refund is already confirmed'; end if;
  select * into a from public.fin_allocation_set(p_file, s.refund_due_seq);
  v_alloc := a.o_total;
  if v_alloc <= 0 then raise exception 'No posted allocation out of this file after the failure'; end if;
  if v_alloc + public.fin_refunds_after(p_file, s.refund_due_seq) > s.refund_due_sdg + public.fin_receipts_after(p_file, s.refund_due_seq) then
    raise exception 'Allocations (%) plus cash refunds (%) exceed the refund due (%)', v_alloc, public.fin_refunds_after(p_file, s.refund_due_seq), s.refund_due_sdg + public.fin_receipts_after(p_file, s.refund_due_seq); end if;
  if s.refund_allocation_voucher_ids = a.o_ids and s.refund_allocation_lock_versions = a.o_versions then raise exception 'This exact allocation set is already approved'; end if;
  -- الاعتماد مربوط بالسندات المحددة ونسخها؛ أي عكس أو سند جديد يبطله ويستلزم مراجعة جديدة
  update public.fin_file_ledger_state set refund_allocated_sdg = v_alloc, refund_allocation_voucher_ids = a.o_ids, refund_allocation_lock_versions = a.o_versions,
         refund_allocation_approved_at = now(), refund_allocation_approved_by = auth.uid(), refund_allocation_reason = btrim(p_reason)
   where financial_file_id = p_file returning * into s;
  perform public.fin_log('file_ledger', p_file, 'refund_allocation_approved', null, null, s.lock_version, btrim(p_reason),
    jsonb_build_object('allocated_sdg', v_alloc::text, 'refund_due_sdg', s.refund_due_sdg::text, 'voucher_ids', to_jsonb(a.o_ids), 'lock_versions', to_jsonb(a.o_versions)));
  return jsonb_build_object('state', public.fin_state_json(s), 'refund', public.fin_file_refund_status(p_file));
end $$;

-- ===== 3ب) أثر السندات على حالات الملف المؤكدة (ملفات الدفتر فقط) =====
-- p_op = 'post'    : قبض على ملف «مستردّ» غير مقفل ⇒ يُعاد فتح الاسترداد (الأموال الجديدة واجبة الرد)؛ مقفل ⇒ رفض
-- p_op = 'reverse' : لكل ملف تأثر: إن كان الدليل المالي لحالة مؤكدة يعتمد على السند ⇒ تصحيح موثق في نفس المعاملة
--                    (إلغاء ختم التحويل / إلغاء ختم دفع البنك / إعادة فتح الاسترداد / إبطال اعتماد التخصيص) أو رفض إن كان الملف مقفلاً
--                    أو كانت الحالة أبعد من خطوة واحدة (مسار التصحيح: سند مقابل، أو عكس اللاحق أولاً)
create function public.fin_ledger_file_effects(v public.fin_vouchers, p_op text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype; fid uuid; notes text[] := '{}'; v_dep numeric; v_need numeric; v_paid numeric; v_uid uuid := auth.uid();
begin
  for fid in select x from unnest(array_remove(array[v.financial_file_id, v.target_file_id], null)) as u(x) order by x loop
    select * into s from public.fin_file_ledger_state where financial_file_id = fid;
    if not found or s.ledger_mode <> 'ledger' then continue; end if;
    select * into f from public.bsgt_financial_files where id = fid;   -- مقفول من fin_lock_scope
    perform set_config('jahez.financial_transition', 'on', true);
    -- (0) إعادة التحقق من دليل التمويل تنطبق على الحركة الجديدة (رد / تخصيص صادر) كما تنطبق على العكس:
    --     الأمانة بعد الحركة (حالياً — السند مرحّل قبل الاستدعاء) أو بعد العكس (الحالية − المبلغ) مقابل تكاليف البنك والإذن
    v_dep := null;
    if p_op = 'post' and ((v.voucher_type = 'refund' and fid = v.financial_file_id) or (v.voucher_type = 'balance_transfer' and fid = v.financial_file_id)) then
      v_dep := public.fin_client_deposit(f.client_id, fid);
    elsif p_op = 'reverse' and ((v.voucher_type = 'receipt' and fid = v.financial_file_id) or (v.voucher_type = 'balance_transfer' and fid = v.target_file_id)) then
      v_dep := public.fin_client_deposit(f.client_id, fid) - v.amount;
    end if;
    if v_dep is not null then
      -- ملف مقفل: لا يُترك بمطلوب من العميل بلا دليل
      if f.closed_at is not null and public.fin_client_charged(f.client_id, fid) > v_dep then
        raise exception 'File % is closed with no client due; this % would reopen a due — record a correcting voucher instead', fid, case when p_op = 'post' then 'voucher' else 'reversal' end; end if;
      if f.client_transferred_at is not null and f.status not in ('failed','refund_in_progress','refunded') then
        v_need := coalesce(s.approved_bank_cost_sdg, f.bank_cost_sdg) + case when f.import_permit_source = 'bsgt' then coalesce(s.approved_permit_cost_sdg, f.import_permit_cost_sdg) else 0 end;
        if v_dep < coalesce(v_need, 0) then
          if f.closed_at is not null then raise exception 'File % is closed and its confirmed funding relies on this money; the % is refused — record a correcting voucher instead', fid, case when p_op = 'post' then 'voucher' else 'reversal' end; end if;
          if f.status = 'client_transferred' then
            update public.bsgt_financial_files set status = 'pending_client_transfer', client_transferred_at = null, client_transferred_by = null where id = fid;
            perform public.bsgt_financial_log(fid, 'client_transfer_reverted', 'client_transferred', 'pending_client_transfer', format('ledger: %s %s (%s); deposit %s < costs %s', case when p_op = 'post' then 'posting of' else 'reversal of' end, v.voucher_no, coalesce(p_reason, v.memo, ''), v_dep, v_need), null);
          else
            update public.bsgt_financial_files set client_transferred_at = null, client_transferred_by = null where id = fid;   -- bank_paid/completed: الختم فقط
            perform public.bsgt_financial_log(fid, 'client_transfer_reverted', f.status, f.status, format('ledger: %s %s (%s); deposit %s < costs %s — stamp cleared, status kept', case when p_op = 'post' then 'posting of' else 'reversal of' end, v.voucher_no, coalesce(p_reason, v.memo, ''), v_dep, v_need), null);
          end if;
          notes := notes || ('file ' || fid::text || ': client transfer stamp reverted');
        end if;
      end if;
    end if;
    if p_op = 'post' then
      if v.voucher_type = 'receipt' and f.status = 'refunded' then
        if f.closed_at is not null then raise exception 'File is closed after a confirmed refund; a receipt cannot be recorded on it — record it on the client without a file or reopen is not supported'; end if;
        update public.bsgt_financial_files set status = 'refund_in_progress', refunded_at = null, refunded_by = null where id = fid;
        perform public.bsgt_financial_log(fid, 'refund_reopened', 'refunded', 'refund_in_progress', 'ledger: receipt ' || v.voucher_no || ' after the confirmed refund; the new money must be returned', null);
        notes := notes || ('file ' || fid::text || ': refund reopened');
      end if;
    else
      -- (أ) قبض/تخصيص وارد سابق للإخفاق هو جزء من لقطة استحقاق الرد الثابتة: عكسه يُنقص المستلم فعلياً ويترك استحقاقاً غير قابل للتنفيذ ⇒ رفض
      --     (المسار الصحيح: سند رد يُثبت إعادة المال ويُحتسب في إثبات الرد؛ اللقطة تبقى كما هي)
      if s.refund_due_seq is not null and v.posted_seq <= s.refund_due_seq
         and ((v.voucher_type = 'receipt' and fid = v.financial_file_id) or (v.voucher_type = 'balance_transfer' and fid = v.target_file_id)) then
        raise exception 'Voucher % is part of the refund due fixed at the failure of file % (%); it cannot be reversed — return the money with a refund voucher instead', v.voucher_no, fid, s.refund_due_sdg;
      end if;
      -- (ب) الرد يُسند تأكيد الاسترداد
      if v.voucher_type = 'refund' and fid = v.financial_file_id and f.status = 'refunded' then
        if f.closed_at is not null then raise exception 'File % is closed after a confirmed refund; the refund voucher cannot be reversed — record a correcting receipt instead', fid; end if;
        update public.bsgt_financial_files set status = 'refund_in_progress', refunded_at = null, refunded_by = null where id = fid;
        perform public.bsgt_financial_log(fid, 'refund_reopened', 'refunded', 'refund_in_progress', format('ledger: reversal of refund %s (%s)', v.voucher_no, p_reason), null);
        notes := notes || ('file ' || fid::text || ': refund reopened');
      end if;
      -- (ج) التخصيص الصادر المعتمد كجزء من إثبات الرد
      if v.voucher_type = 'balance_transfer' and fid = v.financial_file_id and s.refund_allocation_voucher_ids is not null and v.id = any(s.refund_allocation_voucher_ids) then
        if f.closed_at is not null then raise exception 'File % is closed after a confirmed refund; the approved allocation cannot be reversed', fid; end if;
        update public.fin_file_ledger_state set refund_allocated_sdg = null, refund_allocation_voucher_ids = null, refund_allocation_lock_versions = null,
               refund_allocation_approved_at = null, refund_allocation_approved_by = null, refund_allocation_reason = null where financial_file_id = fid;
        perform public.fin_log('file_ledger', fid, 'refund_allocation_voided', null, null, null, format('ledger: allocation %s reversed (%s); approval voided — review again', v.voucher_no, p_reason), jsonb_build_object('voucher_id', v.id));
        if f.status = 'refunded' then
          update public.bsgt_financial_files set status = 'refund_in_progress', refunded_at = null, refunded_by = null where id = fid;
          perform public.bsgt_financial_log(fid, 'refund_reopened', 'refunded', 'refund_in_progress', format('ledger: approved allocation %s reversed (%s)', v.voucher_no, p_reason), null);
        end if;
        notes := notes || ('file ' || fid::text || ': allocation approval voided');
      end if;
      -- (د) دفع البنك يُسند تأكيد السداد
      if v.voucher_type = 'payment_bank' and fid = v.financial_file_id and f.bank_paid_at is not null then
        -- دليل تأكيد السداد = مجموع سندات دفع البنك المرحّلة ≥ التكلفة المعتمدة (دفعات الفروق بعد التسوية لا تُحسب ضده)
        select coalesce(sum(w.amount), 0) - v.amount into v_paid from public.fin_vouchers w where w.financial_file_id = fid and w.voucher_type = 'payment_bank' and w.status = 'posted';
        if v_paid < coalesce(s.approved_bank_cost_sdg, 0) then
          if f.closed_at is not null then raise exception 'File % is closed; its confirmed bank payment relies on this voucher — record a correcting voucher (recovery) instead', fid; end if;
          if f.status <> 'bank_paid' or s.delivery_confirmed_at is not null or public.fin_file_has_posted(fid, 'settlement') then
            raise exception 'Bank payment of file % is confirmed and followed by delivery/settlement/completion; reverse the settlement first or record a correcting recovery voucher', fid; end if;
          update public.bsgt_financial_files set status = case when f.client_transferred_at is null then 'pending_client_transfer' else 'client_transferred' end, bank_paid_at = null, bank_paid_by = null where id = fid;
          perform public.bsgt_financial_log(fid, 'bank_payment_reverted', 'bank_paid', case when f.client_transferred_at is null then 'pending_client_transfer' else 'client_transferred' end, format('ledger: reversal of %s (%s); paid %s < approved %s', v.voucher_no, p_reason, v_paid, s.approved_bank_cost_sdg), null);
          notes := notes || ('file ' || fid::text || ': bank payment stamp reverted');
        end if;
      end if;
      -- (هـ) التسوية على ملف مقفل (الإقفال يشترطها)
      if v.voucher_type = 'settlement' and f.closed_at is not null then
        raise exception 'File % is closed; its closure relies on the settlement — record cost adjustments instead of reversing it', fid; end if;
    end if;
    perform set_config('jahez.financial_transition', 'off', true);
  end loop;
  return nullif(array_to_string(notes, '; '), '');
end $$;

-- ===== 3ج) الترحيل والعكس: نسخة 54 + استدعاء أثر الملف =====
create or replace function public.post_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype; e public.fin_journal_entries%rowtype; b record; v_uid uuid := auth.uid(); v_note text;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  select * into v from public.fin_vouchers where id = p_id;
  if not found then raise exception 'Voucher not found'; end if;
  perform public.fin_lock_scope(v);
  v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
  if v.status = 'posted' then raise exception 'Voucher is already posted (%)', v.voucher_no; end if;
  if v.status <> 'draft' then raise exception 'Only draft vouchers can be posted (status %)', v.status; end if;
  if v.last_input_by = v_uid then                                        -- الفصل بين المُدخل والمُعتمد على آخر من عدّل السند
    if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
      raise exception 'Maker-checker: the last person who entered this voucher cannot post it';
    end if;
    v_note := 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason);
  end if;
  v := public.fin_validate_voucher(v);                                   -- إعادة التحقق تحت الأقفال
  select * into b from public.fin_build_lines(v);
  -- المكوّنات المحسوبة (تسوية/إعادة تصنيف) يجب أن تطابق ما راجعه المعتمد في المسودة؛ وإلا تُطلب مراجعة جديدة ولا يُرحّل مبلغ مختلف بصمت
  if v.voucher_type in ('settlement','failure_reclass') and public.fin_components(v.voucher_type, b.o_details) <> public.fin_components(v.voucher_type, v.details) then
    raise exception 'Computed components changed since the draft was reviewed (reviewed %, now %); refresh the draft (update_fin_voucher_draft) and review again',
      public.fin_components(v.voucher_type, v.details), public.fin_components(v.voucher_type, b.o_details);
  end if;
  v.voucher_no := public.fin_next_no(v.company_id, public.fin_prefix(v.voucher_type), v.voucher_date);
  e := public.fin_insert_entry(v, 'post', null, b.o_lines, b.o_total, coalesce(v.memo, v.voucher_type || ' ' || v.voucher_no));
  perform set_config('jahez.fin_post', 'on', true);
  update public.fin_vouchers
     set status = 'posted', voucher_no = v.voucher_no, amount = b.o_total, client_id = v.client_id, purpose = v.purpose,
         details = b.o_details, journal_entry_id = e.id, posted_seq = e.posting_seq, posted_at = now(), posted_by = v_uid
   where id = p_id returning * into v;
  perform set_config('jahez.fin_post', 'off', true);
  v_note := concat_ws(' | ', v_note, public.fin_ledger_file_effects(v, 'post', null));   -- (55) أثر السند على حالة الملف (تصحيح موثق أو رفض)
  perform public.fin_log('voucher', v.id, 'posted', 'draft', 'posted', v.lock_version, v_note, jsonb_build_object('voucher_no', v.voucher_no, 'entry_no', e.entry_no, 'total', b.o_total::text) || b.o_details);
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
end $$;

create or replace function public.reverse_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype; o public.fin_journal_entries%rowtype; e public.fin_journal_entries%rowtype; later record; v_lines jsonb; dep numeric; v_effects text;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Reversal reason is required'; end if;
  select * into v from public.fin_vouchers where id = p_id;
  if not found then raise exception 'Voucher not found'; end if;
  perform public.fin_lock_scope(v);
  v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
  if v.status = 'reversed' then raise exception 'Voucher is already reversed'; end if;
  if v.status <> 'posted' then raise exception 'Only posted vouchers can be reversed (status %)', v.status; end if;
  -- (أ) سند مرحّل لاحق (بترتيب الترحيل posted_seq، لا بالوقت) يعتمد على هذا السند ⇒ اعكس اللاحق أولاً
  select w.voucher_no, w.voucher_type into later from public.fin_vouchers w
   where w.company_id = v.company_id and w.status = 'posted' and w.id <> v.id and w.posted_seq > v.posted_seq
     and case v.voucher_type
       -- قبض/تخصيص وارد: يعتمد عليه كل ما يستهلك أمانة العميل في نفس النطاق (رد، تخصيص صادر)
       when 'receipt' then w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.financial_file_id
       when 'balance_transfer' then (w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.target_file_id)
       -- دفع نيابة: تعتمد عليه التسوية/إعادة التصنيف/التعديل على نفس الملف
       when 'payment_bank' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
       when 'payment_permit' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
       -- التسوية: يعتمد عليها كل ما يقتضي ملفاً مُسوًّى
       when 'settlement' then w.voucher_type in ('adjustment','recovery','payment_bank','payment_permit') and w.financial_file_id = v.financial_file_id
       -- إعادة التصنيف: تعتمد عليها الاستردادات من 1500
       when 'failure_reclass' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
       -- التعديل: يعتمد عليه ما يدفع/يستردّ/يردّ الفرق بعده على نفس الملف، وأي تعديل لاحق
       when 'adjustment' then w.voucher_type in ('adjustment','payment_bank','payment_permit','recovery','refund') and w.financial_file_id = v.financial_file_id
       when 'recovery' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
       else false end
   order by w.posted_seq desc limit 1;
  if found then raise exception 'Reverse the later voucher % (%) first', later.voucher_no, later.voucher_type; end if;
  -- (ب) أمانة العميل (قبض + تخصيص وارد − رد − تخصيص صادر) يجب ألا تصبح سالبة: سداد مديونية يُعكس بحرية، أما أمانة استُهلكت برد/تخصيص فلا
  if v.voucher_type = 'receipt' then
    dep := public.fin_client_deposit(v.client_id, v.financial_file_id);
    if dep - v.amount < 0 then raise exception 'Receipt was already consumed by a later refund/allocation (deposit %, receipt %)', dep, v.amount; end if;
  elsif v.voucher_type = 'balance_transfer' then
    dep := public.fin_client_deposit(v.client_id, v.target_file_id);
    if dep - v.amount < 0 then raise exception 'Allocated balance was already consumed on the target file (deposit %)', dep; end if;
  end if;
  -- الدفع نيابة وإعادة التصنيف: الاعتمادية تُحسم بالترتيب (أ) فقط — لا بصافي حساب التكلفة، لأن الصافي يكون صفراً
  -- بعد التسوية عندما يُدفع فرق سبق تحميله (adjustment) ثم يُعكس الدفع بحق
  -- (55) حالات الملف المؤكدة التي يعتمد دليلها على هذا السند: تصحيح موثق في نفس المعاملة أو رفض بمسار واضح
  v_effects := public.fin_ledger_file_effects(v, 'reverse', btrim(p_reason));
  select * into o from public.fin_journal_entries where id = v.journal_entry_id;
  select coalesce(jsonb_agg(public.fin_ln(l.account_id, l.debit, l.credit, l.client_id, l.financial_file_id, l.memo) order by l.line_no), '[]'::jsonb)
    into v_lines from public.fin_journal_lines l where l.entry_id = o.id;
  e := public.fin_insert_entry(v, 'reversal', o.id, v_lines, o.total_debit, 'reversal of ' || o.entry_no || ': ' || btrim(p_reason));
  perform set_config('jahez.fin_post', 'on', true);
  update public.fin_vouchers set status = 'reversed', reversal_entry_id = e.id, reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
   where id = p_id returning * into v;
  perform set_config('jahez.fin_post', 'off', true);
  perform public.fin_log('voucher', v.id, 'reversed', 'posted', 'reversed', v.lock_version, concat_ws(' | ', btrim(p_reason), v_effects), jsonb_build_object('original_entry_no', o.entry_no, 'reversal_entry_no', e.entry_no));
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'reversal_entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
end $$;

-- ===== 4) الانتقالات: نسخة واعية بالدفتر (سلوك المرحلة 1 كما هو للملفات بلا دفتر أو pre_ledger) =====
create or replace function public.transition_bsgt_financial_file(p_id uuid, p_expected_lock_version bigint, p_action text, p_note text default null, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; t public.trade_collection_files%rowtype; v_from text; v_to text; v_event text; v_note text := p_note; v_uid uuid := auth.uid();
        s public.fin_file_ledger_state%rowtype; v_ledger boolean := false; v_need numeric; v_dep numeric; v_paid numeric; v_refunded numeric; v_tot jsonb; v_alloc numeric; v_due numeric;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, null);   -- يرفض المقفل
  v_from := f.status;
  -- (55) ملف بدفتر بنمط ledger ⇒ الأموال تُثبت من السندات المرحّلة؛ pre_ledger أو بلا دفتر ⇒ سلوك المرحلة 1 كما هو
  select * into s from public.fin_file_ledger_state where financial_file_id = p_id for update;
  v_ledger := found and s.ledger_mode = 'ledger';
  perform set_config('jahez.financial_transition', 'on', true);
  case
    when p_action = 'approve' and f.status = 'draft' then
      t := public.bsgt_financial_assert_eligible(f.trade_file_id);      -- إعادة فحص الأهلية (بند 4)
      if exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_id and i.detached_at is null and i.amount_usd is null) then
        raise exception 'Unconfirmed invoice amounts remain'; end if;
      if f.invoice_total_usd is null or f.invoice_total_usd <= 0 then raise exception 'Confirmed invoice total must be positive'; end if;
      -- عضوية الفواتير = روابط TC: نفس العدد، لا تكرار، نفس المجموعة (v4.1-6)
      if (select count(*) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
         <> (select count(*) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id)
         or (select count(*) - count(distinct shipment_id) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null) <> 0
         or (select count(*) - count(distinct shipment_id) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) <> 0
         or (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
         <> (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) then
        raise exception 'Trade file shipments changed; run invoice sync before approval'; end if;
      -- لقطة المستلمين تمثل الشحنات الحالية (v4.1-1)
      if array_to_string(public.bsgt_financial_consignees(f.trade_file_id), ' | ') <> f.consignee_snapshot
         or cardinality(public.bsgt_financial_consignees(f.trade_file_id)) <> f.consignee_count then
        raise exception 'Consignee snapshot is stale; run invoice sync before approval'; end if;
      if f.bank_tariff_per_1000_sdg is null or f.bsgt_tariff_per_1000_sdg is null then raise exception 'Both tariffs are required'; end if;
      if f.import_permit_source is null then raise exception 'Import permit source is required'; end if;
      if f.import_permit_source = 'client' and coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Client-provided import permit number is required before approval'; end if;
      if f.client_id is null then raise exception 'Billing client must be confirmed'; end if;
      if not f.calculation_ready then raise exception 'Cost calculation is incomplete'; end if;
      if f.last_input_by = v_uid then                                    -- maker-checker (بند 1، قرار د)
        if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
          raise exception 'Maker-checker: the last person who entered financial data cannot approve it';
        end if;
        v_note := concat_ws(' | ', p_note, 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason));
      end if;
      v_to := 'pending_client_transfer'; v_event := 'approved';
      update public.bsgt_financial_files set status = v_to, approved_at = now(), approved_by = v_uid where id = p_id returning * into f;
    when p_action = 'reopen' and f.status = 'pending_client_transfer' then
      v_to := 'draft'; v_event := 'reopened';
      update public.bsgt_financial_files set status = v_to, approved_at = null, approved_by = null where id = p_id returning * into f;
    when p_action = 'confirm_client_transfer' and (f.status = 'pending_client_transfer' or (v_ledger and f.status in ('bank_paid','completed') and f.client_transferred_at is null)) then
      if v_ledger then
        -- (55) التمويل = أمانة العميل الصافية (قبض + تخصيص وارد − رد − تخصيص صادر) ≥ تكاليف البنك والإذن (المعتمدة إن وُجدت وإلا المحسوبة)؛ العمولة قد تبقى مستحقة
        v_dep := public.fin_client_deposit(f.client_id, p_id);
        v_need := coalesce(s.approved_bank_cost_sdg, f.bank_cost_sdg) + case when f.import_permit_source = 'bsgt' then coalesce(s.approved_permit_cost_sdg, f.import_permit_cost_sdg) else 0 end;
        if v_need is null then raise exception 'Bank/permit costs are not calculated yet'; end if;
        if v_dep < v_need then raise exception 'Client net deposit (%) does not cover the bank and permit costs (%); post the receipts first', v_dep, v_need; end if;
        v_note := concat_ws(' | ', p_note, format('ledger: deposit %s >= costs %s', v_dep, v_need));
      end if;
      -- (55) بعد دفع البنك/الإكمال (ملف دفتر دُفع قبل تحويل العميل): يُسجَّل الختم فقط والحالة تبقى
      v_to := case when f.status = 'pending_client_transfer' then 'client_transferred' else f.status end; v_event := 'client_transfer_confirmed';
      update public.bsgt_financial_files set status = v_to, client_transferred_at = now(), client_transferred_by = v_uid where id = p_id returning * into f;
    when p_action = 'confirm_bank_payment' and (f.status = 'client_transferred' or (v_ledger and f.status = 'pending_client_transfer')) then
      -- (55) ملف دفتر: BSGT قد تدفع البنك قبل تحويل العميل؛ الدليل هو سندات الدفع المرحّلة = التكلفة المعتمدة، ولا يُختلق ختم تحويل
      if coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Import permit number is required before bank payment'; end if;   -- قرار ب
      if f.documents_value_aed is null or f.documents_value_aed <= 0 then raise exception 'Bank documents value (AED) must be entered before bank payment'; end if;  -- بند 11
      if v_ledger then
        -- (55) التكلفة الفعلية المعتمدة مستقلة عن المدفوع، ومجموع دفع البنك المرحّل يجب أن يساويها؛ دفع الإذن يُتابع مستقلاً (تشترطه التسوية)
        if s.costs_approved_at is null then raise exception 'Approve the actual bank cost first (approve_fin_file_costs)'; end if;
        v_paid := public.fin_file_role_net(p_id, 'paid_bank');
        if v_paid <> s.approved_bank_cost_sdg then raise exception 'Posted bank payments (%) do not equal the approved bank cost (%)', v_paid, s.approved_bank_cost_sdg; end if;
        v_note := concat_ws(' | ', p_note, format('ledger: bank paid %s = approved %s (computed %s)', v_paid, s.approved_bank_cost_sdg, f.bank_cost_sdg));
      end if;
      v_to := 'bank_paid'; v_event := 'bank_payment_confirmed';
      update public.bsgt_financial_files set status = v_to, bank_paid_at = now(), bank_paid_by = v_uid where id = p_id returning * into f;
    when p_action = 'complete' and f.status = 'bank_paid' then
      select * into t from public.trade_collection_files where id = f.trade_file_id;
      if t.status <> 'sent_to_collecting' then raise exception 'Trade file must be sent to the collecting bank first'; end if;   -- قرار ج
      v_to := 'completed'; v_event := 'completed';
      update public.bsgt_financial_files set status = v_to, completed_at = now(), completed_by = v_uid where id = p_id returning * into f;
    when p_action = 'fail' and f.status in ('draft','pending_client_transfer','client_transferred','bank_paid') then
      if coalesce(btrim(p_note), '') = '' then raise exception 'Failure reason is required'; end if;
      v_to := 'failed'; v_event := 'failed';                             -- لا أختام اعتماد وهمية (بند 9)
      update public.bsgt_financial_files set status = v_to, failed_at = now(), failed_by = v_uid, failure_reason = btrim(p_note) where id = p_id returning * into f;
      if v_ledger then
        -- (55) استحقاق الرد = أمانة العميل الصافية لحظة الإخفاق (المدفوع فعلياً القابل للرد)؛ مستقل تماماً عن مستحقات BSGT لدى البنك (1500)
        v_dep := public.fin_client_deposit(f.client_id, p_id);
        update public.fin_file_ledger_state set refund_due_sdg = v_dep, refund_due_at = now(), refund_due_seq = nextval('public.fin_posting_seq') where financial_file_id = p_id returning * into s;
        v_note := concat_ws(' | ', p_note, format('ledger: refund due %s', v_dep));
      end if;
    -- (55) استحقاق الرد الكلي = اللقطة الثابتة + القبض بعد الإخفاق (إخفاق بلقطة صفر ثم قبض ⇒ رد مستحق)
    when p_action = 'start_refund' and f.status = 'failed' and ((not v_ledger and f.client_transferred_at is not null)
         or (v_ledger and coalesce(s.refund_due_sdg, 0) + public.fin_receipts_after(p_id, s.refund_due_seq) > 0)) then
      v_to := 'refund_in_progress'; v_event := 'refund_started';
      update public.bsgt_financial_files set status = v_to, refund_started_at = now(), refund_started_by = v_uid where id = p_id returning * into f;
    when p_action = 'confirm_refund' and f.status = 'refund_in_progress' then
      if v_ledger then
        -- (55) الرد يُثبت بسندات رد نقدي مرحّلة بعد الإخفاق (+ تخصيص موثَّق معتمد صراحةً) = الاستحقاق؛ رصيد صفر وحده لا يكفي
        if s.refund_allocated_sdg is not null and not public.fin_allocation_approval_valid(s) then
          raise exception 'The approved allocation set changed (a voucher was reversed or added); review and approve the allocation again'; end if;
        v_alloc := case when s.refund_allocated_sdg is not null then s.refund_allocated_sdg else 0 end;
        v_due := s.refund_due_sdg + public.fin_receipts_after(p_id, s.refund_due_seq);   -- الاستحقاق الثابت + أي قبض جديد بعد الإخفاق
        v_refunded := public.fin_refunds_after(p_id, s.refund_due_seq) + v_alloc;
        if v_refunded <> v_due then
          raise exception 'Cash refunds posted after the failure (%) plus approved allocations (%) do not equal the refund due (%) = fixed % + received after failure %',
            public.fin_refunds_after(p_id, s.refund_due_seq), v_alloc, v_due, s.refund_due_sdg, public.fin_receipts_after(p_id, s.refund_due_seq); end if;
        v_note := concat_ws(' | ', p_note, format('ledger: refunded %s (cash %s, allocated %s, fixed due %s, received after failure %s)', v_refunded, public.fin_refunds_after(p_id, s.refund_due_seq), v_alloc, s.refund_due_sdg, public.fin_receipts_after(p_id, s.refund_due_seq)));
      end if;
      v_to := 'refunded'; v_event := 'refunded';
      update public.bsgt_financial_files set status = v_to, refunded_at = now(), refunded_by = v_uid where id = p_id returning * into f;
    when p_action = 'close' and (f.status in ('completed','refunded') or (f.status = 'failed' and ((not v_ledger and f.client_transferred_at is null)
         or (v_ledger and coalesce(s.refund_due_sdg, 0) + public.fin_receipts_after(p_id, s.refund_due_seq) = 0 and public.fin_client_deposit(f.client_id, p_id) = 0)))) then
      if v_ledger then
        -- (55) الإقفال تشغيلي: لا مطلوب من العميل ولا فرق تكلفة معلّق؛ لا يشترط تصفير 1500 ولا رصيد العميل الدائن (يبقى قابلاً للرد/التخصيص بعد الإقفال)
        v_tot := public.fin_file_ledger_totals(p_id);
        if (v_tot->>'due_from_client_sdg')::numeric <> 0 then raise exception 'Client still owes % on this file', v_tot->>'due_from_client_sdg'; end if;
        if (v_tot->>'bank_unbilled_sdg')::numeric <> 0 or (v_tot->>'permit_unbilled_sdg')::numeric <> 0 then
          raise exception 'Payments on behalf are not yet settled, reclassified or billed (bank %, permit %)', v_tot->>'bank_unbilled_sdg', v_tot->>'permit_unbilled_sdg'; end if;
        if f.status = 'completed' and not (v_tot->>'settled')::boolean then raise exception 'Post the settlement voucher before closing a completed file'; end if;
        if f.status = 'refunded' and (v_tot->>'client_deposit_sdg')::numeric <> 0 then raise exception 'Money received after the refund is still to be returned (deposit %)', v_tot->>'client_deposit_sdg'; end if;
      end if;
      v_to := f.status; v_event := 'closed';
      update public.bsgt_financial_files set closed_at = now(), closed_by = v_uid where id = p_id returning * into f;
    else
      raise exception 'Transition % is not allowed from status %', p_action, f.status;
  end case;
  perform set_config('jahez.financial_transition', 'off', true);
  perform public.bsgt_financial_log(p_id, v_event, v_from, v_to, v_note, null);
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'event_type', v_event);
end $$;

-- ===== 5) Grants =====
revoke all on function public.fin_refunds_after(uuid, bigint) from public, anon, authenticated;
revoke all on function public.fin_allocations_after(uuid, bigint) from public, anon, authenticated;
revoke all on function public.fin_file_ledger_guard() from public, anon, authenticated;
revoke all on function public.fin_receipts_after(uuid, bigint) from public, anon, authenticated;
revoke all on function public.fin_allocation_set(uuid, bigint) from public, anon, authenticated;
revoke all on function public.fin_allocation_approval_valid(public.fin_file_ledger_state) from public, anon, authenticated;
revoke all on function public.fin_ledger_file_effects(public.fin_vouchers, text, text) from public, anon, authenticated;
-- post/reverse تحتفظان بمنح 54 (authenticated فقط)
revoke all on function public.fin_file_refund_status(uuid) from public, anon;
revoke all on function public.enable_fin_file_vouchers() from public, anon;
revoke all on function public.approve_fin_refund_allocation(uuid, bigint, text) from public, anon;
grant execute on function public.fin_file_refund_status(uuid) to authenticated;
grant execute on function public.enable_fin_file_vouchers() to authenticated;
grant execute on function public.approve_fin_refund_allocation(uuid, bigint, text) to authenticated;
-- transition_bsgt_financial_file تحتفظ بمنحها من 53 (authenticated فقط)

-- ===== 6) لا تفعيل هنا =====
do $$ begin
  if public.fin_file_vouchers_enabled() then raise exception 'File-linked vouchers must stay disabled until the deployment review'; end if;
end $$;

notify pgrst, 'reload schema';
commit;

-- ===== 7) Rollback كامل (يعيد دالة الانتقالات إلى نص المرحلة 1 حرفياً) =====
-- begin;
-- drop function if exists public.approve_fin_refund_allocation(uuid, bigint, text);
-- drop function if exists public.enable_fin_file_vouchers();
-- drop function if exists public.fin_file_refund_status(uuid);
-- drop function if exists public.fin_allocations_after(uuid, bigint);
-- drop function if exists public.fin_refunds_after(uuid, bigint);
-- drop function if exists public.fin_ledger_file_effects(public.fin_vouchers, text, text);
-- drop function if exists public.fin_allocation_approval_valid(public.fin_file_ledger_state);
-- drop function if exists public.fin_allocation_set(uuid, bigint);
-- drop function if exists public.fin_receipts_after(uuid, bigint);
-- drop function if exists public.post_fin_voucher(uuid, bigint, text);
-- drop function if exists public.reverse_fin_voucher(uuid, bigint, text);
-- create function public.post_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_override_reason text default null)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare v public.fin_vouchers%rowtype; e public.fin_journal_entries%rowtype; b record; v_uid uuid := auth.uid(); v_note text;
-- begin
--   if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
--   select * into v from public.fin_vouchers where id = p_id;
--   if not found then raise exception 'Voucher not found'; end if;
--   perform public.fin_lock_scope(v);
--   v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
--   if v.status = 'posted' then raise exception 'Voucher is already posted (%)', v.voucher_no; end if;
--   if v.status <> 'draft' then raise exception 'Only draft vouchers can be posted (status %)', v.status; end if;
--   if v.last_input_by = v_uid then                                        -- الفصل بين المُدخل والمُعتمد على آخر من عدّل السند
--     if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
--       raise exception 'Maker-checker: the last person who entered this voucher cannot post it';
--     end if;
--     v_note := 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason);
--   end if;
--   v := public.fin_validate_voucher(v);                                   -- إعادة التحقق تحت الأقفال
--   select * into b from public.fin_build_lines(v);
--   -- المكوّنات المحسوبة (تسوية/إعادة تصنيف) يجب أن تطابق ما راجعه المعتمد في المسودة؛ وإلا تُطلب مراجعة جديدة ولا يُرحّل مبلغ مختلف بصمت
--   if v.voucher_type in ('settlement','failure_reclass') and public.fin_components(v.voucher_type, b.o_details) <> public.fin_components(v.voucher_type, v.details) then
--     raise exception 'Computed components changed since the draft was reviewed (reviewed %, now %); refresh the draft (update_fin_voucher_draft) and review again',
--       public.fin_components(v.voucher_type, v.details), public.fin_components(v.voucher_type, b.o_details);
--   end if;
--   v.voucher_no := public.fin_next_no(v.company_id, public.fin_prefix(v.voucher_type), v.voucher_date);
--   e := public.fin_insert_entry(v, 'post', null, b.o_lines, b.o_total, coalesce(v.memo, v.voucher_type || ' ' || v.voucher_no));
--   perform set_config('jahez.fin_post', 'on', true);
--   update public.fin_vouchers
--      set status = 'posted', voucher_no = v.voucher_no, amount = b.o_total, client_id = v.client_id, purpose = v.purpose,
--          details = b.o_details, journal_entry_id = e.id, posted_seq = e.posting_seq, posted_at = now(), posted_by = v_uid
--    where id = p_id returning * into v;
--   perform set_config('jahez.fin_post', 'off', true);
--   perform public.fin_log('voucher', v.id, 'posted', 'draft', 'posted', v.lock_version, v_note, jsonb_build_object('voucher_no', v.voucher_no, 'entry_no', e.entry_no, 'total', b.o_total::text) || b.o_details);
--   return jsonb_build_object('voucher', public.fin_voucher_json(v), 'entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
-- end $$;
-- create function public.reverse_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_reason text)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare v public.fin_vouchers%rowtype; o public.fin_journal_entries%rowtype; e public.fin_journal_entries%rowtype; later record; v_lines jsonb; dep numeric;
-- begin
--   if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
--   if coalesce(btrim(p_reason), '') = '' then raise exception 'Reversal reason is required'; end if;
--   select * into v from public.fin_vouchers where id = p_id;
--   if not found then raise exception 'Voucher not found'; end if;
--   perform public.fin_lock_scope(v);
--   v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
--   if v.status = 'reversed' then raise exception 'Voucher is already reversed'; end if;
--   if v.status <> 'posted' then raise exception 'Only posted vouchers can be reversed (status %)', v.status; end if;
--   -- (أ) سند مرحّل لاحق (بترتيب الترحيل posted_seq، لا بالوقت) يعتمد على هذا السند ⇒ اعكس اللاحق أولاً
--   select w.voucher_no, w.voucher_type into later from public.fin_vouchers w
--    where w.company_id = v.company_id and w.status = 'posted' and w.id <> v.id and w.posted_seq > v.posted_seq
--      and case v.voucher_type
--        -- قبض/تخصيص وارد: يعتمد عليه كل ما يستهلك أمانة العميل في نفس النطاق (رد، تخصيص صادر)
--        when 'receipt' then w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.financial_file_id
--        when 'balance_transfer' then (w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.target_file_id)
--        -- دفع نيابة: تعتمد عليه التسوية/إعادة التصنيف/التعديل على نفس الملف
--        when 'payment_bank' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
--        when 'payment_permit' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
--        -- التسوية: يعتمد عليها كل ما يقتضي ملفاً مُسوًّى
--        when 'settlement' then w.voucher_type in ('adjustment','recovery','payment_bank','payment_permit') and w.financial_file_id = v.financial_file_id
--        -- إعادة التصنيف: تعتمد عليها الاستردادات من 1500
--        when 'failure_reclass' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
--        -- التعديل: يعتمد عليه ما يدفع/يستردّ/يردّ الفرق بعده على نفس الملف، وأي تعديل لاحق
--        when 'adjustment' then w.voucher_type in ('adjustment','payment_bank','payment_permit','recovery','refund') and w.financial_file_id = v.financial_file_id
--        when 'recovery' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
--        else false end
--    order by w.posted_seq desc limit 1;
--   if found then raise exception 'Reverse the later voucher % (%) first', later.voucher_no, later.voucher_type; end if;
--   -- (ب) أمانة العميل (قبض + تخصيص وارد − رد − تخصيص صادر) يجب ألا تصبح سالبة: سداد مديونية يُعكس بحرية، أما أمانة استُهلكت برد/تخصيص فلا
--   if v.voucher_type = 'receipt' then
--     dep := public.fin_client_deposit(v.client_id, v.financial_file_id);
--     if dep - v.amount < 0 then raise exception 'Receipt was already consumed by a later refund/allocation (deposit %, receipt %)', dep, v.amount; end if;
--   elsif v.voucher_type = 'balance_transfer' then
--     dep := public.fin_client_deposit(v.client_id, v.target_file_id);
--     if dep - v.amount < 0 then raise exception 'Allocated balance was already consumed on the target file (deposit %)', dep; end if;
--   end if;
--   -- الدفع نيابة وإعادة التصنيف: الاعتمادية تُحسم بالترتيب (أ) فقط — لا بصافي حساب التكلفة، لأن الصافي يكون صفراً
--   -- بعد التسوية عندما يُدفع فرق سبق تحميله (adjustment) ثم يُعكس الدفع بحق
--   select * into o from public.fin_journal_entries where id = v.journal_entry_id;
--   select coalesce(jsonb_agg(public.fin_ln(l.account_id, l.debit, l.credit, l.client_id, l.financial_file_id, l.memo) order by l.line_no), '[]'::jsonb)
--     into v_lines from public.fin_journal_lines l where l.entry_id = o.id;
--   e := public.fin_insert_entry(v, 'reversal', o.id, v_lines, o.total_debit, 'reversal of ' || o.entry_no || ': ' || btrim(p_reason));
--   perform set_config('jahez.fin_post', 'on', true);
--   update public.fin_vouchers set status = 'reversed', reversal_entry_id = e.id, reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
--    where id = p_id returning * into v;
--   perform set_config('jahez.fin_post', 'off', true);
--   perform public.fin_log('voucher', v.id, 'reversed', 'posted', 'reversed', v.lock_version, btrim(p_reason), jsonb_build_object('original_entry_no', o.entry_no, 'reversal_entry_no', e.entry_no));
--   return jsonb_build_object('voucher', public.fin_voucher_json(v), 'reversal_entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
-- end $$;
-- revoke all on function public.post_fin_voucher(uuid, bigint, text) from public, anon; grant execute on function public.post_fin_voucher(uuid, bigint, text) to authenticated;
-- revoke all on function public.reverse_fin_voucher(uuid, bigint, text) from public, anon; grant execute on function public.reverse_fin_voucher(uuid, bigint, text) to authenticated;
-- alter table public.fin_file_ledger_state drop constraint if exists fin_file_ledger_refund_check;
-- alter table public.fin_file_ledger_state
--   drop column if exists refund_allocation_reason, drop column if exists refund_allocation_approved_by, drop column if exists refund_allocation_approved_at,
--   drop column if exists refund_allocated_sdg, drop column if exists refund_allocation_voucher_ids, drop column if exists refund_allocation_lock_versions, drop column if exists refund_due_seq, drop column if exists refund_due_at, drop column if exists refund_due_sdg;
-- create or replace function public.fin_file_ledger_guard()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   new.updated_by := coalesce(auth.uid(), old.updated_by); new.updated_at := now(); new.lock_version := old.lock_version + 1;
--   new.financial_file_id := old.financial_file_id; new.company_id := old.company_id; new.ledger_mode := old.ledger_mode;
--   new.opened_at := old.opened_at; new.opened_by := old.opened_by;
--   if old.delivery_confirmed_at is not null and (new.delivery_confirmed_at is distinct from old.delivery_confirmed_at or new.delivery_confirmed_by is distinct from old.delivery_confirmed_by) then
--     raise exception 'Delivery confirmation cannot be changed once recorded';
--   end if;
--   if (new.approved_bank_cost_sdg is distinct from old.approved_bank_cost_sdg or new.approved_permit_cost_sdg is distinct from old.approved_permit_cost_sdg)
--      and public.fin_file_has_posted(old.financial_file_id, 'settlement') then
--     raise exception 'Approved costs are frozen after settlement; use a cost adjustment voucher';
--   end if;
--   return new;
-- end $$;
-- alter table public.bsgt_financial_file_events drop constraint bsgt_financial_file_events_event_type_check;
-- alter table public.bsgt_financial_file_events add constraint bsgt_financial_file_events_event_type_check check (event_type in ('created','draft_updated','bank_details_updated','invoices_synced',
--     'invoice_confirmed','client_confirmed','approved','reopened','client_transfer_confirmed','bank_payment_confirmed',
--     'completed','failed','refund_started','refunded','closed'));
-- alter table public.bsgt_financial_files drop constraint bff_state_stamps_check;
-- alter table public.bsgt_financial_files add constraint bff_state_stamps_check check (
--     (status = 'draft' and approved_at is null and client_transferred_at is null and bank_paid_at is null
--        and completed_at is null and failed_at is null and refund_started_at is null and refunded_at is null and closed_at is null)
--     or (status = 'pending_client_transfer' and approved_at is not null and client_transferred_at is null and bank_paid_at is null and failed_at is null and closed_at is null)
--     or (status = 'client_transferred' and approved_at is not null and client_transferred_at is not null and bank_paid_at is null and failed_at is null and closed_at is null)
--     or (status = 'bank_paid' and approved_at is not null and client_transferred_at is not null and bank_paid_at is not null and completed_at is null and failed_at is null and closed_at is null)
--     or (status = 'completed' and approved_at is not null and client_transferred_at is not null and bank_paid_at is not null and completed_at is not null and failed_at is null)
--     or (status = 'failed' and failed_at is not null and refund_started_at is null and refunded_at is null
--        and (closed_at is null or client_transferred_at is null))
--     or (status = 'refund_in_progress' and failed_at is not null and client_transferred_at is not null and refund_started_at is not null and refunded_at is null and closed_at is null)
--     or (status = 'refunded' and failed_at is not null and client_transferred_at is not null and refund_started_at is not null and refunded_at is not null)
-- );
-- drop function if exists public.transition_bsgt_financial_file(uuid, bigint, text, text, text);
-- create function public.transition_bsgt_financial_file(p_id uuid, p_expected_lock_version bigint, p_action text, p_note text default null, p_override_reason text default null)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare f public.bsgt_financial_files%rowtype; t public.trade_collection_files%rowtype; v_from text; v_to text; v_event text; v_note text := p_note; v_uid uuid := auth.uid();
-- begin
--   if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
--   f := public.bsgt_financial_lock(p_id, p_expected_lock_version, null);   -- يرفض المقفل
--   v_from := f.status;
--   perform set_config('jahez.financial_transition', 'on', true);
--   case
--     when p_action = 'approve' and f.status = 'draft' then
--       t := public.bsgt_financial_assert_eligible(f.trade_file_id);      -- إعادة فحص الأهلية (بند 4)
--       if exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_id and i.detached_at is null and i.amount_usd is null) then
--         raise exception 'Unconfirmed invoice amounts remain'; end if;
--       if f.invoice_total_usd is null or f.invoice_total_usd <= 0 then raise exception 'Confirmed invoice total must be positive'; end if;
--       -- عضوية الفواتير = روابط TC: نفس العدد، لا تكرار، نفس المجموعة (v4.1-6)
--       if (select count(*) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
--          <> (select count(*) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id)
--          or (select count(*) - count(distinct shipment_id) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null) <> 0
--          or (select count(*) - count(distinct shipment_id) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) <> 0
--          or (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
--          <> (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) then
--         raise exception 'Trade file shipments changed; run invoice sync before approval'; end if;
--       -- لقطة المستلمين تمثل الشحنات الحالية (v4.1-1)
--       if array_to_string(public.bsgt_financial_consignees(f.trade_file_id), ' | ') <> f.consignee_snapshot
--          or cardinality(public.bsgt_financial_consignees(f.trade_file_id)) <> f.consignee_count then
--         raise exception 'Consignee snapshot is stale; run invoice sync before approval'; end if;
--       if f.bank_tariff_per_1000_sdg is null or f.bsgt_tariff_per_1000_sdg is null then raise exception 'Both tariffs are required'; end if;
--       if f.import_permit_source is null then raise exception 'Import permit source is required'; end if;
--       if f.import_permit_source = 'client' and coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Client-provided import permit number is required before approval'; end if;
--       if f.client_id is null then raise exception 'Billing client must be confirmed'; end if;
--       if not f.calculation_ready then raise exception 'Cost calculation is incomplete'; end if;
--       if f.last_input_by = v_uid then                                    -- maker-checker (بند 1، قرار د)
--         if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
--           raise exception 'Maker-checker: the last person who entered financial data cannot approve it';
--         end if;
--         v_note := concat_ws(' | ', p_note, 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason));
--       end if;
--       v_to := 'pending_client_transfer'; v_event := 'approved';
--       update public.bsgt_financial_files set status = v_to, approved_at = now(), approved_by = v_uid where id = p_id returning * into f;
--     when p_action = 'reopen' and f.status = 'pending_client_transfer' then
--       v_to := 'draft'; v_event := 'reopened';
--       update public.bsgt_financial_files set status = v_to, approved_at = null, approved_by = null where id = p_id returning * into f;
--     when p_action = 'confirm_client_transfer' and f.status = 'pending_client_transfer' then
--       v_to := 'client_transferred'; v_event := 'client_transfer_confirmed';
--       update public.bsgt_financial_files set status = v_to, client_transferred_at = now(), client_transferred_by = v_uid where id = p_id returning * into f;
--     when p_action = 'confirm_bank_payment' and f.status = 'client_transferred' then
--       if coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Import permit number is required before bank payment'; end if;   -- قرار ب
--       if f.documents_value_aed is null or f.documents_value_aed <= 0 then raise exception 'Bank documents value (AED) must be entered before bank payment'; end if;  -- بند 11
--       v_to := 'bank_paid'; v_event := 'bank_payment_confirmed';
--       update public.bsgt_financial_files set status = v_to, bank_paid_at = now(), bank_paid_by = v_uid where id = p_id returning * into f;
--     when p_action = 'complete' and f.status = 'bank_paid' then
--       select * into t from public.trade_collection_files where id = f.trade_file_id;
--       if t.status <> 'sent_to_collecting' then raise exception 'Trade file must be sent to the collecting bank first'; end if;   -- قرار ج
--       v_to := 'completed'; v_event := 'completed';
--       update public.bsgt_financial_files set status = v_to, completed_at = now(), completed_by = v_uid where id = p_id returning * into f;
--     when p_action = 'fail' and f.status in ('draft','pending_client_transfer','client_transferred','bank_paid') then
--       if coalesce(btrim(p_note), '') = '' then raise exception 'Failure reason is required'; end if;
--       v_to := 'failed'; v_event := 'failed';                             -- لا أختام اعتماد وهمية (بند 9)
--       update public.bsgt_financial_files set status = v_to, failed_at = now(), failed_by = v_uid, failure_reason = btrim(p_note) where id = p_id returning * into f;
--     when p_action = 'start_refund' and f.status = 'failed' and f.client_transferred_at is not null then
--       v_to := 'refund_in_progress'; v_event := 'refund_started';
--       update public.bsgt_financial_files set status = v_to, refund_started_at = now(), refund_started_by = v_uid where id = p_id returning * into f;
--     when p_action = 'confirm_refund' and f.status = 'refund_in_progress' then
--       v_to := 'refunded'; v_event := 'refunded';
--       update public.bsgt_financial_files set status = v_to, refunded_at = now(), refunded_by = v_uid where id = p_id returning * into f;
--     when p_action = 'close' and (f.status in ('completed','refunded') or (f.status = 'failed' and f.client_transferred_at is null)) then
--       v_to := f.status; v_event := 'closed';
--       update public.bsgt_financial_files set closed_at = now(), closed_by = v_uid where id = p_id returning * into f;
--     else
--       raise exception 'Transition % is not allowed from status %', p_action, f.status;
--   end case;
--   perform set_config('jahez.financial_transition', 'off', true);
--   perform public.bsgt_financial_log(p_id, v_event, v_from, v_to, v_note, null);
--   return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'event_type', v_event);
-- end $$;
-- revoke all on function public.transition_bsgt_financial_file(uuid, bigint, text, text, text) from public, anon;
-- grant execute on function public.transition_bsgt_financial_file(uuid, bigint, text, text, text) to authenticated;
-- notify pgrst, 'reload schema';
-- commit;
