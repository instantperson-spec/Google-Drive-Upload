import { NextResponse } from 'next/server';
import {
  isAdminAuthenticated,
  unauthorizedAdminResponse,
} from '@/lib/adminAuth';
import {
  updateClient,
  setClientPassword,
  deleteClient,
  assignProject,
  unassignProject,
  getClientById,
  ClientStoreConflictError,
} from '@/lib/clientStore';
import { rateLimit } from '@/lib/rateLimit';

export async function PATCH(request, { params }) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const limited = rateLimit(request, 'admin-clients-patch', 60);
  if (limited) return limited;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();

    if (action === 'password') {
      const client = await setClientPassword(id, body.password);
      return NextResponse.json({ client });
    }

    if (action === 'revoke') {
      const client = await updateClient(id, { revoke: true });
      return NextResponse.json({ client });
    }

    if (action === 'restore') {
      const client = await updateClient(id, { restore: true });
      return NextResponse.json({ client });
    }

    if (action === 'update') {
      const client = await updateClient(id, {
        displayName: body.displayName,
        locale: body.locale,
        linkedToken: body.linkedToken,
      });
      return NextResponse.json({ client });
    }

    if (action === 'assign') {
      const existing = await getClientById(id);
      const membership = await assignProject({
        folderId: body.folderId,
        clientEmail: body.clientEmail || existing?.email,
        shareId: body.shareId || null,
        label: body.label || null,
        assignedBy: 'admin',
      });
      return NextResponse.json({ membership });
    }

    if (action === 'unassign') {
      await unassignProject(body.membershipId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    const status = err instanceof ClientStoreConflictError ? 409 : 400;
    return NextResponse.json(
      { error: err.message || 'Failed to update client.' },
      { status }
    );
  }
}

export async function DELETE(request, { params }) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  try {
    const { id } = await params;
    await deleteClient(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || 'Failed to delete client.' },
      { status: 400 }
    );
  }
}
