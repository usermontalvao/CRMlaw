// Preview de anexos (estilo WhatsApp Web) com legenda e tira de miniaturas.
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Plus, Send } from 'lucide-react';
import { formatBytes } from './format';

export const AttachmentPreviewModal: React.FC<{
  files: File[];
  onClose: () => void;
  onConfirm: (caption: string, files: File[]) => void;
}> = ({ files, onClose, onConfirm }) => {
  const [items, setItems] = useState<File[]>(files);
  const [active, setActive] = useState(0);
  const [caption, setCaption] = useState('');
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const addInputRef = useRef<HTMLInputElement>(null);

  const MAX_BYTES = 100 * 1024 * 1024;
  const addMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []).filter(f => f.size > 0 && f.size <= MAX_BYTES);
    e.target.value = '';
    if (picked.length) setItems(prev => { const next = [...prev, ...picked]; setActive(next.length - 1); return next; });
  };

  // Gera URLs de blob via efeito — mais robusto que useMemo em HMR/StrictMode.
  useEffect(() => {
    const created = items.map(f =>
      (f.type.startsWith('image/') || f.type.startsWith('video/')) ? URL.createObjectURL(f) : null);
    setUrls(created);
    return () => { created.forEach(u => u && URL.revokeObjectURL(u)); };
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setActive(a => Math.min(a + 1, items.length - 1));
      if (e.key === 'ArrowLeft') setActive(a => Math.max(a - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, items.length]);

  const removeAt = (i: number) => {
    const next = items.filter((_, idx) => idx !== i);
    if (next.length === 0) { onClose(); return; }
    setActive(a => Math.min(a, next.length - 1));
    setItems(next);
  };

  const cur = items[active];
  const curUrl = urls[active] ?? null;
  const isImg = cur?.type.startsWith('image/');
  const isVid = cur?.type.startsWith('video/');

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-[520px] max-w-[96vw] flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-[#0b141a]"
        style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

        {/* Cabeçalho escuro */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[#202c33]">
          <button onClick={onClose} className="text-white/60 hover:text-white transition flex-shrink-0">
            <X size={20} />
          </button>
          <span className="text-[13px] font-medium text-white/80 truncate flex-1">
            {cur?.name || '—'}
          </span>
          {items.length > 1 && <span className="text-[12px] text-white/40 flex-shrink-0">{active + 1}/{items.length}</span>}
        </div>

        {/* Preview principal */}
        <div className="flex-1 flex items-center justify-center bg-[#0b141a] min-h-0"
          style={{ minHeight: 280, maxHeight: 400 }}>
          {curUrl && isImg ? (
            <img src={curUrl} alt={cur?.name}
              className="max-w-full max-h-full object-contain select-none"
              style={{ maxHeight: 380 }} />
          ) : curUrl && isVid ? (
            <video src={curUrl} controls className="max-w-full max-h-full" style={{ maxHeight: 380 }} />
          ) : cur ? (
            <div className="flex flex-col items-center gap-3 px-8 py-10 text-center">
              <span className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
                <FileText size={32} className="text-white/60" />
              </span>
              <p className="text-white/80 text-[13px] font-medium">{cur.name}</p>
              <p className="text-white/40 text-[11px]">{formatBytes(cur.size)}</p>
            </div>
          ) : null}
        </div>

        <input ref={addInputRef} type="file" accept="image/*,video/*,*/*" multiple className="hidden" onChange={addMore} />

        {/* Tira de miniaturas — só quando há mais de 1 item (estilo WhatsApp) */}
        {items.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#1a1a1a] overflow-x-auto">
            {items.map((f, i) => {
              const u = urls[i];
              const isActive = i === active;
              return (
                <button key={i} onClick={() => setActive(i)}
                  className={`group/th relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden bg-white/5 ring-2 transition ${isActive ? 'ring-[#00a884]' : 'ring-transparent opacity-70 hover:opacity-100'}`}>
                  {u && f.type.startsWith('image/') ? (
                    <img src={u} alt={f.name} className="w-full h-full object-cover" />
                  ) : u && f.type.startsWith('video/') ? (
                    <video src={u} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full bg-white/10 flex items-center justify-center">
                      <FileText size={16} className="text-white/60" />
                    </span>
                  )}
                  <span onClick={e => { e.stopPropagation(); removeAt(i); }}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover/th:opacity-100 transition cursor-pointer">
                    <X size={9} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Rodapé: + adicionar · legenda · enviar (estilo WhatsApp) */}
        <div className="flex items-end gap-2 px-3 py-3 bg-[#202c33]">
          <button onClick={() => addInputRef.current?.click()} title="Adicionar mídia"
            className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center transition">
            <Plus size={20} />
          </button>
          <textarea autoFocus value={caption} onChange={e => setCaption(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onConfirm(caption, items); } }}
            rows={1} placeholder={items.length > 1 ? `Legenda · ${items.length} itens…` : 'Adicionar uma legenda…'}
            className="flex-1 resize-none max-h-28 px-3.5 py-2.5 text-[13.5px] rounded-lg bg-white/10 text-white placeholder:text-white/40 border border-transparent focus:bg-white/15 outline-none" />
          <button onClick={() => onConfirm(caption, items)} title="Enviar"
            className="flex-shrink-0 w-11 h-11 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#017561] transition shadow-lg">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
