// Host global dos avisos de mensagem nova do WhatsApp.
//
// Antes o cartão era desenhado dentro do ChatFloatingWidget, e por isso herdava
// as regras de lá: sumia com o widget aberto e nunca aparecia dentro do próprio
// módulo do WhatsApp (onde o widget nem é montado). Resultado prático: com a
// conversa X aberta, uma mensagem da conversa Y não avisava nada — e no
// dashboard, com o chat da equipe aberto, também não.
//
// Aqui o cartão é um cidadão de primeira classe: mora no App, ao lado do
// notificador que o alimenta, e aparece em qualquer tela. Empilha no canto
// superior direito, abaixo do cabeçalho — longe do widget e do launcher (canto
// inferior direito) e dos toasts do sistema (rodapé, centralizados), para nunca
// disputar espaço com eles.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SYSTEM_EVENTS } from '../../utils/events';
import type { NotifyTier } from '../../services/whatsapp/notifyScope';
import { resolveAvatarUrl } from '../../services/whatsapp/shared';
import { signatureService } from '../../services/signature.service';
import WhatsAppMessageToast, {
  WHATSAPP_TOAST_DURATION_MS,
  type WhatsAppMessageToastData,
  type WhatsAppToastKind,
} from './WhatsAppMessageToast';

/** Quantos cartões ficam visíveis ao mesmo tempo (os mais antigos saem). */
const MAX_VISIBLE = 3;

interface Incoming {
  conversationId?: string;
  name?: string;
  preview?: string;
  tier?: NotifyTier;
  /** Foto do CADASTRO do cliente vinculado (bucket das assinaturas/documentos). */
  clientPhotoPath?: string | null;
  /** Foto do perfil do WhatsApp (bucket de mídia) — usada quando não há cadastro. */
  avatarPath?: string | null;
  kind?: WhatsAppToastKind;
  fileName?: string | null;
  at?: number;
}

/**
 * Assina a foto na ordem que o escritório reconhece: primeiro o rosto do
 * cadastro (é quem a equipe conhece pelo nome completo), e só então o avatar
 * que o contato escolheu no aplicativo. Roda FORA do caminho crítico — o
 * cartão já está na tela com as iniciais quando a URL chega.
 */
async function resolvePhotoUrl(clientPhotoPath?: string | null, avatarPath?: string | null): Promise<string | null> {
  if (clientPhotoPath) {
    const fromClient = await signatureService.getSignedImageUrl(clientPhotoPath, 3600).catch(() => null);
    if (fromClient) return fromClient;
  }
  return resolveAvatarUrl(avatarPath).catch(() => null);
}

export const WhatsAppNotifyHost: React.FC<{
  /** Abre a conversa do cartão clicado (o App navega para o módulo). */
  onOpen: (conversationId: string) => void;
}> = ({ onOpen }) => {
  const [stack, setStack] = useState<WhatsAppMessageToastData[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) { window.clearTimeout(timer); timersRef.current.delete(id); }
    setStack(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const handle = (event: Event) => {
      const data = (event as CustomEvent<Incoming>).detail;
      const conversationId = data?.conversationId;
      if (!conversationId) return;

      const id = `${conversationId}:${Date.now()}`;
      setStack(prev => {
        // Rajada da MESMA conversa não vira pilha de cartões iguais: o mais
        // recente substitui o anterior daquela conversa, como no celular — e
        // herda a contagem, para o cartão dizer "3 novas" em vez de esconder
        // as duas anteriores.
        let acumuladas = 0;
        const semRepetida = prev.filter(t => {
          if (t.conversationId !== conversationId) return true;
          acumuladas = Math.max(acumuladas, t.count ?? 1);
          const timer = timersRef.current.get(t.id);
          if (timer) { window.clearTimeout(timer); timersRef.current.delete(t.id); }
          return false;
        });
        const proxima = [...semRepetida, {
          id,
          conversationId,
          name: data?.name || 'Contato',
          preview: data?.preview || '',
          kind: data?.kind ?? 'text',
          fileName: data?.fileName ?? null,
          at: data?.at ?? Date.now(),
          count: acumuladas + 1,
        }];
        // Estourou o teto: os mais antigos saem (e levam seus temporizadores).
        while (proxima.length > MAX_VISIBLE) {
          const fora = proxima.shift()!;
          const timer = timersRef.current.get(fora.id);
          if (timer) { window.clearTimeout(timer); timersRef.current.delete(fora.id); }
        }
        return proxima;
      });
      timersRef.current.set(id, window.setTimeout(() => dismiss(id), WHATSAPP_TOAST_DURATION_MS));

      // A foto entra por cima das iniciais quando a assinatura volta; se o
      // cartão já saiu (ou foi substituído pela rajada), o update não acha o id
      // e nada acontece.
      if (data?.clientPhotoPath || data?.avatarPath) {
        void resolvePhotoUrl(data.clientPhotoPath, data.avatarPath).then(url => {
          if (!url) return;
          setStack(prev => prev.map(t => (t.id === id ? { ...t, avatarUrl: url } : t)));
        });
      }
    };

    // Escuta o CustomEvent nativo no window (o emitter sempre o dispara), o que
    // sobrevive a divergência de instância do emitter entre chunks lazy.
    window.addEventListener(`crm:${SYSTEM_EVENTS.WHATSAPP_NOTIFY}`, handle);
    return () => window.removeEventListener(`crm:${SYSTEM_EVENTS.WHATSAPP_NOTIFY}`, handle);
  }, [dismiss]);

  // Limpa temporizadores pendentes ao desmontar (troca de usuário, logout).
  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach(t => window.clearTimeout(t)); timers.clear(); };
  }, []);

  if (stack.length === 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-testid="whatsapp-notify-host"
      className="pointer-events-none fixed right-3 flex flex-col items-end sm:right-4"
      // Abaixo do cabeçalho (62px) e acima de tudo, menos dos toasts do sistema.
      style={{ top: 74, zIndex: 2147483000 }}
    >
      {stack.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <WhatsAppMessageToast
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
            onOpen={conversationId => { dismiss(toast.id); onOpen(conversationId); }}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
};

export default WhatsAppNotifyHost;
