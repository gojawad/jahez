# Turnstile verification

This public pre-authentication Edge Function validates login tokens with Cloudflare. It does not read or write application records.

Required Supabase secrets:

```text
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
TURNSTILE_EXPECTED_HOSTNAME=jahez.swaken.net
TURNSTILE_ALLOWED_ORIGIN=https://jahez.swaken.net
```

Deploy with JWT verification disabled because the function runs before the user has a Supabase session:

```bash
supabase secrets set TURNSTILE_SITE_KEY=... TURNSTILE_SECRET_KEY=... TURNSTILE_EXPECTED_HOSTNAME=jahez.swaken.net TURNSTILE_ALLOWED_ORIGIN=https://jahez.swaken.net --project-ref vthcmqqiexaedukduquv
supabase functions deploy verify-turnstile --no-verify-jwt --project-ref vthcmqqiexaedukduquv
```

Do not deploy the client changes until the function responds with `enabled: true` in production.
