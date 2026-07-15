import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = new Set(['/', '/login', '/api/health', '/api/auth/login', '/api/auth/logout']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next();
  }

  const cookieName = process.env.SESSION_COOKIE_NAME ?? 'csm_session';
  const session = request.cookies.get(cookieName);
  if (!session?.value) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\..*).*)'],
};
