// Biblioteca de mídias do WhatsApp: o arquivo é cadastrado UMA vez e depois é
// enviado quantas vezes for preciso, sem subir de novo.
//
// O que muda no envio: em vez de `uploadMedia` + `sendMedia`, o item da
// biblioteca já traz o `storage_path`, e o envio é só o segundo passo. É o mesmo
// caminho do "reenviar" de um anexo antigo — a Edge Function `evolution-send` lê
// o objeto do bucket na hora e entrega à Evolution.
import { supabase } from '../../config/supabase';
import { MEDIA_BUCKET, extOf, resolveMediaUrls } from './shared';
import type { WhatsAppMediaLibraryItem, WhatsAppMediaLibraryType } from '../../types/whatsapp.types';

const LIBRARY_TABLE = 'whatsapp_media_library';

/** Teto do bucket `whatsapp-media` (50 MB). Barrar aqui evita erro cru do storage. */
export const MEDIA_LIBRARY_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Que tipo de envio o arquivo pede, a partir do MIME.
 *
 * Não é cosmético: o tipo decide o endpoint da Evolution. Um vídeo classificado
 * como documento chega como anexo para baixar, sem player — e um áudio como
 * documento perde a bolha de voz.
 */
export function tipoDeMidia(mime: string): WhatsAppMediaLibraryType {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Só imagem e vídeo têm o que mostrar em miniatura — áudio e PDF viram ícone. */
const temPrevia = (tipo: WhatsAppMediaLibraryType) => tipo === 'image' || tipo === 'video';

/** URL assinada da miniatura de UM item (null quando o tipo não tem prévia). */
async function previewDe(item: WhatsAppMediaLibraryItem): Promise<string | null> {
  if (!temPrevia(item.type)) return null;
  const byPath = await resolveMediaUrls([item.storage_path]);
  return byPath.get(item.storage_path) ?? null;
}

export interface NovaMidiaSalva {
  name: string;
  category?: string | null;
  caption?: string | null;
  /** Força o tipo do envio; por padrão sai do MIME do arquivo. */
  type?: WhatsAppMediaLibraryType;
}

export const mediaLibraryApi = {
  /**
   * Lista as mídias cadastradas, já com as miniaturas assinadas.
   *
   * Ordem: mais usadas primeiro. Quem manda o mesmo vídeo todo dia encontra ele
   * no topo, que é o ponto de existir a biblioteca.
   */
  async listSavedMedia(opts?: { activeOnly?: boolean }): Promise<WhatsAppMediaLibraryItem[]> {
    let q = supabase.from(LIBRARY_TABLE).select('*')
      .order('usage_count', { ascending: false })
      .order('name', { ascending: true });
    if (opts?.activeOnly !== false) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const itens = (data || []) as WhatsAppMediaLibraryItem[];
    // Assinar áudio e PDF aqui seria uma URL por item que ninguém abre.
    const paths = itens.filter(i => temPrevia(i.type)).map(i => i.storage_path);
    if (paths.length > 0) {
      const byPath = await resolveMediaUrls(paths);
      for (const item of itens) item.preview_url = byPath.get(item.storage_path) ?? null;
    }
    return itens;
  },

  /**
   * Cadastra um arquivo novo: sobe UMA vez para o prefixo `library/` e grava a
   * linha que aponta para ele.
   *
   * O prefixo separa o que é acervo do que é anexo de conversa (`out/…`,
   * `in/…`) — útil para saber o que pode ser limpo e o que não pode.
   */
  async createSavedMedia(file: File, input: NovaMidiaSalva): Promise<WhatsAppMediaLibraryItem> {
    if (file.size === 0) throw new Error('Arquivo vazio.');
    if (file.size > MEDIA_LIBRARY_MAX_BYTES) {
      throw new Error('Arquivo acima de 50 MB — o limite do acervo de mídias.');
    }
    const fileName = file.name || 'arquivo';
    const mime = file.type || 'application/octet-stream';
    const id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const storagePath = `library/${id}.${extOf(fileName, mime)}`;
    const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(storagePath, file, { contentType: mime, upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data: sessao } = await supabase.auth.getUser();
    const { data, error } = await supabase.from(LIBRARY_TABLE).insert({
      name: input.name.trim() || fileName,
      category: input.category?.trim() || null,
      type: input.type || tipoDeMidia(mime),
      storage_path: storagePath,
      mime_type: mime,
      file_name: fileName,
      size_bytes: file.size,
      caption: input.caption?.trim() || null,
      created_by: sessao?.user?.id ?? null,
    }).select('*').single();
    if (error) {
      // O cadastro falhou: o objeto recém-subido não serve para mais nada e
      // ficaria ocupando o bucket sem linha que o encontre.
      await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(error.message);
    }
    const item = data as WhatsAppMediaLibraryItem;
    // A linha volta do banco SEM a URL assinada — e era por isso que a mídia
    // recém-cadastrada aparecia sem prévia até o painel ser reaberto. Assina
    // aqui, antes de devolver, para o cartão já nascer com a imagem.
    item.preview_url = await previewDe(item);
    return item;
  },

  async updateSavedMedia(
    id: string,
    patch: Partial<Pick<WhatsAppMediaLibraryItem, 'name' | 'category' | 'caption' | 'file_name' | 'is_active'>>,
  ): Promise<void> {
    const { error } = await supabase.from(LIBRARY_TABLE).update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  /**
   * Tira a mídia da biblioteca — e NÃO apaga o arquivo do bucket.
   *
   * O mesmo objeto é o que as mensagens já enviadas apontam: removê-lo deixaria
   * um buraco no histórico de todas as conversas que receberam essa mídia, com
   * a bolha apontando para um arquivo que não existe mais.
   */
  async deleteSavedMedia(id: string): Promise<void> {
    const { error } = await supabase.from(LIBRARY_TABLE).delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Soma +1 no contador de uso (no banco, para não perder contagem simultânea). */
  async touchSavedMedia(id: string): Promise<void> {
    await supabase.rpc('wa_media_library_touch', { p_id: id });
  },
};
