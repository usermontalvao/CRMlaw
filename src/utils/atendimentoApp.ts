/**
 * Descoberta e instalação do app "Atendimento" (o módulo WhatsApp como PWA
 * separado, em /atendimento). Ninguém adivinha que esse endereço existe — este
 * módulo é o que apresenta o app a quem usa o WhatsApp dentro do CRM.
 *
 * POR QUE NÃO DÁ PARA "PERGUNTAR AO NAVEGADOR" SE JÁ ESTÁ INSTALADO:
 *  - `navigator.getInstalledRelatedApps()` só responde sobre o app do PRÓPRIO
 *    escopo da página que chama. Em /whatsapp (escopo "/") ela não enxerga o
 *    app de escopo /atendimento — e ainda é experimental, só em Chromium.
 *  - `beforeinstallprompt` vale sempre para o manifest da PÁGINA ATUAL. Em
 *    /whatsapp ele instalaria o CRM, não o Atendimento. Por isso o convite aqui
 *    ABRE /atendimento; é lá que o botão de instalar de verdade aparece.
 *
 * O que sobra é sinal positivo, gravado pelo próprio app quando ele roda:
 *  - evento `appinstalled` na página /atendimento (instalou agora);
 *  - `display-mode: standalone` na página /atendimento (abriu já instalado).
 * Como é o mesmo domínio, o localStorage é compartilhado e o CRM lê a marca.
 *
 * A marca EXPIRA: se a pessoa desinstalar, ninguém avisa, e um "já instalado"
 * eterno esconderia o convite para sempre. Cada abertura do app renova o prazo.
 */

const INSTALLED_KEY = 'atendimento:app-instalado';
const HINT_DISMISSED_KEY = 'atendimento:convite-dispensado';

/** Sem abrir o app por 90 dias, tratamos como desinstalado e voltamos a convidar. */
export const INSTALLED_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** "Agora não" cala o convite por 30 dias — não para sempre. */
export const HINT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function readTimestamp(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null; // localStorage bloqueado (modo restrito)
  }
}

function writeTimestamp(key: string, at: number = Date.now()): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    /* ignore */
  }
}

/** Exportada para teste: a marca ainda vale? */
export function isFresh(at: number | null, ttlMs: number, now: number = Date.now()): boolean {
  return at !== null && now - at < ttlMs;
}

/** O app rodou nesta máquina há pouco tempo (instalado, portanto). */
export function isAtendimentoAppInstalled(now: number = Date.now()): boolean {
  return isFresh(readTimestamp(INSTALLED_KEY), INSTALLED_TTL_MS, now);
}

/** Chamado pela página /atendimento quando ela roda instalada. Renova o prazo. */
export function markAtendimentoAppInstalled(): void {
  writeTimestamp(INSTALLED_KEY);
}

/** Mostrar o convite? Não mostra para quem já tem, nem para quem dispensou. */
export function shouldInviteToInstall(now: number = Date.now()): boolean {
  if (isAtendimentoAppInstalled(now)) return false;
  return !isFresh(readTimestamp(HINT_DISMISSED_KEY), HINT_SNOOZE_MS, now);
}

export function dismissInstallInvite(): void {
  writeTimestamp(HINT_DISMISSED_KEY);
}

/** A página atual é o app dedicado rodando em janela própria (instalado)? */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Abre o app do Atendimento. Janela NOMEADA, como a do Editor: clicar de novo
 * foca a que já está aberta em vez de espalhar cópias da inbox pela tela.
 *
 * Quem já tem o app instalado e o abriu pelo ícone continua com a janela dele;
 * daqui, o que garantimos é chegar em /atendimento — é lá que o navegador
 * oferece instalar (ver o cabeçalho deste arquivo).
 */
/** `navigator.install` — Web Install API, ainda ausente na maioria dos Chrome. */
interface NavigatorComInstall extends Navigator {
  install?: (url?: string) => Promise<unknown>;
}

/**
 * Instala o app do Atendimento a partir do CRM.
 *
 * O CAMINHO CURTO (`navigator.install`) instala sem sair da página, mas não
 * existe no Chrome 151 — foi verificado. Quando o navegador ganhar a API, este
 * mesmo botão passa a instalar direto, sem mudar nada aqui.
 *
 * A RESERVA é abrir o /atendimento: o `beforeinstallprompt` vale só para o
 * manifest da página atual, então o botão "Instalar" de verdade tem de ser
 * clicado LÁ — e a régua verde no topo do app existe justamente para ser a
 * primeira coisa que a pessoa vê ao chegar.
 */
export async function instalarAtendimentoApp(): Promise<void> {
  const nav = navigator as NavigatorComInstall;
  if (typeof nav.install === 'function') {
    try {
      await nav.install('/atendimento');
      markAtendimentoAppInstalled();
      return;
    } catch (erro) {
      // Desistiu do instalador: respeitamos: abrir a página por cima seria
      // insistir em algo que a pessoa acabou de recusar.
      if ((erro as { name?: string })?.name === 'AbortError') return;
      // Qualquer outra falha cai na reserva.
    }
  }
  openAtendimentoApp();
}

export function openAtendimentoApp(): void {
  const w = 1280, h = 860;
  const left = Math.max(0, Math.round(((window.screen?.availWidth || w) - w) / 2));
  const top = Math.max(0, Math.round(((window.screen?.availHeight || h) - h) / 2));
  const win = window.open(
    '/atendimento',
    'jurius-atendimento',
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
  );
  // Popup bloqueado: aba normal resolve — o objetivo é chegar na página.
  if (!win) window.open('/atendimento', '_blank');
  else win.focus();
}
