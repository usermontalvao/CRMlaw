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
import React from 'react';
import { Loader2 } from 'lucide-react';
import { ConversationListItem } from './conversationListItem';
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
  funnelLabelsForChannel: (channelId: string | null | undefined) => FunnelLabel[];
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
  channelById, deptById, drafts, mutedIds, funnelLabelsForChannel, elapsedMinutes,
  conversationStatus, docStatusFor, trackedSignatureFor,
  onSelect, onStopSignatureTracking, onStopTemplateFillTracking,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }
  if (conversations.length === 0) {
    return <div className="px-4 py-10 text-center text-[13px] text-slate-400">{emptyMessage}</div>;
  }
  return (
    <>
      {conversations.map(c => {
        const st = conversationStatus(c);
        const tracked = st.key === 'waiting_client' ? trackedSignatureFor(c.client_id) : null;
        return (
          <ConversationListItem
            key={c.id}
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
            funnelLabels={funnelLabelsForChannel(c.instance_id)}
            elapsedMinutes={elapsedMinutes}
            onSelect={onSelect}
            onDismissTracking={tracked
              ? () => (tracked.signature_request_id
                ? onStopSignatureTracking(tracked.signature_request_id)
                : onStopTemplateFillTracking(tracked.link_id!))
              : undefined}
          />
        );
      })}
    </>
  );
};

export const ConversationList = React.memo(ConversationListInner);
ConversationList.displayName = 'ConversationList';
