import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';

/** Lightweight check: is the upload token from the URL still valid? */
export async function POST(request) {
  const limited = rateLimit(request, 'validate-token', 30);
  if (limited) return limited;

  const token = await verifyUploadToken(request);
  if (!token) return unauthorizedResponse();

  return NextResponse.json({ valid: true, token });
}
