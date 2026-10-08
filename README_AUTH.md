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

In Vercel → ncv-calculation → Settings → Environment Variables, add:
- `AUTH_USERNAME`: the initial account username.
- `AUTH_PASSWORD_HASH`: the generated complete `scrypt$...` value.
- `AUTH_SESSION_SECRET`: the generated random hexadecimal value (at least 32 bytes).

Set these as server-only variables, never with a `NEXT_PUBLIC_` prefix. Use Sensitive storage for the hash and secret in Production and Preview. Configure Preview for this branch to validate the account before merging. Use distinct secrets for Preview and Production.
Do not commit values, terminal output or environment files. Missing/invalid configuration denies access.
New environment values apply to new deployments; rebuild/redeploy the target environment after setting them.

## Session behavior

The `__Host-ncv-session` cookie is HttpOnly, Secure, SameSite=Strict, host-only and Path=/, and expires after eight hours without sliding renewal.
Its signed payload is verified on the server, including expiration and a credential version. The cookie contains no password or hash.
Login and logout are POST-only and enforce same-origin Origin checks. Failed login shows a generic error and clears any existing session. Redirect destinations are allowlisted.
Logout removes the browser cookie. This implementation uses signed stateless sessions: a copied cookie remains valid until expiry; rotate the session secret to revoke all sessions immediately. Changing the username or password hash also invalidates old sessions.
Use HTTPS for browser testing because Secure cookies are always enabled, including local development. Automated HTTP tests send the cookie explicitly to exercise server verification.
Do not add login credentials to client components. New protected routes or data endpoints must call the server auth guard.

## Validation

```sh
npm ci
npm run build
node --test tests/auth.test.mjs
```

Tests use random temporary credentials and secrets; they do not contain the initial account password.
They cover unauthenticated routes, wrong/successful login, cookie flags, tampering, expiry, rotation, CSRF, safe redirects and logout.
Production is not deployed by these steps. Review the branch and configure Vercel variables before authorizing production rollout.
