// O Modo supervisão: qual é o meu papel NESTA conversa, e o que ele me deixa
// fazer agora.
//
// ── O PROBLEMA QUE ELE RESOLVE ────────────────────────────────────────────
//
// Antes, abrir a conversa de um colega já era intervir: o contador de não
// lidas dele zerava, a pendência sumia da tela de quem tinha de agir, e
// responder tomava o atendimento sem perguntar. Supervisionar e atropelar eram
// o mesmo gesto — e quem quisesse só conferir precisava escolher entre não
// olhar ou estragar a fila de outra pessoa.
//
// Agora quem chega como supervisor entra em "Apenas acompanhar", e trocar de
// modo é explícito. A trava continua sendo do banco (`wa_can_manage_conv`,
// `wa_can_reply_conv`); aqui só se decide o que a tela oferece.
//
// ── DE ONDE VEM CADA CAMPO ────────────────────────────────────────────────
//
// `WaConversaResumo` mistura o que está na linha da conversa com três coisas
// que não estão nela e que mudam a resposta: se o canal é aberto, se o setor
// tem gente, e se existe um empréstimo ou uma transferência pendente para mim.
// Sem esses três, o espelho da tela discordaria do servidor exatamente nos
// casos em que a diferença aparece.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { whatsappService } from '../../../services/whatsapp.service';
import {
  type WaConversaResumo,
  type WaModoSupervisao,
} from '../../../services/whatsapp/waPermissions';
import type {
  WhatsAppChannel,
  WhatsAppConversation,
} from '../../../types/whatsapp.types';
import { useWaPermissoes, type PermissoesDaConversa } from './useWaPermissions';

export interface UseWaSupervisionArgs {
  selected: WhatsAppConversation | null;
  channels: readonly WhatsAppChannel[];
  /** Mapa setor → ids dos membros (o módulo já carrega isto). */
  departmentMembers: Record<string, string[]>;
}

export interface WaSupervision extends PermissoesDaConversa {
  modo: WaModoSupervisao;
  setModo: (modo: WaModoSupervisao) => void;
  /** O recorte que alimenta as regras — exposto para reuso na lista. */
  resumo: WaConversaResumo | null;
  /** Recarrega empréstimos e convites (depois de aceitar, recusar, emprestar). */
  recarregar: () => void;
}

export function useWaSupervision(
  { selected, channels, departmentMembers }: UseWaSupervisionArgs,
): WaSupervision {
  const [colaboracoes, setColaboracoes] = useState<string[]>([]);
  const [convitesParaMim, setConvitesParaMim] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<WaModoSupervisao>('acompanhar');
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(() => setVersao(v => v + 1), []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [empresta, convites] = await Promise.all([
        whatsappService.listMyCollaborations().catch(() => [] as string[]),
        whatsappService.listMyPendingTransfers().catch(() => []),
      ]);
      if (!vivo) return;
      setColaboracoes(empresta);
      setConvitesParaMim(new Set(convites.map(t => t.conversationId)));
    })();
    return () => { vivo = false; };
  }, [versao]);

  // Trocar de conversa volta para "Apenas acompanhar". O modo é uma decisão
  // sobre AQUELE atendimento; carregá-lo para o próximo faria o supervisor
  // responder na conversa errada achando que ainda estava só olhando.
  useEffect(() => { setModo('acompanhar'); }, [selected?.id]);

  const resumo = useMemo<WaConversaResumo | null>(() => {
    if (!selected) return null;
    const canal = channels.find(c => c.id === selected.instance_id);
    const membrosDoSetor = selected.department_id
      ? (departmentMembers[selected.department_id] ?? [])
      : [];
    return {
      id: selected.id,
      instanceId: selected.instance_id ?? null,
      departmentId: selected.department_id ?? null,
      assignedUserId: selected.assigned_user_id ?? null,
      status: selected.status,
      awaitingAccept: selected.awaiting_accept ?? null,
      canalAberto: (canal as { visibility_mode?: string } | undefined)?.visibility_mode === 'all',
      setorTemMembros: membrosDoSetor.length > 0,
      souColaborador: colaboracoes.includes(selected.id),
      transferenciaPendenteParaMim: convitesParaMim.has(selected.id),
      // "Eu transferi e ainda não aceitaram": a conversa saiu do meu nome mas
      // continua sendo minha responsabilidade até alguém aceitar.
      transferenciaPendenteMinha: !!selected.awaiting_accept && !convitesParaMim.has(selected.id),
    };
  }, [selected, channels, departmentMembers, colaboracoes, convitesParaMim]);

  const permissoes = useWaPermissoes(resumo, modo);

  return { ...permissoes, modo, setModo, resumo, recarregar };
}
