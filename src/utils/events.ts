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
  // WhatsApp: notificação visual de mensagem nova de uma conversa "minha" (fora
  // do módulo) — consumida pelo ChatFloatingWidget para exibir o toast ancorado
  // ao widget em vez do toast global no topo da tela.
  WHATSAPP_NOTIFY: 'whatsapp_notify',
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
