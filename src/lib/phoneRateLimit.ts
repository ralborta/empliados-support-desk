/** Rate limit in-memory por instancia serverless (mitiga floods y retries en ráfaga). */
const buckets = new Map<string, { count: number; resetAt: number }>();

const DEFAULT_MAX_PER_MINUTE = 30;

export function allowPhoneRequest(phone: string, maxPerMinute = DEFAULT_MAX_PER_MINUTE): boolean {
  const key = phone.replace(/\D/g, "") || phone;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  bucket.count += 1;
  if (bucket.count > maxPerMinute) return false;
  return true;
}
