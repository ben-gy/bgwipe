export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  const clamped = Math.max(0, Math.min(1, fraction));
  return `${Math.round(clamped * 100)}%`;
}

export function clampDimension(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scale: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height, scale: 1 };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

const SUPPORTED_INPUT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/bmp',
]);

export function isSupportedImage(file: { type: string; name?: string }): boolean {
  if (file.type && SUPPORTED_INPUT_TYPES.has(file.type.toLowerCase())) return true;
  const name = (file.name ?? '').toLowerCase();
  return /\.(jpe?g|png|webp|bmp)$/.test(name);
}

export function suggestedOutputName(inputName: string | undefined): string {
  if (!inputName) return 'bgwipe.png';
  const dot = inputName.lastIndexOf('.');
  const base = dot > 0 ? inputName.slice(0, dot) : inputName;
  const cleaned = base.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const safe = cleaned === '' || /^_+$/.test(cleaned) ? 'image' : cleaned;
  return `${safe}-cutout.png`;
}
