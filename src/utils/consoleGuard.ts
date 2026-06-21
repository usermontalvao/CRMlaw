/**
 * consoleGuard — controla o que aparece no console do navegador.
 *
 *  • PRODUÇÃO: silencia todo o ruído (log/info/debug/warn/group/etc.) e mantém
 *    APENAS `console.error`. Em desenvolvimento, nada é silenciado.
 *  • SEMPRE: imprime um aviso anti-self-XSS (golpe em que alguém convence o
 *    usuário a colar código no console). NÃO tentamos "bloquear" o console —
 *    isso é impossível de garantir e dá falsa segurança; a proteção real é o
 *    RLS/edge no servidor. O aviso é o que de fato reduz o risco com leigos.
 *
 * Importado como efeito colateral, ANTES de tudo, em main.tsx.
 */

// Guarda referência ao console original antes de qualquer override.
const original = {
  log: console.log.bind(console),
};

function printSelfXssWarning(): void {
  try {
    original.log(
      '%cPare!',
      'font-size:24px;font-weight:800;color:#ea580c;',
    );
    original.log(
      '%cEsta é uma ferramenta do navegador para desenvolvedores.\n' +
      'Se alguém pediu para você colar ou digitar algo aqui para "liberar" ou ' +
      '"ativar" uma função, é um golpe (self-XSS) e pode dar acesso à sua conta a terceiros.\n' +
      'Não cole nada que você não entenda.',
      'font-size:13px;line-height:1.6;color:#0f172a;',
    );
  } catch {
    /* console pode não suportar %c em alguns ambientes — ignorar */
  }
}

function isLocalhost(): boolean {
  const h = typeof window !== 'undefined' ? window.location.hostname : '';
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.local');
}

function installConsoleGuard(): void {
  printSelfXssWarning();

  // Só restringe no build publicado (push). Em dev OU localhost: console completo.
  if (!import.meta.env.PROD || isLocalhost()) return;

  const noop = (): void => {};
  const silenced: (keyof Console)[] = [
    'log', 'info', 'debug', 'trace', 'dir', 'dirxml', 'table',
    'group', 'groupCollapsed', 'groupEnd',
    'count', 'countReset', 'time', 'timeEnd', 'timeLog',
    'warn', 'assert',
  ];
  for (const method of silenced) {
    try {
      (console as unknown as Record<string, unknown>)[method] = noop;
    } catch {
      /* alguns ambientes proíbem reatribuir métodos do console */
    }
  }
}

installConsoleGuard();

export {};
