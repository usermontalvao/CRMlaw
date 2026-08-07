// Preview de PDF na conversa do WhatsApp: miniatura da 1ª página dentro do
// balão e visualizador em tela cheia ao clicar — sem precisar baixar o arquivo
// para saber o que ele é. Antes, todo PDF virava um cartão "Documento · 240 KB"
// e o atendente tinha que baixar cada anexo para descobrir qual era qual.
import React, { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { formatBytes } from './format';
import type { WhatsAppMessage } from '../../types/whatsapp.types';

const WaPdfDocumentView = React.lazy(() => import('./pdfDocumentView'));

/** É PDF? O mimetype é o sinal bom; o nome do arquivo cobre quem manda sem ele. */
export function isPdfMessage(m: WhatsAppMessage): boolean {
  if ((m.media_mime || '').toLowerCase().includes('application/pdf')) return true;
  return (m.file_name || '').toLowerCase().endsWith('.pdf');
}

/** Acima disto, renderizar a 1ª página custa mais do que a miniatura vale. */
const MAX_THUMB_BYTES = 25 * 1024 * 1024;
const THUMB_WIDTH = 480; // 2x a largura do cartão — nítido em tela retina.

type Thumb = { src: string; pages: number };

/** Miniatura por documento. A URL assinada expira e muda, então a chave é o
 *  caminho no storage; sem ele, cai na própria URL. */
const thumbCache = new Map<string, Thumb>();

let pdfjsPromise: Promise<typeof import('react-pdf')['pdfjs']> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('react-pdf').then(async mod => {
      const { setLocalPdfWorker } = await import('../../utils/pdfWorker');
      setLocalPdfWorker(mod.pdfjs);
      return mod.pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Renderiza a 1ª página em um data URL e devolve também o total de páginas. */
async function renderFirstPage(url: string): Promise<Thumb> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument(url).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas indisponível');
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { src: canvas.toDataURL('image/png'), pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

function usePdfThumb(url: string | null, cacheKey: string, eligible: boolean) {
  const [thumb, setThumb] = useState<Thumb | null>(() => thumbCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || !eligible) return;
    const cached = thumbCache.get(cacheKey);
    if (cached) { setThumb(cached); return; }
    let cancelled = false;
    (async () => {
      try {
        const out = await renderFirstPage(url);
        thumbCache.set(cacheKey, out);
        if (!cancelled) setThumb(out);
      } catch {
        // PDF protegido por senha, corrompido ou URL expirada: o cartão simples
        // continua servindo (nome + tamanho + download).
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [url, cacheKey, eligible]);

  return { thumb, failed };
}

/** Cartão do PDF no balão: miniatura (quando dá) + nome, páginas e tamanho. */
export const WaPdfCard: React.FC<{ m: WhatsAppMessage; out: boolean }> = ({ m, out }) => {
  const url = m.media_url;
  const cacheKey = m.storage_path || url || m.id;
  const eligible = !!url && (!m.media_size || m.media_size <= MAX_THUMB_BYTES);
  const { thumb, failed } = usePdfThumb(url, cacheKey, eligible);
  const [open, setOpen] = useState(false);

  const name = m.file_name || 'Documento.pdf';
  const surface = out ? 'bg-black/[0.05] hover:bg-black/[0.08]' : 'bg-slate-100 hover:bg-slate-200';
  const detail = [thumb ? `${thumb.pages} ${thumb.pages === 1 ? 'página' : 'páginas'}` : null, formatBytes(m.media_size)]
    .filter(Boolean).join(' · ');

  // Sem URL ainda (mídia subindo/baixando) o cartão não abre nada.
  if (!url) {
    return (
      <span className={`flex items-center gap-2.5 min-w-[200px] px-2 py-1.5 rounded-lg ${out ? 'bg-black/[0.05]' : 'bg-slate-100'}`}>
        <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white text-rose-600 shadow-sm"><FileText size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold truncate text-slate-800">{name}</span>
          <span className="block text-[11px] text-slate-400">{formatBytes(m.media_size)}</span>
        </span>
      </span>
    );
  }

  return (
    <>
      <div className={`w-[240px] overflow-hidden rounded-lg ${out ? 'bg-black/[0.05]' : 'bg-slate-100'}`}>
        {eligible && !failed && (
          <button type="button" onClick={() => setOpen(true)} title="Abrir documento"
            className="block w-full bg-white text-left" aria-label={`Abrir ${name}`}>
            {thumb ? (
              // A folha aparece de cima para baixo e é cortada embaixo, como no
              // WhatsApp: o começo do documento é o que identifica o arquivo.
              <img src={thumb.src} alt="" className="block h-[168px] w-full object-cover object-top" />
            ) : (
              <span className="flex h-[168px] w-full items-center justify-center text-slate-300"><Loader2 size={20} className="animate-spin" /></span>
            )}
          </button>
        )}
        <div className={`flex items-center gap-2.5 px-2 py-1.5 ${surface} transition`}>
          <button type="button" onClick={() => setOpen(true)} title="Abrir documento"
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white text-rose-600 shadow-sm"><FileText size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold truncate text-slate-800">{name}</span>
              <span className="block text-[11px] text-slate-400">{detail}</span>
            </span>
          </button>
          <a href={url} target="_blank" rel="noreferrer" download={m.file_name || undefined}
            onClick={e => e.stopPropagation()} title="Baixar"
            className="flex-shrink-0 rounded p-1 text-slate-400 transition hover:bg-black/[0.06] hover:text-slate-600">
            <Download size={16} />
          </a>
        </div>
      </div>
      {open && <WaPdfViewer url={url} name={name} onClose={() => setOpen(false)} />}
    </>
  );
};

/**
 * Visualizador em tela cheia. Portal para `document.body` pelo mesmo motivo do
 * lightbox: o widget flutuante usa transform + overflow-hidden, que prenderiam
 * um `fixed` dentro da thread.
 */
export const WaPdfViewer: React.FC<{ url: string; name: string; onClose: () => void }> = ({ url, name, onClose }) => {
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex flex-col bg-black/85" style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-white" onClick={e => e.stopPropagation()}>
        <FileText size={18} className="flex-shrink-0 text-white/70" />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{name}</span>
        {pages > 0 && <span className="flex-shrink-0 text-[12px] tabular-nums text-white/60">{current} / {pages}</span>}
        <a href={url} target="_blank" rel="noreferrer" title="Abrir em nova aba"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"><ExternalLink size={18} /></a>
        <a href={url} download={name} title="Baixar"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"><Download size={18} /></a>
        <button type="button" onClick={onClose} title="Fechar"
          className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"><X size={20} /></button>
      </div>
      <div className="min-h-0 flex-1" onClick={e => e.stopPropagation()}>
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-white/80">
            <p>Não foi possível exibir este documento aqui.</p>
            <a href={url} target="_blank" rel="noreferrer"
              className="rounded-lg bg-white/15 px-3 py-1.5 font-semibold text-white transition hover:bg-white/25">Abrir em nova aba</a>
          </div>
        ) : (
          <Suspense fallback={<div className="flex h-full items-center justify-center gap-2 text-[13px] text-white/80"><Loader2 size={16} className="animate-spin" /> Carregando documento…</div>}>
            <WaPdfDocumentView url={url} onPages={setPages} onVisiblePage={setCurrent} onError={() => setFailed(true)} />
          </Suspense>
        )}
      </div>
    </div>,
    document.body,
  );
};
