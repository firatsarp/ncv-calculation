import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfig, SESSION_COOKIE, verifySession } from './auth-core.mjs';

export async function requireSession() {
  let session = null;
  try {
    session = verifySession((await cookies()).get(SESSION_COOKIE)?.value, authConfig());
  } catch { /* Fail closed when deployment configuration is incomplete. */ }
  if (!session) redirect('/login');
  return session;
}
