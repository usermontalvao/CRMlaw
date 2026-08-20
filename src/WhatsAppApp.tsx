/**
 * WhatsAppApp — casca MÍNIMA do app dedicado "Atendimento" (janela/PWA em
 * `/atendimento`).
 *
 * Diferente do CRM completo (App.tsx), aqui montamos SOMENTE o módulo WhatsApp
 * e os providers de que ele depende — sem sidebar, header, dashboard, sistema
 * de módulos, busca global, etc. A janela abre leve e mostra só o atendimento.
 *
 * Sessão: compartilha o localStorage com o CRM (mesma origem). Se não houver
 * sessão, redireciona ao login em "/" SEM apagar tokens (não desloga o CRM).
 */
import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import { isRunningStandalone, markAtendimentoAppInstalled } from './utils/atendimentoApp';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { SecurityPinProvider } from './contexts/SecurityPinContext';
import { DeleteConfirmProvider } from './contexts/DeleteConfirmContext';
import { WhatsAppNotifyHost } from './components/whatsapp/WhatsAppNotifyHost';
import { WaCallsHost } from './components/whatsapp/WaCallsHost';
import { useWhatsAppNotifications } from './hooks/useWhatsAppNotifications';
import { zc } from './styles/layers';

const WhatsAppModule = lazy(() => import('./components/WhatsAppModule'));

/** Loader dedicado, mostrado até a inbox montar. */
const AtendimentoBootLoader: React.FC<{ label?: string }> = ({ label = 'Abrindo atendimento' }) => (
  <div className={`fixed inset-0 ${zc.FLOATING} flex flex-col items-center justify-center bg-[#0b141a] text-emerald-50`}>
    <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />
    <p className="mt-4 text-[15px] font-semibold tracking-tight">{label}</p>
  </div>
);

/** O evento do Chrome/Edge que permite chamar o instalador da página. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/**
 * Instalação do app, e o registro de que ele existe nesta máquina.
 *
 * O `beforeinstallprompt` vale para o manifest da PÁGINA ATUAL — por isso o
 * botão de instalar só pode viver aqui, no /atendimento, e não no CRM (lá ele
 * instalaria o CRM). Quando a instalação acontece, gravamos a marca que faz o
 * convite sumir do módulo WhatsApp dentro do CRM. Ver utils/atendimentoApp.
 */
function useInstalacaoDoApp(): { convite: InstallPromptEvent | null; instalar: () => void } {
  const [convite, setConvite] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    // Já rodando em janela própria = instalado. Renova o prazo da marca a cada
    // abertura, que é o que distingue "instalado" de "instalado e removido".
    if (isRunningStandalone()) markAtendimentoAppInstalled();

    const aoPoderInstalar = (event: Event) => {
      event.preventDefault(); // sem isto o Chrome mostra a barra dele por cima
      setConvite(event as InstallPromptEvent);
    };
    const aoInstalar = () => { markAtendimentoAppInstalled(); setConvite(null); };

    window.addEventListener('beforeinstallprompt', aoPoderInstalar);
    window.addEventListener('appinstalled', aoInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
      window.removeEventListener('appinstalled', aoInstalar);
    };
  }, []);

  const instalar = useCallback(() => {
    if (!convite) return;
    void convite.prompt();
    // Recusando ou aceitando, o evento não pode ser reusado: quem some com o
    // botão no caso de sucesso é o 'appinstalled'.
    setConvite(null);
  }, [convite]);

  return { convite, instalar };
}

const WhatsAppShell: React.FC = () => {
  const { user, loading } = useAuth();
  const { convite, instalar } = useInstalacaoDoApp();

  // Deep-link interno: o cartão de mensagem nova abre a conversa aqui mesmo.
  // No CRM esse papel é do `navigateTo('whatsapp', { conversationId })`; nesta
  // janela não há sistema de módulos, então o estado local é a rota.
  const [openConversationId, setOpenConversationId] = useState<string | undefined>(undefined);
  const openConversation = useCallback((conversationId: string) => {
    setOpenConversationId(conversationId);
    window.focus();
  }, []);

  // Avisos de mensagem nova (som, cartão e notificação do sistema). `inModule`
  // é sempre true: nesta janela a inbox é a única tela que existe. O aviso mais
  // forte continua saindo quando a JANELA está escondida — que é justamente o
  // caso de quem deixou o app de atendimento aberto atrás de outra coisa.
  useWhatsAppNotifications({
    userId: user?.id,
    inModule: true,
    onOpen: openConversation,
  });

  // Sem sessão: manda pro login SEM apagar tokens (protege o CRM em outras abas).
  useEffect(() => {
    if (!loading && !user) window.location.replace('/');
  }, [loading, user]);

  if (loading || !user) return <AtendimentoBootLoader />;

  return (
    // O módulo é `h-full`: sem uma caixa de altura definida aqui, a lista cresce
    // até o tamanho do conteúdo e o compositor some abaixo da viewport. `dvh`
    // porque no celular a barra do navegador entra e sai.
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#faf9f7]">
      {convite && (
        <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-emerald-100 bg-emerald-50 px-4 py-2">
          <Download size={15} className="flex-shrink-0 text-emerald-700" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-emerald-900">
            <span className="font-semibold">Instale o Atendimento neste computador</span>{' '}
            <span className="text-emerald-800/90">— ícone próprio e avisos sem o navegador aberto.</span>
          </p>
          <button onClick={instalar}
            className="flex-shrink-0 rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-emerald-700 active:scale-95">
            Instalar
          </button>
        </div>
      )}
      {/* O módulo é `h-full`: precisa de uma caixa flexível própria, senão a
          régua acima empurraria a inbox para fora da janela. */}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<AtendimentoBootLoader />}>
          <WhatsAppModule
            openConversationId={openConversationId}
            onParamConsumed={() => setOpenConversationId(undefined)}
          />
        </Suspense>
      </div>
      <WhatsAppNotifyHost onOpen={openConversation} />
      <WaCallsHost onOpenConversation={openConversation} />
    </div>
  );
};

// Ordem dos providers espelha o CRM: ThemeProvider consome useAuth e
// DeleteConfirmProvider consome useToastContext — por isso Auth > Theme > Toast
// > SecurityPin > DeleteConfirm.
const WhatsAppApp: React.FC = () => (
  <AuthProvider>
    <ThemeProvider>
      <ToastProvider>
        <SecurityPinProvider>
          <DeleteConfirmProvider>
            <WhatsAppShell />
          </DeleteConfirmProvider>
        </SecurityPinProvider>
      </ToastProvider>
    </ThemeProvider>
  </AuthProvider>
);

export default WhatsAppApp;
