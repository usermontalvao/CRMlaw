// Host global das chamadas de voz (WaCalls).
//
// Mesmo papel do `WhatsAppNotifyHost`: mora na raiz do app — no CRM completo e
// na janela /atendimento — para que uma chamada RECEBIDA apareça em qualquer
// tela, não só com o módulo WhatsApp aberto. Como ele fica FORA da troca de
// módulos, o painel da chamada nunca é desmontado ao navegar: dá para abrir o
// processo, o prazo ou outra conversa com a ligação de pé.
//
// É também o único lugar que liga a escuta de eventos (via `useWaCalls` →
// `waCallsStore.init`), o que garante uma única conexão SSE por aba.
//
// É também a casa do AVISO DE CHAMADA PERDIDA (`MissedCallWidget`), pelo mesmo
// motivo: a ligação que ninguém atendeu precisa aparecer para quem está no
// processo, na agenda ou no editor — não só para quem tem a inbox aberta.
//
// Nada de estado de chamada aqui dentro: o estado é do store, este componente
// só desenha, toca os avisos sonoros e traduz os recados em toasts.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useToastContext } from '../../contexts/ToastContext';
import { useCallBridge, useOnlineOperators } from '../../hooks/useCallBridge';
import { useMissedCalls } from '../../hooks/useMissedCalls';
import { useWaCalls } from '../../hooks/useWaCalls';
import { waCallsStore } from '../../services/wacalls/callStore';
import {
  playCallConnectedTone, playCallEndedTone, startRing, stopRing,
} from '../../services/wacalls/ringtone';
import { ActiveCallWidget, IncomingCallCard, callDisplayName } from './callModals';
import { CallVideoScreen } from './callVideoScreen';
import { CallInviteCard, GuestCallBar } from './callGuestPanel';
import { MissedCallWidget } from './MissedCallWidget';
import type { WaCall } from '../../services/wacalls/types';

/**
 * Aviso do sistema operacional para a chamada recebida.
 *
 * Só com a aba escondida — mesma regra dos avisos de mensagem: com o CRM à
 * vista, o cartão no alto da tela já é mais informativo do que a notificação
 * do sistema, e ver as duas coisas ao mesmo tempo é ruído. Com a aba em
 * segundo plano, ela é o que faz o telefone tocado chegar até quem está no
 * Word do outro lado da mesa.
 */
/** Espera antes de avisar: o nome do contato chega por consulta assíncrona. */
const ESPERA_PELO_NOME_MS = 700;

function useSystemCallNotification(incoming: WaCall | null): void {
  const openRef = useRef<Notification | null>(null);

  // A permissão é pedida no PRIMEIRO GESTO do usuário, não na montagem. O
  // Chrome ignora (e em alguns casos bloqueia de vez) um `requestPermission`
  // disparado no carregamento da página, sem interação nenhuma — o pedido
  // simplesmente nunca aparecia, e a notificação que dependia dele também não.
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    const pedir = () => {
      soltar();
      Notification.requestPermission().catch(() => { /* recusar é uma resposta */ });
    };
    const soltar = () => {
      window.removeEventListener('pointerdown', pedir);
      window.removeEventListener('keydown', pedir);
    };
    window.addEventListener('pointerdown', pedir, { once: true });
    window.addEventListener('keydown', pedir, { once: true });
    return soltar;
  }, []);

  // O último retrato da chamada, para o aviso ser montado com o nome de AGORA
  // sem que o efeito dependa do objeto (ver o comentário do efeito abaixo).
  const atual = useRef<WaCall | null>(incoming);
  atual.current = incoming;

  // UMA ligação, UM aviso.
  //
  // Este efeito já dependeu de `incoming` inteiro, e a ligação recebida é
  // remendada várias vezes enquanto o CRM descobre quem está do outro lado:
  // chega o convite, resolve o telefone, resolve o contato. Cada remendo era um
  // objeto novo, o efeito rodava de novo e construía OUTRA `Notification` — em
  // 17/08/2026 uma única chamada da mesma cliente rendeu três avisos no Chrome
  // ("Número não identificado", depois o telefone, depois o nome). A `tag` troca
  // o aviso visível, mas o Windows guarda cada um no histórico.
  //
  // Agora o efeito só reage à IDENTIDADE da chamada, e espera um instante antes
  // de avisar: é o tempo de a consulta do contato voltar, para o aviso já nascer
  // com o nome de quem está ligando em vez do "não identificado" do começo.
  useEffect(() => {
    const close = () => {
      try { openRef.current?.close(); } catch { /* já fechada */ }
      openRef.current = null;
    };
    const callId = incoming?.callId;
    if (!callId) { close(); return; }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const dispara = (chamada: WaCall) => {
      try {
        const note = new Notification('Chamada de voz no WhatsApp', {
          body: `${callDisplayName(chamada)} está chamando`,
          // O mesmo ícone dos avisos de mensagem: numa pilha de notificações do
          // sistema, é por ele que se reconhece que a ligação é do CRM.
          icon: '/icon-192.png',
          // `tag` fixo por chamada: um SSE que reentregue o convite não empilha
          // duas notificações da mesma ligação.
          tag: `wacall:${chamada.callId}`,
          // `requireInteraction` mantém o aviso na tela enquanto o telefone
          // toca, em vez de sumir em 5 segundos como um aviso de mensagem.
          requireInteraction: true,
          silent: true, // o toque é nosso (ver ringtone.ts); dois sons brigariam
        });
        note.onclick = () => { try { window.focus(); note.close(); } catch { /* nada a fazer */ } };
        openRef.current = note;
      } catch { /* notificação é um extra */ }
    };

    const timer = setTimeout(() => {
      const chamada = atual.current;
      // Sumiu no meio da espera (atendida aqui, ou por outro operador): sem aviso.
      if (!chamada || chamada.callId !== callId) return;
      // Só com a aba escondida: com o CRM na frente, o cartão da chamada já está lá.
      if (typeof document !== 'undefined' && !document.hidden) return;
      dispara(chamada);
    }, ESPERA_PELO_NOME_MS);

    return () => { clearTimeout(timer); close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.callId]);
}

/**
 * Os toques: chamada recebida (rajada ascendente) e chamada discada (controle
 * de chamada). Um som curto marca o atendimento e outro o fim — que é o único
 * jeito de perceber que a linha caiu com o painel minimizado.
 */
function useCallRinging(myCall: WaCall | null, incoming: WaCall | null): void {
  const lastPhase = useRef<string | null>(null);

  useEffect(() => {
    const phase = myCall?.phase ?? null;
    const previous = lastPhase.current;
    lastPhase.current = phase;

    if (previous !== 'ACTIVE' && phase === 'ACTIVE') playCallConnectedTone();
    if (previous && previous !== 'ENDED' && previous !== 'FAILED' && (phase === 'ENDED' || phase === 'FAILED')) {
      playCallEndedTone();
    }

    // O convite recebido vence — mas só toca nesta mesa se a regra de
    // roteamento disser que sim (ver `callRouting`): o cartão pode estar na
    // tela de propósito, em silêncio, porque a chamada é de outro atendente.
    if (incoming?.route?.ring) { startRing('incoming'); return; }
    if (myCall?.direction === 'outbound' && (phase === 'CALLING' || phase === 'RINGING')) {
      startRing('outgoing');
      return;
    }
    stopRing();
  }, [incoming, myCall?.phase, myCall?.direction, myCall]);

  // A aba está indo embora (ou o usuário saiu): nada de toque órfão tocando.
  useEffect(() => () => stopRing(), []);
}

/**
 * Segura a saída da página com a chamada de pé.
 *
 * Recarregar a aba MATA a chamada: microfone, WebRTC e DataChannel são da
 * página, não do servidor. Um F5 distraído derrubava o cliente na cara do
 * atendente, sem aviso nenhum. O navegador só permite o diálogo padrão dele —
 * não dá para escrever o texto —, mas o segundo de hesitação já resolve.
 */
function useConfirmLeaveDuringCall(myCall: WaCall | null, bridging = false): void {
  // `bridging` é a mesa que está segurando o áudio de um segundo atendente: a
  // janela dela não é só a dela. Fechá-la derruba a ligação para os dois lados
  // (ver `services/wacalls/callBridge`), e é o único caso em que o aviso do
  // navegador aparece sem esta pessoa estar, ela própria, ao telefone.
  const live = bridging || (!!myCall && myCall.phase !== 'ENDED' && myCall.phase !== 'FAILED');
  useEffect(() => {
    if (!live) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Compatibilidade com navegadores antigos, que só respeitam o returnValue.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [live]);
}

export const WaCallsHost: React.FC<{
  /** Abre a conversa do contato na inbox (o app decide como navegar). */
  onOpenConversation?: (conversationId: string) => void;
}> = ({ onOpenConversation }) => {
  const toast = useToastContext();
  const {
    myCall, incoming, linkDown, canCall, placeCall, acceptCall, rejectCall, hangUp, setMuted, setRecording,
    videoSupported, startVideo, stopVideo, videoStreams, rotateVideo, videoOrientation,
  } = useWaCalls();
  const { calls: missed, dismiss: dismissMissed, dismissAll: dismissAllMissed } = useMissedCalls();
  const {
    guests, invite, joined, anchoring, guestMuted, me,
    accept: acceptInvite, decline: declineInvite, leave: leaveCall,
    setGuestMuted, convidar, removeGuest,
  } = useCallBridge();
  const operators = useOnlineOperators();

  // Vídeo no ar (nosso ou dele) manda a chamada para a TELA CHEIA — é o que o
  // telefone faz, e conversar por vídeo numa faixa de 440px não é conversar.
  // Sair de lá (o botão de recolher ou Esc) devolve a ligação ao painel
  // flutuante, com a mesma chamada de pé, e o CRM volta a ficar clicável.
  const comVideo = !!myCall
    && myCall.phase !== 'ENDED'
    && myCall.phase !== 'FAILED'
    && (myCall.videoOn || myCall.peerVideo);
  const [telaDeVideo, setTelaDeVideo] = useState(false);
  const tinhaVideo = useRef(false);
  useEffect(() => {
    // Só a SUBIDA do vídeo abre a tela: assim quem recolheu de propósito não é
    // jogado de volta para lá a cada repintura da chamada.
    if (comVideo && !tinhaVideo.current) setTelaDeVideo(true);
    if (!comVideo) setTelaDeVideo(false);
    tinhaVideo.current = comVideo;
  }, [comVideo]);
  const streamsDaChamada = useMemo(
    () => (myCall ? () => videoStreams(myCall.callId) : () => null),
    [videoStreams, myCall?.callId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useCallRinging(myCall, incoming);
  useSystemCallNotification(incoming);
  useConfirmLeaveDuringCall(myCall, anchoring);

  // A aba está indo embora: microfone, AudioContext e SSE liberados na saída.
  useEffect(() => () => waCallsStore.shutdown(), []);

  // Avisos do store (chamada recusada, não atendida, microfone bloqueado…)
  // viram toast do sistema — o mesmo canal de aviso do resto do CRM.
  useEffect(() => waCallsStore.onNotice(notice => {
    if (notice.kind === 'error') toast.error(notice.message, notice.description);
    else if (notice.kind === 'success') toast.success(notice.message, notice.description);
    else toast.info(notice.message, notice.description);
  }), [toast]);

  return (
    <>
      {/* Convite para entrar na ligação de um colega — no alto e ao centro,
          como a chamada recebida: é uma pessoa esperando resposta agora. */}
      <AnimatePresence>
        {invite && !joined && (
          <CallInviteCard
            key={invite.callId}
            invite={invite}
            onAccept={acceptInvite}
            onDecline={declineInvite}
          />
        )}
      </AnimatePresence>
      {/* Entrei na ligação de outra pessoa: barra enxuta, sem botão de
          encerrar — quem encerra a chamada do cliente é quem atendeu. */}
      {joined && (
        <GuestCallBar
          invite={joined.invite}
          muted={guestMuted}
          onToggleMute={() => setGuestMuted(!guestMuted)}
          onLeave={leaveCall}
        />
      )}
      <AnimatePresence>
        {incoming && (
          <IncomingCallCard
            key={incoming.callId}
            call={incoming}
            onAccept={() => { void acceptCall(incoming.callId); }}
            onReject={() => { void rejectCall(incoming.callId); }}
          />
        )}
      </AnimatePresence>
      {/* O aviso de perdida cala a boca enquanto o telefone toca ou há linha
          aberta: o que interessa nesse instante é a chamada de agora. Ele volta
          sozinho assim que a tela fica livre — nada é perdido no caminho. */}
      {!incoming && !myCall && (
        <MissedCallWidget
          calls={missed}
          canCall={canCall}
          onCallBack={(call) => {
            void placeCall(call.phone, {
              conversationId: call.conversationId,
              clientId: call.clientId,
              name: call.name,
              avatarUrl: call.avatarUrl,
            });
          }}
          onOpenConversation={onOpenConversation}
          onDismiss={dismissMissed}
          onDismissAll={dismissAllMissed}
        />
      )}
      {myCall && comVideo && telaDeVideo && (
        <CallVideoScreen
          key={`tela-${myCall.callId}`}
          call={myCall}
          streams={streamsDaChamada}
          selfOrientation={videoOrientation}
          linkDown={linkDown}
          videoSupported={videoSupported}
          onMinimize={() => setTelaDeVideo(false)}
          onHangUp={() => { void hangUp(myCall.callId); }}
          onToggleMute={() => setMuted(myCall.callId, !myCall.muted)}
          onToggleRecording={() => setRecording(myCall.callId, !myCall.recording)}
          onToggleVideo={() => {
            if (myCall.videoOn) void stopVideo(myCall.callId);
            else void startVideo(myCall.callId);
          }}
          onRotateVideo={() => { void rotateVideo(myCall.callId); }}
          onOpenConversation={
            myCall.contact?.conversationId && onOpenConversation
              ? () => onOpenConversation(myCall.contact!.conversationId!)
              : undefined
          }
        />
      )}
      {myCall && !(comVideo && telaDeVideo) && (
        <ActiveCallWidget
          key={myCall.callId}
          call={myCall}
          linkDown={linkDown}
          guests={guests}
          operators={operators}
          me={me}
          onInviteGuest={(userId, name, mode) => convidar({
            callId: myCall.callId,
            toUserId: userId,
            toName: name,
            mode,
            contactName: myCall.contact?.name ?? null,
            phone: myCall.phone,
            conversationId: myCall.contact?.conversationId ?? null,
            clientId: myCall.contact?.clientId ?? null,
          })}
          onRemoveGuest={(userId) => removeGuest(myCall.callId, userId)}
          onHangUp={() => { void hangUp(myCall.callId); }}
          onToggleMute={() => setMuted(myCall.callId, !myCall.muted)}
          onToggleRecording={() => setRecording(myCall.callId, !myCall.recording)}
          videoSupported={videoSupported}
          videoStreams={streamsDaChamada}
          videoOrientation={videoOrientation}
          onExpandVideo={() => setTelaDeVideo(true)}
          onToggleVideo={() => {
            if (myCall.videoOn) void stopVideo(myCall.callId);
            else void startVideo(myCall.callId);
          }}
          onRotateVideo={() => { void rotateVideo(myCall.callId); }}
          onOpenConversation={
            myCall.contact?.conversationId && onOpenConversation
              ? () => onOpenConversation(myCall.contact!.conversationId!)
              : undefined
          }
        />
      )}
    </>
  );
};

export default WaCallsHost;
