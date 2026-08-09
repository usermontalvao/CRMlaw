/**
 * Entrada do app "Atendimento" — o módulo WhatsApp como PWA separado do CRM.
 *
 * Esta é a SEGUNDA entrada do site (a outra é `main.tsx`, do CRM/portal). Ela
 * existe para que /atendimento seja outra página de verdade, com o seu próprio
 * <link rel="manifest"> no HTML — é isso que faz o navegador oferecer a
 * instalação de OUTRO app, e não do CRM inteiro. Ver `atendimento.html`.
 *
 * Aqui não há roteamento: esta página é sempre o atendimento. Nada de portal,
 * rotas públicas de assinatura, bancadas de desenvolvimento ou módulos do CRM.
 */
import './utils/consoleGuard'; // 1º: silencia console em prod (só erro) + aviso anti-self-XSS
import React from 'react';
import ReactDOM from 'react-dom/client';
import { installStaleChunkReload } from './utils/staleChunkReload';
import { registerVersionedServiceWorker } from './utils/serviceWorker';
import WhatsAppApp from './WhatsAppApp';
import './index.css';

installStaleChunkReload();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WhatsAppApp />
  </React.StrictMode>,
);

// O service worker (escopo "/") é o mesmo do CRM e cobre /atendimento. É ele
// que atende ao requisito de instalação do navegador e entrega as notificações
// push. Só roda em produção — `registerVersionedServiceWorker` devolve null em
// desenvolvimento, então em localhost NÃO existe botão de instalar.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerVersionedServiceWorker()
      .then((reg) => { if (reg) console.log('SW registrado:', reg.scope); })
      .catch((err) => console.error('Falha ao registrar SW:', err));
  });
}
