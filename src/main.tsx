import './utils/consoleGuard'; // 1º: silencia console em prod (só erro) + aviso anti-self-XSS
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerVersionedServiceWorker } from './utils/serviceWorker';
import { installStaleChunkReload } from './utils/staleChunkReload';
import { isEditorAppLocation } from './utils/editorAppRoute';
import { isWhatsAppAppLocation } from './utils/whatsappAppRoute';
import { isModulePath, rememberPendingModule } from './utils/moduleRoutes';

// -- Stale-chunk auto-reload ------------------------------------------------
// Compartilhado com a entrada do app "Atendimento" (src/atendimento.tsx).
installStaleChunkReload();

import './index.css';

const isDev = import.meta.env.DEV;

function isPublicSignatureRoute(hash: string, path: string): boolean {
  return (
    hash.includes('/assinar/') ||
    path.includes('/assinar/') ||
    hash.includes('/verificar') ||
    path.includes('/verificar') ||
    hash.includes('/termos-assinatura') ||
    path.includes('/termos-assinatura') ||
    hash.startsWith('#/documento/') ||
    path.includes('/documento/')
  );
}

function disablePwaForPublicSignatureRoute() {
  document.querySelector('link[rel="manifest"]')?.remove();
  document.querySelector('link[rel="apple-touch-icon"]')?.remove();
  document
    .querySelectorAll(
      'meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"], meta[name="apple-mobile-web-app-status-bar-style"], meta[name="apple-mobile-web-app-title"]',
    )
    .forEach((element) => element.remove());
}

// -- Detecta sess�o Supabase no localStorage (s�ncrono) ---------------------
// Supabase JS v2 persiste a sess�o em chaves "sb-*-auth-token"
function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Verifica se o token ainda n�o expirou
        if (parsed?.access_token) return true;
      }
    }
  } catch {}
  return false;
}

function hasStaffSessionExpiredNotice(): boolean {
  try {
    return sessionStorage.getItem('auth_notice') === 'session_expired';
  } catch {}
  return false;
}

// -- Roteamento de entrada --------------------------------------------------
// Estrat�gia: tudo roda em "/" � sem rotas de servidor adicionais.
//   � Sess�o Supabase ativa          ? CRM (App)
//   � Hash #/documento/TOKEN         ? CRM (viewer p�blico)
//   � Hash #/cron/djen               ? CRM (endpoint cron)
//   � Sessão expirada do staff       ? CRM interno (login)
//   � Qualquer outra situação        ? Portal do Cliente (PortalApp)
const currentHash = window.location.hash;
const currentPath = window.location.pathname;

// App "Editor" (PWA instalável separado): quando aberto no caminho /editor, este
// é o app dedicado do Editor de Petições. Usamos um CAMINHO real (não hash) para
// que o PWA tenha escopo próprio (/editor) — só assim o navegador consegue abrir
// ESTE app instalado (e não o CRM) ao seguir um link /editor. Trocamos o
// <link rel="manifest"> para o manifest próprio (ícone/nome próprios) e tratamos
// a rota como staff (abre o login se não houver sessão, em vez do Portal).
// Igual ao bloco do Atendimento logo abaixo: o caminho /editor tem PÁGINA
// PRÓPRIA (editor.html → src/editor.tsx) e normalmente não chega aqui. Este
// bloco cobre o hash legado `#/editor` — de quem instalou o app antes da
// migração para caminho — e o caso de a reescrita do servidor falhar.
const isEditorAppRoute = isEditorAppLocation(currentPath, currentHash);
if (isEditorAppRoute) {
  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', '/editor.webmanifest');
  } catch {
    // ignore
  }
}

// App "Atendimento" (módulo WhatsApp como PWA separado): em condições normais
// o caminho /atendimento NEM CHEGA AQUI — ele é servido por uma página própria
// (atendimento.html, entrada src/atendimento.tsx), que é o que faz o navegador
// instalar OUTRO app em vez do CRM. Este bloco é a rede de segurança: cobre o
// atalho por hash (#/atendimento) e o caso de a reescrita do servidor falhar,
// quando o index.html do CRM acaba atendendo o caminho. Ajustamos manifest e
// título pelo script — funciona para navegar, mas NÃO substitui a página
// própria para efeito de instalação.
const isWhatsAppAppRoute = isWhatsAppAppLocation(currentPath, currentHash);
if (isWhatsAppAppRoute) {
  try {
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute('href', '/atendimento.webmanifest');
    document.title = 'Atendimento';
  } catch {
    // ignore
  }
}

// Vídeo animado de aniversário: link direto para assistir/conferir a peça
// fora da data. Precisa ser lido ANTES da normalização de path abaixo, que
// descarta a query string. Aceita "?aniversarioanimado" e "#/aniversarioanimado".
const isBirthdayVideoRoute =
  new URLSearchParams(window.location.search).has('aniversarioanimado') ||
  currentHash.includes('/aniversarioanimado') ||
  currentPath.includes('/aniversarioanimado');

const isPublicSignature = isPublicSignatureRoute(currentHash, currentPath);
const isStaffSessionExpired = hasStaffSessionExpiredNotice();

if (isPublicSignature) {
  disablePwaForPublicSignatureRoute();
}

// Caminho de módulo do CRM (`/agenda`, `/prazos`, ...): roteamento de primeiro
// nível. Guardamos o destino AGORA, antes de qualquer normalização — se faltar
// sessão o visitante vai ao login e volta para "/", e é este registro que o
// traz de volta à tela que ele pediu.
const isModuleRoute = isModulePath(currentPath);
if (isModuleRoute) {
  rememberPendingModule(currentPath);
}

const isDocRoute  = currentHash.startsWith('#/documento/');
const isCronRoute = currentHash.includes('/cron/djen');

// Rotas p�blicas que s�o renderizadas pelo App (n�o pelo PortalApp)
const isPublicCrmRoute =
  currentHash.includes('/assinar/') ||
  currentPath.includes('/assinar/') ||
  currentHash.includes('/p/') ||
  currentPath.includes('/p/') ||
  currentHash.includes('/preencher/') ||
  currentPath.includes('/preencher/') ||
  currentHash.includes('/cloud/share/') ||
  currentPath.includes('/cloud/share/') ||
  currentHash.includes('/verificar') ||
  currentPath.includes('/verificar') ||
  currentHash.includes('/termos-assinatura') ||
  currentPath.includes('/termos-assinatura') ||
  currentHash.includes('/terms') ||
  currentPath.includes('/terms') ||
  currentHash.includes('/privacidade') ||
  currentPath.includes('/privacidade') ||
  currentHash.includes('/privacy') ||
  currentPath.includes('/privacy') ||
  currentHash.includes('/docs') ||
  currentPath.includes('/docs');

const isStaff = hasSupabaseSession() || isStaffSessionExpired || isDocRoute || isCronRoute || isPublicCrmRoute || isEditorAppRoute || isWhatsAppAppRoute;

// Normaliza qualquer path estranho para "/". Ficam de fora:
//  - /editor, caminho próprio do app do Editor (escopo do PWA);
//  - /atendimento, caminho próprio do app do WhatsApp (escopo do PWA);
//  - os caminhos de módulo QUANDO o CRM é quem vai renderizar — é o que faz
//    `/agenda` sobreviver ao F5. Sem sessão o caminho cai para "/" como sempre,
//    porque quem atende é o PortalApp (que tem o seu próprio roteamento); o
//    destino pretendido já foi guardado acima e volta depois do login.
const keepPath = isEditorAppRoute || isWhatsAppAppRoute || (isModuleRoute && isStaff);
if (currentPath !== '/' && !keepPath) {
  window.history.replaceState({}, '', `/${currentHash}`);
}

async function renderRoot() {
  let rootElement: React.ReactNode;

  // DEV-ONLY: bancada do aviso flutuante (?avisopreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('avisopreview')) {
    const { default: AvisoFlutuantePreview } = await import('./dev/AvisoFlutuantePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <AvisoFlutuantePreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do painel de conversas (?wainboxpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wainboxpreview')) {
    const { default: WhatsAppInboxPreview } = await import('./dev/WhatsAppInboxPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppInboxPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada da abertura de conversa (?waopeningpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waopeningpreview')) {
    const { default: WhatsAppOpeningPreview } = await import('./dev/WhatsAppOpeningPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppOpeningPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada da barra de mensagens (?chatlauncherpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('chatlauncherpreview')) {
    const { default: ChatLauncherPreview } = await import('./dev/ChatLauncherPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <ChatLauncherPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do trilho de canais do painel (?chatrailpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('chatrailpreview')) {
    const { default: ChatChannelRailPreview } = await import('./dev/ChatChannelRailPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <ChatChannelRailPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada visual da conversa WhatsApp (?waconversationpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waconversationpreview')) {
    const { default: WhatsAppConversationPreview } = await import('./dev/WhatsAppConversationPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppConversationPreview />,
    );
    return;
  }

  // DEV-ONLY: simulação de um dia de operação — vários atendentes, fila por SLA,
  // encaminhamento para advogado e campanha (?waoperationsim=1).
  if (isDev && new URLSearchParams(window.location.search).has('waoperationsim')) {
    const { default: WhatsAppOperationSim } = await import('./dev/WhatsAppOperationSim');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppOperationSim />,
    );
    return;
  }

  // DEV-ONLY: bancada dos avisos de mensagem nova — os três toques e a pilha de
  // cartões (?wanotifypreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wanotifypreview')) {
    const { default: WhatsAppNotifyPreview } = await import('./dev/WhatsAppNotifyPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppNotifyPreview />,
    );
    return;
  }

  // DEV-ONLY: gestão unificada de acesso aos canais WhatsApp (?waaccesspreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waaccesspreview')) {
    const { default: WhatsAppAccessPreview } = await import('./dev/WhatsAppAccessPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppAccessPreview />,
    );
    return;
  }

  // DEV-ONLY: editor de funil personalizado por canal (?wafunnelpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wafunnelpreview')) {
    const { default: WhatsAppFunnelPreview } = await import('./dev/WhatsAppFunnelPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppFunnelPreview />,
    );
    return;
  }

  // DEV-ONLY: quadro de Leads com o recorte de conversas vivas (?wafunnelboardpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wafunnelboardpreview')) {
    const { default: WhatsAppFunnelBoardPreview } = await import('./dev/WhatsAppFunnelBoardPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppFunnelBoardPreview />,
    );
    return;
  }

  // DEV-ONLY: corretor do campo de mensagem do WhatsApp (?waspellpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waspellpreview')) {
    const { default: WhatsAppSpellcheckPreview } = await import('./dev/WhatsAppSpellcheckPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppSpellcheckPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada de medição da lista de conversas (?walistperf=1).
  if (isDev && new URLSearchParams(window.location.search).has('walistperf')) {
    const { default: WhatsAppListPerfPreview } = await import('./dev/WhatsAppListPerfPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppListPerfPreview />,
    );
    return;
  }

  // DEV-ONLY: preview de anexo com anotação — lápis/marca-texto (?waattachpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waattachpreview')) {
    const { default: WhatsAppAttachmentPreview } = await import('./dev/WhatsAppAttachmentPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppAttachmentPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do editor de prompt do agente de IA (?waaipromptpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waaipromptpreview')) {
    const { default: WhatsAppAiPromptPreview } = await import('./dev/WhatsAppAiPromptPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppAiPromptPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do acompanhamento do agente de IA (?waaifollowuppreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waaifollowuppreview')) {
    const { default: WhatsAppAiFollowupPanelPreview } = await import('./dev/WhatsAppAiFollowupPanelPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppAiFollowupPanelPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do formulário do agente de IA (?waaiagentpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('waaiagentpreview')) {
    const { default: WhatsAppAiAgentFormPreview } = await import('./dev/WhatsAppAiAgentFormPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppAiAgentFormPreview />,
    );
    return;
  }

  // DEV-ONLY: histórico de ligações + abas da inbox (?wacallhistorypreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wacallhistorypreview')) {
    const { default: WaCallHistoryPreview } = await import('./dev/WaCallHistoryPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WaCallHistoryPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada das chamadas de voz do WhatsApp (?wacallspreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wacallspreview')) {
    const { default: WaCallsPreview } = await import('./dev/WaCallsPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WaCallsPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do discador (?dialerpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('dialerpreview')) {
    const { default: DialerPreview } = await import('./dev/DialerPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <DialerPreview />,
    );
    return;
  }

  // DEV-ONLY: vitrine dos modais do atendimento WhatsApp (?wamodalspreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('wamodalspreview')) {
    const { default: WhatsAppModalsPreview } = await import('./dev/WhatsAppModalsPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <WhatsAppModalsPreview />,
    );
    return;
  }

  // DEV-ONLY: harness do certificado de assinatura (?certpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('certpreview')) {
    const { default: CertificatePreview } = await import('./dev/CertificatePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode><CertificatePreview /></React.StrictMode>,
    );
    return;
  }

  // DEV-ONLY: harness visual dos avisos de "quem está editando" (?presencepreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('presencepreview')) {
    const { default: EditingPresencePreview } = await import('./dev/EditingPresencePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <EditingPresencePreview />,
    );
    return;
  }

  // DEV-ONLY: harness visual do Assistente IA de petições (?aichatpreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('aichatpreview')) {
    const { default: PetitionAiChatPreview } = await import('./dev/PetitionAiChatPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <PetitionAiChatPreview />,
    );
    return;
  }

  // DEV-ONLY: harness visual do tratamento de devolução de e-mail (?emailbounce=1).
  if (isDev && new URLSearchParams(window.location.search).has('emailbounce')) {
    const { default: EmailBouncePreview } = await import('./dev/EmailBouncePreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <EmailBouncePreview />,
    );
    return;
  }

  // Vídeo animado de aniversário (?aniversarioanimado | #/aniversarioanimado).
  // Disponível também em produção: é o link para assistir à homenagem.
  if (isBirthdayVideoRoute) {
    const { default: BirthdayVideoRoute } = await import('./components/birthday/BirthdayVideoRoute');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <BirthdayVideoRoute />,
    );
    return;
  }

  // DEV-ONLY: cadastro obrigatório e aviso de correspondência
  // (?birthdaypreview=gate | ?birthdaypreview=toast).
  if (isDev && new URLSearchParams(window.location.search).has('birthdaypreview')) {
    const { default: BirthdayPreview } = await import('./dev/BirthdayPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <BirthdayPreview />,
    );
    return;
  }

  // DEV-ONLY: bancada do aviso de versão (?novidadespreview=1).
  if (isDev && new URLSearchParams(window.location.search).has('novidadespreview')) {
    const { default: VersionNewsPreview } = await import('./dev/VersionNewsPreview');
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <VersionNewsPreview />,
    );
    return;
  }

  // App dedicado "Editor" (/editor): casca MÍNIMA — só o editor, sem o CRM
  // completo (sidebar, dashboard, módulos). Providers próprios dentro de EditorApp.
  if (isEditorAppRoute) {
    const { default: EditorApp } = await import('./EditorApp');
    rootElement = <EditorApp />;
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{rootElement}</React.StrictMode>,
    );
    return;
  }

  // App dedicado "Atendimento" (/atendimento): casca MÍNIMA — só o módulo
  // WhatsApp, sem o CRM completo. Providers próprios dentro de WhatsAppApp.
  if (isWhatsAppAppRoute) {
    const { default: WhatsAppApp } = await import('./WhatsAppApp');
    rootElement = <WhatsAppApp />;
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{rootElement}</React.StrictMode>,
    );
    return;
  }

  if (isStaff) {
    const [
      { default: App },
      { NavigationProvider },
      { AuthProvider },
      { ThemeProvider },
      { SidebarModeProvider },
      { ToastProvider },
      { SecurityPinProvider },
      { DeleteConfirmProvider },
    ] = await Promise.all([
      import('./App'),
      import('./contexts/NavigationContext'),
      import('./contexts/AuthContext'),
      import('./contexts/ThemeContext'),
      import('./contexts/SidebarModeContext'),
      import('./contexts/ToastContext'),
      import('./contexts/SecurityPinContext'),
      import('./contexts/DeleteConfirmContext'),
    ]);

    rootElement = (
      <NavigationProvider initialModule="dashboard">
        <AuthProvider>
          <ThemeProvider>
            <SidebarModeProvider>
              <ToastProvider>
                <SecurityPinProvider>
                  <DeleteConfirmProvider>
                    <App />
                  </DeleteConfirmProvider>
                </SecurityPinProvider>
              </ToastProvider>
            </SidebarModeProvider>
          </ThemeProvider>
        </AuthProvider>
      </NavigationProvider>
    );
  } else {
    const { default: PortalApp } = await import('./portal/PortalApp');
    rootElement = <PortalApp />;
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>{rootElement}</React.StrictMode>,
  );
}

void renderRoot();

if (!isDev && 'serviceWorker' in navigator) {
  if (!isPublicSignature) {
    window.addEventListener('load', () => {
      registerVersionedServiceWorker()
        .then((reg) => { if (reg) console.log('SW registrado:', reg.scope); })
        .catch((err) => {
          console.error('Falha ao registrar SW:', err);
          if (err.message?.includes('network error')) {
            caches.keys().then((names) =>
              Promise.all(names.filter((n) => n.startsWith('crm-cache-')).map((n) => caches.delete(n)))
            );
          }
        });
    });
  }
}
