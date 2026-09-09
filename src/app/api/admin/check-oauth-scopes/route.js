import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { runOAuthScopeCheck } from '@/lib/checkOAuthScopes';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  if (!(await isAdminAuthenticated(request))) return unauthorizedAdminResponse();

  const limited = rateLimit(request, 'admin-check-oauth', 5);
  if (limited) return limited;

  try {
    const report = await runOAuthScopeCheck();
    return NextResponse.json(report);
  } catch (error) {
    console.error('OAuth scope check error:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'OAuth scope check failed.' },
      { status: 500 }
    );
  }
}
