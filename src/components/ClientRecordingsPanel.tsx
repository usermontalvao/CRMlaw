// O acervo de áudio da ficha: as ligações que ficaram gravadas.
//
// A aba "Chamadas" responde "quando falamos com essa pessoa?". Esta responde
// outra coisa — "o que foi dito?" — e por isso é uma aba própria, e não um
// pedaço da outra: quem vem aqui já sabe que a conversa aconteceu e quer o
// conteúdo dela. Numa ficha com 40 ligações, as três que têm gravação ficavam
// perdidas no meio do histórico.
//
// Quatro decisões que valem explicação:
//
//  • A URL SÓ É ASSINADA NO CLIQUE. Abrir a aba não pode gerar uma assinatura
//    por gravação para ouvir nenhuma.
//
//  • TRANSCREVER É UM BOTÃO, NÃO UM AUTOMATISMO. Custa dinheiro e leva tempo;
//    o texto fica salvo na linha da chamada e, da segunda vez em diante, é só
//    leitura. É o motivo de a transcrição existir no banco.
//
//  • EXCLUIR GRAVAÇÃO É DE ADMINISTRADOR. Gravação é prova do que foi orientado
//    e do que o cliente autorizou; quem falou na ligação é justamente quem tem
//    motivo para querer que ela suma. O botão só aparece para o administrador —
//    e a trava de verdade está no servidor (RPC + política do bucket).
//
//  • APAGAR A GRAVAÇÃO NÃO APAGA A LIGAÇÃO. O registro continua na aba
//    "Chamadas", com horário, duração e desfecho. Some o áudio, não o fato.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Download, FileText, Loader2, Mic, PhoneIncoming, PhoneOutgoing, Play, Trash2, X,
} from 'lucide-react';
import { callLogService, type CallLogRow } from '../services/callLog.service';
import { formatOfficeDateTime } from '../utils/officeTime';

/** "3 min 12 s" / "42 s" — duração para ler, não para calcular. */
const durationLabel = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
};

/** "1,2 MB" — o peso do arquivo, para quem vai baixar. */
const sizeLabel = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
};

/** Nome do arquivo baixado: a data e a hora, não o identificador da chamada. */
const downloadName = (row: CallLogRow): string => {
  const stamp = (row.startedAt || '').slice(0, 16).replace('T', ' ').replace(/[:\-]/g, '');
  const ext = row.recordingPath?.split('.').pop() || 'webm';
  return `ligacao-${stamp.replace(/\s/g, '-')}.${ext}`;
};

/** Uma gravação: o player, a transcrição e as duas exclusões. */
const RecordingCard: React.FC<{
  row: CallLogRow;
  canDelete: boolean;
  onChanged: (next: CallLogRow) => void;
  onDeleted: (id: string) => void;
}> = ({ row, canDelete, onChanged, onDeleted }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inbound = row.direction === 'inbound';
  const Icon = inbound ? PhoneIncoming : PhoneOutgoing;

  const openAudio = useCallback(async () => {
    setLoadingAudio(true);
    setError(null);
    const signed = row.recordingPath ? await callLogService.recordingUrl(row.recordingPath).catch(() => null) : null;
    setLoadingAudio(false);
    if (!signed) { setAudioFailed(true); return; }
    setUrl(signed);
  }, [row.recordingPath]);

  const transcribe = useCallback(async (force = false) => {
    setTranscribing(true);
    setError(null);
    try {
      const out = await callLogService.transcribe(row.id, force);
      if (out.status === 'done' && out.text) {
        onChanged({ ...row, transcript: out.text, transcriptStatus: 'done', transcriptAt: new Date().toISOString() });
      } else {
        setError(out.error || 'Não foi possível transcrever esta gravação.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível transcrever esta gravação.');
    } finally {
      setTranscribing(false);
    }
  }, [row, onChanged]);

  const removeTranscript = useCallback(async () => {
    try {
      await callLogService.deleteTranscript(row.id);
      onChanged({ ...row, transcript: null, transcriptStatus: null, transcriptAt: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir a transcrição.');
    }
  }, [row, onChanged]);

  const removeRecording = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      await callLogService.deleteRecording(row.id);
      onDeleted(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir a gravação.');
      setDeleting(false);
      setConfirming(false);
    }
  }, [row.id, onDeleted]);

  return (
    <div className="rounded-xl border border-[#e7e5df] bg-white p-3.5">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          inbound ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'
        }`}>
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          {/* O log da gravação: quando, quanto tempo, quem, quanto pesa. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-bold text-slate-800 tabular-nums">
              {formatOfficeDateTime(row.startedAt) || '—'}
            </p>
            <span className="text-slate-300">·</span>
            <p className="text-[12.5px] text-slate-500">{inbound ? 'Recebida' : 'Realizada'}</p>
            <span className="rounded-full bg-[#f3f2ef] px-2 py-0.5 text-[11px] font-bold text-slate-600 tabular-nums">
              {durationLabel(row.durationSeconds)}
            </span>
            {row.transcript && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10.5px] font-bold text-indigo-700 ring-1 ring-indigo-200">
                Transcrita
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11.5px] text-slate-400">
            {row.userName ? `Atendida por ${row.userName}` : 'Sem atendente registrado'}
            {sizeLabel(row.recordingBytes) ? ` · ${sizeLabel(row.recordingBytes)}` : ''}
          </p>

          {/* Ouvir / baixar / excluir. */}
          {url ? (
            <audio src={url} controls autoPlay className="mt-2.5 h-9 w-full max-w-md" />
          ) : (
            <button
              type="button"
              onClick={() => { void openAudio(); }}
              disabled={loadingAudio || audioFailed}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
            >
              {loadingAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {audioFailed ? 'Gravação indisponível' : 'Ouvir'}
            </button>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                // O download precisa da mesma URL assinada do player; quem não
                // ouviu ainda não tem uma.
                const signed = url || (row.recordingPath ? await callLogService.recordingUrl(row.recordingPath).catch(() => null) : null);
                if (!signed) { setAudioFailed(true); return; }
                if (!url) setUrl(signed);
                const a = document.createElement('a');
                a.href = signed;
                a.download = downloadName(row);
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-[#f3f2ef]"
            >
              <Download className="h-3.5 w-3.5" /> Baixar
            </button>

            {!row.transcript && (
              <button
                type="button"
                onClick={() => { void transcribe(false); }}
                disabled={transcribing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[12px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-60"
              >
                {transcribing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {transcribing ? 'Transcrevendo…' : 'Transcrever'}
              </button>
            )}

            {canDelete && !confirming && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[12px] font-semibold text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir gravação
              </button>
            )}
          </div>

          {/* A confirmação diz o que some e o que fica. */}
          {confirming && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
              <p className="flex items-start gap-1.5 text-[12px] font-medium text-rose-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Excluir o áudio e a transcrição desta ligação? O registro da chamada continua no histórico.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { void removeRecording(); }}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Excluir definitivamente
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-[#f3f2ef]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* A transcrição, quando existe. */}
          {row.transcript && (
            <div className="mt-2.5 rounded-lg border border-[#e7e5df] bg-[#faf9f7] p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                  Transcrição{row.transcriptAt ? ` · ${formatOfficeDateTime(row.transcriptAt)}` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => { void removeTranscript(); }}
                  title="Excluir a transcrição (a gravação continua)"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-3 w-3" /> Excluir transcrição
                </button>
              </div>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">{row.transcript}</p>
            </div>
          )}

          {error && <p className="mt-2 text-[11.5px] font-medium text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export const ClientRecordingsPanel: React.FC<{
  clientId: string;
  /** Telefones do cadastro — pegam as gravações de antes do vínculo. */
  phones?: Array<string | null | undefined>;
}> = ({ clientId, phones = [] }) => {
  const [rows, setRows] = useState<CallLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canDelete, setCanDelete] = useState(false);
  // A lista de telefones vem de props e muda de identidade a cada render do
  // pai; sem esta chave estável o efeito recarregaria a aba em looping.
  const phoneKey = phones.filter(Boolean).join('|');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    callLogService
      .listRecordingsByClient(clientId, phoneKey ? phoneKey.split('|') : [])
      .then(list => { if (!cancelled) setRows(list); })
      .catch(err => { if (!cancelled) { setError(err?.message ?? 'Falha ao carregar'); setRows([]); } });
    return () => { cancelled = true; };
  }, [clientId, phoneKey]);

  useEffect(() => {
    let cancelled = false;
    callLogService.canDeleteRecordings()
      .then(ok => { if (!cancelled) setCanDelete(ok); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const total = useMemo(() => {
    const seconds = (rows ?? []).reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
    return durationLabel(seconds);
  }, [rows]);

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as gravações…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e7e5df] px-4 py-10 text-center">
        <Mic className="mb-2 h-7 w-7 text-slate-200" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-slate-500">
          {error ? 'Não foi possível carregar as gravações' : 'Nenhuma gravação'}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
          {error ?? 'As ligações gravadas aparecem aqui, com o áudio, a duração e a opção de transcrever a conversa.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-slate-400">
        <strong className="font-bold text-slate-500">{rows.length}</strong> gravação{rows.length !== 1 ? 'ões' : ''} · {total} de áudio
      </p>
      {rows.map(row => (
        <RecordingCard
          key={row.id}
          row={row}
          canDelete={canDelete}
          onChanged={next => setRows(list => (list ?? []).map(r => (r.id === next.id ? next : r)))}
          onDeleted={id => setRows(list => (list ?? []).filter(r => r.id !== id))}
        />
      ))}
    </div>
  );
};

export default ClientRecordingsPanel;
