# Project Identity

YouthTempo is a bilingual youth mental health support platform for a small-scale school pilot. It is designed primarily for young people aged 14–18 and also supports guardians, teachers, school leads, platform administrators, and verified professional supporters.

The product helps young people notice emotions, reflect on daily rhythms through the SWEET model, and reach appropriate human support before challenges become crises. It provides early support and reflection tools; it does not diagnose, provide therapy, or replace emergency or professional care.

Treat `ROADMAP.md` as the single source of truth for priorities and completion status. Merge any newly discovered work into the roadmap before beginning an unrelated feature.

For pilot-readiness work, keep `PILOT_READINESS_AUDIT.md`, `SECURITY_PERMISSION_MATRIX.md`, `PILOT_MANUAL_CHECKLIST.md`, `SCHOOL_PILOT_READINESS_CHECKLIST.md`, and `PARENTAL_ACCESS_POLICY_DECISION.md` aligned with the roadmap. Do not mark the product READY while a roadmap PILOT BLOCKER remains open.

## Product Boundaries

- Young people can complete SWEET check-ins and use reflection tools such as Mood Journal, Talk, Worry Time, and Referral.
- SWEET Talk is the parent communication tool based on AIDET. It is not a sixth SWEET rhythm dimension.
- Linked guardians can view the records and messages they are authorized to access.
- Teachers work from assigned-student relationships. School leads work within their school scope.
- Community posts and comments use role-scoped visibility and moderation states.
- Platform administration, school operations, moderation, and professional verification are privileged workflows.
- The public site and core authenticated user flows support Chinese and English. Do not assume every administrative screen is localized.

# Architecture Rules

## Runtime and framework

- Next.js `16.2.12`, React `19`, and TypeScript with strict checking.
- The project uses the Next.js **Pages Router**, not the App Router.
- `pages/` owns route entry points and server API routes.
- Page implementations live primarily in `views/`.
- Shared visual components live in `components/`.
- Reusable product, authorization, safety, Supabase, and localization logic lives in `lib/`.
- Structured translation dictionaries live in `locales/`.
- Database migrations and the consolidated schema live in `supabase/`.
- Playwright tests live in `tests/`.

Do not introduce App Router conventions, Server Actions, or React Server Component assumptions without an explicit architecture decision.

## Supabase

Supabase provides Email OTP authentication and the primary PostgreSQL database. Browser code uses the public Supabase client; privileged API routes use the server client after authenticating the bearer token.

Authorization is layered:

1. Authenticate the user.
2. Load role, school membership, assignment, guardian relationship, consent, or verification state from the database.
3. Enforce the same boundary in the API.
4. Retain RLS and database triggers as defense in depth.

Never trust a role, school ID, verification state, moderation state, or relationship submitted by the client.

## Authentication

- Authentication uses Supabase Email OTP.
- OTP codes are eight digits.
- Successful verification creates a persisted Supabase session.
- Keep authentication error messages user-safe and free of internal details.
- Do not log email OTPs, access tokens, refresh tokens, session payloads, or private email content.
- Never return arbitrary database, provider, constraint, or `Error.message` details in a 5xx client response; report sanitized operational metadata and return a user-safe fallback.
- Gmail SMTP is acceptable for the current pilot but is not the intended long-term delivery architecture.

## Internationalization

- Supported locales are `zh-CN` and `en`.
- Chinese is the default locale at `/`; English uses the `/en/` route prefix.
- Browser-language auto-redirect is disabled.
- `NEXT_LOCALE` persists the user's choice.
- `lib/i18n/` provides the provider, locale normalization, typed dictionaries, and server translation helper.
- `locales/zh-CN.json` defines the translation shape; `locales/en.json` must remain structurally identical.

## AI APIs

- AI routes are under `pages/api/ai/`.
- Shared locale handling, input limits, rate limiting, structured JSON generation, retry behavior, and safe error handling are in `pages/api/ai/_shared.ts`.
- Tool requests send `zh-CN` or `en`; the system prompt and response language follow that locale.
- Preserve the JSON response contracts used by Check-in, Mood Journal, Talk, Worry Time, and Referral.
- Never expose system prompts, chain-of-thought, internal moderation reasoning, provider errors, or developer-oriented instructions in user-facing output.

## Safety architecture

- `lib/safety/crisisDetection.ts` is the shared deterministic Chinese/English crisis detector.
- Talk performs deterministic crisis detection after input validation and before any AI provider call.
- `lib/messageSafety.ts` applies the shared safety rules to Messages and Community.
- High-risk messages and community content enter the existing `safety_review` flow.
- Normal stress, sadness, tiredness, or feeling overwhelmed must not automatically be treated as a crisis.
- AI output is a secondary signal only; deterministic checks and server-side moderation state remain authoritative.

## Deployment

- The formal deployment target is Tencent Cloud CloudBase Run.
- The application is built as a Next.js standalone Docker image.
- `scripts/cloudbase-server.mjs` serves precompressed static assets and proxies application traffic to the standalone Next.js server.
- Vercel is not the formal production site.
- Never place service-role keys, AI keys, SMTP credentials, database URLs, or user data in the Docker image or repository.

# Development Rules

## Scope and change control

- Preserve existing user changes and unrelated work in a dirty worktree.
- Make the smallest change that satisfies the requested scope.
- Do not redesign layouts, alter product language, or expand a localization batch unless requested.
- Do not modify database schema, migrations, functions, triggers, grants, or RLS without explicit confirmation.
- Do not apply a migration to the formal Supabase project without explicit confirmation for that production action.
- Create migration files with the Supabase CLI. Keep `supabase/schema.sql` synchronized after an approved schema change.
- Do not modify production configuration, deploy, send external messages, create test users, or delete data unless the user has authorized that operation.

## Roles and permissions

- `profiles.role` is authorization data controlled by trusted server workflows.
- Client profile updates may contain ordinary fields such as `display_name`; they must not contain `role` or other permission fields.
- Ordinary authenticated users must not change role, admin status, school assignment, verification status, moderation status, or consent ownership.
- Preserve `enforce_profile_role_assignment`, its trigger, and column-level role restrictions.
- Trusted role changes must go through an approved service/admin, school invitation, or professional verification workflow.
- Internal role, status, enum, and permission values remain stable even when their UI labels are translated.

## Database and RLS

- Every application table exposed through the Data API must retain RLS.
- `TO authenticated` alone is not an authorization boundary; policies need ownership or relationship predicates.
- UPDATE policies require both `USING` and `WITH CHECK` when row ownership can change.
- Treat `SECURITY DEFINER` functions as privileged code. Do not add one merely to bypass an RLS failure.
- Service-role access belongs only in server code. Never expose it through `NEXT_PUBLIC_*` or browser bundles.
- Do not alter, normalize, or translate stored Chinese role/status values as part of UI localization.
- Preserve student consent enforcement, school scoping, assignment scoping, guardian links, professional verification, and audit histories.

## Data lifecycle and recovery

- The current Free Supabase plan does not provide automatic daily backups or PITR.
- Backup and restore scripts exist, but a real encrypted off-site backup and isolated recovery drill are still required before recovery readiness can be marked complete.
- Never run a restore drill against production.
- Recovery work must follow `docs/DATABASE_RECOVERY.md`, verify the target project manually, protect connection strings, and avoid recording personal data in reports.

# Safety Rules

- YouthTempo AI must never claim to diagnose, cure, heal, or replace therapy, clinicians, trusted adults, schools, or emergency services.
- Crisis detection must run before an AI call wherever a deterministic urgent path exists.
- An urgent response must stop ordinary reflection and encourage immediate real-world support.
- English urgent guidance must refer to local emergency services rather than assuming the user is in mainland China.
- Do not remove, bypass, weaken, or silently publish content from the `safety_review` flow.
- Do not change moderation status values or safety payload contracts as part of wording or UI work.
- Do not expose a reporter, anonymous sender, minor's private record, or sensitive moderation detail beyond the authorized role.
- Safety wording should be calm, clear, non-diagnostic, non-judgmental, and free of exaggerated promises.

# Localization Rules

- Chinese is the source of truth. Preserve its meaning unless the task explicitly requests Chinese copy changes.
- Every new user-facing translation key must be added to both `locales/zh-CN.json` and `locales/en.json` with the same nested structure.
- Use semantic keys such as `account.messages.empty`, not numbered keys.
- Do not hard-code duplicated English strings in components when the text belongs in the dictionary.
- Translate UI labels, descriptions, placeholders, ARIA text, image alt text, metadata, loading states, and user-safe errors.
- Do not translate user-generated content, stored database values, internal enums, API contracts, permission identifiers, or role identifiers.
- Use locale-aware dates and pluralization in the display layer without changing stored timestamps or values.
- English should be professional, warm, supportive, trustworthy, and easy to understand. Avoid medicalized claims and mechanical translation.
- Keep SWEET as `SWEET model`. Choose `young people` or `adolescents` according to context.
- Preserve layout, spacing, colors, images, and motion. Resolve longer English text with minimal responsive text-container changes only when necessary.

# Testing Requirements

After any implementation change, run checks proportional to the risk. The minimum for code changes is:

```bash
pnpm typecheck
pnpm build
```

Run the relevant Playwright tests for the changed area. Examples:

```bash
pnpm test:e2e
pnpm test:e2e:permissions
pnpm test:e2e:sweet
pnpm test:e2e:community
pnpm test:e2e:mobile-browsers
```

Additional expectations:

- Authenticated end-to-end permission, SWEET, community, and rate-limit suites must reset the virtual-school fixture before relying on its relationships or consent state.

- Localization changes: verify Chinese and English key parity, `/` and `/en/`, `html lang`, the language cookie, desktop, and mobile layouts.
- Auth changes: verify OTP request, verification, session persistence, resend limits, and safe error handling.
- Permission changes: test allowed and denied paths with separate users; confirm payloads cannot alter authorization fields.
- AI changes: test both locales, structured response compatibility, input limits, fallback behavior, and no provider call on deterministic crisis matches.
- Safety changes: include urgent and non-urgent Chinese and English fixtures and verify moderation states.
- Database changes: run the relevant security tests and Supabase advisors after an approved migration.

Do not claim a test passed unless it was actually run. Clearly report skipped tests, missing credentials, environment limitations, and any production-only checks that still require human verification.
