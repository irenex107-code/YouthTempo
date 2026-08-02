alter table public.community_reports add column if not exists resolved_at timestamptz;
alter table public.community_reports add column if not exists resolved_by uuid references auth.users(id) on delete set null;

create table if not exists public.community_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('post', 'comment')),
  content_id uuid not null,
  action text not null check (action in ('publish', 'remove')),
  previous_status text not null check (previous_status in ('published', 'safety_review', 'removed')),
  new_status text not null check (new_status in ('published', 'removed')),
  note text not null check (char_length(note) between 1 and 500),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.community_moderation_actions enable row level security;
revoke all on table public.community_moderation_actions from anon, authenticated;
grant all on table public.community_moderation_actions to service_role;

drop policy if exists community_moderation_actions_server_only on public.community_moderation_actions;
create policy community_moderation_actions_server_only on public.community_moderation_actions
for all to authenticated using (false) with check (false);

create index if not exists community_moderation_actions_created_idx
on public.community_moderation_actions(created_at desc);
create index if not exists community_moderation_actions_target_idx
on public.community_moderation_actions(content_type, content_id, created_at desc);
create index if not exists community_moderation_actions_actor_idx
on public.community_moderation_actions(actor_user_id, created_at desc);

create or replace function public.apply_community_moderation(
  p_content_type text,
  p_content_id uuid,
  p_action text,
  p_note text,
  p_actor_user_id uuid
)
returns table(action_id uuid, previous_status text, new_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_new_status text;
  v_action_id uuid;
begin
  if p_content_type not in ('post', 'comment') then raise exception 'invalid_content_type'; end if;
  if p_action not in ('publish', 'remove') then raise exception 'invalid_action'; end if;
  if p_note is null or char_length(btrim(p_note)) < 1 or char_length(btrim(p_note)) > 500 then
    raise exception 'invalid_note';
  end if;

  v_new_status := case when p_action = 'publish' then 'published' else 'removed' end;

  if p_content_type = 'post' then
    select moderation_status into v_previous_status
    from public.community_posts where id = p_content_id for update;
    if not found then raise exception 'content_not_found'; end if;
    update public.community_posts
    set moderation_status = v_new_status, moderation_reason = btrim(p_note), updated_at = now()
    where id = p_content_id;
    update public.community_reports
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id
    where post_id = p_content_id and status in ('new', 'reviewing');
  else
    select moderation_status into v_previous_status
    from public.community_comments where id = p_content_id for update;
    if not found then raise exception 'content_not_found'; end if;
    update public.community_comments
    set moderation_status = v_new_status, moderation_reason = btrim(p_note)
    where id = p_content_id;
    update public.community_reports
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id
    where comment_id = p_content_id and status in ('new', 'reviewing');
  end if;

  insert into public.community_moderation_actions (
    content_type, content_id, action, previous_status, new_status, note, actor_user_id
  ) values (
    p_content_type, p_content_id, p_action, v_previous_status, v_new_status, btrim(p_note), p_actor_user_id
  ) returning id into v_action_id;

  return query select v_action_id, v_previous_status, v_new_status;
end;
$$;

revoke all on function public.apply_community_moderation(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_community_moderation(text, uuid, text, text, uuid) to service_role;
