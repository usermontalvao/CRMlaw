// Seletor de GIF do compositor (Giphy). Abre acima da barra de envio, no mesmo
// lugar do menu de anexos e do menu de modelos.
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { giphyService, type GiphyItem } from '../../services/giphy.service';

export const GifPicker: React.FC<{
  onPick: (item: GiphyItem) => void;
  onClose: () => void;
}> = ({ onPick, onClose }) => {
  const [q, setQ] = useState('');
  const [itens, setItens] = useState<GiphyItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Busca com atraso: a grade recarrega enquanto se digita, e disparar a cada
  // tecla queimaria a cota do Giphy sem melhorar nada — em 300ms a pessoa já
  // terminou a palavra.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    const t = window.setTimeout(() => {
      giphyService.list({ q, limit: 24 })
        .then(r => { if (vivo) setItens(r); })
        .catch(e => { if (vivo) setErro(e?.message || 'Não foi possível carregar os GIFs.'); })
        .finally(() => { if (vivo) setCarregando(false); });
    }, q ? 300 : 0);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute left-2.5 sm:left-3 right-2.5 sm:right-3 bottom-full mb-2 z-30 rounded-2xl bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/5 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[#f1f0ec]">
        <Search size={15} className="text-slate-400 flex-shrink-0" />
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar GIF…"
          className="flex-1 min-w-0 text-[13px] outline-none bg-transparent placeholder:text-slate-400" />
        <button onClick={onClose} title="Fechar" className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      <div className="h-64 overflow-y-auto p-2">
        {carregando ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-[12.5px] gap-2">
            <Loader2 size={15} className="animate-spin" /> Carregando…
          </div>
        ) : erro ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <p className="text-[12.5px] text-slate-500">{erro}</p>
          </div>
        ) : itens.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <p className="text-[12.5px] text-slate-400">Nenhum GIF para “{q}”.</p>
          </div>
        ) : (
          // Colunas de altura livre (masonry simples): GIF tem proporção muito
          // variada, e forçar quadrado cortaria a piada de metade deles.
          <div className="columns-3 gap-2 [column-fill:_balance]">
            {itens.map(g => (
              <button key={g.id} onClick={() => onPick(g)} title={g.titulo || 'Enviar GIF'}
                className="mb-2 w-full block rounded-lg overflow-hidden bg-slate-100 hover:ring-2 hover:ring-[#00a884] transition">
                <img src={g.previewUrl} alt={g.titulo} loading="lazy"
                  className="w-full block" style={{ aspectRatio: g.largura && g.altura ? `${g.largura}/${g.altura}` : undefined }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-[#f1f0ec]">GIFs por GIPHY</p>
    </div>
  );
};

export default GifPicker;
