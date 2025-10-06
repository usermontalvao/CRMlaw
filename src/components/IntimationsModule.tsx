import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Loader2,
  RefreshCw,
  Search,
  Eye,
  Check,
  Archive,
  Calendar,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { djeService } from '../services/dje.service';
import { processService } from '../services/process.service';
import type { Intimation, IntimationFilters } from '../types/intimation.types';
import type { Process } from '../types/process.types';

const IntimationsModule: React.FC = () => {
  const [intimations, setIntimations] = useState<Intimation[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'read' | 'archived'>('all');
  const [selectedIntimation, setSelectedIntimation] = useState<Intimation | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const processMap = useMemo(
    () => new Map(processes.map((p) => [p.id, p])),
    [processes]
  );

  const filteredIntimations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return intimations.filter((intimation) => {
      const process = processMap.get(intimation.process_id);
      
      // Status filter
      if (statusFilter !== 'all' && intimation.status !== statusFilter) {
        return false;
      }

      // Search filter
      if (term) {
        const searchable = [
          intimation.diary_name,
          intimation.content,
          process?.process_code,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(term)) {
          return false;
        }
      }

      return true;
    });
  }, [intimations, searchTerm, statusFilter, processMap]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [intimationsData, processesData, pendingCountData] = await Promise.all([
        djeService.listIntimations(),
        processService.listProcesses(),
        djeService.getPendingCount(),
      ]);

      setIntimations(intimationsData);
      setProcesses(processesData);
      setPendingCount(pendingCountData);
    } catch (err: any) {
      setError(err.message || 'Não foi possível carregar as intimações.');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const result = await djeService.syncAllActiveProcesses();
      await loadData();

      if (result.errors > 0) {
        setError(
          `Sincronização concluída com ${result.errors} erro(s). ${result.synced} processo(s) atualizados.`
        );
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao sincronizar intimações.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateStatus = async (
    intimationId: string,
    newStatus: 'pending' | 'read' | 'archived'
  ) => {
    try {
      await djeService.updateIntimationStatus(intimationId, newStatus);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status.');
    }
  };

  const handleViewDetails = (intimation: Intimation) => {
    setSelectedIntimation(intimation);
    if (intimation.status === 'pending') {
      handleUpdateStatus(intimation.id, 'read');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-700';
      case 'read':
        return 'bg-blue-100 text-blue-700';
      case 'archived':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Pendente';
      case 'read':
        return 'Lida';
      case 'archived':
        return 'Arquivada';
      default:
        return status;
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (selectedIntimation) {
    const process = processMap.get(selectedIntimation.process_id);
    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Detalhes da Intimação</h3>
              <p className="text-sm text-slate-600 mt-1">
                {selectedIntimation.diary_name} - {formatDate(selectedIntimation.publication_date)}
              </p>
            </div>
            <button
              onClick={() => setSelectedIntimation(null)}
              className="text-slate-600 hover:text-slate-900 font-medium text-sm"
            >
              ← Voltar
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Processo</label>
              <p className="text-base text-slate-900 mt-1 font-mono">
                {process?.process_code || 'Processo não encontrado'}
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Status</label>
              <p className="mt-1">
                <span
                  className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(
                    selectedIntimation.status
                  )}`}
                >
                  {getStatusLabel(selectedIntimation.status)}
                </span>
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase">Conteúdo</label>
              <div className="mt-2 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {selectedIntimation.content}
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-gray-200">
              {selectedIntimation.status === 'pending' && (
                <button
                  onClick={() => handleUpdateStatus(selectedIntimation.id, 'read')}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
                >
                  <Check className="w-4 h-4" />
                  Marcar como lida
                </button>
              )}
              {selectedIntimation.status !== 'archived' && (
                <button
                  onClick={() => handleUpdateStatus(selectedIntimation.id, 'archived')}
                  className="inline-flex items-center gap-2 bg-slate-600 hover:bg-slate-700 text-white font-medium px-4 py-2.5 rounded-lg transition"
                >
                  <Archive className="w-4 h-4" />
                  Arquivar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
              <Bell className="w-6 h-6 text-amber-600" />
              Intimações e Publicações
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Acompanhe publicações do DJe/PJe automaticamente
              {pendingCount > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                  {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                </span>
              )}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-60"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Sincronizar DJe
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Buscar por processo, diário ou conteúdo..."
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          >
            <option value="all">Todos os status</option>
            <option value="pending">Pendentes</option>
            <option value="read">Lidas</option>
            <option value="archived">Arquivadas</option>
          </select>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-600">Carregando intimações...</p>
          </div>
        ) : filteredIntimations.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">Nenhuma intimação encontrada.</p>
            <p className="text-sm text-slate-500 mt-2">
              Clique em "Sincronizar DJe" para buscar novas publicações.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredIntimations.map((intimation) => {
              const process = processMap.get(intimation.process_id);
              return (
                <div
                  key={intimation.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition cursor-pointer"
                  onClick={() => handleViewDetails(intimation)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="text-sm font-medium text-slate-900">
                          {intimation.diary_name}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatDate(intimation.publication_date)}
                        </span>
                      </div>

                      {process && (
                        <p className="text-sm text-slate-600 font-mono mb-2">
                          Processo: {process.process_code}
                        </p>
                      )}

                      <p className="text-sm text-slate-700 line-clamp-2">
                        {intimation.content}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadge(
                          intimation.status
                        )}`}
                      >
                        {getStatusLabel(intimation.status)}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewDetails(intimation);
                        }}
                        className="text-blue-600 hover:text-blue-900 transition-colors"
                        title="Ver detalhes"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default IntimationsModule;
