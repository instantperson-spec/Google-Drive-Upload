import { NextResponse } from 'next/server';
import { isAdminAuthenticated, unauthorizedAdminResponse } from '@/lib/adminAuth';
import { getActiveSessions } from '@/lib/progressStore';
import { formatBytes } from '@/lib/formatBytes';

export async function GET(request) {
  if (!(await isAdminAuthenticated(request))) {
    return unauthorizedAdminResponse();
  }

  const sessions = getActiveSessions().map((s) => {
    const totalSize = s.files.reduce((sum, f) => sum + (f.size || 0), 0);
    const completedCount = s.files.filter((f) => f.status === 'completed').length;
    const overallProgress =
      s.files.length === 0
        ? 0
        : Math.round(
            s.files.reduce((sum, f) => sum + (f.progress || 0), 0) / s.files.length
          );

    return {
      ...s,
      fileCount: s.files.length,
      completedCount,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      overallProgress,
      driveLink: `https://drive.google.com/drive/folders/${s.folderId}`,
    };
  });

  return NextResponse.json({
    active: sessions,
    total: sessions.length,
    fetchedAt: new Date().toISOString(),
  });
}
