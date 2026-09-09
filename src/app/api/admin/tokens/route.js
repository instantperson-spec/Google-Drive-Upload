import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { createToken, listTokens, buildUploadUrl } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';

function getOrigin(request) {
  return (
    process.env.PUBLIC_UPLOAD_URL ||
    request.headers.get('origin') ||
    'http://localhost:3000'
  );
}

function enrichWithUrl(record, origin) {
  return {
    ...record,
    uploadUrl: buildUploadUrl(origin, record.token),
    status: record.revoked
      ? 'revoked'
      : record.expiresAt && new Date(record.expiresAt) < new Date()
        ? 'expired'
        : 'active',
  };
}

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) return unauthorizedAdminResponse();

  try {
    const origin = getOrigin(request);
    const tokens = await listTokens();
    return NextResponse.json({
      tokens: tokens.map((t) => enrichWithUrl(t, origin)),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin tokens list error:', error.message || error);
    return NextResponse.json({ error: error.message || 'Failed to load tokens.' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await isAdminAuthenticated(request))) return unauthorizedAdminResponse();

  const limited = rateLimit(request, 'admin-tokens-create', 10);
  if (limited) return limited;

  try {
    const body = await request.json();
    const record = await createToken({
      token: body.token,
      clientName: body.clientName,
      type: body.type,
      expiresAt: body.expiresAt || null,
      notes: body.notes,
    });

    const origin = getOrigin(request);
    return NextResponse.json({ token: enrichWithUrl(record, origin) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to create token.' }, { status: 400 });
  }
}
