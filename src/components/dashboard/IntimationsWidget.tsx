import React from 'react';
import { Bell, ChevronRight, ArrowRight } from 'lucide-react';
import type { DjenComunicacaoLocal } from '../../types/djen.types';
import type { Client } from '../../types/client.types';

interface IntimationsWidgetProps {
  intimacoes: DjenComunicacaoLocal[];
  urgencyStats: { alta: number; media: number; baixa: number; sem_analise: number };
  clientMap: Map<string, Client>;
  onIntimacaoClick: (intimacao: DjenComunicacaoLocal) => void;
  onViewAll: () => void;
}

export const IntimationsWidget: React.FC<IntimationsWidgetProps> = ({
  intimacoes,
  urgencyStats,
  clientMap,
  onIntimacaoClick,
  onViewAll,
}) => {
  const displayIntimacoes = intimacoes.slice(0, 4);

  return (
    <div className="bg-gradient-to-br from-red-900 to-red-950 rounded-xl shadow-lg overflow-hidden">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center">
              <Bell className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Intimações DJEN</h2>
              <p className="text-[10px] text-white/60">{intimacoes.length} não lidas</p>
            </div>
          </div>
          <button
            onClick={onViewAll}
            className="text-red-300 hover:text-red-200 text-xs font-medium flex items-center gap-1"
          >
            Ver todas <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Urgency Stats */}
        {(urgencyStats.alta > 0 || urgencyStats.media > 0 || urgencyStats.baixa > 0) && (
          <div className="flex items-center gap-2 mb-3">
            {urgencyStats.alta > 0 && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full">
                {urgencyStats.alta} urgente{urgencyStats.alta > 1 ? 's' : ''}
              </span>
            )}
            {urgencyStats.media > 0 && (
              <span className="px-2 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full">
                {urgencyStats.media} média
              </span>
            )}
            {urgencyStats.baixa > 0 && (
              <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-bold rounded-full">
                {urgencyStats.baixa} baixa
              </span>
            )}
          </div>
        )}

        {/* Intimations List */}
        {displayIntimacoes.length === 0 ? (
          <div className="text-center py-4">
            <Bell className="w-8 h-8 text-white/20 mx-auto mb-2" />
            <p className="text-xs text-white/50">Nenhuma intimação pendente</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {displayIntimacoes.map((intimacao) => {
              const dataDisponibilizacao = new Date(intimacao.data_disponibilizacao);
              const isRecent = Date.now() - dataDisponibilizacao.getTime() < 24 * 60 * 60 * 1000;
              const client = intimacao.client_id ? clientMap.get(intimacao.client_id) : null;

              return (
                <div
                  key={intimacao.id}
                  onClick={() => onIntimacaoClick(intimacao)}
                  className="flex items-center gap-2 p-2 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer transition-all group"
                >
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                    isRecent ? 'bg-orange-500 text-white' : 'bg-white/20 text-white'
                  }`}>
                    {dataDisponibilizacao.getDate()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      {intimacao.tipo_comunicacao || 'Comunicação'}
                    </p>
                    <p className="text-[10px] text-white/50 truncate">
                      {intimacao.sigla_tribunal} • {intimacao.numero_processo_mascara || intimacao.numero_processo}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View All Button */}
        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={onViewAll}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-sm transition-all"
          >
            Ver Todas Intimações
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntimationsWidget;
