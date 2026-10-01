export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function isInternalHostname(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === 'host.docker.internal') {
      return true;
    }
    // Docker service names have no dots (e.g. supabase-kong); public domains do.
    return !host.includes('.');
  } catch (_error: unknown) {
    return false;
  }
}

export function resolvePublicBase(explicit: string | undefined, internal: string): string {
  const candidate = (explicit ?? internal ?? '').trim();
  if (!candidate) return '';
  if (isInternalHostname(candidate)) return '';
  return trimTrailingSlash(candidate);
}
