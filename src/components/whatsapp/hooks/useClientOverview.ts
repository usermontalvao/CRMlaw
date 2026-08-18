// Domínio "Cliente 360" do módulo WhatsApp: pacote de overview do cliente da
// conversa aberta + status de documentos/assinaturas por cliente (chips da lista
// e do cabeçalho), em tempo real. Extraído do WhatsAppModule para isolar os
// carregamentos auxiliares ligados ao cliente.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * Estado das solicitações de documentos por cliente, SEM a dispensa visual do
   * aviso. É a fonte das automações de funil; a tela usa `effectiveDocStatus`.
   */
  docStatusByClient: Record<string, 'awaiting' | 'ready'>;
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
  /** Telefone do contato da conversa aberta. Sem cliente vinculado ele é a
   *  ÚNICA chave que liga a conversa às assinaturas em andamento. */
  selectedPhone: string | null = null,
): ClientOverviewApi {
  const toast = useToastContext();

  // Pacote 360 do cliente carregado uma vez ao abrir a conversa (Fase 10).
  const [overview, setOverview] = useState<ClientOverview | null>(null);
  // Recarrega o pacote 360 sob demanda (ex.: após criar uma solicitação de documento).
  // Sem cliente vinculado ainda há o que acompanhar: as assinaturas enviadas
  // para o telefone do contato. Antes, a conversa sem cadastro devolvia `null`
  // e o painel de assinaturas nem aparecia — não dava para saber se a pessoa
  // tinha aberto ou assinado o documento.
  const loadOverview = useCallback((): Promise<ClientOverview> | null => {
    if (selectedClientId) return whatsappService.getClientOverview(selectedClientId);
    if (selectedPhone) {
      return whatsappService.listSignaturesByContactPhone(selectedPhone)
        .then(signatures => ({ ...EMPTY_OVERVIEW, signatures }));
    }
    return null;
  }, [selectedClientId, selectedPhone]);

  const reloadOverview = useCallback(() => {
    const promise = loadOverview();
    if (!promise) { setOverview(null); return; }
    promise.then(setOverview).catch(() => setOverview({ ...EMPTY_OVERVIEW }));
  }, [loadOverview]);

  useEffect(() => {
    const promise = loadOverview();
    if (!promise) { setOverview(null); return; }
    let alive = true;
    setOverview(null);
    promise
      .then(o => { if (alive) setOverview(o); })
      .catch(() => { if (alive) setOverview({ ...EMPTY_OVERVIEW }); });
    return () => { alive = false; };
  }, [loadOverview]);

  /**
   * Revalidação de fundo do pacote 360 da conversa aberta.
   *
   * Corrigido o motivo que estava escrito aqui: dizia que os heartbeats de
   * presença (`opened_at`/`last_seen_at` do link e do signatário) não disparam
   * realtime. Disparam — `signature_requests`, `signature_signers` e
   * `template_fill_links` estão na publicação `supabase_realtime` e o canal
   * `wa-signatures` ouve as três com `event: '*'`, então toda batida de presença
   * já chega por lá e chama `reloadOverview`. A cada 12 segundos isto era, para
   * assinaturas e documentos, uma releitura completa do pacote sem nada novo.
   *
   * O que sobra de motivo REAL é o resto do pacote: processos, prazos,
   * compromissos, requerimentos e acordos não têm realtime nenhum aqui. Alguém
   * cadastrar um prazo noutra tela precisa aparecer no painel sem o atendente
   * ter de trocar de conversa e voltar. Para isso, um minuto basta.
   */
  useEffect(() => {
    if (!selectedClientId && !selectedPhone) return;
    const id = window.setInterval(() => {
      // Aba escondida não tem ninguém olhando. Sem esta guarda, um CRM deixado
      // aberto de um dia para o outro seguia relendo o pacote a noite inteira.
      if (document.visibilityState !== 'visible') return;
      reloadOverview();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [selectedClientId, selectedPhone, reloadOverview]);

  // ── Status de documentos por cliente (chips de lista/cabeçalho), em tempo real ──
  const [docStatusByClient, setDocStatusByClient] = useState<Record<string, 'awaiting' | 'ready'>>({});
  const [trackedSignatureStatusByClient, setTrackedSignatureStatusByClient] = useState<Record<string, ClientTrackedSignatureStatus>>({});
  /**
   * Ids de cliente da lista, com identidade ESTÁVEL enquanto o conjunto não muda.
   *
   * `conversations` é recriado a cada evento de realtime — toda mensagem que
   * chega, todo `delivered`, todo `read`. Um `useMemo` comum devolveria um array
   * novo em cada um deles, e como este array alimenta `loadDocStatus` e
   * `loadTrackedSignatureStatus`, tudo que dependia deles reagia junto: as duas
   * consultas saíam de novo E os canais `wa-docreqs`/`wa-signatures` eram
   * derrubados e reabertos. Era a origem das rajadas idênticas de
   * `document_requests`, `signature_requests`, `signature_signers` e
   * `template_fill_links` nos logs da API.
   *
   * O conteúdo é que decide: mesma lista de clientes, mesma referência.
   */
  const convClientIdsRef = useRef<string[]>([]);
  const convClientIds = useMemo(() => {
    const proximo = Array.from(
      new Set(conversations.map(c => c.client_id).filter(Boolean) as string[]),
    ).sort();
    const anterior = convClientIdsRef.current;
    if (anterior.length === proximo.length && anterior.every((id, i) => id === proximo[i])) {
      return anterior;
    }
    convClientIdsRef.current = proximo;
    return proximo;
  }, [conversations]);
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
  /**
   * Expiração do "está na página agora".
   *
   * Este é o único tique que o realtime NÃO pode substituir, e o motivo é sutil:
   * o sinal aqui é a AUSÊNCIA de evento. A presença ativa é calculada por uma
   * janela de tempo no momento da consulta, então "Assinatura aberta" só apaga
   * quando alguém repara que não chega batida de presença há tempo demais — e
   * ninguém emite um evento dizendo "parei de olhar a página".
   *
   * O que dá para evitar é rodar isso à toa, que era o caso:
   *  · sem nada em acompanhamento não há badge para expirar. Uma assinatura nova
   *    chega por realtime (`wa-signatures`), então não se perde nada esperando;
   *  · aba escondida não tem ninguém para ver o badge apagar.
   */
  const trackedRef = useRef(trackedSignatureStatusByClient);
  trackedRef.current = trackedSignatureStatusByClient;
  useEffect(() => {
    if (convClientIds.length === 0) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Object.keys(trackedRef.current).length === 0) return;
      loadTrackedSignatureStatus();
    }, 12_000);
    return () => window.clearInterval(id);
  }, [convClientIds.length, loadTrackedSignatureStatus]);

  /**
   * Volta da aba escondida: repõe na hora o que os tiques deixaram de fazer
   * enquanto ninguém olhava. É o que torna a pausa acima invisível — quem volta
   * encontra o painel atualizado, sem esperar o próximo minuto.
   */
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      reloadOverview();
      loadTrackedSignatureStatus();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [reloadOverview, loadTrackedSignatureStatus]);

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
    // O mapa CRU sai junto do `effectiveDocStatus` porque a automação de funil
    // não pode obedecer à dispensa do aviso: "não quero mais ver este aviso" é
    // decisão de tela de um atendente, e não desfaz o fato de os documentos
    // terem chegado.
    docStatusByClient,
    effectiveDocStatus, trackedSignatureStatus, effectiveConversationStatus,
    dismissDocReady, stopTemplateFillTracking, stopSignatureTracking,
  };
}
