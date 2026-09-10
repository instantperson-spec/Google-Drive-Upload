import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/adminAuth';

/** Lightweight auth probe — always 200 (no 401 noise in browser console before login). */
export async function GET(request) {
  const authenticated = await isAdminAuthenticated(request);
  return NextResponse.json({ authenticated });
}
