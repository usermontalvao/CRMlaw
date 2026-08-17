// Preview de anexos (estilo WhatsApp Web) com legenda, tira de miniaturas e
// anotação sobre as imagens: lápis, marca-texto, seta, retângulo, tarja de
// censura e texto.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, FileText, Plus, Send, Pencil, Highlighter, ArrowUpRight, Square,
  Type, EyeOff, Undo2, Trash2, Loader2,
} from 'lucide-react';
import { formatBytes } from './format';
import {
  ANNOTATION_COLORS, ANNOTATION_SIZES, clamp01, drawAnnotations, flattenAnnotations,
  fontSizePx, hasInk, hitTestText, isFreehand, isShape, isText, pointFromPointer, undoLast,
  type AnnotationItem, type AnnotationKind,
} from '../../utils/imageAnnotation';

/** Ferramentas na ordem em que aparecem na barra. */
const FERRAMENTAS: Array<{ kind: AnnotationKind; Icone: typeof Pencil; titulo: string }> = [
  { kind: 'pen', Icone: Pencil, titulo: 'Lápis' },
  { kind: 'marker', Icone: Highlighter, titulo: 'Marca-texto' },
  { kind: 'arrow', Icone: ArrowUpRight, titulo: 'Seta' },
  { kind: 'rect', Icone: Square, titulo: 'Retângulo' },
  { kind: 'text', Icone: Type, titulo: 'Texto' },
  { kind: 'redact', Icone: EyeOff, titulo: 'Tarja — cobrir dado sensível' },
];

export const AttachmentPreviewModal: React.FC<{
  files: File[];
  /** Texto que já estava no compositor quando o anexo foi escolhido. */
  initialCaption?: string;
  /** Recebe a legenda escrita: quem desiste do anexo devolve o texto ao compositor. */
  onClose: (caption: string) => void;
  onConfirm: (caption: string, files: File[]) => void;
}> = ({ files, initialCaption = '', onClose, onConfirm }) => {
  const [items, setItems] = useState<File[]>(files);
  const [active, setActive] = useState(0);
  const [caption, setCaption] = useState(initialCaption);
  const [urls, setUrls] = useState<(string | null)[]>([]);
  const addInputRef = useRef<HTMLInputElement>(null);
  // A legenda atual em um ref: o `onClose` é chamado de lugares que não
  // re-assinam a cada tecla (atalho de teclado, clique no fundo), e é o texto
  // digitado AGORA que precisa voltar para o compositor.
  const captionRef = useRef(caption);
  captionRef.current = caption;
  /** Sai do preview devolvendo a legenda — ela vira o texto do compositor. */
  const fechar = useCallback(() => onClose(captionRef.current), [onClose]);

  // ── Anotação ──────────────────────────────────────────────────────────
  // Por índice de item: trocar de imagem na tira não pode perder o que já foi
  // anotado na anterior.
  const [annByItem, setAnnByItem] = useState<Record<number, AnnotationItem[]>>({});
  const [tool, setTool] = useState<AnnotationKind | null>(null);
  const [color, setColor] = useState(ANNOTATION_COLORS[0].valor);
  const [size, setSize] = useState(ANNOTATION_SIZES[1].valor);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flattening, setFlattening] = useState(false);
  // Texto sendo digitado: índice na lista + posição na tela para o campo.
  const [textEdit, setTextEdit] = useState<{ idx: number; left: number; top: number } | null>(null);
  const [sobreTexto, setSobreTexto] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  // Texto sendo arrastado: índice + distância entre o ponto pego e a âncora,
  // para o texto não "pular" para debaixo do cursor ao começar o arrasto.
  const dragTextRef = useRef<{ idx: number; dx: number; dy: number } | null>(null);

  /** Mede texto com a mesma fonte do desenho — usado no teste de acerto. */
  const medirTexto = useCallback((linha: string, fontPx: number) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return linha.length * fontPx * 0.5;
    ctx.save();
    ctx.font = `600 ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const w = ctx.measureText(linha).width;
    ctx.restore();
    return w;
  }, []);

  const ann = annByItem[active] ?? [];

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

  const cur = items[active];
  const curUrl = urls[active] ?? null;
  const isImg = cur?.type.startsWith('image/');
  const isVid = cur?.type.startsWith('video/');

  // Redesenha o overlay sempre que a anotação, a imagem ou a caixa mudam.
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!w || !h) return;
    // Densidade da tela: sem isto o traço sai serrilhado em monitor Retina.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    drawAnnotations(ctx, ann, w, h);
  }, [ann]);

  useEffect(() => { repaint(); }, [repaint, curUrl, active]);

  // A imagem é `object-contain`: a caixa desenhável muda com a janela.
  useEffect(() => {
    const onResize = () => repaint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [repaint]);

  const setAnn = (fn: (prev: AnnotationItem[]) => AnnotationItem[]) =>
    setAnnByItem(prev => ({ ...prev, [active]: fn(prev[active] ?? []) }));

  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tool || !imgRef.current || textEdit) return;
    const box = imgRef.current.getBoundingClientRect();
    const p = pointFromPointer(e.clientX, e.clientY, box);

    if (tool === 'text') {
      // Clicar EM CIMA de um texto já posto arrasta em vez de criar outro —
      // sem isso, ajustar a posição exigiria desfazer e refazer.
      const alvo = hitTestText(ann, e.clientX - box.left, e.clientY - box.top, medirTexto, box.width, box.height);
      if (alvo !== null) {
        const item = ann[alvo] as Extract<AnnotationItem, { kind: 'text' }>;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragTextRef.current = { idx: alvo, dx: p.x - item.at.x, dy: p.y - item.at.y };
        return;
      }
      // Um clique em área livre fixa o ponto e abre o campo ali.
      // O índice sai da lista deste render (vamos acrescentar exatamente um), e
      // não de dentro do updater: em StrictMode o updater roda duas vezes e o
      // efeito colateral lá dentro dispararia duplicado.
      const idx = ann.length;
      setAnn(prev => [...prev, { kind: 'text', color, size, at: p, text: '' }]);
      setTextEdit({ idx, left: e.clientX - box.left, top: e.clientY - box.top });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId); // segue o ponteiro fora da caixa
    drawingRef.current = true;
    setAnn(prev => [...prev, isFreehandKind(tool)
      ? { kind: tool, color, size, points: [p] }
      : { kind: tool, color, size, from: p, to: p }]);
  };

  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imgRef.current) return;
    const arrasto = dragTextRef.current;
    if (arrasto) {
      const p = pointFromPointer(e.clientX, e.clientY, imgRef.current.getBoundingClientRect());
      setAnn(prev => {
        const next = [...prev];
        const alvo = next[arrasto.idx];
        if (!alvo || !isText(alvo)) return prev;
        next[arrasto.idx] = {
          ...alvo,
          at: { x: clamp01(p.x - arrasto.dx), y: clamp01(p.y - arrasto.dy) },
        };
        return next;
      });
      return;
    }
    if (!drawingRef.current) return;
    const p = pointFromPointer(e.clientX, e.clientY, imgRef.current.getBoundingClientRect());
    setAnn(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const ultimo = next[next.length - 1];
      if (isFreehand(ultimo)) next[next.length - 1] = { ...ultimo, points: [...ultimo.points, p] };
      else if (isShape(ultimo)) next[next.length - 1] = { ...ultimo, to: p };
      return next;
    });
  };

  const pointerUp = () => { drawingRef.current = false; dragTextRef.current = null; };

  const commitText = (valor: string) => {
    if (!textEdit) return;
    const idx = textEdit.idx;
    setTextEdit(null);
    setAnn(prev => {
      const next = [...prev];
      const alvo = next[idx];
      if (!alvo || !isText(alvo)) return prev;
      // Texto vazio não vira anotação — some junto com o campo.
      if (!valor.trim()) return next.filter((_, i) => i !== idx);
      next[idx] = { ...alvo, text: valor };
      return next;
    });
  };

  const anotou = ann.some(hasInk);

  // Achata a anotação na resolução original de cada imagem antes de enviar.
  const confirmar = async () => {
    if (flattening) return;
    const algo = Object.values(annByItem).some(a => a.some(hasInk));
    if (!algo) { onConfirm(caption, items); return; }
    setFlattening(true);
    try {
      const finais = await Promise.all(items.map((f, i) => {
        const a = annByItem[i];
        if (!a || !f.type.startsWith('image/')) return Promise.resolve(f);
        return flattenAnnotations(f, a);
      }));
      onConfirm(caption, finais);
    } catch {
      // Achatar é melhoria, não bloqueio: some a anotação, mas o anexo vai.
      onConfirm(caption, items);
    } finally { setFlattening(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textEdit) return; // digitando: as teclas pertencem ao campo
      if (e.key === 'Escape') { if (tool) { setTool(null); return; } fechar(); }
      if (e.key === 'ArrowRight') setActive(a => Math.min(a + 1, items.length - 1));
      if (e.key === 'ArrowLeft') setActive(a => Math.max(a - 1, 0));
      if (tool && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setAnn(undoLast);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechar, items.length, tool, active, textEdit]);

  const removeAt = (i: number) => {
    const next = items.filter((_, idx) => idx !== i);
    // Tirou o último anexo: o preview fecha e a legenda volta a ser texto.
    if (next.length === 0) { fechar(); return; }
    setActive(a => Math.min(a, next.length - 1));
    setItems(next);
    setAnnByItem({}); // os índices mudaram; manter anotações casaria com a imagem errada
  };

  const btnBase = 'w-8 h-8 rounded-lg flex items-center justify-center transition flex-shrink-0';

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4" onClick={fechar}>
      {/* A moldura ABRAÇA a imagem: a largura do modal é a largura que a imagem
          assume depois de limitada por `max-h`/`max-w`, sem faixa escura em
          volta. O mínimo existe só para o cabeçalho não espremer as
          ferramentas quando a imagem é estreita. */}
      <div className="relative inline-flex flex-col rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-[#0b141a] max-w-[94vw] max-h-[94vh]"
        style={{ minWidth: 'min(440px, 94vw)' }} onClick={e => e.stopPropagation()}>

        {/* Cabeçalho: fechar · nome · ferramentas · contador.
            Sem cabeçalho: nome do arquivo e tamanho não dizem nada a quem está
            olhando o próprio print, e a faixa só roubava altura. Fechar e
            ferramentas flutuam sobre a imagem, no topo, longe do rodapé (que é
            onde o conteúdo do print costuma estar). */}
        {cur && (
          <button onClick={fechar} title="Fechar"
            className="absolute top-3 left-3 z-20 w-9 h-9 rounded-full bg-[#0b141a]/85 backdrop-blur ring-1 ring-white/25 text-white/90 hover:text-white hover:bg-[#0b141a] transition flex items-center justify-center shadow-lg">
            <X size={18} />
          </button>
        )}

        {/* Contraste alto de propósito: a barra fica sobre o print, que pode ser
            claro ou escuro. Fundo quase opaco + anel claro + sombra garantem que
            ela se leia em qualquer imagem por baixo. */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          {items.length > 1 && (
            <span className="px-2.5 h-10 rounded-full bg-[#0b141a]/85 backdrop-blur ring-1 ring-white/25 text-[12px] text-white/80 flex items-center shadow-lg">
              {active + 1}/{items.length}
            </span>
          )}
          {isImg && (
            <div className="flex items-center gap-0.5 px-1.5 py-1.5 rounded-full bg-[#0b141a]/85 backdrop-blur ring-1 ring-white/25 shadow-lg relative">
              {FERRAMENTAS.map(({ kind, Icone, titulo }) => (
                <button key={kind} title={titulo}
                  onClick={() => {
                    setTool(t => (t === kind ? null : kind));
                    setPaletteOpen(false);
                    // Tarja serve para esconder dado sensível: amarela não
                    // esconde nada aos olhos de quem lê. Entra preta por padrão,
                    // e o atendente troca a cor se quiser.
                    if (kind === 'redact') setColor('#1c1c1e');
                  }}
                  className={`${btnBase} ${tool === kind ? 'bg-[#00a884] text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}>
                  <Icone size={16} />
                </button>
              ))}

              {tool && (
                <>
                  <span className="w-px h-5 bg-white/10 mx-0.5" />
                  <button onClick={() => setPaletteOpen(o => !o)} title="Cor e espessura"
                    className={`${btnBase} ${paletteOpen ? 'bg-white/15' : 'hover:bg-white/10'}`}>
                    <span className="w-4.5 h-4.5 rounded-full ring-2 ring-white/70" style={{ background: color, width: 18, height: 18 }} />
                  </button>
                </>
              )}

              {anotou && (
                <>
                  <span className="w-px h-5 bg-white/10 mx-0.5" />
                  <button onClick={() => setAnn(undoLast)} title="Desfazer (Ctrl+Z)"
                    className={`${btnBase} text-white/60 hover:text-white hover:bg-white/10`}>
                    <Undo2 size={16} />
                  </button>
                  <button onClick={() => setAnn(() => [])} title="Apagar todas as anotações"
                    className={`${btnBase} text-white/60 hover:text-white hover:bg-red-500/70`}>
                    <Trash2 size={16} />
                  </button>
                </>
              )}

              {/* Paleta em popover: cor e espessura só ocupam espaço quando pedidas. */}
              {tool && paletteOpen && (
                <div className="absolute top-full right-0 mt-2 z-10 flex flex-col gap-2.5 px-3 py-2.5 rounded-2xl bg-[#111b21] ring-1 ring-white/10 shadow-2xl">
                  <div className="flex items-center gap-1.5">
                    {ANNOTATION_COLORS.map(c => (
                      <button key={c.valor} onClick={() => setColor(c.valor)} title={c.nome}
                        className={`w-6 h-6 rounded-full transition flex-shrink-0 ${
                          color === c.valor ? 'ring-2 ring-white scale-110' : 'ring-1 ring-white/25 hover:ring-white/60'}`}
                        style={{ background: c.valor }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {ANNOTATION_SIZES.map(s => (
                      <button key={s.valor} onClick={() => setSize(s.valor)} title={`${tool === 'text' ? 'Tamanho' : 'Espessura'}: ${s.nome}`}
                        className={`h-8 flex-1 rounded-lg flex items-center justify-center transition ${
                          size === s.valor ? 'bg-white/20' : 'hover:bg-white/10'}`}>
                        {tool === 'text' ? (
                          <span style={{ color, fontSize: `${9 + s.valor * 420}px`, fontWeight: 700 }}>A</span>
                        ) : (
                          // Escala exagerada de propósito: na proporção real as
                          // três bolinhas ficam quase idênticas neste tamanho.
                          <span className="rounded-full block" style={{
                            background: color, width: `${4 + s.valor * 620}px`, height: `${4 + s.valor * 620}px`,
                          }} />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preview: a caixa tem exatamente o tamanho da imagem já limitada */}
        <div className="flex items-center justify-center bg-[#0b141a] min-h-0 overflow-hidden">
          {curUrl && isImg ? (
            <div className="relative inline-flex">
              {/* Limite da imagem: nunca passa de 78% da altura nem de 90% da
                  largura da janela, para sobrar espaço ao cabeçalho, à legenda
                  e à respiração em volta do modal. */}
              <img ref={imgRef} src={curUrl} alt={cur?.name} onLoad={repaint}
                className="object-contain select-none block w-auto h-auto"
                style={{ maxHeight: '78vh', maxWidth: '90vw' }}
                draggable={false} />
              <canvas ref={canvasRef}
                onPointerDown={pointerDown} onPointerMove={pointerMove}
                onPointerUp={pointerUp} onPointerCancel={pointerUp}
                // O `mousedown` que vem logo depois do `pointerdown` tira o foco
                // de quem acabou de recebê-lo. Com a ferramenta de texto isso
                // matava o campo no mesmo clique que o criava: ele abria, perdia
                // o foco, disparava o onBlur vazio e sumia. Barrar o padrão do
                // mousedown mantém o cursor piscando no campo.
                onMouseDown={e => { if (tool === 'text') e.preventDefault(); }}
                // Cursor de mover sobre um texto já posto: é o que revela que
                // ele pode ser arrastado.
                onPointerMoveCapture={e => {
                  if (tool !== 'text' || dragTextRef.current || !imgRef.current) return;
                  const box = imgRef.current.getBoundingClientRect();
                  const sobre = hitTestText(ann, e.clientX - box.left, e.clientY - box.top, medirTexto, box.width, box.height);
                  setSobreTexto(sobre !== null);
                }}
                className="absolute inset-0"
                style={{
                  cursor: tool === 'text' ? (sobreTexto ? 'move' : 'text') : tool ? 'crosshair' : 'default',
                  touchAction: 'none',
                  pointerEvents: tool ? 'auto' : 'none',
                }} />

              {/* Campo de texto ancorado no ponto clicado, com a mesma
                  aparência do que será desenhado. */}
              {textEdit && (
                <input autoFocus
                  onBlur={e => commitText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitText(e.currentTarget.value); }
                    if (e.key === 'Escape') { e.preventDefault(); commitText(''); }
                  }}
                  className="absolute bg-black/40 outline-none rounded px-1 ring-1 ring-white/40"
                  style={{
                    left: textEdit.left, top: textEdit.top, color,
                    fontSize: `${fontSizePx(size, imgRef.current?.clientWidth || 800)}px`,
                    fontWeight: 600, minWidth: 40,
                  }}
                  placeholder="texto…" />
              )}
            </div>
          ) : curUrl && isVid ? (
            <video src={curUrl} controls className="block" style={{ maxHeight: '78vh', maxWidth: '90vw' }} />
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
          <div className="flex items-center gap-2 px-4 py-2.5 bg-[#111b21] overflow-x-auto flex-shrink-0">
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
                  {annByItem[i]?.some(hasInk) && (
                    <span className="absolute bottom-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-[#00a884] flex items-center justify-center">
                      <Pencil size={8} className="text-white" />
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
        <div className="flex items-end gap-2 px-3 py-3 bg-[#202c33] flex-shrink-0">
          <button onClick={() => addInputRef.current?.click()} title="Adicionar mídia"
            className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white flex items-center justify-center transition">
            <Plus size={20} />
          </button>
          <textarea value={caption} onChange={e => setCaption(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void confirmar(); } }}
            rows={1} placeholder={items.length > 1 ? `Legenda · ${items.length} itens…` : 'Adicionar uma legenda…'}
            className="flex-1 resize-none max-h-28 px-3.5 py-2.5 text-[13.5px] rounded-lg bg-white/10 text-white placeholder:text-white/40 border border-transparent focus:bg-white/15 outline-none" />
          <button onClick={() => void confirmar()} disabled={flattening} title="Enviar"
            className="flex-shrink-0 w-11 h-11 rounded-full bg-[#00a884] text-white flex items-center justify-center hover:bg-[#017561] transition shadow-lg disabled:opacity-60">
            {flattening ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

/** Lápis e marca-texto são os traçados livres; o resto é forma ou texto. */
function isFreehandKind(kind: AnnotationKind): kind is 'pen' | 'marker' {
  return kind === 'pen' || kind === 'marker';
}
