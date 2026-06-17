// Som de notificação sintetizado via Web Audio API — evita empacotar um asset
// de áudio e funciona offline. Dois tons curtos em cascata (estilo "ding-dong"
// suave), no tom âmbar da marca: discreto, não estridente.
//
// Navegadores bloqueiam áudio até haver interação do usuário; como o som só
// dispara enquanto a pessoa usa o CRM, o AudioContext já pôde ser destravado.
// Ainda assim chamamos resume() defensivamente.

// Preferência de som (persistida). 'off' silencia o som mantendo o aviso visual.
const MUTE_KEY = 'wa:notifySound';

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

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Toca o "ding" de mensagem nova. Silencioso se o áudio não estiver disponível. */
export function playNotificationSound(): void {
  try {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();

    const now = ac.currentTime;
    // Duas notas (Sol5 → Dó6) com envelope curto para um toque limpo.
    const notes: Array<{ freq: number; at: number; dur: number }> = [
      { freq: 784, at: 0, dur: 0.14 },
      { freq: 1047, at: 0.12, dur: 0.18 },
    ];

    const master = ac.createGain();
    master.gain.value = 0.0001;
    master.connect(ac.destination);

    for (const n of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Envelope: ataque rápido, decaimento suave (evita "clique").
      const start = now + n.at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + n.dur + 0.02);
    }
    master.gain.setValueAtTime(1, now);
  } catch {
    /* áudio é um extra; nunca deixa a notificação visual quebrar */
  }
}
