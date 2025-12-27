import { supabase } from '../config/supabase';
import type {
  StandardPetition,
  CreateStandardPetitionDTO,
  UpdateStandardPetitionDTO,
  StandardPetitionField,
  CreateStandardPetitionFieldDTO,
  UpdateStandardPetitionFieldDTO,
  GeneratedPetitionDocument,
  CreateGeneratedPetitionDocumentDTO,
} from '../types/standardPetition.types';

const STORAGE_BUCKET = 'standard-petitions';

class StandardPetitionService {
  private tableName = 'standard_petitions';
  private fieldsTableName = 'standard_petition_fields';
  private historyTableName = 'generated_petition_documents';

  private async ensureBucket() {
    try {
      const { data } = await supabase.storage.getBucket(STORAGE_BUCKET);
      if (data) return;

      await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: 50 * 1024 * 1024,
        allowedMimeTypes: [
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword',
        ],
      });
    } catch (error) {
      console.warn('Bucket check/creation skipped:', error);
    }
  }

  // ==================== PETIÇÕES ====================

  async listPetitions(): Promise<StandardPetition[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async listActivePetitions(): Promise<StandardPetition[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getPetition(id: string): Promise<StandardPetition | null> {
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

  async getPetitionWithFields(id: string): Promise<StandardPetition | null> {
    const petition = await this.getPetition(id);
    if (!petition) return null;

    const fields = await this.listFields(id);
    return { ...petition, fields };
  }

  async createPetition(payload: CreateStandardPetitionDTO): Promise<StandardPetition> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        ...payload,
        is_active: payload.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createPetitionWithFile(
    payload: CreateStandardPetitionDTO,
    file: File
  ): Promise<StandardPetition> {
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
        is_active: payload.is_active ?? true,
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      .select()
      .single();

    if (error) {
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw new Error(error.message);
    }

    return data;
  }

  async updatePetition(id: string, payload: UpdateStandardPetitionDTO): Promise<StandardPetition> {
    const { data, error } = await supabase
      .from(this.tableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updatePetitionFile(id: string, file: File): Promise<StandardPetition> {
    await this.ensureBucket();

    const petition = await this.getPetition(id);
    if (!petition) throw new Error('Petição não encontrada');

    // Remove old file if exists
    if (petition.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([petition.file_path]);
    }

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
        file_path: filePath,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deletePetition(id: string): Promise<void> {
    const petition = await this.getPetition(id);

    // Remove file if exists
    if (petition?.file_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([petition.file_path]);
    }

    // Delete fields first
    await supabase.from(this.fieldsTableName).delete().eq('petition_id', id);

    const { error } = await supabase.from(this.tableName).delete().eq('id', id);

    if (error) throw new Error(error.message);
  }

  async downloadPetitionFile(petition: StandardPetition): Promise<Blob> {
    if (!petition.file_path) {
      throw new Error('Petição não possui arquivo.');
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(petition.file_path);

    if (error || !data) {
      throw new Error(error?.message ?? 'Erro ao baixar arquivo.');
    }

    return data;
  }

  // ==================== CAMPOS PERSONALIZADOS ====================

  async listFields(petitionId: string): Promise<StandardPetitionField[]> {
    const { data, error } = await supabase
      .from(this.fieldsTableName)
      .select('*')
      .eq('petition_id', petitionId)
      .order('order', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getField(id: string): Promise<StandardPetitionField | null> {
    const { data, error } = await supabase
      .from(this.fieldsTableName)
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(error.message);
    }

    return data;
  }

  async createField(petitionId: string, payload: CreateStandardPetitionFieldDTO): Promise<StandardPetitionField> {
    // Get max order
    const { data: existing } = await supabase
      .from(this.fieldsTableName)
      .select('order')
      .eq('petition_id', petitionId)
      .order('order', { ascending: false })
      .limit(1);

    const maxOrder = existing?.[0]?.order ?? -1;

    const { data, error } = await supabase
      .from(this.fieldsTableName)
      .insert({
        ...payload,
        petition_id: petitionId,
        required: payload.required ?? false,
        order: payload.order ?? maxOrder + 1,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateField(id: string, payload: UpdateStandardPetitionFieldDTO): Promise<StandardPetitionField> {
    const { data, error } = await supabase
      .from(this.fieldsTableName)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteField(id: string): Promise<void> {
    const { error } = await supabase.from(this.fieldsTableName).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async reorderFields(petitionId: string, fieldIds: string[]): Promise<void> {
    const updates = fieldIds.map((id, index) => ({
      id,
      order: index,
    }));

    for (const update of updates) {
      await supabase
        .from(this.fieldsTableName)
        .update({ order: update.order })
        .eq('id', update.id);
    }
  }

  // ==================== HISTÓRICO ====================

  async listGeneratedDocuments(petitionId?: string): Promise<GeneratedPetitionDocument[]> {
    let query = supabase
      .from(this.historyTableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (petitionId) {
      query = query.eq('petition_id', petitionId);
    }

    const { data, error } = await query.limit(100);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createGeneratedDocument(payload: CreateGeneratedPetitionDocumentDTO): Promise<GeneratedPetitionDocument> {
    const { data, error } = await supabase
      .from(this.historyTableName)
      .insert(payload)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

export const standardPetitionService = new StandardPetitionService();
