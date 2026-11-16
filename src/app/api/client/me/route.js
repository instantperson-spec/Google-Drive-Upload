import { NextResponse } from 'next/server';
import {
  getClientFromRequest,
  publicClientSession,
} from '@/lib/clientAuth';

export async function GET(request) {
  const client = await getClientFromRequest(request);
  if (!client) {
    return NextResponse.json({ authenticated: false, client: null });
  }
  return NextResponse.json({
    authenticated: true,
    client: publicClientSession(client),
  });
}
