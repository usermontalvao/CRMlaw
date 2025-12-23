export type RequirementDocumentType = 'mandado_seguranca' | 'generic';

export interface RequirementDocument {
  id: string;
  requirement_id: string;
  document_type: RequirementDocumentType | string;
  file_name: string;
  file_path: string;
  mime_type: string;
  created_by?: string | null;
  created_at: string;
}

export interface CreateRequirementDocumentDTO {
  requirement_id: string;
  document_type?: RequirementDocumentType | string;
  file_name: string;
  file_path: string;
  mime_type?: string;
}
