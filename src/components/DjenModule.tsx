import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2,
  FileText,
  User,
  Building2,
  ExternalLink,
  Search,
  Download,
  Link2,
  Eye,
  EyeOff,
  Archive,
  CalendarPlus,
  AlarmClock,
  Gavel,
} from 'lucide-react';
import { djenService } from '../services/djen.service';
import { djenLocalService } from '../services/djenLocal.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { notificationService } from '../services/notification.service';
import type { DjenComunicacao, DjenConsultaParams, DjenComunicacaoLocal, CreateDjenComunicacaoDTO } from '../types/djen.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';

interface DjenModuleProps {
  onNavigateToModule?: (moduleKey: string) => void;
}

const DjenModule: React.FC<DjenModuleProps> = ({ onNavigateToModule }) => {
  const [loading, setLoading] = useState(false);
  const [comunicacoes, setComunicacoes] = useState<DjenComunicacao[]>([]);
  const [comunicacoesLocais, setComunicacoesLocais] = useState<DjenComunicacaoLocal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('djenAutoSync');
      if (stored !== null) {
        return stored === 'true';
      }
    }
    return true;
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [linkingComunicacao, setLinkingComunicacao] = useState<DjenComunicacao | null>(null);
  const [linkClientId, setLinkClientId] = useState('');
  const [linkProcessId, setLinkProcessId] = useState('');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [viewMode, setViewMode] = useState<'api' | 'local'>('local');
  const [groupByClient, setGroupByClient] = useState(false);
  const [groupByProcess, setGroupByProcess] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [lastSyncStatus, setLastSyncStatus] = useState<{
    success: boolean;
    timestamp: string;
    count: number;
    message: string;
  } | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('djenLastSyncStatus');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });
  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const comunicacoesNaoLidas = useMemo(() => comunicacoesLocais.filter((item) => !item.lida), [comunicacoesLocais]);

  const comunicacoesArquivadas = useMemo(() => comunicacoesLocais.filter((item) => item.lida), [comunicacoesLocais]);

  const openLinkModalFromLocal = (comunicacao: DjenComunicacaoLocal) => {
    const comunicacaoApi: DjenComunicacao = {
      id: comunicacao.djen_id,
      hash: comunicacao.hash,
      numero_processo: comunicacao.numero_processo,
      numeroprocessocommascara: comunicacao.numero_processo_mascara || '',
      siglaTribunal: comunicacao.sigla_tribunal,
      nomeOrgao: comunicacao.nome_orgao || '',
      texto: comunicacao.texto,
      tipoComunicacao: comunicacao.tipo_comunicacao || '',
      tipoDocumento: comunicacao.tipo_documento || '',
      nomeClasse: comunicacao.nome_classe || '',
      codigoClasse: comunicacao.codigo_classe || '',
      meio: comunicacao.meio,
      meiocompleto: comunicacao.meio_completo || '',
      link: comunicacao.link || '',
      data_disponibilizacao: comunicacao.data_disponibilizacao,
      numeroComunicacao: comunicacao.numero_comunicacao || 0,
      ativo: comunicacao.ativo,
      datadisponibilizacao: comunicacao.data_disponibilizacao,
      destinatarios: [],
      destinatarioadvogados: [],
    };

    handleOpenLinkModal(comunicacaoApi);
  };

  const renderLocalCard = (comunicacao: DjenComunicacaoLocal) => (
    <div
      key={comunicacao.id}
      className={`border rounded-xl p-5 shadow-sm transition ${
        comunicacao.lida
          ? 'bg-slate-50 border-slate-200 text-slate-500'
          : 'bg-white border-blue-300 hover:shadow-md text-slate-900'
      } ${
        selectionMode && selectedIds.has(comunicacao.id) ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {selectionMode && (
          <input
            type="checkbox"
            checked={selectedIds.has(comunicacao.id)}
            onChange={() => toggleSelection(comunicacao.id)}
            className="mt-1 w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
          />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                comunicacao.lida ? 'bg-slate-200 text-slate-500' : 'bg-blue-100 text-blue-800'
              }`}
            >
              {comunicacao.sigla_tribunal}
            </span>
            {comunicacao.tipo_comunicacao && (
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  comunicacao.lida ? 'bg-slate-200 text-slate-500' : 'bg-purple-100 text-purple-800'
                }`}
              >
                {comunicacao.tipo_comunicacao}
              </span>
            )}
            <span className="text-xs text-slate-500">
              {formatarData(comunicacao.data_disponibilizacao)}
            </span>
            {!comunicacao.lida && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                NÃO LIDA
              </span>
            )}
          </div>

          <h3 className={`font-semibold mb-2 ${comunicacao.lida ? 'text-slate-600' : 'text-slate-900'}`}>
            Processo: {comunicacao.numero_processo_mascara || comunicacao.numero_processo}
          </h3>

          {comunicacao.client_id && (
            <div className={`text-sm mb-2 ${comunicacao.lida ? 'text-slate-500' : 'text-slate-600'}`}>
              <strong>Cliente:</strong> {getClientName(comunicacao.client_id)}
            </div>
          )}

          {comunicacao.process_id && (
            <div className={`text-sm mb-2 ${comunicacao.lida ? 'text-slate-500' : 'text-slate-600'}`}>
              <strong>Processo cadastrado:</strong> {getProcessCode(comunicacao.process_id)}
            </div>
          )}

          {comunicacao.djen_destinatarios && comunicacao.djen_destinatarios.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-semibold text-slate-700">Partes: </span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {comunicacao.djen_destinatarios.map((dest) => (
                  <span
                    key={dest.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800"
                  >
                    {dest.nome} {dest.polo && `(${dest.polo})`}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div
            className={`text-sm ${
              comunicacao.lida ? 'text-slate-500' : 'text-slate-700'
            } ${expandedItems.has(`local-${comunicacao.id}`) ? '' : 'line-clamp-3'}`}
          >
            {comunicacao.texto}
          </div>
          <button
            onClick={() => toggleExpanded(`local-${comunicacao.id}`)}
            className={`mt-2 text-xs font-semibold ${
              comunicacao.lida ? 'text-slate-400 hover:text-slate-500' : 'text-blue-600 hover:text-blue-700'
            }`}
          >
            {expandedItems.has(`local-${comunicacao.id}`) ? 'Mostrar menos' : 'Ler tudo'}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleMarcarComoLida(comunicacao)}
            disabled={comunicacao.lida}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition ${
              comunicacao.lida
                ? 'text-slate-400 border-slate-200 hover:bg-slate-100'
                : 'text-green-600 hover:text-green-700 border-green-200 hover:bg-green-50'
            } disabled:opacity-50`}
          >
            {comunicacao.lida ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {comunicacao.lida ? 'Lida' : 'Marcar Lida'}
          </button>
          {comunicacao.client_id || comunicacao.process_id ? (
            <button
              onClick={async () => {
                if (confirm('Desvincular cliente e processo desta comunicação?')) {
                  try {
                    await djenLocalService.updateComunicacao(comunicacao.id, {
                      client_id: null,
                      process_id: null,
                    });
                    await loadLocalData();
                    alert('Vínculos removidos com sucesso!');
                  } catch (err: any) {
                    alert(err.message || 'Erro ao desvincular.');
                  }
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              Desvincular
            </button>
          ) : (
            <button
              onClick={() => openLinkModalFromLocal(comunicacao)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition"
            >
              <Link2 className="w-3.5 h-3.5" />
              Vincular
            </button>
          )}
          {comunicacao.link && (
            <a
              href={comunicacao.link}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition ${
                comunicacao.lida
                  ? 'text-slate-400 border-slate-200 hover:bg-slate-100'
                  : 'text-blue-600 hover:text-blue-700 border-blue-200 hover:bg-blue-50'
              }`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver Diário
            </a>
          )}
        </div>
      </div>
    </div>
  );

  const [filtros, setFiltros] = useState<DjenConsultaParams>({
    nomeAdvogado: 'PEDRO RODRIGUES MONTALVAO NETO',
    dataDisponibilizacaoInicio: djenService.getDataHoje(),
    dataDisponibilizacaoFim: djenService.getDataHoje(),
    meio: 'D',
    itensPorPagina: 100,
    pagina: 1,
  });

  useEffect(() => {
    loadLocalData();
    loadClients();
    loadProcesses();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('djenAutoSync', autoSync ? 'true' : 'false');
    }
  }, [autoSync]);

  useEffect(() => {
    if (!actionMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-djen-action-menu]')) {
        return;
      }
      setActionMenuOpen(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionMenuOpen]);

  useEffect(() => {
    setActionMenuOpen(null);
  }, [viewMode]);

  // Auto-sync diário (executa a cada 24h se ativado)
  useEffect(() => {
    if (!autoSync) return;

    const syncDaily = async () => {
      try {
        const dataAtual = djenService.getDataHoje();
        const response = await djenService.consultarTodasComunicacoes({
          nomeAdvogado: 'PEDRO RODRIGUES MONTALVAO NETO',
          dataDisponibilizacaoInicio: dataAtual,
          dataDisponibilizacaoFim: dataAtual,
          meio: 'D',
          itensPorPagina: 100,
          pagina: 1,
        });

        if (response.items && response.items.length > 0) {
          const result = await djenLocalService.saveComunicacoes(response.items, {
            clients,
            processes,
          });
          
          if (result.saved > 0) {
            await notificationService.add({
              category: 'djen',
              title: `Sync automático: ${result.saved} nova(s) intimação(ões)`,
              description: `Busca diária encontrou ${result.saved} comunicação(ões) do DJEN para hoje (${dataAtual}).`,
            });
          }
          
          await loadLocalData();
          
          const syncStatus = {
            success: true,
            timestamp: new Date().toISOString(),
            count: result.saved,
            message: `${result.saved} intimação(ões) importada(s) com sucesso`,
          };
          setLastSyncStatus(syncStatus);
          window.localStorage.setItem('djenLastSyncStatus', JSON.stringify(syncStatus));
          
          console.log(`Auto-sync concluído: ${result.saved} intimações importadas para ${dataAtual}`);
        } else {
          const syncStatus = {
            success: true,
            timestamp: new Date().toISOString(),
            count: 0,
            message: 'Nenhuma intimação nova encontrada',
          };
          setLastSyncStatus(syncStatus);
          window.localStorage.setItem('djenLastSyncStatus', JSON.stringify(syncStatus));
        }
      } catch (err) {
        console.error('Erro no auto-sync:', err);
        const syncStatus = {
          success: false,
          timestamp: new Date().toISOString(),
          count: 0,
          message: err instanceof Error ? err.message : 'Erro desconhecido',
        };
        setLastSyncStatus(syncStatus);
        window.localStorage.setItem('djenLastSyncStatus', JSON.stringify(syncStatus));
      }
    };

    // Executa imediatamente ao ativar
    syncDaily();

    // Agenda próxima execução para o dia seguinte às 9h
    const scheduleNextSync = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      
      const msUntilTomorrow = tomorrow.getTime() - now.getTime();
      
      return setTimeout(() => {
        syncDaily();
        // Após executar, agenda novamente para o próximo dia
        const interval = setInterval(syncDaily, 24 * 60 * 60 * 1000);
        return interval;
      }, msUntilTomorrow);
    };

    const timeout = scheduleNextSync();

    return () => {
      clearTimeout(timeout);
    };
  }, [autoSync, clients, processes]);

  const loadLocalData = async () => {
    try {
      const data = await djenLocalService.listComunicacoes();
      setComunicacoesLocais(data);
    } catch (err) {
      console.error('Erro ao carregar comunicações locais:', err);
    }
  };

  const getAcaoResumo = (comunicacao: DjenComunicacao) => {
    const resumo = comunicacao.texto
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    return resumo || 'Sem resumo disponível.';
  };

  const handleCriarAcaoDaBusca = (
    comunicacao: DjenComunicacao,
    acao: 'prazo' | 'compromisso' | 'audiencia',
  ) => {
    const processNumber = comunicacao.numeroprocessocommascara || comunicacao.numero_processo;
    let targetModule: string = 'deadlines';
    let message = '';
    const resumo = getAcaoResumo(comunicacao);

    switch (acao) {
      case 'prazo':
        targetModule = 'deadlines';
        message = `Prazo criado a partir da intimação${processNumber ? ` (${processNumber})` : ''}.
Resumo: ${resumo}`;
        break;
      case 'compromisso':
        targetModule = 'calendar';
        message = `Compromisso adicionado à agenda${processNumber ? ` (${processNumber})` : ''}.
Resumo: ${resumo}`;
        break;
      case 'audiencia':
        targetModule = 'cases';
        message = `Audiência registrada para o processo${processNumber ? ` (${processNumber})` : ''}.
Resumo: ${resumo}`;
        break;
    }

    setActionMenuOpen(null);
    onNavigateToModule?.(targetModule);
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const loadClients = async () => {
    try {
      const data = await clientService.listClients();
      setClients(data);
    } catch (err) {
      console.error('Erro ao carregar clientes:', err);
    }
  };

  const loadProcesses = async () => {
    try {
      const data = await processService.listProcesses();
      setProcesses(data);
    } catch (err) {
      console.error('Erro ao carregar processos:', err);
    }
  };

  const handleBuscar = async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadingProgress(null);

      const response = await djenService.consultarTodasComunicacoes(filtros, (pagina, total) => {
        setLoadingProgress(`Carregando página ${pagina} de ${total}...`);
      });

      setComunicacoes(response.items || []);
      setTotalCount(response.count || 0);
      setViewMode('api');
      setLoadingProgress(null);

      // Importação automática
      if (response.items && response.items.length > 0) {
        setSaving(true);
        try {
          const result = await djenLocalService.saveComunicacoes(response.items, {
            clients,
            processes,
          });
          
          if (result.saved > 0) {
            await notificationService.add({
              category: 'djen',
              title: `${result.saved} nova(s) intimação(ões) importada(s)`,
              description: `Foram encontradas e importadas ${result.saved} comunicação(ões) do DJEN.`,
            });
          }
          
          await loadLocalData();
          setSuccessMessage(`Busca concluída! ${response.count} encontrada(s), ${result.saved} importada(s) automaticamente.`);
          setTimeout(() => setSuccessMessage(null), 5000);
        } catch (importErr: any) {
          console.error('Erro na importação automática:', importErr);
        } finally {
          setSaving(false);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar comunicações');
      setComunicacoes([]);
      setLoadingProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleImportarParaLocal = async () => {
    if (comunicacoes.length === 0) {
      alert('Nenhuma comunicação para importar.');
      return;
    }

    try {
      setSaving(true);
      const result = await djenLocalService.saveComunicacoes(comunicacoes, {
        clients,
        processes,
      });
      alert(`${result.saved} comunicação(ões) importada(s). ${result.skipped} já existente(s).`);
      
      if (result.saved > 0) {
        await notificationService.add({
          category: 'djen',
          title: `${result.saved} nova(s) intimação(ões) importada(s)`,
          description: `Foram encontradas e importadas ${result.saved} comunicação(ões) do DJEN.`,
        });
      }
      
      await loadLocalData();
      setViewMode('local');
    } catch (err: any) {
      alert(err.message || 'Erro ao importar comunicações.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarcarComoLida = async (comunicacaoLocal: DjenComunicacaoLocal) => {
    try {
      await djenLocalService.marcarComoLida(comunicacaoLocal.id);
      await loadLocalData();
      setSuccessMessage('Intimação arquivada com sucesso.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Erro ao marcar como lida.');
    }
  };

  const handleMarcarSelecionadasComoLidas = async () => {
    if (selectedIds.size === 0) {
      alert('Nenhuma intimação selecionada.');
      return;
    }

    try {
      setSaving(true);
      let count = 0;
      for (const id of selectedIds) {
        await djenLocalService.marcarComoLida(id);
        count++;
      }
      await loadLocalData();
      setSelectedIds(new Set());
      setSelectionMode(false);
      setSuccessMessage(`${count} intimação(ões) arquivada(s) com sucesso.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Erro ao marcar intimações como lidas.');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === comunicacoesNaoLidas.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(comunicacoesNaoLidas.map((c) => c.id)));
    }
  };

  const handleArquivarDaBusca = async (comunicacao: DjenComunicacao) => {
    try {
      setArchivingId(String(comunicacao.id));

      const payload: CreateDjenComunicacaoDTO = {
        djen_id: comunicacao.id,
        hash: comunicacao.hash,
        numero_comunicacao: comunicacao.numeroComunicacao || null,
        numero_processo: comunicacao.numero_processo,
        numero_processo_mascara: comunicacao.numeroprocessocommascara || null,
        codigo_classe: comunicacao.codigoClasse || null,
        nome_classe: comunicacao.nomeClasse || null,
        sigla_tribunal: comunicacao.siglaTribunal,
        nome_orgao: comunicacao.nomeOrgao || null,
        texto: comunicacao.texto,
        tipo_comunicacao: comunicacao.tipoComunicacao || null,
        tipo_documento: comunicacao.tipoDocumento || null,
        meio: comunicacao.meio,
        meio_completo: comunicacao.meiocompleto || null,
        link: comunicacao.link || null,
        data_disponibilizacao: comunicacao.data_disponibilizacao,
      };

      const saved = await djenLocalService.saveComunicacao(payload);
      await djenLocalService.marcarComoLida(saved.id);
      await loadLocalData();

      setSuccessMessage('Intimação arquivada a partir da busca.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Erro ao arquivar intimação.');
    } finally {
      setArchivingId(null);
    }
  };

  const handleOpenLinkModal = (comunicacao: DjenComunicacao) => {
    setLinkingComunicacao(comunicacao);
    setLinkClientId('');
    setLinkProcessId('');
    setShowLinkModal(true);
  };

  const handleSaveLinks = async () => {
    if (!linkingComunicacao) return;

    try {
      setSaving(true);
      
      // Primeiro salva a comunicação se não existir
      const payload: any = {
        djen_id: linkingComunicacao.id,
        hash: linkingComunicacao.hash,
        numero_comunicacao: linkingComunicacao.numeroComunicacao || null,
        numero_processo: linkingComunicacao.numero_processo,
        numero_processo_mascara: linkingComunicacao.numeroprocessocommascara || null,
        codigo_classe: linkingComunicacao.codigoClasse || null,
        nome_classe: linkingComunicacao.nomeClasse || null,
        sigla_tribunal: linkingComunicacao.siglaTribunal,
        nome_orgao: linkingComunicacao.nomeOrgao || null,
        texto: linkingComunicacao.texto,
        tipo_comunicacao: linkingComunicacao.tipoComunicacao || null,
        tipo_documento: linkingComunicacao.tipoDocumento || null,
        meio: linkingComunicacao.meio,
        meio_completo: linkingComunicacao.meiocompleto || null,
        link: linkingComunicacao.link || null,
        data_disponibilizacao: linkingComunicacao.data_disponibilizacao,
      };

      // Adiciona vínculos apenas se foram selecionados
      if (linkClientId) {
        payload.client_id = linkClientId;
      }
      if (linkProcessId) {
        payload.process_id = linkProcessId;
      }

      console.log('Salvando comunicação com payload:', payload);
      const savedComunicacao = await djenLocalService.saveComunicacao(payload);
      console.log('Comunicação salva:', savedComunicacao);

      // Se vinculou processo, propagar para outras comunicações do mesmo número
      if (linkProcessId && linkingComunicacao.numero_processo) {
        const outrasDoMesmoProcesso = comunicacoesLocais.filter(
          (c) =>
            c.numero_processo === linkingComunicacao.numero_processo &&
            c.hash !== linkingComunicacao.hash &&
            !c.process_id
        );

        for (const outra of outrasDoMesmoProcesso) {
          await djenLocalService.vincularProcesso(outra.id, linkProcessId);
          if (linkClientId) {
            await djenLocalService.vincularCliente(outra.id, linkClientId);
          }
        }
      }

      await loadLocalData();
      setShowLinkModal(false);
      
      const clientName = linkClientId ? getClientName(linkClientId) : null;
      const processCode = linkProcessId ? getProcessCode(linkProcessId) : null;
      
      let message = 'Vínculos salvos com sucesso!';
      if (clientName) message += `\nCliente: ${clientName}`;
      if (processCode) message += `\nProcesso: ${processCode}`;
      
      alert(message);
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar vínculos.');
    } finally {
      setSaving(false);
    }
  };

  const handleBuscarPorProcessosCadastrados = async () => {
    if (processes.length === 0) {
      alert('Nenhum processo cadastrado no sistema.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setLoadingProgress(null);

      const processNumbers = processes.map((p) => p.process_code);

      const response = await djenService.consultarPorProcessos(
        processNumbers,
        {
          dataDisponibilizacaoInicio: djenService.getDataDiasAtras(30),
          dataDisponibilizacaoFim: djenService.getDataHoje(),
          meio: 'D',
          itensPorPagina: 100,
          pagina: 1,
        },
        (current, total) => {
          setLoadingProgress(`Buscando processo ${current} de ${total}...`);
        }
      );

      setComunicacoes(response.items || []);
      setTotalCount(response.count || 0);
      setViewMode('api');
      setLoadingProgress(null);

      // Auto-importar com vínculos
      if (response.items && response.items.length > 0) {
        setSaving(true);
        const result = await djenLocalService.saveComunicacoes(response.items, {
          clients,
          processes,
        });
        await loadLocalData();
        setSaving(false);
        alert(
          `Busca concluída!\n${response.count} comunicação(ões) encontrada(s)\n${result.saved} importada(s) com vínculos automáticos`
        );
        setViewMode('local');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao buscar processos cadastrados');
      setComunicacoes([]);
      setLoadingProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLimparFiltros = () => {
    setFiltros({
      nomeAdvogado: 'PEDRO RODRIGUES MONTALVAO NETO',
      dataDisponibilizacaoInicio: djenService.getDataHoje(),
      dataDisponibilizacaoFim: djenService.getDataHoje(),
      meio: 'D',
      itensPorPagina: 100,
      pagina: 1,
    });
  };

  const formatarData = (dataStr: string) => {
    try {
      const date = new Date(dataStr);
      return date.toLocaleDateString('pt-BR');
    } catch {
      return dataStr;
    }
  };

  const comunicacoesAgrupadas = useMemo(() => {
    if (!groupByClient || viewMode !== 'local') return null;

    const grouped = new Map<string, DjenComunicacaoLocal[]>();
    const semCliente: DjenComunicacaoLocal[] = [];

    comunicacoesNaoLidas.forEach((comunicacao) => {
      if (!comunicacao.client_id) {
        semCliente.push(comunicacao);
        return;
      }

      const existing = grouped.get(comunicacao.client_id) || [];
      existing.push(comunicacao);
      grouped.set(comunicacao.client_id, existing);
    });

    return { grouped, semCliente };
  }, [comunicacoesNaoLidas, groupByClient, viewMode]);

  const comunicacoesAgrupadasPorProcesso = useMemo(() => {
    if (!groupByProcess || viewMode !== 'local') return null;

    const grouped = new Map<string, DjenComunicacaoLocal[]>();

    comunicacoesNaoLidas.forEach((comunicacao) => {
      const processKey = comunicacao.numero_processo_mascara || comunicacao.numero_processo || 'Sem número de processo';
      const existing = grouped.get(processKey) || [];
      existing.push(comunicacao);
      grouped.set(processKey, existing);
    });

    return grouped;
  }, [comunicacoesNaoLidas, groupByProcess, viewMode]);

  const getClientName = (clientId: string | null) => {
    if (!clientId) return 'Sem cliente';
    const client = clients.find((c) => c.id === clientId);
    return client?.full_name || 'Cliente não encontrado';
  };

  const getProcessCode = (processId: string | null) => {
    if (!processId) return null;
    const process = processes.find((p) => p.id === processId);
    return process?.process_code || null;
  };

  if (loading && comunicacoes.length === 0 && comunicacoesLocais.length === 0) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-slate-600">
            {loadingProgress || 'Consultando DJEN...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {successMessage && (
        <div className="fixed top-6 right-6 z-50 max-w-sm bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 animate-slide-in">
          <div className="flex-1">
            <p className="font-semibold">{successMessage}</p>
            <p className="text-xs text-emerald-100 mt-1">Você pode consultar todas as intimações arquivadas no histórico.</p>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-100 hover:text-white text-sm font-semibold"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Cabeçalho */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              Diário de Justiça Eletrônico Nacional
            </h2>
            <p className="text-sm text-slate-600">
              Consulta de comunicações processuais publicadas
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Nome do Advogado
            </label>
            <input
              type="text"
              value={filtros.nomeAdvogado || ''}
              onChange={(e) => setFiltros({ ...filtros, nomeAdvogado: e.target.value })}
              className="input-field"
              placeholder="Nome completo"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Data Inicial</label>
            <input
              type="date"
              value={filtros.dataDisponibilizacaoInicio || ''}
              onChange={(e) =>
                setFiltros({ ...filtros, dataDisponibilizacaoInicio: e.target.value })
              }
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Data Final</label>
            <input
              type="date"
              value={filtros.dataDisponibilizacaoFim || ''}
              onChange={(e) => setFiltros({ ...filtros, dataDisponibilizacaoFim: e.target.value })}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Tipo</label>
            <select
              value={filtros.meio || 'D'}
              onChange={(e) => setFiltros({ ...filtros, meio: e.target.value as 'D' | 'E' })}
              className="input-field"
            >
              <option value="D">Diário Eletrônico</option>
              <option value="E">Edital</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-4 mt-6">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleBuscar}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 font-medium shadow-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {loading && loadingProgress ? loadingProgress : 'Buscar'}
            </button>
            <button
              onClick={handleLimparFiltros}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium"
            >
              Limpar Filtros
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'api' ? 'local' : 'api')}
              className="px-5 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition font-medium"
            >
              {viewMode === 'api' ? 'Ver Locais' : 'Ver Busca API'}
            </button>
            <button
              onClick={handleBuscarPorProcessosCadastrados}
              disabled={loading || processes.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-medium shadow-sm"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Buscar Processos Cadastrados
            </button>
          </div>
          {viewMode === 'local' && (
            <div className="flex flex-wrap gap-3 pt-3 border-t border-slate-200">
              <button
                onClick={() => {
                  setGroupByClient(!groupByClient);
                  if (!groupByClient) setGroupByProcess(false);
                }}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-medium"
              >
                {groupByClient ? 'Desagrupar' : 'Agrupar por Cliente'}
              </button>
              <button
                onClick={() => {
                  setGroupByProcess(!groupByProcess);
                  if (!groupByProcess) setGroupByClient(false);
                }}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-medium"
              >
                {groupByProcess ? 'Desagrupar' : 'Agrupar por Processo'}
              </button>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setAutoSync(!autoSync)}
                  className={`px-4 py-2 rounded-lg transition text-sm font-medium ${
                    autoSync
                      ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {autoSync ? 'Sync Ativo' : 'Ativar Sync Diário'}
                </button>
                {autoSync && lastSyncStatus && (
                  <div className={`text-[10px] px-2 py-1 rounded ${
                    lastSyncStatus.success
                      ? 'bg-green-50 text-green-700'
                      : 'bg-red-50 text-red-700'
                  }`}>
                    <div className="font-semibold">
                      {lastSyncStatus.success ? '✓' : '✗'} {lastSyncStatus.message}
                    </div>
                    <div className="text-[9px] opacity-75">
                      {new Date(lastSyncStatus.timestamp).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectionMode(!selectionMode);
                  if (selectionMode) setSelectedIds(new Set());
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 border rounded-lg transition text-sm font-medium ${
                  selectionMode
                    ? 'bg-blue-100 border-blue-300 text-blue-800'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {selectionMode ? 'Cancelar Seleção' : 'Selecionar Intimações'}
              </button>
              {selectionMode && (
                <>
                  <button
                    onClick={toggleSelectAll}
                    className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm font-medium"
                  >
                    {selectedIds.size === comunicacoesNaoLidas.length ? 'Desmarcar Todas' : 'Selecionar Todas'}
                  </button>
                  <button
                    onClick={handleMarcarSelecionadasComoLidas}
                    disabled={saving || selectedIds.size === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 text-sm font-medium shadow-sm"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                    Arquivar Selecionadas ({selectedIds.size})
                  </button>
                </>
              )}
              {comunicacoesArquivadas.length > 0 && (
                <button
                  onClick={() => setShowArchived((prev) => !prev)}
                  className={`inline-flex items-center gap-2 px-4 py-2 border rounded-lg transition text-sm font-medium ${
                    showArchived
                      ? 'bg-slate-100 border-slate-300 text-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Archive className="w-4 h-4" />
                  {showArchived ? 'Ocultar Arquivadas' : 'Acessar Intimações Arquivadas'}
                </button>
              )}
            </div>
          )}
        </div>

        {viewMode === 'api' && totalCount > 0 && (
          <div className="mt-4 text-sm text-slate-600">
            <strong>{totalCount}</strong> comunicação(ões) encontrada(s)
          </div>
        )}
        {viewMode === 'local' && (
          <div className="mt-4 text-sm text-slate-600">
            <strong>{comunicacoesNaoLidas.length}</strong> comunicação(ões) ativa(s) localmente
            {comunicacoesArquivadas.length > 0 && (
              <span className="ml-2 text-xs text-slate-500">
                {comunicacoesArquivadas.length} arquivada(s)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Lista de Comunicações - Modo API */}
      {viewMode === 'api' && (
        <>
          <div className="grid grid-cols-1 gap-4">
            {comunicacoes.map((comunicacao) => (
              <div
                key={comunicacao.id}
                className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {comunicacao.siglaTribunal}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        {comunicacao.tipoComunicacao}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatarData(comunicacao.data_disponibilizacao)}
                      </span>
                    </div>

                    <h3 className="font-semibold text-slate-900 mb-2">
                      Processo: {comunicacao.numeroprocessocommascara || comunicacao.numero_processo}
                    </h3>

                    <div className="flex items-center gap-4 text-sm text-slate-600 mb-3">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-4 h-4" />
                        <span>{comunicacao.nomeOrgao}</span>
                      </div>
                      {comunicacao.nomeClasse && (
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-4 h-4" />
                          <span>{comunicacao.nomeClasse}</span>
                        </div>
                      )}
                    </div>

                    <div className={`text-sm text-slate-700 ${expandedItems.has(`api-${comunicacao.id}`) ? '' : 'line-clamp-3'}`}>
                      {comunicacao.texto}
                    </div>
                    <button
                      onClick={() => toggleExpanded(`api-${comunicacao.id}`)}
                      className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
                    >
                      {expandedItems.has(`api-${comunicacao.id}`) ? 'Mostrar menos' : 'Ler tudo'}
                    </button>

                    {comunicacao.destinatarioadvogados.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {comunicacao.destinatarioadvogados.map((dest) => (
                          <span
                            key={dest.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-slate-100 text-slate-700"
                          >
                            <User className="w-3 h-3" />
                            {dest.advogado.nome} - OAB {dest.advogado.numero_oab}/{dest.advogado.uf_oab}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 relative" data-djen-action-menu>
                    <button
                      onClick={() =>
                        setActionMenuOpen((prev) =>
                          prev === `api-${comunicacao.id}` ? null : `api-${comunicacao.id}`,
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      Ações
                    </button>
                    {actionMenuOpen === `api-${comunicacao.id}` && (
                      <div className="absolute top-full right-0 mt-2 w-52 bg-white border border-slate-200 rounded-lg shadow-xl z-10 overflow-hidden">
                        <button
                          onClick={() => handleCriarAcaoDaBusca(comunicacao, 'prazo')}
                          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <AlarmClock className="w-3.5 h-3.5 text-amber-500" />
                          Criar prazo
                        </button>
                        <button
                          onClick={() => handleCriarAcaoDaBusca(comunicacao, 'compromisso')}
                          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <CalendarPlus className="w-3.5 h-3.5 text-emerald-500" />
                          Criar compromisso
                        </button>
                        <button
                          onClick={() => handleCriarAcaoDaBusca(comunicacao, 'audiencia')}
                          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <Gavel className="w-3.5 h-3.5 text-indigo-500" />
                          Criar audiência
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => handleArquivarDaBusca(comunicacao)}
                      disabled={archivingId === String(comunicacao.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-emerald-200 text-emerald-600 rounded-lg hover:bg-emerald-50 transition disabled:opacity-50"
                    >
                      {archivingId === String(comunicacao.id) ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                      {archivingId === String(comunicacao.id) ? 'Arquivando...' : 'Arquivar' }
                    </button>
                    <button
                      onClick={() => handleOpenLinkModal(comunicacao)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg hover:bg-purple-50 transition"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      Vincular
                    </button>
                    {comunicacao.link && (
                      <a
                        href={comunicacao.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ver Diário
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {comunicacoes.length === 0 && !loading && !error && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-3" />
              <p className="text-slate-600">Nenhuma comunicação encontrada</p>
              <p className="text-sm text-slate-500 mt-1">
                Ajuste os filtros e tente novamente
              </p>
            </div>
          )}
        </>
      )}

      {/* Lista de Comunicações - Modo Local */}
      {viewMode === 'local' && !groupByClient && !groupByProcess && (
        <>
          {comunicacoesNaoLidas.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {comunicacoesNaoLidas.map((comunicacao) => renderLocalCard(comunicacao))}
            </div>
          ) : (
            <div className="border border-dashed border-slate-300 rounded-xl p-6 text-sm text-slate-500 text-center">
              Todas as comunicações foram arquivadas. Acesse o histórico pelo botão acima.
            </div>
          )}

          {showArchived && comunicacoesArquivadas.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-slate-600 mb-3">Intimações Arquivadas</h3>
              <div className="grid grid-cols-1 gap-4">
                {comunicacoesArquivadas.map((comunicacao) => renderLocalCard(comunicacao))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Lista Agrupada por Cliente */}
      {viewMode === 'local' && groupByClient && comunicacoesAgrupadas && (
        <div className="flex flex-col gap-6">
          {Array.from(comunicacoesAgrupadas.grouped.entries()).map(([clientId, comuns]) => (
            <div key={clientId} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-4">
                {getClientName(clientId)} ({comuns.length} comunicação(ões))
              </h3>
              <div className="space-y-3">
                {comuns.map((comunicacao) => (
                  <div
                    key={comunicacao.id}
                    className={`border rounded-lg p-4 ${
                      comunicacao.lida ? 'border-gray-200 bg-slate-50' : 'border-blue-200 bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-slate-600">
                            {comunicacao.sigla_tribunal}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatarData(comunicacao.data_disponibilizacao)}
                          </span>
                          {!comunicacao.lida && (
                            <span className="text-xs font-semibold text-red-600">NÃO LIDA</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          {comunicacao.numero_processo_mascara || comunicacao.numero_processo}
                        </p>
                        <p
                          className={`text-xs text-slate-600 mt-1 ${
                            expandedItems.has(`group-${comunicacao.id}`) ? '' : 'line-clamp-2'
                          }`}
                        >
                          {comunicacao.texto}
                        </p>
                        <button
                          onClick={() => toggleExpanded(`group-${comunicacao.id}`)}
                          className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                        >
                          {expandedItems.has(`group-${comunicacao.id}`) ? 'Mostrar menos' : 'Ler tudo'}
                        </button>
                      </div>
                      <button
                        onClick={() => handleMarcarComoLida(comunicacao)}
                        disabled={comunicacao.lida}
                        className="text-xs px-2 py-1 border rounded hover:bg-slate-100 transition disabled:opacity-50"
                      >
                        {comunicacao.lida ? 'Lida' : 'Marcar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {comunicacoesAgrupadas.semCliente.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-4">
                Sem Cliente Vinculado ({comunicacoesAgrupadas.semCliente.length})
              </h3>
              <div className="space-y-3">
                {comunicacoesAgrupadas.semCliente.map((comunicacao) => renderLocalCard(comunicacao))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lista Agrupada por Processo */}
      {viewMode === 'local' && groupByProcess && comunicacoesAgrupadasPorProcesso && (
        <div className="flex flex-col gap-6">
          {Array.from(comunicacoesAgrupadasPorProcesso.entries()).map(([processKey, comuns]) => (
            <div key={processKey} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-4">
                {processKey} ({comuns.length} comunicação(ões))
              </h3>
              <div className="space-y-3">
                {comuns.map((comunicacao) => (
                  <div
                    key={comunicacao.id}
                    className={`border rounded-lg p-4 ${
                      comunicacao.lida ? 'border-gray-200 bg-slate-50' : 'border-blue-200 bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-slate-600">
                            {comunicacao.sigla_tribunal}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatarData(comunicacao.data_disponibilizacao)}
                          </span>
                          {!comunicacao.lida && (
                            <span className="text-xs font-semibold text-red-600">NÃO LIDA</span>
                          )}
                        </div>
                        {comunicacao.client_id && (
                          <p className="text-xs text-slate-600 mb-1">
                            <strong>Cliente:</strong> {getClientName(comunicacao.client_id)}
                          </p>
                        )}
                        {comunicacao.djen_destinatarios && comunicacao.djen_destinatarios.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {comunicacao.djen_destinatarios.map((dest) => (
                              <span
                                key={dest.id}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
                              >
                                {dest.nome}
                              </span>
                            ))}
                          </div>
                        )}
                        <p
                          className={`text-xs text-slate-600 mt-1 ${
                            expandedItems.has(`proc-${comunicacao.id}`) ? '' : 'line-clamp-2'
                          }`}
                        >
                          {comunicacao.texto}
                        </p>
                        <button
                          onClick={() => toggleExpanded(`proc-${comunicacao.id}`)}
                          className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                        >
                          {expandedItems.has(`proc-${comunicacao.id}`) ? 'Mostrar menos' : 'Ler tudo'}
                        </button>
                      </div>
                      <button
                        onClick={() => handleMarcarComoLida(comunicacao)}
                        disabled={comunicacao.lida}
                        className="text-xs px-2 py-1 border rounded hover:bg-slate-100 transition disabled:opacity-50"
                      >
                        {comunicacao.lida ? 'Lida' : 'Marcar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showLinkModal && linkingComunicacao && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowLinkModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">Vincular Comunicação</h3>
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-2 block">
                  Processo: {linkingComunicacao.numeroprocessocommascara || linkingComunicacao.numero_processo}
                </label>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Cliente
                </label>
                <select
                  value={linkClientId}
                  onChange={(e) => setLinkClientId(e.target.value)}
                  className="input-field"
                >
                  <option value="">Selecione um cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Processo Cadastrado
                </label>
                <select
                  value={linkProcessId}
                  onChange={(e) => {
                    const selectedProcessId = e.target.value;
                    setLinkProcessId(selectedProcessId);
                    
                    // Auto-preenche cliente se processo tiver um vinculado
                    if (selectedProcessId) {
                      const selectedProcess = processes.find((p) => p.id === selectedProcessId);
                      if (selectedProcess?.client_id && !linkClientId) {
                        setLinkClientId(selectedProcess.client_id);
                      }
                    }
                  }}
                  className="input-field"
                >
                  <option value="">Selecione um processo</option>
                  {processes.map((process) => {
                    const client = clients.find((c) => c.id === process.client_id);
                    return (
                      <option key={process.id} value={process.id}>
                        {process.process_code} - {client?.full_name || 'Sem cliente'}
                      </option>
                    );
                  })}
                </select>
                {linkProcessId && (() => {
                  const selectedProcess = processes.find((p) => p.id === linkProcessId);
                  const processClient = selectedProcess?.client_id
                    ? clients.find((c) => c.id === selectedProcess.client_id)
                    : null;
                  return processClient ? (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs text-green-800">
                        <strong>✓ Processo vinculado ao cliente:</strong> {processClient.full_name}
                      </p>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowLinkModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveLinks}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar Vínculos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DjenModule;
