import React, { useState, useEffect } from 'react';
import { Plus, Users, User, Building2, ShieldAlert, Search, Filter, Download, Upload, Loader2, Edit, Trash2, AlertTriangle, CheckCircle2, X, Phone, Mail, FileText, Copy, FilePlus, UserPlus, Calendar, ChevronRight, Pencil, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { clientService } from '../services/client.service';
import type { Client, ClientFilters, CreateClientDTO } from '../types/client.types';
import ClientList from './ClientList';
import ClientForm from './ClientForm';
import ClientDetails from './ClientDetails';
import ClientModal from './ClientModal';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';

import { events, SYSTEM_EVENTS } from '../utils/events';

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
  const { confirmDelete } = useDeleteConfirm();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState<{ type: 'none' | 'create' | 'edit' | 'details'; client: Client | null }>({
    type: 'none',
    client: null,
  });
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [formPrefill, setFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);
  const [formContext, setFormContext] = useState<'internal' | 'prefill' | 'param' | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<ClientFilters>({ sort_order: 'newest' });
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
  const [showMissingBanner, setShowMissingBanner] = useState(true);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

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

  // Escutar eventos globais de mudança de clientes
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 ClientsModule: Mudança de clientes detectada, recarregando lista...');
      loadClients();
    });
    
    return () => unsubscribe();
  }, [filters]); // Recarregar respeitando filtros atuais

  useEffect(() => {
    if (!prefillData) return;
    setSelectedClient(null);
    setFormPrefill(prefillData);
    setFormContext((prev) => prev ?? 'prefill');
    setModalState({ type: 'create', client: null });
  }, [prefillData]);

  useEffect(() => {
    if (!forceCreate) return;
    setSelectedClient(null);
    setFormContext('param');
    if (prefillData) {
      setFormPrefill(prefillData);
    }
    setModalState({ type: 'create', client: null });
    if (onParamConsumed) {
      onParamConsumed();
    }
  }, [forceCreate, prefillData, onParamConsumed]);

  useEffect(() => {
    if (!focusClientId) return;

    const openClient = async () => {
      let client = clients.find((item) => item.id === focusClientId) || null;

      if (!client) {
        try {
          client = await clientService.getClientById(focusClientId);
        } catch (error) {
          console.error('Erro ao localizar cliente focalizado:', error);
        }
      }

      if (!client) return;

      setSelectedClient(client);
      setModalState({ type: 'details', client });
      loadClientRelations(client.id);
      if (onParamConsumed) {
        onParamConsumed();
      }
    };

    openClient();
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

  const toggleSelectionMode = () => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedClientIds(new Set());
      }
      return next;
    });
  };

  const toggleSelectedClientId = (clientId: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  const selectAllVisibleClients = () => {
    setSelectedClientIds(new Set(clients.map((c) => c.id)));
  };

  const clearSelectedClients = () => {
    setSelectedClientIds(new Set());
  };

  const deleteSelectedClients = async () => {
    if (selectedClientIds.size === 0) return;

    const confirmed = await confirmDelete({
      title: 'Desativar clientes selecionados',
      message: `Você tem certeza que deseja desativar ${selectedClientIds.size} cliente(s)? Essa ação pode ser revertida reativando o cadastro.`,
      confirmLabel: 'Desativar',
    });
    if (!confirmed) return;

    try {
      setBulkDeleteLoading(true);
      await Promise.all(Array.from(selectedClientIds).map((id) => clientService.deleteClient(id)));
      setSelectedClientIds(new Set());
      setSelectionMode(false);
      loadClients();
    } catch (error) {
      console.error('Erro ao desativar clientes selecionados:', error);
      alert('Erro ao desativar clientes selecionados');
    } finally {
      setBulkDeleteLoading(false);
    }
  };

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

  const openCreateModal = (context: 'internal' | 'prefill' | 'param' = 'internal', prefill?: Partial<CreateClientDTO> | null) => {
    setSelectedClient(null);
    setFormContext(context);
    setFormPrefill(prefill ?? null);
    setModalState({ type: 'create', client: null });
  };

  const openEditModal = (client: Client) => {
    setSelectedClient(client);
    setFormContext('internal');
    setFormPrefill(null);
    setModalState({ type: 'edit', client });
  };

  const openDetailsModal = (client: Client) => {
    setSelectedClient(client);
    setModalState({ type: 'details', client });
    loadClientRelations(client.id);
  };

  // Criar novo cliente
  const handleNewClient = () => openCreateModal('internal');

  // Editar cliente
  const handleEditClient = (client: Client) => openEditModal(client);

  // Ver detalhes do cliente
  const handleViewClient = (client: Client) => openDetailsModal(client);

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
    const client = clients.find((c) => c.id === id);
    const confirmed = await confirmDelete({
      title: 'Desativar cliente',
      entityName: client?.full_name || undefined,
      message: 'Tem certeza que deseja desativar este cliente? Essa ação pode ser revertida reativando o cadastro.',
      confirmLabel: 'Desativar',
    });
    if (!confirmed) return;

    try {
      await clientService.deleteClient(id);
      loadClients();
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
      alert('Erro ao deletar cliente');
    }
  };

  const hasActiveFilters = Boolean(filters.status || filters.client_type || filters.search) || filters.sort_order === 'oldest' || showIncompleteOnly;

  const isFormModalOpen = modalState.type === 'create' || modalState.type === 'edit';
  const isDetailsModalOpen = modalState.type === 'details' && Boolean(selectedClient);

  const closeFormModal = (triggerCancel = false) => {
    setModalState({ type: 'none', client: null });
    setFormPrefill(null);
    setFormContext(null);
    if (triggerCancel && onClientCancelled) {
      onClientCancelled();
    }
  };

  const closeDetailsModal = () => {
    setModalState({ type: 'none', client: null });
    setSelectedClient(null);
    setClientProcesses([]);
    setClientRequirements([]);
  };

  const handleFormSaved = (savedClient: Client) => {
    loadClients();
    setSelectedClient(savedClient);
    setModalState({ type: 'details', client: savedClient });
    loadClientRelations(savedClient.id);
    if (onClientSaved) {
      onClientSaved();
    }
  };

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
                <Users className="w-6 h-6 text-blue-600" />
                Gestão de Clientes
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Cadastro e gerenciamento de clientes
              </p>
            </div>
            <button
              onClick={handleNewClient}
              className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 transition-colors px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm shadow-orange-500/30"
            >
              <Plus className="w-4 h-4" />
              Novo Cliente
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          <div className="bg-white border border-slate-200 rounded-lg p-2.5 sm:p-3 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-medium text-slate-600 uppercase">Total</span>
              <User className="w-4 h-4 text-slate-600" />
            </div>
            <p className="text-lg sm:text-xl font-semibold text-slate-900">{stats.total}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-2.5 sm:p-3 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] sm:text-xs font-medium text-emerald-600 uppercase">Ativos</span>
              <UserPlus className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-lg sm:text-xl font-semibold text-emerald-600">{stats.active}</p>
          </div>
          <div className="hidden sm:block bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-blue-600 uppercase">P. Física</span>
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xl font-semibold text-blue-600">{stats.pessoaFisica}</p>
          </div>
          <div className="hidden sm:block bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-purple-600 uppercase">P. Jurídica</span>
              <Building2 className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-xl font-semibold text-purple-600">{stats.pessoaJuridica}</p>
          </div>
          <div className="hidden sm:block bg-white border border-slate-200 rounded-lg p-3 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-amber-600 uppercase">Incompletos</span>
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-xl font-semibold text-amber-600">{stats.incomplete}</p>
          </div>
        </div>

        {/* Warnings */}
        {(missingFieldsMap.size > 0 || outdatedSet.size > 0) && (
          <div className="space-y-2">
            {missingFieldsMap.size > 0 && showMissingBanner && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-start gap-3 flex-1">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Cadastros com dados obrigatórios pendentes</p>
                    <p className="text-xs mt-1">
                      Identificamos {missingFieldsMap.size} cliente(s) com informações essenciais ausentes. Complete os dados para garantir consistência.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                  {!showIncompleteOnly && (
                    <button
                      onClick={() => setShowIncompleteOnly(true)}
                      className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-200/70 hover:bg-amber-200 rounded-md transition-colors"
                    >
                      Mostrar incompletos
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowMissingBanner(false)}
                    className="ml-auto text-amber-700 hover:text-amber-900 text-xs font-semibold px-2 py-1 rounded-md hover:bg-amber-100 transition-colors"
                    aria-label="Fechar aviso de cadastros incompletos"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            {outdatedSet.size > 0 && (
              <div className="bg-sky-50 border border-sky-200 text-sky-800 px-4 py-2.5 rounded-lg flex items-start gap-3">
                <Clock className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-sm">Cadastros desatualizados</p>
                  <p className="text-xs mt-1">
                    Encontramos {outdatedSet.size} cliente(s) com última atualização superior a {OUTDATED_THRESHOLD_DAYS} dias.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs sm:text-sm text-slate-600">Buscar e filtrar clientes</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectionMode}
                className={`inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  selectionMode
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Selecionar
              </button>

              <button
                type="button"
                onClick={() => setShowFilters((prev) => !prev)}
                className="text-xs sm:text-sm font-medium text-blue-600 hover:text-blue-700 underline-offset-2 hover:underline"
              >
                {showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Buscar Cliente</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    placeholder="Nome, CPF, e-mail..."
                  />
                </div>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="">Todos</option>
                  <option value="ativo">Ativos</option>
                  <option value="inativo">Inativos</option>
                  <option value="suspenso">Suspensos</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo</label>
                <select
                  value={filters.client_type || ''}
                  onChange={(e) => setFilters({ ...filters, client_type: e.target.value as any })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="">Todos</option>
                  <option value="pessoa_fisica">Pessoa Física</option>
                  <option value="pessoa_juridica">Pessoa Jurídica</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Ordenação</label>
                <select
                  value={filters.sort_order || 'newest'}
                  onChange={(e) => setFilters({ ...filters, sort_order: (e.target.value as any) || 'newest' })}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="newest">Mais novos</option>
                  <option value="oldest">Mais antigos</option>
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-2 flex items-end gap-2">
                <label className="flex-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg px-3 py-1.5 bg-white cursor-pointer transition">
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
                  className="flex-1 inline-flex items-center justify-center gap-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:border-emerald-300 disabled:text-emerald-400 bg-white font-medium px-3 py-2 rounded-lg shadow-sm transition disabled:cursor-not-allowed"
                  title="Exportar para Excel"
                >
                  {exporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
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
          )}
        </div>

        {selectionMode && (
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-slate-600">
                <span className="text-slate-500">Dica: use “Selecionar” para desativar vários clientes.</span>
                <span className="text-slate-400"> · </span>
                <span className="font-semibold text-slate-900">{selectedClientIds.size}</span> selecionado(s)
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500">Visíveis ({clients.length})</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleSelectionMode}
                  className="inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                >
                  Selecionar
                </button>
                <button
                  type="button"
                  onClick={selectAllVisibleClients}
                  disabled={clients.length === 0}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={clearSelectedClients}
                  disabled={selectedClientIds.size === 0}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSelectedClients()}
                  disabled={selectedClientIds.size === 0 || bulkDeleteLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {bulkDeleteLoading ? 'Desativando...' : 'Desativar selecionados'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Client List */}
        <ClientList
          clients={clients}
          loading={loading}
          missingFieldsMap={missingFieldsMap}
          outdatedSet={outdatedSet}
          isFiltered={hasActiveFilters}
          selectionMode={selectionMode}
          selectedIds={selectedClientIds}
          onToggleSelected={toggleSelectedClientId}
          onView={handleViewClient}
          onEdit={handleEditClient}
          onDelete={handleDeleteClient}
        />
      </div>

      {/* Form Modal */}
      {isFormModalOpen && (
        <ClientModal
          isOpen={isFormModalOpen}
          onClose={() => closeFormModal(true)}
          title={modalState.type === 'edit' ? 'Editar Cliente' : 'Novo Cliente'}
          subtitle={formContext === 'prefill' ? 'Dados pré-preenchidos automaticamente' : undefined}
          size="xl"
        >
          <div className="p-4">
            <ClientForm
              client={modalState.client}
              prefill={modalState.type === 'create' ? formPrefill : null}
              onBack={() => closeFormModal(true)}
              onSave={handleFormSaved}
              variant="modal"
            />
          </div>
        </ClientModal>
      )}

      {/* Details Modal */}
      {isDetailsModalOpen && selectedClient && (
        <ClientModal
          isOpen={isDetailsModalOpen}
          onClose={closeDetailsModal}
          title={selectedClient.full_name}
          subtitle="Detalhes do cliente"
          size="xl"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  closeDetailsModal();
                  handleEditClient(selectedClient);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
              >
                <Edit className="w-4 h-4" />
                Editar
              </button>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition"
              >
                Fechar
              </button>
            </div>
          }
        >
          <div className="p-4">
            <ClientDetails
              client={selectedClient}
              processes={clientProcesses}
              requirements={clientRequirements}
              relationsLoading={relationsLoading}
              onBack={closeDetailsModal}
              onEdit={() => {
                closeDetailsModal();
                handleEditClient(selectedClient);
              }}
              onCreateProcess={() => {
                if (onNavigateToModule) {
                  onNavigateToModule('processos', {
                    mode: 'create',
                    prefill: {
                      client_id: selectedClient.id,
                      client_name: selectedClient.full_name,
                    },
                  });
                }
              }}
              onCreateRequirement={() => {
                if (onNavigateToModule) {
                  onNavigateToModule('requerimentos', {
                    mode: 'create',
                    prefill: {
                      client_id: selectedClient.id,
                      beneficiary: selectedClient.full_name,
                      cpf: selectedClient.cpf_cnpj || '',
                    },
                  });
                }
              }}
              onCreateDeadline={() => {
                if (onNavigateToModule) {
                  onNavigateToModule('prazos', {
                    mode: 'create',
                    prefill: {
                      client_id: selectedClient.id,
                      client_name: selectedClient.full_name,
                    },
                  });
                }
              }}
              missingFields={missingFieldsMap?.get(selectedClient.id)}
              isOutdated={outdatedSet?.has(selectedClient.id)}
            />
          </div>
        </ClientModal>
      )}
    </>
  );
};

export default ClientsModule;
