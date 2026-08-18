// Camada visual da thread do WhatsApp: mescla mensagens reais + otimistas,
// agrupa imagens consecutivas em álbuns, mantém a galeria/lightbox e cuida de
// todo o auto-scroll (abrir/trocar conversa, mensagem nova e o crescimento tardio
// de mídia/cards) + da posição ao paginar. Extraído do WhatsAppModule para
// concentrar a lógica de rolagem/apresentação da thread fora do orquestrador.
// Vive DEPOIS de useWaComposer na ordem de hooks, pois consome `pending`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countNewBelow, emptySeenMark, markAllSeen, type SeenMark } from '../threadUnread';
import type { ThreadCall } from '../threadCallEntry';
import type { WhatsAppMessage } from '../../../types/whatsapp.types';

export type MessageUnit =
  | { kind: 'album'; items: WhatsAppMessage[] }
  | { kind: 'single'; m: WhatsAppMessage }
  // A ligação é uma unidade da thread como qualquer outra. Entrando aqui, ela
  // herda de graça as duas coisas que fazem a leitura funcionar: a ordem no
  // tempo e a seção do dia (com o divisor grudento). Fora daqui, seria preciso
  // reimplementar as duas — e elas divergiriam no primeiro ajuste.
  | { kind: 'call'; call: ThreadCall };

/** O instante de uma unidade da thread, seja ela mensagem, álbum ou chamada. */
export function unitTimestamp(u: MessageUnit): string {
  if (u.kind === 'call') return u.call.startedAt;
  return (u.kind === 'album' ? u.items[0] : u.m).wa_timestamp;
}

/** Uma faixa de `messageUnits` que pertence ao mesmo dia. `fim` é exclusivo. */
export interface DiaDaThread {
  chave: string;
  /** Timestamp da primeira mensagem do dia — é dele que sai o rótulo. */
  tsInicial: string;
  inicio: number;
  fim: number;
}

export interface WaThreadApi {
  /** Mensagens reais + otimistas mescladas e ordenadas (asc por timestamp). */
  allMessages: WhatsAppMessage[];
  msgById: Map<string, WhatsAppMessage>;
  /** Áudio → áudio logo abaixo dele. Alimenta a reprodução em sequência. */
  nextAudioId: Map<string, string>;
  /** Unidades de render: álbuns de imagens consecutivas ou bolha única. */
  messageUnits: MessageUnit[];
  /** Faixas de `messageUnits` por dia — uma seção de render para cada. */
  diasDaThread: DiaDaThread[];
  lightbox: string | null;
  setLightbox: React.Dispatch<React.SetStateAction<string | null>>;
  lightboxImages: string[];
  /** Ref do conteúdo da thread (observado para re-grudar no fim). */
  threadContentRef: React.RefObject<HTMLDivElement | null>;
  /** Ref-callback do contêiner rolável da thread (gruda no fim ao montar). */
  setThreadEl: (node: HTMLDivElement | null) => void;
  /** Handler de scroll que distingue rolagem do usuário do pin programático. */
  onThreadScroll: () => void;
  /** O usuário subiu o bastante para valer a pena oferecer o caminho de volta. */
  scrolledUp: boolean;
  /** Mensagens recebidas que chegaram abaixo da janela visível desde então. */
  newBelow: number;
  /** Volta ao fim da conversa e zera a contagem de novas. */
  scrollToBottom: () => void;
  /**
   * Leva a thread até uma mensagem específica e a acende por um instante.
   * Devolve `false` quando ela não está na janela carregada — quem chamou
   * decide se pagina para trás e tenta de novo.
   */
  jumpToMessage: (messageId: string) => boolean;
}

/** Quanto tempo a mensagem alvo fica acesa depois do salto. */
const REALCE_MS = 2600;

/**
 * Janela em que o salto MANDA na rolagem. Abrir uma conversa e saltar acontecem
 * no mesmo instante, e logo depois a thread ainda se assenta: fotos e áudios
 * chegam com altura desconhecida, as ligações entram, os cards crescem. Cada um
 * desses eventos passava pelo auto-scroll e pelo ResizeObserver, que — vendo a
 * thread "no fim" — devolviam a conversa para o rodapé um quadro depois do
 * salto. Era por isso que o primeiro clique numa agendada concluída parecia só
 * abrir a conversa, e o segundo (com a thread já assentada) ia até a mensagem.
 */
const SALTO_ASSENTAMENTO_MS = 2200;

/**
 * Deriva a thread renderizável (merge otimista + álbuns + galeria) e administra
 * o auto-scroll/posição de rolagem. Recebe a janela de mensagens (useWaMessages)
 * e a fila otimista (useWaComposer); não busca dados nem persiste nada.
 */
export function useWaThread(
  selectedId: string | null,
  messages: WhatsAppMessage[],
  pending: WhatsAppMessage[],
  /** Ligações desta conversa — desenhadas no meio das mensagens, pelo horário. */
  calls: ThreadCall[] = [],
): WaThreadApi {
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Quem sobe para reler o histórico perdia o caminho de volta: só restava
  // arrastar a barra até o fim, e nada avisava que tinham chegado mensagens
  // enquanto isso. Estes dois estados sustentam o botão de voltar ao fim.
  const [scrolledUp, setScrolledUp] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  // O que já foi visto: ids concretos + um piso de tempo (ver `threadUnread`).
  // Por id, e não por índice, porque carregar mensagens anteriores insere no
  // COMEÇO da lista e deslocaria qualquer índice; e com piso de tempo porque
  // essas mensagens anteriores não podem ser confundidas com novidade.
  const seenRef = useRef<SeenMark>(emptySeenMark());

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
  // Até quando o salto até uma mensagem manda na rolagem, e qual é a mensagem.
  // Enquanto essa janela está aberta, nada mais leva a thread ao fim, e o que
  // cresce acima do alvo é compensado recentralizando-o (ver o ResizeObserver).
  const saltoAteRef = useRef(0);
  const saltoAlvoRef = useRef<string | null>(null);
  /** O salto ainda está no comando da rolagem? */
  const saltoAtivo = () => saltoAteRef.current > Date.now();
  /** Encerra o salto: a rolagem volta a ser do usuário e do auto-scroll. */
  const encerrarSalto = () => { saltoAteRef.current = 0; saltoAlvoRef.current = null; };

  // Mescla mensagens reais + otimistas (que ainda não voltaram do servidor).
  // A fila otimista atravessa a troca de conversa — é assim que um envio em voo
  // (ou que falhou) continua existindo enquanto se atende outra pessoa. Por isso
  // o recorte por `conversation_id` acontece AQUI, na hora de desenhar: a bolha
  // de uma conversa não pode aparecer na thread de outra.
  const allMessages = useMemo(() => {
    const extra = pending.filter(p => p.conversation_id === selectedId && !messages.some(b =>
      (!!p._serverId && b.id === p._serverId)
      || (!!p.evolution_message_id && !!b.evolution_message_id && b.evolution_message_id === p.evolution_message_id),
    ));
    // O que está EM VOO fica sempre no fim, sem passar pela ordenação por tempo.
    //
    // A bolha otimista nasce com o relógio DESTE computador; a confirmada volta
    // com o horário do servidor. Um relógio local atrasado (minutos, às vezes
    // segundos, e ninguém acerta relógio de máquina de escritório) punha a
    // mensagem recém-escrita ACIMA das anteriores — e, quando a confirmação
    // chegava com o horário certo, ela pulava para o fim sozinha. Ordem por
    // posição na fila em vez de por relógio: a mensagem nasce embaixo e fica
    // onde nasceu.
    const reais = [...messages].sort((a, b) => a.wa_timestamp.localeCompare(b.wa_timestamp));
    return [...reais, ...extra];
  }, [messages, pending, selectedId]);

  const msgById = useMemo(() => new Map(allMessages.map(m => [m.id, m])), [allMessages]);

  // Encadeamento dos áudios: para cada áudio, o id do que vem LOGO ABAIXO dele,
  // e só quando esse vizinho imediato também é áudio. É o que separa "mandou
  // três áudios seguidos" (ouve os três de enfiada, sem tocar na tela) de "mandou
  // um áudio, depois escreveu, depois mandou outro" — aí a sequência foi cortada
  // pelo texto, e emendar o áudio de baixo seria pular a mensagem do meio.
  //
  // Vive aqui, e não na bolha, porque a bolha só conhece a si mesma: quem sabe o
  // que está imediatamente antes e depois é a thread montada.
  const nextAudioId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (let i = 0; i < allMessages.length - 1; i += 1) {
      const atual = allMessages[i];
      const seguinte = allMessages[i + 1];
      if (atual.type !== 'audio' || seguinte.type !== 'audio') continue;
      if (atual.deleted_at || seguinte.deleted_at) continue;
      mapa.set(atual.id, seguinte.id);
    }
    return mapa;
  }, [allMessages]);

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

  /**
   * As chamadas entram na linha do tempo, pelo horário em que tocaram.
   *
   * Depois do agrupamento de álbuns de propósito: uma ligação no meio de três
   * fotos enviadas em rajada não pode quebrar o álbum — o álbum é uma coisa só
   * que aconteceu num instante, e a chamada acontece antes ou depois dele.
   *
   * A mescla é estável: empatando no milissegundo, a mensagem vem primeiro. É a
   * ordem em que os fatos acontecem — a ligação é registrada quando ACABA, e o
   * que veio junto dela já estava na tela.
   */
  const unitsWithCalls = useMemo<MessageUnit[]>(() => {
    if (calls.length === 0) return messageUnits;
    const ordenadas = [...calls].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
    const saida: MessageUnit[] = [];
    let c = 0;
    for (const u of messageUnits) {
      const quando = new Date(unitTimestamp(u)).getTime();
      while (c < ordenadas.length && new Date(ordenadas[c].startedAt).getTime() < quando) {
        saida.push({ kind: 'call', call: ordenadas[c] });
        c += 1;
      }
      saida.push(u);
    }
    for (; c < ordenadas.length; c += 1) saida.push({ kind: 'call', call: ordenadas[c] });
    return saida;
  }, [messageUnits, calls]);

  // Fatias por dia. Existem por causa de um detalhe de CSS com consequência
  // visível: `position: sticky` só é empurrado pelo fim do PRÓPRIO pai. Com todos
  // os divisores de data soltos no mesmo contêiner, cada um grudava em `top` e o
  // seguinte parava exatamente em cima do anterior — na tela saía "07 DE" à
  // esquerda, "2026" à direita e um "HOJE" plantado no meio, tapando o miolo.
  //
  // Com uma seção por dia, o divisor gruda enquanto o dia dele está passando e é
  // empurrado para fora quando o dia acaba, que é o comportamento do WhatsApp.
  const diasDaThread = useMemo<DiaDaThread[]>(() => {
    const dias: DiaDaThread[] = [];
    for (let i = 0; i < unitsWithCalls.length; i += 1) {
      const ts = unitTimestamp(unitsWithCalls[i]);
      const chave = new Date(ts).toDateString();
      const ultimo = dias[dias.length - 1];
      if (ultimo && ultimo.chave === chave) ultimo.fim = i + 1;
      else dias.push({ chave, tsInicial: ts, inicio: i, fim: i + 1 });
    }
    return dias;
  }, [unitsWithCalls]);

  // Galeria do lightbox: URLs das imagens da conversa, em ordem — permite navegar
  // (slider ‹ ›) entre todas as imagens ao ampliar uma. Sem repetição: a galeria
  // se localiza pela URL, então a mesma foto enviada duas vezes fazia o ‹ › pular
  // para a primeira cópia. Teclado (← → Esc) e índice vivem dentro do WaLightbox.
  const lightboxImages = useMemo(
    () => Array.from(new Set(
      allMessages.filter(m => m.type === 'image' && m.media_url).map(m => m.media_url as string),
    )),
    [allMessages],
  );

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
      // Sair da conversa cancela o salto que estava assentando nela.
      encerrarSalto();
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
    // Quem abriu a conversa POR uma mensagem já disse aonde quer ir: enquanto o
    // salto assenta, nenhuma leva de mensagens (nem as ligações, que chegam por
    // outra consulta) tem o direito de puxar a thread de volta ao fim.
    if (saltoAtivo()) return;
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

  // Contagem do que chegou "lá embaixo" enquanto se lê o histórico. A regra em si
  // (o que conta como novidade) mora em `threadUnread`, testada em separado;
  // aqui só se decide QUANDO a conversa está sendo acompanhada — o que é uma
  // pergunta sobre a barra de rolagem, e por isso fica deste lado.
  useEffect(() => {
    const noFim = stickBottomRef.current || atBottomRef.current;
    if (noFim) {
      seenRef.current = markAllSeen(seenRef.current, allMessages);
      setNewBelow(0);
      return;
    }
    setNewBelow(countNewBelow(allMessages, seenRef.current));
  }, [allMessages]);

  // Troca de conversa zera o histórico do que já foi visto.
  useEffect(() => {
    seenRef.current = emptySeenMark();
    setNewBelow(0);
    setScrolledUp(false);
  }, [selectedId]);

  /** Volta ao fim da conversa e marca tudo como visto. */
  const scrollToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    // Pedir o fim encerra o salto: daqui em diante quem manda é o rodapé.
    encerrarSalto();
    stickBottomRef.current = true;
    atBottomRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    seenRef.current = markAllSeen(seenRef.current, allMessages);
    setNewBelow(0);
    setScrolledUp(false);
  }, [allMessages]);

  // ── Salto até uma mensagem do meio da conversa ───────────────────────
  // Quem chega por aqui veio do histórico de agendadas: quer ver ONDE aquela
  // mensagem caiu, não o fim da thread. Por isso o salto DESLIGA o grude no
  // fim — sem isso, o auto-scroll (e o ResizeObserver que persegue o fim
  // enquanto mídia carrega) desfaria a rolagem no quadro seguinte.
  const realceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Põe a mensagem no meio da janela. Centraliza pela diferença de retângulos, e
   * não com `scrollIntoView`: este último rola TAMBÉM os ancestrais, e a thread
   * mora dentro do módulo (que pode estar numa janela flutuante sobre o CRM) — a
   * página inteira pulava.
   */
  const centralizar = useCallback((alvo: HTMLElement, suave: boolean) => {
    const el = threadRef.current;
    if (!el) return;
    const caixa = el.getBoundingClientRect();
    const linha = alvo.getBoundingClientRect();
    const destino = el.scrollTop + (linha.top - caixa.top) - (el.clientHeight - linha.height) / 2;
    const topo = Math.max(0, Math.min(destino, el.scrollHeight - el.clientHeight));
    el.scrollTo({ top: topo, behavior: suave ? 'smooth' : 'auto' });
    lastScrollTopRef.current = topo;
  }, []);

  const jumpToMessage = useCallback((messageId: string): boolean => {
    const el = threadRef.current;
    if (!el || !messageId) return false;
    const alvo = el.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
    if (!alvo) return false;

    stickBottomRef.current = false;
    atBottomRef.current = false;
    // A conversa já tem um fim fixado: sem isto, o efeito de auto-scroll
    // trataria a próxima leva de mensagens como "primeira" e saltaria ao fim.
    didInitialScrollRef.current = true;
    // Abre a janela em que o salto manda na rolagem. É o que faz UM clique
    // bastar: no primeiro clique a conversa acaba de abrir e ainda vai crescer
    // (mídia, ligações, cards), e cada crescimento devolvia a thread ao rodapé.
    saltoAteRef.current = Date.now() + SALTO_ASSENTAMENTO_MS;
    saltoAlvoRef.current = messageId;

    centralizar(alvo, true);
    setScrolledUp(true);

    // Acende a bolha por um instante: no meio de uma conversa longa, chegar
    // "mais ou menos ali" não responde qual das mensagens é a procurada.
    if (realceTimerRef.current) clearTimeout(realceTimerRef.current);
    el.querySelectorAll('.wa-msg-focus').forEach(n => n.classList.remove('wa-msg-focus'));
    alvo.classList.add('wa-msg-focus');
    realceTimerRef.current = setTimeout(() => alvo.classList.remove('wa-msg-focus'), REALCE_MS);
    return true;
  }, [centralizar]);

  useEffect(() => () => { if (realceTimerRef.current) clearTimeout(realceTimerRef.current); }, []);

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
      // Com um salto em curso, o que cresce é justamente o que empurra a
      // mensagem procurada para fora da tela — uma foto acima dela terminando
      // de carregar. Então o observador persegue o ALVO, não o fim.
      if (saltoAtivo()) {
        const alvo = saltoAlvoRef.current
          ? el.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(saltoAlvoRef.current)}"]`)
          : null;
        if (alvo) centralizar(alvo, false);
        return;
      }
      if (stickBottomRef.current || atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedId, centralizar]);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Os eventos que chegam durante o salto são a ANIMAÇÃO a caminho da
    // mensagem, não o usuário. O primeiro deles sai do rodapé (dist ≈ 0) e
    // remarcava "estou no fim" — bastava isso para a leva seguinte de conteúdo
    // trazer a conversa de volta para baixo.
    if (saltoAtivo()) {
      lastScrollTopRef.current = el.scrollTop;
      setScrolledUp(dist > 320);
      return;
    }
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
    // Limiar generoso (uma tela e meia de distância): perto do fim o botão só
    // atrapalharia, e ele não pode piscar a cada roda do mouse. `setState` com o
    // mesmo valor é descartado pelo React, então não há re-render por evento.
    setScrolledUp(dist > 320);
    if (dist < 80) setNewBelow(0);
  }, []);

  return {
    allMessages, msgById, nextAudioId, messageUnits: unitsWithCalls, diasDaThread,
    lightbox, setLightbox, lightboxImages,
    threadContentRef, setThreadEl, onThreadScroll,
    scrolledUp, newBelow, scrollToBottom, jumpToMessage,
  };
}
