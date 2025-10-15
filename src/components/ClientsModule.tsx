import React, { useState, useEffect } from 'react';
import { Plus, Search, UserPlus, Building2, User, Users, Download, AlertTriangle, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { clientService } from '../services/client.service';
import type { Client, ClientFilters, CreateClientDTO } from '../types/client.types';
import ClientList from './ClientList';
import ClientForm from './ClientForm';
import ClientDetails from './ClientDetails';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';

type ViewMode = 'list' | 'form' | 'details';

interface ClientsModuleProps {
  prefillData?: Partial<CreateClientDTO> | null;
  onClientSaved?: () => void;
  onClientCancelled?: () => void;
  forceCreate?: boolean;
  onParamConsumed?: () => void;
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
  focusClientId?: string;
}

const isBlank = (value?: string | null) => !value || !String(value).trim();
const OUTDATED_THRESHOLD_DAYS = 180;

const isOutdatedRecord = (client: Client) => {
  if (!client.updated_at) return true;
  const updatedAt = new Date(client.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return true;
  const threshold = Date.now() - OUTDATED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return updatedAt.getTime() < threshold;
};

const getMissingFields = (client: Client): string[] => {
  const missing: string[] = [];

  if (isBlank(client.full_name)) missing.push('Nome completo');
  if (isBlank(client.cpf_cnpj)) missing.push('CPF/CNPJ');
  if (isBlank(client.marital_status)) missing.push('Estado civil');
  if (isBlank(client.profession)) missing.push('Profissão');
  if (isBlank(client.address_street)) missing.push('Logradouro');
  if (isBlank(client.address_number)) missing.push('Número');
  if (isBlank(client.address_city)) missing.push('Cidade');
  if (isBlank(client.address_state)) missing.push('Estado');
  if (isBlank(client.address_zip_code)) missing.push('CEP');

  return missing;
};

const ClientsModule: React.FC<ClientsModuleProps> = ({
  prefillData,
  onClientSaved,
  onClientCancelled,
  forceCreate,
  onParamConsumed,
  onNavigateToModule,
  focusClientId,
}) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<ClientFilters>({});
  const [exporting, setExporting] = useState(false);
  const [clientProcesses, setClientProcesses] = useState<Process[]>([]);
  const [clientRequirements, setClientRequirements] = useState<Requirement[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    pessoaFisica: 0,
    pessoaJuridica: 0,
    incomplete: 0,
    outdated: 0,
  });
  const [missingFieldsMap, setMissingFieldsMap] = useState<Map<string, string[]>>(new Map());
  const [outdatedSet, setOutdatedSet] = useState<Set<string>>(new Set());
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(false);

  // Carregar clientes
  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await clientService.listClients(filters);

      const missing = new Map<string, string[]>();
      const outdated = new Set<string>();
      data.forEach((client) => {
        const missingFields = getMissingFields(client);
        if (missingFields.length > 0) {
          missing.set(client.id, missingFields);
        }
        if (isOutdatedRecord(client)) {
          outdated.add(client.id);
        }
      });
      // Atualizar estatísticas (totais)
      const total = await clientService.countClients();
      const active = await clientService.countClients({ status: 'ativo' });
      const pessoaFisica = await clientService.countClients({ client_type: 'pessoa_fisica' });
      const pessoaJuridica = await clientService.countClients({ client_type: 'pessoa_juridica' });

      const visibleClients = showIncompleteOnly ? data.filter((client) => missing.has(client.id)) : data;
      setClients(visibleClients);

      setMissingFieldsMap(missing);
      setOutdatedSet(outdated);

      setStats({
        total,
        active,
        pessoaFisica,
        pessoaJuridica,
        incomplete: missing.size,
        outdated: outdated.size,
      });
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [filters, showIncompleteOnly]);

  useEffect(() => {
    if (prefillData) {
      setSelectedClient(null);
      setViewMode('form');
    }
  }, [prefillData]);

  useEffect(() => {
    if (forceCreate && viewMode === 'list') {
      setSelectedClient(null);
      setViewMode('form');
      if (onParamConsumed) {
        onParamConsumed();
      }
    }
  }, [forceCreate, viewMode, onParamConsumed]);

  useEffect(() => {
    if (!focusClientId) return;
    const client = clients.find((item) => item.id === focusClientId);
    if (!client) return;

    setSelectedClient(client);
    setViewMode('details');
    loadClientRelations(client.id);
    if (onParamConsumed) {
      onParamConsumed();
    }
  }, [focusClientId, clients, onParamConsumed]);

  // Buscar clientes
  const handleSearch = () => {
    setFilters((prev) => ({
      ...prev,
      search: searchTerm.trim(),
    }));
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      const trimmed = searchTerm.trim();

      setFilters((prev) => {
        const prevHasSearch = typeof prev.search === 'string' && prev.search.length > 0;

        if (!trimmed && !prevHasSearch) {
          return prev;
        }

        if (trimmed && prev.search === trimmed) {
          return prev;
        }

        if (!trimmed) {
          const { search: _search, ...rest } = prev;
          return rest;
        }

        return {
          ...prev,
          search: trimmed,
        };
      });
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm]);

  const loadClientRelations = async (clientId: string) => {
    try {
      setRelationsLoading(true);
      const [processData, requirementData] = await Promise.all([
        processService.listProcesses({ client_id: clientId }),
        requirementService.listRequirements({ client_id: clientId }),
      ]);
      setClientProcesses(processData);
      setClientRequirements(requirementData);
    } catch (error) {
      console.error('Erro ao carregar dados relacionados ao cliente:', error);
      setClientProcesses([]);
      setClientRequirements([]);
    } finally {
      setRelationsLoading(false);
    }
  };

  // Criar novo cliente
  const handleNewClient = () => {
    setSelectedClient(null);
    setViewMode('form');
  };

  // Editar cliente
  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setViewMode('form');
  };

  // Ver detalhes do cliente
  const handleViewClient = (client: Client) => {
    setSelectedClient(client);
    setViewMode('details');
    loadClientRelations(client.id);
  };

  // Voltar para lista
  const handleBackToList = (saved: boolean = false) => {
    setViewMode('list');
    setSelectedClient(null);
    setClientProcesses([]);
    setClientRequirements([]);
    loadClients();
    
    // Notificar App.tsx sobre o resultado
    if (saved && onClientSaved) {
      onClientSaved();
    } else if (!saved && onClientCancelled) {
      onClientCancelled();
    }
  };

  const handleExportToExcel = async () => {
    try {
      setExporting(true);
      
      // Buscar todos os clientes para exportação
      const allClients = await clientService.listClients({});
      
      // Preparar dados para o Excel
      const exportData = allClients.map((client) => {
        const primaryPhone = client.phone || client.mobile || '';
        return {
          Nome: client.full_name,
          Email: client.email || '',
          'Telefone / WhatsApp': primaryPhone,
          CPF_CNPJ: client.cpf_cnpj || '',
          RG: client.rg || '',
          'Data de Nascimento': client.birth_date || '',
          Nacionalidade: client.nationality || '',
          Profissão: client.profession || '',
          Tipo: client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica',
          Status: client.status,
          CEP: client.address_zip_code || '',
          Endereço: `${client.address_street || ''} ${client.address_number || ''}`.trim(),
          Complemento: client.address_complement || '',
          Bairro: client.address_neighborhood || '',
          Cidade: client.address_city || '',
          Estado: client.address_state || '',
          Observações: client.notes || '',
          'Criado em': new Date(client.created_at).toLocaleDateString('pt-BR'),
          'Atualizado em': new Date(client.updated_at).toLocaleDateString('pt-BR'),
        };
      });
      
      // Criar workbook e worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Configurar largura das colunas
      const colWidths = [
        { wch: 25 }, // Nome
        { wch: 25 }, // Email
        { wch: 17 }, // Telefone / WhatsApp
        { wch: 15 }, // CPF/CNPJ
        { wch: 12 }, // RG
        { wch: 15 }, // Data de Nascimento
        { wch: 15 }, // Nacionalidade
        { wch: 20 }, // Profissão
        { wch: 12 }, // Tipo
        { wch: 10 }, // Status
        { wch: 10 }, // CEP
        { wch: 30 }, // Endereço
        { wch: 15 }, // Complemento
        { wch: 20 }, // Bairro
        { wch: 20 }, // Cidade
        { wch: 8 },  // Estado
        { wch: 30 }, // Observações
        { wch: 12 }, // Criado em
        { wch: 12 }, // Atualizado em
      ];
      ws['!cols'] = colWidths;
      
      // Adicionar worksheet ao workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
      
      // Gerar nome do arquivo com data atual
      const today = new Date();
      const fileName = `clientes_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.xlsx`;
      
      // Baixar arquivo
      XLSX.writeFile(wb, fileName);
      
    } catch (error) {
      console.error('Erro ao exportar clientes:', error);
      alert('Erro ao exportar clientes. Tente novamente.');
    } finally {
      setExporting(false);
    }
  };

  // Deletar cliente
  const handleDeleteClient = async (id: string) => {
    if (confirm('Tem certeza que deseja desativar este cliente?')) {
      try {
        await clientService.deleteClient(id);
        loadClients();
      } catch (error) {
        console.error('Erro ao deletar cliente:', error);
        alert('Erro ao deletar cliente');
      }
    }
  };

  const hasActiveFilters = Boolean(filters.status || filters.client_type || filters.search) || showIncompleteOnly;

  return (
    <div className="space-y-6">
      {/* Header Moderno com Gradiente */}
      {viewMode === 'list' && (
        <div className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 rounded-2xl shadow-2xl overflow-hidden">
          {/* Padrão de fundo decorativo */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40"></div>
          
          {/* Efeito de brilho */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
          
          <div className="relative p-5">
            {/* Título e Ações */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-11 h-11 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">Gestão de Clientes</h3>
                  <p className="text-xs text-blue-200">
                    Gerencie todos os seus clientes
                  </p>
                </div>
              </div>

              <button
                onClick={handleNewClient}
                className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold px-6 py-2.5 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">Novo Cliente</span>
              </button>
            </div>

            {/* Cards de Estatísticas */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-md border border-white/20 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-600 text-[10px] font-bold uppercase tracking-wide">Total</p>
                    <p className="text-2xl font-black text-slate-900 mt-0.5">{stats.total}</p>
                  </div>
                  <div className="w-9 h-9 bg-gradient-to-br from-slate-100 to-slate-200 rounded-lg flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-700" />
                  </div>
                </div>
              </div>

              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-md border border-white/20 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-emerald-600 text-[10px] font-bold uppercase tracking-wide">Ativos</p>
                    <p className="text-2xl font-black text-emerald-600 mt-0.5">{stats.active}</p>
                  </div>
                  <div className="w-9 h-9 bg-gradient-to-br from-emerald-100 to-emerald-200 rounded-lg flex items-center justify-center">
                    <UserPlus className="w-4 h-4 text-emerald-700" />
                  </div>
                </div>
              </div>

              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-md border border-white/20 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-600 text-[10px] font-bold uppercase tracking-wide">P. Física</p>
                    <p className="text-2xl font-black text-blue-600 mt-0.5">{stats.pessoaFisica}</p>
                  </div>
                  <div className="w-9 h-9 bg-gradient-to-br from-blue-100 to-blue-200 rounded-lg flex items-center justify-center">
                    <User className="w-4 h-4 text-blue-700" />
                  </div>
                </div>
              </div>

              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-md border border-white/20 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-600 text-[10px] font-bold uppercase tracking-wide">P. Jurídica</p>
                    <p className="text-2xl font-black text-purple-600 mt-0.5">{stats.pessoaJuridica}</p>
                  </div>
                  <div className="w-9 h-9 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-purple-700" />
                  </div>
                </div>
              </div>

              <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 shadow-md border border-white/20 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-amber-600 text-[10px] font-bold uppercase tracking-wide">Incompletos</p>
                    <p className="text-2xl font-black text-amber-600 mt-0.5">{stats.incomplete}</p>
                  </div>
                  <div className="w-9 h-9 bg-gradient-to-br from-amber-100 to-amber-200 rounded-lg flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                  </div>
                </div>
              </div>
            </div>

            {/* Barra de Filtros e Busca */}
            <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3.5 shadow-lg border border-white/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                {/* Busca */}
                <div className="sm:col-span-2 lg:col-span-4">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    🔍 Buscar Cliente
                  </label>
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 w-4 h-4 transition-colors" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                      className="w-full pl-10 pr-3 py-2 rounded-lg border-2 border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm hover:shadow-md"
                      placeholder="Nome, CPF, e-mail..."
                    />
                  </div>
                </div>

                {/* Filtro de Status */}
                <div className="lg:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    📊 Status
                  </label>
                  <select
                    value={filters.status || ''}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 bg-white text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm hover:shadow-md cursor-pointer"
                  >
                    <option value="">Todos</option>
                    <option value="ativo">✅ Ativos</option>
                    <option value="inativo">❌ Inativos</option>
                    <option value="suspenso">⏸️ Suspensos</option>
                  </select>
                </div>

                {/* Filtro de Tipo */}
                <div className="lg:col-span-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    👤 Tipo
                  </label>
                  <select
                    value={filters.client_type || ''}
                    onChange={(e) => setFilters({ ...filters, client_type: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 bg-white text-sm text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-sm hover:shadow-md cursor-pointer"
                  >
                    <option value="">Todos</option>
                    <option value="pessoa_fisica">👤 Pessoa Física</option>
                    <option value="pessoa_juridica">🏢 Pessoa Jurídica</option>
                  </select>
                </div>

                {/* Ações */}
                <div className="sm:col-span-2 lg:col-span-4 flex items-end gap-2">
                  <label className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-bold text-slate-700 border-2 border-slate-300 hover:border-slate-400 rounded-lg px-3 py-2 bg-white cursor-pointer transition-all shadow-sm hover:shadow-md">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                      checked={showIncompleteOnly}
                      onChange={(e) => setShowIncompleteOnly(e.target.checked)}
                    />
                    <span className="text-xs">Incompletos</span>
                  </label>

                  <button
                    onClick={handleExportToExcel}
                    disabled={exporting}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 disabled:from-emerald-400 disabled:to-emerald-500 text-white font-bold px-3 py-2 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 disabled:cursor-not-allowed transform hover:-translate-y-0.5 disabled:transform-none"
                    title="Exportar para Excel"
                  >
                    {exporting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs">Gerando...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span className="text-xs">Excel</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'list' && (missingFieldsMap.size > 0 || outdatedSet.size > 0) && (
        <div className="space-y-2">
          {missingFieldsMap.size > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Cadastros com dados obrigatórios pendentes</p>
                  <p className="text-xs mt-1">Identificamos {missingFieldsMap.size} cliente(s) com informações essenciais ausentes. Complete os dados para garantir consistência.</p>
                </div>
              </div>
              {!showIncompleteOnly && (
                <button
                  onClick={() => setShowIncompleteOnly(true)}
                  className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-200/70 hover:bg-amber-200 rounded-md transition-colors"
                >
                  Mostrar incompletos
                </button>
              )}
            </div>
          )}
          {outdatedSet.size > 0 && (
            <div className="bg-sky-50 border border-sky-200 text-sky-800 px-4 py-2.5 rounded-lg flex items-start gap-3">
              <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Cadastros desatualizados</p>
                <p className="text-xs mt-1">Encontramos {outdatedSet.size} cliente(s) com última atualização superior a {OUTDATED_THRESHOLD_DAYS} dias.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conteúdo principal */}
      {viewMode === 'list' && (
        <ClientList
          clients={clients}
          loading={loading}
          missingFieldsMap={missingFieldsMap}
          outdatedSet={outdatedSet}
          isFiltered={hasActiveFilters}
          onView={handleViewClient}
          onEdit={handleEditClient}
          onDelete={handleDeleteClient}
        />
      )}

      {viewMode === 'form' && (
        <ClientForm
          client={selectedClient}
          prefill={!selectedClient ? prefillData : null}
          onBack={() => handleBackToList(false)}
          onSave={(savedClient) => {
            setSelectedClient(savedClient);
            setViewMode('details');
            loadClientRelations(savedClient.id);
            if (onClientSaved) {
              onClientSaved();
            }
          }}
        />
      )}

      {viewMode === 'details' && selectedClient && (
        <ClientDetails
          client={selectedClient}
          processes={clientProcesses}
          requirements={clientRequirements}
          relationsLoading={relationsLoading}
          onBack={handleBackToList}
          onEdit={() => handleEditClient(selectedClient)}
          onCreateProcess={onNavigateToModule ? () => {
            onNavigateToModule('cases', {
              mode: 'create',
              prefill: {
                client_id: selectedClient.id,
                client_name: selectedClient.full_name,
              },
            });
          } : undefined}
          onCreateRequirement={onNavigateToModule ? () => {
            onNavigateToModule('requirements', {
              mode: 'create',
              prefill: {
                client_id: selectedClient.id,
                beneficiary: selectedClient.full_name,
                cpf: selectedClient.cpf_cnpj,
              },
            });
          } : undefined}
          onCreateDeadline={onNavigateToModule ? () => {
            onNavigateToModule('deadlines', {
              mode: 'create',
              prefill: {
                client_id: selectedClient.id,
                client_name: selectedClient.full_name,
              },
            });
          } : undefined}
          missingFields={missingFieldsMap.get(selectedClient.id) || getMissingFields(selectedClient)}
          isOutdated={outdatedSet.has(selectedClient.id)}
        />
      )}
    </div>
  );
};

export default ClientsModule;
