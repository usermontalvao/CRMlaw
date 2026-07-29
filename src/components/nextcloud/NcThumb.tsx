import React, { useEffect, useState } from 'react';
import { pdfjs } from 'react-pdf';
import { Loader2 } from 'lucide-react';
import { nextcloudService, type NextcloudEntry } from '../../services/nextcloud.service';
import { isImage, isPdf, extIcon, fileIconColorClass } from '../../utils/nextcloudFile';
import { setLocalPdfWorker } from '../../utils/pdfWorker';

setLocalPdfWorker(pdfjs);

/** Cache de miniaturas por caminho (data URL / object URL). Compartilhado: o
 *  NextcloudBrowser invalida entradas quando um arquivo muda no servidor. */
export const thumbCache = new Map<string, string>();

/** Renderiza a 1ª página de um PDF (bytes) em um data URL, via pdfjs. */
async function pdfFirstPageThumb(bytes: ArrayBuffer, width = 150): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    doc.destroy();
  }
}

/**
 * Miniatura de um arquivo do Nextcloud (imagem direta ou 1ª página de PDF).
 * Extraído de NextcloudBrowser (refactor incremental — Fase 5).
 */
export const NcThumb: React.FC<{ entry: NextcloudEntry }> = ({ entry }) => {
  const eligible = (isImage(entry) && entry.size <= 12 * 1024 * 1024) || (isPdf(entry) && entry.size <= 25 * 1024 * 1024);
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(entry.path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!eligible || thumbCache.has(entry.path)) { setUrl(thumbCache.get(entry.path) ?? null); return; }
    let cancelled = false;
    (async () => {
      try {
        const blob = await nextcloudService.readFile(entry.path);
        let out: string;
        if (isImage(entry)) {
          out = URL.createObjectURL(blob);
        } else {
          out = await pdfFirstPageThumb(await blob.arrayBuffer());
        }
        thumbCache.set(entry.path, out);
        if (!cancelled) setUrl(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.path, entry.size, eligible]);

  const Icon = extIcon(entry);
  if (!eligible || failed) {
    return <div className="w-full h-24 flex items-center justify-center"><Icon className={`w-12 h-12 ${fileIconColorClass(entry)}`} /></div>;
  }
  if (!url) {
    return <div className="w-full h-24 flex items-center justify-center bg-slate-100 dark:bg-gray-800 rounded-lg"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }
  return (
    <div className="w-full h-24 overflow-hidden rounded-lg bg-slate-100 dark:bg-gray-800 flex items-center justify-center">
      <img src={url} alt={entry.name} className="max-w-full max-h-full object-contain" />
    </div>
  );
};

export default NcThumb;
