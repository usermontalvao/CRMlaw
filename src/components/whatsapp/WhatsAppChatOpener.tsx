// Quem atende os pedidos de "conversar no WhatsApp" vindos do CRM inteiro.
//
// Mora no App, montado uma vez, ao lado do host dos avisos. Não desenha nada:
// é só a ponte entre o botão verde que a pessoa clicou (na ficha do cliente, no
// lead, no requerimento, na assinatura, na agenda, na busca global, na nuvem) e
// a conversa aberta no widget flutuante.
//
// Três decisões moram aqui, e todas as três já existiam espalhadas antes:
//
//  · POR QUAL NÚMERO. O canal preferido de quem atende (o mesmo do painel
//    "Nova conversa"), caindo no primeiro conectado quando ele não serve. A
//    lista vem do banco e já respeita as policies de visibilidade de canais —
//    ninguém abre conversa por um número que não é seu.
//
//  · QUAL THREAD. `openConversation` é idempotente: quem já tem conversa com
//    aquele número cai nela (reaberta, se estava encerrada). Clicar duas vezes
//    não duplica nada.
//
//  · ONDE MOSTRAR. Isto o App decide, porque só ele sabe em que módulo a
//    pessoa está — dentro do WhatsApp a inbox já está na tela, e navegar é o
//    certo; em qualquer outro lugar o widget sobe por cima sem trocar a tela.
//
// E o plano B: sem permissão, sem canal conectado ou com erro no meio, o clique
// vira o link de sempre para o `wa.me`. A abertura interna é uma melhora, não
// uma porta que pode ficar trancada sem saída.
import React, { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToastContext } from '../../contexts/ToastContext';
import { usePermissions } from '../../hooks/usePermissions';
import { events, SYSTEM_EVENTS } from '../../utils/events';
import { setWhatsAppChatReady, type WhatsAppChatPayload } from '../../utils/whatsappChat';
import { whatsappService } from '../../services/whatsapp.service';
import { settingsService, type WhatsAppChannelDepartmentRouting } from '../../services/settings.service';
import { pickInitialChannel, readPreferredChannel } from './preferredChannel';
import type { WhatsAppChannel } from '../../types/whatsapp.types';

interface WhatsAppChatOpenerProps {
  /**
   * Onde mostrar a conversa já resolvida. `draft` é o texto que deve entrar
   * escrito no compositor (modelos de requerimento, convite de assinatura).
   */
  onOpen: (conversationId: string, draft?: string) => void;
}

export const WhatsAppChatOpener: React.FC<WhatsAppChatOpenerProps> = ({ onOpen }) => {
  const { user } = useAuth();
  const toast = useToastContext();
  const { canView, isAdmin, loading: permLoading } = usePermissions();
  const hasAccess = !!user && (isAdmin || (!permLoading && canView('whatsapp')));

  const channelsRef = useRef<WhatsAppChannel[]>([]);
  const routingRef = useRef<WhatsAppChannelDepartmentRouting[]>([]);
  // Um pedido por vez: dois cliques seguidos no mesmo botão abririam a mesma
  // conversa duas vezes, e a segunda chegaria depois da tela já ter mudado.
  const busyRef = useRef(false);

  /**
   * Relê os canais e publica se dá para assumir os cliques.
   *
   * O status importa e muda sozinho (canal cai, reconecta): sem esta releitura
   * o botão continuaria prometendo abrir por dentro depois que o último número
   * saiu do ar — e o clique acabaria no toast de erro em vez do wa.me.
   */
  const refresh = useCallback(async () => {
    if (!hasAccess) { channelsRef.current = []; setWhatsAppChatReady(false); return; }
    try {
      const list = await whatsappService.listChannels();
      channelsRef.current = list;
      setWhatsAppChatReady(list.some(c => c.status === 'connected'));
    } catch {
      channelsRef.current = [];
      setWhatsAppChatReady(false);
    }
  }, [hasAccess]);

  useEffect(() => {
    void refresh();
    if (!hasAccess) return;
    settingsService.getWhatsAppChannelDepartmentRouting()
      .then(list => { routingRef.current = list; })
      .catch(() => {});
    // Voltar para a aba é o momento em que a informação está mais velha — e é
    // logo antes do próximo clique.
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [hasAccess, refresh]);

  // Desmontando (logout, tela pública), ninguém está ouvindo: os botões voltam
  // a ser links para fora em vez de emitirem um evento no vazio.
  useEffect(() => () => setWhatsAppChatReady(false), []);

  useEffect(() => {
    if (!hasAccess) return;
    const unsub = events.on(SYSTEM_EVENTS.WHATSAPP_OPEN_CHAT, (payload?: WhatsAppChatPayload) => {
      const phone = String(payload?.phone ?? '').trim();
      if (!phone || busyRef.current) return;
      // O aviso de fracasso vai junto do plano B: o widget já subiu com o
      // esqueleto no instante do clique e precisa saber que pode descê-lo.
      const fallback = () => {
        events.emit(SYSTEM_EVENTS.WHATSAPP_OPEN_CHAT_FAILED, { phone });
        if (payload?.fallbackUrl) window.open(payload.fallbackUrl, '_blank', 'noopener');
      };

      const connected = channelsRef.current.filter(c => c.status === 'connected');
      const channelId = pickInitialChannel(readPreferredChannel(), connected.map(c => c.id));
      if (!channelId) {
        setWhatsAppChatReady(false);
        fallback();
        void refresh();
        return;
      }

      busyRef.current = true;
      void whatsappService.openConversation({
        phone,
        channelId,
        clientId: payload?.clientId ?? null,
        contactName: payload?.contactName ?? null,
        departmentId: routingRef.current.find(item => item.channel_id === channelId)?.default_department_id || null,
      })
        .then(({ conversation_id }) => onOpen(conversation_id, payload?.text))
        .catch((e: any) => {
          toast.error('Não foi possível abrir a conversa aqui', e?.message);
          fallback();
        })
        .finally(() => { busyRef.current = false; });
    });
    return () => unsub();
  }, [hasAccess, onOpen, refresh, toast]);

  return null;
};

export default WhatsAppChatOpener;
