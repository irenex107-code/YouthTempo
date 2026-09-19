# YouthTempo migration chain

`20260718172309_youthtempo_baseline.sql` is the verified schema baseline for a
new Supabase project. Its version matches the earliest migration already
recorded by the production project.

The no-op files through `20260803124004` preserve every version in the existing
production migration history. Their schema changes are already included in the
baseline, so they must remain empty. The baseline also contains the deny-only
`pilot_feedback_server_only` policy, while the already-shared
`20260804045916_add_pilot_feedback.sql` creates it again. The backfilled
`20260804045915_pilot_feedback_replay_guard.sql` temporarily renames that policy
without changing its denial rule, allowing the historical migration to replay.
`20260919190531_restore_pilot_feedback_server_policy.sql` restores the canonical
deny-only policy and removes the temporary name. Neither migration changes rows.

On an existing environment, `20260804045915` is older than its recorded head.
Review the pending list with `supabase db push --dry-run --include-all` against
an **isolated** project and apply the approved versions with `--include-all`,
ensuring the backfilled guard runs before the final repair. Do not use these
commands on production without separate authorization.
If replay stops between the two repair files, retain the deny-only guard and
apply the final repair; never restore browser access as a rollback shortcut.

The original incremental SQL is retained in
`supabase/migration-archive/applied-before-baseline` for audit purposes. Files in
that archive are not part of the executable migration chain.

For future database changes:

1. Create the migration with `supabase migration new <name>`.
2. Put the reviewed SQL in the generated file.
3. Test the complete chain against an isolated project.
4. Deploy that exact file through the Supabase CLI or Git integration so the
   local and remote version numbers remain identical.

Do not apply a separately timestamped production migration and then add a local
file with a different timestamp. That breaks Supabase Preview history checks.
