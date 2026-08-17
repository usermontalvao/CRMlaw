// A ponte de áudio com o WaCalls.
//
// ISTO NÃO É UMA CHAMADA WebRTC COMUM. Não existe `addTrack`, não existe track
// de áudio remoto, não existe codec negociado. O caminho é:
//
//   microfone → AudioWorklet (16 kHz) → PCM Int16 LE → DataChannel "pcm"
//     → WaCalls (Go) → MLow → SRTP → WhatsApp
//
// e o inverso na volta. O WebRTC aqui serve só de transporte do DataChannel.
// A implementação é a do cliente oficial (`client/src/lib/webrtc.ts` e os dois
// worklets em `client/public/worklets/` do repositório JotaDev66/WaCalls),
// portada com três diferenças deliberadas:
//
//   1. os worklets são embutidos como Blob (não há arquivo em /public para o
//      service worker do CRM cachear ou servir errado nos apps /atendimento);
//   2. o mudo corta o ENVIO dos quadros PCM — desligar a track não bastaria,
//      porque quem manda áudio é o worklet, não o WebRTC;
//   3. o áudio remoto toca num <audio> criado aqui, e não num elemento da
//      árvore React: a chamada não pode emudecer porque um modal desmontou.
import { waCallsLog } from './config';
import { float32ToInt16LE, int16LEToFloat32 } from './pcm';

/** Taxa de amostragem que o WaCalls fala. Não é negociável. */
const SAMPLE_RATE = 16000;
/** Rótulo do DataChannel. O servidor ignora canais com outro nome. */
const PCM_CHANNEL_LABEL = 'pcm';

// Worklet de captura: entrega ao thread principal cada bloco do microfone.
const CAPTURE_WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

// Worklet de reprodução: buffer circular de 2 s. O PCM chega em rajadas pelo
// DataChannel e a placa de som pede blocos de tamanho fixo; sem o anel, cada
// atraso de rede viraria um estalo.
const PLAYBACK_WORKLET_SRC = `
const RING_SIZE = ${SAMPLE_RATE * 2};
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0; this.write = 0; this.available = 0;
    this.port.onmessage = (e) => {
      const data = e.data;
      for (let i = 0; i < data.length; i += 1) {
        this.ring[this.write] = data[i];
        this.write = (this.write + 1) % RING_SIZE;
        if (this.available < RING_SIZE) this.available += 1;
        else this.read = (this.read + 1) % RING_SIZE;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i += 1) {
      if (this.available > 0) {
        out[i] = this.ring[this.read];
        this.read = (this.read + 1) % RING_SIZE;
        this.available -= 1;
      } else out[i] = 0;
    }
    return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
`;

const blobUrl = (source: string) =>
  URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));

/** Erro de microfone já traduzido para o operador. */
export class MicrophoneError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = 'MicrophoneError';
  }
}

/**
 * Pede o microfone e traduz a recusa. Chamado SÓ quando existe chamada para
 * fazer ou atender — o navegador não deve pedir permissão à toa.
 *
 * Fica FORA de `openCallAudio` de propósito: o operador precisa descobrir que o
 * microfone está bloqueado ANTES de o telefone do cliente tocar.
 */
export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneError(
      'Este navegador não permite usar o microfone nesta página.', null,
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicrophoneError(
        'Permissão de microfone necessária para realizar a chamada. Libere o microfone nas permissões do navegador.',
        err,
      );
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MicrophoneError('Nenhum microfone encontrado neste computador.', err);
    }
    if (name === 'NotReadableError') {
      throw new MicrophoneError(
        'O microfone está ocupado por outro programa. Feche o outro aplicativo e tente de novo.',
        err,
      );
    }
    throw new MicrophoneError(
      'Não foi possível acessar o microfone. Verifique a permissão do navegador.', err,
    );
  }
}

/** A ponte viva de uma chamada. Uma por `callId` — nunca compartilhada. */
export interface WaCallAudioBridge {
  readonly callId: string;
  /** Corta/religa o ENVIO do microfone sem derrubar a chamada. */
  setMuted: (muted: boolean) => void;
  /** Libera tudo: DataChannel, PeerConnection, microfone, AudioContext e o <audio>. */
  close: () => void;
}

/**
 * Sobe a ponte de áudio de uma chamada já criada no WaCalls.
 *
 * `negotiate` recebe a oferta SDP e devolve a resposta — quem fala HTTP é o
 * `waCallsService`, este módulo só cuida da mídia.
 */
export async function openCallAudio(params: {
  callId: string;
  /** Microfone já aberto por `openMicrophone`. A ponte passa a ser dona dele. */
  micStream: MediaStream;
  negotiate: (sdpOffer: string) => Promise<string>;
  /** Avisado quando o transporte cai sozinho (rede do operador, por exemplo). */
  onDisconnected?: () => void;
}): Promise<WaCallAudioBridge> {
  const { callId, micStream, negotiate } = params;

  let closed = false;
  let muted = false;
  let context: AudioContext | null = null;
  let audioEl: HTMLAudioElement | null = null;
  const revoke: string[] = [];

  const peer = new RTCPeerConnection({ iceServers: [] });
  const channel = peer.createDataChannel(PCM_CHANNEL_LABEL, { ordered: true });
  channel.binaryType = 'arraybuffer';

  const close = () => {
    if (closed) return;
    closed = true;
    try { channel.close(); } catch { /* já fechado */ }
    try { micStream.getTracks().forEach(track => track.stop()); } catch { /* idem */ }
    try { void context?.close(); } catch { /* idem */ }
    try { peer.close(); } catch { /* idem */ }
    if (audioEl) {
      try { audioEl.pause(); audioEl.srcObject = null; audioEl.remove(); } catch { /* idem */ }
      audioEl = null;
    }
    for (const objectUrl of revoke) URL.revokeObjectURL(objectUrl);
    waCallsLog('recursos de áudio liberados', { callId });
  };

  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const captureUrl = blobUrl(CAPTURE_WORKLET_SRC);
    const playbackUrl = blobUrl(PLAYBACK_WORKLET_SRC);
    revoke.push(captureUrl, playbackUrl);
    await context.audioWorklet.addModule(captureUrl);
    await context.audioWorklet.addModule(playbackUrl);
    await context.resume();

    // Captura: microfone → worklet → PCM Int16 → DataChannel.
    const micSource = context.createMediaStreamSource(micStream);
    const captureNode = new AudioWorkletNode(context, 'capture-processor');
    captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (muted || channel.readyState !== 'open') return;
      channel.send(float32ToInt16LE(event.data));
    };
    micSource.connect(captureNode);
    // O worklet de captura não escreve na saída (silêncio); a ligação com o
    // destino existe só para o grafo ser processado.
    captureNode.connect(context.destination);

    // Reprodução: DataChannel → worklet → MediaStream → <audio>.
    const playbackNode = new AudioWorkletNode(context, 'playback-processor');
    const streamDestination = context.createMediaStreamDestination();
    playbackNode.connect(streamDestination);
    channel.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      playbackNode.port.postMessage(int16LEToFloat32(event.data));
    };

    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = streamDestination.stream;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    // O gesto do operador (o clique em Ligar/Atender) já libera o autoplay; se
    // ainda assim o navegador recusar, não há o que fazer além de seguir.
    void audioEl.play().catch(() => {});

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') waCallsLog('WebRTC connected', { callId });
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        params.onDisconnected?.();
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    // Sem trickle ICE: o servidor responde uma única vez, então esperamos o
    // navegador terminar de juntar os candidatos antes de mandar a oferta.
    await new Promise<void>(resolve => {
      if (peer.iceGatheringState === 'complete') { resolve(); return; }
      const onChange = () => {
        if (peer.iceGatheringState === 'complete') {
          peer.removeEventListener('icegatheringstatechange', onChange);
          resolve();
        }
      };
      peer.addEventListener('icegatheringstatechange', onChange);
    });

    const answer = await negotiate(peer.localDescription!.sdp);
    await peer.setRemoteDescription({ type: 'answer', sdp: answer });
    waCallsLog('ponte de áudio pronta', { callId });
  } catch (err) {
    close();
    throw err;
  }

  return {
    callId,
    setMuted: (next: boolean) => {
      muted = next;
      // O corte real é no envio (acima). Desligar a track também é feito para
      // o indicador de microfone do sistema operacional dizer a verdade.
      try { micStream.getAudioTracks().forEach(track => { track.enabled = !next; }); } catch { /* ignore */ }
      waCallsLog(next ? 'microfone mudo' : 'microfone aberto', { callId });
    },
    close,
  };
}
