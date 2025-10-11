// Chaves para cache do React Query
export const QUERY_KEYS = {
  // Clientes
  CLIENTS: ['clients'],
  CLIENT: (id: string) => ['client', id],
  
  // Processos
  PROCESSES: ['processes'],
  PROCESS: (id: string) => ['process', id],
  
  // Requerimentos
  REQUIREMENTS: ['requirements'],
  REQUIREMENT: (id: string) => ['requirement', id],
  
  // Prazos
  DEADLINES: ['deadlines'],
  DEADLINE: (id: string) => ['deadline', id],
  
  // Calendário
  CALENDAR_EVENTS: ['calendar_events'],
  CALENDAR_EVENT: (id: string) => ['calendar_event', id],
  
  // Intimações
  INTIMATIONS: ['intimations'],
  INTIMATION: (id: string) => ['intimation', id],
  
  // Leads
  LEADS: ['leads'],
  LEAD: (id: string) => ['lead', id],
  
  // Tarefas
  TASKS: ['tasks'],
  TASK: (id: string) => ['task', id],
  
  // Notificações
  NOTIFICATIONS: ['notifications'],
  
  // Perfil
  PROFILE: ['profile'],
  MEMBERS: ['members'],
} as const;
