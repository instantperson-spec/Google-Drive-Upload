import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { countActiveShares, readSharesRegistry } from '@/lib/shareStore';

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  try {
    const registry = await readSharesRegistry();
    const shares = (registry.shares || []).filter((s) => s && !s.revoked);
    const activeCount = await countActiveShares();
    return NextResponse.json({
      activeCount,
      total: (registry.shares || []).length,
      shares: shares.map((s) => ({
        id: s.id,
        folderId: s.folderId,
        label: s.label || null,
        roundId: s.roundId || null,
        roundLabel: s.roundLabel || null,
        createdAt: s.createdAt || null,
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('admin shares error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to load shares' },
      { status: 500 }
    );
  }
}
