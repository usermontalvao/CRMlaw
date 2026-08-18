// As chamadas de voz na ficha do cliente.
//
// A ligação era o único atendimento do escritório que não deixava rastro: quem
// falou, quando, por quanto tempo e o que ficou combinado sumiam junto com o
// "tchau". Esta aba é o registro disso — e, quando o operador gravou, o áudio
// da conversa.
//
// Duas decisões de leitura:
//
//  • AGRUPADO POR DIA. Um cliente ativo acumula dezenas de ligações; a pergunta
//    que se faz na ficha é quase sempre "quando falamos com ele pela última
//    vez?", e a resposta precisa estar na primeira linha, com data por extenso.
//
//  • A GRAVAÇÃO SÓ É BUSCADA NO CLIQUE. A URL do áudio é assinada e cara de
//    gerar; abrir a ficha de quem tem 40 ligações não pode disparar 40
//    assinaturas para ouvir nenhuma.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play } from 'lucide-react';
import { callLogService, type CallLogRow } from '../services/callLog.service';
import { formatOfficeTime } from '../utils/officeTime';

/** "12:04" no fuso do escritório — o mesmo relógio da agenda. */
const hour = (iso: string): string => formatOfficeTime(iso) || '--:--';

/** "seg, 17 de agosto de 2026" — a data como se fala. */
const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Data desconhecida';
  return date.toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'long', year: 'numeric',
  });
};

const dayKey = (iso: string): string => (iso ?? '').slice(0, 10);

/** "3 min 12 s" / "42 s" — duração para ler, não para calcular. */
const durationLabel = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
};

const OUTCOME: Record<CallLogRow['outcome'], { label: string; className: string }> = {
  answered: { label: 'Atendida', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  missed: { label: 'Não atendida', className: 'bg-rose-50 text-rose-700 ring-rose-200' },
  declined: { label: 'Recusada', className: 'bg-amber-50 text-amber-700 ring-amber-200' },
  failed: { label: 'Falhou', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

/** O player só existe depois do clique — a URL assinada é buscada ali. */
const RecordingPlayer: React.FC<{ path: string }> = ({ path }) => {
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
      <div className="mt-2 flex items-center gap-2">
        <audio src={url} controls autoPlay className="h-8 w-full max-w-sm" />
        <a
          href={url}
          download
          title="Baixar a gravação"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { void load(); }}
      disabled={loading || failed}
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {failed ? 'Gravação indisponível' : 'Ouvir gravação'}
    </button>
  );
};

export const ClientCallsPanel: React.FC<{
  clientId: string;
  /** Telefones do cadastro — pegam as ligações registradas antes do vínculo. */
  phones?: Array<string | null | undefined>;
}> = ({ clientId, phones = [] }) => {
  const [rows, setRows] = useState<CallLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A lista de telefones vem de props e muda de identidade a cada render do
  // pai; sem esta chave estável o efeito recarregaria a aba em looping.
  const phoneKey = phones.filter(Boolean).join('|');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    callLogService
      .listByClient(clientId, phoneKey ? phoneKey.split('|') : [])
      .then(list => { if (!cancelled) setRows(list); })
      .catch(err => { if (!cancelled) { setError(err?.message ?? 'Falha ao carregar'); setRows([]); } });
    return () => { cancelled = true; };
  }, [clientId, phoneKey]);

  const days = useMemo(() => {
    const groups = new Map<string, CallLogRow[]>();
    for (const row of rows ?? []) {
      const key = dayKey(row.startedAt);
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    return Array.from(groups.entries());
  }, [rows]);

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as chamadas…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e7e5df] px-4 py-10 text-center">
        <PhoneOutgoing className="mb-2 h-7 w-7 text-slate-200" strokeWidth={1.5} />
        <p className="text-[13px] font-medium text-slate-500">
          {error ? 'Não foi possível carregar as chamadas' : 'Nenhuma chamada registrada'}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
          {error ?? 'As ligações de voz do WhatsApp aparecem aqui com horário, duração e a gravação, quando houver.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {days.map(([key, calls]) => (
        <div key={key}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {dayLabel(calls[0].startedAt)}
          </p>
          <div className="space-y-2">
            {calls.map(call => {
              const outcome = OUTCOME[call.outcome];
              const missed = call.outcome !== 'answered';
              const Icon = missed ? PhoneMissed : call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
              return (
                <div key={call.id} className="rounded-xl border border-[#e7e5df] bg-white p-3">
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      missed ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-[13px] font-bold text-slate-800 tabular-nums">{hour(call.startedAt)}</p>
                        <p className="text-[12.5px] text-slate-500">
                          {call.direction === 'inbound' ? 'Recebida' : 'Realizada'}
                        </p>
                        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ${outcome.className}`}>
                          {outcome.label}
                        </span>
                        {call.outcome === 'answered' && (
                          <span className="text-[12px] font-semibold text-slate-600 tabular-nums">
                            {durationLabel(call.durationSeconds)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-slate-400">
                        {call.userName ? `Atendida por ${call.userName}` : 'Sem atendente registrado'}
                        {call.recordingPath ? ' · com gravação' : ''}
                      </p>
                      {call.recordingPath && <RecordingPlayer path={call.recordingPath} />}
                      {/* A transcrição, quando já existe, é lida aqui também: quem
                          está no histórico não deveria trocar de aba para saber o
                          que foi dito. Transcrever, apagar e baixar continuam na
                          aba "Gravações" — este é o lugar da leitura. */}
                      {call.transcript && (
                        <div className="mt-2 rounded-lg border border-[#e7e5df] bg-[#faf9f7] p-2.5">
                          <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                            Transcrição da gravação
                          </p>
                          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">
                            {call.transcript}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ClientCallsPanel;
