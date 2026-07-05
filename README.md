# 青序计划 YouthTempo

Version: V1 Prototype

Current status: pre-commercial interactive prototype

青序计划 YouthTempo is an early-support website prototype for youth well-being. It uses daily rhythm, emotion expression, bedtime worry organization, and support-pathway guidance to help young people and their support systems find a lower-pressure starting point.

## Main Routes

- `/`
- `/for-teens`
- `/for-parents`
- `/check-in`
- `/mood-journal`
- `/worry-time`
- `/referral`
- `/resources`
- `/sweet-model`

## Local Development Setup

Use `pnpm` for this project. The repository includes `pnpm-lock.yaml` and `pnpm-workspace.yaml`.

Do not use `npm install` as the main setup command. On macOS, `corepack enable` may fail with permission errors when trying to symlink `pnpm` into `/usr/local/bin`. The reliable local setup is to run `pnpm` through `npx`.

Recommended commands:

```bash
npx pnpm@latest approve-builds
npx pnpm@latest install
npx pnpm@latest build
npx pnpm@latest dev:local
```

During `approve-builds`, select `sharp` and approve it.

Then open:

[http://127.0.0.1:3000](http://127.0.0.1:3000/)

After dependencies are installed, you can also start the local dev server with:

```bash
npx pnpm@latest dev:local
```

## Enable AI Features

Create `.env.local`:

```bash
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=your_model_here
```

AI requests are handled through server-side API routes under `/api/ai/*`. Do not put API keys in frontend code.

Do not commit a real API key. Do not hardcode API keys in frontend or server files.
