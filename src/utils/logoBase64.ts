let cachedDataUrl: string | null = null;
let cachedBytes: Uint8Array | null = null;

/** Returns /logo.png as a data URL. Cached after first fetch. */
export async function getLogoDataUrl(): Promise<string> {
  if (cachedDataUrl) return cachedDataUrl;
  const res = await fetch('/logo.png');
  const blob = await res.blob();
  cachedDataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return cachedDataUrl;
}

/** Returns /logo.png as raw bytes for pdf-lib embedPng(). Cached after first fetch. */
export async function getLogoBytes(): Promise<Uint8Array> {
  if (cachedBytes) return cachedBytes;
  const res = await fetch('/logo.png');
  cachedBytes = new Uint8Array(await res.arrayBuffer());
  return cachedBytes;
}
