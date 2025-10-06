export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  content: string;
  file_path?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentTemplateDTO {
  name: string;
  description?: string;
  content: string;
}

export interface GeneratedDocument {
  id: string;
  template_id: string;
  template_name: string;
  client_id: string;
  client_name: string;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
  created_at: string;
}

export interface CreateGeneratedDocumentDTO {
  template_id: string;
  template_name: string;
  client_id: string;
  client_name: string;
  file_name: string;
  file_path?: string | null;
  mime_type?: string | null;
}
