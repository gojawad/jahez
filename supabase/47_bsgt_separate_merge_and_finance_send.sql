-- Save an operations package without sending it. Existing revisions remain intact.
-- Apply after 43-46 and before deploying the separate merge/send controls.
begin;

do $$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.bsgt_operations_package_input(uuid)'::regprocedure);
  needle := 'snapshot := to_jsonb(s) - ''updated_at'';';
  replacement := 'snapshot := to_jsonb(s) - array[''updated_at'',''operations_revision_id''];';
  if position(replacement in definition) = 0 then
    if position(needle in definition) = 0 then raise exception 'Unexpected operations snapshot function'; end if;
    definition := replace(definition, needle, replacement);
  end if;
  needle := '''shipment'', snapshot, ''files'', files, ''generated'', readiness->''generated'',';
  replacement := '''workflowVersion'', 2, ' || needle;
  if position(replacement in definition) = 0 then
    if position(needle in definition) = 0 then raise exception 'Unexpected operations snapshot response'; end if;
    definition := replace(definition, needle, replacement);
  end if;
  execute definition;

  definition := pg_get_functiondef('public.approve_bsgt_operations_revision(uuid)'::regprocedure);
  needle := 'set operations_revision_id = r.id, bsgt_stage = ''ready_for_finance''';
  replacement := 'set operations_revision_id = r.id';
  if position(needle in definition) > 0 then
    definition := replace(definition, needle, replacement);
  elsif position(replacement in definition) = 0 then
    raise exception 'Unexpected operations approval function';
  end if;
  definition := replace(definition, '''sentTo'',''finance''', '''stage'',''operations_draft''');
  execute definition;
end;
$$;

create or replace function public.guard_bsgt_revision_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare input jsonb; revision public.bsgt_operations_revisions%rowtype;
begin
  if new.company_id is distinct from public.bsgt_company_id() then return new; end if;
  if old.bsgt_stage='operations_draft' and new.bsgt_stage='ready_for_finance' then
    if new.operations_revision_id is null
      or new.operations_revision_id is distinct from old.operations_revision_id then
      raise exception 'Merge and approve an operations package before sending to finance';
    end if;
    select * into revision from public.bsgt_operations_revisions
      where id=new.operations_revision_id and shipment_id=new.id and approved_at is not null;
    if not found then raise exception 'Merge and approve an operations package before sending to finance'; end if;
    input := public.bsgt_operations_package_input(old.id);
    -- The existing transition trigger adds only the operations completion snapshot.
    if revision.source_fingerprint is distinct from input->>'fingerprint'
      or (new.data - 'bsgtOperationsSnapshot') is distinct from (old.data - 'bsgtOperationsSnapshot')
      or (to_jsonb(new) - array['data','bsgt_stage','bsgt_stage_updated_at','operations_completed_at','operations_completed_by','updated_at'])
        is distinct from (to_jsonb(old) - array['data','bsgt_stage','bsgt_stage_updated_at','operations_completed_at','operations_completed_by','updated_at']) then
      raise exception 'Operations documents changed after merge; merge again before sending to finance';
    end if;
    insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
      jsonb_build_object('action','operations_package_sent_to_finance','shipment',new.id,
        'revision',revision.revision_no,'actor',auth.uid(),'role',public.my_role(),
        'sentTo','finance','at',now())::text);
  end if;
  if old.operations_revision_id is not null and old.bsgt_stage<>'operations_draft'
    and (new.data - array['bsgtFinanceReturn','collectionStatus','collectionSentAt','collectionBatchId','collectionOperationNo',
      'collectionRemittingBank','collectionAmount','collectionDocumentSettings','collectionDocumentKinds','collectionConvertToAed',
      'collectionExchangeRate','commercialCollectionOperations']) is distinct from
    (old.data - array['bsgtFinanceReturn','collectionStatus','collectionSentAt','collectionBatchId','collectionOperationNo',
      'collectionRemittingBank','collectionAmount','collectionDocumentSettings','collectionDocumentKinds','collectionConvertToAed',
      'collectionExchangeRate','commercialCollectionOperations']) then
    raise exception 'Operations data is read only after package approval; return to operations first';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_bsgt_revision_workflow() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
