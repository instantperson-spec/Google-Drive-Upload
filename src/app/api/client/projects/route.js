import { NextResponse } from 'next/server';
import {
  getClientFromRequest,
  unauthorizedClientResponse,
} from '@/lib/clientAuth';
import { listProjectsForClient } from '@/lib/clientProjects';
import { rateLimit } from '@/lib/rateLimit';

export async function GET(request) {
  const limited = rateLimit(request, 'client-projects', 60);
  if (limited) return limited;

  const client = await getClientFromRequest(request);
  if (!client) return unauthorizedClientResponse();

  try {
    const projects = await listProjectsForClient(client);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error('client projects error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to list projects.' },
      { status: 500 }
    );
  }
}
