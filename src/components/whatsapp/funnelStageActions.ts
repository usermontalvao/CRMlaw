import { whatsappService, renderTemplate, type StaffOption } from '../../services/whatsapp.service';
import { sendTextResilient } from '../../services/whatsapp/resilientSend';
import type {
  WhatsAppConversation, WhatsAppDepartment,
} from '../../types/whatsapp.types';
import { normalizeFunnelStageActions } from './funnelStageActionConfig';
import { leDestino, opcoesDeDestino, type FontesDeDestino } from './funnelTransferTargets';

export interface FunnelStageActionExecutionResult {
  completed: string[];
  errors: string[];
}

interface ExecuteFunnelStageActionsInput {
  conversation: WhatsAppConversation;
  actions: unknown;
  departments: WhatsAppDepartment[];
  staff: StaffOption[];
  /**
   * Vínculos do canal e dos setores. Ausentes, a checagem local afrouxa e quem
   * decide passa a ser só o banco (`wa_destination_can_access`, dentro de
   * `wa_transfer_contact_attendance`) — nunca o contrário.
   */
  channelMemberIds?: readonly string[];
  departmentMembers?: Readonly<Record<string, readonly string[]>>;
  /** `visibility_mode` do canal desta conversa. */
  channelVisibility?: string | null;
  /** Nome do canal e da etapa, para as variáveis `{{canal.nome}}` e `{{etapa.nome}}`. */
  channelName?: string | null;
  stageLabel?: string | null;
}

/**
 * Executa somente a lista salva pela etapa que recebeu o card. Cada ação é
 * isolada: uma falha externa não desfaz a troca de etapa nem repete uma mensagem
 * que talvez já tenha sido entregue.
 */
export async function executeFunnelStageActions({
  conversation, actions: rawActions, departments, staff,
  channelMemberIds, departmentMembers, channelVisibility, channelName, stageLabel,
}: ExecuteFunnelStageActionsInput): Promise<FunnelStageActionExecutionResult> {
  const actions = normalizeFunnelStageActions(rawActions);
  const result: FunnelStageActionExecutionResult = { completed: [], errors: [] };

  const fontes: FontesDeDestino = {
    canal: conversation.instance_id
      ? { id: conversation.instance_id, visibility_mode: channelVisibility ?? null }
      : null,
    setores: departments,
    pessoas: staff,
    membrosPorSetor: departmentMembers ?? {},
    membrosDoCanal: channelMemberIds ?? [],
  };

  // As variáveis que NÃO dependem do destino saem uma vez só, do estado atual da
  // conversa — nunca do retrato salvo na ação.
  const setorDeOrigem = departments.find(item => item.id === conversation.department_id)?.name || '';
  const responsavel = staff.find(item => item.user_id === conversation.assigned_user_id)?.name || '';

  for (const action of actions) {
    try {
      if (action.type === 'send_message') {
        if (!action.message) throw new Error('mensagem não configurada');
        if (conversation.is_blocked) throw new Error('contato bloqueado');
        const text = renderTemplate(action.message, {
          clientName: conversation.contact_name,
          clientPhone: conversation.contact_phone,
          agentName: responsavel,
          extraVars: {
            'setor.origem': setorDeOrigem,
            'etapa.nome': stageLabel || '',
            'canal.nome': channelName || '',
          },
        });
        await sendTextResilient({
          conversationId: conversation.id,
          channelId: conversation.instance_id,
          text,
          automated: true,
        });
        result.completed.push('mensagem enviada');
        continue;
      }

      if (action.type === 'transfer_to_department' || action.type === 'transfer_to_user') {
        // O id é a fonte da verdade; o nome é relido do cadastro ATUAL. Um setor
        // renomeado depois de a etapa ser salva avisava o cliente com o nome
        // velho, porque a mensagem saía do retrato guardado no `payload`.
        const destino = leDestino(action);
        if (!destino.id) throw new Error('destino não configurado');

        const opcao = opcoesDeDestino(destino.kind, fontes).find(item => item.id === destino.id);
        if (!opcao) {
          throw new Error(destino.kind === 'department'
            ? `setor de destino${destino.nome ? ` “${destino.nome}”` : ''} não existe mais`
            : `pessoa de destino${destino.nome ? ` “${destino.nome}”` : ''} não existe mais`);
        }
        if (opcao.indisponivel === 'inativo') throw new Error(`“${opcao.name}” está desativado`);
        if (opcao.indisponivel === 'sem-membros') throw new Error(`“${opcao.name}” não tem nenhum atendente`);
        if (opcao.indisponivel === 'sem-acesso-ao-canal') throw new Error(`“${opcao.name}” não tem acesso a este canal`);

        const paraSetor = destino.kind === 'department';
        const nota = action.payload?.note
          ? renderTemplate(action.payload.note, {
            clientName: conversation.contact_name,
            clientPhone: conversation.contact_phone,
            agentName: responsavel,
            extraVars: {
              destino: opcao.name,
              setor: paraSetor ? opcao.name : '',
              'setor.origem': setorDeOrigem,
              'etapa.nome': stageLabel || '',
              'canal.nome': channelName || '',
            },
          })
          : 'Transferência automática pelo funil';

        // A RPC revalida tudo do lado do banco: quem transfere, se o destino
        // existe, se está ativo e se enxerga o canal. Se ela recusar, a mensagem
        // ao cliente não chega a sair — o `await` está antes de propósito.
        await whatsappService.transferConversation({
          conversationId: conversation.id,
          ...(paraSetor ? { toDepartmentId: opcao.id, toUserId: null } : { toUserId: opcao.id }),
          note: nota,
        });

        if (action.message && !conversation.is_blocked) {
          const text = renderTemplate(action.message, {
            clientName: conversation.contact_name,
            clientPhone: conversation.contact_phone,
            agentName: responsavel,
            extraVars: {
              destino: opcao.name,
              setor: paraSetor ? opcao.name : '',
              'setor.origem': setorDeOrigem,
              'etapa.nome': stageLabel || '',
              'canal.nome': channelName || '',
            },
          });
          await sendTextResilient({
            conversationId: conversation.id,
            channelId: conversation.instance_id,
            text,
            automated: true,
          });
        }
        result.completed.push(`transferido para ${opcao.name}`);
        continue;
      }

      if (action.type === 'close_conversation') {
        if (conversation.status === 'closed') {
          result.completed.push('atendimento já estava encerrado');
          continue;
        }
        await whatsappService.closeConversation(
          conversation.id,
          action.payload?.reason || 'Encerrado automaticamente pela etapa do funil',
          { farewell: action.message || undefined },
        );
        result.completed.push('atendimento encerrado');
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'erro desconhecido';
      result.errors.push(`${action.type}: ${detail}`);
    }
  }

  return result;
}
