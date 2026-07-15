import { getWebEnv } from './env';
import { getSession } from './session';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(extractMessage(body) ?? `API error ${status}`);
    this.name = 'ApiRequestError';
  }
}

function extractMessage(body: unknown): string | undefined {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof (body.error as { message: unknown }).message === 'string'
  ) {
    return (body.error as { message: string }).message;
  }
  return undefined;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { optionalAuth?: boolean } = {},
): Promise<T> {
  const env = getWebEnv();
  const session = await getSession();
  if (!session?.accessToken && !init.optionalAuth) {
    throw new ApiRequestError(401, { error: { message: 'Not signed in' } });
  }

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(new URL(path, env.API_BASE_URL), {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }
  return body as T;
}

/** Unauthenticated server call (dev scenarios / login). */
export async function apiFetchPublic<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = getWebEnv();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(new URL(path, env.API_BASE_URL), {
    ...init,
    headers,
    cache: 'no-store',
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiRequestError(response.status, body);
  }
  return body as T;
}
