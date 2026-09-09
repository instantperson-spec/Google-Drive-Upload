/** Map API error responses to user-friendly messages. */
export async function getApiErrorMessage(res, fallback) {
  if (res.status === 401) {
    return 'This upload link is no longer valid. It may have been revoked or expired. Please contact the studio for a new link.';
  }
  if (res.status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  try {
    const data = await res.json();
    if (data?.error) return data.error;
  } catch {
    // ignore parse errors
  }
  return fallback;
}
