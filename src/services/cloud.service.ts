import { supabase } from '../config/supabase';
import type {
  CloudFile,
  CloudFolder,
  CloudFolderShare,
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

  private async ensureBucket() {
    try {
      const { data } = await supabase.storage.getBucket(CLOUD_BUCKET);
      if (data) return;
      await supabase.storage.createBucket(CLOUD_BUCKET, {
        public: false,
        fileSizeLimit: 1024 * 1024 * 200,
      });
    } catch (error) {
      console.warn('Bucket cloud-files check/creation skipped:', error);
    }
  }

  async hashPassword(password: string) {
    const normalized = String(password || '').trim();
    if (!normalized) return null;
    const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return toHex(buffer);
  }

  async listFolders(parentId: string | null): Promise<CloudFolder[]> {
    let query = supabase
      .from(this.foldersTable)
      .select('*')
      .order('name', { ascending: true });

    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as CloudFolder[]) ?? [];
  }

  async listAllFolders(): Promise<CloudFolder[]> {
    const { data, error } = await supabase
      .from(this.foldersTable)
      .select('*')
      .order('name', { ascending: true });

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
    const [childFolders, childFiles] = await Promise.all([
      this.listFolders(folderId),
      this.listFiles(folderId),
    ]);

    if (childFolders.length > 0 || childFiles.length > 0) {
      throw new Error('A pasta precisa estar vazia antes de ser excluída.');
    }

    const { error } = await supabase
      .from(this.foldersTable)
      .delete()
      .eq('id', folderId);

    if (error) throw new Error(error.message);
  }

  async listFiles(folderId: string): Promise<CloudFile[]> {
    const { data, error } = await supabase
      .from(this.filesTable)
      .select('*')
      .eq('folder_id', folderId)
      .order('original_name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data as CloudFile[]) ?? [];
  }

  async uploadFiles(folderId: string, files: File[], clientId?: string | null): Promise<CloudFile[]> {
    await this.ensureBucket();

    const created: CloudFile[] = [];
    for (const file of files) {
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

      created.push(data as CloudFile);
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

  async getFileSignedUrl(storagePath: string, expiresIn = 60 * 60): Promise<string> {
    const { data, error } = await supabase.storage
      .from(CLOUD_BUCKET)
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Não foi possível gerar link temporário.');
    return data.signedUrl;
  }

  async createShare(payload: CreateCloudShareDTO): Promise<CloudFolderShare> {
    const token = crypto.randomUUID().replace(/-/g, '');
    const password_hash = payload.password ? await this.hashPassword(payload.password) : null;

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

  async listFolderShares(folderId: string): Promise<CloudFolderShare[]> {
    const { data, error } = await supabase
      .from(this.sharesTable)
      .select('*')
      .eq('folder_id', folderId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data as CloudFolderShare[]) ?? [];
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
      .select('*, folder:cloud_folders(*)')
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
      share: data as unknown as CloudFolderShare,
      folder: (data as any).folder as CloudFolder,
    };
  }

  async listPublicFolders(parentId: string | null): Promise<CloudFolder[]> {
    return this.listFolders(parentId);
  }

  async listPublicFiles(folderId: string): Promise<CloudFile[]> {
    return this.listFiles(folderId);
  }

  buildPublicShareUrl(token: string) {
    return `${window.location.origin}/#/cloud/share/${token}`;
  }
}

export const cloudService = new CloudService();
