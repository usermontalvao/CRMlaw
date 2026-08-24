import { supabase } from '../config/supabase';
import type { CustomField, TemplateCustomField } from '../types/document.types';

export type TemplateFillBundle = {
  template: { id: string; name: string; description: string | null };
  mainFile: { file_name: string; signed_url: string };
  customFields: CustomField[];
  templateCustomFields?: TemplateCustomField[];
  prefill: Record<string, string> | null;
};

export type OfficeContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
};

/**
 * O que o link de preenchimento devolve quando o kit JÁ ANDOU.
 *
 * `sign`   → o formulário já foi enviado; o token é o do signatário.
 * `verify` → já foi assinado; o token é o código de verificação do documento.
 *
 * Só o token vem do servidor: a URL é montada aqui, por quem conhece o domínio
 * público (ver `publicAppUrl.ts`).
 */
export type TemplateFillRedirect = { kind: 'sign' | 'verify'; token: string };

class TemplateFillService {
  /**
   * Devolve o kit para preencher — ou, quando o link já cumpriu seu papel, para
   * onde a pessoa deve ir em vez de ver "link indisponível".
   */
  async getBundle(token: string): Promise<TemplateFillBundle | { redirect: TemplateFillRedirect }> {
    const { data, error } = await supabase.functions.invoke('template-fill', {
      body: { action: 'get', token },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Erro ao carregar link');

    if (data.redirect?.token && (data.redirect.kind === 'sign' || data.redirect.kind === 'verify')) {
      return { redirect: data.redirect as TemplateFillRedirect };
    }

    return data as TemplateFillBundle;
  }

  /** Contato público do escritório (nome, telefone, e-mail, logo) para telas públicas. */
  async getOfficeContact(): Promise<OfficeContact> {
    try {
      const { data, error } = await supabase.functions.invoke('template-fill', {
        body: { action: 'contact' },
      });
      if (error || !data?.success) return { name: null, phone: null, email: null, logo_url: null };
      return data.office as OfficeContact;
    } catch {
      return { name: null, phone: null, email: null, logo_url: null };
    }
  }

  async heartbeat(token: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('template-fill', {
      body: { action: 'heartbeat', token },
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Erro ao registrar atividade');
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
