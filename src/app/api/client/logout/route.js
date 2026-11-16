import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  CLIENT_COOKIE,
  clientSessionCookieOptions,
  revokeClientSessionToken,
} from '@/lib/clientAuth';

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  if (raw) revokeClientSessionToken(raw);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(CLIENT_COOKIE, '', {
    ...clientSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
