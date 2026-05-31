import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar, Clock, Video, Gavel, Users, CalendarDays,
  CalendarClock, Stethoscope,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientPortalService } from '../services/clientPortal.service';
import { EmptyState, SkeletonCard, formatDateLong } from '../components/PortalUI';

interface CalendarEvent {
  id: string;
  title?: string;
  description?: string;
  start_at?: string;
  end_at?: string;
  event_type?: string;   // hearing | pericia | meeting
}

function timeOf(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso?: string): string {
  if (!iso) return 'Sem data';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Sem data';
  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const target   = new Date(d); target.setHours(0,0,0,0);
  if (target.getTime() === today.getTime())    return 'Hoje';
  if (target.getTime() === tomorrow.getTime()) return 'Amanhã';
  return formatDateLong(iso);
}

function eventStyle(type?: string, isOnline?: boolean) {
  const t = (type || '').toLowerCase();
  if (t.includes('hearing') || t.includes('audi'))
    return { Icon: Gavel, bg: 'bg-amber-500', ring: 'ring-amber-200', label: 'Audiência' };
  if (t.includes('pericia') || t.includes('perícia'))
    return { Icon: Stethoscope, bg: 'bg-cyan-500', ring: 'ring-cyan-200', label: 'Perícia' };
  if (t.includes('meeting') || t.includes('reuni'))
    return isOnline
      ? { Icon: Video, bg: 'bg-violet-500', ring: 'ring-violet-200', label: 'Reunião online' }
      : { Icon: Users, bg: 'bg-violet-500', ring: 'ring-violet-200', label: 'Reunião' };
  return { Icon: Calendar, bg: 'bg-orange-500', ring: 'ring-orange-200', label: 'Compromisso' };
}

function isFuture(ev: CalendarEvent): boolean {
  if (!ev.start_at) return true;
  const d = new Date(ev.start_at);
  if (isNaN(d.getTime())) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return d >= now;
}

export const PortalCalendar: React.FC = () => {
  const { session } = useClientAuth();
  const [events, setEvents]     = useState<CalendarEvent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    setLoading(true);
    clientPortalService.listCalendarEvents(session.user.id)
      .then((data) => { if (mounted) setEvents(data as CalendarEvent[]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [session]);

  const { upcoming, past } = useMemo(() => {
    const up: CalendarEvent[] = [], ps: CalendarEvent[] = [];
    events.forEach((ev) => (isFuture(ev) ? up : ps).push(ev));
    up.sort((a, b) => new Date(a.start_at||0).getTime() - new Date(b.start_at||0).getTime());
    ps.sort((a, b) => new Date(b.start_at||0).getTime() - new Date(a.start_at||0).getTime());
    return { upcoming: up, past: ps };
  }, [events]);

  const shown = showPast ? past : upcoming;

  // Agrupa por dia
  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    shown.forEach((ev) => {
      const k = ev.start_at ? ev.start_at.slice(0, 10) : 'sem-data';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    });
    return Array.from(map.entries());
  }, [shown]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Agenda</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {upcoming.length > 0
              ? `${upcoming.length} próximo${upcoming.length !== 1 ? 's' : ''}`
              : 'Sem próximos compromissos'}
            {past.length > 0 && ` · ${past.length} no histórico`}
          </p>
        </div>
      </div>

      {/* Toggle */}
      <div className="flex gap-2">
        {[
          { id: false, label: 'Próximos', count: upcoming.length, icon: CalendarClock },
          { id: true,  label: 'Histórico', count: past.length,    icon: CalendarDays  },
        ].map(({ id, label, count, icon: Icon }) => (
          <button
            key={String(id)}
            onClick={() => setShowPast(id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ring-1 transition ${
              showPast === id
                ? 'bg-orange-500 text-white ring-orange-500 shadow-sm'
                : 'bg-white text-slate-600 ring-slate-200 active:bg-slate-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className={`min-w-[18px] rounded-full px-1.5 text-[10px] font-bold ${showPast === id ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="flex flex-col gap-3"><SkeletonCard /><SkeletonCard /></div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={showPast ? 'Sem histórico' : 'Agenda livre'}
          description={showPast ? 'Nenhum compromisso passado registrado.' : 'Nenhum compromisso agendado no momento.'}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([key, items]) => (
            <div key={key}>
              {/* Cabeçalho do dia */}
              <div className="mb-3 flex items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                  showPast ? 'bg-slate-100 text-slate-500' : 'bg-orange-100 text-orange-700'
                }`}>
                  {key !== 'sem-data' ? new Date(key + 'T12:00:00').getDate() : '?'}
                </div>
                <div>
                  <p className={`text-sm font-bold ${showPast ? 'text-slate-500' : 'text-slate-900'}`}>
                    {dayLabel(items[0]?.start_at)}
                  </p>
                  {key !== 'sem-data' && (
                    <p className="text-[11px] text-slate-400">
                      {new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                    </p>
                  )}
                </div>
                <div className="h-px flex-1 bg-slate-100" />
              </div>

              {/* Cards do dia */}
              <div className="flex flex-col gap-2.5">
                {items.map((ev) => {
                  const { Icon, bg, ring, label } = eventStyle(ev.event_type);
                  const isPast = !isFuture(ev);
                  const start  = timeOf(ev.start_at);
                  const end    = timeOf(ev.end_at);

                  return (
                    <div
                      key={ev.id}
                      className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${
                        isPast ? 'border-slate-200 opacity-60' : 'border-slate-200 hover:border-orange-200 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-start gap-3.5 p-4">
                        {/* Ícone */}
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ring-4 ${bg} ${ring}`}>
                          <Icon className="h-5 w-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* Título */}
                          <div className="flex items-start justify-between gap-2">
                            <h3 className={`text-sm font-bold leading-snug ${isPast ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {ev.title || label}
                            </h3>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                              isPast
                                ? 'bg-slate-100 text-slate-400 ring-slate-200'
                                : 'bg-orange-50 text-orange-700 ring-orange-200'
                            }`}>
                              {isPast ? 'Realizado' : label}
                            </span>
                          </div>

                          {ev.description && (
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{ev.description}</p>
                          )}

                          {/* Meta */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                            {start && (
                              <span className={`inline-flex items-center gap-1 font-semibold ${isPast ? 'text-slate-400' : 'text-slate-700'}`}>
                                <Clock className="h-3 w-3" />
                                {start}{end && end !== start && ` – ${end}`}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalCalendar;
