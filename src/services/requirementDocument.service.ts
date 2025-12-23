import { supabase } from '../config/supabase';
import type { CreateRequirementDocumentDTO, RequirementDocument } from '../types/requirementDocument.types';

const GENERATED_STORAGE_BUCKET = 'generated-documents';

class RequirementDocumentService {
  private tableName = 'requirement_documents';

  async listByRequirementId(requirementId: string): Promise<RequirementDocument[]> {
    const { data, error } = await supabase
      .from(this.tableName)
      .select('*')
      .eq('requirement_id', requirementId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as RequirementDocument[];
  }

  async create(payload: CreateRequirementDocumentDTO): Promise<RequirementDocument> {
    const { data, error } = await supabase
      .from(this.tableName)
      .insert({
        requirement_id: payload.requirement_id,
        document_type: payload.document_type ?? 'generic',
        file_name: payload.file_name,
        file_path: payload.file_path,
        mime_type: payload.mime_type ?? 'application/pdf',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as RequirementDocument;
  }

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from(this.tableName).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async deleteWithFile(doc: RequirementDocument): Promise<void> {
    await this.delete(doc.id);
    const { error } = await supabase.storage.from(GENERATED_STORAGE_BUCKET).remove([doc.file_path]);
    if (error) {
      throw new Error(error.message);
    }
  }

  async download(doc: RequirementDocument): Promise<Blob> {
    const { data, error } = await supabase.storage.from(GENERATED_STORAGE_BUCKET).download(doc.file_path);
    if (error || !data) throw new Error(error?.message ?? 'Não foi possível baixar o documento.');
    return data;
  }

  async getSignedUrl(doc: RequirementDocument, expiresInSeconds = 60 * 10): Promise<string> {
    const { data, error } = await supabase.storage
      .from(GENERATED_STORAGE_BUCKET)
      .createSignedUrl(doc.file_path, expiresInSeconds);

    if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Não foi possível gerar URL temporária.');
    return data.signedUrl;
  }
}

export const requirementDocumentService = new RequirementDocumentService();
