import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Clock,
  AlertCircle,
  CalendarClock,
  ArrowUpToLine,
  Edit2,
} from 'lucide-react';
import { deadlineService } from '../services/deadline.service';
import type { Deadline } from '../types/deadline.types';
import type { Profile } from '../services/profile.service';
import { formatDate } from '../utils/formatters';
import { toOfficeTimestamp } from '../utils/officeTime';

interface Props {
  isAdmin: boolean;
  members: Profile[];
  onEdit?: (deadline: Deadline) => void;
}

/**
 * Prazos agendados — os que já estão cadastrados mas ainda não entraram na fila.
 *
 * Sem esta tela o agendamento seria perigoso: um prazo com a data de aparição
 * digitada errada ficaria invisível e sem meio de ser encontrado antes de
 * acordar. Aqui ele continua à mão para conferir, antecipar ou corrigir.
 */
export const DeadlineScheduledPanel: React.FC<Props> = ({ members, onEdit }) => {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeadlines(await deadlineService.listScheduledDeadlines());
    } catch (e: any) {
      setError(e?.message ?? 'Não foi possível carregar os prazos agendados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const memberName = useCallback(
    (userId?: string | null) =>
      userId ? (members.find((m) => m.user_id === userId)?.name ?? 'Usuário removido') : null,
    [members],
  );

  /** Traz o prazo para a fila agora, limpando o agendamento. */
  const handleBringForward = async (deadline: Deadline) => {
    setBusyId(deadline.id);
    setError(null);
    try {
      await deadlineService.rescheduleDeadline(deadline.id, null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Não foi possível trazer o prazo para a fila.');
    } finally {
      setBusyId(null);
    }
  };

  const handleChangeDate = async (deadline: Deadline, novaData: string) => {
    if (!novaData) return;
    setBusyId(deadline.id);
    setError(null);
    try {
      await deadlineService.rescheduleDeadline(deadline.id, toOfficeTimestamp(`${novaData}T00:00`));
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Não foi possível alterar a data.');
    } finally {
      setBusyId(null);
    }
  };

  /** Agrupa por mês de aparição — a leitura natural de uma fila de espera. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, Deadline[]>();
    for (const d of deadlines) {
      const chave = String(d.visible_from ?? '').slice(0, 7);
      const lista = mapa.get(chave) ?? [];
      lista.push(d);
      mapa.set(chave, lista);
    }
    return Array.from(mapa.entries());
  }, [deadlines]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Prazos agendados</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Já cadastrados e guardados. Entram na fila sozinhos na data marcada — não há
          processo nenhum para rodar, então não há como esquecerem de acordar.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {deadlines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e7e5df] bg-[#f8f7f5] px-6 py-12 text-center">
          <CalendarClock className="w-6 h-6 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">Nenhum prazo agendado</p>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Ao cadastrar um prazo, preencha <strong>“Aparecer na lista em”</strong> para
            guardá-lo sem poluir a tela de trabalho até a data chegar.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map(([mes, itens]) => (
            <div key={mes}>
              <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">
                {mes ? new Date(`${mes}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : 'Sem data'}
                <span className="ml-2 text-slate-400 normal-case font-normal">
                  {itens.length} prazo{itens.length > 1 ? 's' : ''}
                </span>
              </h3>

              <div className="space-y-2">
                {itens.map((d) => (
                  <ScheduledCard
                    key={d.id}
                    deadline={d}
                    responsavel={memberName(d.responsible_id)}
                    busy={busyId === d.id}
                    onBringForward={() => handleBringForward(d)}
                    onChangeDate={(data) => handleChangeDate(d, data)}
                    onEdit={onEdit ? () => onEdit(d) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PRIORITY_STYLE: Record<string, string> = {
  baixa: 'bg-slate-100 text-slate-600',
  media: 'bg-sky-50 text-sky-700',
  alta: 'bg-amber-50 text-amber-700',
  urgente: 'bg-red-50 text-red-700',
};

const ScheduledCard: React.FC<{
  deadline: Deadline;
  responsavel: string | null;
  busy: boolean;
  onBringForward: () => void;
  onChangeDate: (data: string) => void;
  onEdit?: () => void;
}> = ({ deadline, responsavel, busy, onBringForward, onChangeDate, onEdit }) => {
  const aparecerEm = String(deadline.visible_from ?? '').slice(0, 10);
  const diasAte = Math.ceil(
    (new Date(`${aparecerEm}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000,
  );

  return (
    <div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-sm px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="w-7 h-7 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
          <Clock className="w-3.5 h-3.5" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-900 truncate">{deadline.title}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_STYLE[deadline.priority] ?? PRIORITY_STYLE.media}`}>
              {deadline.priority}
            </span>
          </div>

          <p className="text-xs text-slate-600 mt-1">
            Aparece em <strong>{formatDate(aparecerEm)}</strong>
            {diasAte > 0 && <span className="text-slate-400"> · daqui a {diasAte} dia{diasAte > 1 ? 's' : ''}</span>}
            {' · '}vence em <strong>{formatDate(deadline.due_date)}</strong>
          </p>

          {responsavel && (
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">Responsável: {responsavel}</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <label className="relative" title="Mudar a data de aparição">
            <input
              type="date"
              value={aparecerEm}
              max={String(deadline.due_date ?? '').slice(0, 10) || undefined}
              disabled={busy}
              onChange={(e) => onChangeDate(e.target.value)}
              className="h-8 px-2 rounded-md border border-[#e7e5df] bg-white text-xs text-slate-700 focus:outline-none focus:border-slate-400 disabled:opacity-50"
            />
          </label>

          {onEdit && (
            <button
              type="button" onClick={onEdit} disabled={busy} title="Editar prazo"
              className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button" onClick={onBringForward} disabled={busy}
            title="Trazer para a fila agora"
            className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpToLine className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeadlineScheduledPanel;
