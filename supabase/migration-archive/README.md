# Applied migration source archive

These SQL files preserve the original incremental changes that were applied to
the production project before the repository migration history was rebased.

They are stored outside `supabase/migrations` so Supabase Branching does not
mistake their original local timestamps for new production migrations. Their
final schema is incorporated in
`supabase/migrations/20260718172309_youthtempo_baseline.sql`.

Do not move these files back into `supabase/migrations`. Future schema changes
must be created as new versioned migrations after `20260804045916`.
