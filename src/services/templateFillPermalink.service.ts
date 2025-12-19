import { supabase } from '../config/supabase';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/template-fill-mint`;

export interface PermalinkMintResult {
  success: boolean;
  token?: string;
  error?: string;
}

export const templateFillPermalinkService = {
  /**
   * Cria um novo token de preenchimento a partir de um slug de permalink.
   * Cada chamada gera um token único (o permalink nunca expira).
   */
  async mintToken(slug: string): Promise<PermalinkMintResult> {
    try {
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ slug }),
      });

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('Erro ao mintar token:', error);
      return {
        success: false,
        error: error?.message || 'Erro ao gerar link de preenchimento',
      };
    }
  },

  /**
   * Cria um novo permalink para um template.
   */
  async createPermalink(params: {
    templateId: string;
    slug: string;
    templateFileId?: string | null;
    prefill?: Record<string, string> | null;
  }) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) throw new Error('Usuário não autenticado');

    const { data, error } = await supabase
      .from('template_fill_permalinks')
      .insert({
        template_id: params.templateId,
        slug: params.slug,
        template_file_id: params.templateFileId || null,
        prefill: params.prefill || null,
        created_by: userData.user.id,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Lista permalinks de um template.
   */
  async listPermalinks(templateId: string) {
    const { data, error } = await supabase
      .from('template_fill_permalinks')
      .select('*')
      .eq('template_id', templateId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Desativa um permalink.
   */
  async deactivatePermalink(permalinkId: string) {
    const { error } = await supabase
      .from('template_fill_permalinks')
      .update({ is_active: false })
      .eq('id', permalinkId);

    if (error) throw new Error(error.message);
  },

  /**
   * Ativa um permalink.
   */
  async activatePermalink(permalinkId: string) {
    const { error } = await supabase
      .from('template_fill_permalinks')
      .update({ is_active: true })
      .eq('id', permalinkId);

    if (error) throw new Error(error.message);
  },

  /**
   * Exclui um permalink.
   */
  async deletePermalink(permalinkId: string) {
    const { error } = await supabase
      .from('template_fill_permalinks')
      .delete()
      .eq('id', permalinkId);

    if (error) throw new Error(error.message);
  },
};
