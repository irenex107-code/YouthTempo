-- S04_R03: local implementation artifact only. NOT APPLIED to any database.
-- Installing this migration intentionally closes SWEET writes/token issuance.
-- Preflight, backfill and reopening require separate database-operation approval.
-- No source data is backfilled, deleted, or rewritten by this migration.

create table private.sweet_record_heads (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_day date not null check (isfinite(business_day)),
  head_token uuid not null,
  current_record_id uuid unique references public.sweet_records(id)
    on delete no action deferrable initially deferred,
  primary key (user_id, business_day),
  check (current_record_id is null or current_record_id = head_token)
);
alter table private.sweet_record_heads enable row level security;
revoke all on private.sweet_record_heads from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant select, insert, update on private.sweet_record_heads to service_role;

-- Operational barrier only: no actor, content, request history, or retention data.
create table private.sweet_protocol_control (
  singleton boolean primary key default true check (singleton),
  phase text not null check (phase in ('closed', 'open'))
);
alter table private.sweet_protocol_control enable row level security;
revoke all on private.sweet_protocol_control from public, anon, authenticated, service_role;
grant select, update on private.sweet_protocol_control to service_role;
insert into private.sweet_protocol_control(singleton, phase) values (true, 'closed');

create function private.sweet_require_service()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'sweet_service_required' using errcode = '42501';
  end if;
  if nullif(current_setting('request.method',true),'') is not null
    and current_setting('request.method',true)<>'POST' then
    raise exception 'sweet_post_required' using errcode='25006'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'sweet_read_committed_required' using errcode = '25001';
  end if;
end;
$$;

-- Match the TypeScript DTO's UTF-16 code-unit limits without normalizing text.
create function private.sweet_text_units(p_text text)
returns bigint language sql immutable security invoker set search_path='' as $$
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0)
  from regexp_split_to_table(coalesce(p_text,''),'') chars(ch) where ch<>'';
$$;

create function private.sweet_records_shape(p_records jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare s jsonb; f jsonb; ids text[] := '{}'; fields_seen text[];
begin
  if jsonb_typeof(p_records) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_records) <> 5 then return false; end if;
  for s in select value from jsonb_array_elements(p_records) loop
    if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'id') is distinct from 'string'
      or jsonb_typeof(s->'title') is distinct from 'string' or jsonb_typeof(s->'label') is distinct from 'string'
      or jsonb_typeof(s->'fields') is distinct from 'array'
      or private.sweet_text_units(s->>'title')>2000 or private.sweet_text_units(s->>'label')>2000 then return false; end if;
    if exists(select 1 from jsonb_object_keys(s) keys(name) where name not in ('id','title','label','fields')) then return false; end if;
    if s->>'id' not in ('sleep','wake','eat','exercise','task') or (s->>'id') = any(ids)
      or jsonb_array_length(s->'fields') = 0 or jsonb_array_length(s->'fields')>30 then return false; end if;
    ids := array_append(ids,s->>'id');
    fields_seen := '{}';
    for f in select value from jsonb_array_elements(s->'fields') loop
      if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'id') is distinct from 'string'
        or jsonb_typeof(f->'title') is distinct from 'string' or private.sweet_text_units(f->>'title')>2000
        or private.sweet_text_units(f->>'id') not between 1 and 100 or (f->>'id')=any(fields_seen) then return false; end if;
      if exists(select 1 from jsonb_object_keys(f) keys(name) where name not in ('id','title','value')) then return false; end if;
      fields_seen:=array_append(fields_seen,f->>'id');
      if jsonb_typeof(f->'value') = 'array' then
        if jsonb_array_length(f->'value')>100 or exists(select 1 from jsonb_array_elements(f->'value') elem(value)
          where jsonb_typeof(elem.value) <> 'string' or private.sweet_text_units(elem.value#>>'{}')>10000) then return false; end if;
      elsif jsonb_typeof(f->'value') is distinct from 'string' or private.sweet_text_units(f->>'value')>10000 then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

create function private.sweet_context(p_mode text, p_actor uuid default null, p_day date default null,
  p_new_id uuid default null, p_cutoff timestamptz default null)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare prior text := current_setting('youthtempo.sweet_cas',true);
begin
  perform private.sweet_require_service();
  perform set_config('youthtempo.sweet_cas',jsonb_build_object('mode',p_mode,'actor',p_actor,
    'day',p_day,'newId',p_new_id,'cutoff',p_cutoff,'txid',txid_current()::text)::text,true);
  return coalesce(prior,'');
end;
$$;

create function private.sweet_dml_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare c jsonb; owner_id uuid; local_day date; r jsonb;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  owner_id := (r->>'user_id')::uuid;
  -- Only genuine parent removal, never a blanket service/trigger-depth bypass.
  if tg_op='DELETE' and current_user in ('supabase_auth_admin','postgres','supabase_admin')
    and not exists(select 1 from auth.users where id=owner_id) then return old; end if;
  if tg_table_schema='public' and tg_op='UPDATE'
    and current_user in ('service_role','postgres','supabase_admin')
    and (to_jsonb(new)-'school_id')=(to_jsonb(old)-'school_id') then return new; end if;
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  begin c := nullif(current_setting('youthtempo.sweet_cas',true),'')::jsonb;
  exception when invalid_text_representation then raise exception 'sweet_protocol_required' using errcode='42501'; end;
  if c is null or c->>'txid' is distinct from txid_current()::text then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  if tg_table_schema='private' and c->>'mode'='backfill' and tg_op='INSERT'
    and exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then return new; end if;
  local_day := case when tg_table_schema='public' then ((r->>'created_at')::timestamptz at time zone 'Asia/Shanghai')::date
    else (r->>'business_day')::date end;
  if c->>'mode' is distinct from 'cas' or c->>'actor' is distinct from owner_id::text
    or c->>'day' is distinct from local_day::text then
    raise exception 'sweet_protocol_required' using errcode='42501'; end if;
  if tg_table_schema='private' and tg_op='DELETE' then
    raise exception 'sweet_tombstone_removal_forbidden' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.user_id is distinct from old.user_id
    or (tg_table_schema='private' and r->>'business_day' is distinct from to_jsonb(old)->>'business_day')) then
    raise exception 'sweet_owner_immutable' using errcode='42501'; end if;
  if tg_table_schema='private' and c->>'mode'='cas' then
    if tg_op='INSERT' and (c->>'newId' is distinct from new.head_token::text
      or new.current_record_id is distinct from new.head_token) then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
    if tg_op='UPDATE' and not ((new.head_token=old.head_token and new.current_record_id is null)
      or(c->>'newId' is not null and c->>'newId'=new.head_token::text and(new.current_record_id is null or new.current_record_id=new.head_token))) then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
  end if;
  if tg_table_schema='public' then
    if tg_op='UPDATE' then raise exception 'sweet_source_immutable' using errcode='42501'; end if;
    if tg_op='INSERT' and c->>'newId' is distinct from new.id::text then
      raise exception 'sweet_protocol_target_mismatch' using errcode='42501'; end if;
    if tg_op='DELETE' and (c->>'cutoff' is null or old.created_at > (c->>'cutoff')::timestamptz) then
      raise exception 'sweet_protocol_cutoff_mismatch' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create function private.sweet_control_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare c jsonb;
begin
  perform private.sweet_require_service();
  c := nullif(current_setting('youthtempo.sweet_cas',true),'')::jsonb;
  if c is null or c->>'mode' is distinct from 'control' or c->>'txid' is distinct from txid_current()::text then
    raise exception 'sweet_control_protocol_required' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger sweet_control_write_guard before update on private.sweet_protocol_control
for each row execute function private.sweet_control_guard();
create trigger sweet_head_report_lock before insert or update or delete on private.sweet_record_heads
for each statement execute function public.report_dependency_write_lock();
create trigger sweet_head_write_guard before insert or update or delete on private.sweet_record_heads
for each row execute function private.sweet_dml_guard();
create trigger sweet_source_write_guard before insert or update or delete on public.sweet_records
for each row execute function private.sweet_dml_guard();
revoke insert, delete on public.sweet_records from authenticated;
revoke truncate on public.sweet_records from service_role;

create function private.sweet_head_valid(p_actor uuid,p_day date)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare h record; r record; source_count bigint; latest_time timestamptz; latest_count bigint;
begin
  select * into h from private.sweet_record_heads where user_id=p_actor and business_day=p_day;
  select count(*),max(created_at) into source_count,latest_time from public.sweet_records
    where user_id=p_actor and created_at >= (p_day::timestamp at time zone 'Asia/Shanghai')
      and created_at < ((p_day+1)::timestamp at time zone 'Asia/Shanghai');
  if h.user_id is null then return source_count=0; end if;
  if h.current_record_id is null then return source_count=0; end if;
  select * into r from public.sweet_records where id=h.current_record_id;
  if r.id is null or r.user_id<>p_actor or not isfinite(r.created_at)
    or (r.created_at at time zone 'Asia/Shanghai')::date<>p_day or r.id<>h.head_token
    or r.created_at<>latest_time then return false; end if;
  select count(*) into latest_count from public.sweet_records where user_id=p_actor and created_at=latest_time;
  return latest_count=1;
end;
$$;

create function private.sweet_integrity_after_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare r jsonb; actor uuid; d date;
begin
  r := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  actor := (r->>'user_id')::uuid;
  if tg_op='DELETE' and current_user in ('supabase_auth_admin','postgres','supabase_admin')
    and not exists(select 1 from auth.users where id=actor) then return null; end if;
  if tg_table_schema='public' and tg_op='UPDATE' and (to_jsonb(new)-'school_id')=(to_jsonb(old)-'school_id') then return null; end if;
  d := case when tg_table_schema='public' then ((r->>'created_at')::timestamptz at time zone 'Asia/Shanghai')::date
    else (r->>'business_day')::date end;
  if not private.sweet_head_valid(actor,d) then
    raise exception 'sweet_head_inconsistent' using errcode='23514'; end if;
  return null;
end;
$$;
create constraint trigger sweet_head_integrity after insert or update or delete on private.sweet_record_heads
  deferrable initially deferred for each row execute function private.sweet_integrity_after_write();
create constraint trigger sweet_source_head_integrity after insert or update or delete on public.sweet_records
  deferrable initially deferred for each row execute function private.sweet_integrity_after_write();

create function private.sweet_packet(p_status text,p_actor uuid,p_day date,p_now timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',p_status,'operationDay',(p_now at time zone 'Asia/Shanghai')::date,
    'targetDay',p_day,'headToken',h.head_token,'record',to_jsonb(r))
  from (select 1) seed left join private.sweet_record_heads h on h.user_id=p_actor and h.business_day=p_day
    left join public.sweet_records r on r.id=h.current_record_id;
$$;

create function public.sweet_scope_read(p_actor_user_id uuid,p_target_day date default null)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare n timestamptz; d date;
begin
  perform private.sweet_require_service();
  perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='open') then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  if not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied'); end if;
  n:=clock_timestamp();d:=coalesce(p_target_day,(n at time zone 'Asia/Shanghai')::date);
  if not isfinite(d) or not private.sweet_head_valid(p_actor_user_id,d) then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  return private.sweet_packet('ready',p_actor_user_id,d,n);
end;
$$;

create function public.sweet_scope_write(p_actor_user_id uuid,p_operation_day date,p_target_day date,
  p_expected_head uuid,p_intent text,p_records jsonb,p_summary text,p_small_step text,
  p_recommended_next_tool text,p_record_id uuid default null,p_student_only boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare h record; r record; t record; role_name text; school uuid; n timestamptz; d date; prior text;
  next_id uuid; summary_value text; step_value text; tool_value text; cutoff timestamptz;
  is_delete boolean := coalesce(p_intent in ('delete_day','delete_record_cutoff'),false);
begin
  perform private.sweet_require_service();
  perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='open') then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  if not exists(select 1 from auth.users where id=p_actor_user_id) then return jsonb_build_object('status','denied'); end if;
  if p_intent is null or p_intent not in ('preserve_summary','replace_summary','clear_summary','delete_day','delete_record_cutoff') then
    return jsonb_build_object('status','invalid_request'); end if;
  select role,school_id into role_name,school from public.profiles where id=p_actor_user_id;
  if not is_delete and (p_student_only and role_name is distinct from '学生') then
    return jsonb_build_object('status','denied'); end if;
  if not is_delete and (role_name is null or role_name='学生') and not exists(
    select 1 from public.student_consents c where c.student_user_id=p_actor_user_id
      and c.policy_version='2026-08-28' and c.status='active' and c.student_assented_at is not null
      and ((c.age_band='18_plus' and c.consent_basis='adult_self')
        or(c.age_band='14_17' and c.consent_basis='student_self_pilot')
        or(c.age_band='14_17' and c.consent_basis='student_guardian' and c.guardian_user_id is not null and c.guardian_consented_at is not null))
    ) then return jsonb_build_object('status','denied'); end if;
  if p_target_day is null or not isfinite(p_target_day) or not private.sweet_head_valid(p_actor_user_id,p_target_day) then
    return jsonb_build_object('status','protocol_unavailable'); end if;
  select * into h from private.sweet_record_heads where user_id=p_actor_user_id and business_day=p_target_day for update;
  n:=clock_timestamp();d:=(n at time zone 'Asia/Shanghai')::date;
  if p_operation_day is distinct from d or (not is_delete and p_target_day<>d) then
    return private.sweet_packet('scope_expired',p_actor_user_id,p_target_day,n); end if;
  if h.head_token is distinct from p_expected_head then
    return private.sweet_packet('conflict',p_actor_user_id,p_target_day,n); end if;
  if p_intent not in ('preserve_summary','replace_summary','clear_summary','delete_day','delete_record_cutoff') then
    return jsonb_build_object('status','invalid_request'); end if;
  select * into r from public.sweet_records where id=h.current_record_id;
  if is_delete then
    select * into t from public.sweet_records where id=p_record_id and user_id=p_actor_user_id
      and (created_at at time zone 'Asia/Shanghai')::date=p_target_day;
    if t.id is null or h.current_record_id is null then return private.sweet_packet('not_found',p_actor_user_id,p_target_day,n); end if;
    cutoff:=case when p_intent='delete_day' then 'infinity'::timestamptz else t.created_at end;
    next_id:=case when p_intent='delete_day' or t.id=h.current_record_id then gen_random_uuid() else null end;
    prior:=private.sweet_context('cas',p_actor_user_id,p_target_day,next_id,cutoff);
    if p_intent='delete_day' or t.id=h.current_record_id then
      update private.sweet_record_heads set current_record_id=null,head_token=next_id
        where user_id=p_actor_user_id and business_day=p_target_day;
    end if;
    delete from public.sweet_records where user_id=p_actor_user_id
      and created_at >= (p_target_day::timestamp at time zone 'Asia/Shanghai')
      and created_at < ((p_target_day+1)::timestamp at time zone 'Asia/Shanghai') and created_at<=cutoff;
    perform set_config('youthtempo.sweet_cas',prior,true);
    return private.sweet_packet('accepted',p_actor_user_id,p_target_day,n);
  end if;
  if not private.sweet_records_shape(p_records) or octet_length(p_records::text)>60000
    or private.sweet_text_units(p_summary)>20000 or private.sweet_text_units(p_small_step)>20000
    or private.sweet_text_units(p_recommended_next_tool)>20000 then return jsonb_build_object('status','invalid_request'); end if;
  summary_value:=nullif(p_summary,'');step_value:=nullif(p_small_step,'');tool_value:=nullif(p_recommended_next_tool,'');
  if p_intent='replace_summary' and summary_value is null and step_value is null and tool_value is null then
    return jsonb_build_object('status','invalid_request'); end if;
  if p_intent='preserve_summary' and r.id is not null then
    if r.records<>p_records then return private.sweet_packet('conflict',p_actor_user_id,p_target_day,n); end if;
    summary_value:=nullif(r.summary,'');step_value:=nullif(r.small_step,'');tool_value:=nullif(r.recommended_next_tool,'');
  elsif p_intent='preserve_summary' or p_intent='clear_summary' then
    summary_value:=null;step_value:=null;tool_value:=null;
  end if;
  if r.id is not null and r.records=p_records and nullif(r.summary,'') is not distinct from summary_value
    and nullif(r.small_step,'') is not distinct from step_value and nullif(r.recommended_next_tool,'') is not distinct from tool_value then
    return private.sweet_packet('noop',p_actor_user_id,p_target_day,n); end if;
  next_id:=gen_random_uuid();prior:=private.sweet_context('cas',p_actor_user_id,p_target_day,next_id,'infinity'::timestamptz);
  -- All statements below commit or roll back together. Never catch-and-return after a partial write.
  update private.sweet_record_heads set current_record_id=null where user_id=p_actor_user_id and business_day=p_target_day;
  delete from public.sweet_records where user_id=p_actor_user_id
    and created_at >= (p_target_day::timestamp at time zone 'Asia/Shanghai')
    and created_at < ((p_target_day+1)::timestamp at time zone 'Asia/Shanghai');
  insert into public.sweet_records(id,user_id,school_id,records,summary,small_step,recommended_next_tool,created_at)
    values(next_id,p_actor_user_id,school,p_records,summary_value,step_value,tool_value,n);
  if h.user_id is null then
    insert into private.sweet_record_heads(user_id,business_day,head_token,current_record_id)
      values(p_actor_user_id,p_target_day,next_id,next_id);
  else
    update private.sweet_record_heads set head_token=next_id,current_record_id=next_id
      where user_id=p_actor_user_id and business_day=p_target_day;
  end if;
  perform set_config('youthtempo.sweet_cas',prior,true);
  return private.sweet_packet('accepted',p_actor_user_id,p_target_day,n);
end;
$$;

-- Snapshot-wide audit; only aggregate, non-content issue counts leave this function.
create function private.sweet_protocol_audit(p_require_heads boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare issues jsonb:='[]'; n bigint; sources bigint; scopes bigint; follows bigint;
begin
  select count(*) into sources from public.sweet_records;
  select count(distinct (user_id,(created_at at time zone 'Asia/Shanghai')::date)) into scopes
    from public.sweet_records where isfinite(created_at);
  select count(*) into follows from public.school_followups;
  select count(*) into n from public.sweet_records r where r.created_at is null or not isfinite(r.created_at)
    or abs(extract(epoch from r.created_at)*1000000)>9007199254740991
    or (r.created_at at time zone 'Asia/Shanghai')::date not between date '0001-01-01' and date '9999-12-31';
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_time','count',n)); end if;
  select count(*) into n from public.sweet_records r where not private.sweet_records_shape(r.records)
    or octet_length(r.records::text)>60000 or private.sweet_text_units(r.summary)>20000
    or private.sweet_text_units(r.small_step)>20000 or private.sweet_text_units(r.recommended_next_tool)>20000;
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','invalid_payload','count',n)); end if;
  select count(*) into n from public.sweet_records r where not exists(select 1 from auth.users u where u.id=r.user_id);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','missing_auth_owner','count',n)); end if;
  select count(*) into n from (
    select user_id,local_day from (
      select user_id,created_at,(created_at at time zone 'Asia/Shanghai')::date local_day,
        max(created_at) over(partition by user_id,(created_at at time zone 'Asia/Shanghai')::date) latest
      from public.sweet_records where isfinite(created_at)
    ) versions where created_at=latest group by user_id,local_day having count(*)>1
  ) ties;
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','latest_time_tie','count',n)); end if;
  select count(*) into n from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid='public.sweet_records'::regclass
    and not (c.convalidated and ((c.conrelid='public.school_followups'::regclass
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='record_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[] and c.confdeltype='c')
      or(c.conrelid='private.sweet_record_heads'::regclass
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='current_record_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
      and c.confdeltype='a' and c.condeferrable and c.condeferred)));
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','unknown_incoming_fk','count',n)); end if;
  select count(distinct (c.conrelid,c.confrelid)) into n from pg_catalog.pg_constraint c where c.contype='f' and c.convalidated
    and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
    and ((c.conrelid='public.sweet_records'::regclass and c.confrelid='auth.users'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='user_id')]::smallint[])
    or(c.conrelid='private.sweet_record_heads'::regclass and c.confrelid='auth.users'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='user_id')]::smallint[])
    or(c.conrelid='private.sweet_record_heads'::regclass and c.confrelid='public.sweet_records'::regclass and c.confdeltype='a'
      and c.condeferrable and c.condeferred
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='current_record_id')]::smallint[])
    or(c.conrelid='public.school_followups'::regclass and c.confrelid='public.sweet_records'::regclass and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid=c.conrelid and attname='record_id')]::smallint[]));
  if n<>4 then issues:=issues||jsonb_build_array(jsonb_build_object('code','required_fk_inventory_incomplete','count',n)); end if;
  select count(*) into n from public.school_followups f where not exists(select 1 from public.sweet_records r where r.id=f.record_id);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','orphan_followup','count',n)); end if;
  select count(*) into n from private.sweet_record_heads h where not private.sweet_head_valid(h.user_id,h.business_day);
  if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','head_inconsistent','count',n)); end if;
  if p_require_heads then
    select count(*) into n from (select distinct user_id,(created_at at time zone 'Asia/Shanghai')::date d
      from public.sweet_records where isfinite(created_at)) s
      where not exists(select 1 from private.sweet_record_heads h where h.user_id=s.user_id and h.business_day=s.d);
    if n>0 then issues:=issues||jsonb_build_array(jsonb_build_object('code','head_missing','count',n)); end if;
  end if;
  return jsonb_build_object('status',case when jsonb_array_length(issues)=0 then 'ready' else 'blocked' end,
    'counts',jsonb_build_object('sources',sources,'scopes',scopes,'schoolFollowups',follows),'issues',issues);
end;
$$;

create function public.sweet_scope_preflight()
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','barrier_not_closed'))); end if;
  return private.sweet_protocol_audit(false);
end;
$$;

create function public.sweet_scope_backfill(p_reviewed_dependency_impacts boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare audit jsonb; prior text; changed bigint;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    raise exception 'sweet_barrier_not_closed' using errcode='55000'; end if;
  audit:=private.sweet_protocol_audit(false);
  if audit->>'status'<>'ready' then return audit; end if;
  if (audit#>>'{counts,schoolFollowups}')::bigint>0 and p_reviewed_dependency_impacts is not true then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','dependency_review_required'))); end if;
  prior:=private.sweet_context('backfill');
  insert into private.sweet_record_heads(user_id,business_day,head_token,current_record_id)
    select r.user_id,(r.created_at at time zone 'Asia/Shanghai')::date,r.id,r.id from public.sweet_records r
    where not exists(select 1 from public.sweet_records later where later.user_id=r.user_id
      and (later.created_at at time zone 'Asia/Shanghai')::date=(r.created_at at time zone 'Asia/Shanghai')::date and later.created_at>r.created_at)
    and not exists(select 1 from private.sweet_record_heads h where h.user_id=r.user_id
      and h.business_day=(r.created_at at time zone 'Asia/Shanghai')::date);
  get diagnostics changed=row_count;
  if private.sweet_protocol_audit(true)->>'status'<>'ready' then raise exception 'sweet_backfill_inconsistent' using errcode='23514'; end if;
  perform set_config('youthtempo.sweet_cas',prior,true);
  return jsonb_build_object('status','ready','createdHeads',changed,'audit',private.sweet_protocol_audit(true));
end;
$$;

create function public.sweet_scope_close()
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare prior text;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  prior:=private.sweet_context('control');
  update private.sweet_protocol_control set phase='closed' where singleton;
  perform set_config('youthtempo.sweet_cas',prior,true);return jsonb_build_object('status','closed');
end;
$$;

create function public.sweet_scope_open(p_reviewed_dependency_impacts boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare audit jsonb; prior text;
begin
  perform private.sweet_require_service();perform pg_advisory_xact_lock(73190428,20261027);
  if not exists(select 1 from private.sweet_protocol_control where singleton and phase='closed') then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','barrier_not_closed'))); end if;
  audit:=private.sweet_protocol_audit(true);
  if audit->>'status'<>'ready' then return audit; end if;
  if (audit#>>'{counts,schoolFollowups}')::bigint>0 and p_reviewed_dependency_impacts is not true then
    return jsonb_build_object('status','blocked','issues',jsonb_build_array(jsonb_build_object('code','dependency_review_required'))); end if;
  prior:=private.sweet_context('control');
  update private.sweet_protocol_control set phase='open' where singleton;
  perform set_config('youthtempo.sweet_cas',prior,true);return jsonb_build_object('status','open');
end;
$$;

-- Explicit default/function ACLs: no new callable PUBLIC or authenticated RPC.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('sweet_require_service','sweet_text_units','sweet_records_shape','sweet_context',
      'sweet_dml_guard','sweet_control_guard','sweet_head_valid','sweet_integrity_after_write','sweet_packet','sweet_protocol_audit'))
      or(n.nspname='public' and p.proname in ('sweet_scope_read','sweet_scope_write','sweet_scope_preflight',
        'sweet_scope_backfill','sweet_scope_close','sweet_scope_open')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname not in ('sweet_dml_guard','sweet_control_guard','sweet_integrity_after_write') then
      execute format('grant execute on function %s to service_role',f.signature); end if;
  end loop;
end;
$$;
