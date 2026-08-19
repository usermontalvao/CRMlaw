// A ponte de VÍDEO com o Jurius Call.
//
// A biblioteca whatsapp-rust transporta H.264 já codificado e NUNCA toca em
// pixel: quem codifica e quem decodifica é este arquivo, com o WebCodecs do
// navegador. Por isso o vídeo não passa pelo servidor como imagem — ele sai da
// câmera já em H.264 e chega no <video> depois de decodificado aqui.
//
//   câmera → VideoEncoder (H.264 Annex-B) → WebSocket → whatsapp-rust → WhatsApp
//   WhatsApp → whatsapp-rust → WebSocket → VideoDecoder → <canvas> → <video>
//
// O formato NÃO é escolha nossa: o `voip/video.rs` do whatsapp-rust especifica
// unidades de acesso Annex-B completas (com start codes) e o WhatsApp usa
// H.264 Constrained Baseline (`avc1.42E01F`). Pedimos `avc: { format: 'annexb' }`
// ao encoder justamente para não ter de converter AVCC↔Annex-B no meio do
// caminho — o Chrome já entrega no formato do fio.
//
// Codificar no NAVEGADOR e não no servidor é deliberado: transcodificar vídeo
// de todos os atendentes num contêiner Rust custaria CPU que o servidor não tem
// para dar, e a câmera está aqui de qualquer forma.
import { waCallsLog } from './config';
import { callSocket, KIND_VIDEO } from './socket';

/** O perfil que o WhatsApp usa: Constrained Baseline, nível 3.1. */
const H264_CODEC = 'avc1.42E01F';

/**
 * Cadência padrão. 15 fps é a cadência de compatibilidade que o WhatsApp
 * mantém no modo de baixa banda, e é o passo de RTP que o servidor assume
 * quando ninguém pede outro — encoder e servidor têm de concordar, senão o
 * vídeo chega correndo ou arrastando do outro lado.
 */
export const DEFAULT_FPS = 15;
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;
const DEFAULT_BITRATE = 700_000;

/**
 * De quanto em quanto tempo um keyframe é forçado.
 *
 * O outro lado pode entrar no meio da transmissão (ele liga a câmera depois, ou
 * perdeu pacotes) e sem um quadro-chave recente ele fica com a tela preta até o
 * próximo. Três segundos é o compromisso: banda aceitável, espera curta.
 */
const KEYFRAME_MS = 3000;

/** Fila máxima do encoder. Vídeo atrasado numa ligação é pior que vídeo perdido. */
const MAX_ENCODE_QUEUE = 2;

/** `MediaStreamTrackProcessor` ainda não está no lib.dom do TypeScript. */
interface TrackProcessorLike {
  readable: ReadableStream<VideoFrame>;
}
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessorLike;

function trackProcessorCtor(): TrackProcessorCtor | null {
  const ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  return typeof ctor === 'function' ? ctor : null;
}

/** O navegador sabe codificar e decodificar H.264 por conta própria? */
export function videoSupported(): boolean {
  return typeof VideoEncoder !== 'undefined'
    && typeof VideoDecoder !== 'undefined'
    && typeof VideoFrame !== 'undefined';
}

/** Erro de câmera já traduzido para o operador. */
export class CameraError extends Error {
  constructor(message: string, readonly cause: unknown) {
    super(message);
    this.name = 'CameraError';
  }
}

/** Pede a câmera e traduz a recusa. */
export async function openCamera(fps = DEFAULT_FPS): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('Este navegador não permite usar a câmera.', null);
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: DEFAULT_WIDTH },
        height: { ideal: DEFAULT_HEIGHT },
        frameRate: { ideal: fps, max: fps },
      },
      audio: false,
    });
  } catch (err) {
    const nome = (err as { name?: string })?.name;
    if (nome === 'NotAllowedError' || nome === 'SecurityError') {
      throw new CameraError('Permissão de câmera negada. Libere no navegador e tente de novo.', err);
    }
    if (nome === 'NotFoundError' || nome === 'OverconstrainedError') {
      throw new CameraError('Nenhuma câmera encontrada neste computador.', err);
    }
    throw new CameraError('Não foi possível abrir a câmera.', err);
  }
}

/** A ponte de vídeo viva de uma chamada. Uma por `callId`. */
export interface WaCallVideoBridge {
  readonly callId: string;
  /** A imagem da própria câmera, para a auto-visualização. */
  localStream: () => MediaStream | null;
  /** A imagem do outro lado, já decodificada. `null` até o primeiro quadro. */
  remoteStream: () => MediaStream | null;
  /** Corta/religa o ENVIO da câmera sem derrubar o vídeo que chega. */
  setCameraEnabled: (on: boolean) => void;
  /** Quantos quadros do outro lado já foram desenhados. */
  receivedFrames: () => number;
  close: () => void;
}

/**
 * Sobe o vídeo de uma chamada que já está acoplada no socket.
 *
 * O acoplamento é do `audioBridge` (é ele quem chama `callSocket.attach`) —
 * áudio e vídeo da mesma chamada viajam pelo mesmo canal, então acoplar duas
 * vezes seria pedir o mesmo duas vezes.
 */
export async function openCallVideo(params: {
  callId: string;
  /** Câmera já aberta por `openCamera`. A ponte passa a ser dona dela. */
  cameraStream: MediaStream;
  fps?: number;
  bitrate?: number;
  /** Avisado quando o encoder ou o decoder morre no meio da chamada. */
  onFailure?: (motivo: string) => void;
}): Promise<WaCallVideoBridge> {
  const { callId, cameraStream } = params;
  const fps = params.fps ?? DEFAULT_FPS;
  const bitrate = params.bitrate ?? DEFAULT_BITRATE;

  if (!videoSupported()) {
    cameraStream.getTracks().forEach(t => t.stop());
    throw new CameraError('Este navegador não sabe codificar vídeo H.264 (WebCodecs).', null);
  }

  let closed = false;
  let enviando = true;
  let ultimoKeyframe = 0;
  let quadrosRecebidos = 0;
  let soltarMidia: (() => void) | null = null;

  // ── Saída: câmera → H.264 → socket ───────────────────────────────────────
  const track = cameraStream.getVideoTracks()[0];
  if (!track) {
    cameraStream.getTracks().forEach(t => t.stop());
    throw new CameraError('A câmera não entregou imagem.', null);
  }
  const ajustes = track.getSettings();
  const largura = ajustes.width ?? DEFAULT_WIDTH;
  const altura = ajustes.height ?? DEFAULT_HEIGHT;

  const configuracao: VideoEncoderConfig = {
    codec: H264_CODEC,
    width: largura,
    height: altura,
    bitrate,
    framerate: fps,
    // Sem lookahead: numa ligação, meio segundo de atraso para ganhar
    // qualidade é um mau negócio.
    latencyMode: 'realtime',
    // Annex-B é o que o whatsapp-rust transporta. Sem isto o Chrome entrega
    // AVCC e o outro lado não decodifica nada.
    avc: { format: 'annexb' },
  };

  // Perguntar ANTES de configurar. `configure()` com um perfil sem suporte não
  // lança: ele cai no callback de erro, assíncrono, DEPOIS de a chamada já ter
  // anunciado vídeo ao outro lado — o operador veria a própria câmera acender e
  // o outro lado esperaria uma imagem que nunca vem. Aqui a recusa é imediata e
  // tem nome.
  let suporte: VideoEncoderSupport;
  try {
    suporte = await VideoEncoder.isConfigSupported(configuracao);
  } catch (err) {
    cameraStream.getTracks().forEach(t => t.stop());
    throw new CameraError('Este navegador não sabe codificar H.264.', err);
  }
  if (!suporte.supported) {
    cameraStream.getTracks().forEach(t => t.stop());
    throw new CameraError(
      `Este navegador não codifica H.264 em ${largura}x${altura}.`,
      suporte,
    );
  }

  const encoder = new VideoEncoder({
    output: chunk => {
      if (closed || !enviando) return;
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      callSocket.sendVideo(bytes, chunk.type === 'key');
    },
    error: err => {
      console.error('[Chamadas] o encoder de vídeo falhou', err);
      params.onFailure?.('encoder');
    },
  });
  encoder.configure(configuracao);

  const codificar = (frame: VideoFrame) => {
    if (closed || !enviando || encoder.state !== 'configured') {
      frame.close();
      return;
    }
    // Fila cheia = a rede (ou a CPU) não está dando conta. Descartar o quadro
    // novo mantém a conversa em tempo real em vez de acumular atraso.
    if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      frame.close();
      return;
    }
    const agora = Date.now();
    const chave = agora - ultimoKeyframe >= KEYFRAME_MS;
    if (chave) ultimoKeyframe = agora;
    try {
      encoder.encode(frame, { keyFrame: chave });
    } catch (err) {
      waCallsLog('quadro descartado pelo encoder', err);
    }
    frame.close();
  };

  const Processor = trackProcessorCtor();
  let leitor: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let videoAuxiliar: HTMLVideoElement | null = null;

  if (Processor) {
    // Caminho bom (Chrome/Edge): os quadros vêm da própria track, sem passar
    // por elemento nenhum.
    leitor = new Processor({ track }).readable.getReader();
    void (async () => {
      while (!closed && leitor) {
        const { value, done } = await leitor.read();
        if (done || !value) break;
        codificar(value);
      }
    })();
  } else {
    // Sem `MediaStreamTrackProcessor`: um <video> escondido serve de fonte, e
    // `requestVideoFrameCallback` avisa a cada quadro novo. Mais caro, mas é o
    // que existe fora do Chrome.
    const elemento = document.createElement('video');
    elemento.srcObject = cameraStream;
    elemento.muted = true;
    elemento.playsInline = true;
    elemento.style.display = 'none';
    document.body.appendChild(elemento);
    videoAuxiliar = elemento;
    await elemento.play().catch(() => {});
    const proximo = () => {
      if (closed) return;
      const rvfc = (elemento as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }).requestVideoFrameCallback;
      if (!rvfc) return;
      rvfc.call(elemento, () => {
        if (closed) return;
        try {
          codificar(new VideoFrame(elemento, { timestamp: performance.now() * 1000 }));
        } catch (err) {
          waCallsLog('não foi possível capturar o quadro da câmera', err);
        }
        proximo();
      });
    };
    proximo();
  }

  // ── Entrada: socket → H.264 → canvas ─────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_WIDTH;
  canvas.height = DEFAULT_HEIGHT;
  const contexto = canvas.getContext('2d');
  const remoto = canvas.captureStream(fps);

  const desenhar = (frame: VideoFrame, orientacao: number) => {
    if (!contexto) { frame.close(); return; }
    const girado = orientacao % 2 === 1;
    const largura2 = girado ? frame.displayHeight : frame.displayWidth;
    const altura2 = girado ? frame.displayWidth : frame.displayHeight;
    if (canvas.width !== largura2 || canvas.height !== altura2) {
      canvas.width = largura2;
      canvas.height = altura2;
    }
    contexto.save();
    if (orientacao) {
      // O outro lado manda a rotação DO APARELHO DELE, não a correção que nós
      // temos de aplicar — e por isso o giro aqui é ao CONTRÁRIO. Girando no
      // mesmo sentido, um celular na vertical (um quarto de volta) chegava com
      // meia volta de erro: a pessoa aparecia de cabeça para baixo, que foi
      // exatamente o que a tela mostrou em 19/08/2026.
      contexto.translate(canvas.width / 2, canvas.height / 2);
      contexto.rotate((-orientacao * Math.PI) / 2);
      contexto.drawImage(
        frame,
        -frame.displayWidth / 2,
        -frame.displayHeight / 2,
        frame.displayWidth,
        frame.displayHeight,
      );
    } else {
      contexto.drawImage(frame, 0, 0, canvas.width, canvas.height);
    }
    contexto.restore();
    quadrosRecebidos += 1;
    frame.close();
  };

  let orientacaoAtual = 0;
  const decoder = new VideoDecoder({
    output: frame => desenhar(frame, orientacaoAtual),
    error: err => {
      console.error('[Chamadas] o decoder de vídeo falhou', err);
      params.onFailure?.('decoder');
    },
  });
  decoder.configure({ codec: H264_CODEC, optimizeForLatency: true });

  /**
   * O decodificador só pode começar num keyframe. Entrar no meio de uma
   * sequência produz artefato verde e, no Chrome, derruba o decoder — então os
   * quadros anteriores ao primeiro keyframe são descartados de propósito.
   */
  let esperandoChave = true;
  let carimbo = 0;
  const passo = Math.round(1_000_000 / fps);

  soltarMidia = callSocket.onMedia(frame => {
    if (closed || frame.kind !== KIND_VIDEO) return;
    if (esperandoChave && !frame.keyframe) return;
    esperandoChave = false;
    orientacaoAtual = frame.orientation & 3;
    try {
      decoder.decode(new EncodedVideoChunk({
        type: frame.keyframe ? 'key' : 'delta',
        timestamp: carimbo,
        data: frame.body,
      }));
      carimbo += passo;
    } catch (err) {
      waCallsLog('unidade de vídeo recusada pelo decoder', err);
      // Perdeu a sequência: volta a esperar um keyframe em vez de insistir em
      // cima de um estado quebrado.
      esperandoChave = true;
    }
  });

  waCallsLog('vídeo ligado', { callId, largura, altura, fps });

  const close = () => {
    if (closed) return;
    closed = true;
    soltarMidia?.();
    soltarMidia = null;
    try { void leitor?.cancel(); } catch { /* já cancelado */ }
    try { if (encoder.state !== 'closed') encoder.close(); } catch { /* já fechado */ }
    try { if (decoder.state !== 'closed') decoder.close(); } catch { /* idem */ }
    try { cameraStream.getTracks().forEach(t => t.stop()); } catch { /* idem */ }
    if (videoAuxiliar) {
      try { videoAuxiliar.pause(); videoAuxiliar.srcObject = null; videoAuxiliar.remove(); } catch { /* idem */ }
      videoAuxiliar = null;
    }
    try { remoto.getTracks().forEach(t => t.stop()); } catch { /* idem */ }
    waCallsLog('vídeo liberado', { callId, quadrosRecebidos });
  };

  return {
    callId,
    localStream: () => (closed ? null : cameraStream),
    remoteStream: () => (closed ? null : remoto),
    receivedFrames: () => quadrosRecebidos,
    setCameraEnabled: (on: boolean) => {
      enviando = on;
      // Desligar a track também faz a luz da câmera apagar — o operador precisa
      // ver que ela realmente parou.
      try { cameraStream.getVideoTracks().forEach(t => { t.enabled = on; }); } catch { /* ignore */ }
      waCallsLog(on ? 'câmera ligada' : 'câmera desligada', { callId });
    },
    close,
  };
}
