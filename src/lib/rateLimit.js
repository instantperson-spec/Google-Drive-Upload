import { NextResponse } from 'next/server';

/**
 * Simple in-memory sliding-window rate limiter, keyed by IP + route.
 *
 * Good enough for a single serverless instance / local dev without external
 * dependencies. Note: on Vercel each warm lambda instance keeps its own
 * counters, so the effective global limit may be a small multiple of the
 * configured one — acceptable as an abuse brake, not a hard quota.
 */
const WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10000;

const hits = new Map(); // key -> array of timestamps within the window

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

/**
 * @param {Request} request
 * @param {string} routeName distinct bucket per route
 * @param {number} maxPerMinute
 * @returns {NextResponse|null} 429 response if limited, null otherwise
 */
export function rateLimit(request, routeName, maxPerMinute) {
  const now = Date.now();
  const key = `${routeName}:${getClientIp(request)}`;

  // Memory guard: sweep expired entries when the map grows too large
  if (hits.size > MAX_TRACKED_KEYS) {
    for (const [k, timestamps] of hits) {
      if (timestamps[timestamps.length - 1] < now - WINDOW_MS) hits.delete(k);
    }
  }

  const recent = (hits.get(key) || []).filter(t => t > now - WINDOW_MS);
  if (recent.length >= maxPerMinute) {
    hits.set(key, recent);
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429 }
    );
  }

  recent.push(now);
  hits.set(key, recent);
  return null;
}
