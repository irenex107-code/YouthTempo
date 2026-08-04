alter table public.community_reports
add column if not exists category text,
add column if not exists priority text,
add column if not exists target_review_at timestamptz;

update public.community_reports
set
  category = coalesce(category, 'other'),
  priority = coalesce(priority, 'standard'),
  target_review_at = coalesce(target_review_at, created_at + interval '72 hours')
where category is null or priority is null or target_review_at is null;

alter table public.community_reports
alter column category set default 'other',
alter column category set not null,
alter column priority set default 'standard',
alter column priority set not null,
alter column target_review_at set default (now() + interval '72 hours'),
alter column target_review_at set not null;

alter table public.community_reports drop constraint if exists community_reports_category_check;
alter table public.community_reports add constraint community_reports_category_check check (
  category in (
    'immediate_danger',
    'sexual_harm',
    'bullying_threat',
    'privacy_exposure',
    'harmful_content',
    'fraud_spam',
    'other'
  )
);

alter table public.community_reports drop constraint if exists community_reports_priority_check;
alter table public.community_reports add constraint community_reports_priority_check check (
  priority in ('urgent', 'high', 'standard')
);

create or replace function public.assign_community_report_service_level()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.priority := case
    when new.category in ('immediate_danger', 'sexual_harm') then 'urgent'
    when new.category in ('bullying_threat', 'privacy_exposure', 'harmful_content') then 'high'
    else 'standard'
  end;
  new.target_review_at := coalesce(new.created_at, now()) + case new.priority
    when 'urgent' then interval '2 hours'
    when 'high' then interval '24 hours'
    else interval '72 hours'
  end;
  return new;
end;
$$;

revoke all on function public.assign_community_report_service_level()
from public, anon, authenticated;

drop trigger if exists assign_community_report_service_level on public.community_reports;
create trigger assign_community_report_service_level
before insert or update of category, created_at on public.community_reports
for each row execute function public.assign_community_report_service_level();

create index if not exists community_reports_open_deadline_idx
on public.community_reports(priority, target_review_at)
where status in ('new', 'reviewing');
