import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import {
  revokeToken,
  restoreToken,
  setTokenIdentity,
  buildUploadUrl,
} from '@/lib/tokenStore';
import { getUploadOrigin } from '@/lib/uploadOrigin';
import { rateLimit } from '@/lib/rateLimit';

export async function PATCH(request, { params }) {
  if (!(await isAdminAuthenticated(request))) return unauthorizedAdminResponse();

  const limited = rateLimit(request, 'admin-tokens-patch', 20);
  if (limited) return limited;

  const { id } = await params;

  try {
    const body = await request.json();
    let record;

    if (body.action === 'restore') {
      record = await restoreToken(id);
    } else if (body.action === 'revoke' || body.revoked === true) {
      record = await revokeToken(id);
    } else if (body.action === 'identity') {
      record = await setTokenIdentity(id, {
        clientName: body.clientName,
        clientEmail: body.clientEmail || body.prefillEmail,
      });
    } else {
      return NextResponse.json(
        { error: 'Unsupported action. Use action: "revoke", "restore", or "identity".' },
        { status: 400 }
      );
    }

    const origin = getUploadOrigin(request);
    return NextResponse.json({
      token: {
        ...record,
        uploadUrl: buildUploadUrl(origin, record.token),
        status: record.revoked ? 'revoked' : 'active',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to update token.' }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  if (!(await isAdminAuthenticated(request))) return unauthorizedAdminResponse();

  const limited = rateLimit(request, 'admin-tokens-delete', 20);
  if (limited) return limited;

  const { id } = await params;

  try {
    const { deleteToken } = await import('@/lib/tokenStore');
    await deleteToken(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to delete token.' }, { status: 400 });
  }
}
