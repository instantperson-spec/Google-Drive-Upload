import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { createToken, listTokens, buildUploadUrl } from '@/lib/tokenStore';
import { listLinkedTokenSlugs } from '@/lib/clientStore';
import { getUploadOrigin } from '@/lib/uploadOrigin';
import { rateLimit } from '@/lib/rateLimit';

function enrichToken(record, origin, linkedSlugs) {
  const hubBound =
    Boolean(record.hubBound) ||
    (typeof record.notes === 'string' &&
      /auto-created on invited client hub signup/i.test(record.notes)) ||
    linkedSlugs.has(String(record.token || ''));

  return {
    ...record,
    hubBound,
    // Hub-bound tokens are session-only — never advertise a shareable upload URL.
    uploadUrl: hubBound ? null : buildUploadUrl(origin, record.token),
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
    const origin = getUploadOrigin(request);
    const [tokens, linkedSlugs] = await Promise.all([
      listTokens(),
      listLinkedTokenSlugs().catch(() => new Set()),
    ]);
    // Hub-bound bindings belong under Client hub → Accounts, not this list.
    const shareable = tokens
      .map((t) => enrichToken(t, origin, linkedSlugs))
      .filter((t) => !t.hubBound);
    return NextResponse.json({
      tokens: shareable,
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
      clientEmail: body.clientEmail || body.prefillEmail,
      prefillName: body.prefillName,
      prefillEmail: body.prefillEmail || body.clientEmail,
      type: body.type,
      expiresAt: body.expiresAt || null,
      notes: body.notes,
      locale: body.locale,
    });

    const origin = getUploadOrigin(request);
    return NextResponse.json(
      { token: enrichToken(record, origin, new Set()) },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to create token.' }, { status: 400 });
  }
}
