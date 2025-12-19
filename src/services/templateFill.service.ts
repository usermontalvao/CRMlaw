import { supabase } from '../config/supabase';
import type { CustomField, TemplateCustomField } from '../types/document.types';

export type TemplateFillBundle = {
  template: { id: string; name: string; description: string | null };
  mainFile: { file_name: string; signed_url: string };
  customFields: CustomField[];
  templateCustomFields?: TemplateCustomField[];
  prefill: Record<string, string> | null;
};

class TemplateFillService {
  async getBundle(token: string): Promise<TemplateFillBundle> {
    const { data, error } = await supabase.functions.invoke('template-fill', {
      body: { action: 'get', token },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Erro ao carregar link');

    return data as TemplateFillBundle;
  }

  async submit(params: {
    token: string;
    signer: { name: string; email?: string | null; cpf?: string | null; phone?: string | null };
    values: Record<string, string>;
    expires_at?: string | null;
  }): Promise<{ signer_token: string; signature_request_id: string }> {
    const { data, error } = await supabase.functions.invoke('template-fill', {
      body: { action: 'submit', ...params },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Erro ao enviar');

    return {
      signer_token: data.signer_token,
      signature_request_id: data.signature_request_id,
    };
  }
}

export const templateFillService = new TemplateFillService();
