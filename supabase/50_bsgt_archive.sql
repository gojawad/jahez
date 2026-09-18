-- Archive test / non-operational shipments and trade files without deleting anything.
-- Archived rows keep every record, document, event and QR link; the UI simply
-- stops listing them (archived_at is null) and can show them under "الأرشيف".
-- Rules: archiving a trade file archives all of its linked shipments; archiving a
-- shipment archives its trade file only once every linked shipment is archived.
-- Unarchiving reverses the same rule.
begin;

alter table public.shipments
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);
create index if not exists shipments_archived_idx on public.shipments(company_id, archived_at)
  where archived_at is not null;

alter table public.trade_collection_files
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id);

alter table public.trade_collection_file_events
  drop constraint if exists trade_collection_file_events_type_check;
alter table public.trade_collection_file_events
  add constraint trade_collection_file_events_type_check check (event_type in (
    'sent_to_remitting',
    'management_review_started',
    'signed_document_uploaded',
    'signed_document_archived',
    'management_note',
    'returned_to_operations',
    'returned_to_finance',
    'final_accepted',
    'sent_to_collecting',
    'archived',
    'unarchived'
  ));

create or replace function public.set_bsgt_archive(
  p_kind text,
  p_id uuid,
  p_archived boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_stamp timestamptz;
  v_file public.trade_collection_files%rowtype;
  v_shipment public.shipments%rowtype;
  v_file_ids uuid[];
  v_shipment_ids uuid[];
  v_file_id uuid;
begin
  if v_actor is null or not public.is_active() then
    raise exception 'Active session required';
  end if;
  if not (public.is_admin() or public.has_feature_permission('shipments.delete')) then
    raise exception 'Archive permission is required';
  end if;
  v_stamp := case when p_archived then v_now else null end;

  if p_kind = 'shipment' then
    select * into v_shipment from public.shipments where id = p_id for update;
    if not found then raise exception 'Shipment was not found'; end if;
    update public.shipments
      set archived_at = v_stamp, archived_by = case when p_archived then v_actor else null end
      where id = p_id;
    select coalesce(array_agg(distinct link.trade_file_id), '{}'::uuid[]) into v_file_ids
      from public.trade_collection_file_shipments link where link.shipment_id = p_id;
    foreach v_file_id in array v_file_ids loop
      select * into v_file from public.trade_collection_files where id = v_file_id for update;
      if p_archived then
        -- Archive the file once none of its shipments is still active.
        if v_file.archived_at is null and not exists (
          select 1 from public.trade_collection_file_shipments link
          join public.shipments s on s.id = link.shipment_id
          where link.trade_file_id = v_file_id and s.archived_at is null
        ) then
          update public.trade_collection_files set archived_at = v_now, archived_by = v_actor where id = v_file_id;
          insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, note, actor_id, revision_no)
            values (v_file_id, 'archived', v_file.status, v_file.status, 'أرشفة تلقائية بعد أرشفة كل الشحنات المرتبطة', v_actor, v_file.revision_no);
        end if;
      elsif v_file.archived_at is not null then
        update public.trade_collection_files set archived_at = null, archived_by = null where id = v_file_id;
        insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, note, actor_id, revision_no)
          values (v_file_id, 'unarchived', v_file.status, v_file.status, 'إلغاء الأرشفة بعد استعادة شحنة مرتبطة', v_actor, v_file.revision_no);
      end if;
    end loop;
    insert into public.activity_log(user_id, type, text)
      values (v_actor, case when p_archived then 'archive' else 'unarchive' end,
        format('%s الشحنة %s', case when p_archived then 'أرشفة' else 'إلغاء أرشفة' end, coalesce(v_shipment.data->>'operationNo', v_shipment.id::text)));
    return jsonb_build_object('kind', 'shipment', 'id', p_id, 'archived', p_archived, 'tradeFileIds', to_jsonb(v_file_ids));
  end if;

  if p_kind = 'trade_file' then
    select * into v_file from public.trade_collection_files where id = p_id for update;
    if not found then raise exception 'Trade file was not found'; end if;
    select coalesce(array_agg(link.shipment_id), '{}'::uuid[]) into v_shipment_ids
      from public.trade_collection_file_shipments link where link.trade_file_id = p_id;
    update public.trade_collection_files
      set archived_at = v_stamp, archived_by = case when p_archived then v_actor else null end
      where id = p_id;
    update public.shipments
      set archived_at = v_stamp, archived_by = case when p_archived then v_actor else null end
      where id = any(v_shipment_ids);
    insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, note, actor_id, revision_no)
      values (p_id, case when p_archived then 'archived' else 'unarchived' end, v_file.status, v_file.status,
        case when p_archived then 'أرشفة الملف وكل شحناته المرتبطة' else 'إلغاء أرشفة الملف وكل شحناته المرتبطة' end, v_actor, v_file.revision_no);
    insert into public.activity_log(user_id, type, text)
      values (v_actor, case when p_archived then 'archive' else 'unarchive' end,
        format('%s الملف التجاري %s (%s شحنة)', case when p_archived then 'أرشفة' else 'إلغاء أرشفة' end, v_file.operation_no, coalesce(cardinality(v_shipment_ids), 0)));
    return jsonb_build_object('kind', 'trade_file', 'id', p_id, 'archived', p_archived, 'shipmentIds', to_jsonb(v_shipment_ids));
  end if;

  raise exception 'Unknown archive kind: %', p_kind;
end;
$$;

revoke all on function public.set_bsgt_archive(text, uuid, boolean) from public, anon;
grant execute on function public.set_bsgt_archive(text, uuid, boolean) to authenticated;

-- Relations list: archived files stay out of the ready-to-send panel.
create or replace function public.get_bsgt_relations_trade_files(
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  id uuid,
  operation_no text,
  status text,
  revision_no integer,
  remitting_bank text,
  collecting_bank text,
  metadata jsonb,
  final_accepted_at timestamptz,
  sent_to_collecting_at timestamptz,
  shipment_count bigint,
  missing_optional_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_bsgt_workspace_permission('relations', false) then
    raise exception 'BSGT relations view permission is required';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  return query
  with scoped as (
    select trade_file.*,
      (select count(*) from public.trade_collection_file_shipments link where link.trade_file_id = trade_file.id) as linked_count,
      (select count(*) from public.trade_collection_relations_attachments attachment
       where attachment.trade_file_id = trade_file.id
         and attachment.revision_no = trade_file.revision_no and attachment.is_active) as attachment_count
    from public.trade_collection_files trade_file
    where trade_file.company_id = public.bsgt_company_id()
      and trade_file.archived_at is null
      and trade_file.status in ('final_accepted', 'sent_to_collecting')
      and (
        trade_file.status = 'sent_to_collecting'
        or (
          exists (select 1 from public.trade_collection_file_shipments link where link.trade_file_id = trade_file.id)
          and not exists (
            select 1 from public.trade_collection_file_shipments link
            join public.shipments shipment on shipment.id = link.shipment_id
            where link.trade_file_id = trade_file.id
              and (shipment.company_id is distinct from public.bsgt_company_id()
                or shipment.bsgt_stage is distinct from 'final_accepted')
          )
        )
      )
  )
  select scoped.id, scoped.operation_no, scoped.status, scoped.revision_no,
    scoped.remitting_bank, scoped.collecting_bank, scoped.metadata,
    scoped.final_accepted_at, scoped.sent_to_collecting_at,
    scoped.linked_count,
    greatest(scoped.linked_count * 2 - scoped.attachment_count, 0),
    count(*) over()
  from scoped
  order by coalesce(scoped.sent_to_collecting_at, scoped.final_accepted_at, scoped.updated_at) desc
  offset (p_page - 1) * p_page_size limit p_page_size;
end;
$$;

commit;
