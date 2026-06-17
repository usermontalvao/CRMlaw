// Notificador global de WhatsApp: som + aviso visual quando chega uma mensagem
// nova de uma conversa ATRIBUÍDA A MIM ("minha") e estamos FORA do módulo. Vive
// no nível do App, porque o objetivo é avisar quem está em outra tela.
//
// LATÊNCIA: dispara no INSERT da mensagem (sinal mais cedo — antes do webhook
// gravar o UPDATE da conversa). O filtro "é minha?" usa um cache de atribuição
// (assigned_user_id) mantido vivo pelos eventos de conversa, com fetch só no
// cache-miss — assim o aviso sai praticamente junto com a mensagem.
import { useEffect, useRef } from 'react';
import { whatsappService } from '../services/whatsapp.service';
import { muteStore } from '../services/whatsapp/muteStore';
import { useToastContext } from '../contexts/ToastContext';
import { playNotificationSound, isNotifySoundMuted } from '../utils/notificationSound';

const SOUND_THROTTLE_MS = 1500; // evita rajada de "dings" em mensagens em sequência

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

// Cache de metadados de conversa (atribuição/nome) para filtrar sem fetch.
interface ConvMeta { assigned_user_id: string | null; contact_name: string | null; contact_phone: string; is_blocked: boolean; }
const convMetaCache = new Map<string, ConvMeta>();

/** Preview curto da mensagem a partir da própria linha (sem esperar a conversa). */
function previewOf(msg: Record<string, any>): string {
  const content = (msg.content ?? '').toString().trim();
  if (content) return content.slice(0, 120);
  switch (msg.type) {
    case 'image': return '📷 Imagem';
    case 'audio': return '🎤 Áudio';
    case 'video': return '🎬 Vídeo';
    case 'document': return '📄 Documento';
    case 'sticker': return 'Figurinha';
    default: return 'Nova mensagem';
  }
}

interface Params {
  /** Usuário atual; sem ele não há escopo "minha" para filtrar. */
  userId: string | undefined;
  /** true quando o módulo WhatsApp é a tela ativa (aí não notificamos). */
  inModule: boolean;
  /** Abre o módulo WhatsApp já na conversa que recebeu a mensagem. */
  onOpen: (conversationId: string) => void;
}

export function useWhatsAppNotifications({ userId, inModule, onOpen }: Params): void {
  const toast = useToastContext();
  const inModuleRef = useRef(inModule);
  const onOpenRef = useRef(onOpen);
  const toastRef = useRef(toast);
  const lastSoundRef = useRef(0);

  // Refs atualizadas a cada render → inscrição realtime ESTÁVEL (deps só [userId])
  // sem capturar valores velhos. `toast` muda de identidade a cada render (useToast
  // não memoiza); tê-lo nas deps re-subscrevia a cada toast → eventos duplicados.
  useEffect(() => { inModuleRef.current = inModule; }, [inModule]);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  useEffect(() => { toastRef.current = toast; }, [toast]);

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
      });
    });

    // Gatilho rápido: INSERT da mensagem recebida.
    const unsubMsg = whatsappService.subscribeInboundMessages((payload) => {
      const msg = payload.new as Record<string, any> | undefined;
      if (!msg?.id || msg.direction !== 'in') return;
      const convId: string = msg.conversation_id;
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
            };
            convMetaCache.set(convId, meta);
          }
        }
        if (!meta) return;

        // Escopo ESTRITO "minhas": só conversa atribuída a mim. Conversas sem dono /
        // na fila / de outros atendentes NÃO notificam.
        if (meta.assigned_user_id !== userId) return;
        if (meta.is_blocked) return;

        // Dentro do módulo o próprio chat já mostra tudo — nada de notificar.
        if (inModuleRef.current) return;
        // Conversa silenciada por este usuário → nenhuma notificação.
        if (muteStore.isMuted(convId)) return;

        const name = meta.contact_name || meta.contact_phone || 'Contato';
        const preview = previewOf(msg);

        // Visual (in-app) — variante WhatsApp (verde), clicável, some em 5s.
        toastRef.current.toast('whatsapp', name, {
          description: preview,
          duration: 5000,
          action: { label: 'Abrir conversa', onClick: () => onOpenRef.current(convId) },
        });

        // Som (respeitando o mute por preferência local).
        if (!isNotifySoundMuted()) {
          const now = Date.now();
          if (now - lastSoundRef.current > SOUND_THROTTLE_MS) {
            lastSoundRef.current = now;
            playNotificationSound();
          }
        }

        // Notificação do sistema (útil com a aba em segundo plano) — só se autorizada.
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const n = new Notification(`WhatsApp · ${name}`, { body: preview, tag: `wa:${convId}` });
            n.onclick = () => { window.focus(); onOpenRef.current(convId); n.close(); };
          } catch { /* alguns ambientes exigem ServiceWorker; o aviso visual já cobre */ }
        }
      })();
    });

    return () => { unsubConv(); unsubMsg(); };
  }, [userId]);
}
