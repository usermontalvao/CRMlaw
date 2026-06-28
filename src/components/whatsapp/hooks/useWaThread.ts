// Camada visual da thread do WhatsApp: mescla mensagens reais + otimistas,
// agrupa imagens consecutivas em álbuns, mantém a galeria/lightbox e cuida de
// todo o auto-scroll (abrir/trocar conversa, mensagem nova e o crescimento tardio
// de mídia/cards) + da posição ao paginar. Extraído do WhatsAppModule para
// concentrar a lógica de rolagem/apresentação da thread fora do orquestrador.
// Vive DEPOIS de useWaComposer na ordem de hooks, pois consome `pending`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WhatsAppMessage } from '../../../types/whatsapp.types';

export type MessageUnit =
  | { kind: 'album'; items: WhatsAppMessage[] }
  | { kind: 'single'; m: WhatsAppMessage };

export interface WaThreadApi {
  /** Mensagens reais + otimistas mescladas e ordenadas (asc por timestamp). */
  allMessages: WhatsAppMessage[];
  msgById: Map<string, WhatsAppMessage>;
  /** Unidades de render: álbuns de imagens consecutivas ou bolha única. */
  messageUnits: MessageUnit[];
  lightbox: string | null;
  setLightbox: React.Dispatch<React.SetStateAction<string | null>>;
  lightboxImages: string[];
  /** Ref do conteúdo da thread (observado para re-grudar no fim). */
  threadContentRef: React.RefObject<HTMLDivElement | null>;
  /** Ref-callback do contêiner rolável da thread (gruda no fim ao montar). */
  setThreadEl: (node: HTMLDivElement | null) => void;
  /** Handler de scroll que distingue rolagem do usuário do pin programático. */
  onThreadScroll: () => void;
}

/**
 * Deriva a thread renderizável (merge otimista + álbuns + galeria) e administra
 * o auto-scroll/posição de rolagem. Recebe a janela de mensagens (useWaMessages)
 * e a fila otimista (useWaComposer); não busca dados nem persiste nada.
 */
export function useWaThread(
  selectedId: string | null,
  messages: WhatsAppMessage[],
  pending: WhatsAppMessage[],
): WaThreadApi {
  const [lightbox, setLightbox] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastConvRef = useRef<string | null>(null);
  // Marca se já fixamos a thread no fim para a conversa atual (após as mensagens
  // realmente carregarem). Evita "abrir no topo" quando o 1º paint vem vazio.
  const didInitialScrollRef = useRef(false);
  // "Grudar no fim": permanece true desde a abertura/troca da conversa até o
  // usuário SUBIR manualmente. Mais confiável que `atBottomRef` para o período de
  // assentamento inicial (texto → mídia → cards/ghosts → banners mudam a altura
  // depois do 1º scroll). É limpo só por scroll-up deliberado em `onThreadScroll`.
  const stickBottomRef = useRef(true);
  // Último scrollTop, para detectar direção do scroll (subir = usuário; descer até
  // o fim = pin) sem depender só da distância — evita soltar o grude na corrida
  // entre o pin e o crescimento tardio de mídia/blocos.
  const lastScrollTopRef = useRef(0);

  // Mescla mensagens reais + otimistas (que ainda não voltaram do servidor).
  const allMessages = useMemo(() => {
    const extra = pending.filter(p => !messages.some(b =>
      (!!p._serverId && b.id === p._serverId)
      || (!!p.evolution_message_id && !!b.evolution_message_id && b.evolution_message_id === p.evolution_message_id),
    ));
    return [...messages, ...extra].sort((a, b) => a.wa_timestamp.localeCompare(b.wa_timestamp));
  }, [messages, pending]);

  const msgById = useMemo(() => new Map(allMessages.map(m => [m.id, m])), [allMessages]);

  // Agrupa imagens consecutivas do mesmo remetente em álbuns (estilo WhatsApp).
  // Memoizado em allMessages para (a) não reprocessar a cada render e (b) manter
  // a identidade dos arrays de itens estável — pré-requisito para o React.memo
  // das bolhas/álbuns surtir efeito.
  const messageUnits = useMemo<MessageUnit[]>(() => {
    const groupable = (x: WhatsAppMessage) => x.type === 'image' && !x.reply_to_id
      && x._local !== 'failed' && x.status !== 'failed' && x._local !== 'uploading' && x._local !== 'sending';
    const units: MessageUnit[] = [];
    for (let i = 0; i < allMessages.length; i++) {
      const m = allMessages[i];
      if (groupable(m)) {
        const run = [m]; let j = i + 1;
        while (j < allMessages.length) {
          const n = allMessages[j];
          if (!groupable(n) || n.direction !== m.direction || (n.sender_user_id || null) !== (m.sender_user_id || null)) break;
          if (Math.abs(new Date(n.wa_timestamp).getTime() - new Date(allMessages[j - 1].wa_timestamp).getTime()) > 60000) break;
          run.push(n); j++;
        }
        if (run.length >= 2) { units.push({ kind: 'album', items: run }); i = j - 1; continue; }
      }
      units.push({ kind: 'single', m });
    }
    return units;
  }, [allMessages]);

  // Galeria do lightbox: URLs das imagens da conversa, em ordem — permite navegar
  // (slider ‹ ›) entre todas as imagens ao ampliar uma.
  const lightboxImages = useMemo(
    () => allMessages.filter(m => m.type === 'image' && m.media_url).map(m => m.media_url as string),
    [allMessages],
  );
  // Navegação por teclado no lightbox (← → Esc).
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightbox(null); return; }
      const idx = lightboxImages.indexOf(lightbox);
      if (idx < 0) return;
      if (e.key === 'ArrowRight') setLightbox(lightboxImages[Math.min(idx + 1, lightboxImages.length - 1)]);
      else if (e.key === 'ArrowLeft') setLightbox(lightboxImages[Math.max(idx - 1, 0)]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, lightboxImages]);

  // Salto instantâneo ao fim (sem animação). Reconcilia em passes encadeados de
  // requestAnimationFrame: o conteúdo que muda de altura logo após o commit
  // (layout de mídia, cards, ghosts) é capturado sem timeout arbitrário.
  const jumpToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Dois rAF: 1º após o paint deste commit, 2º após o reflow que ele provocar.
    requestAnimationFrame(() => {
      const e2 = threadRef.current;
      if (e2 && stickBottomRef.current) {
        e2.scrollTop = e2.scrollHeight;
        requestAnimationFrame(() => {
          const e3 = threadRef.current;
          if (e3 && stickBottomRef.current) e3.scrollTop = e3.scrollHeight;
        });
      }
    });
  }, []);

  // Ref de callback do contêiner da thread: dispara exatamente quando o DOM da
  // thread MONTA. Cobre o fluxo de deep-link/notificação — ali o módulo monta do
  // zero e as mensagens podem chegar ANTES de `selected` existir, então a thread
  // só renderiza depois do último disparo do efeito de auto-scroll (que via
  // threadRef nulo e desistia). Ao montar, re-gruda no fim. Em troca de conversa
  // o nó NÃO remonta (mesmo div), então isto não interfere — quem cuida é o efeito.
  const setThreadEl = useCallback((node: HTMLDivElement | null) => {
    threadRef.current = node;
    if (node && !didInitialScrollRef.current) {
      stickBottomRef.current = true;
      atBottomRef.current = true;
      jumpToBottom();
    }
  }, [jumpToBottom]);

  // Auto-scroll: salto instantâneo ao abrir/trocar conversa; suave em mensagem
  // nova só quando o usuário já está no fim (não puxa quem está lendo histórico).
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const isSwitch = lastConvRef.current !== selectedId;
    if (isSwitch) {
      // Render da troca: `messages` ainda é da conversa anterior (o clear só aplica
      // no próximo render). Salta pro fim, zera o "pronto" e RE-GRUDA no fim — a
      // fixação real acontece quando as mensagens DESTA conversa chegam.
      lastConvRef.current = selectedId;
      didInitialScrollRef.current = false;
      atBottomRef.current = true;
      stickBottomRef.current = true;
      jumpToBottom();
      return;
    }
    // Enquanto não fixamos o fim desta conversa, salta para baixo a cada leva de
    // mensagens (o 1º paint vem vazio); só marca como pronto quando há conteúdo.
    // Garante abrir SEMPRE na mensagem mais recente, sem scroll suave a partir do topo.
    if (!didInitialScrollRef.current) {
      atBottomRef.current = true;
      stickBottomRef.current = true;
      jumpToBottom();
      if (allMessages.length > 0) didInitialScrollRef.current = true;
      return;
    }
    // Já fixado no fim: mensagem nova só puxa o scroll se o usuário continua no fim
    // (stick) — quem subiu para ler histórico não é arrastado.
    if (stickBottomRef.current || atBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [allMessages, selectedId, jumpToBottom]);

  // Mantém o fim "grudado" enquanto o conteúdo cresce depois de renderizado —
  // imagens/áudio têm altura desconhecida no 1º paint e esticam a thread depois,
  // o que empurrava a última mensagem pra fora de vista ao abrir a conversa.
  // Observa o CONTEÚDO (cresce com mídia/cards) e o PRÓPRIO contêiner de scroll
  // (clientHeight muda quando banner de reply/bloqueio aparece) — ambos movem o
  // "fim real". Re-gruda quando o usuário não subiu (stick) ou está no fim.
  useEffect(() => {
    const el = threadRef.current;
    const content = threadContentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickBottomRef.current || atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedId]);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 80;
    // Distingue intenção do usuário de pin programático SEM olhar só a distância:
    // um pin sempre AUMENTA o scrollTop (vai ao fim); o usuário subindo DIMINUI o
    // scrollTop. Assim, mídia/bloco que cresce logo após o pin (e momentaneamente
    // deixa dist>80) não desliga mais o "grudar" por engano.
    if (el.scrollTop < lastScrollTopRef.current - 4 && dist > 80) {
      stickBottomRef.current = false; // usuário subiu deliberadamente
    } else if (dist < 4) {
      stickBottomRef.current = true;  // voltou ao fim → volta a grudar
    }
    lastScrollTopRef.current = el.scrollTop;
  }, []);

  return {
    allMessages, msgById, messageUnits,
    lightbox, setLightbox, lightboxImages,
    threadContentRef, setThreadEl, onThreadScroll,
  };
}
