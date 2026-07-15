import { NextResponse } from 'next/server';

import { apiFetchPublic } from '@/lib/api-server';
import { getWebEnv } from '@/lib/env';
import { encodeSession, sessionCookieOptions } from '@/lib/session';

type DevTokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};

export async function POST(request: Request) {
  const env = getWebEnv();
  const body = (await request.json()) as {
    tenantId?: string;
    userId?: string;
    roles?: string[];
    email?: string;
    displayName?: string;
  };

  if (!body.tenantId || !body.userId || !body.roles?.length) {
    return NextResponse.json(
      { error: { message: 'tenantId, userId, and roles are required' } },
      { status: 400 },
    );
  }

  try {
    const token = await apiFetchPublic<DevTokenResponse>('/auth/dev-token', {
      method: 'POST',
      body: JSON.stringify({
        tenantId: body.tenantId,
        userId: body.userId,
        roles: body.roles,
      }),
    });

    const response = NextResponse.json({
      ok: true,
      roles: body.roles,
      tenantId: body.tenantId,
      userId: body.userId,
    });
    response.cookies.set(
      env.SESSION_COOKIE_NAME,
      encodeSession({
        accessToken: token.accessToken,
        tenantId: body.tenantId,
        userId: body.userId,
        roles: body.roles,
        email: body.email,
        displayName: body.displayName,
      }),
      sessionCookieOptions(token.expiresIn),
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return NextResponse.json({ error: { message } }, { status: 502 });
  }
}
