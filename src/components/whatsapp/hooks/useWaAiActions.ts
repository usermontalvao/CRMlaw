// Domínio de IA/análise da conversa do WhatsApp: sugestão de resposta,
// classificação do assunto e extração de dados estruturados — além da exportação
// do histórico em .txt (análise/saída da conversa). Extraído do WhatsAppModule
// para isolar as chamadas ao aiService e os helpers de construção de contexto da
// UI. É a fonte de `handleAiClassify`, injetado no useWaOperationalModals (ao
// encerrar a conversa), por isso vive ANTES dele na ordem de hooks.
import { useEffect, useState } from 'react';
import { whatsappService, type ClientOverview } from '../../../services/whatsapp.service';
import { aiService } from '../../../services/ai.service';
import { prettyPhone } from '../format';
import { useToastContext } from '../../../contexts/ToastContext';
import type { WhatsAppConversation, WhatsAppMessage } from '../../../types/whatsapp.types';

interface WaAiActionsArgs {
  selectedId: string | null;
  selected: WhatsAppConversation | null;
  messages: WhatsAppMessage[];
  overview: ClientOverview | null;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  loadConversations: () => Promise<void>;
}

export interface WaAiActionsApi {
  suggesting: boolean;
  extracting: boolean;
  extractedData: Record<string, string> | null;
  handleSuggestReply: () => Promise<void>;
  handleAiClassify: () => Promise<void>;
  handleExtractData: () => Promise<void>;
  handleExportConversation: () => void;
}

/**
 * Concentra as ações de IA sobre a conversa selecionada (sugerir resposta,
 * classificar assunto, extrair dados) e a exportação do histórico. Mantém o
 * comportamento exato (guardas de estado, toasts, reset dos dados extraídos ao
 * trocar de conversa) que vivia inline no WhatsAppModule.
 */
export function useWaAiActions({
  selectedId, selected, messages, overview, setDraft, loadConversations,
}: WaAiActionsArgs): WaAiActionsApi {
  const toast = useToastContext();

  const [suggesting, setSuggesting] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [extractedData, setExtractedData] = useState<Record<string, string> | null>(null);
  const [extracting, setExtracting] = useState(false);

  // Limpar dados extraídos ao trocar de conversa.
  useEffect(() => { setExtractedData(null); }, [selectedId]);

  // ── Fase K: helpers de texto para chamadas de IA ────────────────────────────
  const buildRecentText = (limit = 15) =>
    [...messages].slice(-limit)
      .map(m => `${m.direction === 'out' ? 'Agente' : 'Cliente'}: ${(m.content || m.transcription_text || '[mídia]').slice(0, 300)}`)
      .join('\n');

  const buildClientContext = () => {
    if (!overview) return selected?.contact_name ? `Cliente: ${selected.contact_name}` : 'Sem dados do cliente disponíveis.';
    const lines: string[] = [];
    if (selected?.contact_name) lines.push(`Cliente: ${selected.contact_name}`);
    if (overview.processes?.length) {
      lines.push(`Processos ativos: ${overview.processes.length}`);
      const urgent = overview.processes.filter((p: any) => p.priority === 'urgente');
      if (urgent.length) lines.push(`Urgentes: ${urgent.length}`);
    }
    const pendSig = overview.signatures?.filter((s: any) => s.status === 'pending').length ?? 0;
    if (pendSig > 0) lines.push(`Assinaturas pendentes: ${pendSig}`);
    return lines.join(' | ') || 'Cliente vinculado, sem dados adicionais.';
  };

  const handleSuggestReply = async () => {
    if (!selected || suggesting || messages.length < 1) return;
    setSuggesting(true);
    try {
      const suggestion = await aiService.suggestReply(buildRecentText(), buildClientContext());
      if (suggestion) setDraft(suggestion);
      else toast.error('IA', 'Não foi possível gerar sugestão.');
    } catch {
      toast.error('IA', 'Erro ao sugerir resposta.');
    } finally { setSuggesting(false); }
  };

  const handleAiClassify = async () => {
    if (!selected || classifying || messages.length < 1) return;
    setClassifying(true);
    try {
      const subject = await aiService.classifySubject(buildRecentText(10));
      if (subject) {
        await whatsappService.setContactReason(selected.id, subject);
        loadConversations();
      } else {
        toast.error('IA', 'Não foi possível classificar o assunto.');
      }
    } catch {
      toast.error('IA', 'Erro ao classificar assunto.');
    } finally { setClassifying(false); }
  };

  const handleExtractData = async () => {
    if (!selected || extracting || messages.length < 2) return;
    setExtracting(true);
    try {
      const data = await aiService.extractContactData(buildRecentText(20));
      setExtractedData(Object.keys(data).length > 0 ? data : {});
    } catch {
      toast.error('IA', 'Erro ao extrair dados.');
    } finally { setExtracting(false); }
  };

  // ── Fase L: exportação do histórico da conversa (.txt) ──────────────────────
  const handleExportConversation = () => {
    if (!selected || messages.length === 0) return;
    const header = [
      `Conversa WhatsApp — ${selected.contact_name || prettyPhone(selected.contact_phone)}`,
      `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
      selected.contact_reason ? `Assunto: ${selected.contact_reason}` : null,
      '─'.repeat(60),
    ].filter(Boolean).join('\n');

    const body = messages.map(m => {
      const who = m.direction === 'out' ? 'Equipe' : (selected.contact_name || selected.contact_phone);
      const when = m.wa_timestamp
        ? new Date(m.wa_timestamp).toLocaleString('pt-BR')
        : new Date(m.created_at).toLocaleString('pt-BR');
      const text = m.content || m.transcription_text
        ? (m.content || `[transcrição: ${m.transcription_text}]`)
        : `[${m.type}]`;
      return `[${when}] ${who}: ${text}`;
    }).join('\n');

    const blob = new Blob([`${header}\n\n${body}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversa-${(selected.contact_name || selected.contact_phone).replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    suggesting, extracting, extractedData,
    handleSuggestReply, handleAiClassify, handleExtractData, handleExportConversation,
  };
}
