import { NextResponse } from 'next/server';
import { verifyUploadToken, unauthorizedResponse } from '@/lib/auth';
import { getAuthClient, isSessionFolder } from '@/lib/googleAuth';
import { buildSessionStructure } from '@/lib/buildStructure';
import { parseManifestPayload } from '@/lib/pathManifest';
import { rateLimit } from '@/lib/rateLimit';

export async function POST(request) {
  const limited = rateLimit(request, 'build-structure', 10);
  if (limited) return limited;
  if (!(await verifyUploadToken(request))) return unauthorizedResponse();

  try {
    const body = await request.json();
    const parsed = parseManifestPayload(body);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { folderId, entries } = parsed;
    const authClient = await getAuthClient();

    if (!(await isSessionFolder(authClient, folderId))) {
      return NextResponse.json({ error: 'Invalid target folder' }, { status: 403 });
    }

    const result = await buildSessionStructure(authClient, folderId, entries);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, stats: result.stats },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      skipped: result.skipped,
      message: result.message,
      stats: result.stats,
    });
  } catch (error) {
    console.error('build-structure error:', error.message || error);
    return NextResponse.json(
      { error: error.message || 'Failed to build folder structure.' },
      { status: 500 }
    );
  }
}
