alter table public.professional_verifications
drop constraint if exists professional_verifications_active_review_check;

alter table public.professional_verifications
add constraint professional_verifications_active_review_check
check (
  status <> 'active'
  or (
    reviewed_at is not null
    and (
      verification_basis = 'legacy_platform_confirmation'
      or (
        verified_by is not null
        and credential_verified
        and position_title is not null
        and credential_type is not null
        and credential_number is not null
        and credential_issuer is not null
        and evidence_reference is not null
      )
    )
  )
);

create or replace function public.review_professional_verification(
  p_user_id uuid,
  p_action text,
  p_note text,
  p_actor_user_id uuid
)
returns table(status text, reviewed_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_status text;
  v_next_status text;
  v_reviewed_at timestamptz := now();
  v_note text := nullif(btrim(p_note), '');
begin
  if p_action not in ('approve', 'request_changes', 'reject', 'revoke') then
    raise exception 'invalid_professional_review_action' using errcode = '22023';
  end if;

  if p_action <> 'approve' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'professional_review_note_required' using errcode = '23514';
  end if;

  select verification.status
  into v_previous_status
  from public.professional_verifications verification
  where verification.user_id = p_user_id
  for update;

  if v_previous_status is null then
    raise exception 'professional_verification_not_found' using errcode = 'P0002';
  end if;

  v_next_status := case p_action
    when 'approve' then 'active'
    when 'request_changes' then 'needs_more_info'
    when 'reject' then 'rejected'
    else 'revoked'
  end;

  if p_action = 'approve' and exists (
    select 1
    from public.professional_verifications verification
    where verification.user_id = p_user_id
      and (
        verification.position_title is null
        or verification.credential_type is null
        or verification.credential_number is null
        or verification.credential_issuer is null
        or verification.evidence_reference is null
        or verification.credential_expires_on < current_date
      )
  ) then
    raise exception 'professional_verification_incomplete_or_expired' using errcode = '23514';
  end if;

  update public.professional_verifications
  set status = v_next_status,
      verified_by = p_actor_user_id,
      credential_verified = p_action = 'approve',
      institution_verified = p_action = 'approve' and institution_name is not null,
      reviewed_at = v_reviewed_at,
      review_note = v_note,
      revoked_at = case when p_action = 'revoke' then v_reviewed_at else null end,
      updated_at = v_reviewed_at
  where user_id = p_user_id;

  if p_action = 'approve' then
    update public.profiles
    set role = '专业支持者', updated_at = v_reviewed_at
    where id = p_user_id;
  else
    update public.profiles
    set role = '学生', updated_at = v_reviewed_at
    where id = p_user_id
      and role = '专业支持者';
  end if;

  insert into public.professional_verification_events (
    user_id,
    actor_user_id,
    action,
    previous_status,
    new_status,
    note
  ) values (
    p_user_id,
    p_actor_user_id,
    case p_action
      when 'approve' then 'approved'
      when 'request_changes' then 'changes_requested'
      when 'reject' then 'rejected'
      else 'revoked'
    end,
    v_previous_status,
    v_next_status,
    v_note
  );

  return query select v_next_status, v_reviewed_at;
end;
$$;

revoke all on function public.review_professional_verification(uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.review_professional_verification(uuid, text, text, uuid)
to service_role;
