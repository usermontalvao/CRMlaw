import { whatsappService, renderTemplate, type StaffOption } from '../../services/whatsapp.service';
import { sendTextResilient } from '../../services/whatsapp/resilientSend';
import type {
  WhatsAppConversation, WhatsAppDepartment,
} from '../../types/whatsapp.types';
import { normalizeFunnelStageActions } from './funnelStageActionConfig';

export interface FunnelStageActionExecutionResult {
  completed: string[];
  errors: string[];
}

interface ExecuteFunnelStageActionsInput {
  conversation: WhatsAppConversation;
  actions: unknown;
  departments: WhatsAppDepartment[];
  staff: StaffOption[];
}

/**
 * Executa somente a lista salva pela etapa que recebeu o card. Cada ação é
 * isolada: uma falha externa não desfaz a troca de etapa nem repete uma mensagem
 * que talvez já tenha sido entregue.
 */
export async function executeFunnelStageActions({
  conversation, actions: rawActions, departments, staff,
}: ExecuteFunnelStageActionsInput): Promise<FunnelStageActionExecutionResult> {
  const actions = normalizeFunnelStageActions(rawActions);
  const result: FunnelStageActionExecutionResult = { completed: [], errors: [] };

  for (const action of actions) {
    try {
      if (action.type === 'send_message') {
        if (!action.message) throw new Error('mensagem não configurada');
        if (conversation.is_blocked) throw new Error('contato bloqueado');
        const text = renderTemplate(action.message, {
          clientName: conversation.contact_name,
          clientPhone: conversation.contact_phone,
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
        if (!action.target) throw new Error('destino não configurado');
        const department = action.type === 'transfer_to_department'
          ? departments.find(item => item.id === action.target)
          : null;
        const agent = action.type === 'transfer_to_user'
          ? staff.find(item => item.user_id === action.target)
          : null;
        if (action.type === 'transfer_to_department' && !department) throw new Error('setor de destino indisponível');
        if (action.type === 'transfer_to_user' && !agent) throw new Error('responsável de destino indisponível');

        await whatsappService.transferConversation({
          conversationId: conversation.id,
          ...(department ? { toDepartmentId: department.id, toUserId: null } : {}),
          ...(agent ? { toUserId: agent.user_id } : {}),
          note: action.payload?.note || `Transferência automática pelo funil`,
        });

        if (action.message && !conversation.is_blocked) {
          const text = renderTemplate(action.message, {
            clientName: conversation.contact_name,
            clientPhone: conversation.contact_phone,
            extraVars: {
              destino: agent?.name || department?.name || '',
              setor: department?.name || '',
            },
          });
          await sendTextResilient({
            conversationId: conversation.id,
            channelId: conversation.instance_id,
            text,
            automated: true,
          });
        }
        result.completed.push(`transferido para ${agent?.name || department?.name}`);
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
