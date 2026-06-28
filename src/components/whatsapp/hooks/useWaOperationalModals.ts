// Camada dos fluxos de modais operacionais + workspace 360 do WhatsApp: possui o
// estado de abertura dos modais (transferir, nova conversa, bloquear, encerrar,
// pedir documento) e do workspace embutido, além das *ações de conclusão*
// (onDone/onCreated/onOpened/onSaved) que costuram esses modais com a lista de
// conversas, o overview do cliente e o funil. Extraído do WhatsAppModule para
// concentrar a orquestração desses fluxos fora do JSX, sem mudar o comportamento.
import { useCallback, useState } from 'react';
import { whatsappService, type ClientOverview } from '../../../services/whatsapp.service';
import type { FunnelLabel } from '../../../services/settings.service';
import type { WaModal } from '../../WaWorkspace';
import type { WhatsAppConversation } from '../../../types/whatsapp.types';

interface WaOperationalModalsArgs {
  selected: WhatsAppConversation | null;
  funnelLabels: FunnelLabel[];
  setConversations: React.Dispatch<React.SetStateAction<WhatsAppConversation[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  loadConversations: () => Promise<void>;
  reloadOverview: () => void;
  setOverview: React.Dispatch<React.SetStateAction<ClientOverview | null>>;
  /** IA classifica o assunto ao encerrar (best-effort) — vem do módulo. */
  classifyOnClose: () => Promise<void>;
}

export interface WaOperationalModalsApi {
  // Estado de abertura dos modais operacionais.
  transferOpen: boolean;
  setTransferOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newConvOpen: boolean;
  setNewConvOpen: React.Dispatch<React.SetStateAction<boolean>>;
  blockOpen: boolean;
  setBlockOpen: React.Dispatch<React.SetStateAction<boolean>>;
  closeOpen: boolean;
  setCloseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  docRequestOpen: boolean;
  setDocRequestOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Workspace 360 embutido.
  workspace: WaModal | null;
  openWa: (modal: WaModal) => void;
  closeWa: () => void;
  // Ações de conclusão dos fluxos.
  handleConversationOpened: (conversationId: string) => Promise<void>;
  onTransferDone: () => Promise<void>;
  onBlockDone: (reason: string) => void;
  onCloseDone: () => Promise<void>;
  onRequestDocCreated: () => void;
  onWorkspaceSaved: (type: string) => void;
}

/**
 * Concentra o estado de abertura e os callbacks de conclusão dos modais
 * operacionais (transfer/block/close/nova conversa/pedir documento) e do
 * workspace 360. Mantém o comportamento exato (atualização da lista, do overview
 * e do funil; classificação por IA ao encerrar) que vivia inline no JSX.
 */
export function useWaOperationalModals({
  selected, funnelLabels, setConversations, setSelectedId,
  loadConversations, reloadOverview, setOverview, classifyOnClose,
}: WaOperationalModalsArgs): WaOperationalModalsApi {
  const [docRequestOpen, setDocRequestOpen] = useState(false);
  // WhatsApp 360: workspace modal (abre entidades do CRM sem sair da conversa)
  const [workspace, setWorkspace] = useState<WaModal | null>(null);
  const openWa = useCallback((modal: WaModal) => setWorkspace(modal), []);
  const closeWa = useCallback(() => setWorkspace(null), []);
  const [transferOpen, setTransferOpen] = useState(false);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  // Move uma conversa para uma ETAPA do funil (etapa única: remove etiquetas de
  // funil anteriores, mantém tags livres). Usado por automações como "ao pedir
  // documento → Aguardando Documentos". No-op se a etapa não existe no funil.
  const moveConversationToStage = useCallback(async (conv: WhatsAppConversation, stageKey: string) => {
    const target = funnelLabels.find(l => l.stageKey === stageKey);
    if (!target) return;
    const cur = conv.labels ?? [];
    if (cur.includes(target.key)) return;
    const funnelKeys = new Set(funnelLabels.map(l => l.key));
    const next = [...cur.filter(l => !funnelKeys.has(l)), target.key];
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, labels: next } : c));
    try { await whatsappService.updateLabels(conv.id, next); } catch { /* best-effort */ }
  }, [funnelLabels, setConversations]);

  // Abre a conversa recém-criada/reaberta na inbox (recarrega para trazer avatar etc.).
  const handleConversationOpened = useCallback(async (conversationId: string) => {
    setNewConvOpen(false);
    await loadConversations();
    setSelectedId(conversationId);
  }, [loadConversations, setSelectedId]);

  // Transferir conversa → some da fila atual; limpa seleção e recarrega a lista.
  const onTransferDone = useCallback(async () => {
    setTransferOpen(false);
    setSelectedId(null);
    await loadConversations();
  }, [setSelectedId, loadConversations]);

  // Bloquear contato → marca a conversa como bloqueada (otimista).
  const onBlockDone = useCallback((reason: string) => {
    if (!selected) return;
    setBlockOpen(false);
    setConversations(prev => prev.map(c => c.id === selected.id
      ? { ...c, is_blocked: true, blocked_at: new Date().toISOString(), blocked_reason: reason } : c));
  }, [selected, setConversations]);

  // Encerrar atendimento → IA classifica o assunto (2º plano), limpa seleção e
  // recarrega a lista. O closure ainda enxerga a conversa atual via classifyOnClose.
  const onCloseDone = useCallback(async () => {
    setCloseOpen(false);
    classifyOnClose().catch(() => { /* best-effort */ });
    setSelectedId(null);
    await loadConversations();
  }, [classifyOnClose, setSelectedId, loadConversations]);

  // Solicitou documento → recarrega overview e posiciona a conversa em
  // "Aguardando Documentos".
  const onRequestDocCreated = useCallback(() => {
    reloadOverview();
    if (selected) void moveConversationToStage(selected, 'aguardando_documentos');
  }, [reloadOverview, selected, moveConversationToStage]);

  // Workspace salvou: atualiza só o domínio afetado (overview do cliente),
  // mantendo scroll e seleção da conversa.
  const onWorkspaceSaved = useCallback((type: string) => {
    if (['process', 'requirement', 'deadline', 'calendar', 'financial', 'client', 'document'].includes(type)) {
      if (selected?.client_id) {
        whatsappService.getClientOverview(selected.client_id).then(ov => ov && setOverview(ov)).catch(() => {});
      }
    }
    closeWa();
  }, [selected, setOverview, closeWa]);

  return {
    transferOpen, setTransferOpen,
    newConvOpen, setNewConvOpen,
    blockOpen, setBlockOpen,
    closeOpen, setCloseOpen,
    docRequestOpen, setDocRequestOpen,
    workspace, openWa, closeWa,
    handleConversationOpened,
    onTransferDone, onBlockDone, onCloseDone, onRequestDocCreated, onWorkspaceSaved,
  };
}
