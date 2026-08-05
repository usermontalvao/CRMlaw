// Som de notificação sintetizado via Web Audio API — evita empacotar um asset
// de áudio e funciona offline.
//
// Por que não são duas senoides puras: senoide crua soa a bipe de eletrodoméstico.
// O que o ouvido reconhece como "sino" é a soma de parciais que decaem em
// velocidades diferentes — o brilho vai embora antes do corpo da nota. É isso
// que está montado aqui: para cada nota, três parciais (fundamental + 2 acima,
// levemente desafinados para cima como num metal real), cada um com envelope
// próprio e mais curto conforme sobe. Um passa-baixa comum tira a aspereza do
// ataque, e as duas notas são abertas no campo estéreo para o som não sair de um
// ponto só. São dois toques em quinta ascendente, curtos: presente sem mandar
// ninguém parar o que está fazendo.
//
// Navegadores bloqueiam áudio até haver interação do usuário; como o som só
// dispara enquanto a pessoa usa o CRM, o AudioContext já pôde ser destravado.
// Ainda assim chamamos resume() defensivamente.

// Preferência de som (persistida). 'off' silencia o som mantendo o aviso visual.
const MUTE_KEY = 'wa:notifySound';
// Preferência separada para o toque da conversa que está ABERTA na tela. Quem
// atende o dia inteiro com a conversa à vista costuma querer só o toque das
// outras — este é o único som que dispara enquanto a pessoa já está lendo.
const IN_CHAT_MUTE_KEY = 'wa:notifySoundInChat';

/** true se o usuário desligou o som das notificações de WhatsApp. */
export function isNotifySoundMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === 'off'; } catch { return false; }
}

/** Liga/desliga o som das notificações de WhatsApp. */
export function setNotifySoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, 'off');
    else localStorage.removeItem(MUTE_KEY);
  } catch { /* localStorage indisponível — ignora */ }
}

/** true se o usuário desligou só o toque da conversa aberta. */
export function isInChatSoundMuted(): boolean {
  try { return localStorage.getItem(IN_CHAT_MUTE_KEY) === 'off'; } catch { return false; }
}

/** Liga/desliga o toque da conversa aberta (independente do som geral). */
export function setInChatSoundMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(IN_CHAT_MUTE_KEY, 'off');
    else localStorage.removeItem(IN_CHAT_MUTE_KEY);
  } catch { /* localStorage indisponível — ignora */ }
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/**
 * Parciais de um sino: amplitude relativa, multiplicador de frequência e quanto
 * do tempo total cada um dura. O agudo entra junto e sai primeiro — é o que dá o
 * "toc" metálico do ataque sem deixar o som estridente na cauda.
 */
const PARTIALS: Array<{ ratio: number; gain: number; hold: number }> = [
  { ratio: 1, gain: 1, hold: 1 },
  { ratio: 2.01, gain: 0.42, hold: 0.55 },
  { ratio: 3.02, gain: 0.16, hold: 0.28 },
];

/** Uma nota de sino, com envelope próprio e posição no campo estéreo. */
function strikeBell(
  ac: BaseAudioContext,
  destination: AudioNode,
  opts: { freq: number; at: number; dur: number; gain: number; pan: number },
): void {
  const start = ac.currentTime + opts.at;

  // Passa-baixa acompanhando a nota: abre no ataque e fecha junto com a cauda,
  // como o brilho de um metal percutido morrendo.
  const tone = ac.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.7;
  tone.frequency.setValueAtTime(opts.freq * 6, start);
  tone.frequency.exponentialRampToValueAtTime(Math.max(400, opts.freq * 1.6), start + opts.dur);

  // `StereoPannerNode` não existe em Safari antigo; sem ele o som fica no centro,
  // o que é degradação aceitável.
  const out: AudioNode = typeof ac.createStereoPanner === 'function'
    ? (() => { const p = ac.createStereoPanner(); p.pan.value = opts.pan; p.connect(destination); return p; })()
    : destination;
  tone.connect(out);

  for (const partial of PARTIALS) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = opts.freq * partial.ratio;

    const env = ac.createGain();
    const peak = opts.gain * partial.gain;
    const dur = opts.dur * partial.hold;
    env.gain.setValueAtTime(0.0001, start);
    // 8ms de ataque: rápido o bastante para soar percutido, lento o bastante
    // para não estalar.
    env.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    // Decaimento por constante de tempo, e não por rampa até um alvo: a rampa
    // exponencial do WebAudio despenca no primeiro terço e deixa o resto da nota
    // inaudível — sobra um "tic", não um sino. Com tau = dur/4, sobra ~2% em
    // `dur`, que é exatamente a cauda que se ouve morrer.
    env.gain.setTargetAtTime(0, start + 0.009, dur / 4);

    osc.connect(env);
    env.connect(tone);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}

/**
 * Onde a pessoa estava quando a mensagem chegou. Cada camada tem um toque
 * próprio, e a diferença entre eles é o que permite reagir sem olhar a tela:
 *
 * - `global`  — fora do módulo (dashboard, prazos, qualquer tela do CRM) ou com
 *               a aba escondida: duas notas ascendentes, o toque que chama.
 * - `inbox`   — dentro do WhatsApp, mensagem em OUTRA conversa: uma nota só,
 *               mais curta. Avisa que a lista mexeu sem interromper a leitura.
 * - `in-chat` — na própria conversa aberta: nota grave e baixa, quase um toque
 *               de confirmação; a mensagem já está aparecendo na tela.
 */
export type NotifyTone = 'global' | 'inbox' | 'in-chat';

/**
 * Agenda o toque num contexto qualquer. Separado de `playNotificationSound`
 * para o mesmo som poder ser renderizado num `OfflineAudioContext` e conferido
 * (pico, duração, decaimento) sem depender do ouvido de quem revisa.
 */
export function scheduleNotificationTone(
  ac: BaseAudioContext,
  destination: AudioNode,
  tone: NotifyTone = 'global',
): void {
  // Barramento único: mantém o pico somado das notas longe do 0 dBFS, onde o
  // navegador distorce.
  const master = ac.createGain();
  master.gain.value = 0.7;
  master.connect(destination);

  if (tone === 'in-chat') {
    // Dó5, curto e no centro: o som mais grave e mais baixo dos três. Toca
    // dezenas de vezes por dia na frente de quem está lendo — precisa passar
    // despercebido quando se está atento e ser notado quando não se está.
    strikeBell(ac, master, { freq: 523.25, at: 0, dur: 0.26, gain: 0.13, pan: 0 });
    return;
  }

  if (tone === 'inbox') {
    // Si5: uma nota só, meio caminho entre o toque global e o da conversa
    // aberta. Sem segunda nota — é o que faz o ouvido separar "chegou noutra
    // conversa" de "chegou algo no CRM" sem precisar pensar.
    strikeBell(ac, master, { freq: 987.77, at: 0, dur: 0.42, gain: 0.22, pan: 0.1 });
    return;
  }

  // Lá5 → Mi6: quinta ascendente, o intervalo mais estável que existe — soa
  // resolvido mesmo em meio segundo. A segunda nota é mais baixa e mais longa,
  // então o toque termina se dissolvendo em vez de parar seco.
  strikeBell(ac, master, { freq: 880, at: 0, dur: 0.55, gain: 0.30, pan: -0.18 });
  strikeBell(ac, master, { freq: 1318.51, at: 0.085, dur: 0.85, gain: 0.24, pan: 0.18 });
}

/** Toca o "ding" de mensagem nova. Silencioso se o áudio não estiver disponível. */
export function playNotificationSound(tone: NotifyTone = 'global'): void {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    scheduleNotificationTone(ac, ac.destination, tone);
  } catch {
    /* áudio é um extra; nunca deixa a notificação visual quebrar */
  }
}
