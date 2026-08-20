// Seletor de emojis — o mesmo painel serve a barra de mensagem e a reação.
//
// Ele NÃO se posiciona: desenha só o painel. Quem chama decide onde ele cai (a
// barra o pendura acima do compositor; a reação o abre em portal, na altura da
// bolha). Foi o que permitiu ter um componente só para os dois lugares — e é o
// que faz o widget flutuante herdar o recurso de graça (ver
// `widget-espelha-modulo-whatsapp`).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Clock } from 'lucide-react';
import { GRUPOS_DE_EMOJI, buscarEmojis, type EmojiItem } from './emojiData';

const CHAVE_RECENTES = 'wa_emojis_recentes';
const MAX_RECENTES = 24;

/** Os últimos emojis usados por esta pessoa, do mais recente para o mais antigo. */
export function lerEmojisRecentes(): string[] {
  try {
    const cru = JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]');
    return Array.isArray(cru) ? cru.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

/** Registra o uso: o emoji vai para a frente da fila, sem repetir. */
export function registrarEmojiUsado(emoji: string): void {
  try {
    const lista = [emoji, ...lerEmojisRecentes().filter(e => e !== emoji)].slice(0, MAX_RECENTES);
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista));
  } catch { /* localStorage indisponível não pode derrubar o envio */ }
}

export const EmojiPicker: React.FC<{
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Compacto: o painel da reação, que abre em cima de uma bolha. */
  compacto?: boolean;
  className?: string;
}> = ({ onPick, onClose, compacto, className }) => {
  const [busca, setBusca] = useState('');
  const [grupoAtivo, setGrupoAtivo] = useState<string>('recentes');
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // Lido uma vez ao abrir: se acompanhasse cada clique, a grade se
  // reorganizaria embaixo do dedo de quem está escolhendo o segundo emoji.
  const [recentes] = useState<string[]>(() => lerEmojisRecentes());

  useEffect(() => { if (!compacto) buscaRef.current?.focus(); }, [compacto]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const abas = useMemo(() => {
    const comRecentes = recentes.length > 0
      ? [{ id: 'recentes', nome: 'Usados recentemente', icone: '🕘', emojis: recentes.map(e => ({ e, k: '' })) }]
      : [];
    return [...comRecentes, ...GRUPOS_DE_EMOJI];
  }, [recentes]);

  // Sem recentes ainda, a primeira aba passa a ser a dos rostos.
  const ativo = abas.some(g => g.id === grupoAtivo) ? grupoAtivo : abas[0].id;
  const resultados: EmojiItem[] = busca.trim()
    ? buscarEmojis(busca)
    : abas.find(g => g.id === ativo)!.emojis;

  const escolher = (emoji: string) => {
    registrarEmojiUsado(emoji);
    onPick(emoji);
  };

  const trocarGrupo = (id: string) => {
    setBusca('');
    setGrupoAtivo(id);
    if (listaRef.current) listaRef.current.scrollTop = 0;
  };

  return (
    <div className={`rounded-2xl bg-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/5 overflow-hidden ${className || ''}`}>
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[#f1f0ec]">
        <Search size={15} className="text-slate-400 flex-shrink-0" />
        <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar emoji…" aria-label="Buscar emoji"
          className="flex-1 min-w-0 text-[13px] outline-none bg-transparent placeholder:text-slate-400" />
        <button onClick={onClose} title="Fechar" aria-label="Fechar seletor de emojis"
          className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      <div ref={listaRef} className={`overflow-y-auto p-2 ${compacto ? 'h-44' : 'h-56'}`}>
        {resultados.length === 0 ? (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <p className="text-[12.5px] text-slate-400">Nenhum emoji para “{busca.trim()}”.</p>
          </div>
        ) : (
          <>
            {!busca.trim() && (
              <p className="flex items-center gap-1.5 px-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {ativo === 'recentes' && <Clock size={10} />}
                {abas.find(g => g.id === ativo)!.nome}
              </p>
            )}
            <div className={`grid gap-0.5 ${compacto ? 'grid-cols-7' : 'grid-cols-8 sm:grid-cols-9'}`}>
              {resultados.map((item, i) => (
                <button key={`${item.e}-${i}`} type="button" onClick={() => escolher(item.e)}
                  title={item.k.split(' ')[0] || item.e} aria-label={`Emoji ${item.e}`}
                  className="aspect-square rounded-lg text-[20px] leading-none flex items-center justify-center hover:bg-[#f0f2f5] active:scale-90 transition">
                  {item.e}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Abas por grupo. Somem durante a busca: ali quem manda é o termo. */}
      {!busca.trim() && (
        <div className="flex items-center gap-0.5 px-1.5 py-1 border-t border-[#f1f0ec] overflow-x-auto">
          {abas.map(g => (
            <button key={g.id} type="button" onClick={() => trocarGrupo(g.id)} title={g.nome}
              aria-label={g.nome} aria-pressed={g.id === ativo}
              className={`flex-shrink-0 w-8 h-8 rounded-lg text-[17px] leading-none flex items-center justify-center transition ${
                g.id === ativo ? 'bg-[#f0f2f5] ring-1 ring-[#00a884]/40' : 'hover:bg-[#f0f2f5]'}`}>
              {g.icone}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmojiPicker;
