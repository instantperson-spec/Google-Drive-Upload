import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE } from '@/lib/adminAuth';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  return NextResponse.json({ success: true });
}
