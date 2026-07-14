import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    version: process.env.SERVICE_VERSION ?? '0.0.0',
  });
}
