/**
 * Convite para instalar o Atendimento como APLICATIVO separado (/atendimento),
 * direto de dentro do CRM — sem abrir outra página.
 *
 * COMO ISSO É POSSÍVEL. O `beforeinstallprompt` vale sempre para o manifest da
 * PÁGINA ATUAL: em /whatsapp ele instalaria o CRM. A saída é apontar o
 * <link rel="manifest"> desta página para o manifest do Atendimento enquanto a
 * régua está à vista — o Chrome reavalia e passa a oferecer AQUELE app. Foi
 * verificado no Chrome 151: com o manifest do CRM não veio evento nenhum (o CRM
 * já está instalado); trocando o manifest, o evento chegou.
 *
 * A TROCA É TEMPORÁRIA e vale só enquanto esta régua está visível. O módulo
 * WhatsApp fica MONTADO mesmo quando o usuário vai para outra tela (keep-alive
 * com display:none no App), então "desmontar" não serve de gatilho — quem manda
 * é o tamanho da própria régua: altura zero = escondida = manifest do CRM de
 * volta. Sem isso, o CRM inteiro passaria a sessão toda se anunciando como
 * Atendimento na barra de endereços.
 *
 * Fora do Chrome/Edge o evento não existe; aí o botão cai no caminho reserva
 * (`instalarAtendimentoApp`), que abre o /atendimento — lá a instalação é
 * oferecida pelo próprio navegador.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  dismissInstallInvite,
  instalarAtendimentoApp,
  markAtendimentoAppInstalled,
  shouldInviteToInstall,
} from '../../utils/atendimentoApp';

/** O evento do Chrome/Edge que abre o instalador da página. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const MANIFEST_CRM = '/manifest.webmanifest';
const MANIFEST_ATENDIMENTO = '/atendimento.webmanifest';

function apontarManifest(href: string): void {
  const link = document.querySelector('link[rel="manifest"]');
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export const AtendimentoAppInvite: React.FC = () => {
  // Decidido uma vez, na montagem: a régua não pode piscar no meio do
  // atendimento por causa de um re-render.
  const [visivel, setVisivel] = useState(() => shouldInviteToInstall());
  const conviteRef = useRef<InstallPromptEvent | null>(null);
  const reguaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visivel) return;

    const aoPoderInstalar = (event: Event) => {
      event.preventDefault(); // sem isto o Chrome mostra a barra dele por cima
      conviteRef.current = event as InstallPromptEvent;
    };
    const aoInstalar = () => { markAtendimentoAppInstalled(); setVisivel(false); };
    window.addEventListener('beforeinstallprompt', aoPoderInstalar);
    window.addEventListener('appinstalled', aoInstalar);

    // A régua escondida (outra tela aberta) devolve o manifest do CRM.
    //
    // Verificação POR TEMPO, não por observador. `ResizeObserver` e
    // `IntersectionObserver` só entregam callback quando o navegador está
    // produzindo quadros — com a janela em segundo plano (ou minimizada) eles
    // simplesmente não disparam, e o manifest ficaria congelado no estado
    // errado. `offsetParent === null` é a leitura direta de "está com
    // display:none", que é como o App esconde o módulo, e custa quase nada a
    // cada 800 ms.
    const sincronizar = () => {
      const aparecendo = reguaRef.current?.offsetParent != null;
      apontarManifest(aparecendo ? MANIFEST_ATENDIMENTO : MANIFEST_CRM);
    };
    sincronizar();
    const relogio = window.setInterval(sincronizar, 800);

    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar);
      window.removeEventListener('appinstalled', aoInstalar);
      window.clearInterval(relogio);
      apontarManifest(MANIFEST_CRM);
    };
  }, [visivel]);

  const instalar = useCallback(async () => {
    const convite = conviteRef.current;
    if (!convite) {
      // Navegador sem `beforeinstallprompt` (Safari, Firefox) ou app já
      // instalado: sobra o caminho reserva.
      void instalarAtendimentoApp();
      return;
    }
    conviteRef.current = null; // o evento é de uso único
    try {
      await convite.prompt();
      const { outcome } = await convite.userChoice;
      if (outcome === 'accepted') { markAtendimentoAppInstalled(); setVisivel(false); }
    } catch {
      void instalarAtendimentoApp();
    }
  }, []);

  if (!visivel) return null;

  return (
    <div ref={reguaRef} data-atendimento-invite
      className="flex-shrink-0 flex items-center gap-2.5 border-b border-emerald-100 bg-emerald-50/70 px-3 sm:px-5 py-2">
      <Download size={15} className="flex-shrink-0 text-emerald-700" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-emerald-900">
        <span className="font-semibold">O atendimento também abre como aplicativo.</span>{' '}
        <span className="text-emerald-800/90">
          Janela própria, ícone na área de trabalho e avisos de mensagem nova sem o CRM aberto.
        </span>
      </p>
      <button
        onClick={() => void instalar()}
        className="flex-shrink-0 rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-semibold text-white transition hover:bg-emerald-700 active:scale-95"
      >
        Instalar
      </button>
      <button
        onClick={() => { dismissInstallInvite(); setVisivel(false); }}
        title="Agora não"
        aria-label="Dispensar o convite"
        className="flex-shrink-0 rounded-lg p-1 text-emerald-700/70 transition hover:bg-emerald-100 hover:text-emerald-900"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default AtendimentoAppInvite;
