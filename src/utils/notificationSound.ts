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
 * Destrava o áudio no primeiro gesto do usuário.
 *
 * Um AudioContext criado sem interação prévia nasce `suspended`, e o navegador
 * só aceita `resume()` a partir de um gesto. O aviso de mensagem nova chega por
 * websocket — nunca dentro de um gesto —, então sem isto o contexto ficava
 * suspenso para sempre e o som não saía nunca.
 *
 * No localhost isso não aparecia: o Chrome libera autoplay ali, o contexto já
 * nascia `running` e não havia nada a destravar. Só na hospedagem o toque
 * sumia — e sumia calado, porque áudio bloqueado não levanta erro.
 *
 * Os ouvintes são passivos, disparam uma vez e saem sozinhos assim que o
 * contexto está de pé.
 */
export function armarDestravamentoDeAudio(): void {
  if (typeof window === 'undefined') return;

  const destravar = () => {
    const ac = getCtx();
    if (!ac) return soltar();
    if (ac.state === 'running') return soltar();
    void ac.resume().then(soltar).catch(() => { /* outro gesto tentará de novo */ });
  };

  const soltar = () => {
    window.removeEventListener('pointerdown', destravar);
    window.removeEventListener('keydown', destravar);
    window.removeEventListener('touchstart', destravar);
  };

  window.addEventListener('pointerdown', destravar, { passive: true });
  window.addEventListener('keydown', destravar, { passive: true });
  window.addEventListener('touchstart', destravar, { passive: true });
}

// Armado na importação: o módulo entra junto com a tela, muito antes de a
// primeira mensagem chegar, então o primeiro clique em qualquer lugar do CRM já
// deixa o áudio pronto. Não cria o AudioContext aqui — só no gesto, que é
// quando o navegador aceita.
armarDestravamentoDeAudio();

/**
 * O AudioContext compartilhado — e só quando ele já está tocável.
 *
 * Existe para quem toca um som próprio (o sino do NotificationBell) não precisar
 * abrir o seu: dois contextos significam dois destravamentos, e um deles sempre
 * fica para trás. Nunca cria o contexto: fora de um gesto ele nasceria
 * `suspended` e o navegador registraria um aviso no console a cada tentativa.
 * Antes do primeiro clique devolve `null`, e quem chama fica em silêncio.
 */
export function getContextoTocavel(): AudioContext | null {
  if (!ctx) return null;
  if (ctx.state !== 'running') {
    // Pode ter sido suspenso por inatividade; o próximo gesto termina o serviço.
    void ctx.resume().catch(() => { /* sem áudio agora — não é erro */ });
    return null;
  }
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
 *
 * Os dois seguintes não são camadas de mensagem: são ESPÉCIES de aviso, e
 * existem porque o resto do WhatsApp passou a avisar também. A regra é que o
 * ouvido saiba do que se trata antes de os olhos chegarem à tela:
 *
 * - `task`    — alguma coisa passou a esperar por VOCÊ (conversa transferida,
 *               a IA pedindo aprovação, o caso devolvido para atendimento
 *               humano). Duas notas subindo por uma quarta, mais graves que o
 *               toque de mensagem: soa como pergunta, não como recado.
 * - `alert`   — alguma coisa não deu certo ou terminou sem você (chamada
 *               perdida, canal fora do ar, mensagem agendada que falhou). Duas
 *               notas DESCENDO, graves e curtas. É a única direção que o ouvido
 *               lê como "isto não avançou" sem precisar de volume.
 */
export type NotifyTone = 'global' | 'inbox' | 'in-chat' | 'task' | 'alert';

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

  if (tone === 'task') {
    // Fá5 → Si♭5: quarta justa ascendente, uma oitava abaixo do toque de
    // mensagem. Fica claramente mais escuro que o "chegou coisa nova" e ainda
    // assim resolve para cima — quem ouve entende que ganhou trabalho, não que
    // perdeu alguma coisa. As duas notas quase se encostam (60ms) para o par
    // soar como UM toque, e não como dois avisos seguidos.
    strikeBell(ac, master, { freq: 698.46, at: 0, dur: 0.5, gain: 0.26, pan: -0.14 });
    strikeBell(ac, master, { freq: 932.33, at: 0.06, dur: 0.8, gain: 0.24, pan: 0.14 });
    return;
  }

  if (tone === 'alert') {
    // Sol4 → Ré4: quinta DESCENDENTE, a mesma distância do toque de mensagem
    // virada de cabeça para baixo. Grave e curta de propósito: informa a queda
    // sem soar como alarme, que é o que faz desligar o som de tudo.
    strikeBell(ac, master, { freq: 392, at: 0, dur: 0.42, gain: 0.28, pan: -0.1 });
    strikeBell(ac, master, { freq: 293.66, at: 0.1, dur: 0.6, gain: 0.24, pan: 0.1 });
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
    if (ac.state !== 'running') {
      // Não agenda com o relógio parado: `currentTime` não avança enquanto o
      // contexto está suspenso, então as notas nasceriam no passado e o toque
      // se perderia justamente na vez em que ele importava. Melhor perder o
      // primeiro aviso e tocar todos os seguintes.
      void ac.resume().catch(() => { /* o próximo gesto destrava */ });
      return;
    }
    scheduleNotificationTone(ac, ac.destination, tone);
  } catch {
    /* áudio é um extra; nunca deixa a notificação visual quebrar */
  }
}
