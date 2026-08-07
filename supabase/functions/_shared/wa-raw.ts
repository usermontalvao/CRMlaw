/**
 * Enxuga o payload cru da Evolution antes de gravá-lo em `whatsapp_messages.raw`.
 *
 * O payload chega com a mídia embutida em base64. Como o webhook JÁ subiu os
 * bytes para o bucket privado antes de inserir a linha, guardar o base64 de novo
 * no `raw` só engordava tudo que vem depois: a linha média ficou em 49 kB (com
 * casos de 12 MB) sendo que o texto da mensagem tem 42 bytes, e cada uma dessas
 * linhas é escrita no WAL, decodificada pelo Realtime e replicada para TODA aba
 * aberta do CRM. Medido no banco: `message.base64` respondia por 34 dos 35 MB da
 * coluna.
 *
 * O que NÃO pode sair: a estrutura. `evolution-send` lê `raw.key` para editar
 * mensagem e `raw.key` + `raw.message` para montar a citação (`quoted`) — por
 * isso aqui se recorta o conteúdo binário e se preserva o formato.
 */

/** Chaves que carregam blob em base64 no payload da Evolution/Baileys. */
const BLOB_KEYS = new Set([
  'base64',              // mídia inteira embutida pelo webhook (o campo mais pesado)
  'jpegThumbnail',       // miniatura de imagem/vídeo/documento/sticker
  'thumbnail',
  'thumbnailBase64',
  'waveform',            // desenho da onda do áudio
  'streamingSidecar',
  'scansSidecar',
  'firstFrameSidecar',
]);

/**
 * Teto por string que sobrevive ao recorte. Rede de segurança: se a Evolution
 * passar a mandar blob num campo novo, a linha continua limitada em vez de
 * voltar a crescer sem ninguém perceber. 8 kB não alcança texto real de
 * conversa (e o texto de verdade mora na coluna `content`, não no `raw`).
 */
export const RAW_MAX_STRING = 8192;

/** Profundidade máxima da recursão — payload da Evolution aninha `contextInfo.quotedMessage`. */
const MAX_DEPTH = 16;

/**
 * Cópia do payload sem os blobs. Não muta a entrada: o webhook ainda lê o base64
 * do objeto original para subir a mídia ao storage.
 */
export function slimWaRaw<T>(value: T, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map(item => slimWaRaw(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (BLOB_KEYS.has(key)) continue;
      out[key] = slimWaRaw(item, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > RAW_MAX_STRING) {
    return `${value.slice(0, RAW_MAX_STRING)}…[+${value.length - RAW_MAX_STRING}]`;
  }
  return value;
}
