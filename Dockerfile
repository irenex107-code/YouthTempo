FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS dependencies

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# These are public browser credentials. CloudBase does not expose service
# runtime variables during the Docker build, so provide production defaults
# while still allowing other environments to override them with build args.
ARG NEXT_PUBLIC_SUPABASE_URL=https://saqkzfsmabsgbwdvuras.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_NiIGAQ6Wf--HakVNwFnSmA_zqzSGHRv

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN mkdir -p public && pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/cloudbase-server.mjs ./cloudbase-server.mjs

USER nextjs

EXPOSE 3000

CMD ["node", "cloudbase-server.mjs"]
