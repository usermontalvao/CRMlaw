// Tipos para o módulo de Assinatura Digital

export type SignatureStatus = 'pending' | 'signed' | 'expired' | 'cancelled';

export type SignerAuthMethod = 'signature_only' | 'signature_facial' | 'signature_facial_document';

export interface SignatureRequest {
  id: string;
  document_id: string;
  document_name: string;
  document_path?: string | null;
  attachment_paths?: string[] | null; // Paths dos documentos anexos
  client_id?: string | null;
  client_name?: string | null;
  process_id?: string | null;
  process_number?: string | null;
  status: SignatureStatus;
  auth_method: SignerAuthMethod;
  expires_at?: string | null;
  signed_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Dados coletados
  signature_image_path?: string | null;
  facial_image_path?: string | null;
  document_image_path?: string | null;
  // Metadados de assinatura
  signer_ip?: string | null;
  signer_user_agent?: string | null;
  signer_geolocation?: string | null;
  // Link público para assinatura externa
  public_token?: string | null;
  // Arquivamento (removido do painel)
  archived_at?: string | null;
}

export interface Signer {
  id: string;
  signature_request_id: string;
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  role?: string | null; // Ex: "Contratante", "Contratado", "Testemunha"
  order?: number | null; // Ordem de assinatura
  status: SignatureStatus;
  auth_method: SignerAuthMethod;
  viewed_at?: string | null;
  signed_at?: string | null;
  signature_image_path?: string | null;
  facial_image_path?: string | null;
  document_image_path?: string | null;
  signer_ip?: string | null;
  signer_user_agent?: string | null;
  signer_geolocation?: string | null;
  geolocation?: string | null; // Alias para signer_geolocation
  device_info?: string | null; // Informações do dispositivo
  public_token?: string | null;
  verification_hash?: string | null; // Hash para verificação pública
  signed_document_path?: string | null; // Path do PDF assinado no storage
  signed_pdf_sha256?: string | null; // SHA-256 do PDF assinado para verificação por upload
  // Método de autenticação
  auth_provider?: 'google' | 'email_link' | 'phone' | null; // Como o usuário se autenticou
  auth_email?: string | null; // E-mail usado na autenticação
  auth_google_sub?: string | null; // ID único do Google (sub)
  auth_google_picture?: string | null; // URL da foto do Google
  created_at: string;
  updated_at: string;
}

export interface CreateSignatureRequestDTO {
  document_id: string;
  document_name: string;
  document_path?: string | null;
  attachment_paths?: string[] | null; // Paths dos documentos anexos
  client_id?: string | null;
  client_name?: string | null;
  process_id?: string | null;
  process_number?: string | null;
  auth_method: SignerAuthMethod;
  expires_at?: string | null;
  signers: CreateSignerDTO[];
}

export interface CreateSignerDTO {
  name: string;
  email: string;
  cpf?: string | null;
  phone?: string | null;
  role?: string | null;
  order?: number | null;
  auth_method?: SignerAuthMethod;
}

export interface UpdateSignerDTO {
  name?: string;
  email?: string;
  cpf?: string | null;
  phone?: string | null;
  role?: string | null;
  order?: number | null;
}

export interface SignDocumentDTO {
  signature_image: string; // Base64 da assinatura
  facial_image?: string | null; // Base64 da foto facial
  document_image?: string | null; // Base64 da foto do documento
  geolocation?: string | null;
  // Dados informados pelo signatário no momento da assinatura
  signer_name?: string | null;
  signer_cpf?: string | null;
  signer_phone?: string | null;
  // Dados de autenticação
  auth_provider?: 'google' | 'email_link' | 'phone' | null;
  auth_email?: string | null;
  auth_google_sub?: string | null;
  auth_google_picture?: string | null;
}

export interface SignatureRequestWithSigners extends SignatureRequest {
  signers: Signer[];
}

// Estatísticas do módulo
export interface SignatureStats {
  total: number;
  pending: number;
  signed: number;
  expired: number;
  cancelled: number;
}

// Histórico de ações
export interface SignatureAuditLog {
  id: string;
  signature_request_id: string;
  signer_id?: string | null;
  action: 'created' | 'sent' | 'viewed' | 'signed' | 'cancelled' | 'expired' | 'reminder_sent';
  description: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export type SignatureFieldType = 'signature' | 'initials' | 'name' | 'cpf' | 'date';

export interface SignatureField {
  id: string;
  signature_request_id: string;
  document_id?: string;
  signer_id?: string | null;
  field_type: SignatureFieldType;
  page_number: number;
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
  required: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSignatureFieldDTO {
  signature_request_id: string;
  document_id?: string;
  signer_id?: string | null;
  field_type: SignatureFieldType;
  page_number: number;
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
  required?: boolean;
}
