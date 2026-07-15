import { cookies } from 'next/headers';

import { getWebEnv } from './env';

export type SessionClaims = {
  accessToken: string;
  tenantId: string;
  userId: string;
  roles: string[];
  email?: string;
  displayName?: string;
};

export async function getSession(): Promise<SessionClaims | null> {
  const env = getWebEnv();
  const store = await cookies();
  const raw = store.get(env.SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SessionClaims;
    if (!parsed.accessToken || !parsed.tenantId || !parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeSession(claims: SessionClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
