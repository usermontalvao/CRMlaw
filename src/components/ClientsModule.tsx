import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, Users, User, Building2, ShieldAlert, Search, Filter, Download, Upload, Loader2, Edit, Trash2, AlertTriangle, CheckCircle2, X, Phone, Mail, FileText, Copy, FilePlus, UserPlus, Calendar, ChevronRight, Pencil, Clock, Merge } from 'lucide-react';
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
import { buildDuplicateGroups, buildDuplicateSummaryMap, pickPrimaryClient, type DuplicateGroup } from '../utils/clientDuplicates';
import { useSelectionState } from '../hooks/useSelectionState';
import { getClientMissingFields, isOutdatedClientRecord, OUTDATED_THRESHOLD_DAYS } from '../utils/clientQuality';

interface ClientsModuleProps {
  prefillData?: Partial<CreateClientDTO> | null;
  onClientSaved?: () => void;
  onClientCancelled?: () => void;
  forceCreate?: boolean;
  onParamConsumed?: () => void;
  onNavigateToModule?: (moduleKey: string, params?: any) => void;
  focusClientId?: string;
}

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
  const [allClients, setAllClients] = useState<Client[]>([]);
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
  const [showDuplicateBanner, setShowDuplicateBanner] = useState(true);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);

  // Manual merge modal state
  const [showManualMerge, setShowManualMerge] = useState(false);
  const [manualMergeSearch, setManualMergeSearch] = useState('');
  const [manualMergeResults, setManualMergeResults] = useState<Client[]>([]);
  const [manualMergeSearching, setManualMergeSearching] = useState(false);
  const [manualMergeSelected, setManualMergeSelected] = useState<Client[]>([]);
  const [manualMergePrimaryId, setManualMergePrimaryId] = useState<string>('');
  const [manualMergeLoading, setManualMergeLoading] = useState(false);
  const manualMergeSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    selectionMode,
    selectedIds: selectedClientIds,
    toggleSelectionMode,
    toggleSelectedId,
    selectIds,
    clearSelectedIds,
    replaceSelection,
    disableSelectionMode,
  } = useSelectionState<string>();

  const duplicateGroups = useMemo(() => buildDuplicateGroups(allClients), [allClients]);
  const duplicateSummaryMap = useMemo(() => buildDuplicateSummaryMap(duplicateGroups), [duplicateGroups]);
  const duplicateClientIds = useMemo(() => new Set(duplicateGroups.flatMap((group) => group.clientIds)), [duplicateGroups]);
  const visibleDuplicateIds = useMemo(() => new Set(clients.filter((client) => duplicateClientIds.has(client.id)).map((client) => client.id)), [clients, duplicateClientIds]);
  const selectedDuplicateGroups = useMemo(() => {
    return duplicateGroups
      .map((group) => ({
        group,
        selectedIds: group.clientIds.filter((id) => selectedClientIds.has(id)),
      }))
      .filter((item) => item.selectedIds.length >= 2);
  }, [duplicateGroups, selectedClientIds]);

  // Carregar clientes
  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await clientService.listClients(filters);
      setAllClients(data);

      const missing = new Map<string, string[]>();
      const outdated = new Set<string>();
      data.forEach((client) => {
        const missingFields = getClientMissingFields(client);
        if (missingFields.length > 0) {
          missing.set(client.id, missingFields);
        }
        if (isOutdatedClientRecord(client)) {
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

  const selectAllVisibleClients = () => {
    selectIds(clients.map((c) => c.id));
  };

  const selectAllDuplicateClients = () => {
    replaceSelection(visibleDuplicateIds, { enableSelectionMode: true });
  };

  const executeMergeGroups = async (groups: Array<{ group: DuplicateGroup; selectedIds?: string[] }>, label: string) => {
    if (groups.length === 0) {
      alert('Nenhum grupo de duplicados disponível para mesclar.');
      return;
    }

    const confirmed = window.confirm(`Deseja ${label} ${groups.length} grupo(s) de contatos duplicados? Os campos vazios do contato principal serão preenchidos com os dados dos demais.`);
    if (!confirmed) return;

    try {
      setMergeLoading(true);
      for (const item of groups) {
        const groupClients = item.selectedIds?.length
          ? item.group.clients.filter((client) => item.selectedIds?.includes(client.id))
          : item.group.clients;
        if (groupClients.length < 2) continue;

        const primary = pickPrimaryClient(groupClients);
        const sourceIds = groupClients.filter((client) => client.id !== primary.id).map((client) => client.id);
        if (sourceIds.length === 0) continue;

        await clientService.mergeClients(primary.id, sourceIds);
      }

      disableSelectionMode();
      await loadClients();
    } catch (error: any) {
      console.error('Erro ao mesclar clientes duplicados:', error);
      alert(error?.message || 'Erro ao mesclar contatos duplicados');
    } finally {
      setMergeLoading(false);
    }
  };

  const handleMergeAllDuplicates = async () => {
    await executeMergeGroups(duplicateGroups.map((group) => ({ group })), 'mesclar');
  };

  const handleMergeSelectedDuplicates = async () => {
    await executeMergeGroups(selectedDuplicateGroups, 'mesclar os selecionados de');
  };

  // Manual merge helpers
  const openManualMerge = () => {
    setManualMergeSearch('');
    setManualMergeResults([]);
    setManualMergeSelected([]);
    setManualMergePrimaryId('');
    setShowManualMerge(true);
  };

  const handleManualMergeSearchChange = useCallback((term: string) => {
    setManualMergeSearch(term);
    if (manualMergeSearchRef.current) clearTimeout(manualMergeSearchRef.current);
    if (!term.trim()) { setManualMergeResults([]); return; }
    setManualMergeSearching(true);
    manualMergeSearchRef.current = setTimeout(async () => {
      try {
        const results = await clientService.searchClients(term.trim(), 20);
        // Fetch full client objects so we have all fields for merge
        const fullClients = await Promise.all(
          results.map((r) => clientService.getClientById(r.id))
        );
        setManualMergeResults(fullClients.filter(Boolean) as Client[]);
      } catch {
        setManualMergeResults([]);
      } finally {
        setManualMergeSearching(false);
      }
    }, 300);
  }, []);

  const toggleManualMergeClient = (client: Client) => {
    setManualMergeSelected((prev) => {
      const exists = prev.find((c) => c.id === client.id);
      const next = exists ? prev.filter((c) => c.id !== client.id) : [...prev, client];
      // Auto-assign primary if not yet set or removed
      if (!manualMergePrimaryId || !next.find((c) => c.id === manualMergePrimaryId)) {
        setManualMergePrimaryId(next[0]?.id ?? '');
      }
      return next;
    });
  };

  const executeManualMerge = async () => {
    if (manualMergeSelected.length < 2 || !manualMergePrimaryId) return;
    const sourceIds = manualMergeSelected.filter((c) => c.id !== manualMergePrimaryId).map((c) => c.id);
    if (sourceIds.length === 0) return;
    setManualMergeLoading(true);
    try {
      await clientService.mergeClients(manualMergePrimaryId, sourceIds);
      setShowManualMerge(false);
      await loadClients();
    } catch (err: any) {
      alert(err?.message || 'Erro ao mesclar contatos');
    } finally {
      setManualMergeLoading(false);
    }
  };

  const deleteSelectedClients = async () => {
    if (selectedClientIds.size === 0) return;

    const confirmed = await confirmDelete({
      title: 'Excluir clientes selecionados',
      message: `Você tem certeza que deseja excluir ${selectedClientIds.size} cliente(s)? Essa ação removerá os cadastros permanentemente.`,
      confirmLabel: 'Excluir',
    });
    if (!confirmed) return;

    try {
      setBulkDeleteLoading(true);
      await Promise.all(Array.from(selectedClientIds).map((id) => clientService.deleteClient(id)));
      disableSelectionMode();
      loadClients();
    } catch (error) {
      console.error('Erro ao excluir clientes selecionados:', error);
      alert('Erro ao excluir clientes selecionados');
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
      title: 'Excluir cliente',
      entityName: client?.full_name || undefined,
      message: 'Tem certeza que deseja excluir este cliente? Essa ação removerá o cadastro permanentemente.',
      confirmLabel: 'Excluir',
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
        {(missingFieldsMap.size > 0 || outdatedSet.size > 0 || duplicateGroups.length > 0) && (
          <div className="space-y-2">
            {duplicateGroups.length > 0 && showDuplicateBanner && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2.5 rounded-lg flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">Aviso: {duplicateGroups.length} grupo(s) de contatos possivelmente duplicados</p>
                      <p className="text-xs mt-1">
                        Encontramos {duplicateClientIds.size} contato(s) com indícios de se tratar da mesma pessoa. O sistema detecta por <strong>CPF igual</strong>, <strong>e-mail igual</strong>, <strong>nome + telefone</strong> ou <strong>nome idêntico</strong>.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
                    <button
                      type="button"
                      onClick={() => void handleMergeAllDuplicates()}
                      disabled={mergeLoading}
                      className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-60"
                    >
                      {mergeLoading ? 'Mesclando...' : 'Mesclar todos'}
                    </button>
                    <button
                      type="button"
                      onClick={selectAllDuplicateClients}
                      className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-red-900 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                    >
                      Selecionar duplicados
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDuplicateBanner(false)}
                      className="ml-auto text-red-700 hover:text-red-900 text-xs font-semibold px-2 py-1 rounded-md hover:bg-red-100 transition-colors"
                      aria-label="Fechar aviso de duplicados"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {duplicateGroups.slice(0, 4).map((group) => {
                    const names = group.clients.map((client) => client.full_name).slice(0, 3);
                    const extraCount = group.clients.length - names.length;
                    return (
                      <div key={group.key} className="rounded-lg border border-red-200 bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-red-900 flex-1 min-w-0 truncate">
                            {names.join(', ')}{extraCount > 0 ? ` +${extraCount}` : ''}
                          </p>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            group.confidence === 'alta' ? 'bg-red-100 text-red-700' :
                            group.confidence === 'media' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {group.confidence === 'alta' ? 'Alta' : group.confidence === 'media' ? 'Média' : 'Baixa'} confiança
                          </span>
                        </div>
                        <p className="text-[11px] text-red-700 mt-1">
                          {group.reasons.join(', ')}.
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
                onClick={handleNewClient}
                className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 transition-colors px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-sm shadow-orange-500/30"
              >
                <Plus className="w-4 h-4" />
                Novo Cliente
              </button>

              <button
                type="button"
                onClick={openManualMerge}
                className="inline-flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 transition-colors px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 shadow-sm"
                title="Mesclar contatos manualmente"
              >
                <Merge className="w-4 h-4" />
                Mesclar
              </button>

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
                <span className="text-slate-500">Dica: use “Selecionar” para excluir vários clientes.</span>
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
                  onClick={selectAllDuplicateClients}
                  disabled={visibleDuplicateIds.size === 0}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Duplicados ({visibleDuplicateIds.size})
                </button>
                <button
                  type="button"
                  onClick={clearSelectedIds}
                  disabled={selectedClientIds.size === 0}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => void handleMergeSelectedDuplicates()}
                  disabled={selectedDuplicateGroups.length === 0 || mergeLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {mergeLoading ? 'Mesclando...' : `Mesclar selecionados (${selectedDuplicateGroups.length})`}
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedClients}
                  disabled={selectedClientIds.size === 0 || bulkDeleteLoading}
                  className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {bulkDeleteLoading ? 'Excluindo...' : 'Excluir selecionados'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Client List */}
        <ClientList
          clients={clients}
          loading={loading}
          duplicateSummaryMap={duplicateSummaryMap}
          missingFieldsMap={missingFieldsMap}
          outdatedSet={outdatedSet}
          isFiltered={hasActiveFilters}
          selectionMode={selectionMode}
          selectedIds={selectedClientIds}
          onToggleSelected={toggleSelectedId}
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

      {/* Manual Merge Modal */}
      {showManualMerge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Merge className="w-4 h-4 text-orange-500" />
                  Mesclar Contatos Manualmente
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Busque e selecione os contatos a serem mesclados. O mais recente será o principal por padrão.</p>
              </div>
              <button
                onClick={() => setShowManualMerge(false)}
                className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                {manualMergeSearching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                )}
                <input
                  type="text"
                  value={manualMergeSearch}
                  onChange={(e) => handleManualMergeSearchChange(e.target.value)}
                  placeholder="Digite o nome do contato para buscar..."
                  className="w-full pl-9 pr-9 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>

            {/* Results + Selected split */}
            <div className="flex-1 overflow-hidden flex flex-col gap-0 px-5 pb-2">
              {/* Search results */}
              {manualMergeResults.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1.5">Resultados da busca</p>
                  <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 max-h-52 overflow-y-auto">
                    {manualMergeResults.map((client) => {
                      const isSelected = manualMergeSelected.some((c) => c.id === client.id);
                      return (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => toggleManualMergeClient(client)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition ${
                            isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${
                            isSelected ? 'border-orange-500 bg-orange-500' : 'border-slate-300'
                          }`}>
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{client.full_name}</p>
                            <p className="text-xs text-slate-500 truncate">
                              {[client.cpf_cnpj, client.email, client.phone || client.mobile].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            client.status === 'ativo' ? 'bg-emerald-50 text-emerald-700' :
                            client.status === 'inativo' ? 'bg-slate-100 text-slate-500' :
                            'bg-amber-50 text-amber-700'
                          }`}>
                            {client.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Selected clients */}
              {manualMergeSelected.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase mb-1.5">
                    Selecionados ({manualMergeSelected.length}) — marque quem será o contato principal
                  </p>
                  <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                    {manualMergeSelected.map((client) => {
                      const isPrimary = client.id === manualMergePrimaryId;
                      return (
                        <div key={client.id} className={`flex items-center gap-3 px-3 py-2.5 ${isPrimary ? 'bg-orange-50' : 'bg-white'}`}>
                          <button
                            type="button"
                            onClick={() => setManualMergePrimaryId(client.id)}
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${
                              isPrimary ? 'border-orange-500 bg-orange-500' : 'border-slate-300 hover:border-orange-300'
                            }`}
                            title="Definir como contato principal"
                          >
                            {isPrimary && <div className="w-2 h-2 rounded-full bg-white" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {client.full_name}
                              {isPrimary && <span className="ml-2 text-[10px] font-semibold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">principal</span>}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {[client.cpf_cnpj, client.email, client.phone || client.mobile].filter(Boolean).join(' · ') || 'Sem dados de contato'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleManualMergeClient(client)}
                            className="text-slate-400 hover:text-red-500 transition p-1 rounded"
                            title="Remover da seleção"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {manualMergeSelected.length >= 2 && (
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                      Os dados do contato principal serão complementados com informações dos demais (prioridade: mais recente). Os contatos secundários serão inativados.
                    </p>
                  )}
                </div>
              )}

              {manualMergeResults.length === 0 && manualMergeSearch.trim() && !manualMergeSearching && (
                <p className="text-sm text-slate-400 text-center py-6">Nenhum contato encontrado para "{manualMergeSearch}"</p>
              )}
              {!manualMergeSearch.trim() && manualMergeSelected.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">Digite o nome para buscar contatos a mesclar</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {manualMergeSelected.length < 2
                  ? 'Selecione ao menos 2 contatos'
                  : `${manualMergeSelected.length} contatos selecionados`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualMerge(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={executeManualMerge}
                  disabled={manualMergeSelected.length < 2 || !manualMergePrimaryId || manualMergeLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {manualMergeLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Mesclando...</>
                  ) : (
                    <><Merge className="w-4 h-4" /> Mesclar contatos</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
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
