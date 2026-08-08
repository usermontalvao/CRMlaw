// Notificador global de WhatsApp: som + aviso visual quando chega uma mensagem
// nova de uma conversa ATRIBUÍDA A MIM ("minha"). Vive no nível do App, porque
// precisa alcançar qualquer tela — inclusive o próprio módulo do WhatsApp.
//
// TRÊS CAMADAS (a mesma ideia do WhatsApp: o aviso muda conforme onde você
// está, em vez de ser tudo ou nada):
//   'global'  — outra tela do CRM, ou aba escondida. Toque cheio + cartão
//               clicável + notificação do sistema (só com a aba fora de vista).
//   'inbox'   — dentro do WhatsApp, mensagem em OUTRA conversa. Toque de uma
//               nota + cartão. Era exatamente o caso que não avisava nada.
//   'in-chat' — na conversa que já está aberta. Só um toque grave e baixo: a
//               mensagem já está entrando na tela, o cartão seria ruído. É
//               também a única camada que não exige que a conversa seja
//               "minha" — quem está com ela aberta está atendendo.
//
// LATÊNCIA: dispara no INSERT da mensagem (sinal mais cedo — antes do webhook
// gravar o UPDATE da conversa). O filtro "é minha?" usa um cache de atribuição
// (assigned_user_id) mantido vivo pelos eventos de conversa, com fetch só no
// cache-miss — assim o aviso sai praticamente junto com a mensagem.
import { useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { whatsappService } from '../services/whatsapp.service';
import { muteStore } from '../services/whatsapp/muteStore';
import { notifyScope } from '../services/whatsapp/notifyScope';
import { resolveAvatarUrl, resolveMediaUrl } from '../services/whatsapp/shared';
import { signatureService } from '../services/signature.service';
import { playNotificationSound, isNotifySoundMuted, isInChatSoundMuted } from '../utils/notificationSound';
import { events, SYSTEM_EVENTS } from '../utils/events';

const SOUND_THROTTLE_MS = 1500; // evita rajada de "dings" em mensagens em sequência
// O toque da conversa aberta acompanha a digitação de quem está do outro lado
// (mensagens curtas em sequência). Estrangular por 1,5s comeria toques que ali
// são justamente o feedback do que está chegando; 500ms só evita a metralhadora.
const IN_CHAT_THROTTLE_MS = 500;

// Dedup em escopo de módulo (não por instância do hook): sobrevive a qualquer
// re-subscrição/StrictMode e impede a MESMA mensagem de notificar duas vezes.
const recentlyNotified = new Map<string, number>();
function claimNotification(key: string): boolean {
  const now = Date.now();
  for (const [k, t] of recentlyNotified) if (now - t > 60_000) recentlyNotified.delete(k);
  if (recentlyNotified.has(key)) return false;
  recentlyNotified.set(key, now);
  return true;
}

// Cache de metadados de conversa (atribuição/nome/foto) para filtrar sem fetch.
interface ConvMeta {
  assigned_user_id: string | null;
  contact_name: string | null;
  contact_phone: string;
  is_blocked: boolean;
  contact_avatar_path: string | null;
  client_id: string | null;
}
const convMetaCache = new Map<string, ConvMeta>();

/**
 * Cadastro do cliente vinculado (nome completo + foto pinada). O aviso mostra o
 * nome do CADASTRO, não o apelido que o contato escolheu no WhatsApp: é o nome
 * pelo qual o escritório conhece a pessoa, o mesmo que aparece na lista de
 * conversas e no cabeçalho da conversa. Cache no escopo do módulo — uma
 * consulta por cliente, não por mensagem.
 */
interface ClientMeta { full_name: string | null; photo_path: string | null }
const clientMetaCache = new Map<string, ClientMeta>();

async function clientMetaOf(clientId: string): Promise<ClientMeta | null> {
  const cached = clientMetaCache.get(clientId);
  if (cached) return cached;
  const { data } = await supabase
    .from('clients')
    .select('full_name, photo_path')
    .eq('id', clientId)
    .maybeSingle();
  if (!data) return null;
  const meta: ClientMeta = {
    full_name: (data as any).full_name ?? null,
    photo_path: (data as any).photo_path ?? null,
  };
  clientMetaCache.set(clientId, meta);
  return meta;
}

/** O que chegou — o cartão desenha o ícone e a frase a partir disso. */
type NotifyKind = 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker';
function kindOf(type?: string | null): NotifyKind {
  switch (type) {
    case 'audio': case 'image': case 'video': case 'document': case 'sticker':
      return type;
    default:
      return 'text';
  }
}

/**
 * Preview curto da mensagem a partir da própria linha (sem esperar a conversa).
 * Mídia sem legenda volta VAZIA de propósito: quem diz "Mensagem de voz" ou
 * "Foto" é o cartão, com ícone — escrever a palavra aqui produzia aquele
 * "Áudio" solto no lugar da mensagem.
 */
function previewOf(msg: { content?: string | null; type?: string | null }): string {
  const content = (msg.content ?? '').toString().trim();
  if (content) return content.slice(0, 120);
  return kindOf(msg.type) === 'text' ? 'Nova mensagem' : '';
}

/** Segundos → "0:07" / "4:12", o formato do próprio WhatsApp. */
function durationLabel(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const total = Math.round(seconds);
  return ` (${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')})`;
}

/**
 * Texto para a notificação do sistema, que só aceita uma linha de corpo.
 *
 * A duração entra no áudio e no vídeo porque é ela que diz se vale interromper o
 * que se está fazendo — sem o número, um "ok" de 3 segundos e um relato de 4
 * minutos produziam exatamente o mesmo aviso.
 */
function systemBodyOf(preview: string, kind: NotifyKind, fileName?: string | null, durationSeconds?: number | null): string {
  if (preview) return preview;
  switch (kind) {
    case 'audio': return `🎤 Mensagem de voz${durationLabel(durationSeconds)}`;
    case 'image': return '📷 Foto';
    case 'video': return `🎬 Vídeo${durationLabel(durationSeconds)}`;
    case 'document': return `📄 ${fileName || 'Documento'}`;
    case 'sticker': return 'Figurinha';
    default: return 'Nova mensagem';
  }
}

interface Params {
  /** Usuário atual; sem ele não há escopo "minha" para filtrar. */
  userId: string | undefined;
  /** true quando o módulo WhatsApp é a tela ativa (define a camada do aviso). */
  inModule: boolean;
  /** Abre o módulo WhatsApp já na conversa que recebeu a mensagem. */
  onOpen: (conversationId: string) => void;
}

export function useWhatsAppNotifications({ userId, inModule, onOpen }: Params): void {
  const inModuleRef = useRef(inModule);
  const onOpenRef = useRef(onOpen);
  const lastSoundRef = useRef(0);

  // Refs atualizadas a cada render → inscrição realtime ESTÁVEL (deps só [userId])
  // sem capturar valores velhos.
  useEffect(() => { inModuleRef.current = inModule; }, [inModule]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);

  // Pede permissão de notificação do navegador uma vez (sem insistir se negada).
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Carrega + mantém vivo o estado de silenciamento (usado abaixo para filtrar).
  useEffect(() => { if (userId) void muteStore.init(); }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // O cache vive no escopo do módulo (sobrevive a re-inscrições), então trocar
    // de usuário na mesma aba — turno seguinte no computador compartilhado da
    // recepção — herdaria as atribuições de quem saiu, e o filtro "é minha?"
    // responderia pela pessoa errada. Cada login começa do zero.
    convMetaCache.clear();
    clientMetaCache.clear();

    // Mantém o cache de atribuição fresco (a conversa muda de dono ao ser assumida/
    // transferida). Não notifica daqui — é só cache para o gatilho de mensagem.
    const unsubConv = whatsappService.subscribeConversationNotifications((payload) => {
      const row = payload.new as Record<string, any> | undefined;
      if (!row?.id) return;
      convMetaCache.set(row.id, {
        assigned_user_id: row.assigned_user_id ?? null,
        contact_name: row.contact_name ?? null,
        contact_phone: (row.contact_phone ?? '').toString(),
        is_blocked: row.is_blocked === true,
        contact_avatar_path: row.contact_avatar_path ?? null,
        client_id: row.client_id ?? null,
      });
    });

    // Gatilho rápido: INSERT da mensagem recebida.
    const unsubMsg = whatsappService.subscribeInboundMessages((msg) => {
      if (msg.direction !== 'in') return;
      const convId = msg.conversation_id;
      if (!convId) return;

      // Dedup por mensagem (id é único e estável).
      if (!claimNotification(`msg:${msg.id}`)) return;

      void (async () => {
        // Resolve metadados: cache → fetch (só no miss).
        let meta = convMetaCache.get(convId);
        if (!meta) {
          const fetched = await whatsappService.getConversationMeta(convId);
          if (fetched) {
            meta = {
              assigned_user_id: fetched.assigned_user_id,
              contact_name: fetched.contact_name,
              contact_phone: fetched.contact_phone,
              is_blocked: fetched.is_blocked,
              contact_avatar_path: fetched.contact_avatar_path ?? null,
              client_id: fetched.client_id ?? null,
            };
            convMetaCache.set(convId, meta);
          }
        }
        if (!meta) return;

        if (meta.is_blocked) return;

        // Conversa silenciada por este usuário → nenhuma notificação.
        if (muteStore.isMuted(convId)) return;

        // Onde a pessoa está agora decide TUDO daqui para baixo: o toque, o
        // cartão e a notificação do sistema. Quem deixa o CRM aberto na tela do
        // WhatsApp e vai trabalhar noutra janela cai em 'global' pela aba
        // escondida — é quem mais precisa do aviso, não quem menos precisa.
        const documentVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
        const tier = notifyScope.tierFor(convId, { inModule: inModuleRef.current, documentVisible });

        // Escopo ESTRITO "minhas" para chamar a atenção de quem está noutra
        // tela ou noutra conversa: fila e conversas de outros atendentes não
        // interrompem ninguém. A conversa ABERTA na frente da pessoa é o único
        // caso fora da regra — ali o toque é confirmação do que já está
        // aparecendo na tela, e perguntar "de quem é essa conversa?" para
        // decidir se confirma seria arbitrário.
        if (tier !== 'in-chat' && meta.assigned_user_id !== userId) return;

        // Nome e rosto: o CADASTRO manda. O contato pode ter salvo "Zé" no
        // perfil do WhatsApp; na tela do escritório ele é "José Carlos da Silva
        // Pereira", com a foto do cadastro. Sem cliente vinculado (ou sem
        // cadastro achado), cai no nome/avatar do WhatsApp e, por fim, no número.
        const client = meta.client_id ? await clientMetaOf(meta.client_id).catch(() => null) : null;
        const name = client?.full_name || meta.contact_name || meta.contact_phone || 'Contato';
        const preview = previewOf(msg);
        const kind = kindOf(msg.type);

        // Visual (in-app): cartão clicável, renderizado pelo host global
        // (WhatsAppNotifyHost) — aparece em qualquer tela, inclusive dentro do
        // módulo. Na conversa já aberta não há cartão: a mensagem está entrando
        // na tela e um aviso apontando para ela seria ruído.
        // O CAMINHO da foto vai no evento, não a URL assinada: assinar é uma ida
        // à rede, e o cartão não pode esperar por ela para aparecer. Quem exibe
        // resolve a foto depois e ela entra por cima das iniciais.
        if (tier !== 'in-chat') {
          events.emit(SYSTEM_EVENTS.WHATSAPP_NOTIFY, {
            conversationId: convId, name, preview, tier, kind,
            at: Date.now(),
            clientPhotoPath: client?.photo_path ?? null,
            avatarPath: meta.contact_avatar_path,
            // O id vai junto para quem exibe poder buscar a miniatura e a
            // duração da mídia. Vai como ID, e não com os dados já resolvidos,
            // porque resolvê-los aqui atrasaria o cartão em uma ida à rede — e o
            // cartão precisa aparecer junto com a mensagem, não depois dela.
            messageId: msg.id,
          });
        }

        // Som (respeitando o mute por preferência local). O toque da conversa
        // aberta tem chave própria — dá para calar só ele.
        const soundOn = !isNotifySoundMuted() && !(tier === 'in-chat' && isInChatSoundMuted());
        if (soundOn) {
          const now = Date.now();
          const throttle = tier === 'in-chat' ? IN_CHAT_THROTTLE_MS : SOUND_THROTTLE_MS;
          if (now - lastSoundRef.current > throttle) {
            lastSoundRef.current = now;
            playNotificationSound(tier);
          }
        }

        // Notificação do sistema: só com a aba fora de vista. Com o CRM na
        // frente ela duplica o cartão e ainda rouba o foco do sistema
        // operacional — é o tipo de excesso que faz desligar tudo.
        if (!documentVisible && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            // Com a aba escondida ninguém está esperando o aviso na tela, então
            // aqui dá para assinar a foto antes de mostrar: a notificação do
            // sistema sai com o rosto do contato, como a do celular. A foto do
            // cadastro tem preferência, igual ao cartão.
            const fromClient = client?.photo_path
              ? await signatureService.getSignedImageUrl(client.photo_path, 3600).catch(() => null)
              : null;
            const icon = fromClient ?? await resolveAvatarUrl(meta.contact_avatar_path).catch(() => null);

            // Mídia: a mesma consulta que alimenta o cartão. Aqui ela pode ser
            // esperada porque a aba está escondida — não há tela para atrasar.
            // É o que dá à notificação do sistema a duração do áudio, o nome do
            // arquivo e, no Chrome, a foto ampliada abaixo do texto.
            const media = kind === 'text' || kind === 'sticker'
              ? null
              : await whatsappService.getMessageNotifyMeta(msg.id).catch(() => null);
            const bigPicture = kind === 'image' && media?.storage_path
              ? await resolveMediaUrl(media.storage_path).catch(() => null)
              : null;

            const n = new Notification(name, {
              body: systemBodyOf(preview, kind, media?.file_name, media?.media_duration_seconds),
              tag: `wa:${convId}`,
              ...(icon ? { icon } : {}),
              // `image` só existe no Chrome/Edge; onde não existe é ignorado sem
              // erro, e a notificação continua a mesma de antes.
              ...(bigPicture ? { image: bigPicture } as NotificationOptions : {}),
            });
            n.onclick = () => { window.focus(); onOpenRef.current(convId); n.close(); };
          } catch { /* alguns ambientes exigem ServiceWorker; o aviso visual já cobre */ }
        }
      })();
    });

    return () => { unsubConv(); unsubMsg(); };
  }, [userId]);
}
