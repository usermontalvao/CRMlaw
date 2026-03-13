export interface CloudFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  client_id?: string | null;
  archived_at?: string | null;
  delete_scheduled_for?: string | null;
  has_pending_issue?: boolean;
  alert_level?: 'pendencia' | 'alerta' | null;
  pending_reason?: string | null;
  resolved_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCloudFolderDTO {
  name: string;
  parent_id?: string | null;
  client_id?: string | null;
  has_pending_issue?: boolean;
  alert_level?: 'pendencia' | 'alerta' | null;
  pending_reason?: string | null;
  resolved_at?: string | null;
}

export interface UpdateCloudFolderDTO {
  name?: string;
  parent_id?: string | null;
  client_id?: string | null;
  archived_at?: string | null;
  delete_scheduled_for?: string | null;
  has_pending_issue?: boolean;
  alert_level?: 'pendencia' | 'alerta' | null;
  pending_reason?: string | null;
  resolved_at?: string | null;
}

export interface CloudFile {
  id: string;
  folder_id: string;
  client_id?: string | null;
  original_name: string;
  storage_path: string;
  mime_type?: string | null;
  file_size: number;
  extension?: string | null;
  archived_at?: string | null;
  delete_scheduled_for?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudActivityLog {
  id: string;
  entity_type: 'file' | 'folder' | 'share';
  entity_id: string;
  action: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at: string;
}

export interface CreateCloudShareDTO {
  folder_id: string;
  password?: string;
  expires_at?: string | null;
}

export interface CloudFolderShare {
  id: string;
  folder_id: string;
  token: string;
  password_hash?: string | null;
  expires_at?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudFolderWithCounts extends CloudFolder {
  subfolder_count?: number;
  file_count?: number;
}

export interface CloudBreadcrumbItem {
  id: string;
  name: string;
}

export interface CloudShareAccessResult {
  share: CloudFolderShare;
  folder: CloudFolder;
}

export interface CloudPublicShareInfo {
  share: CloudFolderShare;
  requiresPassword: boolean;
}
