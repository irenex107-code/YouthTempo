create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'youthtempo-purge-expired-account-deletion-audits',
  '17 3 * * *',
  $$delete from public.account_deletion_audits where expires_at <= now()$$
);
