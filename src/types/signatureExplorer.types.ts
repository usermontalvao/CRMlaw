export type SignatureExplorerItemType = 'signature_request' | 'generated_document';

export interface SignatureExplorerFolder {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignatureExplorerItem {
  id: string;
  item_type: SignatureExplorerItemType;
  item_id: string;
  folder_id?: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSignatureExplorerFolderDTO {
  name: string;
  parent_id?: string | null;
  sort_order?: number;
  created_by?: string | null;
}

export interface UpdateSignatureExplorerFolderDTO {
  name?: string;
  parent_id?: string | null;
  sort_order?: number;
}

export interface UpsertSignatureExplorerItemDTO {
  item_type: SignatureExplorerItemType;
  item_id: string;
  folder_id?: string | null;
  sort_order?: number;
  created_by: string;
}
