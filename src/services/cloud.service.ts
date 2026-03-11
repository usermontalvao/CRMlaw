import { supabase } from '../config/supabase';
import type {
  CloudActivityLog,
  CloudFile,
  CloudFolder,
  CloudFolderShare,
  CloudPublicShareInfo,
  CloudShareAccessResult,
  CreateCloudFolderDTO,
  CreateCloudShareDTO,
  UpdateCloudFolderDTO,
} from '../types/cloud.types';

const CLOUD_BUCKET = 'cloud-files';

const sanitizeStorageSegment = (value: string) => {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\[\]{}()]+/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '');

  return normalized || 'arquivo';
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

class CloudService {
  private foldersTable = 'cloud_folders';
  private filesTable = 'cloud_files';
  private sharesTable = 'cloud_folder_shares';
  private activityTable = 'cloud_activity_logs';

  private async ensureBucket() {
    return;
  }

  async hashPassword(password: string) {
    const normalized = String(password || '').trim();
    if (!normalized) return null;
    const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return toHex(buffer);
  }

  async listFolders(parentId: string | null, includeArchived = false): Promise<CloudFolder[]> {
    let query = supabase
      .from(this.foldersTable)
      .select('*')
      .order('name', { ascending: true });

    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
    if (!includeArchived) query = query.is('archived_at', null);
    query = query.is('delete_scheduled_for', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as CloudFolder[]) ?? [];
  }

  async listAllFolders(includeArchived = false): Promise<CloudFolder[]> {
    let query = supabase
      .from(this.foldersTable)
      .select('*')
      .order('name', { ascending: true });

    if (!includeArchived) query = query.is('archived_at', null);
    query = query.is('delete_scheduled_for', null);

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return (data as CloudFolder[]) ?? [];
  }

  async listClientRootFolders(clientId: string, includeArchived = true): Promise<CloudFolder[]> {
    let query = supabase
      .from(this.foldersTable)
      .select('*')
      .eq('client_id', clientId)
      .is('parent_id', null)
      .order('name', { ascending: true });

    if (!includeArchived) query = query.is('archived_at', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as CloudFolder[]) ?? [];
  }

  async getFolder(folderId: string): Promise<CloudFolder | null> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .select('*')
      .eq('id', folderId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as CloudFolder | null) ?? null;
  }

  async createFolder(payload: CreateCloudFolderDTO): Promise<CloudFolder> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .insert(payload)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFolder;
  }

  async archiveFolder(folderId: string): Promise<CloudFolder> {
    const [childFolders, childFiles] = await Promise.all([
      this.listFolders(folderId, true),
      this.listFiles(folderId, true),
    ]);

    for (const childFolder of childFolders) {
      if (!childFolder.archived_at) {
        await this.archiveFolder(childFolder.id);
      }
    }

    for (const childFile of childFiles) {
      if (!childFile.archived_at) {
        await this.archiveFile(childFile.id);
      }
    }

    return this.updateFolder(folderId, {
      archived_at: new Date().toISOString(),
      delete_scheduled_for: null,
    });
  }

  async trashFolder(folderId: string): Promise<CloudFolder> {
    const [childFolders, childFiles] = await Promise.all([
      this.listFolders(folderId, true),
      this.listFiles(folderId, true),
    ]);

    for (const childFolder of childFolders) {
      if (!childFolder.delete_scheduled_for) {
        await this.trashFolder(childFolder.id);
      }
    }

    for (const childFile of childFiles) {
      if (!childFile.delete_scheduled_for) {
        await this.trashFile(childFile.id);
      }
    }

    return this.updateFolder(folderId, {
      archived_at: null,
      delete_scheduled_for: new Date().toISOString(),
    });
  }

  async restoreFolder(folderId: string): Promise<CloudFolder> {
    const [childFolders, childFiles] = await Promise.all([
      this.listTrashedFolders(folderId),
      this.listTrashedFiles(folderId),
    ]);

    for (const childFolder of childFolders) {
      await this.restoreFolder(childFolder.id);
    }

    for (const childFile of childFiles) {
      await this.restoreFile(childFile.id);
    }

    return this.updateFolder(folderId, {
      archived_at: null,
      delete_scheduled_for: null,
    });
  }

  async updateFolder(folderId: string, payload: UpdateCloudFolderDTO): Promise<CloudFolder> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .update(payload)
      .eq('id', folderId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFolder;
  }

  async deleteFolder(folderId: string): Promise<void> {
    const [activeChildFolders, trashedChildFolders, activeChildFiles, trashedChildFiles] = await Promise.all([
      this.listFolders(folderId, true),
      this.listTrashedFolders(folderId),
      this.listFiles(folderId, true),
      this.listTrashedFiles(folderId),
    ]);

    const childFolders = [...activeChildFolders, ...trashedChildFolders].filter(
      (childFolder, index, list) => list.findIndex((item) => item.id === childFolder.id) === index,
    );
    const childFiles = [...activeChildFiles, ...trashedChildFiles].filter(
      (childFile, index, list) => list.findIndex((item) => item.id === childFile.id) === index,
    );

    for (const childFolder of childFolders) {
      await this.deleteFolder(childFolder.id);
    }

    for (const childFile of childFiles) {
      await this.deleteFile(childFile);
    }

    const { error } = await supabase
      .from(this.foldersTable)
      .delete()
      .eq('id', folderId);

    if (error) throw new Error(error.message);
  }

  async listFiles(folderId: string, includeArchived = false): Promise<CloudFile[]> {
    let query = supabase
      .from(this.filesTable)
      .select('*')
      .eq('folder_id', folderId)
      .order('original_name', { ascending: true });

    if (!includeArchived) query = query.is('archived_at', null);
    query = query.is('delete_scheduled_for', null);

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return (data as CloudFile[]) ?? [];
  }

  async listAllFiles(includeArchived = true): Promise<CloudFile[]> {
    let query = supabase
      .from(this.filesTable)
      .select('*')
      .order('original_name', { ascending: true });

    if (!includeArchived) query = query.is('archived_at', null);
    query = query.is('delete_scheduled_for', null);

    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return (data as CloudFile[]) ?? [];
  }

  async listArchivedFiles(): Promise<CloudFile[]> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .select('*')
      .not('archived_at', 'is', null)
      .is('delete_scheduled_for', null)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data as CloudFile[]) ?? [];
  }

  async listTrashedFolders(parentId?: string | null): Promise<CloudFolder[]> {
    let query = supabase
      .from(this.foldersTable)
      .select('*')
      .not('delete_scheduled_for', 'is', null)
      .order('updated_at', { ascending: false });

    if (parentId === undefined) {
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data as CloudFolder[]) ?? [];
    }

    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as CloudFolder[]) ?? [];
  }

  async listTrashedFiles(folderId?: string): Promise<CloudFile[]> {
    let query = supabase
      .from(this.filesTable)
      .select('*')
      .not('delete_scheduled_for', 'is', null)
      .order('updated_at', { ascending: false });

    if (folderId) {
      query = query.eq('folder_id', folderId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as CloudFile[]) ?? [];
  }

  async uploadFile(folderId: string, file: File, clientId?: string | null): Promise<CloudFile> {
    await this.ensureBucket();

    const safeOriginalName = sanitizeStorageSegment(file.name);
    const safeName = `${crypto.randomUUID()}_${safeOriginalName}`;
    const storagePath = `${folderId}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(CLOUD_BUCKET)
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data, error } = await supabase
      .from(this.filesTable)
      .insert({
        folder_id: folderId,
        client_id: clientId || null,
        original_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || 'application/octet-stream',
        file_size: file.size,
        extension: file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? null : null,
      })
      .select('*')
      .single();

    if (error) {
      await supabase.storage.from(CLOUD_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }

    return data as CloudFile;
  }

  async uploadFiles(folderId: string, files: File[], clientId?: string | null): Promise<CloudFile[]> {
    const created: CloudFile[] = [];
    for (const file of files) {
      created.push(await this.uploadFile(folderId, file, clientId || null));
    }

    return created;
  }

  async moveFile(fileId: string, targetFolderId: string, targetClientId?: string | null): Promise<CloudFile> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        folder_id: targetFolderId,
        client_id: targetClientId || null,
      })
      .eq('id', fileId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async trashFile(fileId: string): Promise<CloudFile> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        archived_at: null,
        delete_scheduled_for: new Date().toISOString(),
      })
      .eq('id', fileId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async replaceFileContents(file: CloudFile, blob: Blob, nextOriginalName?: string): Promise<CloudFile> {
    await this.ensureBucket();

    const originalName = nextOriginalName || file.original_name;
    const extension = originalName.includes('.') ? originalName.split('.').pop()?.toLowerCase() ?? null : null;

    const { error: uploadError } = await supabase.storage
      .from(CLOUD_BUCKET)
      .upload(file.storage_path, blob, {
        contentType: blob.type || file.mime_type || 'application/octet-stream',
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        original_name: originalName,
        mime_type: blob.type || file.mime_type || 'application/octet-stream',
        file_size: blob.size,
        extension,
        updated_at: new Date().toISOString(),
      })
      .eq('id', file.id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async deleteFile(file: CloudFile): Promise<void> {
    const { error } = await supabase.from(this.filesTable).delete().eq('id', file.id);
    if (error) throw new Error(error.message);
    await supabase.storage.from(CLOUD_BUCKET).remove([file.storage_path]);
  }

  async archiveFile(fileId: string): Promise<CloudFile> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        archived_at: new Date().toISOString(),
        delete_scheduled_for: null,
      })
      .eq('id', fileId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async restoreFile(fileId: string): Promise<CloudFile> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        archived_at: null,
        delete_scheduled_for: null,
      })
      .eq('id', fileId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async renameFile(fileId: string, newName: string): Promise<CloudFile> {
    const extension = newName.includes('.') ? newName.split('.').pop()?.toLowerCase() ?? null : null;

    const { data, error } = await supabase
      .from(this.filesTable)
      .update({
        original_name: newName,
        extension,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFile;
  }

  async duplicateFile(fileId: string): Promise<CloudFile> {
    await this.ensureBucket();

    const { data: original, error: fetchError } = await supabase
      .from(this.filesTable)
      .select('*')
      .eq('id', fileId)
      .single();

    if (fetchError || !original) throw new Error(fetchError?.message ?? 'Arquivo não encontrado.');

    const file = original as CloudFile;
    const signedUrl = await this.getFileSignedUrl(file.storage_path);
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error('Não foi possível baixar o arquivo original.');
    const blob = await response.blob();

    const nameParts = file.original_name.split('.');
    const ext = nameParts.length > 1 ? nameParts.pop() : null;
    const baseName = nameParts.join('.');
    const copyName = ext ? `${baseName} (cópia).${ext}` : `${file.original_name} (cópia)`;

    const safeOriginalName = sanitizeStorageSegment(copyName);
    const safeName = `${crypto.randomUUID()}_${safeOriginalName}`;
    const storagePath = `${file.folder_id}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(CLOUD_BUCKET)
      .upload(storagePath, blob, {
        contentType: file.mime_type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await supabase
      .from(this.filesTable)
      .insert({
        folder_id: file.folder_id,
        client_id: file.client_id,
        original_name: copyName,
        storage_path: storagePath,
        mime_type: file.mime_type,
        file_size: file.file_size,
        extension: file.extension,
      })
      .select('*')
      .single();

    if (error) {
      await supabase.storage.from(CLOUD_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }

    return data as CloudFile;
  }

  async duplicateFileToFolder(fileId: string, targetFolderId: string, targetClientId?: string | null): Promise<CloudFile> {
    await this.ensureBucket();

    const { data: original, error: fetchError } = await supabase
      .from(this.filesTable)
      .select('*')
      .eq('id', fileId)
      .single();

    if (fetchError || !original) throw new Error(fetchError?.message ?? 'Arquivo não encontrado.');

    const file = original as CloudFile;
    const signedUrl = await this.getFileSignedUrl(file.storage_path);
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error('Não foi possível baixar o arquivo original.');
    const blob = await response.blob();

    const nameParts = file.original_name.split('.');
    const ext = nameParts.length > 1 ? nameParts.pop() : null;
    const baseName = nameParts.join('.');
    const copyName = ext ? `${baseName} (cópia).${ext}` : `${file.original_name} (cópia)`;

    const safeOriginalName = sanitizeStorageSegment(copyName);
    const safeName = `${crypto.randomUUID()}_${safeOriginalName}`;
    const storagePath = `${targetFolderId}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(CLOUD_BUCKET)
      .upload(storagePath, blob, {
        contentType: file.mime_type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data, error } = await supabase
      .from(this.filesTable)
      .insert({
        folder_id: targetFolderId,
        client_id: targetClientId ?? file.client_id,
        original_name: copyName,
        storage_path: storagePath,
        mime_type: file.mime_type,
        file_size: file.file_size,
        extension: file.extension,
      })
      .select('*')
      .single();

    if (error) {
      await supabase.storage.from(CLOUD_BUCKET).remove([storagePath]);
      throw new Error(error.message);
    }

    return data as CloudFile;
  }

  async duplicateFolderToFolder(folderId: string, targetParentId: string | null, targetClientId?: string | null): Promise<CloudFolder> {
    const sourceFolder = await this.getFolder(folderId);
    if (!sourceFolder) throw new Error('Pasta não encontrada.');

    const rootCopy = await this.createFolder({
      name: `${sourceFolder.name} (cópia)`,
      parent_id: targetParentId,
      client_id: targetClientId ?? sourceFolder.client_id ?? null,
    });

    const duplicateChildren = async (sourceId: string, targetId: string, inheritedClientId: string | null) => {
      const [childFolders, childFiles] = await Promise.all([
        this.listFolders(sourceId, false),
        this.listFiles(sourceId, false),
      ]);

      for (const childFile of childFiles) {
        await this.duplicateFileToFolder(childFile.id, targetId, inheritedClientId);
      }

      for (const childFolder of childFolders) {
        const createdChild = await this.createFolder({
          name: childFolder.name,
          parent_id: targetId,
          client_id: inheritedClientId ?? childFolder.client_id ?? null,
        });

        await duplicateChildren(childFolder.id, createdChild.id, inheritedClientId ?? childFolder.client_id ?? null);
      }
    };

    await duplicateChildren(folderId, rootCopy.id, targetClientId ?? sourceFolder.client_id ?? null);
    return rootCopy;
  }

  async getFileSignedUrl(storagePath: string, expiresIn = 60 * 60): Promise<string> {
    const { data, error } = await supabase.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Não foi possível gerar link temporário.');
    return data.signedUrl;
  }

  async createShare(payload: CreateCloudShareDTO): Promise<CloudFolderShare> {
    const existingShare = await this.getActiveShareByFolder(payload.folder_id);
    const password_hash = payload.password ? await this.hashPassword(payload.password) : null;

    if (existingShare) {
      const { data, error } = await supabase
        .from(this.sharesTable)
        .update({
          password_hash,
          expires_at: payload.expires_at || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingShare.id)
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      return data as CloudFolderShare;
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const { data, error } = await supabase
      .from(this.sharesTable)
      .insert({
        folder_id: payload.folder_id,
        token,
        password_hash,
        expires_at: payload.expires_at || null,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFolderShare;
  }

  async getActiveShareByFolder(folderId: string): Promise<CloudFolderShare | null> {
    const { data, error } = await supabase
      .from(this.sharesTable)
      .select('*')
      .eq('folder_id', folderId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return (data as CloudFolderShare | null) ?? null;
  }

  async updateShare(shareId: string, payload: { password?: string; expires_at?: string | null; is_active?: boolean }): Promise<CloudFolderShare> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.password !== undefined) {
      updateData.password_hash = payload.password ? await this.hashPassword(payload.password) : null;
    }

    if (payload.expires_at !== undefined) {
      updateData.expires_at = payload.expires_at;
    }

    if (payload.is_active !== undefined) {
      updateData.is_active = payload.is_active;
    }

    const { data, error } = await supabase
      .from(this.sharesTable)
      .update(updateData)
      .eq('id', shareId)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data as CloudFolderShare;
  }

  async listFolderShares(folderId: string): Promise<CloudFolderShare[]> {
    const { data, error } = await supabase
      .from(this.sharesTable)
      .select('*')
      .eq('folder_id', folderId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data as CloudFolderShare[]) ?? [];
  }

  async listActivityLogs(limit = 40): Promise<CloudActivityLog[]> {
    const { data, error } = await supabase
      .from(this.activityTable)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return (data as CloudActivityLog[]) ?? [];
  }

  async disableShare(shareId: string): Promise<void> {
    const { error } = await supabase
      .from(this.sharesTable)
      .update({ is_active: false })
      .eq('id', shareId);

    if (error) throw new Error(error.message);
  }

  async resolvePublicShare(token: string, password?: string): Promise<CloudShareAccessResult> {
    const { data, error } = await supabase
      .from(this.sharesTable)
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Link público não encontrado.');
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      throw new Error('Este link público expirou.');
    }

    if (data.password_hash) {
      const incomingHash = await this.hashPassword(password || '');
      if (!incomingHash || incomingHash !== data.password_hash) {
        throw new Error('Senha inválida.');
      }
    }

    return {
      share: data as CloudFolderShare,
      folder: {
        id: data.folder_id,
        name: 'Pasta compartilhada',
        parent_id: null,
        client_id: null,
        archived_at: null,
        delete_scheduled_for: null,
        created_by: data.created_by ?? null,
        updated_by: data.created_by ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    };
  }

  async getPublicShareInfo(token: string): Promise<CloudPublicShareInfo> {
    const { data, error } = await supabase
      .from(this.sharesTable)
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Link público não encontrado.');
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      throw new Error('Este link público expirou.');
    }

    return {
      share: data as CloudFolderShare,
      requiresPassword: Boolean(data.password_hash),
    };
  }

  async listPublicFolders(parentId: string | null): Promise<CloudFolder[]> {
    return this.listFolders(parentId);
  }

  async listPublicFiles(folderId: string): Promise<CloudFile[]> {
    return this.listFiles(folderId, false);
  }

  buildPublicShareUrl(token: string) {
    return `${window.location.origin}/#/cloud/share/${token}`;
  }
}

export const cloudService = new CloudService();
