export function parseScanValue(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  if (value.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        for (const key of ['code', 'barcode', 'sku']) {
          const candidate = record[key];
          if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
        for (const key of ['id', 'product_id']) {
          const candidate = record[key];
          if (typeof candidate === 'number') return String(candidate);
          if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        }
      }
    } catch (_error: unknown) {
      // Not JSON; keep the raw value.
    }
  }
  try {
    const url = new URL(value);
    const codeParam = url.searchParams.get('code') ?? url.searchParams.get('barcode');
    if (codeParam?.trim()) return codeParam.trim();
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) return decodeURIComponent(segments[segments.length - 1]);
  } catch (_error: unknown) {
    // Not a URL; keep the raw value.
  }
  return value;
}
