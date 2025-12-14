import { supabase } from '../config/supabase';
import type { SignatureField, CreateSignatureFieldDTO } from '../types/signature.types';

class SignatureFieldsService {
  private table = 'signature_fields';

  async listByRequest(signatureRequestId: string): Promise<SignatureField[]> {
    const { data, error } = await supabase
      .from(this.table)
      .select('*')
      .eq('signature_request_id', signatureRequestId)
      .order('page_number', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async upsertFields(signatureRequestId: string, fields: Omit<CreateSignatureFieldDTO, 'signature_request_id'>[]) {
    // Estratégia simples: limpar e recriar (evita lidar com ids no frontend)
    const { error: delError } = await supabase
      .from(this.table)
      .delete()
      .eq('signature_request_id', signatureRequestId);

    if (delError) throw new Error(delError.message);

    if (fields.length === 0) return [] as SignatureField[];

    const payload = fields.map((f) => ({
      signature_request_id: signatureRequestId,
      signer_id: f.signer_id ?? null,
      field_type: f.field_type,
      page_number: f.page_number,
      x_percent: f.x_percent,
      y_percent: f.y_percent,
      w_percent: f.w_percent,
      h_percent: f.h_percent,
      required: f.required ?? true,
    }));

    const { data, error } = await supabase.from(this.table).insert(payload).select('*');
    if (error) throw new Error(error.message);

    return data ?? [];
  }
}

export const signatureFieldsService = new SignatureFieldsService();
