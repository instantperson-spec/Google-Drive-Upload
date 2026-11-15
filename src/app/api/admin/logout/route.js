import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ADMIN_COOKIE,
  adminSessionCookieOptions,
  revokeAdminSessionToken,
} from '@/lib/adminAuth';

export async function POST() {
  const cookieStore = await cookies();
  const current = cookieStore.get(ADMIN_COOKIE)?.value;
  if (current) revokeAdminSessionToken(current);

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', { ...adminSessionCookieOptions(), maxAge: 0 });
  return response;
}
