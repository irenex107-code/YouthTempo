# YouthTempo Agent Operations Guide v2.0

This file is the repository-level operating contract for Codex and other AI agents working on YouthTempo. Follow it before making plans, editing files, running tests, or interacting with external systems. It is intentionally more operational than `README.md`.

User instructions for the current task take precedence over this guide. Safety, privacy, authorization, and destructive-action boundaries still apply unless the user explicitly grants the required authority.

# Project Identity

YouthTempo is a bilingual youth mental health support platform for a small-scale school pilot. It is designed primarily for young people aged 14–18 and also supports guardians, teachers, school leads, platform administrators, and verified professional supporters.

The product helps young people notice emotions, reflect on daily rhythms through the SWEET model, and reach appropriate human support before challenges become crises. It provides early support and reflection tools; it does not diagnose, provide therapy, or replace emergency or professional care.

Treat `ROADMAP.md` as the single source of truth for priorities and completion status. Merge any newly discovered work into the roadmap before beginning an unrelated feature.

## Operating priorities

When requirements compete, use this order:

1. Protect young people, private data, and production integrity.
2. Preserve authorization, consent, crisis, and moderation boundaries.
3. Satisfy the user's explicit scope without expanding it.
4. Preserve existing behavior, Chinese source copy, and UI design.
5. Keep changes reversible, reviewable, and tested in proportion to risk.
6. Prefer maintainability and clarity over speculative abstraction.

## Current pilot truth

- The core pilot is for young people aged 14–18 in school settings. An independent 18–25 pathway exists but is not the primary pilot scope.
- Tencent Cloud CloudBase Run is the formal production deployment. Vercel is not the formal site.
- Email OTP delivery, eight-digit verification, session creation, and common-mailbox pilot checks have been completed. Gmail SMTP is a pilot-stage solution, not the long-term mail architecture.
- Public pages and core authenticated user flows support Chinese and English. Administrative surfaces may still be Chinese-first.
- Profile-role protection, multilingual AI responses, bilingual crisis detection, and Message/Community safety localization are implemented.
- Backup scripts and an isolated-recovery plan exist, but an encrypted off-site production backup and full recovery drill are not complete. Do not describe recovery as pilot-ready until the drill passes.
- Formal-domain and ICP work, final external alert delivery, and physical-device acceptance may remain operational follow-ups. Check `ROADMAP.md` and the latest user instruction before stating current status.

## Product Boundaries

- Young people can complete SWEET check-ins and use reflection tools such as Mood Journal, Talk, Worry Time, and Referral.
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

## Directory ownership

| Path | Responsibility | Agent rule |
|---|---|---|
| `pages/` | Pages Router entries and API routes | Keep route files thin where a `views/` implementation already exists. Preserve API methods and response contracts. |
| `views/` | Main page implementations and global styles | Make UI changes here without moving routes or redesigning unrelated sections. |
| `components/` | Shared visual and workflow components | Reuse only when semantics match; do not create broad abstractions for a single use. |
| `data/` | Shared site/navigation configuration | Preserve locale-aware labels and role-sensitive navigation behavior. |
| `lib/` | Auth, Supabase, product, safety, monitoring, and i18n logic | Treat authorization and safety modules as trusted-boundary code. |
| `locales/` | `zh-CN` and `en` dictionaries | Keep nested key shape identical and Chinese meaning stable. |
| `supabase/migrations/` | Versioned database changes | Never hand-invent a migration filename; use the Supabase CLI after approval. |
| `supabase/schema.sql` | Consolidated current application schema | Synchronize only after an approved database change. |
| `tests/` | Playwright and security regressions | Update stale expectations only when product behavior intentionally changed. |
| `scripts/` | Deployment, fixtures, backup, and recovery tooling | Review target validation and destructive behavior before running. |
| `docs/` | Operational, recovery, and product documentation | Do not mark a readiness item complete without matching evidence. |
| `miniprogram/` | WeChat mini-program work | Keep separate from the core web scope unless explicitly requested. |

## Architectural invariants

- Pages Router locale routing remains configured in `next.config.ts`; do not add a parallel client-only routing system.
- The browser Supabase client may contain only browser-safe public configuration. All privileged operations stay server-side.
- API handlers authenticate bearer tokens before loading privileged data.
- Authorization comes from database state and verified relationships, never UI state or request claims alone.
- AI endpoints preserve existing structured JSON shapes. UI wording changes do not authorize contract changes.
- Security headers, standalone output, static-asset behavior, and the CloudBase server wrapper are deployment-critical.
- Internal enums and stored role/status values remain stable; localization belongs in the display layer.

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

## Standard working sequence

Before editing:

1. Read the user's current scope and identify explicit exclusions.
2. Read `ROADMAP.md` when the task concerns priorities, readiness, or new work.
3. Inspect `git status --short`, the current branch/HEAD, and relevant files.
4. Treat every pre-existing modification as user-owned unless proven otherwise.
5. Locate existing tests and established patterns before designing a new one.
6. State material assumptions in commentary when they affect scope or safety.

During implementation:

1. Make the smallest coherent patch.
2. Preserve API, database, locale, and UI invariants outside the requested scope.
3. Keep changes reversible and avoid unrelated formatting churn.
4. Add or update focused tests with the implementation when behavior changes.
5. Report unexpected production, schema, or security findings before expanding work.

Before handoff:

1. Review the complete diff, not only the last file touched.
2. Run `git diff --check`.
3. Run the verification required by the change-risk matrix below.
4. Check that no secret, personal data, test credential, OTP, or connection string entered the diff or output.
5. Report exactly what changed, what was tested, what was skipped, and what remains.

## Scope and change control

- Preserve existing user changes and unrelated work in a dirty worktree.
- Make the smallest change that satisfies the requested scope.
- Do not redesign layouts, alter product language, or expand a localization batch unless requested.
- Do not modify database schema, migrations, functions, triggers, grants, or RLS without explicit confirmation.
- Do not apply a migration to the formal Supabase project without explicit confirmation for that production action.
- Create migration files with the Supabase CLI. Keep `supabase/schema.sql` synchronized after an approved schema change.
- Do not modify production configuration, deploy, send external messages, create test users, or delete data unless the user has authorized that operation.

## Authorization matrix

| Action | Default authority | Required behavior |
|---|---|---|
| Read repository files, inspect Git state, search code | Allowed | Stay within project scope and avoid exposing secrets in output. |
| Run non-mutating static checks | Allowed | Prefer focused commands and report failures accurately. |
| Edit files requested by the user | Allowed | Limit edits to the stated files and preserve unrelated changes. |
| Add a roadmap item for newly requested work | Allowed when it is part of the task | Do not silently reorder or mark unrelated items complete. |
| Install dependencies | Only when necessary for the requested implementation or verification | Use the lockfile and pinned package manager; explain material dependency changes. |
| Create or edit a migration file | Requires explicit database-change approval | Use the Supabase CLI, review SQL, and synchronize schema after approval. |
| Apply any migration to production | Requires explicit approval for that exact production action | Report project target, migration summary, and impact before applying. |
| Change RLS, grants, triggers, privileged functions, roles, or consent enforcement | Requires explicit approval | Treat as a security-boundary change and add allowed/denied tests. |
| Change production environment variables, SMTP, Auth settings, domains, or hosting | Requires explicit approval | Never reveal current values. Verify the target before mutation. |
| Deploy, promote, roll back, or reconnect an integration | Requires explicit approval unless the current request explicitly asks for deployment | Report resulting URL/version and verification evidence. |
| Create production test users or test data | Requires explicit approval | Use isolated identities, define cleanup first, and remove all test residue. |
| Delete users, data, buckets, projects, branches, or files | Requires explicit target confirmation | Prefer recoverable actions; verify target and cleanup impact first. |
| Send email, webhook, invitation, external message, or notification | Requires explicit approval | Use controlled recipients and avoid user data in content/logs. |
| Export production data or run a backup | Requires explicit approval | Encrypt, minimize access, and never print data or connection details. |
| Restore a database | Requires explicit approval and an isolated disposable target | Production is always forbidden for drills. Verify target manually twice. |
| Commit, push, open a PR, merge, or change branches | Only when requested | Keep commits scoped and never include unrelated user work. |

An earlier approval does not automatically authorize a materially different target, migration, deployment, deletion, or external message. When the exact target or impact changes, ask again.

## Git and worktree discipline

- Work from the repository/worktree provided by the current task. Do not assume another YouthTempo checkout contains the same uncommitted state.
- Never discard user changes with reset, checkout, restore, clean, or force operations unless explicitly requested and the exact target is confirmed.
- Do not stage or commit unrelated files.
- Do not amend, rebase, force-push, or rewrite history without explicit authorization.
- A clean diff is not proof that production matches the checkout. Verify deployment state separately when requested.
- Do not claim a commit, push, deployment, or migration succeeded until the command or platform response confirms it.

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

## Trusted data boundaries

- `profiles.role`, `profiles.school_id`, admin membership, school membership, teacher assignments, guardian links, professional-verification status, consent ownership, and moderation status are privileged data.
- The client may request an action but must not decide whether it is authorized.
- Resolve the authenticated user from the access token, then load current database relationships on the server.
- Ignore or reject client-supplied owner IDs, actor IDs, role labels, school scope, verification results, review status, and audit authorship.
- Apply least privilege to platform admin, school lead, school support, guardian, student, and professional workflows separately.
- Membership revocation must take effect for existing sessions because APIs re-check current database relationships.
- Avoid authorization based on editable user metadata. Privileged state belongs in protected database records or trusted app metadata.

## API contracts and error handling

- Preserve allowed methods, status codes, request fields, response fields, and stored values unless the task explicitly changes the contract.
- Validate method, content type where relevant, body shape, string length, arrays, pagination, and required identifiers before privileged work.
- Authenticate before revealing whether a protected resource exists.
- Return concise, localized, user-safe errors. Do not return provider bodies, SQL errors, stack traces, policies, prompts, tokens, or internal identifiers.
- Apply existing request-size and rate-limit patterns to new write or AI endpoints.
- Do not trust UI constraints as server validation.
- Keep audit writes in the same transaction or atomic server operation as the state change when the existing workflow requires it.
- When partial failure is possible, design explicit rollback or idempotency rather than reporting success early.

## Privacy, logging, and monitoring

- Minimize collection and exposure of mental health content. Do not add analytics fields merely because data is available.
- Never log OTPs, tokens, cookies, authorization headers, raw AI prompts, message bodies, journal text, SWEET answers, email addresses, credential descriptions, or exported account data.
- Operational events should use fixed area/operation codes, coarse error categories, HTTP status, and correlation metadata that cannot identify a user.
- Browser error reporting must stay size-limited, rate-limited, and free of arbitrary user-supplied text.
- Screenshots, fixtures, and test output must use synthetic data.
- Do not place production data in a branch, preview project, recovery project, issue, PR, artifact, or local report unless an explicitly approved encrypted recovery workflow requires it.

## UI and content protection

- Preserve the established teal, mist-blue, muted-color visual system, responsive structure, spacing, typography, illustrations, and motion unless redesign is requested.
- Reuse an illustration only when it carries the same meaning; the home hero and young-person hero intentionally use different primary illustrations.
- Avoid gender stereotypes in people illustrations and role copy.
- Keep user-facing language conversational, warm, clear, and direct rather than clinical, formal, or AI-like.
- Never display developer reasoning, production implementation details, prompt text, database values, moderation heuristics, or internal workflow notes to users.
- Maintain keyboard access, visible focus, semantic controls, ARIA labels, meaningful alt text, and mobile touch targets.
- When English text is longer, first adjust wrapping or container behavior; do not redesign the section without approval.
- Navigation is role-aware. Teachers must not be sent to guardian pages, and school leads must not inherit platform-wide access.

## Data lifecycle and recovery

- The current Free Supabase plan does not provide automatic daily backups or PITR.
- Backup and restore scripts exist, but a real encrypted off-site backup and isolated recovery drill are still required before recovery readiness can be marked complete.
- Never run a restore drill against production.
- Recovery work must follow `docs/DATABASE_RECOVERY.md`, verify the target project manually, protect connection strings, and avoid recording personal data in reports.

For any future recovery drill:

1. Confirm the production source and isolated target as separate projects.
2. Confirm the target is disposable and contains nothing that must be preserved.
3. Generate and encrypt the backup without printing data or credentials.
4. Verify checksums before restore.
5. Restore only to the registered isolated target.
6. Compare Auth, Profiles, SWEET, Consent, Messages, Community, RLS, and role-protection behavior.
7. Record only counts, timings, pass/fail evidence, RPO, and RTO; never record personal rows.
8. Replay post-backup deletion obligations before declaring a real recovery complete.

# Safety Rules

- YouthTempo AI must never claim to diagnose, cure, heal, or replace therapy, clinicians, trusted adults, schools, or emergency services.
- Crisis detection must run before an AI call wherever a deterministic urgent path exists.
- An urgent response must stop ordinary reflection and encourage immediate real-world support.
- English urgent guidance must refer to local emergency services rather than assuming the user is in mainland China.
- Do not remove, bypass, weaken, or silently publish content from the `safety_review` flow.
- Do not change moderation status values or safety payload contracts as part of wording or UI work.
- Do not expose a reporter, anonymous sender, minor's private record, or sensitive moderation detail beyond the authorized role.
- Safety wording should be calm, clear, non-diagnostic, non-judgmental, and free of exaggerated promises.

## AI and crisis execution order

For a safety-sensitive AI endpoint, preserve this order unless a reviewed design explicitly supersedes it:

1. Confirm the HTTP method.
2. Normalize locale and validate input structure.
3. Run deterministic crisis detection on the relevant current user text.
4. If urgent, return the locale-appropriate urgent response and do not call the AI provider.
5. Enforce input-size limits.
6. Enforce server-side rate limits.
7. Call the provider with the correct locale system prompt and fixed JSON contract.
8. Validate and normalize provider output before returning it.
9. Log only a redacted operational event on failure.

Additional rules:

- Keep Chinese and English crisis coverage active as mutual fallback because users may mix languages.
- Add high-risk phrases conservatively and include negative fixtures for ordinary stress, sadness, tiredness, and overwhelm.
- English urgent responses must direct users to a trusted nearby person and local emergency services, not mainland-China-only numbers.
- Chinese urgent responses may include locally relevant emergency numbers while still prioritizing a trusted adult nearby.
- Never ask for graphic details, instructions, plans, or methods in an urgent response.
- Do not let provider output downgrade a deterministic urgent result.
- A false sense of certainty is unsafe: never describe detection, privacy, or availability as perfect.

## Message and Community moderation

- Run safety classification before persisting the final moderation state.
- Normal content follows the existing sent/published path.
- Urgent content enters `safety_review` and receives a calm locale-appropriate notice.
- Abusive content follows the existing blocked/rephrase behavior; quoted or reported speech requires context-aware handling.
- Preserve reporting, review deadlines, removal/restoration, restriction, blocking, and audit workflows.
- Do not expose an anonymous sender except through the existing authorized safety-review path.
- Moderation changes must be auditable and authorized by the correct platform role.

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

## Translation workflow

1. Identify every user-visible string in the requested scope, including metadata, placeholders, ARIA labels, alt text, validation, loading, empty, success, and error states.
2. Preserve the existing Chinese text unless Chinese rewriting was requested.
3. Add semantic nested keys to `locales/zh-CN.json`.
4. Mirror the identical structure in `locales/en.json`.
5. Write natural English for an international youth mental health support product; do not translate word by word.
6. Use interpolation for names, counts, dates, and dynamic values.
7. Keep raw database/user content outside dictionaries.
8. Verify both routes, cookie persistence, `html lang`, desktop/mobile layout, and missing-key behavior.

Preferred terminology:

| Chinese concept | Preferred English |
|---|---|
| 心理健康 | mental health |
| 心理支持 | mental health support / support, according to context |
| 情绪 | emotions / emotional wellbeing, according to context |
| 节律 | rhythm |
| 青少年 | young people / adolescents, according to audience |
| 求助 | seek support / reach out for support |
| 专业支持者 | professional supporter / professional support role, according to UI context |

Avoid `cure`, `heal`, `fix your mental health`, guaranteed outcomes, therapy-replacement language, or unnecessary diagnostic wording.

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

- Localization changes: verify Chinese and English key parity, `/` and `/en/`, `html lang`, the language cookie, desktop, and mobile layouts.
- Auth changes: verify OTP request, verification, session persistence, resend limits, and safe error handling.
- Permission changes: test allowed and denied paths with separate users; confirm payloads cannot alter authorization fields.
- AI changes: test both locales, structured response compatibility, input limits, fallback behavior, and no provider call on deterministic crisis matches.
- Safety changes: include urgent and non-urgent Chinese and English fixtures and verify moderation states.
- Database changes: run the relevant security tests and Supabase advisors after an approved migration.

Do not claim a test passed unless it was actually run. Clearly report skipped tests, missing credentials, environment limitations, and any production-only checks that still require human verification.

## Change-risk verification matrix

| Change type | Minimum verification |
|---|---|
| Markdown-only documentation | `git diff --check`; inspect headings, code fences, links, factual status, and secret patterns. |
| TypeScript or shared library | `pnpm typecheck`, `pnpm build`, and focused tests. |
| Public UI component/page | TypeScript, production build, relevant public-flow/i18n tests, desktop and 390px mobile overflow/console review. |
| Authenticated Account/Messages/Feedback UI | TypeScript, build, relevant authenticated/i18n tests, session and unauthorized-state checks. |
| Localization dictionary | Key-parity check, typecheck, build, i18n tests, `/` and `/en/`, cookie, `html lang`, and overflow checks. |
| AI API or prompt | TypeScript, build, `ai-locale`, AI guardrail, input-limit/rate-limit tests, both locales, and JSON contract checks. |
| Crisis or message safety | TypeScript, build, urgent and non-urgent bilingual fixtures, provider-not-called assertion, Message/Community moderation-state tests. |
| Role, consent, school, guardian, or admin permission | TypeScript, build, allowed/denied API tests, cross-user/cross-school tests, revocation tests, and payload-tampering tests. |
| Supabase migration/RLS | Review generated SQL, update consolidated schema, local/static checks, security advisor, isolated allowed/denied tests, then production verification only after approval. |
| Deployment/runtime/Docker | Production build, container/runtime health, security headers, static assets, logs, formal URL smoke test, and rollback awareness. |
| Mobile/browser behavior | Desktop Chromium, mobile Chromium, configured WebKit/WeChat-UA checks, no overflow, no console errors; record any required physical-device check separately. |

Use the narrowest relevant Playwright file during iteration, then run the broader affected suite before handoff. Tests that create users or production data require the authorization and cleanup rules above.

# Definition of Done

A task is complete only when all of the following are true:

- The requested outcome is implemented within scope.
- No unrelated user work was overwritten or included.
- Product, authorization, safety, locale, and API invariants are preserved.
- Required tests and checks passed, or the exact unrun checks and reasons are reported.
- No secret, personal data, production credential, or internal reasoning entered the diff or user-facing UI.
- Database or production changes, when explicitly authorized, were verified against the exact target and left no test residue.
- Documentation and `ROADMAP.md` accurately reflect any status change the task was authorized to make.
- The final response gives the user enough information to verify the work without reading hidden commentary.

## Handoff format

Lead with the outcome, then report only relevant details:

1. **Changed:** files and user-visible/technical behavior.
2. **Safety and data impact:** whether API contracts, business logic, database, RLS, production, or stored values changed.
3. **Verification:** commands/tests and their exact results.
4. **Remaining:** skipped checks, manual verification, known limitations, or next approved step.
5. **Git state:** commit hash/push status only if those actions actually occurred.

For an audit-only task, report findings as Blocker/Critical, Important/Recommended, Acceptable/Ready as requested, and do not convert recommendations into code changes without authorization.
