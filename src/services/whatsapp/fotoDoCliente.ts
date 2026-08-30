import { supabase } from '../../config/supabase';
import { attachAvatarUrls } from './shared';

/**
 * A FOTO DO CLIENTE VEM DO WHATSAPP DELE.
 *
 * Antes vinha da selfie tirada no ato da assinatura, mediante uma autorização
 * opcional marcada no formulário. Isso foi removido (Termos v2), por dois
 * motivos que se somam:
 *
 *  · a selfie existe como PROVA. Dar a ela uma segunda finalidade — ilustrar
 *    uma ficha — enfraquece a primeira: uma imagem que circula pelo sistema
 *    como avatar é uma imagem cuja cadeia de custódia alguém vai questionar.
 *  · a foto do WhatsApp é dado que o próprio cliente publicou para ser visto
 *    por quem conversa com ele. Usá-la não cria coleta nova nem finalidade
 *    nova, e por isso não precisa de autorização à parte.
 *
 * Resolve duas coisas de uma vez: tira a selfie de circulação e a ficha
 * continua com rosto.
 */

/** Caminho da foto do WhatsApp de cada cliente, pelas conversas vinculadas. */
export async function caminhosDeFotoPorCliente(
  clientIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(clientIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('client_id, contact_avatar_path, last_message_at')
    .in('client_id', ids)
    .not('contact_avatar_path', 'is', null)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error || !data) return new Map();

  // Um cliente pode ter mais de uma conversa (números diferentes, canais
  // diferentes). Fica a da conversa mais recente — é a que reflete o contato
  // que o escritório usa hoje.
  const porCliente = new Map<string, string>();
  for (const linha of data as Array<{ client_id: string | null; contact_avatar_path: string | null }>) {
    const id = linha.client_id;
    const caminho = linha.contact_avatar_path;
    if (!id || !caminho || porCliente.has(id)) continue;
    porCliente.set(id, caminho);
  }
  return porCliente;
}

/**
 * URL assinada da foto do WhatsApp de cada cliente.
 *
 * Passa pelo `attachAvatarUrls`, o mesmo caminho (e o mesmo cache) que a inbox
 * já usa — quem abriu o WhatsApp costuma ver a lista de clientes com rosto sem
 * uma ida a mais ao storage.
 */
export async function fotosDeClientePorWhatsApp(
  clientIds: readonly string[],
): Promise<Map<string, { url: string; path: string }>> {
  const caminhos = await caminhosDeFotoPorCliente(clientIds);
  if (caminhos.size === 0) return new Map();

  const entradas = Array.from(caminhos.entries());
  const paraAssinar = entradas.map(([, caminho]) => ({
    contact_avatar_path: caminho,
    contact_avatar_url: null as string | null,
  }));
  await attachAvatarUrls(paraAssinar);

  const resultado = new Map<string, { url: string; path: string }>();
  entradas.forEach(([clientId, caminho], i) => {
    const url = paraAssinar[i].contact_avatar_url;
    if (url) resultado.set(clientId, { url, path: caminho });
  });
  return resultado;
}
