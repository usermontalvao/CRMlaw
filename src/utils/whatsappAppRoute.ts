/**
 * Detecta se a URL atual é a do app dedicado "Atendimento" — o módulo WhatsApp
 * como PWA instalável separado do CRM. Fonte única de verdade usada pelo boot
 * (main.tsx) e pela casca dedicada (WhatsAppApp.tsx).
 *
 * POR QUE `/atendimento` E NÃO `/whatsapp`: `/whatsapp` já é o caminho do
 * MÓDULO dentro do CRM (ver `utils/moduleRoutes`) — é o que faz o F5 em cima da
 * inbox voltar para o CRM na inbox. Se o mesmo caminho virasse o app dedicado,
 * clicar em WhatsApp na sidebar escreveria `/whatsapp` na barra de endereços e o
 * primeiro F5 jogaria a pessoa para fora do CRM. Então cada um tem o seu:
 *   - `/whatsapp`    → módulo dentro do CRM (sidebar, header, resto do sistema);
 *   - `/atendimento` → app dedicado, escopo próprio do PWA, só o atendimento.
 * É o mesmo arranjo do Editor (`/peticoes` no CRM, `/editor` como app).
 *
 * Aceita o hash `#/atendimento` como atalho equivalente ao caminho; o CAMINHO é
 * o que dá ao PWA escopo próprio (só assim o navegador abre ESTE app instalado,
 * e não o CRM, ao seguir o link).
 */
export function isWhatsAppAppLocation(
  pathname: string = window.location.pathname,
  hash: string = window.location.hash,
): boolean {
  return pathname === '/atendimento' || pathname === '/atendimento/' || hash.startsWith('#/atendimento');
}
