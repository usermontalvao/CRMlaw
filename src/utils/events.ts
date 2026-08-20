/**
 * Utilitário simples para eventos globais no sistema
 * Permite que diferentes módulos se comuniquem sem acoplamento direto
 */

type EventCallback = (data?: any) => void;

class EventEmitter {
  private events: { [key: string]: EventCallback[] } = {};

  /**
   * Inscreve um callback para um evento específico
   */
  on(event: string, callback: EventCallback) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
    
    // Retorna função para desinscrever
    return () => this.off(event, callback);
  }

  /**
   * Remove um callback de um evento
   */
  off(event: string, callback: EventCallback) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(cb => cb !== callback);
  }

  /**
   * Dispara um evento com dados opcionais
   */
  emit(event: string, data?: any) {
    // Notifica os listeners in-memory (se houver).
    if (this.events[event]) {
      this.events[event].forEach(callback => callback(data));
    }
    // SEMPRE dispara o evento nativo do DOM — assim consumidores via
    // window.addEventListener (ex.: chunks lazy) recebem mesmo quando não há
    // nenhum listener in-memory registrado para este evento.
    const customEvent = new CustomEvent(`crm:${event}`, { detail: data });
    window.dispatchEvent(customEvent);
  }
}

export const events = new EventEmitter();

// Nomes de eventos comuns
export const SYSTEM_EVENTS = {
  CLIENTS_CHANGED: 'clients_changed',
  CLIENT_CREATED: 'client_created',
  CLIENT_UPDATED: 'client_updated',
  CLIENT_DELETED: 'client_deleted',
  CLOUD_CHANGED: 'cloud_changed',
  PROCESSES_CHANGED: 'processes_changed',
  PROCESS_CREATED: 'process_created',
  PROCESS_UPDATED: 'process_updated',
  PROCESS_DELETED: 'process_deleted',
  DASHBOARD_REFRESH: 'dashboard_refresh',
  NOTIFICATIONS_CHANGED: 'notifications_changed',
  CHAT_WIDGET_OPEN_DM: 'chat_widget_open_dm',
  // Petition Editor floating widget wevents
  PETITION_EDITOR_OPEN: 'petition_editor_open',
  PETITION_EDITOR_CLOSE: 'petition_editor_close',
  PETITION_EDITOR_MINIMIZE: 'petition_editor_minimize',
  PETITION_EDITOR_MAXIMIZE: 'petition_editor_maximize',
  // Petition Editor block modal
  BLOCK_MODAL_OPEN: 'block_modal_open',
  BLOCK_MODAL_CLOSE: 'block_modal_close',
  // Cross-module navigation
  NAVIGATE_REQUEST: 'navigate_request',
  // Presence: widget broadcasts online user IDs so other components can read them
  PRESENCE_UPDATED: 'presence_updated',
  // WhatsApp: mensagem nova de uma conversa "minha". Payload traz também a
  // camada do aviso (`tier`: 'global' | 'inbox'). Quem desenha o cartão é o
  // WhatsAppNotifyHost (global); o ChatFloatingWidget só soma o badge do
  // launcher. Mensagem na conversa JÁ ABERTA não emite o evento — ali o aviso
  // é só o toque curto.
  WHATSAPP_NOTIFY: 'whatsapp_notify',
  // Clique no cartão de aviso: abre a conversa DENTRO do widget flutuante, na
  // aba WhatsApp, sem trocar a tela em que a pessoa está. Trocar de módulo para
  // responder "ok" era a interrupção que o aviso deveria evitar. Quem já está
  // no módulo do WhatsApp não passa por aqui — lá o App navega direto, porque o
  // widget nem é montado.
  // Payload: { conversationId: string }
  CHAT_WIDGET_OPEN_WHATSAPP: 'chat_widget_open_whatsapp',
  // "Conversar no WhatsApp" a partir de QUALQUER tela do CRM (ficha do cliente,
  // lista, lead, requerimento, assinatura, agenda, busca global, nuvem). Antes
  // cada um desses botões era um link para `wa.me` — a conversa acontecia fora,
  // sem thread na inbox e sem vínculo com o cadastro.
  //
  // Quem escuta é o `WhatsAppChatOpener` (montado no App): ele abre/reabre a
  // conversa pelo canal conectado e entrega o id a quem sabe mostrá-la — o
  // widget flutuante, ou o próprio módulo quando já se está nele.
  // Payload: { phone, clientId?, contactName?, text?, fallbackUrl }
  WHATSAPP_OPEN_CHAT: 'whatsapp_open_chat',
  // Não deu para abrir por dentro (sem canal conectado, erro no banco) e o
  // clique caiu no `wa.me`. Só existe para o widget tirar da tela o esqueleto
  // de "abrindo conversa" — sem isto ele ficaria prometendo o que não vem.
  WHATSAPP_OPEN_CHAT_FAILED: 'whatsapp_open_chat_failed',
  // Admin alterou quais módulos aparecem no menu lateral
  MODULES_CONFIG_UPDATED: 'modules_config_updated',
};

// Nome do window CustomEvent e chave de storage do estado do Editor de Peticoes
// flutuante. Centralizados aqui para o App saber que o editor esta aberto e NAO
// substituir toda a tela pela pagina offline global (o editor tem seu proprio
// banner de conexao com opcao de baixar em Word — trocar tudo desmontaria o
// editor e perderia o trabalho nao salvo).
export const PETITION_EDITOR_WIDGET_STATE_EVENT = 'crm:petition_editor_widget_state';
export const PETITION_EDITOR_WIDGET_STATE_STORAGE_KEY = 'petition-editor-widget-state';
