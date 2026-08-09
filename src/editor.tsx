/**
 * Entrada do app "Editor" — o editor de petições como PWA separado do CRM.
 *
 * Terceira entrada do site (as outras são `main.tsx`, do CRM/portal, e
 * `atendimento.tsx`, do WhatsApp). Existe para que /editor seja outra página de
 * verdade, com o seu próprio manifest no HTML — é isso que faz o navegador
 * instalar OUTRO app em vez do CRM. Ver `editor.html` e docs/PWA_APPS.md.
 *
 * Aqui não há roteamento: esta página é sempre o editor. O documento a abrir
 * continua chegando pelo hash (`#editor-doc=TOKEN`) ou pela query, lidos lá
 * dentro pelo PetitionEditorWidget.
 */
import './utils/consoleGuard'; // 1º: silencia console em prod (só erro) + aviso anti-self-XSS
import React from 'react';
import ReactDOM from 'react-dom/client';
import { installStaleChunkReload } from './utils/staleChunkReload';
import { registerVersionedServiceWorker } from './utils/serviceWorker';
import EditorApp from './EditorApp';
import './index.css';

installStaleChunkReload();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorApp />
  </React.StrictMode>,
);

// O service worker (escopo "/") é o mesmo do CRM e cobre /editor. É ele que
// atende ao requisito de instalação do navegador. Só roda em produção —
// `registerVersionedServiceWorker` devolve null em desenvolvimento, então em
// localhost NÃO existe botão de instalar.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerVersionedServiceWorker()
      .then((reg) => { if (reg) console.log('SW registrado:', reg.scope); })
      .catch((err) => console.error('Falha ao registrar SW:', err));
  });
}
