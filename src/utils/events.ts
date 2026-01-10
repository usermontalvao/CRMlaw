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
    if (!this.events[event]) return;
    this.events[event].forEach(callback => callback(data));
    
    // Também dispara um evento nativo do DOM para compatibilidade fora do React se necessário
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
};
