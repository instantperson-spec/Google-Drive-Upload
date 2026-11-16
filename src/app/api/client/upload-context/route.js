import { NextResponse } from 'next/server';
import {
  getClientFromRequest,
  publicClientSession,
  unauthorizedClientResponse,
} from '@/lib/clientAuth';
import { getTokenPrefill, getTokenLocale, isTokenActive } from '@/lib/tokenStore';
import { rateLimit } from '@/lib/rateLimit';

/**
 * Hub upload bootstrap: confirms session + linked token without exposing the slug.
 */
export async function GET(request) {
  const limited = rateLimit(request, 'client-upload-context', 60);
  if (limited) return limited;

  const client = await getClientFromRequest(request);
  if (!client) return unauthorizedClientResponse();

  const linked = client.linkedToken ? String(client.linkedToken).trim() : '';
  if (!linked) {
    return NextResponse.json(
      {
        error:
          'No linked upload token on this account. Ask the studio to link a retainer token.',
        client: publicClientSession(client),
        canUpload: false,
      },
      { status: 403 }
    );
  }

  try {
    if (!(await isTokenActive(linked))) {
      return NextResponse.json(
        {
          error: 'Linked upload token is inactive or revoked.',
          client: publicClientSession(client),
          canUpload: false,
        },
        { status: 403 }
      );
    }

    const prefill = await getTokenPrefill(linked);
    const locale = await getTokenLocale(linked);

    return NextResponse.json({
      ok: true,
      canUpload: true,
      client: publicClientSession(client),
      prefill: {
        name: client.displayName || prefill?.name || '',
        email: client.email || prefill?.email || '',
        incomplete: false,
      },
      locale: locale || client.locale || 'en',
    });
  } catch (err) {
    console.error('client upload-context error:', err.message || err);
    return NextResponse.json(
      { error: err.message || 'Failed to resolve upload context.' },
      { status: 500 }
    );
  }
}
