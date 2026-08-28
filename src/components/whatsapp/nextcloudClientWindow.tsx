// A JANELA DE ARQUIVOS DO CLIENTE — o Nextcloud dentro do atendimento.
//
// A queixa que ela resolve é simples: para ver (ou mandar) um documento do
// cliente, o atendente tinha de sair da conversa, ir ao módulo Nextcloud,
// achar a pasta e voltar. No meio de um atendimento, isso é perder o fio.
//
// TRÊS DECISÕES, e as três têm motivo:
//
//  1. É JANELA, NÃO MODAL — como no computador. Sem scrim, sem foco preso: a
//     conversa continua lá atrás, legível e clicável. Ela arrasta pelo título,
//     encolhe para a barrinha, abre em tela cheia e guarda onde foi largada.
//     O irmão mais velho dela é o discador (`DialerWindow`), e o arrasto é
//     literalmente o mesmo (`useDraggablePosition`).
//
//  2. A RAIZ É O CLIENTE, não o servidor. O que abre é a lista de pastas
//     vinculadas àquele cadastro (`nextcloud_folder_links`) — nunca a árvore
//     inteira do escritório. Quem tem uma pasta só entra direto nela.
//
//  3. O ARQUIVO NÃO SAI DAQUI PARA O DISCO SÓ PARA VOLTAR. "Enviar na conversa"
//     baixa e entrega ao mesmo caminho do anexo comum (o preview com legenda);
//     arrastar da lista para a thread faz o mesmo, e por isso o arrasto leva o
//     CAMINHO e não bytes (ver `NEXTCLOUD_DRAG_MIME` em useThreadDragDrop).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Check, ChevronLeft, ChevronRight, Cloud, Download, ExternalLink, Folder, FolderOpen,
  GripHorizontal, Home, LayoutGrid, List, Loader2, Maximize2, Minimize2, Minus,
  Pencil, RefreshCw, Search, Send, Upload, X,
} from 'lucide-react';
import {
  nextcloudService, getNextcloudErrorMessage, type NextcloudEntry,
} from '../../services/nextcloud.service';
import {
  extIcon, fileIconColorClass, formatBytes, isDocx, isImage, isPdf, isTextFile,
  isVideo, isAudio,
} from '../../utils/nextcloudFile';
import { normalizeFolderPath, parentFolderPath } from '../../utils/nextcloudNavigation';
import { openEditorWindowWithPayload } from '../../utils/openEditorWindow';
import { useToastContext } from '../../contexts/ToastContext';
import { LAYER } from '../../styles/layers';
import { useModalLayer } from '../../styles/modalLayer';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
import { useDraggablePosition } from './callModals';
import { clampCallWidgetPosition, type CallWidgetBox, type CallWidgetPoint } from './callWidgetPlacement';
import { NEXTCLOUD_DRAG_MIME } from './hooks/useThreadDragDrop';
/**
 * Miniatura do bloco — CARREGADA SOB DEMANDA.
 *
 * `NcThumb` traz o pdf.js junto (renderiza a 1ª página do PDF), e o módulo do
 * WhatsApp tem a regra de nunca puxar o pdf.js no pacote principal (ver
 * `pdfPreview.tsx`). Importar direto aqui colocaria megabytes de leitor de PDF
 * na abertura da conversa por causa de uma janela que talvez nem abra.
 */
const NcThumb = React.lazy(() => import('../nextcloud/NcThumb').then(m => ({ default: m.NcThumb })));

/** Onde a janela guarda posição e medida — chave própria, como toda peça flutuante. */
const POSITION_KEY = 'wa-nextcloud-window-position';
const SIZE_KEY = 'wa-nextcloud-window-size';
/** Bloco ou lista: a escolha é da pessoa e sobrevive ao fechar a janela. */
const VIEW_KEY = 'wa-nextcloud-window-view';

type ModoDeVer = 'grade' | 'lista';

function modoGuardado(): ModoDeVer {
  try { return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'grade'; }
  catch { return 'grade'; }
}

/**
 * A medida de partida.
 *
 * A primeira versão nasceu estreita (460px) e a queixa foi imediata: uma janela
 * de arquivos apertada obriga a rolar para ler o nome do documento, que é
 * justamente o que se veio ler. Ela agora abre no tamanho de uma janela de
 * explorador de verdade — e continua encolhível pelo punho do canto.
 */
const DEFAULT_SIZE: CallWidgetBox = { width: 780, height: 620 };
const MIN_SIZE: CallWidgetBox = { width: 380, height: 340 };

/** Nunca maior que a janela do navegador — senão nasce com metade fora da tela. */
function caberNaTela(size: CallWidgetBox): CallWidgetBox {
  if (typeof window === 'undefined') return size;
  return {
    width: Math.max(MIN_SIZE.width, Math.min(size.width, window.innerWidth - 48)),
    height: Math.max(MIN_SIZE.height, Math.min(size.height, window.innerHeight - 48)),
  };
}

/** Canto inferior direito, com folga para o rodapé do compositor. */
function cantoPadrao(viewport: CallWidgetBox, size: CallWidgetBox): CallWidgetPoint {
  return clampCallWidgetPosition(
    { x: viewport.width - size.width - 24, y: viewport.height - size.height - 24 },
    viewport,
    size,
  );
}

/** A medida que a pessoa pediu da última vez — sem cortar pela tela ainda. */
function medidaGuardada(): CallWidgetBox {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return DEFAULT_SIZE;
    const parsed = JSON.parse(raw) as Partial<CallWidgetBox>;
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return DEFAULT_SIZE;
    return { width, height };
  } catch { return DEFAULT_SIZE; }
}

/** Pastas primeiro, depois nome — a ordem do explorador de arquivos. */
function ordenar(entries: NextcloudEntry[]): NextcloudEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  });
}

/** O que a prévia embutida consegue mostrar sem baixar nada para o disco. */
type PreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'none';

function previewKind(entry: NextcloudEntry): PreviewKind {
  if (isImage(entry)) return 'image';
  if (isPdf(entry)) return 'pdf';
  if (isVideo(entry)) return 'video';
  if (isAudio(entry)) return 'audio';
  if (isTextFile(entry)) return 'text';
  return 'none';
}

interface PreviewState {
  entry: NextcloudEntry;
  kind: PreviewKind;
  url: string | null;
  text: string | null;
  loading: boolean;
  error: string | null;
}

export interface NextcloudClientWindowProps {
  clientId: string;
  clientName?: string | null;
  /** Pasta em que a janela deve abrir (ex.: clique numa pasta da ficha 360). */
  initialPath?: string | null;
  onClose: () => void;
  /**
   * Enviar arquivos na conversa aberta. Ausente = a janela abriu de um lugar
   * sem conversa e a ação some (em vez de aparecer e não fazer nada).
   */
  onSendToConversation?: (files: File[]) => void;
}

export const NextcloudClientWindow: React.FC<NextcloudClientWindowProps> = ({
  clientId, clientName, initialPath, onClose, onSendToConversation,
}) => {
  const toast = useToastContext();
  const camada = useModalLayer(LAYER.MODAL_NESTED);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A medida PEDIDA (a guardada, ou a padrão) e a medida que cabe na tela agora.
  // Separar as duas é o que faz a janela voltar ao tamanho cheio quando o
  // navegador cresce: abrir com a janela estreita e depois alargá-la deixava a
  // janela presa no mínimo, porque a conta do "cabe?" só era feita uma vez.
  const medidaPedidaRef = useRef<CallWidgetBox>(medidaGuardada());
  const [size, setSize] = useState<CallWidgetBox>(() => caberNaTela(medidaPedidaRef.current));

  useEffect(() => {
    const ajustar = () => setSize(caberNaTela(medidaPedidaRef.current));
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, []);
  const [maximizada, setMaximizada] = useState(false);
  const [encolhida, setEncolhida] = useState(false);

  const { pos, dragging, handlers } = useDraggablePosition(cardRef, {
    storageKey: POSITION_KEY, fallbackSize: caberNaTela(DEFAULT_SIZE), place: cantoPadrao,
  });

  // ── Pastas do cliente (a "raiz" desta janela) ──
  const [raizes, setRaizes] = useState<string[] | null>(null);
  const [raizesErro, setRaizesErro] = useState<string | null>(null);

  // `null` = mostrando a lista de pastas do cliente; string = dentro de uma pasta.
  const [path, setPath] = useState<string | null>(() => (initialPath ? normalizeFolderPath(initialPath) : null));
  const [entries, setEntries] = useState<NextcloudEntry[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [buscaProfunda, setBuscaProfunda] = useState<NextcloudEntry[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const [modo, setModo] = useState<ModoDeVer>(() => modoGuardado());
  const trocarModo = useCallback((m: ModoDeVer) => {
    setModo(m);
    try { localStorage.setItem(VIEW_KEY, m); } catch { /* sem persistência */ }
  }, []);

  /**
   * Seleção múltipla — pastas ficam de fora (não há "enviar uma pasta").
   *
   * Existe porque mandar cinco documentos um a um, esperando o preview de cada
   * um, é a diferença entre resolver o pedido do cliente e fazer isso por cinco
   * minutos. Clique abre; clique na caixinha (ou Ctrl/⌘+clique) marca; Shift
   * marca o intervalo. Arrastar um item MARCADO arrasta a seleção inteira.
   */
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const ancoraRef = useRef<number | null>(null);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [enviandoLote, setEnviandoLote] = useState(false);
  const [subindo, setSubindo] = useState<{ nome: string; pct: number } | null>(null);
  const [arrastandoDeFora, setArrastandoDeFora] = useState(false);
  const dragDepth = useRef(0);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    nextcloudService.getFolderLinks()
      .then(links => {
        if (!vivo) return;
        const doCliente = Object.entries(links)
          .filter(([, id]) => id === clientId)
          .map(([folderPath]) => normalizeFolderPath(folderPath))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        setRaizes(doCliente);
        // Uma pasta só: entrar nela é o que a pessoa faria no clique seguinte.
        if (!initialPath && doCliente.length === 1) setPath(doCliente[0]);
      })
      .catch(err => {
        if (!vivo) return;
        setRaizes([]);
        setRaizesErro(getNextcloudErrorMessage(err, 'listar as pastas do cliente'));
      });
    return () => { vivo = false; };
    // `initialPath` só importa na montagem: depois quem manda é a navegação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Listagem da pasta atual.
  useEffect(() => {
    if (path === null) { setEntries([]); setErro(null); return; }
    let vivo = true;
    setCarregando(true);
    setErro(null);
    nextcloudService.list(path)
      .then(list => { if (vivo) setEntries(ordenar(list)); })
      .catch(err => {
        if (!vivo) return;
        setEntries([]);
        setErro(getNextcloudErrorMessage(err, 'abrir a pasta'));
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [path, versao]);

  // Trocar de pasta zera a busca — o filtro da pasta anterior não vale aqui.
  useEffect(() => { setBusca(''); setBuscaProfunda(null); setSelecionados(new Set()); ancoraRef.current = null; }, [path]);

  // A prévia segura um object URL; largar sem revogar vaza memória a cada arquivo.
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  /** A pasta vinculada que contém o caminho atual — o teto desta janela. */
  const raizAtual = useMemo(() => {
    if (path === null || !raizes) return null;
    return raizes.find(r => path === r || path.startsWith(`${r}/`)) ?? null;
  }, [path, raizes]);

  const podeSubir = path !== null;

  const subir = () => {
    if (path === null) return;
    if (raizAtual && path === raizAtual) { setPath(null); return; }
    const pai = parentFolderPath(path);
    if (pai === null || (raizAtual && !(pai === raizAtual || pai.startsWith(`${raizAtual}/`)))) {
      setPath(raizAtual ?? null);
      return;
    }
    setPath(pai);
  };

  const visiveisRef = useRef<NextcloudEntry[]>([]);
  const visiveis = useMemo(() => {
    if (buscaProfunda) return ordenar(buscaProfunda);
    const termo = busca.trim().toLowerCase();
    if (!termo) return entries;
    return entries.filter(e => e.name.toLowerCase().includes(termo));
  }, [entries, busca, buscaProfunda]);
  visiveisRef.current = visiveis;

  const buscarEmSubpastas = async () => {
    const termo = busca.trim();
    if (!termo || path === null) return;
    setBuscando(true);
    try {
      setBuscaProfunda(await nextcloudService.search(termo, path));
    } catch (err) {
      toast.error('Busca no Nextcloud', getNextcloudErrorMessage(err, 'pesquisar arquivos'));
    } finally { setBuscando(false); }
  };

  // ── Abrir ──────────────────────────────────────────────────────────────────
  const abrir = async (entry: NextcloudEntry) => {
    if (entry.isDir) { setPath(normalizeFolderPath(entry.path)); return; }
    if (isDocx(entry)) { abrirNoEditor(entry); return; }
    const kind = previewKind(entry);
    if (kind === 'none') { void baixar(entry); return; }
    setPreview({ entry, kind, url: null, text: null, loading: true, error: null });
    try {
      const blob = await nextcloudService.readFile(entry.path);
      if (kind === 'text') {
        const texto = await blob.text();
        setPreview(p => (p && p.entry.path === entry.path ? { ...p, text: texto, loading: false } : p));
      } else {
        const url = URL.createObjectURL(blob);
        setPreview(p => (p && p.entry.path === entry.path ? { ...p, url, loading: false } : p));
      }
    } catch (err) {
      const msg = getNextcloudErrorMessage(err, 'abrir o arquivo');
      setPreview(p => (p && p.entry.path === entry.path ? { ...p, loading: false, error: msg } : p));
    }
  };

  /** `.docx` vai para a casca do Editor, na janela dedicada — como no módulo. */
  const abrirNoEditor = (entry: NextcloudEntry) => {
    openEditorWindowWithPayload({
      clientId,
      mode: 'new',
      initialDocumentName: entry.name,
      initialNextcloudPath: entry.path,
      openRequestId: crypto.randomUUID(),
    });
  };

  const baixar = async (entry: NextcloudEntry) => {
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = entry.name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Download', getNextcloudErrorMessage(err, 'baixar o arquivo'));
    }
  };

  /** Baixa do Nextcloud e entrega ao MESMO fluxo de anexo do compositor. */
  const enviarNaConversa = async (entry: NextcloudEntry) => {
    if (!onSendToConversation) return;
    setEnviando(entry.path);
    try {
      const blob = await nextcloudService.readFile(entry.path);
      const file = new File([blob], entry.name, { type: blob.type || entry.mime || 'application/octet-stream' });
      onSendToConversation([file]);
    } catch (err) {
      toast.error('Enviar arquivo', getNextcloudErrorMessage(err, 'ler o arquivo para enviar'));
    } finally { setEnviando(null); }
  };

  // ── Seleção ────────────────────────────────────────────────────────────────
  /** Marca/desmarca UM item — o gesto da caixinha e do Ctrl/⌘+clique. */
  const alternarSelecao = useCallback((entry: NextcloudEntry, indice: number) => {
    setSelecionados(atual => {
      const proximo = new Set(atual);
      if (proximo.has(entry.path)) proximo.delete(entry.path);
      else proximo.add(entry.path);
      return proximo;
    });
    ancoraRef.current = indice;
  }, []);

  /** Marca do ponto de apoio até aqui — o Shift+clique do explorador. */
  const selecionarIntervalo = useCallback((indice: number) => {
    const ancora = ancoraRef.current ?? indice;
    const [de, ate] = [ancora, indice].sort((a, b) => a - b);
    const faixa = visiveisRef.current.slice(de, ate + 1).map(e => e.path);
    setSelecionados(new Set(faixa));
  }, []);

  /**
   * O clique simples no item.
   *
   * Aqui a janela virou explorador de arquivos de verdade: UM clique
   * seleciona, DOIS abrem. Antes um clique abria, e por isso não havia como
   * escolher três documentos para mandar de uma vez — todo clique já era um
   * arquivo abrindo na cara de quem só queria marcar.
   */
  const selecionarNoClique = useCallback((entry: NextcloudEntry, indice: number, evento: React.MouseEvent) => {
    if (evento.shiftKey) { selecionarIntervalo(indice); return; }
    if (evento.ctrlKey || evento.metaKey) { alternarSelecao(entry, indice); return; }
    setSelecionados(new Set([entry.path]));
    ancoraRef.current = indice;
  }, [alternarSelecao, selecionarIntervalo]);

  /** Só ARQUIVOS: as ações da barra não sabem o que fazer com uma pasta. */
  const selecaoComoEntradas = useCallback(
    () => visiveisRef.current.filter(e => !e.isDir && selecionados.has(e.path)),
    [selecionados],
  );
  const arquivosMarcados = useMemo(
    () => visiveis.filter(e => !e.isDir && selecionados.has(e.path)).length,
    [visiveis, selecionados],
  );

  const enviarSelecionados = async () => {
    if (!onSendToConversation) return;
    const alvos = selecaoComoEntradas();
    if (alvos.length === 0) return;
    setEnviandoLote(true);
    try {
      const arquivos = await Promise.all(alvos.map(async entry => {
        const blob = await nextcloudService.readFile(entry.path);
        return new File([blob], entry.name, { type: blob.type || entry.mime || 'application/octet-stream' });
      }));
      onSendToConversation(arquivos);
      setSelecionados(new Set());
    } catch (err) {
      toast.error('Enviar arquivos', getNextcloudErrorMessage(err, 'ler os arquivos para enviar'));
    } finally { setEnviandoLote(false); }
  };

  const baixarSelecionados = async () => {
    for (const entry of selecaoComoEntradas()) await baixar(entry);
  };

  // ── Laço de seleção (arrastar no vazio) ────────────────────────────────────
  //
  // O retângulo pontilhado do explorador. Vale a pena porque a pergunta comum
  // não é "quero este arquivo", é "quero estes quatro daqui" — e apontar um por
  // um com Ctrl é o caminho longo para a mesma coisa.
  //
  // Ele só nasce no VAZIO: pointerdown em cima de um item é arrasto do item
  // (que leva o arquivo para a conversa), não laço.
  const areaRef = useRef<HTMLDivElement>(null);
  const [laco, setLaco] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const iniciarLaco = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const area = areaRef.current;
    if (!area) return;
    const alvo = event.target as HTMLElement;
    if (alvo.closest('[data-nc-item]') || alvo.closest('button')) return;

    const caixa = area.getBoundingClientRect();
    const ponto = () => ({
      x: event.clientX - caixa.left + area.scrollLeft,
      y: event.clientY - caixa.top + area.scrollTop,
    });
    const inicio = ponto();
    // Sem Ctrl/⌘, o laço começa do zero — como em qualquer explorador.
    const base = (event.ctrlKey || event.metaKey) ? new Set(selecionados) : new Set<string>();
    if (!event.ctrlKey && !event.metaKey) setSelecionados(new Set());

    const mover = (ev: PointerEvent) => {
      const atual = {
        x: ev.clientX - caixa.left + area.scrollLeft,
        y: ev.clientY - caixa.top + area.scrollTop,
      };
      const ret = {
        x1: Math.min(inicio.x, atual.x), y1: Math.min(inicio.y, atual.y),
        x2: Math.max(inicio.x, atual.x), y2: Math.max(inicio.y, atual.y),
      };
      setLaco(ret);
      const dentro = new Set(base);
      area.querySelectorAll<HTMLElement>('[data-nc-item]').forEach(el => {
        const c = el.getBoundingClientRect();
        const ex1 = c.left - caixa.left + area.scrollLeft;
        const ey1 = c.top - caixa.top + area.scrollTop;
        const ex2 = ex1 + c.width;
        const ey2 = ey1 + c.height;
        const cruza = ex1 < ret.x2 && ex2 > ret.x1 && ey1 < ret.y2 && ey2 > ret.y1;
        if (cruza) dentro.add(el.dataset.ncItem!);
      });
      setSelecionados(dentro);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setLaco(null);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }, [selecionados]);

  // ── Subir arquivo do computador para a pasta aberta ────────────────────────
  const subirArquivos = async (files: File[]) => {
    if (path === null || files.length === 0) return;
    for (const file of files) {
      setSubindo({ nome: file.name, pct: 0 });
      try {
        await nextcloudService.writeFileWithProgress(`${path}/${file.name}`, file, {
          onProgress: (loaded, total) => {
            setSubindo({ nome: file.name, pct: total ? Math.round((loaded / total) * 100) : 0 });
          },
        });
      } catch (err) {
        toast.error('Envio para o Nextcloud', getNextcloudErrorMessage(err, `enviar ${file.name}`));
      }
    }
    setSubindo(null);
    setVersao(v => v + 1);
    toast.success(files.length === 1 ? 'Arquivo enviado para a pasta.' : `${files.length} arquivos enviados para a pasta.`);
  };

  // Arrastar de FORA (do computador) para dentro da janela = subir para a pasta.
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (path === null) return;
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault(); dragDepth.current += 1; setArrastandoDeFora(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!arrastandoDeFora) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!arrastandoDeFora) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setArrastandoDeFora(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (path === null) return;
      e.preventDefault(); dragDepth.current = 0; setArrastandoDeFora(false);
      void subirArquivos(Array.from(e.dataTransfer?.files || []));
    },
  };

  // ── Redimensionar pelo canto ───────────────────────────────────────────────
  const iniciarResize = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 || maximizada) return;
    event.preventDefault();
    event.stopPropagation();
    const inicio = { x: event.clientX, y: event.clientY };
    const base = { ...size };
    const onMove = (ev: PointerEvent) => {
      setSize({
        width: Math.max(MIN_SIZE.width, Math.min(base.width + (ev.clientX - inicio.x), window.innerWidth - 32)),
        height: Math.max(MIN_SIZE.height, Math.min(base.height + (ev.clientY - inicio.y), window.innerHeight - 32)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSize(atual => {
        medidaPedidaRef.current = atual;
        try { localStorage.setItem(SIZE_KEY, JSON.stringify(atual)); } catch { /* sem persistência */ }
        return atual;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [size, maximizada]);

  // Esc: uma camada por vez, na pilha do CRM inteiro. A prévia é a camada de
  // cima (ela se registra sozinha); aqui fica a janela.
  useEscapeLayer(!preview, onClose);

  /**
   * O teclado da janela, com a janela na frente:
   *
   *   Ctrl/⌘+A → marca TUDO o que está na pasta. Sem isto, o gesto caía no
   *              "selecionar tudo" do navegador e pintava a página inteira de
   *              azul — que é o oposto do que se quer numa lista de arquivos.
   *   Enter    → abre o que está marcado (o par do "um clique seleciona, dois
   *              abrem"): sem ele, quem escolheu pelo laço ou pelo teclado
   *              precisava voltar ao mouse para abrir.
   *   Ctrl/⌘+D → limpa a marcação, como no explorador.
   *
   * Tudo cala enquanto o foco está num campo de digitação (a busca) ou enquanto
   * a prévia está aberta — lá quem manda é a janela do arquivo.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview || path === null) return;
      const foco = document.activeElement as HTMLElement | null;
      if (foco && (foco.tagName === 'INPUT' || foco.tagName === 'TEXTAREA' || foco.isContentEditable)) return;
      const comando = e.ctrlKey || e.metaKey;

      if (comando && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        e.stopPropagation();
        setSelecionados(new Set(visiveisRef.current.map(x => x.path)));
        return;
      }
      if (comando && !e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        setSelecionados(new Set());
        return;
      }
      if (e.key === 'Enter' && !comando) {
        const marcados = visiveisRef.current.filter(x => selecionados.has(x.path));
        if (marcados.length !== 1) return;
        e.preventDefault();
        void abrir(marcados[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `abrir` é recriada a cada render; guardá-la aqui só recriaria o ouvinte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, path, selecionados]);

  if (typeof document === 'undefined') return null;

  const crumbs = path === null ? [] : (raizAtual
    ? [raizAtual, ...path.slice(raizAtual.length).split('/').filter(Boolean)
        .map((_, i, arr) => `${raizAtual}/${arr.slice(0, i + 1).join('/')}`)]
    : [path]);

  const geometria: React.CSSProperties = maximizada
    ? { left: 16, top: 16, width: 'calc(100vw - 32px)', height: 'calc(100dvh - 32px)' }
    : { left: pos.x, top: pos.y, width: size.width, height: encolhida ? undefined : size.height };

  const janela = createPortal(
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, scale: 0.97, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      role="dialog"
      aria-label={`Arquivos de ${clientName || 'cliente'} no Nextcloud`}
      className="fixed flex flex-col overflow-hidden rounded-2xl border border-[#e7e5df] bg-white shadow-[0_18px_50px_-12px_rgba(15,23,42,0.45)]"
      style={{ ...geometria, zIndex: camada }}
      {...dropProps}
    >
      {/* ── Barra de título: é por ela que a janela anda ── */}
      <div
        {...(maximizada ? {} : handlers)}
        onDoubleClick={() => setMaximizada(v => !v)}
        className={`flex shrink-0 items-center gap-2 border-b border-[#efece5] bg-[#faf9f7] px-2.5 py-2 ${
          maximizada ? '' : dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <GripHorizontal size={14} className="shrink-0 text-slate-300" />
        <Cloud size={15} className="shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1 select-none">
          <p className="truncate text-[12.5px] font-bold leading-tight text-slate-700">
            {clientName || 'Arquivos do cliente'}
          </p>
          <p className="truncate text-[10.5px] leading-tight text-slate-400">Nextcloud</p>
        </div>
        <button type="button" onClick={() => setEncolhida(v => !v)} title={encolhida ? 'Restaurar' : 'Encolher'}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f0eee9] hover:text-slate-700">
          <Minus size={14} />
        </button>
        <button type="button" onClick={() => setMaximizada(v => !v)} title={maximizada ? 'Restaurar' : 'Tela cheia'}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f0eee9] hover:text-slate-700">
          {maximizada ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button type="button" onClick={onClose} title="Fechar"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
          <X size={15} />
        </button>
      </div>

      {!encolhida && (
        <>
          {/* ── BARRA ÚNICA: onde estou, o que procuro, como vejo ──
              A primeira versão tinha duas setas iguais (voltar e subir) que
              faziam a mesma coisa, e a busca numa faixa própria embaixo. Duas
              linhas de moldura para uma janela que existe para mostrar arquivo.
              Agora é uma barra só, e a seta é uma. */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-[#f1f0ec] px-2 py-1.5">
            <button
              type="button" onClick={subir} disabled={!podeSubir}
              title={raizAtual && path === raizAtual ? 'Voltar às pastas do cliente' : 'Pasta acima'}
              className="shrink-0 rounded-lg border border-[#e7e5df] bg-white p-1.5 text-slate-500 transition hover:bg-[#f7f6f3] hover:text-slate-700 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-slate-300"
            >
              <ChevronLeft size={15} />
            </button>

            {/* Trilha: o último pedaço é o lugar; os anteriores são atalhos. */}
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[12px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button" onClick={() => setPath(null)} title="Pastas do cliente"
                className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 transition hover:bg-[#f3f2ef] ${
                  path === null ? 'font-semibold text-slate-700' : 'text-slate-500'
                }`}
              >
                <Home size={12} /> Pastas do cliente
              </button>
              {crumbs.map((crumb, i) => (
                <React.Fragment key={crumb}>
                  <ChevronRight size={12} className="shrink-0 text-slate-300" />
                  <button type="button" onClick={() => setPath(crumb)} title={crumb}
                    className={`max-w-[11rem] shrink-0 truncate rounded-md px-1.5 py-1 transition hover:bg-[#f3f2ef] ${
                      i === crumbs.length - 1 ? 'font-semibold text-slate-700' : 'text-slate-500'
                    }`}>
                    {crumb.split('/').filter(Boolean).pop() || 'Início'}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {path !== null && (
              <>
                <div className="relative w-40 shrink-0 lg:w-56">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input
                    value={busca}
                    onChange={e => { setBusca(e.target.value); setBuscaProfunda(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') void buscarEmSubpastas(); }}
                    placeholder="Filtrar nesta pasta"
                    title="Filtra esta pasta. Enter procura também nas subpastas."
                    className="w-full rounded-lg border border-[#e7e5df] bg-white py-1.5 pl-7 pr-6 text-[12px] text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                  />
                  {(buscando || buscaProfunda) && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2">
                      {buscando
                        ? <Loader2 size={13} className="animate-spin text-amber-500" />
                        : <button type="button" onClick={() => setBuscaProfunda(null)} title="Voltar à pasta"
                            className="text-slate-300 hover:text-slate-600"><X size={13} /></button>}
                    </span>
                  )}
                </div>

                {/* Bloco ou lista — a escolha fica guardada para a próxima vez. */}
                <div className="flex shrink-0 items-center rounded-lg border border-[#e7e5df] bg-white p-0.5">
                  <button type="button" onClick={() => trocarModo('grade')} title="Modo bloco"
                    className={`rounded-md p-1 transition ${modo === 'grade' ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}>
                    <LayoutGrid size={14} />
                  </button>
                  <button type="button" onClick={() => trocarModo('lista')} title="Modo lista"
                    className={`rounded-md p-1 transition ${modo === 'lista' ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:text-slate-600'}`}>
                    <List size={14} />
                  </button>
                </div>

                <button type="button" onClick={() => fileInputRef.current?.click()} title="Enviar arquivo para esta pasta"
                  className="shrink-0 rounded-lg border border-[#e7e5df] bg-white p-1.5 text-slate-500 transition hover:bg-[#f7f6f3] hover:text-slate-700">
                  <Upload size={14} />
                </button>
                <button type="button" onClick={() => setVersao(v => v + 1)} title="Atualizar"
                  className="shrink-0 rounded-lg border border-[#e7e5df] bg-white p-1.5 text-slate-500 transition hover:bg-[#f7f6f3] hover:text-slate-700">
                  <RefreshCw size={14} className={carregando ? 'animate-spin' : undefined} />
                </button>
              </>
            )}
            <input
              ref={fileInputRef} type="file" multiple className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                void subirArquivos(files);
              }}
            />
          </div>

          {subindo && (
            <div className="shrink-0 border-b border-amber-100 bg-amber-50/70 px-3 py-1.5">
              <p className="truncate text-[11px] font-semibold text-amber-800">Enviando {subindo.nome} · {subindo.pct}%</p>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-amber-100">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${subindo.pct}%` }} />
              </div>
            </div>
          )}

          {/* ── Conteúdo ── */}
          <div
            ref={areaRef}
            onPointerDown={iniciarLaco}
            className={`relative min-h-0 flex-1 overflow-y-auto ${laco ? 'select-none' : ''}`}
          >
            {laco && (
              <div
                className="pointer-events-none absolute z-10 rounded-sm border border-dashed border-amber-500 bg-amber-400/15"
                style={{ left: laco.x1, top: laco.y1, width: laco.x2 - laco.x1, height: laco.y2 - laco.y1 }}
              />
            )}
            {arrastandoDeFora && (
              <div className="pointer-events-none absolute inset-0 z-10 m-2 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/85">
                <Upload size={26} className="text-blue-500" />
                <p className="text-[13px] font-bold text-blue-800">Solte para guardar nesta pasta</p>
              </div>
            )}

            {path === null ? (
              <ListaDeRaizes raizes={raizes} erro={raizesErro} modo={modo} onAbrir={p => setPath(p)} />
            ) : carregando ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-slate-400">
                <Loader2 size={16} className="animate-spin" /> Carregando…
              </div>
            ) : erro ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-red-600">{erro}</p>
            ) : visiveis.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-slate-400">
                {busca.trim() ? 'Nada com esse nome aqui.' : 'Pasta vazia. Arraste um arquivo para guardar.'}
              </p>
            ) : (
              <div className={modo === 'grade'
                ? 'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 p-2.5'
                : 'p-1.5'}>
                {visiveis.map((entry, indice) => {
                  const marcado = selecionados.has(entry.path);
                  const comum = {
                    entry,
                    marcado,
                    mostrandoCaminho: !!buscaProfunda,
                    enviando: enviando === entry.path,
                    podeEnviar: !!onSendToConversation,
                    onAbrir: () => void abrir(entry),
                    onSelecionar: (ev: React.MouseEvent) => selecionarNoClique(entry, indice, ev),
                    onMarcar: () => alternarSelecao(entry, indice),
                    onEnviar: () => void enviarNaConversa(entry),
                    onEditar: () => abrirNoEditor(entry),
                    onBaixar: () => void baixar(entry),
                    onDragStart: (e: React.DragEvent) => {
                      if (entry.isDir) return;
                      // Arrastar um item MARCADO leva a seleção inteira; um item
                      // solto leva só ele (e não desmarca o que já estava).
                      const lote = marcado ? visiveisRef.current.filter(x => !x.isDir && selecionados.has(x.path)) : [entry];
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData(NEXTCLOUD_DRAG_MIME, JSON.stringify({
                        files: lote.map(x => ({ path: x.path, name: x.name, mime: x.mime })),
                      }));
                    },
                  };
                  return modo === 'grade'
                    ? <BlocoDeArquivo key={entry.path} {...comum} />
                    : <LinhaDeArquivo key={entry.path} {...comum} />;
                })}
              </div>
            )}
          </div>

          {/* ── Barra da seleção: só existe quando há algo marcado ── */}
          {selecionados.size > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-t border-[#efece5] bg-[#faf9f7] px-3 py-2">
              <span className="text-[12px] font-semibold text-slate-600">
                {selecionados.size} {selecionados.size === 1 ? 'selecionado' : 'selecionados'}
                {arquivosMarcados !== selecionados.size && (
                  <span className="ml-1 font-normal text-slate-400">
                    · {arquivosMarcados} {arquivosMarcados === 1 ? 'arquivo' : 'arquivos'}
                  </span>
                )}
              </span>
              <span className="flex-1" />
              <button type="button" onClick={() => setSelecionados(new Set())}
                className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-slate-500 transition hover:bg-[#f0eee9]">
                Limpar
              </button>
              {arquivosMarcados > 0 && (
                <button type="button" onClick={() => void baixarSelecionados()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e0d9] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-[#f7f6f3]">
                  <Download size={13} /> Baixar
                </button>
              )}
              {onSendToConversation && arquivosMarcados > 0 && (
                <button type="button" onClick={() => void enviarSelecionados()} disabled={enviandoLote}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
                  {enviandoLote ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Enviar {arquivosMarcados > 1 ? `${arquivosMarcados} ` : ''}na conversa
                </button>
              )}
            </div>
          )}

          {/* Punho de redimensionar — o canto de sempre. */}
          {!maximizada && (
            <div
              onPointerDown={iniciarResize}
              title="Arraste para redimensionar"
              className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
            >
              <span className="absolute bottom-1 right-1 h-2 w-2 rounded-sm border-b-2 border-r-2 border-slate-300" />
            </div>
          )}
        </>
      )}
    </motion.div>,
    document.body,
  );

  return (
    <>
      {janela}
      {/* O arquivo NÃO abre dentro da janela de arquivos: ele ganha a própria
          janela, por cima, do tamanho de quem foi feito para ser lido. Abrir a
          prévia no miolo de uma janela de 780px era ler um PDF por um postigo. */}
      {preview && (
        <NextcloudFileViewer
          state={preview}
          onClose={() => setPreview(null)}
          onDownload={() => void baixar(preview.entry)}
          onSend={onSendToConversation ? () => void enviarNaConversa(preview.entry) : undefined}
        />
      )}
    </>
  );
};

// ── Um item, nas duas roupas ────────────────────────────────────────────────

interface ItemProps {
  entry: NextcloudEntry;
  marcado: boolean;
  /** Busca em subpastas: aí o caminho importa tanto quanto o nome. */
  mostrandoCaminho: boolean;
  enviando: boolean;
  podeEnviar: boolean;
  /** Duplo clique (ou Enter na caixinha): entra na pasta / abre o arquivo. */
  onAbrir: () => void;
  /** Clique simples: seleciona (Ctrl/⌘ alterna, Shift marca o intervalo). */
  onSelecionar: (ev: React.MouseEvent) => void;
  /** Clique na caixinha de marcar. */
  onMarcar: () => void;
  onEnviar: () => void;
  onEditar: () => void;
  onBaixar: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

/** A caixinha de marcar — o que faltava para mandar mais de um de uma vez. */
const CaixaDeMarcar: React.FC<{ marcado: boolean; onClick: () => void; className?: string }> = ({ marcado, onClick, className = '' }) => (
  <button
    type="button"
    aria-pressed={marcado}
    title={marcado ? 'Desmarcar' : 'Marcar'}
    onClick={ev => { ev.stopPropagation(); onClick(); }}
    onDoubleClick={ev => ev.stopPropagation()}
    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
      marcado
        ? 'border-emerald-600 bg-emerald-600 text-white'
        : 'border-slate-300 bg-white/90 text-transparent hover:border-emerald-400'
    } ${className}`}
  >
    <Check size={11} strokeWidth={3} />
  </button>
);

/** O ícone do tipo, no tamanho do bloco — e o que a miniatura mostra enquanto carrega. */
const IconeDoTipo: React.FC<{ entry: NextcloudEntry }> = ({ entry }) => {
  const Icon = extIcon(entry);
  return <Icon className={`h-12 w-12 ${fileIconColorClass(entry)}`} />;
};

const BlocoDeArquivo: React.FC<ItemProps> = ({
  entry, marcado, mostrandoCaminho, enviando, podeEnviar,
  onAbrir, onSelecionar, onMarcar, onEnviar, onEditar, onBaixar, onDragStart,
}) => (
  <div
      data-nc-item={entry.path}
      draggable={!entry.isDir}
      onDragStart={onDragStart}
      onClick={onSelecionar}
      onDoubleClick={onAbrir}
      title={`${entry.name}\nDois cliques para abrir`}
      className={`group relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-2 transition ${
        marcado
          ? 'border-emerald-300 bg-emerald-50/70'
          : 'border-[#eeece6] bg-white hover:border-amber-200 hover:bg-[#fdfbf7]'
      }`}
    >
      <span className={`absolute left-2 top-2 z-10 transition ${marcado ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <CaixaDeMarcar marcado={marcado} onClick={onMarcar} />
      </span>

      <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-[#faf9f7]">
        {entry.isDir
          ? <Folder className="h-12 w-12 text-blue-400" />
          : (
            <React.Suspense fallback={<IconeDoTipo entry={entry} />}>
              <NcThumb entry={entry} />
            </React.Suspense>
          )}
      </div>

      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-[11.5px] font-semibold leading-tight text-slate-700">{entry.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-slate-400">
          {entry.isDir ? 'Pasta' : formatBytes(entry.size)}
          {mostrandoCaminho && <span className="ml-1 text-slate-300">· {entry.path}</span>}
        </p>
      </div>

      {!entry.isDir && (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-white/95 p-0.5 opacity-0 shadow-sm ring-1 ring-black/5 transition group-hover:opacity-100 focus-within:opacity-100">
          {podeEnviar && (
            <button type="button" title="Enviar na conversa"
              onClick={e => { e.stopPropagation(); onEnviar(); }}
              className="rounded-md p-1 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600">
              {enviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          )}
          {isDocx(entry) && (
            <button type="button" title="Abrir no editor"
              onClick={e => { e.stopPropagation(); onEditar(); }}
              className="rounded-md p-1 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600">
              <Pencil size={13} />
            </button>
          )}
          <button type="button" title="Baixar"
            onClick={e => { e.stopPropagation(); onBaixar(); }}
            className="rounded-md p-1 text-slate-400 transition hover:bg-[#f0eee9] hover:text-slate-700">
            <Download size={13} />
          </button>
        </div>
      )}
  </div>
);

const LinhaDeArquivo: React.FC<ItemProps> = ({
  entry, marcado, mostrandoCaminho, enviando, podeEnviar,
  onAbrir, onSelecionar, onMarcar, onEnviar, onEditar, onBaixar, onDragStart,
}) => {
  const Icon = extIcon(entry);
  return (
    <div
      data-nc-item={entry.path}
      draggable={!entry.isDir}
      onDragStart={onDragStart}
      onClick={onSelecionar}
      onDoubleClick={onAbrir}
      title={`${entry.name}\nDois cliques para abrir`}
      className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition ${
        marcado ? 'bg-emerald-50' : 'hover:bg-[#f7f6f3]'
      }`}
    >
      <CaixaDeMarcar
        marcado={marcado}
        onClick={onMarcar}
        className={marcado ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}
      />
      <Icon className={`h-4 w-4 shrink-0 ${fileIconColorClass(entry)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-slate-700">{entry.name}</span>
        <span className="block truncate text-[10.5px] text-slate-400">
          {entry.isDir ? 'Pasta' : formatBytes(entry.size)}
          {mostrandoCaminho && <span className="ml-1 text-slate-300">· {entry.path}</span>}
        </span>
      </span>
      {!entry.isDir && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          {podeEnviar && (
            <button type="button" title="Enviar na conversa"
              onClick={e => { e.stopPropagation(); onEnviar(); }}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600">
              {enviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          )}
          {isDocx(entry) && (
            <button type="button" title="Abrir no editor"
              onClick={e => { e.stopPropagation(); onEditar(); }}
              className="rounded-md p-1.5 text-slate-400 transition hover:bg-blue-50 hover:text-blue-600">
              <Pencil size={13} />
            </button>
          )}
          <button type="button" title="Baixar"
            onClick={e => { e.stopPropagation(); onBaixar(); }}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-[#f0eee9] hover:text-slate-700">
            <Download size={13} />
          </button>
        </span>
      )}
    </div>
  );
};

// ── A raiz: as pastas que o cliente tem no Nextcloud ─────────────────────────

const ListaDeRaizes: React.FC<{
  raizes: string[] | null;
  erro: string | null;
  modo: ModoDeVer;
  onAbrir: (path: string) => void;
}> = ({ raizes, erro, modo, onAbrir }) => {
  if (raizes === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Procurando as pastas do cliente…
      </div>
    );
  }
  if (erro) return <p className="px-4 py-8 text-center text-[12.5px] text-red-600">{erro}</p>;
  if (raizes.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <FolderOpen size={26} className="mx-auto mb-2 text-slate-200" />
        <p className="text-[12.5px] font-semibold text-slate-500">Nenhuma pasta vinculada</p>
        <p className="mt-1 text-[11.5px] leading-snug text-slate-400">
          Vincule a pasta deste cliente pelo módulo Nextcloud — um cliente pode ter quantas precisar.
        </p>
      </div>
    );
  }
  const nome = (folderPath: string) => folderPath.split('/').filter(Boolean).pop() || 'Início';

  if (modo === 'grade') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2 p-2.5">
        {raizes.map(folderPath => (
          <button
            key={folderPath} type="button" onClick={() => onAbrir(folderPath)} title={folderPath}
            className="flex flex-col gap-1.5 rounded-xl border border-[#eeece6] bg-white p-2 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
          >
            <span className="flex h-24 items-center justify-center rounded-lg bg-[#faf9f7]">
              <Folder className="h-12 w-12 text-blue-400" />
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 break-words text-[11.5px] font-semibold leading-tight text-slate-700">{nome(folderPath)}</span>
              <span className="mt-0.5 block truncate text-[10px] text-slate-400">{folderPath}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <ul className="p-1.5">
      {raizes.map(folderPath => (
        <li key={folderPath}>
          <button
            type="button" onClick={() => onAbrir(folderPath)} title={folderPath}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-blue-50/70"
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-slate-700">{nome(folderPath)}</span>
              <span className="block truncate text-[10.5px] text-slate-400">{folderPath}</span>
            </span>
            <ChevronRight size={13} className="shrink-0 text-slate-300" />
          </button>
        </li>
      ))}
    </ul>
  );
};

// ── O visualizador: janela PRÓPRIA do arquivo ────────────────────────────────

/**
 * O arquivo aberto tem janela própria, por cima de tudo — e não um pedaço da
 * janela de arquivos. É a diferença entre olhar um documento e espiá-lo.
 *
 * Ela é grande de propósito (até 1100×860, respeitando a tela), fecha no Esc, no
 * X e no clique fora, e carrega as duas ações que fazem sentido com um arquivo
 * do cliente na mão: mandar na conversa e baixar.
 */
const NextcloudFileViewer: React.FC<{
  state: PreviewState;
  onClose: () => void;
  onDownload: () => void;
  onSend?: () => void;
}> = ({ state, onClose, onDownload, onSend }) => {
  // Acima da janela de arquivos que a abriu (e traduzido para a faixa do widget
  // quando o módulo está embutido nele). Ver `styles/modalLayer`.
  const camada = useModalLayer(LAYER.POPOVER);
  useEscapeLayer(true, onClose);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-[2px] sm:p-6"
      style={{ zIndex: camada }}
      onClick={onClose}
    >
      <motion.div
        role="dialog" aria-label={state.entry.name}
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="flex h-[min(860px,92dvh)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[#efece5] bg-[#faf9f7] px-3 py-2">
          <Cloud size={15} className="shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight text-slate-800">{state.entry.name}</p>
            <p className="truncate text-[10.5px] leading-tight text-slate-400">{state.entry.path}</p>
          </div>
          {onSend && (
            <button type="button" onClick={onSend} title="Enviar na conversa"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e0d9] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
              <Send size={13} /> Enviar
            </button>
          )}
          <button type="button" onClick={onDownload} title="Baixar"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e0d9] bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-[#f7f6f3]">
            <Download size={13} /> Baixar
          </button>
          <button type="button" onClick={onClose} title="Fechar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f4f3f0]">
          {state.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[13px] text-slate-400">
              <Loader2 size={18} className="animate-spin" /> Abrindo…
            </div>
          ) : state.error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-[13px] text-red-600">{state.error}</p>
              <button type="button" onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e0d9] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-[#f7f6f3]">
                <Download size={13} /> Baixar mesmo assim
              </button>
            </div>
          ) : state.kind === 'image' && state.url ? (
            <div className="flex h-full items-center justify-center p-3">
              <img src={state.url} alt={state.entry.name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : state.kind === 'pdf' && state.url ? (
            <iframe title={state.entry.name} src={state.url} className="h-full w-full border-0 bg-white" />
          ) : state.kind === 'video' && state.url ? (
            <video src={state.url} controls autoPlay className="h-full w-full bg-black" />
          ) : state.kind === 'audio' && state.url ? (
            <div className="flex h-full items-center justify-center p-8">
              <audio src={state.url} controls className="w-full max-w-xl" />
            </div>
          ) : state.kind === 'text' && state.text !== null ? (
            <pre className="whitespace-pre-wrap break-words bg-white p-4 text-[12.5px] leading-relaxed text-slate-700">{state.text}</pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <ExternalLink size={24} className="text-slate-300" />
              <p className="text-[13px] text-slate-500">Este tipo de arquivo abre fora do navegador.</p>
              <button type="button" onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e0d9] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-[#f7f6f3]">
                <Download size={13} /> Baixar
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
};

// ── O botão do painel de detalhes ────────────────────────────────────────────

/**
 * "Arquivos no Nextcloud" na coluna da direita, ao lado de "Documentos no
 * Cloud" (que continua onde estava, até nova decisão sobre o Cloud interno).
 *
 * Ele conta as pastas antes de aparecer: um botão que abre uma janela vazia
 * ensina o atendente a não clicar nele. Sem pasta vinculada, some.
 */
export const ClientNextcloudDocsLink: React.FC<{
  clientId: string;
  onOpen: () => void;
}> = ({ clientId, onOpen }) => {
  const [pastas, setPastas] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    setPastas(null);
    nextcloudService.getFolderLinks()
      .then(links => {
        if (!vivo) return;
        setPastas(Object.values(links).filter(id => id === clientId).length);
      })
      .catch(() => { if (vivo) setPastas(0); });
    return () => { vivo = false; };
  }, [clientId]);

  if (!pastas) return null;
  return (
    <button
      type="button" onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg border border-[#e7e5df] px-2.5 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50/50"
    >
      <Cloud size={15} className="shrink-0 text-blue-500" />
      <span className="flex-1 text-[12.5px] font-semibold text-slate-700">Arquivos no Nextcloud</span>
      <span className="text-[10.5px] font-semibold text-slate-400">
        {pastas} {pastas === 1 ? 'pasta' : 'pastas'}
      </span>
      <ChevronRight size={14} className="shrink-0 text-slate-300" />
    </button>
  );
};

export default NextcloudClientWindow;
