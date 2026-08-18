// Os sons das chamadas de voz: o toque de chamada recebida, o "chamando" de
// quem discou e os dois avisos curtos (atendeu / desligou).
//
// Por que existe: até aqui a chamada era MUDA. Uma ligação chegando só se
// anunciava por um cartão no canto da tela — quem estivesse escrevendo uma
// petição em outra aba do CRM perdia o cliente sem nunca saber que o telefone
// tocou. Som é o único aviso que funciona sem estar olhando.
//
// Tudo sintetizado na Web Audio API (nenhum arquivo de áudio no bundle) e sobre
// o MESMO AudioContext das notificações de mensagem — dois contextos
// significariam dois destravamentos de autoplay, e um deles sempre ficaria
// para trás (ver `utils/notificationSound`).
//
// Os dois toques são deliberadamente diferentes entre si:
//   • recebida  — três notas ascendentes repetidas em rajada, alto o bastante
//                 para chamar de outra sala; é o único som do CRM que quer
//                 interromper o que a pessoa está fazendo.
//   • chamando  — 425 Hz, 1s ligado / 4s desligado: o controle de chamada
//                 brasileiro. Quem já ouviu um telefone fixo reconhece sem
//                 pensar, e o silêncio longo não cansa numa espera de 30s.
import { getContextoTocavel } from '../../utils/notificationSound';

/** Preferência persistida: silencia o TOQUE sem mexer no áudio da chamada. */
const RING_MUTE_KEY = 'wa:callRing';

export function isCallRingMuted(): boolean {
  try { return localStorage.getItem(RING_MUTE_KEY) === 'off'; } catch { return false; }
}

export function setCallRingMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(RING_MUTE_KEY, 'off');
    else localStorage.removeItem(RING_MUTE_KEY);
  } catch { /* localStorage indisponível — ignora */ }
}

export type RingKind = 'incoming' | 'outgoing';

/** Quanto tempo cada ciclo do toque dura antes de recomeçar. */
const CYCLE_MS: Record<RingKind, number> = { incoming: 3200, outgoing: 5000 };

/** Uma nota com envelope suave — ataque e queda em rampa, sem estalo. */
function tone(
  ac: BaseAudioContext,
  destination: AudioNode,
  opts: { freq: number; at: number; dur: number; gain: number; type?: OscillatorType },
): void {
  const start = ac.currentTime + opts.at;
  const osc = ac.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.value = opts.freq;

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(opts.gain, start + 0.02);
  env.gain.setValueAtTime(opts.gain, start + Math.max(0.03, opts.dur - 0.06));
  env.gain.exponentialRampToValueAtTime(0.0001, start + opts.dur);

  osc.connect(env);
  env.connect(destination);
  osc.start(start);
  osc.stop(start + opts.dur + 0.03);
}

/**
 * Agenda UM ciclo do toque. Exportado com o contexto por parâmetro para poder
 * ser renderizado num `OfflineAudioContext` e conferido sem depender do ouvido
 * de quem revisa — mesma escolha do `scheduleNotificationTone`.
 */
export function scheduleRingCycle(ac: BaseAudioContext, destination: AudioNode, kind: RingKind): void {
  const master = ac.createGain();
  master.gain.value = 0.7;
  master.connect(destination);

  if (kind === 'outgoing') {
    // Controle de chamada: 425 Hz por 1s, e o resto do ciclo em silêncio.
    tone(ac, master, { freq: 425, at: 0, dur: 1, gain: 0.06 });
    return;
  }

  // Lá5 → Dó#6 → Mi6 (tríade maior ascendente), duas rajadas com respiro entre
  // elas. A segunda rajada é o que faz o som ser lido como "telefone tocando"
  // em vez de "notificação chegou".
  const burst = (at: number, gain: number) => {
    tone(ac, master, { freq: 880, at, dur: 0.17, gain });
    tone(ac, master, { freq: 1108.73, at: at + 0.16, dur: 0.17, gain });
    tone(ac, master, { freq: 1318.51, at: at + 0.32, dur: 0.3, gain: gain * 0.9 });
  };
  burst(0, 0.13);
  burst(0.72, 0.11);
}

let cycleTimer: ReturnType<typeof setInterval> | null = null;
let currentKind: RingKind | null = null;

/**
 * Vibração no celular acompanhando o toque (ignorada onde não existe).
 *
 * `vibrando` existe para o cancelamento: pedir `vibrate(0)` sem nunca ter
 * vibrado é inofensivo, mas o Chrome registra uma "Intervention" no console
 * quando a aba ainda não recebeu clique nenhum — e `stopRing()` roda em toda
 * montagem do host, o que enchia o console de aviso a cada carregamento.
 */
let vibrando = false;

function vibrate(kind: RingKind): void {
  if (kind !== 'incoming') return;
  try {
    if (navigator.vibrate?.([420, 180, 420])) vibrando = true;
  } catch { /* sem vibração — tudo bem */ }
}

function ringOnce(kind: RingKind): void {
  const ac = getContextoTocavel();
  // Contexto ainda travado (nenhum clique nesta aba desde que ela abriu): o
  // ciclo seguinte tenta de novo, então basta um gesto para o toque entrar.
  if (!ac) return;
  try { scheduleRingCycle(ac, ac.destination, kind); } catch { /* áudio é extra */ }
}

/**
 * Começa (ou troca) o toque. Chamar de novo com o MESMO tipo não reinicia o
 * ciclo — a UI pode chamar a cada render sem picotar o som.
 */
export function startRing(kind: RingKind): void {
  if (currentKind === kind) return;
  stopRing();
  currentKind = kind;
  if (isCallRingMuted()) return;
  ringOnce(kind);
  vibrate(kind);
  cycleTimer = setInterval(() => {
    ringOnce(kind);
    vibrate(kind);
  }, CYCLE_MS[kind]);
}

/** Para o toque. Seguro chamar sem nada tocando. */
export function stopRing(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = null;
  currentKind = null;
  if (vibrando) {
    vibrando = false;
    try { navigator.vibrate?.(0); } catch { /* sem vibração */ }
  }
}

/**
 * Toca UM ciclo do toque de chamada recebida, para conferir o alto-falante.
 *
 * Ignora o silenciamento de propósito: quem apertou "tocar um teste" pediu o
 * som agora — e a preferência de mudo é sobre chamadas que chegam sozinhas, não
 * sobre um teste deliberado. Devolve `false` quando o navegador ainda não
 * liberou o áudio nesta aba, para o painel poder dizer isso.
 */
export function playRingTest(): boolean {
  const ac = getContextoTocavel();
  if (!ac) return false;
  try { scheduleRingCycle(ac, ac.destination, 'incoming'); return true; } catch { return false; }
}

/** Duas notas subindo: a chamada foi atendida e o áudio está de pé. */
export function playCallConnectedTone(): void {
  const ac = getContextoTocavel();
  if (!ac || isCallRingMuted()) return;
  try {
    const master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
    tone(ac, master, { freq: 659.25, at: 0, dur: 0.12, gain: 0.09 });
    tone(ac, master, { freq: 987.77, at: 0.11, dur: 0.18, gain: 0.08 });
  } catch { /* áudio é extra */ }
}

/** Duas notas descendo: a linha caiu/foi encerrada. */
export function playCallEndedTone(): void {
  const ac = getContextoTocavel();
  if (!ac || isCallRingMuted()) return;
  try {
    const master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
    tone(ac, master, { freq: 587.33, at: 0, dur: 0.13, gain: 0.08 });
    tone(ac, master, { freq: 392, at: 0.12, dur: 0.24, gain: 0.07 });
  } catch { /* áudio é extra */ }
}
