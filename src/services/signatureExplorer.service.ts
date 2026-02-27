import { supabase } from '../config/supabase';
import type {
  SignatureExplorerFolder,
  SignatureExplorerItem,
  CreateSignatureExplorerFolderDTO,
  UpdateSignatureExplorerFolderDTO,
  UpsertSignatureExplorerItemDTO,
  SignatureExplorerItemType,
} from '../types/signatureExplorer.types';

class SignatureExplorerService {
  private foldersTable = 'signature_explorer_folders';
  private itemsTable = 'signature_explorer_items';

  async listFolders(): Promise<SignatureExplorerFolder[]> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createFolder(payload: CreateSignatureExplorerFolderDTO): Promise<SignatureExplorerFolder> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateFolder(id: string, payload: UpdateSignatureExplorerFolderDTO): Promise<SignatureExplorerFolder> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .update(payload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteFolder(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.foldersTable)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async listItems(): Promise<SignatureExplorerItem[]> {
    const { data, error } = await supabase
      .from(this.itemsTable)
      .select('*')
      .order('folder_id', { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async upsertItem(payload: UpsertSignatureExplorerItemDTO): Promise<SignatureExplorerItem> {
    const { data, error } = await supabase
      .from(this.itemsTable)
      .upsert(payload, { onConflict: 'item_type,item_id' })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async moveItem(params: {
    itemType: SignatureExplorerItemType;
    itemId: string;
    folderId: string | null;
    createdBy: string;
    sortOrder?: number;
  }): Promise<SignatureExplorerItem> {
    return this.upsertItem({
      item_type: params.itemType,
      item_id: params.itemId,
      folder_id: params.folderId,
      created_by: params.createdBy,
      sort_order: params.sortOrder,
    });
  }

  async deleteItem(params: {
    itemType: SignatureExplorerItemType;
    itemId: string;
    createdBy?: string;
  }): Promise<void> {
    let query = supabase
      .from(this.itemsTable)
      .delete()
      .eq('item_type', params.itemType)
      .eq('item_id', params.itemId);

    if (params.createdBy) {
      query = query.eq('created_by', params.createdBy);
    }

    const { error } = await query;

    if (error) throw new Error(error.message);
  }
}

export const signatureExplorerService = new SignatureExplorerService();
