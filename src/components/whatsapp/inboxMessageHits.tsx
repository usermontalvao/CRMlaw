// "EM QUE CONVERSA FOI QUE…?" — a busca da inbox passa a olhar dentro das
// mensagens, e não só os nomes.
//
// ── O que faltava ──────────────────────────────────────────────────────────
// O campo de busca da lista sempre casou com NOME, TELEFONE e CLIENTE. Serve
// para "abre a conversa da Maria" e não serve para nada além disso. Só que a
// pergunta que o escritório faz o dia inteiro é a outra: "quem foi que falou do
// laudo da perícia?", "em qual atendimento combinamos 40%?", "alguém já mandou
// o número desse processo?". A resposta estava guardada — em 286 conversas —
// e não havia como chegar nela sem lembrar de quem era.
//
// Junto com a busca dentro da conversa (`threadSearch.tsx`), fecham as duas
// metades da mesma pergunta: aquela responde "onde nesta conversa", esta
// responde "em qual conversa".
//
// ── Três decisões ──────────────────────────────────────────────────────────
//
// 1. VEM DEPOIS DAS CONVERSAS, não no lugar delas. Quem digita "maria" quase
//    sempre quer a conversa da Maria; quem digita "rescisão indireta" quer as
//    mensagens. Não dá para adivinhar qual dos dois é — então os dois aparecem,
//    na ordem em que costumam ser procurados, e a seção só nasce quando há
//    achado. Nunca empurra a fila de trabalho para fora da tela sem motivo.
//
// 2. UMA LINHA POR MENSAGEM, ordenada pela mais recente. Agrupar por conversa
//    esconderia justamente o que se procura (a frase), e a conversa já está
//    escrita em cada linha.
//
// 3. O ACHADO É CONFERIDO CONTRA A LISTA QUE A INBOX JÁ TEM. A policy de
//    `whatsapp_messages` recorta por canal, mas a lista de conversas passa por
//    esse recorte DUAS vezes (ver `listConversations` e `canaisPermitidos`), e
//    é dela que sai o nome e a foto de cada linha. Um achado sem conversa
//    conhecida não vira linha: não teria como ser aberto, e desenhar um
//    resultado que não abre é pior do que não desenhá-lo.
import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, MessageSquareText, Mic } from 'lucide-react';
import { whatsappService, type WhatsAppMessageHit } from '../../services/whatsapp.service';
import { trechoDoAchado, textoBuscavel, type TrechoDoAchado } from './threadSearchText';
import { Avatar } from './avatar';
import { conversationName, formatTime, maskName, maskSensitive } from './format';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

/** Teto de linhas desenhadas. Ver a nota em `LIMITE` abaixo. */
const LIMITE = 40;

export interface InboxMessageHitsProps {
  /** O termo digitado na busca da lista. Abaixo de 2 letras, nada acontece. */
  term: string;
  /** Todas as conversas que a inbox conhece — a fonte do nome, da foto e da tranca. */
  conversations: readonly WhatsAppConversation[];
  privateMode: boolean;
  /** Abrir a conversa JÁ na mensagem encontrada. */
  onOpen: (conversationId: string, messageId: string) => void;
  /**
   * Quantas linhas esta seção acabou desenhando.
   *
   * A lista de cima precisa saber: procurar "holerite" não casa com nome de
   * ninguém, e ela escrevia "Nenhuma conversa para este filtro" logo acima de
   * cinco resultados de verdade. Um "não achei" em cima do que foi achado é o
   * pior recado que a busca pode dar.
   */
  onResultCount?: (n: number) => void;
}

interface Linha {
  hit: WhatsAppMessageHit;
  conversa: WhatsAppConversation;
  trecho: TrechoDoAchado;
  doAudio: boolean;
  doArquivo: boolean;
}

const InboxMessageHitsInner: React.FC<InboxMessageHitsProps> = ({
  term, conversations, privateMode, onOpen, onResultCount,
}) => {
  const [buscando, setBuscando] = useState(false);
  const [achados, setAchados] = useState<WhatsAppMessageHit[] | null>(null);
  const [erro, setErro] = useState(false);

  const alvo = term.trim();

  // Um índice por id, refeito só quando a lista muda de tamanho ou de conteúdo.
  const porId = useMemo(() => {
    const m = new Map<string, WhatsAppConversation>();
    for (const c of conversations) m.set(c.id, c);
    return m;
  }, [conversations]);

  // ── A varredura ───────────────────────────────────────────────────────────
  // Espera 320 ms — um pouco mais que a busca dentro da conversa, porque aqui a
  // consulta é sobre a base inteira e quem digita na lista está quase sempre
  // digitando um nome (que a lista já responde na hora, sem rede nenhuma).
  useEffect(() => {
    if (alvo.length < 2) { setAchados(null); setErro(false); setBuscando(false); return; }
    let cancelado = false;
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const linhas = await whatsappService.searchMessages(null, alvo, { limit: 120 });
        if (!cancelado) { setAchados(linhas); setErro(false); }
      } catch {
        // Silencioso de propósito: esta seção é um EXTRA embaixo da lista de
        // conversas, que continua respondendo. Um erro em vermelho no meio da
        // fila de trabalho assustaria por uma busca que ninguém pediu em voz
        // alta — a seção simplesmente não aparece.
        if (!cancelado) { setAchados(null); setErro(true); }
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 320);
    return () => { cancelado = true; clearTimeout(t); };
  }, [alvo]);

  const linhas = useMemo<Linha[]>(() => {
    if (!achados) return [];
    const montadas: Linha[] = [];
    for (const hit of achados) {
      const conversa = porId.get(hit.conversation_id);
      if (!conversa) continue; // a segunda tranca — ver o cabeçalho.
      const trecho = trechoDoAchado(textoBuscavel(hit), alvo, 38);
      if (!trecho) continue;
      const conteudo = (hit.content ?? '').trim();
      const temTranscricao = !!(hit.transcription_text ?? '').trim();
      montadas.push({
        hit,
        conversa,
        trecho,
        doAudio: !conteudo && temTranscricao,
        doArquivo: !conteudo && !temTranscricao && !!(hit.file_name ?? '').trim(),
      });
      if (montadas.length >= LIMITE) break;
    }
    return montadas;
  }, [achados, porId, alvo]);

  useEffect(() => { onResultCount?.(linhas.length); }, [linhas.length, onResultCount]);

  // Nada encontrado NÃO desenha "nenhum resultado": a lista de conversas acima
  // já respondeu à busca, e uma segunda resposta negativa embaixo dela só
  // acrescentaria uma frase de desânimo a cada letra digitada.
  if (erro || alvo.length < 2) return null;
  if (!buscando && linhas.length === 0) return null;

  const mascarar = (s: string) => (privateMode ? maskSensitive(s) : s);

  return (
    <div className="pb-2">
      {/* A mesma divisória de "Encerradas", pela mesma razão: fecha uma lista e
          abre outra, para a primeira linha daqui não parecer uma conversa. */}
      <div className="flex select-none items-center gap-2 px-4 pb-1.5 pt-3">
        <MessageSquareText size={11} className="flex-shrink-0 text-slate-400" />
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">
          Nas mensagens{linhas.length > 0 && ` (${linhas.length}${linhas.length >= LIMITE ? '+' : ''})`}
        </span>
        {buscando && <Loader2 size={11} className="animate-spin text-slate-400" />}
        <span className="h-px flex-1 bg-[#e7e5df]" />
      </div>

      {linhas.map(l => {
        const nome = conversationName(l.conversa);
        return (
          <button
            key={l.hit.id}
            type="button"
            onClick={() => onOpen(l.conversa.id, l.hit.id)}
            title={`Abrir a conversa de ${nome} nesta mensagem`}
            className="mx-1.5 flex w-[calc(100%-12px)] items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-[#f5f4f1]"
          >
            <Avatar url={l.conversa.contact_avatar_url} name={nome} phone={l.conversa.contact_phone} size={30} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-700">
                  {privateMode ? maskName(nome) : nome}
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-slate-400">
                  {formatTime(l.hit.wa_timestamp)}
                </span>
              </span>
              <span className="mt-0.5 flex items-start gap-1.5">
                {l.doAudio && <Mic size={10} className="mt-[3px] shrink-0 text-slate-400" />}
                {l.doArquivo && <FileText size={10} className="mt-[3px] shrink-0 text-slate-400" />}
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-slate-500 line-clamp-2">
                  {/* "Você:" com a mesma palavra da prévia da linha de conversa. */}
                  {l.hit.direction === 'out' && <span className="text-slate-400">Você: </span>}
                  {l.trecho.cortadoAntes && '… '}
                  {mascarar(l.trecho.antes)}
                  <mark className="rounded-[3px] bg-[#ffe08a] px-px font-semibold text-slate-900">
                    {mascarar(l.trecho.achado)}
                  </mark>
                  {mascarar(l.trecho.depois)}
                  {l.trecho.cortadoDepois && ' …'}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const InboxMessageHits = React.memo(InboxMessageHitsInner);
InboxMessageHits.displayName = 'InboxMessageHits';
