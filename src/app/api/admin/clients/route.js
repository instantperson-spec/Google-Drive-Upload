import { NextResponse } from 'next/server';
import {
  isAdminAuthenticated,
  unauthorizedAdminResponse,
} from '@/lib/adminAuth';
import {
  createClient,
  listClients,
  listAllMemberships,
  ClientStoreConflictError,
} from '@/lib/clientStore';
import { rateLimit } from '@/lib/rateLimit';

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  try {
    const [clients, memberships] = await Promise.all([
      listClients(),
      listAllMemberships(),
    ]);
    return NextResponse.json({ clients, memberships });
  } catch (err) {
    console.error('admin clients GET:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to list clients.' },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const limited = rateLimit(request, 'admin-clients-create', 20);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => ({}));
    const client = await createClient({
      email: body.email,
      password: body.password,
      displayName: body.displayName || '',
      locale: body.locale || 'en',
      linkedToken: body.linkedToken || null,
    });
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    const status = err instanceof ClientStoreConflictError ? 409 : 400;
    return NextResponse.json(
      { error: err.message || 'Failed to create client.' },
      { status }
    );
  }
}
