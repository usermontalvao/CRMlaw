import { supabase } from '../config/supabase';
import type { DocumentTemplate, CreateDocumentTemplateDTO, GeneratedDocument, CreateGeneratedDocumentDTO, SignatureFieldConfigValue, TemplateFile, CustomField, CreateCustomFieldDTO, UpdateCustomFieldDTO, TemplateCustomField, UpsertTemplateCustomFieldDTO } from '../types/document.types';

const STORAGE_BUCKET = 'document-templates';
const GENERATED_STORAGE_BUCKET = 'generated-documents';

class DocumentTemplateService {
  private tableName = 'document_templates';
  private historyTableName = 'generated_documents';
  private templateCustomFieldsTableName = 'template_custom_fields';

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

  // Atualizar configuração de campo de assinatura do template
  async updateSignatureFieldConfig(
    templateId: string,
    config: SignatureFieldConfigValue
  ): Promise<DocumentTemplate> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update({ signature_field_config: config })
      .eq('id', templateId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // ========== MÉTODOS PARA MÚLTIPLOS ARQUIVOS POR TEMPLATE ==========

  // Listar arquivos de um template
  async listTemplateFiles(templateId: string): Promise<TemplateFile[]> {
    const { data, error } = await supabase
      .from('template_files')
      .select('*')
      .eq('template_id', templateId)
      .order('order', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // Adicionar arquivo a um template
  async addTemplateFile(templateId: string, file: File, order?: number): Promise<TemplateFile> {
    await this.ensureBucket();

    const extension = file.name.split('.').pop() ?? 'docx';
    const filePath = `${templateId}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    // Obter próxima ordem se não especificada
    let fileOrder = order;
    if (fileOrder === undefined) {
      const { data: existingFiles } = await supabase
        .from('template_files')
        .select('order')
        .eq('template_id', templateId)
        .order('order', { ascending: false })
        .limit(1);
      
      fileOrder = existingFiles && existingFiles.length > 0 ? existingFiles[0].order + 1 : 0;
    }

    const { data, error } = await supabase
      .from('template_files')
      .insert({
        template_id: templateId,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        file_size: file.size,
        order: fileOrder,
      })
      .select()
      .single();

    if (error) {
      // Rollback: remover arquivo se insert falhar
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw new Error(error.message);
    }

    return data;
  }

  // Remover arquivo de um template
  async removeTemplateFile(fileId: string): Promise<void> {
    // Primeiro, obter o arquivo para saber o path
    const { data: file, error: fetchError } = await supabase
      .from('template_files')
      .select('file_path')
      .eq('id', fileId)
      .single();

    if (fetchError) throw new Error(fetchError.message);

    // Remover do storage
    if (file?.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([file.file_path]);
    }

    // Remover do banco
    const { error } = await supabase
      .from('template_files')
      .delete()
      .eq('id', fileId);

    if (error) throw new Error(error.message);
  }

  // Atualizar ordem dos arquivos
  async updateTemplateFileOrder(fileId: string, newOrder: number): Promise<void> {
    const { error } = await supabase
      .from('template_files')
      .update({ order: newOrder })
      .eq('id', fileId);

    if (error) throw new Error(error.message);
  }

  // Atualizar configuração de assinatura de um arquivo específico
  async updateTemplateFileSignatureConfig(
    fileId: string,
    config: SignatureFieldConfigValue
  ): Promise<TemplateFile> {
    const { data, error } = await supabase
      .from('template_files')
      .update({ signature_field_config: config })
      .eq('id', fileId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Download de arquivo específico do template
  async downloadTemplateFileById(fileId: string): Promise<Blob> {
    const { data: file, error: fetchError } = await supabase
      .from('template_files')
      .select('file_path')
      .eq('id', fileId)
      .single();

    if (fetchError || !file?.file_path) {
      throw new Error('Arquivo não encontrado.');
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(file.file_path);

    if (error || !data) {
      throw new Error(error?.message ?? 'Não foi possível baixar o arquivo.');
    }

    return data;
  }

  // Obter template com todos os arquivos
  async getTemplateWithFiles(templateId: string): Promise<DocumentTemplate & { files: TemplateFile[] }> {
    const template = await this.getTemplate(templateId);
    if (!template) throw new Error('Template não encontrado.');

    const files = await this.listTemplateFiles(templateId);

    return { ...template, files };
  }

  async listTemplateCustomFields(templateId: string): Promise<TemplateCustomField[]> {
    const { data, error } = await supabase
      .from(this.templateCustomFieldsTableName)
      .select('*')
      .eq('template_id', templateId)
      .order('order', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async replaceTemplateCustomFields(templateId: string, fields: UpsertTemplateCustomFieldDTO[]) {
    const { error: delError } = await supabase
      .from(this.templateCustomFieldsTableName)
      .delete()
      .eq('template_id', templateId);

    if (delError) throw new Error(delError.message);

    if (fields.length === 0) return [] as TemplateCustomField[];

    const payload = fields.map((f) => ({
      template_id: templateId,
      name: f.name,
      placeholder: f.placeholder,
      field_type: f.field_type,
      enabled: f.enabled,
      required: f.required,
      default_value: f.default_value ?? null,
      options: f.options ?? null,
      description: f.description ?? null,
      order: f.order,
    }));

    const { data, error } = await supabase.from(this.templateCustomFieldsTableName).insert(payload).select('*');
    if (error) throw new Error(error.message);

    return data ?? [];
  }

  // ==================== CAMPOS PERSONALIZADOS GLOBAIS ====================

  // Listar todos os campos personalizados globais
  async listCustomFields(): Promise<CustomField[]> {
    const { data, error } = await supabase
      .from('document_custom_fields')
      .select('*')
      .order('order', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // Obter um campo personalizado por ID
  async getCustomField(id: string): Promise<CustomField | null> {
    const { data, error } = await supabase
      .from('document_custom_fields')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  // Criar campo personalizado global
  async createCustomField(dto: CreateCustomFieldDTO): Promise<CustomField> {
    // Obter a maior ordem atual
    const { data: existingFields } = await supabase
      .from('document_custom_fields')
      .select('order')
      .order('order', { ascending: false })
      .limit(1);

    const nextOrder = dto.order ?? ((existingFields?.[0]?.order ?? -1) + 1);

    const { data, error } = await supabase
      .from('document_custom_fields')
      .insert({
        name: dto.name,
        placeholder: dto.placeholder.toUpperCase().replace(/\s+/g, '_'),
        field_type: dto.field_type,
        required: dto.required ?? false,
        default_value: dto.default_value,
        options: dto.options,
        description: dto.description,
        order: nextOrder,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Atualizar campo personalizado
  async updateCustomField(id: string, dto: UpdateCustomFieldDTO): Promise<CustomField> {
    const updateData: Record<string, unknown> = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.placeholder !== undefined) updateData.placeholder = dto.placeholder.toUpperCase().replace(/\s+/g, '_');
    if (dto.field_type !== undefined) updateData.field_type = dto.field_type;
    if (dto.required !== undefined) updateData.required = dto.required;
    if (dto.default_value !== undefined) updateData.default_value = dto.default_value;
    if (dto.options !== undefined) updateData.options = dto.options;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.order !== undefined) updateData.order = dto.order;

    const { data, error } = await supabase
      .from('document_custom_fields')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Excluir campo personalizado
  async deleteCustomField(id: string): Promise<void> {
    const { error } = await supabase
      .from('document_custom_fields')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // Reordenar campos personalizados
  async reorderCustomFields(fieldIds: string[]): Promise<void> {
    const updates = fieldIds.map((id, index) => ({
      id,
      order: index,
    }));

    for (const update of updates) {
      const { error } = await supabase
        .from('document_custom_fields')
        .update({ order: update.order })
        .eq('id', update.id);

      if (error) throw new Error(error.message);
    }
  }
}

export const documentTemplateService = new DocumentTemplateService();
