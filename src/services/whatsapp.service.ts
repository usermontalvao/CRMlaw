// Fachada do serviço WhatsApp. A implementação vive em camadas de domínio sob
// `./whatsapp/*` (conversations, messages, admin, client360, automation) sobre
// um núcleo compartilhado (`./whatsapp/shared`). Este arquivo apenas compõe o
// singleton `whatsappService` e reexporta helpers/tipos — os consumidores
// continuam importando tudo de `../services/whatsapp.service` como antes.
import { conversationsApi } from './whatsapp/conversations';
import { messagesApi } from './whatsapp/messages';
import { adminApi } from './whatsapp/admin';
import { client360Api } from './whatsapp/client360';
import { automationApi } from './whatsapp/automation';

// Helpers e tipos de domínio (telefone, template, permissões, overview, etc.).
export {
  normalizePhone, phoneVariants, renderTemplate, agentPermissions, summarizeOverview,
} from './whatsapp/shared';
export type {
  AgentPermissions, TemplateContext, StaffOption, AgentPrefs, ScheduleDeadline,
  ClientSchedule, ClientDocRequest, ClientPendings, ClientOverview, ClientQuickSummary,
  WhatsAppInternalNote,
} from './whatsapp/shared';
export type { WhatsAppAiSession, WhatsAppAiPlaybook, WhatsAppAiChannelConfig, AiPlaybookQuestion } from '../types/whatsapp.types';

/**
 * API única consumida pela UI. Mantida como objeto composto para preservar os
 * call sites `whatsappService.metodo(...)` enquanto a lógica fica separada por
 * camada de domínio.
 */
export const whatsappService = {
  ...conversationsApi,
  ...messagesApi,
  ...adminApi,
  ...client360Api,
  ...automationApi,
};
