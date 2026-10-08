# Server authentication

Protected routes: `/`, `/ncv-calculation`, `/scenario`. Public route: `/login`.
Next.js 16 `proxy.js` validates the signed session; each page also verifies it on the server before rendering.
No new runtime dependencies. HZI calculation, historian processing and Excel export modules are unchanged.

## Vercel setup before merging or production deployment

Run locally in an interactive terminal:

```sh
node scripts/configure-auth.mjs
```

Enter the initial username and the password specified by the account owner.
The password prompt is hidden. The script prints a salted scrypt hash and a cryptographically random session secret; it never prints the password.

In Vercel â†’ ncv-calculation â†’ Settings â†’ Environment Variables, add:
- `AUTH_USERNAME`: the initial account username.
- `AUTH_PASSWORD_HASH`: the generated complete `scrypt$...` value.
- `AUTH_SESSION_SECRET`: the generated random hexadecimal value (at least 32 bytes).

Set these as server-only variables, never with a `NEXT_PUBLIC_` prefix. Use Sensitive storage for the hash and secret in Production and Preview. Configure Preview for this branch to validate the account before merging. Use distinct secrets for Preview and Production.
Do not commit values, terminal output or environment files. Missing/invalid configuration denies access.
New environment values apply to new deployments; rebuild/redeploy the target environment after setting them.

## Session behavior

The `__Host-ncv-session` cooki¶»§q«^