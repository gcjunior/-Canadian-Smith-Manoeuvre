import { NextResponse } from 'next/server';

import { apiFetch, ApiRequestError } from '@/lib/api-server';
import { getSession } from '@/lib/session';

/** SSE-style poll endpoint for dashboard freshness (no message broker). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  }

  const url = new URL(request.url);
  const strategyId = url.searchParams.get('strategyId');
  if (!strategyId) {
    return NextResponse.json({ error: { message: 'strategyId required' } }, { status: 400 });
  }

  const wantsStream = request.headers.get('accept')?.includes('text/event-stream');

  try {
    if (!wantsStream) {
      const dashboard = await apiFetch(`/strategies/${strategyId}/dashboard`);
      return NextResponse.json(dashboard);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = async () => {
          try {
            const dashboard = await apiFetch(`/strategies/${strategyId}/dashboard`);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(dashboard)}\n\n`));
          } catch (error) {
            const message = error instanceof Error ? error.message : 'status error';
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
            );
          }
        };
        await send();
        const id = setInterval(() => {
          void send();
        }, 5000);
        request.signal.addEventListener('abort', () => {
          clearInterval(id);
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ error: { message: 'Status unavailable' } }, { status: 502 });
  }
}
