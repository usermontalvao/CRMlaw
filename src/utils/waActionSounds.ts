// Sons de AÇÃO do módulo WhatsApp — o retorno que o aplicativo dá quando VOCÊ
// faz alguma coisa (mandar, gravar, descartar, apagar).
//
// É uma família diferente da de `notificationSound.ts`, e a diferença é de
// propósito, não de estilo. O aviso de mensagem nova é um sino: precisa
// atravessar a sala e ser ouvido de costas para a tela. O retorno de ação é o
// contrário — quem agiu está olhando para a tela e já sabe o que fez; o som só
// confirma. Por isso aqui tudo é mais curto (60–180ms contra 260–850ms), mais
// baixo (pico ~0.10 contra 0.30) e feito de senoide filtrada em vez de parciais
// de metal: um "tuc" de interface, não um badalo.
//
// A regra que mantém isso utilizável o dia inteiro: um som por ação DELIBERADA,
// nunca por evento automático. Enviar toca; a mensagem chegando pelo realtime
// não — quem cuida disso é o notificador.
//
// Compartilha o AudioContext de `notificationSound.ts` (via getContextoTocavel):
// dois contextos significariam dois destravamentos, e o segundo ficaria mudo
// para sempre porque o gesto de destravar já teria sido consumido pelo primeiro.
import { getContextoTocavel } from './notificationSound';

const MUTE_KEY = 'wa:actionSound';

/** true se o usuário desligou os sons de ação do WhatsApp. */
export function isWaActionSoundMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === 'off'; } catch { return false; }
}

/** Liga/desliga os sons de ação (independente do toque de mensagem nova). */
export function setWaActionSoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, 'off');
    else localStorage.removeItem(MUTE_KEY);
  } catch { /* localStorage indisponível — ignora */ }
}

/**
 * As ações que têm som. Cada uma existe porque o olho sozinho não confirma:
 *
 * - `send`       — a mensagem saiu do compositor. É o "swoosh" que o WhatsApp
 *                  toca no envio, aqui como um toque curto SUBINDO (algo saiu).
 * - `rec-start`  — o microfone abriu. Ouvir isso é a diferença entre falar e
 *                  falar para nada: sem confirmação, a pessoa grava 20 segundos
 *                  antes de descobrir que a permissão não tinha sido dada.
 * - `rec-stop`   — a gravação fechou e vai ser enviada.
 * - `rec-cancel` — a gravação foi jogada fora. DESCE, ao contrário do envio: é o
 *                  gesto oposto e precisa soar como tal, ainda mais depois de um
 *                  bug que enviava justamente o que se queria descartar.
 * - `delete`     — mensagem apagada. Grave e seco, sem cauda.
 * - `error`      — algo não foi. Duas notas descendentes, o único som "negativo".
 */
export type WaActionSound = 'send' | 'rec-start' | 'rec-stop' | 'rec-cancel' | 'delete' | 'error';

/** Um toque: senoide com envelope curto e um passa-baixa para tirar o estalo. */
function blip(
  ac: BaseAudioContext,
  destination: AudioNode,
  opts: { from: number; to?: number; at: number; dur: number; gain: number; type?: OscillatorType },
): void {
  const start = ac.currentTime + opts.at;
  const end = start + opts.dur;

  const osc = ac.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.from, start);
  // O glissando é o que dá direção ao som — subir "sai", descer "volta". Sem
  // ele, todos os toques viram o mesmo clique e o ouvido para de distinguir.
  if (opts.to && opts.to !== opts.from) {
    osc.frequency.exponentialRampToValueAtTime(opts.to, end);
  }

  // Passa-baixa fixo bem acima da nota: corta o clique do liga/desliga do
  // oscilador sem escurecer o toque.
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.6;
  tone.frequency.value = Math.max(opts.from, opts.to ?? opts.from) * 3.2;

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  // 6ms de ataque e decaimento por constante de tempo: o mesmo desenho de
  // envelope do sino, com a escala de tempo de um toque de interface.
  env.gain.exponentialRampToValueAtTime(opts.gain, start + 0.006);
  env.gain.setTargetAtTime(0, start + 0.008, opts.dur / 3.2);

  osc.connect(tone);
  tone.connect(env);
  env.connect(destination);
  osc.start(start);
  osc.stop(end + 0.06);
}

/**
 * Agenda o som num contexto qualquer — separado de `playWaActionSound` para o
 * mesmo desenho poder ser renderizado num `OfflineAudioContext` e conferido
 * (pico, duração) por teste, sem depender do ouvido de quem revisa.
 */
export function scheduleWaActionSound(
  ac: BaseAudioContext,
  destination: AudioNode,
  sound: WaActionSound,
): void {
  const master = ac.createGain();
  // Metade do barramento do sino: o som de ação nunca deve competir com o aviso
  // de mensagem nova quando os dois caem juntos (enviar uma e receber outra).
  master.gain.value = 0.35;
  master.connect(destination);

  switch (sound) {
    case 'send':
      // Sol5 → Ré6, 90ms: sobe e some. O "foi".
      blip(ac, master, { from: 784, to: 1174.66, at: 0, dur: 0.09, gain: 0.10 });
      return;
    case 'rec-start':
      // Nota única, média e discreta: o microfone abriu.
      blip(ac, master, { from: 660, to: 880, at: 0, dur: 0.07, gain: 0.085 });
      return;
    case 'rec-stop':
      // Espelho do início (desce de volta ao ponto de partida): fechou o ciclo.
      blip(ac, master, { from: 880, to: 660, at: 0, dur: 0.07, gain: 0.085 });
      return;
    case 'rec-cancel':
      // Duas notas caindo depressa — o oposto sonoro do envio, para o descarte
      // nunca ser confundido com "mandou".
      blip(ac, master, { from: 620, to: 440, at: 0, dur: 0.07, gain: 0.085 });
      blip(ac, master, { from: 440, to: 300, at: 0.055, dur: 0.09, gain: 0.07 });
      return;
    case 'delete':
      // Grave, triangular e seco: soa "fechado", como algo que some.
      blip(ac, master, { from: 380, to: 210, at: 0, dur: 0.11, gain: 0.09, type: 'triangle' });
      return;
    case 'error':
      // Duas notas descendentes e mais longas — o único som que pede atenção.
      blip(ac, master, { from: 440, at: 0, dur: 0.11, gain: 0.10, type: 'triangle' });
      blip(ac, master, { from: 349.23, at: 0.1, dur: 0.16, gain: 0.10, type: 'triangle' });
      return;
  }
}

/**
 * Toca o retorno da ação. Silencioso — e nunca lança — quando o áudio não está
 * disponível: som é confirmação, não parte da operação. Uma exceção aqui
 * derrubaria o envio da mensagem, que é o oposto do que este arquivo serve.
 */
export function playWaActionSound(sound: WaActionSound): void {
  if (isWaActionSoundMuted()) return;
  try {
    // `getContextoTocavel` devolve null antes do primeiro gesto do usuário. Como
    // todo som daqui nasce de um clique ou de uma tecla, na prática o contexto
    // já está de pé — o gesto que dispara a ação é o mesmo que destrava o áudio.
    const ac = getContextoTocavel();
    if (!ac) return;
    scheduleWaActionSound(ac, ac.destination, sound);
  } catch {
    /* áudio é um extra; nunca deixa a ação em si quebrar */
  }
}
