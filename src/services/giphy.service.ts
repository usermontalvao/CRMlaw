/**
 * services/giphy
 * -----------------------------------------------------------------------------
 * Seletor de GIF do compositor do WhatsApp.
 *
 * A chave da API não vive aqui: ela fica no secret `GIPHY` do projeto e só é
 * lida pela Edge Function `giphy-proxy`. Qualquer chave em `VITE_*` acabaria
 * dentro do bundle e, portanto, pública.
 */
import { invokeFn } from './whatsapp/shared';

export interface GiphyItem {
  id: string;
  titulo: string;
  /** Miniatura da grade (largura fixa). */
  previewUrl: string;
  largura: number;
  altura: number;
  /** Preferido no envio — o WhatsApp converte GIF para mp4 de qualquer jeito. */
  mp4Url: string | null;
  gifUrl: string | null;
}

export const giphyService = {
  /** Em alta (sem termo) ou resultado da busca. */
  async list(params: { q?: string; offset?: number; limit?: number } = {}): Promise<GiphyItem[]> {
    const q = (params.q ?? '').trim();
    const { itens } = await invokeFn<{ itens: GiphyItem[] }>('giphy-proxy', {
      action: q ? 'search' : 'trending',
      q,
      offset: params.offset ?? 0,
      limit: params.limit ?? 24,
    });
    return itens ?? [];
  },

  /**
   * Baixa o GIF escolhido como arquivo, pronto para o upload que o envio de
   * mídia já faz. O CDN do Giphy responde com CORS liberado, então o download
   * é direto do navegador — passar esses megabytes pela Edge Function só
   * adicionaria uma volta e um limite de tamanho no caminho.
   */
  async baixar(item: GiphyItem): Promise<File> {
    const url = item.mp4Url || item.gifUrl;
    if (!url) throw new Error('Este GIF não tem arquivo para enviar.');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Não foi possível baixar o GIF.');
    const blob = await res.blob();
    const mp4 = url.endsWith('.mp4');
    const nome = `gif-${item.id}.${mp4 ? 'mp4' : 'gif'}`;
    return new File([blob], nome, { type: blob.type || (mp4 ? 'video/mp4' : 'image/gif') });
  },
};

export default giphyService;
