import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getTokenPrefill, getTokenLocale } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';

/** Lightweight check: is the upload token from the URL still valid? */
export async function POST(request) {
  const limited = rateLimit(request, 'validate-token', 30);
  if (limited) return limited;

  const token = await verifyUploadToken(request);
  if (!token) return unauthorizedResponse();

  const [prefill, locale] = await Promise.all([
    getTokenPrefill(token),
    getTokenLocale(token),
  ]);
  return NextResponse.json({ valid: true, token, prefill, locale });
}
