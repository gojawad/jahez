-- Additive sending-list storage using the existing lookups table and RLS.
begin;
alter table public.lookups add column if not exists linked_address text;
alter table public.lookups add column if not exists active boolean not null default true;

create unique index if not exists lookups_collection_sending_normalized_idx
  on public.lookups (list_key, lower(btrim(value)))
  where list_key like 'collectionSending.%';

create or replace function public.protect_collection_sending_lookup()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then
    if old.list_key like 'collectionSending.%' then raise exception 'Deactivate sending-list values instead of deleting them'; end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.list_key like 'collectionSending.%' and new.list_key is distinct from old.list_key then
    raise exception 'Sending-list type cannot be changed';
  end if;
  if new.list_key like 'collectionSending.%' then
    if new.list_key not in ('collectionSending.remittingBank','collectionSending.remittingBankLetterAddress',
      'collectionSending.remittingBankAddress','collectionSending.remittingBankAccountNo','collectionSending.collectingBankProfile',
      'collectionSending.billOfLadingType','collectionSending.billBy','collectionSending.term','collectionSending.drawer',
      'collectionSending.authorizedPerson','collectionSending.title','collectionSending.draweeAddress') then
      raise exception 'Unknown sending-list type';
    end if;
    new.value=btrim(new.value);
    if new.value='' then raise exception 'Sending-list value is required'; end if;
    if new.list_key='collectionSending.collectingBankProfile' then
      new.linked_address=btrim(coalesce(new.linked_address,''));
      if new.linked_address='' or right(new.value,length(new.linked_address)+3)<>'|||'||new.linked_address then
        raise exception 'A collecting bank must have its linked address';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_collection_sending_lookup on public.lookups;
create trigger protect_collection_sending_lookup before insert or update or delete on public.lookups
  for each row execute function public.protect_collection_sending_lookup();

-- Only defaults already used by the collection portal. No transaction is updated.
insert into public.lookups(list_key,value,linked_address) values
('collectionSending.remittingBank','Abu Dhabi Islamic Bank',null),
('collectionSending.remittingBankLetterAddress','Abu Dhabi, UAE',null),
('collectionSending.remittingBankAddress','BANIYAS BRANCH BUILDING, 2ND FLOOR, BANIYAS EAST, P.O.BOX 313, ABU DHABI, UAE.',null),
('collectionSending.remittingBankAccountNo','19567664',null),
('collectionSending.collectingBankProfile','SAUDI SUDANESE BANK|||MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN','MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN'),
('collectionSending.billOfLadingType','Copy of  Original Bill of Lading',null),
('collectionSending.billBy','Kindly send SWIFT message to collecting bank for docs and share SWIFT copy with us.',null),
('collectionSending.term','D/A 90 DAYS FROM BILL OF EXCHANGE DATE.',null),
('collectionSending.drawer','BAHAR SWAKEN GENERAL TRADING LLC',null),
('collectionSending.authorizedPerson','JAWAD ELMASRI',null),
('collectionSending.title','MANAGER',null)
on conflict do nothing;
commit;
notify pgrst,'reload schema';
