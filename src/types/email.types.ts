// Tipos para módulo de email

export interface EmailAccount {
  id: string;
  user_id: string;
  email: string;
  password: string; // Criptografada
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: string;
  account_id: string;
  message_id: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  folder: 'inbox' | 'sent' | 'draft' | 'trash';
  client_id?: string | null;
  process_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailAttachment {
  id: string;
  email_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage_path: string;
  created_at: string;
}

export interface CreateEmailAccountDTO {
  email: string;
  password: string;
  smtp_host?: string;
  smtp_port?: number;
  imap_host?: string;
  imap_port?: number;
}

export interface SendEmailDTO {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  attachments?: File[];
  client_id?: string;
  process_id?: string;
}

export interface EmailFilters {
  folder?: 'inbox' | 'sent' | 'draft' | 'trash';
  is_read?: boolean;
  is_starred?: boolean;
  client_id?: string;
  process_id?: string;
  search?: string;
}
