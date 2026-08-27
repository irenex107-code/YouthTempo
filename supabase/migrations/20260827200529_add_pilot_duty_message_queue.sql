alter table public.student_messages
  drop constraint if exists student_messages_recipient_type_check,
  drop constraint if exists student_messages_check;

alter table public.student_messages
  add column if not exists duty_status text not null default 'not_applicable',
  add column if not exists duty_updated_at timestamptz,
  add column if not exists duty_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists alert_delivery_status text not null default 'not_requested',
  add column if not exists alert_last_attempt_at timestamptz,
  add constraint student_messages_recipient_type_check
    check (recipient_type in ('teacher', 'guardian', 'self', 'pilot_duty')),
  add constraint student_messages_recipient_check
    check (
      (recipient_type = 'self' and recipient_user_id = sender_user_id and anonymous_to_recipient = false)
      or (recipient_type in ('teacher', 'guardian') and recipient_user_id is not null)
      or (recipient_type = 'pilot_duty' and recipient_user_id is null and anonymous_to_recipient = false)
    ),
  add constraint student_messages_duty_status_check
    check (duty_status in ('not_applicable', 'new', 'in_progress', 'resolved')),
  add constraint student_messages_alert_delivery_status_check
    check (alert_delivery_status in ('not_requested', 'pending', 'sent', 'failed', 'not_configured'));

update public.student_messages
set duty_status = 'new',
    alert_delivery_status = 'not_configured'
where moderation_status = 'safety_review'
  and school_id is null
  and duty_status = 'not_applicable';

create index if not exists student_messages_duty_queue_idx
on public.student_messages (duty_status, created_at desc)
where duty_status <> 'not_applicable';

create table if not exists public.student_message_duty_actions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.student_messages(id) on delete cascade,
  previous_status text not null check (previous_status in ('new', 'in_progress', 'resolved')),
  new_status text not null check (new_status in ('new', 'in_progress', 'resolved')),
  note text not null check (char_length(note) between 1 and 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_message_duty_actions_message_created_idx
on public.student_message_duty_actions (message_id, created_at desc);

alter table public.student_message_duty_actions enable row level security;
revoke all privileges on table public.student_message_duty_actions from anon, authenticated;

create or replace function public.apply_student_message_duty_action(
  p_message_id uuid,
  p_new_status text,
  p_note text,
  p_actor_user_id uuid
)
returns table (
  message_id uuid,
  duty_status text,
  duty_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_updated_at timestamptz := now();
begin
  if p_new_status not in ('new', 'in_progress', 'resolved') then
    raise exception 'invalid_duty_status' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null or char_length(btrim(p_note)) > 500 then
    raise exception 'invalid_duty_note' using errcode = '22023';
  end if;

  select message.duty_status
  into v_previous_status
  from public.student_messages message
  where message.id = p_message_id
    and message.duty_status <> 'not_applicable'
  for update;

  if v_previous_status is null then
    raise exception 'duty_message_not_found' using errcode = 'P0002';
  end if;

  update public.student_messages message
  set duty_status = p_new_status,
      duty_updated_at = v_updated_at,
      duty_updated_by = p_actor_user_id,
      read_at = case
        when p_new_status in ('in_progress', 'resolved') then coalesce(message.read_at, v_updated_at)
        else message.read_at
      end
  where message.id = p_message_id;

  insert into public.student_message_duty_actions (
    message_id,
    previous_status,
    new_status,
    note,
    actor_user_id
  ) values (
    p_message_id,
    v_previous_status,
    p_new_status,
    btrim(p_note),
    p_actor_user_id
  );

  return query select p_message_id, p_new_status, v_updated_at;
end;
$$;

revoke all on function public.apply_student_message_duty_action(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_student_message_duty_action(uuid, text, text, uuid) to service_role;
