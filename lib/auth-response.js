import 'server-only';
import { NextResponse } from 'next/server';

export function sameOrigin(request) {
  // Browser POST forms send Origin; reject missing/null and cross-site origins.
  return request.headers.get('origin') === new URL(request.url).origin;
}
export function authRedirect(request, path) {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
