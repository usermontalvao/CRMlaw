// Camada de mensagens: leitura da thread, envio de texto/mídia, upload e edição.
import { supabase } from '../../config/supabase';
import type { WhatsAppMessage, SendMediaInput, UploadedMedia, WhatsAppDeleteScope, WaReacao } from '../../types/whatsapp.types';
import { MSG_TABLE, MEDIA_BUCKET, attachSignedUrls, invokeFn, extOf } from './shared';
import { buildSearchTextVariants } from '../../utils/search';

/**
 * Retorno de um envio. `reopened` avisa que a conversa estava encerrada e voltou
 * a ficar aberta por causa deste envio — quem chama usa para corrigir a tela sem
 * esperar o realtime.
 */
export type SendResult = {
  conversation_id: string;
  message_id: string;
  evolution_message_id: string | null;
  reopened: boolean;
};

/**
 * Colunas da mensagem que a tela usa — explícitas de propósito, no lugar de `*`.
 *
 * Fora daqui fica `raw`, o payload cru da Evolution: nada na UI lê esse campo, e
 * ele é de longe a parte mais pesada da linha. Com `*`, abrir uma conversa
 * baixava esse peso todo por mensagem só para jogá-lo fora.
 *
 * Literal numa linha só de propósito: o supabase-js tipa o retorno a partir do
 * texto da consulta, e uma string montada em tempo de execução vira `unknown`.
 */
const MSG_COLUMNS = 'id, conversation_id, evolution_message_id, direction, type, content, media_url, media_mime, storage_path, media_size, media_sha256, file_name, media_duration_seconds, transcription_text, transcription_status, is_animated, reply_to_id, edited_at, reactions, status, sender_user_id, wa_timestamp, created_at, deleted_at, deleted_by, deleted_scope';

/**
 * A mesma lista, com `sender_role` — a marca de "respondeu sem assumir".
 *
 * ── POR QUE DUAS LISTAS ────────────────────────────────────────────────────
 *
 * A coluna nasce numa migration, e migration e front-end sobem em momentos
 * diferentes neste projeto. Pedir uma coluna que ainda não existe faz o
 * PostgREST responder 42703 — e, como esta consulta é a que monta a thread, o
 * efeito não é "a etiqueta não aparece": é a CONVERSA INTEIRA vazia, com a
 * lista lateral funcionando normalmente ao lado. Foi exatamente o que
 * aconteceu.
 *
 * Então a consulta pergunta pela coluna, e se o banco disser que ela não
 * existe, repete sem ela e guarda a resposta para o resto da sessão. Assim a
 * ordem do deploy deixa de importar: front-end novo com banco velho mostra a
 * thread sem a etiqueta, e a etiqueta passa a aparecer sozinha quando a
 * migration subir.
 *
 * As duas são literais (e não uma string montada) porque o supabase-js tipa o
 * retorno a partir do TEXTO da consulta — concatenar em tempo de execução
 * devolveria `unknown` e derrubaria a tipagem da thread inteira.
 */
const MSG_COLUMNS_COM_PAPEL = 'id, conversation_id, evolution_message_id, direction, type, content, media_url, media_mime, storage_path, media_size, media_sha256, file_name, media_duration_seconds, transcription_text, transcription_status, is_animated, reply_to_id, edited_at, reactions, status, sender_user_id, sender_role, wa_timestamp, created_at, deleted_at, deleted_by, deleted_scope';

/** `null` = ainda não se sabe. Vira `false` no primeiro 42703, e nunca volta. */
let bancoTemSenderRole: boolean | null = null;

/** O código que o Postgres usa para "esta coluna não existe". */
const COLUNA_INEXISTENTE = '42703';

function colunasDeMensagem(): string {
  return bancoTemSenderRole === false ? MSG_COLUMNS : MSG_COLUMNS_COM_PAPEL;
}

function ehColunaInexistente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false;
  return erro.code === COLUNA_INEXISTENTE
    || (erro.message ?? '').includes('sender_role');
}

/**
 * Colunas de um ACHADO da busca dentro da conversa.
 *
 * Deliberadamente curta: a busca varre o histórico inteiro (não a janela
 * carregada), e o resultado é uma lista de linhas de uma frase. Trazer mídia,
 * assinaturas e o payload de cada mensagem para desenhar um trecho de texto
 * seria pagar o preço da thread toda para não mostrar nenhuma bolha.
 *
 * Literal numa linha só pelo mesmo motivo das listas acima: o supabase-js tipa
 * o retorno a partir do TEXTO da consulta.
 */
const MSG_COLUMNS_BUSCA = 'id, conversation_id, direction, type, content, transcription_text, file_name, wa_timestamp';

/** Um acerto da busca — o suficiente para a linha do resultado e para o salto. */
export interface WhatsAppMessageHit {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  type: string;
  content: string | null;
  transcription_text: string | null;
  file_name: string | null;
  wa_timestamp: string;
}

/** Escapa o que o PostgREST leria como sintaxe dentro do `or(...)`. */
function padraoIlike(bruto: string): string {
  const escapado = bruto.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"%${escapado}%"`;
}

/**
 * Repete o ILIKE pelas alternativas acentuadas, do mesmo jeito que o e-mail e o
 * feed já fazem: o PostgREST não oferece comparação sem acento, e "pericia"
 * precisa achar "perícia" — é assim que a palavra chega digitada com pressa.
 */
function ouIlikeSemAcento(termo: string, colunas: readonly string[]): string {
  return buildSearchTextVariants(termo)
    .flatMap((variante) => colunas.map((col) => `${col}.ilike.${padraoIlike(variante)}`))
    .join(',');
}

export const messagesApi = {
  /**
   * BUSCA DENTRO DA CONVERSA — no histórico inteiro, não na janela carregada.
   *
   * A thread abre com os 60 últimos e pagina para trás sob demanda. Procurar
   * "onde ele mandou o RG" ou "quanto ficou combinado" no que está na tela só
   * responde quando a resposta é recente; em qualquer conversa de verdade o
   * atendente rolava às cegas até desistir e perguntar de novo ao cliente —
   * que é a pergunta que o escritório já fez e não devia repetir.
   *
   * Por isso a varredura é NO BANCO. O filtro é o mesmo grupo de linhas que
   * monta a thread (`conversationId` aceita as irmãs de outro canal do mesmo
   * contato), então o resultado cobre a pessoa e não o número por onde ela
   * escreveu.
   *
   * TRÊS COLUNAS, e a terceira é a que surpreende:
   *   · `content` — o texto e a legenda da mídia;
   *   · `file_name` — achar o anexo pelo nome ("procuracao.pdf");
   *   · `transcription_text` — O QUE FOI DITO NO ÁUDIO. Metade do que um
   *     cliente conta chega em áudio de dois minutos, e até aqui essa metade
   *     era invisível para qualquer busca do CRM.
   *
   * Apagadas ficam de fora: o histórico não as mostra, e trazê-las no
   * resultado seria oferecer um salto para uma bolha que não existe.
   */
  async searchMessages(
    /**
     * O grupo de linhas a varrer — ou `null` para varrer TUDO que este usuário
     * pode ler. O `null` é a busca da inbox ("em que conversa foi que…?"); a
     * lista de ids é a busca dentro de uma conversa aberta.
     *
     * Quem responde por quais linhas cada um alcança é a policy de
     * `whatsapp_messages`. Do lado da tela, a inbox ainda confere cada achado
     * contra a lista de conversas que ela já tem (recortada por canal duas
     * vezes) — a mesma segunda tranca de `listConversations`.
     */
    conversationId: string | string[] | null,
    term: string,
    opts?: { limit?: number },
  ): Promise<WhatsAppMessageHit[]> {
    const ids = conversationId === null
      ? null
      : (Array.isArray(conversationId) ? conversationId : [conversationId]);
    const termo = term.trim();
    // Uma letra casa com quase tudo: a lista viria cheia e sem serventia, e a
    // varredura custaria o histórico inteiro para nada.
    if ((ids !== null && ids.length === 0) || termo.length < 2) return [];

    let q = supabase.from(MSG_TABLE).select(MSG_COLUMNS_BUSCA);
    if (ids !== null) q = ids.length === 1 ? q.eq('conversation_id', ids[0]) : q.in('conversation_id', ids);
    const { data, error } = await q
      .is('deleted_at', null)
      .or(ouIlikeSemAcento(termo, ['content', 'transcription_text', 'file_name']))
      .order('wa_timestamp', { ascending: false })
      .limit(opts?.limit ?? 80);

    if (error) throw new Error(error.message);
    return ((data || []) as unknown) as WhatsAppMessageHit[];
  },

  /**
   * O TEXTO de uma mensagem, para quem só precisa da prévia do aviso.
   *
   * Existe porque o broadcast `whatsapp:messages` deixou de carregar o conteúdo:
   * o tópico é um só para o escritório inteiro, e o que entra no payload chega a
   * toda aba aberta — inclusive a de quem não enxerga aquele canal. O texto
   * volta a ser lido por HTTP, que é onde o RLS de `whatsapp_messages` responde.
   *
   * Devolve `null` quando a mensagem não existe OU quando este usuário não pode
   * lê-la: são a mesma resposta de propósito. O aviso cai na frase genérica.
   */
  async getPreview(messageId: string): Promise<{ content: string | null; type: string | null } | null> {
    const { data, error } = await supabase
      .from(MSG_TABLE)
      .select('content, type')
      .eq('id', messageId)
      .maybeSingle();
    if (error || !data) return null;
    return { content: (data as any).content ?? null, type: (data as any).type ?? null };
  },

  /**
   * Mensagens de uma conversa — ou de várias, quando o mesmo contato tem thread em
   * mais de um canal do escritório.
   *
   * O WhatsApp entrega uma conversa por número nosso, então quem escreve para dois
   * dos nossos números vira duas linhas em `whatsapp_conversations` (a chave única
   * é `instance_id + remote_jid`). Para o escritório, porém, é uma pessoa só: o
   * atendimento continua o mesmo, mude o número por onde ele chegou. Recebendo a
   * lista de ids irmãos, a thread vira um histórico único ordenado no tempo.
   */
  async listMessages(
    conversationId: string | string[],
    opts?: { limit?: number; before?: string },
  ): Promise<WhatsAppMessage[]> {
    const ids = Array.isArray(conversationId) ? conversationId : [conversationId];
    if (ids.length === 0) return [];
    const limit = opts?.limit ?? 0;
    // A lista de colunas passa a ser escolhida em tempo de execução, e com isso o
    // supabase-js perde a tipagem do retorno (ele a deriva do TEXTO da consulta).
    // O `as unknown` abaixo é o preço, e ele é pago uma vez, aqui: o array já era
    // convertido para `WhatsAppMessage[]` na linha seguinte de qualquer forma.
    const montar = (colunas: string) => {
      let q = supabase.from(MSG_TABLE).select(colunas);
      q = ids.length === 1 ? q.eq('conversation_id', ids[0]) : q.in('conversation_id', ids);
      if (opts?.before) q = q.lt('wa_timestamp', opts.before);
      if (limit > 0) {
        // Busca os N mais recentes em ordem DESC, depois inverte para exibição ASC.
        return q.order('wa_timestamp', { ascending: false }).limit(limit);
      }
      return q.order('wa_timestamp', { ascending: true });
    };

    let { data, error } = await montar(colunasDeMensagem());
    // Banco ainda sem a coluna: repete sem ela e não pergunta de novo. Ver a
    // nota em `MSG_COLUMNS_COM_PAPEL` — sem esta rede, a thread vem VAZIA.
    if (error && ehColunaInexistente(error) && bancoTemSenderRole !== false) {
      bancoTemSenderRole = false;
      ({ data, error } = await montar(MSG_COLUMNS));
    } else if (!error && bancoTemSenderRole === null) {
      bancoTemSenderRole = true;
    }
    if (error) throw new Error(error.message);
    const msgs = ((data || []) as unknown) as WhatsAppMessage[];
    if (limit > 0) msgs.reverse();
    await attachSignedUrls(msgs);
    return msgs;
  },

  async sendText(params: { conversationId?: string; phone?: string; text: string; channelId?: string; replyToId?: string; automated?: boolean }): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      text: params.text,
      channel_id: params.channelId,
      reply_to_id: params.replyToId,
      automated: params.automated === true,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
    };
  },

  /**
   * Envia um CARTÃO DE CONTATO (vCard), não um texto com o número dentro.
   *
   * A diferença aparece do lado de lá: o cartão chega salvável na agenda com um
   * toque, com botão de ligar e de abrir conversa. O texto "o telefone do
   * perito é 65 9xxxx-xxxx" obriga a pessoa a copiar dígito por dígito — e é
   * exatamente aí que o número chega trocado e a ligação vai para outro lugar.
   *
   * O endpoint da Evolution (`/message/sendContact`) já existia e não estava
   * sendo usado por ninguém; ver `evolution-send`.
   */
  async sendContact(params: {
    conversationId?: string;
    phone?: string;
    channelId?: string;
    replyToId?: string;
    /** Um ou mais contatos. `phone` em dígitos ou com máscara — o servidor limpa. */
    contacts: Array<{ name: string; phone: string; organization?: string; email?: string }>;
  }): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      channel_id: params.channelId,
      type: 'contact',
      reply_to_id: params.replyToId,
      contacts: params.contacts,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
    };
  },

  /** Faz upload do arquivo para o bucket privado e devolve os metadados. */
  async uploadMedia(file: File | Blob, opts: { conversationId?: string; fileName?: string }): Promise<UploadedMedia> {
    const name = opts.fileName || (file as File).name || 'arquivo';
    const mime = file.type || 'application/octet-stream';
    const ext = extOf(name, mime);
    const id = (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const path = `out/${opts.conversationId || 'new'}/${id}.${ext}`;
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      contentType: mime, upsert: true,
    });
    if (error) throw new Error(error.message);
    return { storagePath: path, mimeType: mime, fileName: name, size: (file as File).size ?? (file as Blob).size ?? 0 };
  },

  async sendMedia(params: SendMediaInput): Promise<SendResult> {
    const data = await invokeFn('evolution-send', {
      conversation_id: params.conversationId,
      phone: params.phone,
      channel_id: params.channelId,
      type: params.type,
      text: params.text,
      storage_path: params.storagePath,
      mime_type: params.mimeType,
      file_name: params.fileName,
      media_size: params.mediaSize,
      reply_to_id: params.replyToId,
      as_gif: params.asGif === true,
    });
    return {
      conversation_id: data.conversation_id,
      message_id: data.message_id,
      evolution_message_id: data.evolution_message_id ?? null,
      reopened: data.reopened === true,
    };
  },

  sendImage(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'image' }); },
  sendAudio(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'audio' }); },
  sendDocument(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'document' }); },
  sendVideo(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'video' }); },
  /** GIF do seletor: sai como figurinha animada (ver `SendMediaInput.asGif`). */
  sendSticker(p: Omit<SendMediaInput, 'type'>) { return messagesApi.sendMedia({ ...p, type: 'sticker' }); },

  async editMessage(messageId: string, text: string): Promise<void> {
    await invokeFn('evolution-send', { action: 'edit', message_id: messageId, text });
  },

  /**
   * Apaga a mensagem. `scope` decide o alcance:
   *  - 'me'       — some só aqui (soft delete). Serve para qualquer mensagem.
   *  - 'everyone' — revoga também no aparelho do contato. Se a Evolution recusar
   *                 (mensagem velha demais, instância fora do ar), a função NÃO
   *                 marca nada e o erro chega aqui — a tela nunca mostra
   *                 "apagada" numa mensagem que continua no celular do cliente.
   */
  async deleteMessage(messageId: string, scope: WhatsAppDeleteScope): Promise<void> {
    await invokeFn('evolution-send', { action: 'delete', message_id: messageId, scope });
  },

  /**
   * Reage (ou desfaz a reação) a uma mensagem — a reação SAI para o aparelho do
   * contato, como no aplicativo.
   *
   * `emoji` vazio remove a reação, que é exatamente o que o WhatsApp entende.
   * Quem grava a lista é a Edge Function: a reação da equipe e a que chega do
   * contato pelo webhook passam pela mesma regra, e assim as duas não podem
   * divergir. Devolve a lista já atualizada, para a bolha não precisar esperar
   * o realtime.
   */
  async reactToMessage(messageId: string, emoji: string): Promise<WaReacao[]> {
    const data = await invokeFn('evolution-send', {
      action: 'react', message_id: messageId, emoji,
    });
    return Array.isArray(data?.reactions) ? (data.reactions as WaReacao[]) : [];
  },
};
