/**
 * Convite para instalar o Atendimento como APLICATIVO separado (/atendimento),
 * mostrado no topo do módulo WhatsApp dentro do CRM.
 *
 * POR QUE O BOTÃO NÃO INSTALA AQUI MESMO. Já instalou: a régua trocava o
 * `<link rel="manifest">` desta página para o do Atendimento e chamava o
 * `beforeinstallprompt` capturado. O problema é que esse evento não diz a que
 * manifest pertence — e o Chrome dispara UM no carregamento da página, que é o
 * do CRM. Quem ainda não tinha o CRM instalado capturava esse, e o botão
 * "Instalar" instalava o CRM. Descobria-se pelo pior caminho: o convite sumia,
 * o app do Atendimento não existia, e no fim a pessoa tinha os DOIS instalados
 * para calar uma régua que pedia um.
 *
 * Não há como distinguir os dois eventos (o objeto é o mesmo, e a ordem em que
 * chegam não é observável), então o caminho passou a ser o único sem ambiguidade:
 * abrir /atendimento. Lá o manifest da página É o do Atendimento, o instalador
 * do navegador oferece o app certo, e a própria página tem a régua verde de
 * instalar (ver `WhatsAppApp`). De quebra, o CRM deixa de se anunciar como
 * "Atendimento" na barra de endereços enquanto esta régua está à vista.
 *
 * INSTALOU LÁ, SOME AQUI. A instalação acontece em OUTRA janela, e o estado
 * desta régua era decidido uma vez, na montagem — o convite ficava na tela até
 * alguém recarregar o CRM. O evento `storage` (mesma origem, outra janela) é o
 * aviso de que a marca foi gravada; com ele, a régua some sozinha.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  dismissInstallInvite,
  instalarAtendimentoApp,
  markAtendimentoAppInstalled,
  shouldInviteToInstall,
} from '../../utils/atendimentoApp';

export const AtendimentoAppInvite: React.FC = () => {
  // Decidido na montagem: a régua não pode piscar no meio do atendimento por
  // causa de um re-render. O que a derruba são fatos (instalou, dispensou).
  const [visivel, setVisivel] = useState(() => shouldInviteToInstall());

  useEffect(() => {
    if (!visivel) return;

    const reconferir = () => { if (!shouldInviteToInstall()) setVisivel(false); };

    // `appinstalled` cobre a instalação feita a partir DESTA página (a oferta do
    // próprio navegador); `storage` cobre a que acontece na janela do
    // /atendimento; `focus` cobre o navegador que não emitiu nem um nem outro.
    const aoInstalar = () => { markAtendimentoAppInstalled(); setVisivel(false); };
    window.addEventListener('appinstalled', aoInstalar);
    window.addEventListener('storage', reconferir);
    window.addEventListener('focus', reconferir);
    return () => {
      window.removeEventListener('appinstalled', aoInstalar);
      window.removeEventListener('storage', reconferir);
      window.removeEventListener('focus', reconferir);
    };
  }, [visivel]);

  const instalar = useCallback(() => {
    void instalarAtendimentoApp();
  }, []);

  if (!visivel) return null;

  return (
    <div data-atendimento-invite
      className="flex-shrink-0 flex items-center gap-2.5 border-b border-emerald-100 bg-emerald-50/70 px-3 sm:px-5 py-2">
      <Download size={15} className="flex-shrink-0 text-emerald-700" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-emerald-900">
        <span className="font-semibold">O atendimento também abre como aplicativo.</span>{' '}
        <span className="text-emerald-800/90">
          Janela própria, ícone na área de trabalho e avisos de mensagem nova sem o CRM aberto.
        </span>
      </p>
      <button
        onClick={instalar}
        title="Abre o Atendimento em janela própria, onde o navegador oferece a instalação"
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
