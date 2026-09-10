import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  adminSessionCookieOptions,
  createAdminSessionToken,
  verifyAdminPassword,
} from '@/lib/adminAuth';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'admin-login', 5);
  if (limited) return limited;

  if (!process.env.ADMIN_SECRET) {
    return NextResponse.json(
      { error: 'Admin access is not configured (ADMIN_SECRET missing).' },
      { status: 503 }
    );
  }

  try {
    const { password } = await request.json();
    if (!verifyAdminPassword(password)) {
      return NextResponse.json({ error: 'Invalid password.' }, { status: 401 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_COOKIE, createAdminSessionToken(), adminSessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
