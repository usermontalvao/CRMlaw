import React from 'react';
import { Calendar, ChevronRight, Clock } from 'lucide-react';
import type { CalendarEvent } from '../../types/calendar.types';

interface AgendaWidgetProps {
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onViewAll: () => void;
}

const getEventTypeColor = (type: string) => {
  switch (type) {
    case 'audiencia':
      return 'bg-red-500';
    case 'reuniao':
      return 'bg-blue-500';
    case 'prazo':
      return 'bg-amber-500';
    case 'compromisso':
      return 'bg-purple-500';
    default:
      return 'bg-slate-500';
  }
};

export const AgendaWidget: React.FC<AgendaWidgetProps> = ({
  events,
  onEventClick,
  onViewAll,
}) => {
  const upcomingEvents = events
    .filter((e) => new Date(e.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 5);

  return (
    <div className="lg:col-span-2 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-lg overflow-hidden">
      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Agenda Jurídica</h2>
              <p className="text-xs text-white/60">{upcomingEvents.length} próximos compromissos</p>
            </div>
          </div>
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-xs font-medium"
          >
            Ver agenda <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Events List */}
        {upcomingEvents.length === 0 ? (
          <div className="text-center py-6">
            <Calendar className="w-10 h-10 text-white/20 mx-auto mb-2" />
            <p className="text-sm text-white/50">Nenhum compromisso próximo</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcomingEvents.map((event) => {
              const eventDate = new Date(event.start_at);
              return (
                <div
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className="flex items-center gap-3 p-2.5 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer transition-all group"
                >
                  {/* Date Badge */}
                  <div className={`w-10 h-10 rounded-lg ${getEventTypeColor(event.event_type)} flex flex-col items-center justify-center text-white`}>
                    <span className="text-xs font-medium leading-none">
                      {eventDate.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3)}
                    </span>
                    <span className="text-sm font-bold leading-none">{eventDate.getDate()}</span>
                  </div>

                  {/* Event Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate group-hover:text-amber-300 transition-colors">
                      {event.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      <Clock className="w-3 h-3" />
                      <span>
                        {eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" />
                </div>
              );
            })}
          </div>
        )}

        {/* View All Button */}
        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onViewAll}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-medium text-sm transition-all"
          >
            Ver Agenda Completa
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgendaWidget;
