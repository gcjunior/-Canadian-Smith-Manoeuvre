import { NextResponse } from 'next/server';

import { getWebEnv } from '@/lib/env';

export async function POST(request: Request) {
  const env = getWebEnv();
  const url = new URL('/login', request.url);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(env.SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
  return response;
}
