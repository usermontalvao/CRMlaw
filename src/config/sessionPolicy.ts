/**
 * Política de sessão (timeouts) — fonte única para staff e portal do cliente.
 *
 * Dois cortes combinados (OWASP ASVS 3.3 / NIST 800-63B):
 *  · IDLE      — tempo máximo SEM interação. Reseta a cada atividade do usuário.
 *  · ABSOLUTE  — tempo máximo de vida da sessão desde o login (time-box). NÃO
 *                reseta com atividade; fecha a janela de um refresh token roubado.
 *
 * O que acontecer primeiro encerra a sessão.
 *
 * IMPORTANTE: estes valores são a camada de cliente (aviso + redirect imediato).
 * A trava definitiva deve ser imposta também no servidor, em
 * Supabase → Authentication → Sessions ("Inactivity timeout" + "Time-box user
 * sessions"), já que qualquer enforcement em JS é, por natureza, burlável.
 */
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const SESSION_POLICY = {
  staff: {
    idleMs: 30 * MIN, // 30 min sem interação
    absoluteMs: 12 * HOUR, // 12 h desde o login (re-login ~1x por dia)
  },
  portal: {
    idleMs: 20 * MIN, // 20 min sem interação (dispositivo pessoal/compartilhado do cliente)
    absoluteMs: 12 * HOUR, // 12 h desde o login
  },
  /** Antecedência do aviso "sua sessão vai expirar" (antes do corte por inatividade). */
  warningMs: 2 * MIN,
  /** Cadência do verificador local de inatividade/time-box. */
  tickMs: 20 * 1000,
} as const;
