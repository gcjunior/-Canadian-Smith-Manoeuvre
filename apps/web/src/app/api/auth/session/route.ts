import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    tenantId: session.tenantId,
    userId: session.userId,
    roles: session.roles,
    email: session.email,
    displayName: session.displayName,
  });
}
