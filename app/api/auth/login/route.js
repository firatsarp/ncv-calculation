import { NextResponse } from 'next/server';
import { authConfig, verifyCredentials, createSession, SESSION_COOKIE, sessionCookieOptions, safeNext } from '../../../../lib/auth-core.mjs';
import { sameOrigin, authRedirect } from '../../../../lib/auth-response';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!sameOrigin(request)) return new NextResponse('Forbidden', { status: 403 });
  const length = Number(request.headers.get('content-length'));
  if (length > 8192) return new NextResponse('Payload too large', { status: 413 });
  let form;
  try { form = await request.formData(); }
  catch { return new NextResponse('Invalid form', { status: 400 }); }
  const next = safeNext(form.get('next'));
  const failed = (error) => {
    const response = authRedirect(request, '/login?error=' + error + '&next=' + encodeURIComponent(next));
    response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
    return response;
  };
  let config;
  try { config = authConfig(); }
  catch { return failed('unavailable'); }
  if (!await verifyCredentials(form.get('username'), form.get('password'), config)) return failed('invalid');
  const response = authRedirect(request, next);
  response.cookies.set(SESSION_COOKIE, createSession(config), sessionCookieOptions);
  return response;
}
