export function generateFingerprint(): string {
  const raw = [
    navigator.userAgent,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|');
  let hash = 0;
  for (const c of raw) {
    hash = (Math.imul(31, hash) + c.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(16);
}
