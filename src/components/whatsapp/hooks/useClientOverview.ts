// Domínio "Cliente 360" do módulo WhatsApp: pacote de overview do cliente da
// conversa aberta + status de documentos/assinaturas por cliente (chips da lista
// e do cabeçalho), em tempo real. Extraído do WhatsAppModule para isolar os
// carregamentos auxiliares ligados ao cliente.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  whatsappService,
  type ClientOverview,
  type ClientTrackedSignatureStatus,
} from '../../../services/whatsapp.service';
import { convStatus } from '../format';
import { useToastContext } from '../../../contexts/ToastContext';
import type { WhatsAppConversation, WhatsAppDirection } from '../../../types/whatsapp.types';

const EMPTY_OVERVIEW: ClientOverview = {
  processes: [], schedule: { deadlines: [], events: [] },
  pendings: { requirements: [], documents: [] },
  templateFillLinks: [], signatures: [], agreements: [],
};

const DISMISS_KEY = 'wa_dismissed_doc_ready';

/** Subconjunto de campos de conversa que `effectiveConversationStatus` precisa. */
type ConvStatusInput = {
  client_id?: string | null;
  is_blocked: boolean;
  status: string;
  last_message_direction: WhatsAppDirection | null;
  assigned_user_id?: string | null;
  department_id?: string | null;
  awaiting_accept?: boolean;
};

export interface ClientOverviewApi {
  overview: ClientOverview | null;
  setOverview: React.Dispatch<React.SetStateAction<ClientOverview | null>>;
  reloadOverview: () => void;
  effectiveDocStatus: (clientId: string | null | undefined) => 'awaiting' | 'ready' | null;
  trackedSignatureStatus: (clientId: string | null | undefined) => ClientTrackedSignatureStatus | null;
  effectiveConversationStatus: (c: ConvStatusInput) => ReturnType<typeof convStatus>;
  dismissDocReady: (clientId: string) => void;
  stopTemplateFillTracking: (linkId: string) => Promise<void>;
  stopSignatureTracking: (requestId: string) => Promise<void>;
}

/**
 * Gerencia o pacote 360 do cliente da conversa aberta e os status derivados de
 * documentos/assinaturas (com realtime + reavaliação periódica da presença).
 */
export function useClientOverview(
  selectedClientId: string | null,
  conversations: WhatsAppConversation[],
): ClientOverviewApi {
  const toast = useToastContext();

  // Pacote 360 do cliente carregado uma vez ao abrir a conversa (Fase 10).
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  // Recarrega o pacote 360 sob demanda (ex.: após criar uma solicitação de documento).
  const reloadOverview = useCallback(() => {
    if (!selectedClientId) { setOverview(null); return; }
    whatsappService.getClientOverview(selectedClientId)
      .then(setOverview)
      .catch(() => setOverview({ ...EMPTY_OVERVIEW }));
  }, [selectedClientId]);

  useEffect(() => {
    if (!selectedClientId) { setOverview(null); return; }
    let alive = true;
    setOverview(null);
    whatsappService.getClientOverview(selectedClientId)
      .then(o => { if (alive) setOverview(o); })
      .catch(() => { if (alive) setOverview({ ...EMPTY_OVERVIEW }); });
    return () => { alive = false; };
  }, [selectedClientId]);

  // Histórico do kit em tempo real: os heartbeats de presença (opened_at/
  // last_seen_at do link e do signatário) não disparam realtime de assinatura,
  // então revalidamos o overview periodicamente enquanto a conversa está aberta.
  useEffect(() => {
    if (!selectedClientId) return;
    const id = window.setInterval(() => reloadOverview(), 12_000);
    return () => window.clearInterval(id);
  }, [selectedClientId, reloadOverview]);

  // ── Status de documentos por cliente (chips de lista/cabeçalho), em tempo real ──
  const [docStatusByClient, setDocStatusByClient] = useState<Record<string, 'awaiting' | 'ready'>>({});
  const [trackedSignatureStatusByClient, setTrackedSignatureStatusByClient] = useState<Record<string, ClientTrackedSignatureStatus>>({});
  const convClientIds = useMemo(
    () => Array.from(new Set(conversations.map(c => c.client_id).filter(Boolean) as string[])),
    [conversations],
  );
  const loadDocStatus = useCallback(() => {
    if (convClientIds.length === 0) { setDocStatusByClient({}); return; }
    whatsappService.getDocStatusByClients(convClientIds).then(setDocStatusByClient).catch(() => {});
  }, [convClientIds]);
  useEffect(() => { loadDocStatus(); }, [loadDocStatus]);
  useEffect(() => {
    const unsub = whatsappService.subscribeDocRequests(() => { loadDocStatus(); reloadOverview(); });
    return unsub;
  }, [loadDocStatus, reloadOverview]);
  const loadTrackedSignatureStatus = useCallback(() => {
    if (convClientIds.length === 0) { setTrackedSignatureStatusByClient({}); return; }
    whatsappService.getTrackedSignatureStatusByClients(convClientIds).then(setTrackedSignatureStatusByClient).catch(() => {});
  }, [convClientIds]);
  const stopTemplateFillTracking = useCallback(async (linkId: string) => {
    try {
      await whatsappService.stopTemplateFillTracking(linkId);
      loadTrackedSignatureStatus();
      reloadOverview();
      toast.success('Acompanhamento do kit encerrado.');
    } catch (e: any) {
      toast.error('Falha ao encerrar acompanhamento', e?.message);
    }
  }, [loadTrackedSignatureStatus, reloadOverview, toast]);
  const stopSignatureTracking = useCallback(async (requestId: string) => {
    try {
      await whatsappService.stopSignatureTracking(requestId);
      setOverview(prev => prev ? {
        ...prev,
        signatures: prev.signatures.map(sig => sig.id === requestId ? ({ ...sig, wa_tracking_stopped: true } as any) : sig),
      } : prev);
      loadTrackedSignatureStatus();
      reloadOverview();
      toast.success('Acompanhamento da assinatura encerrado.');
    } catch (e: any) {
      toast.error('Falha ao encerrar acompanhamento', e?.message);
    }
  }, [loadTrackedSignatureStatus, reloadOverview, toast]);
  useEffect(() => { loadTrackedSignatureStatus(); }, [loadTrackedSignatureStatus]);
  useEffect(() => {
    const unsub = whatsappService.subscribeSignatures(() => { loadTrackedSignatureStatus(); reloadOverview(); });
    return unsub;
  }, [loadTrackedSignatureStatus, reloadOverview]);
  // A "presença ativa" (live) é calculada por janela de 45s no momento do fetch.
  // Este tick reavalia periodicamente para "Assinatura aberta" expirar sozinho.
  useEffect(() => {
    if (convClientIds.length === 0) return;
    const id = window.setInterval(() => loadTrackedSignatureStatus(), 12_000);
    return () => window.clearInterval(id);
  }, [convClientIds.length, loadTrackedSignatureStatus]);

  // ── Dispensar o aviso "Documentos prontos" por cliente (só visual). ──
  const [dismissedDocReady, setDismissedDocReady] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
  });
  const persistDismissed = (s: Set<string>) => {
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* storage indisponível */ }
  };
  const dismissDocReady = useCallback((clientId: string) => {
    setDismissedDocReady(prev => { const n = new Set(prev); n.add(clientId); persistDismissed(n); return n; });
    // Avisa outros painéis (ex.: DocumentRequestsTracker) para limpar os concluídos deste cliente.
    window.dispatchEvent(new CustomEvent('wa-doc-ready-dismissed', { detail: clientId }));
  }, []);
  // Poda: só remove a dispensa quando o cliente AINDA está no mapa mas deixou de
  // ser 'ready' (novo ciclo de documentos).
  useEffect(() => {
    if (Object.keys(docStatusByClient).length === 0) return; // ainda carregando
    setDismissedDocReady(prev => {
      let changed = false; const n = new Set(prev);
      for (const id of prev) { if ((id in docStatusByClient) && docStatusByClient[id] !== 'ready') { n.delete(id); changed = true; } }
      if (changed) persistDismissed(n);
      return changed ? n : prev;
    });
  }, [docStatusByClient]);
  // Status efetivo para exibição: oculta 'ready' já dispensado.
  const effectiveDocStatus = useCallback((clientId: string | null | undefined): 'awaiting' | 'ready' | null => {
    if (!clientId) return null;
    const st = docStatusByClient[clientId];
    if (!st) return null;
    if (st === 'ready' && dismissedDocReady.has(clientId)) return null;
    return st;
  }, [docStatusByClient, dismissedDocReady]);
  const trackedSignatureStatus = useCallback((clientId: string | null | undefined): ClientTrackedSignatureStatus | null => {
    if (!clientId) return null;
    return trackedSignatureStatusByClient[clientId] || null;
  }, [trackedSignatureStatusByClient]);
  const effectiveConversationStatus = useCallback((c: ConvStatusInput) => {
    const base = convStatus(c);
    // Estados terminais/duros nunca são sobrescritos pelo tracking.
    if (base.key === 'blocked' || base.key === 'closed') return base;
    const tracked = trackedSignatureStatus(c.client_id);
    if (tracked) {
      // Estado "forte": presença ativa AGORA (live) OU assinatura já existindo.
      const strong = tracked.live || tracked.kind.startsWith('signature_');
      if (strong) return { key: 'waiting_client' as const, label: tracked.label, cls: tracked.cls };
      // Estado "fraco" de kit pré-assinatura: não mascara mensagem pendente do cliente.
      if (base.key !== 'waiting_you' && base.key !== 'waiting_internal') {
        return { key: 'waiting_client' as const, label: tracked.label, cls: tracked.cls };
      }
    }
    return base;
  }, [trackedSignatureStatus]);

  return {
    overview, setOverview, reloadOverview,
    effectiveDocStatus, trackedSignatureStatus, effectiveConversationStatus,
    dismissDocReady, stopTemplateFillTracking, stopSignatureTracking,
  };
}
