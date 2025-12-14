import { supabase } from '../config/supabase';
import type { DocumentTemplate, CreateDocumentTemplateDTO, GeneratedDocument, CreateGeneratedDocumentDTO } from '../types/document.types';

const STORAGE_BUCKET = 'document-templates';
const GENERATED_STORAGE_BUCKET = 'generated-documents';

class DocumentTemplateService {
  private tableName = 'document_templates';
  private historyTableName = 'generated_documents';

  private async ensureBucket() {
    try {
      const { data } = await supabase.storage.getBucket(STORAGE_BUCKET);
      if (data) return;

      await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
      });
    } catch (error) {
      // ignore bucket creation errors on client (likely due to permissions)
      console.warn('Bucket check/creation skipped:', error);
    }
  }

  private async ensureGeneratedBucket() {
    try {
      const { data } = await supabase.storage.getBucket(GENERATED_STORAGE_BUCKET);
      if (data) return;

      await supabase.storage.createBucket(GENERATED_STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
      });
    } catch (error) {
      console.warn('Bucket check/creation skipped:', error);
    }
  }

  async uploadGeneratedDocument(blob: Blob, originalName: string) {
    await this.ensureGeneratedBucket();

    const extension = originalName.split('.').pop() ?? 'docx';
    const filePath = `${crypto.randomUUID()}.${extension}`;
    const contentType = blob.type || 'application/octet-stream';

    const { error } = await supabase.storage
      .from(GENERATED_STORAGE_BUCKET)
      .upload(filePath, blob, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    return { filePath, mimeType: contentType };
  }

  async listTemplates(): Promise<DocumentTemplate[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getTemplate(id: string): Promise<DocumentTemplate | null> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  async getTemplateSignedUrl(template: DocumentTemplate, expiresInSeconds = 60 * 5) {
    if (!template.file_path) {
      throw new Error('Template não possui arquivo para visualização.');
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(template.file_path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Não foi possível gerar link temporário.');
    }

    return data.signedUrl;
  }

  async createTemplate(payload: CreateDocumentTemplateDTO): Promise<DocumentTemplate> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createTemplateWithFile(
    payload: CreateDocumentTemplateDTO,
    file: File
  ): Promise<DocumentTemplate> {
    await this.ensureBucket();

    const extension = file.name.split('.').pop() ?? 'docx';
    const filePath = `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      .select()
      .single();

    if (error) {
      // rollback file if db insert fails
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw new Error(error.message);
    }

    return data;
  }

  async updateTemplate(id: string, payload: Partial<CreateDocumentTemplateDTO>): Promise<DocumentTemplate> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateTemplateWithFile(
    template: DocumentTemplate,
    payload: Partial<CreateDocumentTemplateDTO>,
    file: File,
  ): Promise<DocumentTemplate> {
    await this.ensureBucket();

    const extension = file.name.split('.').pop() ?? 'docx';
    const filePath = `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data, error } = await supabase
      .from(this.tableName)
      .update({
        ...payload,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      .eq('id', template.id)
      .select()
      .single();

    if (error) {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw new Error(error.message);
    }

    if (template.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([template.file_path]);
    }

    return data;
  }

  async deleteTemplate(id: string): Promise<void> {
    const existing = await this.getTemplate(id);
    if (!existing) return;

    const { error } = await supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);

    if (existing.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([existing.file_path]);
    }
  }

  async downloadTemplateFile(template: DocumentTemplate) {
    if (!template.file_path) {
      throw new Error('Template não possui arquivo associado.');
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(template.file_path);

    if (error || !data) throw new Error(error?.message ?? 'Falha ao baixar arquivo');

    return data;
  }

  // Generated Documents History
  async listGeneratedDocuments(): Promise<GeneratedDocument[]> {
    const { data, error } = await supabase
      .from(this.historyTableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createGeneratedDocument(payload: CreateGeneratedDocumentDTO): Promise<GeneratedDocument> {
    const { data, error } = await supabase
      .from(this.historyTableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteGeneratedDocument(id: string): Promise<void> {
    const { error } = await supabase
      .from(this.historyTableName)
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async downloadGeneratedDocument(record: GeneratedDocument) {
    if (!record.file_path) {
      throw new Error('Documento do histórico não possui arquivo armazenado.');
    }

    const { data, error } = await supabase.storage
      .from(GENERATED_STORAGE_BUCKET)
      .download(record.file_path);

    if (error || !data) {
      throw new Error(error?.message ?? 'Não foi possível baixar o documento do histórico.');
    }

    return data;
  }

  async getGeneratedDocumentSignedUrl(record: GeneratedDocument, expiresInSeconds = 60 * 10) {
    if (!record.file_path) {
      throw new Error('Documento do histórico não possui arquivo armazenado.');
    }

    const { data, error } = await supabase.storage
      .from(GENERATED_STORAGE_BUCKET)
      .createSignedUrl(record.file_path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Não foi possível gerar link temporário do documento.');
    }

    return data.signedUrl;
  }
}

export const documentTemplateService = new DocumentTemplateService();
