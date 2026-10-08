import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth-core.mjs';
import { sameOrigin, authRedirect } from '../../../../lib/auth-response';

export async function POST(request) {
  if (!sameOrigin(request)) return new NextResponse('Forbidden', { status: 403 });
  const response = authRedirect(request, '/login');
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
  return response;
}
