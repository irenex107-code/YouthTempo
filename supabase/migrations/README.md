# YouthTempo migration chain

`20260718172309_youthtempo_baseline.sql` is the verified schema baseline for a
new Supabase project. Its version matches the earliest migration already
recorded by the production project.

The no-op files through `20260803124004` preserve every version in the existing
production migration history. Their schema changes are already included in the
baseline, so they must remain empty. `20260804045916_add_pilot_feedback.sql` is
the first real migration applied after that baseline snapshot.

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
