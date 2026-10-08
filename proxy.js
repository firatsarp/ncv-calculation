import { NextResponse } from 'next/server';
import { SESSION_COOKIE, authConfig, verifySession } from './lib/auth-core.mjs';

export function proxy(request) {
  let session = null;
  try {
    session = verifySession(request.cookies.get(SESSION_COOKIE)?.value, authConfig());
  } catch { /* Fail closed. */ }
  if (!session) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', request.nextUrl.pathname);
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/', '/ncv-calculation/:path*', '/scenario/:path*'],
};
