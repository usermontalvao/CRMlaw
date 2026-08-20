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
  /** O arquivo que vai para o envio — o mesmo `.gif` de 200px da miniatura. */
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
   *
   * Sai SEMPRE como `.gif`, e o nome do arquivo termina em `.gif` de propósito:
   * é a extensão no caminho do arquivo que faz a Evolution reconhecer a
   * animação e converter a figurinha quadro a quadro (ver `evolution-send`).
   */
  async baixar(item: GiphyItem): Promise<File> {
    const url = item.gifUrl;
    if (!url) throw new Error('Este GIF não tem arquivo para enviar.');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Não foi possível baixar o GIF.');
    const blob = await res.blob();
    return new File([blob], `gif-${item.id}.gif`, { type: blob.type || 'image/gif' });
  },
};

export default giphyService;
