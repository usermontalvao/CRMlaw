// Camada de ações operacionais/governança da conversa aberta do WhatsApp:
// aceitar transferência, assumir, devolver à fila, reabrir, desbloquear,
// silenciar/dessilenciar, limpar a thread e alternar supressão de ausência /
// guarda jurídica. Extraído do WhatsAppModule para concentrar as mutações de
// atendimento (com atualização otimista da lista de conversas) fora do
// orquestrador. Não cuida de fluxos amarrados a modais (transfer/block/close),
// que continuam no módulo por dependerem de estado de UI.
import { useCallback, useState } from 'react';
import {
  whatsappService,
  type AgentPrefs,
  type StaffOption,
} from '../../../services/whatsapp.service';
import { buildAcceptPresentation } from '../format';
import { sendTextResilient } from '../../../services/whatsapp/resilientSend';
import { muteStore } from '../../../services/whatsapp/muteStore';
import { useToastContext } from '../../../contexts/ToastContext';
import type { ConfirmFn } from '../types';
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppAiSession,
} from '../../../types/whatsapp.types';

interface WaConversationActionsArgs {
  selected: WhatsAppConversation | null;
  user: { id: string } | null;
  agentPrefs: AgentPrefs;
  staffById: Map<string, StaffOption>;
  aiSession: WhatsAppAiSession | null;
  confirm: ConfirmFn;
  setConversations: React.Dispatch<React.SetStateAction<WhatsAppConversation[]>>;
  refreshMessages: (convId: string) => Promise<void>;
  /** Fecha o menu de silenciar (estado de UI que permanece no módulo). */
  closeMuteMenu: () => void;
  // Resets da thread/compositor usados ao limpar a conversa.
  setMessages: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  setPending: React.Dispatch<React.SetStateAction<WhatsAppMessage[]>>;
  setReplyTo: React.Dispatch<React.SetStateAction<WhatsAppMessage | null>>;
  setEditing: React.Dispatch<React.SetStateAction<WhatsAppMessage | null>>;
  setHasMoreMsgs: React.Dispatch<React.SetStateAction<boolean>>;
  oldestTsRef: React.MutableRefObject<string | null>;
}

export interface WaConversationActionsApi {
  handleReopen: () => Promise<void>;
  handleUnblock: () => Promise<void>;
  handleAccept: () => Promise<void>;
  handleAssume: () => Promise<void>;
  handleRelease: () => Promise<void>;
  muteSelected: (durationMs: number | null, label: string) => Promise<void>;
  unmuteSelected: () => Promise<void>;
  handleClearConversation: () => Promise<void>;
  handleToggleAbsenceSuppressed: () => Promise<void>;
  /**
   * Alterna a guarda jurídica. Remover não pede motivo (aplica direto); ativar
   * abre o modal de motivo (`legalHoldModalOpen`) — sem `prompt()` nativo.
   */
  handleToggleLegalHold: () => void;
  /** Estado do modal de motivo da guarda jurídica (exibido só ao ativar). */
  legalHoldModalOpen: boolean;
  /** Confirma a ativação com um motivo opcional e fecha o modal. */
  confirmLegalHold: (reason?: string) => void;
  /** Fecha o modal de guarda jurídica sem ativar. */
  closeLegalHoldModal: () => void;
}

/**
 * Encapsula as ações de atendimento/governança da conversa selecionada. Cada
 * ação muta no serviço e atualiza a lista de conversas de forma otimista,
 * preservando o comportamento (toasts, confirmações, abort de IA ao assumir,
 * apresentação automática ao aceitar) que vivia inline no WhatsAppModule.
 */
export function useWaConversationActions({
  selected, user, agentPrefs, staffById, aiSession, confirm,
  setConversations, refreshMessages, closeMuteMenu,
  setMessages, setPending, setReplyTo, setEditing, setHasMoreMsgs, oldestTsRef,
}: WaConversationActionsArgs): WaConversationActionsApi {
  const toast = useToastContext();

  const handleReopen = useCallback(async () => {
    if (!selected) return;
    try {
      await whatsappService.reopenConversation(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, status: 'open', reopened_at: new Date().toISOString(), closed_at: null } : c));
    } catch (e: any) { toast.error('Falha ao reabrir', e.message); }
  }, [selected, toast, setConversations]);

  const handleUnblock = useCallback(async () => {
    if (!selected) return;
    if (!await confirm({ title: 'Desbloquear contato', message: 'Ele voltará ao fluxo normal de atendimento.', confirmLabel: 'Desbloquear' })) return;
    try {
      await whatsappService.unblockContact(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null } : c));
    } catch (e: any) { toast.error('Falha ao desbloquear', e.message); }
  }, [selected, confirm, toast, setConversations]);

  // Aceitar a transferência pendente: assume o atendimento, apresenta o novo
  // responsável ao cliente e limpa o alerta.
  const handleAccept = useCallback(async () => {
    if (!selected) return;
    try {
      await whatsappService.acceptTransfer(selected.id);
      // Apresentação automática do responsável ao cliente (best-effort).
      const me = user ? staffById.get(user.id) : null;
      if (me && !selected.is_blocked) {
        try {
          const text = buildAcceptPresentation({ ...me, name: agentPrefs.short_name || me.name });
          // Resiliente: canal fora → apresentação retida para reenvio automático.
          await sendTextResilient({ conversationId: selected.id, channelId: selected.instance_id, text });
          await refreshMessages(selected.id);
        } catch { /* apresentação é best-effort; o aceite já valeu */ }
      }
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, awaiting_accept: false, transfer_pending_since: null,
            assigned_user_id: c.assigned_user_id || (user?.id ?? null) } : c));
    } catch (e: any) { toast.error('Falha ao aceitar', e.message); }
  }, [selected, user, agentPrefs, staffById, refreshMessages, toast, setConversations]);

  // Assumir o atendimento direto da fila (sem transferência): vira responsável.
  const handleAssume = useCallback(async () => {
    if (!selected || !user?.id) return;
    try {
      await whatsappService.assumeConversation(selected.id);
      // Fase J: abortar sessão de IA quando agente humano assume
      if (aiSession?.status === 'active') {
        await whatsappService.abortAiSession(selected.id).catch(() => {});
      }
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, assigned_user_id: user.id, awaiting_accept: false, transfer_pending_since: null } : c));
    } catch (e: any) { toast.error('Falha ao assumir', e.message); }
  }, [selected, user?.id, toast, aiSession, setConversations]);

  // Devolver a conversa para a fila do setor: remove o responsável.
  const handleRelease = useCallback(async () => {
    if (!selected) return;
    if (!await confirm({ title: 'Devolver à fila', message: 'Você deixará de ser o responsável por este atendimento.', confirmLabel: 'Devolver' })) return;
    try {
      await whatsappService.releaseToQueue(selected.id);
      setConversations(prev => prev.map(c => c.id === selected.id
        ? { ...c, assigned_user_id: null, awaiting_accept: false, transfer_pending_since: null } : c));
    } catch (e: any) { toast.error('Falha ao devolver à fila', e.message); }
  }, [selected, confirm, toast, setConversations]);

  // ── Silenciar / reativar conversa (notificações), por usuário ──
  const muteSelected = useCallback(async (durationMs: number | null, label: string) => {
    if (!selected) return;
    closeMuteMenu();
    const until = durationMs === null ? null : new Date(Date.now() + durationMs).toISOString();
    muteStore.setLocal(selected.id, until); // otimista
    try {
      await whatsappService.muteConversation(selected.id, until);
      toast.success(durationMs === null ? 'Conversa silenciada' : `Silenciada por ${label}`);
    } catch (e: any) {
      muteStore.setLocal(selected.id, undefined); // reverte
      toast.error('Não foi possível silenciar', e.message);
    }
  }, [selected, toast, closeMuteMenu]);

  const unmuteSelected = useCallback(async () => {
    if (!selected) return;
    const prev = muteStore.mutedUntil(selected.id);
    muteStore.setLocal(selected.id, undefined); // otimista
    try {
      await whatsappService.unmuteConversation(selected.id);
      toast.success('Som reativado');
    } catch (e: any) {
      muteStore.setLocal(selected.id, prev); // reverte
      toast.error('Falha ao reativar o som', e.message);
    }
  }, [selected, toast]);

  // Limpa a conversa (apaga as mensagens da thread; a conversa fica na lista).
  // Destrutivo e vale para toda a equipe → confirmação de perigo. Bloqueado sob
  // guarda jurídica (preserva evidência, igual à política de retenção).
  const handleClearConversation = useCallback(async () => {
    if (!selected) return;
    if (selected.legal_hold) {
      toast.error('Conversa sob guarda jurídica', 'Remova a guarda antes de limpar a conversa.');
      return;
    }
    if (!await confirm({
      title: 'Limpar conversa',
      message: 'Todas as mensagens desta conversa serão apagadas para toda a equipe. A conversa continua na lista. Esta ação não pode ser desfeita.',
      confirmLabel: 'Limpar conversa',
      tone: 'danger',
    })) return;
    try {
      await whatsappService.clearConversation(selected.id);
      setMessages([]); setPending([]); setReplyTo(null); setEditing(null);
      setHasMoreMsgs(false); oldestTsRef.current = null;
      setConversations(prev => prev.map(c =>
        c.id === selected.id ? { ...c, last_message_preview: null, unread_count: 0 } : c
      ));
      toast.success('Conversa limpa.');
    } catch (e: any) {
      toast.error('Falha ao limpar conversa', e.message);
    }
  }, [selected, confirm, toast, setMessages, setPending, setReplyTo, setEditing, setHasMoreMsgs, oldestTsRef, setConversations]);

  // Pausa/retoma a mensagem automática de ausência (fora do horário comercial)
  // SÓ para esta conversa. Pensado para um atendimento que segue fora do horário:
  // pausa o aviso comercial até encerrar; ao encerrar, o closeConversation limpa o
  // flag e a limitação volta sozinha no próximo contato.
  const handleToggleAbsenceSuppressed = useCallback(async () => {
    if (!selected) return;
    const next = !selected.absence_suppressed;
    try {
      await whatsappService.setAbsenceSuppressed(selected.id, next);
      setConversations(prev => prev.map(c =>
        c.id === selected.id ? { ...c, absence_suppressed: next } : c
      ));
      toast.success(next
        ? 'Aviso fora do horário pausado para esta conversa.'
        : 'Aviso fora do horário reativado.');
    } catch (e: any) {
      toast.error('Falha ao atualizar aviso de horário', e.message);
    }
  }, [selected, toast, setConversations]);

  // Estado do modal de motivo (só ao ATIVAR a guarda). Vive no hook para manter a
  // governança da conversa coesa — antes o motivo vinha de um prompt() nativo.
  const [legalHoldModalOpen, setLegalHoldModalOpen] = useState(false);

  const applyLegalHold = useCallback(async (newHold: boolean, reason?: string) => {
    if (!selected) return;
    try {
      await whatsappService.setLegalHold(selected.id, newHold, reason);
      setConversations(prev => prev.map(c =>
        c.id === selected.id
          ? { ...c, legal_hold: newHold, legal_hold_reason: reason ?? null }
          : c
      ));
      toast.success(newHold ? 'Guarda jurídica ativada.' : 'Guarda jurídica removida.');
    } catch (e: any) {
      toast.error('Falha ao atualizar guarda jurídica', e.message);
    }
  }, [selected, toast, setConversations]);

  const handleToggleLegalHold = useCallback(() => {
    if (!selected) return;
    if (selected.legal_hold) void applyLegalHold(false); // remover não pede motivo
    else setLegalHoldModalOpen(true);                    // ativar → modal de motivo opcional
  }, [selected, applyLegalHold]);

  const confirmLegalHold = useCallback((reason?: string) => {
    setLegalHoldModalOpen(false);
    void applyLegalHold(true, reason);
  }, [applyLegalHold]);

  const closeLegalHoldModal = useCallback(() => setLegalHoldModalOpen(false), []);

  return {
    handleReopen, handleUnblock, handleAccept, handleAssume, handleRelease,
    muteSelected, unmuteSelected, handleClearConversation,
    handleToggleAbsenceSuppressed, handleToggleLegalHold,
    legalHoldModalOpen, confirmLegalHold, closeLegalHoldModal,
  };
}
