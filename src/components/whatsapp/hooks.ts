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

/** Retorna dia da semana e minutos desde meia-noite no timezone IANA informado. */
export function getCurrentTimeInTz(timezone: string): { dow: number; curMins: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
    const hour = +(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
    const minute = +(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { dow: dayMap[weekday] ?? new Date().getDay(), curMins: hour * 60 + minute };
  } catch {
    const now = new Date();
    return { dow: now.getDay(), curMins: now.getHours() * 60 + now.getMinutes() };
  }
}
