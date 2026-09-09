import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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

    const cookieStore = await cookies();
    cookieStore.set(ADMIN_COOKIE, createAdminSessionToken(), adminSessionCookieOptions());

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
