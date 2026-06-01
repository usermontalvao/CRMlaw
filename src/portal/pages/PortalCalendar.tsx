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
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[26px]">Agenda</h1>
        <p className="mt-1 text-sm text-slate-500">
          {upcoming.length > 0
            ? `${upcoming.length} próximo${upcoming.length !== 1 ? 's' : ''}`
            : 'Sem próximos compromissos'}
          {past.length > 0 && ` · ${past.length} no histórico`}
        </p>
      </header>

      {/* Toggle */}
      <div className="flex gap-4 border-b border-slate-200">
        {[
          { id: false, label: 'Próximos', count: upcoming.length, icon: CalendarClock },
          { id: true,  label: 'Histórico', count: past.length,    icon: CalendarDays  },
        ].map(({ id, label, count }) => {
          const on = showPast === id;
          return (
            <button
              key={String(id)}
              onClick={() => setShowPast(id)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 pb-3 pt-1 text-sm font-medium transition ${on ? 'border-orange-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              {label}
              <span className={`tabular-nums text-[11px] font-semibold ${on ? 'text-orange-700' : 'text-slate-400'}`}>{count}</span>
            </button>
          );
        })}
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
                <div className={`flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-lg text-center ${
                  showPast ? 'bg-slate-100' : 'bg-orange-50'
                }`}>
                  <span className={`text-sm font-semibold tabular-nums leading-none ${showPast ? 'text-slate-500' : 'text-orange-700'}`}>
                    {key !== 'sem-data' ? new Date(key + 'T12:00:00').getDate() : '?'}
                  </span>
                </div>
                <div>
                  <p className={`text-sm font-semibold ${showPast ? 'text-slate-500' : 'text-slate-900'}`}>
                    {dayLabel(items[0]?.start_at)}
                  </p>
                  {key !== 'sem-data' && (
                    <p className="text-[11px] capitalize text-slate-400">
                      {new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}
                    </p>
                  )}
                </div>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              {/* Cards do dia */}
              <div className="flex flex-col gap-2">
                {items.map((ev) => {
                  const { Icon, bg, label } = eventStyle(ev.event_type);
                  const isPast = !isFuture(ev);
                  const start  = timeOf(ev.start_at);
                  const end    = timeOf(ev.end_at);

                  return (
                    <div
                      key={ev.id}
                      className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition ${isPast ? 'opacity-60' : 'hover:border-slate-300'}`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white ${bg}`}>
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className={`text-sm font-semibold leading-snug ${isPast ? 'text-slate-400' : 'text-slate-900'}`}>
                            {ev.title || label}
                          </h3>
                          <span className={`shrink-0 text-[11px] font-medium ${isPast ? 'text-slate-400' : 'text-orange-700'}`}>
                            {isPast ? 'Realizado' : label}
                          </span>
                        </div>

                        {ev.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{ev.description}</p>
                        )}

                        {start && (
                          <p className={`mt-1.5 inline-flex items-center gap-1 text-[11px] tabular-nums font-medium ${isPast ? 'text-slate-400' : 'text-slate-700'}`}>
                            <Clock className="h-3 w-3" />
                            {start}{end && end !== start && ` – ${end}`}
                          </p>
                        )}
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
