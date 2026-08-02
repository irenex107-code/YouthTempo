create index if not exists community_reports_resolved_by_idx
on public.community_reports(resolved_by);

create index if not exists community_restrictions_revoked_by_idx
on public.community_restrictions(revoked_by);
