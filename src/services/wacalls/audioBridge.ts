// A ponte de áudio com o Jurius Call.
//
// NÃO HÁ WebRTC AQUI. Não existe `RTCPeerConnection`, não existe ICE, não
// existe DataChannel. O caminho é:
//
//   microfone → AudioWorklet (16 kHz) → PCM Int16 LE em quadros de 960
//     → WebSocket (o mesmo de `wacalls/socket`) → Jurius Call (Rust)
//     → whatsapp-rust → MLOW → SRTP → WhatsApp
//
// e o inverso na volta. Foi essa troca que matou a ligação muda: o WaCalls
// anunciava o IP interno do Docker como candidato ICE e o navegador nunca
// chegava nele. Um WebSocket sobre a mesma URL HTTPS que o Cloudflare já
// publica não tem esse problema — não há endereço a descobrir.
//
// Três decisões continuam valendo do desenho anterior:
//
//   1. os worklets são embutidos como Blob (não há arquivo em /public para o
//      service worker do CRM cachear ou servir errado nos apps /atendimento);
//   2. o mudo corta o ENVIO dos quadros PCM — desligar a track não bastaria,
//      porque quem manda áudio é o worklet, não a track;
//   3. o áudio remoto toca num <audio> criado aqui, e não num elemento da
//      árvore React: a chamada não pode emudecer porque um modal desmontou.
//
// O quadro tem de ter EXATAMENTE 960 amostras (60 ms a 16 kHz): o motor do
// whatsapp-rust descarta qualquer outro tamanho, sem erro e sem áudio. É por
// isso que o worklet de captura acumula em vez de mandar os blocos de 128 que
// a placa entrega.
import {
  applyOutputToElement, microphoneConstraints, onAudioDeviceChange,
  type OutputRouting,
} from '../../utils/audioDevices';
import { waCallsLog } from './config';
import { float32ToInt16LE, int16LEToFloat32 } from './pcm';
import { callSocket, KIND_AUDIO } from './socket';

/** Taxa de amostragem da chamada. Não é negociável. */
const SAMPLE_RATE = 16000;
/** 60 ms a 16 kHz — o tamanho exato de quadro que o motor aceita. */
const FRAME_SAMPLES = 960;

// Worklet de captura: acumula os blocos de 128 amostras que a placa entrega e
// só entrega ao thread principal quando fecha um quadro de 60 ms. Acumular AQUI
// (e não no thread principal) custa uma mensagem a cada 60 ms em vez de uma a
// cada 8 ms.
const CAPTURE_WORKLET_SRC = `
const FRAME = ${FRAME_SAMPLES};
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || !channel.length) return true;
    for (let i = 0; i < channel.length; i += 1) {
      this.frame[this.filled] = channel[i];
      this.filled += 1;
      if (this.filled === FRAME) {
        this.port.postMessage(this.frame.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

// Worklet de reprodução: um buffer de jitter de verdade, não um anel solto.
//
// O PCM chega em RAJADAS. O transporte é um WebSocket sobre TCP (e, hoje, por
// dentro de um túnel do Cloudflare): um pacote perdido em qualquer trecho
// segura a fila inteira até a retransmissão, e o que se recebe depois é um
// monte de quadros de uma vez. Um anel que só empilha e toca na velocidade da
// placa transforma cada rajada em atraso PERMANENTE — o buffer sobe e nunca
// mais desce. Foi assim que a ligação virou "os dois falando por cima".
//
// Três regras consertam isso, e as três precisam existir juntas:
//
//   1. ALVO: só começa a tocar com ALVO amostras guardadas (dois quadros de
//      60 ms). Menos que isso é picote garantido no primeiro soluço da rede.
//   2. TETO: acima do teto, o buffer ENCOLHE — duas amostras de entrada viram
//      uma de saída, então o atraso cai ao dobro da velocidade real até voltar
//      ao alvo. Sem emenda, sem estalo: é uma média, não um corte.
//   3. FURO: sem áudio, decai do último valor em vez de escrever zero seco. O
//      corte em zero é uma descontinuidade na forma de onda — é literalmente
//      um clique. Depois de um furo, reprime: volta a esperar o alvo antes de
//      tocar de novo, senão cada furo vira uma metralhadora de furos.
//
// O resultado é um atraso que fica entre 120 e 240 ms e SE CORRIGE, no lugar
// de um que subia até 2 s e ficava lá.
const PLAYBACK_WORKLET_SRC = `
const RING_SIZE = ${SAMPLE_RATE * 2};
const ALVO = ${Math.round(SAMPLE_RATE * 0.12)};
const TETO = ${Math.round(SAMPLE_RATE * 0.24)};
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0; this.write = 0; this.available = 0;
    this.last = 0;
    this.primed = false;
    this.furos = 0;
    this.encolhidas = 0;
    this.blocos = 0;
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
  take() {
    const sample = this.ring[this.read];
    this.read = (this.read + 1) % RING_SIZE;
    this.available -= 1;
    return sample;
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    // Um relatório por segundo (o bloco é de 128 amostras = 8 ms a 16 kHz).
    // É ele que separa "atraso do transporte" de "atraso que nós criamos".
    this.blocos += 1;
    if (this.blocos >= 125) {
      this.blocos = 0;
      this.port.postMessage({
        atrasoMs: Math.round((this.available / ${SAMPLE_RATE}) * 1000),
        furos: this.furos,
        encolhidas: this.encolhidas,
      });
      this.furos = 0;
      this.encolhidas = 0;
    }
    if (!this.primed) {
      if (this.available < ALVO) { out.fill(0); return true; }
      this.primed = true;
    }
    const encolher = this.available > TETO;
    if (encolher) this.encolhidas += 1;
    for (let i = 0; i < out.length; i += 1) {
      if (this.available <= 0) {
        // Furo: desce até o silêncio em vez de cair nele.
        this.last *= 0.85;
        out[i] = this.last;
        this.primed = false;
        this.furos += 1;
        continue;
      }
      let sample = this.take();
      if (encolher && this.available > 0) sample = (sample + this.take()) * 0.5;
      this.last = sample;
      out[i] = sample;
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
    return await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
  } catch (err) {
    const name = (err as DOMException)?.name;
    // O microfone ESCOLHIDO no painel de áudio não está aí (desconectado, ou
    // tomado por outro programa). Uma ligação não pode morrer por causa de uma
    // preferência: cai no padrão do sistema e segue. A escolha continua salva —
    // o headset volta a valer assim que for plugado de novo.
    if ((name === 'OverconstrainedError' || name === 'NotFoundError') && microphoneConstraints().deviceId) {
      waCallsLog('microfone preferido indisponível — usando o padrão do sistema');
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch { /* cai nas mensagens abaixo com o erro original */ }
    }
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

/** O arquivo de uma chamada gravada, ainda na memória do navegador. */
export interface WaCallRecording {
  blob: Blob;
  mime: string;
  /** Quanto tempo a gravação durou, em segundos. */
  seconds: number;
}

/** A ponte viva de uma chamada. Uma por `callId` — nunca compartilhada. */
export interface WaCallAudioBridge {
  readonly callId: string;
  /** Corta/religa o ENVIO do microfone sem derrubar a chamada. */
  setMuted: (muted: boolean) => void;
  /** Começa a gravar os DOIS lados. `false` se o navegador não souber gravar. */
  startRecording: () => boolean;
  /** Encerra a gravação e devolve o arquivo. `null` se não havia gravação. */
  stopRecording: () => Promise<WaCallRecording | null>;
  isRecording: () => boolean;
  /**
   * A CONVERSA INTEIRA como stream, para mandar a um segundo atendente.
   *
   * É o mesmo par de vozes da gravação (minha + a do cliente) e de propósito
   * NÃO leva a voz do convidado: devolver a ele o próprio som seria eco puro.
   * `null` antes de o grafo subir.
   */
  guestFeed: () => MediaStream | null;
  /**
   * Liga a voz do segundo atendente na ligação: ela entra no MESMO worklet de
   * captura que o microfone daqui, e é isso que faz o cliente ouvi-la — o
   * WhatsApp continua vendo uma chamada só, com uma linha de áudio só.
   */
  attachGuest: (stream: MediaStream) => void;
  /** Tira o convidado do áudio, sem tocar na chamada. */
  detachGuest: () => void;
  /**
   * Quantos bytes de voz do OUTRO LADO já chegaram pelo DataChannel.
   *
   * Zero com a chamada já atendida quer dizer uma coisa só: o serviço de
   * chamadas não mandou som nenhum. É o número que separa "não escuto porque
   * nada chega" de "não escuto porque está tocando no alto-falante errado" —
   * sem ele, os dois defeitos são idênticos para quem está com o fone na
   * cabeça, e foi assim que a primeira ligação de verdade virou um mistério.
   */
  receivedAudioBytes: () => number;
  /**
   * Quanto áudio já recebido ainda está na fila esperando para tocar.
   *
   * É a metade do atraso que dá para medir daqui, e a única que é NOSSA: um
   * número que fica em 120–240 ms é o buffer de jitter fazendo o trabalho dele;
   * um que só sobe é a rede entregando em rajada mais rápido do que o buffer
   * consegue encolher.
   */
  playoutDelayMs: () => number;
  /** Quadros de microfone descartados por congestionamento na subida. */
  droppedUplinkFrames: () => number;
  /** Em que alto-falante a voz do cliente está tocando — e por que, se não é o escolhido. */
  outputRouting: () => OutputRouting | null;
  /** Libera tudo: DataChannel, PeerConnection, microfone, AudioContext e o <audio>. */
  close: () => void;
}

/**
 * O formato da gravação, na ordem do que cada navegador aceita.
 *
 * Opus em WebM é o que o Chrome/Edge/Firefox produzem e o que toca em qualquer
 * lugar depois; o `audio/mp4` no fim é para o Safari, que não grava WebM. A
 * fonte é PCM de 16 kHz (só isso existe nesta ponte), então a taxa baixa não
 * perde nada: o teto de qualidade é a própria chamada.
 */
const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of RECORDING_MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(mime)) return mime; } catch { /* segue */ }
  }
  return null;
}

/**
 * Por que o transporte caiu. A diferença importa para o operador: "a internet
 * oscilou no meio da conversa" e "a ligação nasceu sem caminho de áudio" pedem
 * reações diferentes de quem está com o cliente na linha.
 */
export type TransportFailure =
  /** O canal caiu no meio e não voltou dentro da carência. */
  | 'conexao-perdida'
  /** O canal nunca abriu — a ligação seria muda dos dois lados. */
  | 'sem-transporte';

/**
 * Quanto tempo uma queda do canal tem para se recertar antes de virar o fim da
 * chamada.
 *
 * O socket reconecta sozinho (ver `wacalls/socket`), e uma oscilação de Wi-Fi
 * de dois segundos não pode derrubar a ligação dos dois lados. Só vira fim quem
 * não voltou dentro da carência.
 */
const RECONEXAO_MS = 8000;

/**
 * Prazo para o canal de mídia abrir.
 *
 * Num caminho saudável ele já está aberto (o socket sobe junto com o CRM).
 * Esperar mais do que isto não é paciência, é deixar o operador falando
 * sozinho: sem o canal, o PCM não sobe nem desce e a chamada está muda dos DOIS
 * lados desde o primeiro instante.
 */
const TRANSPORTE_MS = 10000;

/**
 * Sobe a ponte de áudio de uma chamada já criada no Jurius Call.
 *
 * Não há negociação: o socket já está de pé, e acoplar a chamada é uma linha —
 * é o servidor que decide para quem a mídia dela vai.
 */
export async function openCallAudio(params: {
  callId: string;
  /** Microfone já aberto por `openMicrophone`. A ponte passa a ser dona dele. */
  micStream: MediaStream;
  /**
   * Avisado quando o transporte cai — e por quê. Só é chamado depois de
   * esgotada a carência de reconexão: uma oscilação que se resolve sozinha
   * nunca chega aqui.
   */
  onDisconnected?: (motivo: TransportFailure) => void;
}): Promise<WaCallAudioBridge> {
  const { callId, micStream } = params;

  let closed = false;
  let muted = false;
  let context: AudioContext | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let recordDestination: MediaStreamAudioDestinationNode | null = null;
  /** Destino que leva a conversa ao segundo atendente (sem a voz dele). */
  let guestDestination: MediaStreamAudioDestinationNode | null = null;
  /** O nó de captura, para a voz do convidado poder entrar no mesmo lugar. */
  let captureInput: AudioWorkletNode | null = null;
  /** A voz do convidado, enquanto ela estiver ligada. */
  let guestSource: MediaStreamAudioSourceNode | null = null;
  let recorder: MediaRecorder | null = null;
  let recordingChunks: Blob[] = [];
  let recordingStartedAt = 0;
  /** Bytes de voz recebidos do serviço. Ver `receivedAudioBytes`. */
  let receivedBytes = 0;
  /** Quanto áudio está represado esperando para tocar. Ver `playoutDelayMs`. */
  let atrasoDeSaidaMs = 0;
  /** Quadros que o navegador DESCARTOU por congestionamento na subida. */
  let descartadosNaSubida = 0;
  /** Onde a voz do cliente está saindo, depois de aplicado o alto-falante. */
  let routing: OutputRouting | null = null;
  /** Solta a escuta da troca de alto-falante feita no meio da chamada. */
  let stopDeviceWatch: (() => void) | null = null;
  /** A carência de uma queda do canal que ainda pode voltar. */
  let reconexao: ReturnType<typeof setTimeout> | null = null;
  /** O prazo do canal de mídia para abrir. */
  let transporteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Já avisamos que o transporte morreu? O aviso é um só. */
  let transporteMorto = false;
  const revoke: string[] = [];

  /** Solta as escutas do socket quando a chamada acaba. */
  const soltar: Array<() => void> = [];

  const close = () => {
    if (closed) return;
    closed = true;
    if (reconexao !== null) { clearTimeout(reconexao); reconexao = null; }
    if (transporteTimer !== null) { clearTimeout(transporteTimer); transporteTimer = null; }
    // Quem grava deve chamar `stopRecording()` ANTES (é ele quem devolve o
    // arquivo); aqui só sobra o descarte de uma gravação abandonada.
    try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* já parado */ }
    recorder = null;
    recordingChunks = [];
    stopDeviceWatch?.();
    stopDeviceWatch = null;
    try { guestSource?.disconnect(); } catch { /* já solto */ }
    guestSource = null;
    for (const parar of soltar) { try { parar(); } catch { /* já solto */ } }
    soltar.length = 0;
    // Solta a mídia no servidor, mas NÃO fecha o socket: a sinalização das
    // outras chamadas (e o próximo convite) continua chegando por ele.
    callSocket.detach(callId);
    try { micStream.getTracks().forEach(track => track.stop()); } catch { /* idem */ }
    try { void context?.close(); } catch { /* idem */ }
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

    // Captura: microfone → worklet → PCM Int16 (960 amostras) → WebSocket.
    const micSource = context.createMediaStreamSource(micStream);
    const captureNode = new AudioWorkletNode(context, 'capture-processor');
    captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      // O mudo corta AQUI, no envio. É também o que o servidor precisa saber
      // (ver `waCallsService.setMuted`), para o motor emitir conforto em vez de
      // um silêncio que o outro lado leria como queda.
      if (muted || !callSocket.isOpen()) return;
      // `sendAudio` devolve `false` quando a subida está congestionada e o
      // quadro foi descartado em vez de entrar numa fila que só cresce. Ver
      // `wacalls/socket`: em voz, um quadro atrasado vale menos que um perdido.
      if (!callSocket.sendAudio(float32ToInt16LE(event.data))) descartadosNaSubida += 1;
    };
    micSource.connect(captureNode);
    // O worklet de captura não escreve na saída (silêncio); a ligação com o
    // destino existe só para o grafo ser processado.
    captureNode.connect(context.destination);

    // Reprodução: WebSocket → worklet → MediaStream → <audio>.
    const playbackNode = new AudioWorkletNode(context, 'playback-processor');
    const streamDestination = context.createMediaStreamDestination();
    playbackNode.connect(streamDestination);
    // O worklet devolve, uma vez por segundo, o tamanho da fila de saída. Sem
    // este número, "está atrasado" é opinião: ele diz se o atraso está no
    // transporte (fila curta, mas a voz demora a chegar) ou represado aqui
    // (fila crescendo). Só fala quando há o que dizer.
    playbackNode.port.onmessage = (event: MessageEvent<{
      atrasoMs: number; furos: number; encolhidas: number;
    }>) => {
      const { atrasoMs, furos, encolhidas } = event.data;
      atrasoDeSaidaMs = atrasoMs;
      if (furos > 0 || encolhidas > 0 || atrasoMs > 400) {
        waCallsLog('qualidade do áudio', {
          callId, atrasoMs, furos, encolhidas, descartadosNaSubida,
        });
      }
    };
    soltar.push(callSocket.onMedia(frame => {
      // O socket entrega áudio e vídeo pela mesma porta; o vídeo é de quem o
      // pediu (ver `videoBridge`), não desta ponte.
      if (frame.kind !== KIND_AUDIO) return;
      receivedBytes += frame.body.byteLength;
      playbackNode.port.postMessage(int16LEToFloat32(frame.body));
    }));

    // Barramento da gravação: minha voz e a voz do outro lado no MESMO destino.
    // O microfone entra pela fonte (e não pelo worklet de captura, que não
    // escreve na saída), e o áudio recebido entra pelo worklet de reprodução —
    // é o único ponto do grafo em que os dois lados existem juntos.
    recordDestination = context.createMediaStreamDestination();
    micSource.connect(recordDestination);
    playbackNode.connect(recordDestination);

    // A MESMA composição, num destino separado, é o que o segundo atendente
    // ouve. Separado e não reaproveitado porque a voz DELE entra na gravação
    // (ele é parte do atendimento) e não pode entrar no que volta para ele.
    guestDestination = context.createMediaStreamDestination();
    micSource.connect(guestDestination);
    playbackNode.connect(guestDestination);
    captureInput = captureNode;

    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = streamDestination.stream;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    // A voz do cliente vai para o alto-falante escolhido no painel de áudio.
    //
    // COM `await`, e ANTES do `play()`: disparados juntos, `setSinkId` e
    // `play()` disputam o mesmo elemento, e o Chrome reinicia a saída quando o
    // sink troca com a reprodução já em curso — o começo da fala do cliente se
    // perde. Esperar aqui custa milissegundos e o áudio já nasce no lugar
    // certo. Se o dispositivo escolhido tiver sumido, o elemento volta ao
    // padrão do sistema em vez de ficar apontado para o que não existe mais.
    const elemento = audioEl;
    routing = await applyOutputToElement(elemento);
    if (routing.reason === 'dispositivo-sumiu') {
      waCallsLog('alto-falante escolhido sumiu — voz no padrão do sistema', { callId });
    }
    // Trocar de fone NO MEIO da ligação tem de valer na hora: é exatamente
    // quando se descobre que o som está saindo no lugar errado.
    stopDeviceWatch = onAudioDeviceChange(() => {
      void applyOutputToElement(elemento).then(next => { routing = next; });
    });
    // O gesto do operador (o clique em Ligar/Atender) já libera o autoplay; se
    // ainda assim o navegador recusar, não há o que fazer além de seguir.
    void elemento.play().catch(() => {});

    // O fim do transporte passa por UMA porta só, e uma vez só.
    const derrubar = (motivo: TransportFailure) => {
      if (closed || transporteMorto) return;
      transporteMorto = true;
      waCallsLog('transporte perdido', { callId, motivo, recebidos: receivedBytes });
      params.onDisconnected?.(motivo);
    };

    // Acopla a chamada: daqui em diante o servidor manda a mídia DELA para este
    // socket, e o que subir daqui entra nela. Não há SDP, não há candidato, não
    // há espera de ICE — o canal já está de pé.
    callSocket.attach(callId);

    // Uma queda do socket NÃO derruba a chamada na hora: ele reconecta sozinho
    // e reacopla. Só vira fim quem não voltou dentro da carência.
    soltar.push(callSocket.onClose(() => {
      if (closed || reconexao !== null) return;
      waCallsLog('canal oscilou — aguardando voltar', { callId, ms: RECONEXAO_MS });
      reconexao = setTimeout(() => {
        reconexao = null;
        if (closed || callSocket.isOpen()) return;
        derrubar('conexao-perdida');
      }, RECONEXAO_MS);
    }));
    soltar.push(callSocket.onOpen(() => {
      if (reconexao !== null) { clearTimeout(reconexao); reconexao = null; }
      waCallsLog('canal de volta', { callId });
    }));

    // Sem canal aberto o PCM não sobe nem desce, e a chamada está muda dos dois
    // lados desde o primeiro instante. Este prazo troca esse silêncio por uma
    // explicação.
    transporteTimer = setTimeout(() => {
      transporteTimer = null;
      if (closed || callSocket.isOpen()) return;
      waCallsLog('o canal de mídia não abriu no prazo', { callId });
      derrubar('sem-transporte');
    }, TRANSPORTE_MS);
  } catch (err) {
    close();
    throw err;
  }

  const startRecording = (): boolean => {
    if (closed || recorder || !recordDestination) return false;
    const mime = pickRecordingMime();
    if (!mime) return false;
    try {
      const rec = new MediaRecorder(recordDestination.stream, { mimeType: mime });
      recordingChunks = [];
      rec.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) recordingChunks.push(event.data);
      };
      // Fatias de 1s: uma chamada longa não fica inteira num buffer só, e uma
      // aba fechada no meio ainda teria entregado o que já passou.
      rec.start(1000);
      recorder = rec;
      recordingStartedAt = Date.now();
      waCallsLog('gravação iniciada', { callId, mime });
      return true;
    } catch (err) {
      console.error('[WaCalls] não foi possível iniciar a gravação', err);
      return false;
    }
  };

  const stopRecording = (): Promise<WaCallRecording | null> => {
    const rec = recorder;
    if (!rec) return Promise.resolve(null);
    recorder = null;
    const mime = rec.mimeType || 'audio/webm';
    const seconds = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
    if (rec.state === 'inactive') {
      const blob = new Blob(recordingChunks, { type: mime });
      recordingChunks = [];
      return Promise.resolve(blob.size > 0 ? { blob, mime, seconds } : null);
    }
    // O último pedaço só chega no `dataavailable` que o `stop()` dispara — por
    // isso o arquivo é montado no `onstop`, e não logo depois do `stop()`.
    return new Promise<WaCallRecording | null>(resolve => {
      const finish = () => {
        const blob = new Blob(recordingChunks, { type: mime });
        recordingChunks = [];
        waCallsLog('gravação encerrada', { callId, bytes: blob.size, seconds });
        resolve(blob.size > 0 ? { blob, mime, seconds } : null);
      };
      rec.onstop = finish;
      rec.onerror = finish;
      try { rec.stop(); } catch { finish(); }
    });
  };

  const attachGuest = (stream: MediaStream) => {
    if (closed || !context || !captureInput) return;
    detachGuest();
    guestSource = context.createMediaStreamSource(stream);
    // O WebAudio SOMA tudo o que chega na mesma entrada: ligar a voz do
    // convidado no nó de captura mistura as duas vozes no PCM que sobe, sem
    // mixer nenhum no caminho. É também por isso que ele obedece ao mudo daqui
    // — o corte é no envio dos quadros, depois da soma.
    guestSource.connect(captureInput);
    // E entra na gravação: quem falou com o cliente faz parte do atendimento.
    if (recordDestination) guestSource.connect(recordDestination);
    waCallsLog('segundo atendente no áudio', { callId });
  };

  const detachGuest = () => {
    if (!guestSource) return;
    try { guestSource.disconnect(); } catch { /* já solto */ }
    guestSource = null;
    waCallsLog('segundo atendente fora do áudio', { callId });
  };

  return {
    callId,
    guestFeed: () => guestDestination?.stream ?? null,
    attachGuest,
    detachGuest,
    startRecording,
    stopRecording,
    isRecording: () => recorder !== null,
    receivedAudioBytes: () => receivedBytes,
    playoutDelayMs: () => atrasoDeSaidaMs,
    droppedUplinkFrames: () => descartadosNaSubida,
    outputRouting: () => routing,
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
