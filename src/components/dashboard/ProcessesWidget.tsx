import React from 'react';
import { Scale, ChevronRight, FileText } from 'lucide-react';
import type { Process } from '../../types/process.types';
import type { Client } from '../../types/client.types';

interface ProcessesWidgetProps {
  processes: Process[];
  clientMap: Map<string, Client>;
  title?: string;
  subtitle?: string;
  onProcessClick: (process: Process) => void;
  onViewAll: () => void;
}

export const ProcessesWidget: React.FC<ProcessesWidgetProps> = ({
  processes,
  clientMap,
  title = 'Processos Aguardando',
  subtitle,
  onProcessClick,
  onViewAll,
}) => {
  const displayProcesses = processes.slice(0, 5);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
            <Scale className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-500">
              {subtitle || `${displayProcesses.length} processo${displayProcesses.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-purple-500 hover:text-purple-600 text-xs font-semibold"
        >
          Ver todos
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Processes List */}
      {displayProcesses.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="w-10 h-10 text-slate-200 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nenhum processo aguardando</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {displayProcesses.map((process) => {
            const client = process.client_id ? clientMap.get(process.client_id) : null;

            return (
              <div
                key={process.id}
                onClick={() => onProcessClick(process)}
                className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer transition-all group"
              >
                {/* Icon */}
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <FileText className="w-4 h-4 text-purple-600" />
                </div>

                {/* Process Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate group-hover:text-purple-600 transition-colors">
                    {process.process_code || 'Sem número'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {client?.full_name || 'Sem cliente'}
                  </p>
                </div>

                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProcessesWidget;
