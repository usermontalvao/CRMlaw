// Hooks/utilitários internos do módulo WhatsApp (media queries + hora no fuso).
import { useState, useEffect } from 'react';

export function useWaMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);
  return matches;
}
/** Estreito demais para lista + thread lado a lado (abaixo do `md` = 768px). */
export function useWaIsMobile() { return useWaMediaQuery('(max-width: 767px)'); }
/** Largo o bastante para encaixar o painel do contato fixo (a partir do `xl` = 1280px). */
export function useWaIsPanelDocked() { return useWaMediaQuery('(min-width: 1280px)'); }

/**
 * Offset do fuso em minutos em relação ao UTC (Cuiabá = -240), medido AGORA —
 * assim horário de verão, se voltar a existir, entra sozinho. Cai em -240 (o
 * fuso do escritório) quando o nome do fuso é inválido.
 */
export function utcOffsetMinutesOf(timezone: string): number {
  try {
    const now = new Date();
    // Formata o mesmo instante no fuso alvo e lê como se fosse UTC: a diferença
    // para o instante real é exatamente o offset.
    const asUtc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const asLocal = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return Math.round((asLocal.getTime() - asUtc.getTime()) / 60_000);
  } catch {
    return -240;
  }
}

// `getCurrentTimeInTz` vivia aqui e servia a um único lugar: o banner de fora do
// horário, que refazia na mão o "que dia é hoje e que horas são no fuso do
// canal". Essa conta agora é de `businessTime` (a mesma que mede o SLA), então a
// versão local saiu — duas implementações de expediente é como o relógio de
// parede voltava a se infiltrar na tela.
