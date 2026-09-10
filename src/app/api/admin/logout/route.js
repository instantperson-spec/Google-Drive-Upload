import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminSessionCookieOptions } from '@/lib/adminAuth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', { ...adminSessionCookieOptions(), maxAge: 0 });
  return response;
}
