# YouthTempo CloudBase Run deployment

YouthTempo uses the same Next.js application on Vercel and Tencent CloudBase
Run. Supabase remains the authentication and primary database service during
this migration.

## Service settings

- Region: Shanghai
- Runtime: CloudBase Run, built from this repository's `Dockerfile`
- Service port: `3000`
- Public access: enabled
- Health check path: `/api/health`
- Minimum instances during testing: `0`

## Build variables

The following public values must be available while the Docker image is built:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Configure them as Docker build arguments or build environment variables. They
must also be present in the service runtime environment.

## Runtime variables

Configure these in the CloudBase Run service. Never commit their real values:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
WECHAT_MINI_APP_ID
WECHAT_MINI_APP_SECRET
WECHAT_MINI_BIND_PAGE
```

`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and
`WECHAT_MINI_APP_SECRET` are server secrets. Do not expose them as
`NEXT_PUBLIC_*` variables.

## Rollout

1. Create a new CloudBase environment named `youthtempo-prod`.
2. Create a CloudBase Run service from the GitHub repository.
3. Set the Dockerfile path to `Dockerfile` and port to `3000`.
4. Add the build and runtime variables.
5. Deploy and verify `/api/health`, `/`, `/account`, and a saved SWEET record.
6. Keep Vercel available as a rollback target until the Tencent deployment has
   passed the pilot flow.
7. Add a custom domain after the service works, then complete ICP filing before
   relying on it for mainland production traffic.
