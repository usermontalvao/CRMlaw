/**
 * Tipos do Portal do Cliente
 * Mantém apenas tipos específicos do portal — tipos compartilhados ficam em src/types/
 */

export interface ClientPortalUser {
  id: string;
  client_id: string;
  auth_user_id: string | null;
  cpf: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  last_login_at: string | null;
  notifications_last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortalSession {
  user: ClientPortalUser;
  client: {
    id: string;
    nome: string;
    email: string | null;
    telefone: string | null;
    photo_path?: string | null;
    photo_url?: string | null;
  };
  loginMethod: 'otp_email' | 'otp_sms' | 'cpf_dev' | 'cpf_phone4';
  loginAt: string;
}

export type PortalRoute =
  | 'dashboard'
  | 'casos'        // Unifica processos judiciais + requerimentos INSS
  | 'processos'    // Alias legado → redireciona para 'casos'
  | 'scanner'
  | 'documentos'
  | 'assinar'
  | 'financeiro'
  | 'agenda'
  | 'mensagens'
  | 'notificacoes'
  | 'perfil';

export interface PortalNavItem {
  id: PortalRoute;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}
