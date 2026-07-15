import { NextResponse } from 'next/server';

import { getWebEnv } from '@/lib/env';
import { getSession } from '@/lib/session';

async function proxy(request: Request, path: string[]) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const env = getWebEnv();
  const url = new URL(request.url);
  const target = new URL(path.join('/'), `${env.API_BASE_URL}/`);
  target.search = url.search;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  headers.set('Accept', 'application/json');
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const upstream = await fetch(target, init);
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function POST(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(request, path);
}
