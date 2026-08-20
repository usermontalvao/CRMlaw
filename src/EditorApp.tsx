/**
 * EditorApp — casca MÍNIMA do app dedicado "Editor" (janela/PWA em /editor).
 *
 * Diferente do CRM completo (App.tsx), aqui montamos SOMENTE o editor de
 * petições e os providers de que ele depende — sem sidebar, header, dashboard,
 * sistema de módulos, presença, notificações, etc. Assim a janela abre leve e
 * exibe apenas a interface do editor.
 *
 * Sessão: compartilha o localStorage com o CRM (mesma origem). Se não houver
 * sessão, redireciona ao login em "/" SEM apagar tokens (não desloga o CRM).
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { SecurityPinProvider } from './contexts/SecurityPinContext';
import { DeleteConfirmProvider } from './contexts/DeleteConfirmContext';
import { zc } from './styles/layers';

const PetitionEditorWidget = lazy(() => import('./components/PetitionEditorWidget'));

/** Loader dedicado, mostrado até o editor ficar interativo. */
const EditorBootLoader: React.FC<{ label?: string }> = ({ label = 'Abrindo editor' }) => (
  <div className={`fixed inset-0 ${zc.FLOATING} flex flex-col items-center justify-center bg-[#0a0806] text-amber-50`}>
    <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
    <p className="mt-4 text-[15px] font-semibold tracking-tight">{label}</p>
  </div>
);

const EditorShell: React.FC = () => {
  const { user, loading } = useAuth();
  // O editor emite 'petition-editor-doc-ready' quando fica interativo (inclui a
  // petição em branco). Mantemos o loader até lá, cobrindo o boot do Syncfusion.
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => {
    const done = () => setEditorReady(true);
    window.addEventListener('petition-editor-doc-ready', done);
    const t = window.setTimeout(done, 20000); // segurança
    return () => { window.removeEventListener('petition-editor-doc-ready', done); window.clearTimeout(t); };
  }, []);

  // Sem sessão: manda pro login SEM apagar tokens (protege o CRM em outras abas).
  useEffect(() => {
    if (!loading && !user) window.location.replace('/');
  }, [loading, user]);

  if (loading || !user) return <EditorBootLoader />;

  return (
    <>
      {!editorReady && <EditorBootLoader />}
      <Suspense fallback={<EditorBootLoader />}>
        <PetitionEditorWidget />
      </Suspense>
    </>
  );
};

// Ordem dos providers espelha o CRM: ThemeProvider consome useAuth e
// DeleteConfirmProvider consome useToastContext — por isso Auth > Theme > Toast
// > SecurityPin > DeleteConfirm.
const EditorApp: React.FC = () => (
  <AuthProvider>
    <ThemeProvider>
      <ToastProvider>
        <SecurityPinProvider>
          <DeleteConfirmProvider>
            <EditorShell />
          </DeleteConfirmProvider>
        </SecurityPinProvider>
      </ToastProvider>
    </ThemeProvider>
  </AuthProvider>
);

export default EditorApp;
