// O player da gravação de uma chamada.
//
// Um componente só, usado na thread da conversa e disponível para a ficha do
// cliente, porque a regra que ele carrega não é de layout — é de custo:
//
//   A URL SÓ É ASSINADA NO CLIQUE. O link do bucket é temporário e cada um
//   custa uma ida ao servidor. Abrir uma conversa de um cliente com quarenta
//   ligações gravadas dispararia quarenta assinaturas para ouvir nenhuma.
//
// Enquanto ninguém clica, o que existe é um botão que diz que há áudio ali.
import React, { useCallback, useState } from 'react';
import { Download, Loader2, Play } from 'lucide-react';
import { callLogService } from '../../services/callLog.service';
import { applyOutputToElement } from '../../utils/audioDevices';

export const CallRecordingPlayer: React.FC<{
  /** Caminho no bucket (`call-recordings/<callId>.webm`). */
  path: string;
  /** Compacto: dentro da bolha da conversa, onde a largura é curta. */
  compact?: boolean;
}> = ({ path, compact }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const signed = await callLogService.recordingUrl(path).catch(() => null);
    setLoading(false);
    if (!signed) { setFailed(true); return; }
    setUrl(signed);
  }, [path]);

  if (url) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <audio src={url} controls autoPlay onPlay={e => { void applyOutputToElement(e.currentTarget); }} className={compact ? 'h-8 w-full max-w-[240px]' : 'h-8 w-full max-w-sm'} />
        <a href={url} download title="Baixar a gravação"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-black/[0.06] hover:text-slate-600">
          <Download className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => { void load(); }} disabled={loading || failed}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-black/[0.05] px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-black/[0.09] disabled:opacity-60">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {failed ? 'Gravação indisponível' : 'Ouvir gravação'}
    </button>
  );
};

export default CallRecordingPlayer;
