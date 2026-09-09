import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getTokenRecord, revokeTokenByValue } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';

/** Revoke a one-time upload token after successful project delivery. */
export async function POST(request) {
  const limited = rateLimit(request, 'revoke-upload-token', 5);
  if (limited) return limited;

  const token = await verifyUploadToken(request);
  if (!token) return unauthorizedResponse();

  try {
    const record = await getTokenRecord(token);
    if (!record) {
      return NextResponse.json({ revoked: false, reason: 'Token not in registry.' });
    }
    if (record.type !== 'one-time') {
      return NextResponse.json({ revoked: false, reason: 'Retainer tokens are not auto-revoked.' });
    }
    if (record.revoked) {
      return NextResponse.json({ revoked: true, alreadyRevoked: true });
    }

    await revokeTokenByValue(token);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error('revoke-upload-token error:', error.message || error);
    return NextResponse.json({ error: 'Failed to revoke token.' }, { status: 500 });
  }
}
