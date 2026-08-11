// Botão "Baixar tudo da conversa" do painel de detalhes.
//
// A thread carregada na tela é só uma JANELA (as ~60 últimas, mais o que o
// atendente paginou à mão). Um pacote montado a partir dela sairia mudo sobre
// tudo que veio antes — e "baixar tudo" que baixa parte é pior do que não ter o
// botão. Por isso aqui se relê a conversa INTEIRA do servidor, com as URLs
// assinadas na hora, antes de compactar. O empacotamento em si mora em
// `downloadConversation.ts`.
import React, { useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { baixarConversaCompleta, type ProgressoDownload } from './downloadConversation';

export const ConversationArchiveButton: React.FC<{
  /** A conversa e as irmãs dela (mesmo contato em outro canal do escritório). */
  conversationIds: string[];
  contactName: string;
}> = ({ conversationIds, contactName }) => {
  const toast = useToastContext();
  const [progresso, setProgresso] = useState<ProgressoDownload | null>(null);
  const ocupado = progresso !== null;

  const baixar = async () => {
    if (ocupado || conversationIds.length === 0) return;
    setProgresso({ feitos: 0, total: 0, etapa: 'baixando' });
    try {
      const messages = await whatsappService.listMessages(conversationIds);
      if (messages.length === 0) {
        toast.info('Nada para baixar', 'Esta conversa ainda não tem mensagens.');
        return;
      }
      const { arquivos, falhas } = await baixarConversaCompleta({
        messages, contactName, onProgress: setProgresso,
      });
      if (falhas > 0) {
        // Falha parcial é dita em voz alta: quem vai anexar isso a um processo
        // precisa saber que faltou peça, e não descobrir ao abrir o .zip.
        toast.error(
          'Pacote incompleto',
          `${arquivos} arquivo(s) baixado(s); ${falhas} não vieram. O conversa.txt marca quais.`,
        );
      } else {
        toast.success('Download pronto', `${arquivos} arquivo(s) + histórico em texto.`);
      }
    } catch (e: any) {
      toast.error('Falha ao baixar a conversa', e?.message);
    } finally {
      setProgresso(null);
    }
  };

  const rotulo = !progresso
    ? 'Baixar tudo da conversa'
    : progresso.etapa === 'compactando'
      ? 'Compactando…'
      : progresso.total > 0
        ? `Baixando ${progresso.feitos}/${progresso.total}…`
        : 'Lendo a conversa…';

  const pct = progresso && progresso.total > 0
    ? Math.round((progresso.feitos / progresso.total) * 100)
    : null;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Arquivo da conversa</p>
      <button
        onClick={() => void baixar()}
        disabled={ocupado}
        title="Gera um .zip com áudios, imagens, vídeos, PDFs e demais anexos, mais o histórico em texto"
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#f3f2ef] py-2 text-[11.5px] font-semibold text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-progress disabled:opacity-70"
      >
        {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
        {rotulo}
      </button>
      {pct !== null && progresso?.etapa === 'baixando' && (
        <div className="h-1 overflow-hidden rounded-full bg-emerald-600/15">
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="px-0.5 text-[10px] leading-snug text-slate-400">
        Um .zip com áudios, imagens, vídeos e documentos — mais o histórico em texto.
      </p>
    </div>
  );
};

export default ConversationArchiveButton;
