// Lista de conversas da inbox, isolada num componente memoizado.
//
// Por que existe: o módulo re-renderiza a cada tecla digitada no compositor, e
// só CRIAR os elementos das linhas custava ~10ms com 300 conversas — medido em
// `?walistperf=1`. O `React.memo` de cada linha não resolvia isso: ele evita
// re-renderizar o conteúdo da linha, mas o elemento já tinha sido criado e
// reconciliado. Com a lista inteira atrás de um `React.memo`, uma tecla no
// compositor não chega nem a montar a árvore da lista.
//
// A regra para manter esse ganho: TODA prop daqui precisa ter identidade
// estável entre renders (funções em useCallback, mapas em useMemo). A derivação
// por linha mora aqui dentro justamente para o módulo não precisar recriar
// objetos por conversa a cada render.
import React, { useLayoutEffect, useRef } from 'react';
import { Archive } from 'lucide-react';
import { ConversationListItem } from './conversationListItem';
import { ConversationListSkeleton } from './skeletons';
import type { FunnelLabel } from '../../services/settings.service';
import type {
  WhatsAppChannel, WhatsAppConversation, WhatsAppDepartment,
} from '../../types/whatsapp.types';
import type { ElapsedMinutes } from './businessTime';

export interface ConversationListProps {
  conversations: WhatsAppConversation[];
  selectedId: string | null;
  loading: boolean;
  privateMode: boolean;
  emptyMessage: string;
  channelById: Map<string, WhatsAppChannel>;
  deptById: Map<string, WhatsAppDepartment>;
  /** Rascunhos das conversas NÃO abertas (o da aberta nunca aparece na lista). */
  drafts: Record<string, string>;
  mutedIds: ReadonlySet<string>;
  /** Envios que falharam, por conversa (ver `failedSends` no item da lista). */
  failedSends: ReadonlyMap<string, number>;
  /**
   * Encerradas que a busca trouxe do arquivo. Vêm no fim da lista já ordenadas;
   * aqui ganham uma divisória antes da primeira e o aspecto sem cor.
   */
  archivedIds: ReadonlySet<string>;
  /** Escrever o nome do canal nas linhas (só faz sentido com 2+ números). */
  showChannelName: boolean;
  /** Conversas com outro atendente dentro agora (presença da equipe). */
  busyConversationIds: ReadonlySet<string>;
  funnelLabelsForChannel: (channelId: string | null | undefined) => FunnelLabel[];
  /** Etiqueta da IA da linha: substitui os sinais humanos enquanto o agente atende. */
  aiChipFor?: (conversationId: string) => { label: string; title: string } | null;
  /** Medição de tempo dos badges de SLA (horário útil do canal de cada conversa). */
  elapsedMinutes?: ElapsedMinutes;
  conversationStatus: (c: WhatsAppConversation) => { key: string; label: string; cls: string };
  docStatusFor: (clientId: string | null | undefined) => 'awaiting' | 'ready' | null;
  trackedSignatureFor: (clientId: string | null | undefined) => { signature_request_id?: string | null; link_id?: string } | null;
  onSelect: (id: string) => void;
  onStopSignatureTracking: (signatureRequestId: string) => void;
  onStopTemplateFillTracking: (linkId: string) => void;
}

const ConversationListInner: React.FC<ConversationListProps> = ({
  conversations, selectedId, loading, privateMode, emptyMessage,
  channelById, deptById, drafts, mutedIds, failedSends, archivedIds, showChannelName, busyConversationIds,
  funnelLabelsForChannel, aiChipFor, elapsedMinutes,
  conversationStatus, docStatusFor, trackedSignatureFor,
  onSelect, onStopSignatureTracking, onStopTemplateFillTracking,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // As linhas usam `content-visibility` (ver index.css): o navegador não gasta
  // layout nem pintura com o que está fora da tela. O preço é ele precisar de um
  // palpite de altura para as linhas que ainda não pintou — e um palpite errado
  // faz a barra de rolagem encolher enquanto se rola. Em vez de chutar um número
  // fixo, mede as primeiras linhas reais e publica a média como variável CSS.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const rows = el.querySelectorAll<HTMLElement>('.wa-conv');
    const amostra = Math.min(rows.length, 6);
    if (amostra === 0) return;
    let soma = 0;
    for (let i = 0; i < amostra; i += 1) soma += rows[i].offsetHeight;
    const media = Math.round(soma / amostra);
    if (media > 0) el.style.setProperty('--wa-conv-h', `${media}px`);
  }, [conversations.length]);

  if (loading) return <ConversationListSkeleton />;
  if (conversations.length === 0) {
    return <div className="px-4 py-10 text-center text-[13px] text-slate-400">{emptyMessage}</div>;
  }
  // Onde o arquivo começa. A ordenação já pôs as encerradas da busca no fim, então
  // basta achar a primeira: é ali que entra a divisória.
  const primeiraArquivada = archivedIds.size > 0
    ? conversations.findIndex(c => archivedIds.has(c.id))
    : -1;

  return (
    <div ref={listRef}>
      {conversations.map((c, i) => {
        const st = conversationStatus(c);
        const tracked = st.key === 'waiting_client' ? trackedSignatureFor(c.client_id) : null;
        const arquivada = archivedIds.has(c.id);
        const item = (
          <ConversationListItem
            key={c.id}
            archived={arquivada}
            showChannelName={showChannelName}
            busy={busyConversationIds.has(c.id)}
            c={c}
            active={c.id === selectedId}
            channel={c.instance_id ? (channelById.get(c.instance_id) ?? null) : null}
            dept={c.department_id ? (deptById.get(c.department_id) ?? null) : null}
            privateMode={privateMode}
            statusKey={st.key}
            statusLabel={st.label}
            statusCls={st.cls}
            docStatus={docStatusFor(c.client_id)}
            muted={mutedIds.has(c.id)}
            draftPreview={drafts[c.id] ?? ''}
            failedSends={failedSends.get(c.id) ?? 0}
            funnelLabels={funnelLabelsForChannel(c.instance_id)}
            aiChip={aiChipFor?.(c.id) ?? null}
            elapsedMinutes={elapsedMinutes}
            onSelect={onSelect}
            onDismissTracking={tracked
              ? () => (tracked.signature_request_id
                ? onStopSignatureTracking(tracked.signature_request_id)
                : onStopTemplateFillTracking(tracked.link_id!))
              : undefined}
          />
        );
        if (i !== primeiraArquivada) return item;
        // Fecha a fila de trabalho e abre o arquivo. Sem esta linha, a primeira
        // encerrada apareceria logo depois de uma ativa e pareceria fazer parte
        // da mesma lista.
        return (
          <React.Fragment key={`div-${c.id}`}>
            <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 select-none">
              <Archive size={11} className="flex-shrink-0 text-slate-400" />
              <span className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">
                Encerradas ({archivedIds.size})
              </span>
              <span className="h-px flex-1 bg-[#e7e5df]" />
            </div>
            {item}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export const ConversationList = React.memo(ConversationListInner);
ConversationList.displayName = 'ConversationList';
