import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, Users, User, Building2, ShieldAlert, Search, Filter, Download, Upload, Loader2, Edit, Trash2, AlertTriangle, CheckCircle2, X, Phone, Mail, FileText, Copy, FilePlus, UserPlus, Calendar, ChevronRight, Pencil, Clock, Merge } from 'lucide-react';
import * as XLSX from 'xlsx';
import { clientService } from '../services/client.service';
import { signatureService } from '../services/signature.service';
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
import { Modal, ModalBody } from './ui';
import { buildDuplicateGroups, buildDuplicateSummaryMap, pickPrimaryClient, type DuplicateGroup } from '../utils/clientDuplicates';
import { useSelectionState } from '../hooks/useSelectionState';
import { getClientMissingFields, isOutdatedClientRecord, OUTDATED_THRESHOLD_DAYS } from '../utils/clientQuality';
import { settingsService, CLIENT_MODULE_DEFAULTS } from '../services/settings.service';

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
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const [clientStatuses, setClientStatuses] = useState(CLIENT_MODULE_DEFAULTS.statuses);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    settingsService.getClientModuleConfig().then(cfg => {
      if (cfg.statuses.length > 0) setClientStatuses(cfg.statuses.filter(s => s.active !== false));
    }).catch(() => {});
  }, []);

  // ── Cache de fotos em localStorage (sobrevive reload) ─────────────
  // Schema: { [clientId]: { url, path, expiresAt, miss?: true } }
  // miss=true marca que o cliente não tem foto disponível — evita refetch repetido.
  const PHOTO_CACHE_KEY = 'jurius.clientPhotoCache.v1';
  const PHOTO_CACHE_TTL_MS = 50 * 60 * 1000; // 50min (URL assinada vale 60min)
  const MISS_CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24h pra "sem foto"

  type CacheEntry = { url?: string; path?: string; expiresAt: number; miss?: boolean };
  const loadCache = (): Record<string, CacheEntry> => {
    try {
      const raw = localStorage.getItem(PHOTO_CACHE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch { return {}; }
  };
  const saveCache = (cache: Record<string, CacheEntry>) => {
    try { localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
  };

  const [clientPhotoUrls, setClientPhotoUrls] = useState<Map<string, string>>(() => {
    // Pre-carrega URLs ainda válidas do cache
    const cache = loadCache();
    const now = Date.now();
    const map = new Map<string, string>();
    Object.entries(cache).forEach(([id, entry]) => {
      if (entry.url && entry.expiresAt > now) map.set(id, entry.url);
    });
    return map;
  });

  // Resolve foto do cliente para a lista, com cache em localStorage.
  // Estratégias em ordem:
  //   1) photo_path pinado no banco → URL assinada direta
  //   2) Sem pinado → busca assinaturas concluídas e usa a foto facial mais recente
  // Fast pass (pinados): concurrency 12 · Slow pass (fallback): concurrency 4
  useEffect(() => {
    if (clients.length === 0) return;
    const cache = loadCache();
    const now = Date.now();

    // Skip: já no state OU cache válido (foto OU "miss" recente)
    const targets = clients.filter((c) => {
      if (clientPhotoUrls.has(c.id)) return false;
      const cached = cache[c.id];
      if (cached) {
        if (cached.url && cached.expiresAt > now) return false;
        if (cached.miss && cached.expiresAt > now) return false;
      }
      return true;
    });
    if (targets.length === 0) return;

    let cancelled = false;

    const setEntry = (id: string, entry: CacheEntry) => {
      cache[id] = entry;
    };

    const tryUrl = async (path: string): Promise<string | null> => {
      try {
        return await signatureService.getSignedImageUrl(path, 3600);
      } catch { return null; }
    };

    const resolvePinned = async (c: Client): Promise<[string, string] | null> => {
      if (!c.photo_path) return null;
      const url = await tryUrl(c.photo_path);
      if (url) {
        setEntry(c.id, { url, path: c.photo_path, expiresAt: now + PHOTO_CACHE_TTL_MS });
        return [c.id, url];
      }
      return null;
    };

    const resolveFromSignatures = async (c: Client): Promise<[string, string] | null> => {
      try {
        const requests = await signatureService.listRequestsWithSigners({ client_id: c.id });
        const signed = requests
          .filter((r: any) => r.status === 'signed')
          .sort((a: any, b: any) =>
            new Date(b.signed_at || b.updated_at).getTime() -
            new Date(a.signed_at || a.updated_at).getTime()
          );
        for (const req of signed) {
          for (const signer of req.signers ?? []) {
            // LGPD: só usa a selfie da assinatura como foto de cliente quando o
            // signatário autorizou explicitamente (consentimento separado).
            if (
              signer.facial_image_path &&
              signer.status === 'signed' &&
              signer.allow_signature_selfie_for_profile === true
            ) {
              const url = await tryUrl(signer.facial_image_path);
              if (url) {
                setEntry(c.id, { url, path: signer.facial_image_path, expiresAt: now + PHOTO_CACHE_TTL_MS });
                return [c.id, url];
              }
            }
          }
          // Nota: a selfie no nível da request (modelo legado) não possui
          // consentimento individual e por isso NÃO é usada como foto cadastral.
        }
      } catch { /* */ }
      // Marca como "miss" pra não voltar a buscar por 24h
      setEntry(c.id, { miss: true, expiresAt: now + MISS_CACHE_TTL_MS });
      return null;
    };

    const runBatched = async (
      items: Client[],
      worker: (c: Client) => Promise<[string, string] | null>,
      concurrency: number
    ) => {
      for (let i = 0; i < items.length; i += concurrency) {
        if (cancelled) return;
        const batch = items.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(worker));
        if (cancelled) return;
        setClientPhotoUrls((prev) => {
          const next = new Map(prev);
          results.forEach((e) => { if (e) next.set(e[0], e[1]); });
          return next;
        });
        saveCache(cache);
      }
    };

    (async () => {
      // 1ª passada: fotos pinadas (rápida — só 1 round-trip cada)
      const pinned = targets.filter((c) => c.photo_path);
      const unpinned = targets.filter((c) => !c.photo_path);
      await runBatched(pinned, resolvePinned, 12);
      if (cancelled) return;
      // 2ª passada: buscar nas assinaturas (mais lenta)
      await runBatched(unpinned, resolveFromSignatures, 4);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);
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
  const [showOutdatedOnly, setShowOutdatedOnly] = useState(false);
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
      // Atualizar estatísticas — usa listClients({}) em cache (1 request, sem round-trips extras)
      const allData = await clientService.listClients({});
      const total = allData.length;
      const active = allData.filter((c) => c.status === 'ativo').length;
      const pessoaFisica = allData.filter((c) => c.client_type === 'pessoa_fisica').length;
      const pessoaJuridica = allData.filter((c) => c.client_type === 'pessoa_juridica').length;

      let visibleClients = data;
      if (showIncompleteOnly) visibleClients = visibleClients.filter((client) => missing.has(client.id));
      if (showOutdatedOnly) visibleClients = visibleClients.filter((client) => outdated.has(client.id));
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
  }, [filters, showIncompleteOnly, showOutdatedOnly]);

  // Escutar eventos globais de mudança de clientes
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.CLIENTS_CHANGED, () => {
      console.log('🔄 ClientsModule: Mudança de clientes detectada, recarregando lista...');
      loadClients();
    });

    return () => unsubscribe();
  }, [filters]); // Recarregar respeitando filtros atuais

  // Quando a timeline atualiza o status de um processo, reflete imediatamente na aba de processos do cliente
  useEffect(() => {
    const unsubscribe = events.on(SYSTEM_EVENTS.PROCESS_UPDATED, ({ processId, status }: { processId: string; status: string }) => {
      setClientProcesses((prev) =>
        prev.map((p) => (p.id === processId ? { ...p, status: status as any } : p))
      );
    });
    return () => unsubscribe();
  }, []);

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
      notifyDeleted();
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
      notifyDeleted(client?.full_name || undefined);
      loadClients();
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
      alert('Erro ao deletar cliente');
    }
  };

  const hasActiveFilters = Boolean(filters.status || filters.client_type || filters.search) || filters.sort_order === 'oldest' || showIncompleteOnly || showOutdatedOnly;

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

  const detailModalIcon = selectedClient?.client_type === 'pessoa_juridica'
    ? <Building2 className="w-5 h-5" />
    : <User className="w-5 h-5" />;

  const detailModalSubtitle = selectedClient ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      <span className="font-medium text-slate-700">{selectedClient.client_type === 'pessoa_juridica' ? 'Pessoa jurídica' : 'Pessoa física'}</span>
      {selectedClient.cpf_cnpj && (
        <>
          <span className="text-slate-300">•</span>
          <span>{selectedClient.cpf_cnpj}</span>
        </>
      )}
      <span className="text-slate-300">•</span>
      <span className={selectedClient.status === 'ativo' ? 'text-emerald-700' : 'text-slate-500'}>
        {selectedClient.status === 'ativo' ? 'Cadastro ativo' : 'Cadastro inativo'}
      </span>
    </div>
  ) : undefined;

  return (
    <>
      <div className="space-y-4">
        
        {/* Stats — enterprise treatment */}
        <div className="bg-[#f8f7f5] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-slate-100">
            {/* Total */}
            <div className="px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total</span>
                <Users className="w-3.5 h-3.5 text-slate-300" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-none">{stats.total}</p>
              <p className="mt-1.5 text-[10px] text-slate-400">cadastros no sistema</p>
            </div>
            {/* Ativos */}
            <div className="px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Ativos</span>
                <UserPlus className="w-3.5 h-3.5 text-emerald-500/70" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-emerald-600 tabular-nums leading-none">{stats.active}</p>
              <p className="mt-1.5 text-[10px] text-slate-400">
                {stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}% da base` : '—'}
              </p>
            </div>
            {/* P. Física */}
            <div className="hidden sm:block px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">P. Física</span>
                <User className="w-3.5 h-3.5 text-slate-300" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-none">{stats.pessoaFisica}</p>
              <p className="mt-1.5 text-[10px] text-slate-400">
                {stats.total > 0 ? `${Math.round((stats.pessoaFisica / stats.total) * 100)}% PF` : '—'}
              </p>
            </div>
            {/* P. Jurídica */}
            <div className="hidden sm:block px-4 py-4 sm:px-5 sm:py-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">P. Jurídica</span>
                <Building2 className="w-3.5 h-3.5 text-slate-300" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-none">{stats.pessoaJuridica}</p>
              <p className="mt-1.5 text-[10px] text-slate-400">
                {stats.total > 0 ? `${Math.round((stats.pessoaJuridica / stats.total) * 100)}% PJ` : '—'}
              </p>
            </div>
            {/* Incompletos — clicável: filtra a lista */}
            <button
              type="button"
              onClick={() => stats.incomplete > 0 && setShowIncompleteOnly((v) => !v)}
              disabled={stats.incomplete === 0}
              className={`hidden sm:block px-4 py-4 sm:px-5 sm:py-5 text-left w-full transition relative ${
                stats.incomplete > 0
                  ? 'cursor-pointer hover:bg-amber-50/40'
                  : 'cursor-default'
              } ${showIncompleteOnly ? 'bg-amber-50/60' : ''}`}
              title={stats.incomplete > 0 ? (showIncompleteOnly ? 'Mostrar todos' : 'Filtrar somente incompletos') : ''}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Incompletos</span>
                <AlertTriangle className={`w-3.5 h-3.5 ${stats.incomplete > 0 ? 'text-amber-500' : 'text-slate-300'}`} />
              </div>
              <p className={`text-2xl sm:text-3xl font-bold tabular-nums leading-none ${stats.incomplete > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{stats.incomplete}</p>
              <p className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                {stats.incomplete > 0 ? (
                  <span className="text-amber-600 font-medium inline-flex items-center gap-1">
                    {showIncompleteOnly ? 'filtro ativo — clique para limpar' : 'clique para filtrar'}
                    {showIncompleteOnly && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                  </span>
                ) : 'tudo em dia'}
              </p>
              {showIncompleteOnly && stats.incomplete > 0 && (
                <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
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
                      <div key={group.key} className="rounded-lg border border-red-200 bg-[#f8f7f5]/70 px-3 py-2">
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
            {((missingFieldsMap.size > 0 && showMissingBanner) || outdatedSet.size > 0 || hasActiveFilters) && (
              <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg bg-slate-50 border border-[#e7e5df] text-xs">
                {/* Chip: Incompletos (toggle) */}
                {missingFieldsMap.size > 0 && showMissingBanner && (
                  <button
                    type="button"
                    onClick={() => setShowIncompleteOnly((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition ${
                      showIncompleteOnly
                        ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                        : 'bg-[#f8f7f5] text-slate-600 ring-1 ring-slate-200 hover:ring-amber-300 hover:text-amber-700'
                    }`}
                    title={showIncompleteOnly ? 'Remover filtro de incompletos' : 'Filtrar somente incompletos'}
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                    <strong className="font-semibold">{missingFieldsMap.size}</strong> incompletos
                    {showIncompleteOnly && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse ml-0.5" />}
                  </button>
                )}

                {/* Chip: Desatualizados (toggle) */}
                {outdatedSet.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowOutdatedOnly((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition ${
                      showOutdatedOnly
                        ? 'bg-sky-100 text-sky-800 ring-1 ring-sky-300'
                        : 'bg-[#f8f7f5] text-slate-600 ring-1 ring-slate-200 hover:ring-sky-300 hover:text-sky-700'
                    }`}
                    title={showOutdatedOnly ? 'Remover filtro de desatualizados' : `Filtrar cadastros com > ${OUTDATED_THRESHOLD_DAYS} dias sem atualização`}
                  >
                    <Clock className="w-3 h-3 text-sky-500 flex-shrink-0" />
                    <strong className="font-semibold">{outdatedSet.size}</strong> desatualizados
                    <span className="text-slate-400 font-normal">(&gt; {OUTDATED_THRESHOLD_DAYS}d)</span>
                    {showOutdatedOnly && <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse ml-0.5" />}
                  </button>
                )}

                {/* Limpar filtros */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowIncompleteOnly(false);
                      setShowOutdatedOnly(false);
                      setSearchTerm('');
                      setFilters({ sort_order: 'newest' });
                    }}
                    className="inline-flex items-center gap-1 ml-auto text-slate-500 hover:text-slate-800 font-medium hover:underline decoration-dotted underline-offset-2"
                  >
                    <X className="w-3 h-3" /> Limpar filtros
                  </button>
                )}

                {/* Dispensar avisos */}
                {missingFieldsMap.size > 0 && showMissingBanner && !hasActiveFilters && (
                  <button
                    type="button"
                    onClick={() => setShowMissingBanner(false)}
                    className="ml-auto text-slate-300 hover:text-slate-500 text-sm leading-none px-1"
                    aria-label="Dispensar avisos"
                    title="Dispensar"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-[#f8f7f5] rounded-2xl p-3 shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]">
          {/* Linha 1: busca sempre visível + actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#e7e5df] bg-white text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
                placeholder="Buscar por nome, CPF, e-mail ou telefone…"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleNewClient}
                className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 transition-colors px-3 py-2 rounded-lg text-xs font-semibold text-white shadow-orange-500/30"
              >
                <Plus className="w-4 h-4" />
                Novo Cliente
              </button>

              <button
                type="button"
                onClick={openManualMerge}
                className="inline-flex items-center gap-1.5 bg-[#f8f7f5] border border-[#e7e5df] hover:bg-slate-50 transition-colors px-3 py-2 rounded-lg text-xs font-medium text-slate-700 shadow-sm"
                title="Mesclar contatos manualmente"
              >
                <Merge className="w-4 h-4" />
                Mesclar
              </button>

              <button
                type="button"
                onClick={toggleSelectionMode}
                className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  selectionMode
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-[#e7e5df] bg-[#f8f7f5] text-slate-700 hover:bg-slate-50'
                }`}
              >
                Selecionar
              </button>

              <button
                type="button"
                onClick={() => setShowFilters((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                title={showFilters ? 'Ocultar filtros' : 'Mostrar mais filtros'}
              >
                <Filter className="w-3.5 h-3.5" />
                {showFilters ? 'Menos filtros' : 'Mais filtros'}
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                <select
                  value={filters.status || ''}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5df] bg-[#f8f7f5] text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="">Todos</option>
                  {clientStatuses.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Tipo</label>
                <select
                  value={filters.client_type || ''}
                  onChange={(e) => setFilters({ ...filters, client_type: e.target.value as any })}
                  className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5df] bg-[#f8f7f5] text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
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
                  className="w-full px-3 py-1.5 rounded-lg border border-[#e7e5df] bg-[#f8f7f5] text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="newest">Mais novos</option>
                  <option value="oldest">Mais antigos</option>
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex items-end gap-2">
                <label className="flex-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-[#e7e5df] hover:bg-slate-50 rounded-lg px-3 py-1.5 bg-[#f8f7f5] cursor-pointer transition">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 w-3.5 h-3.5"
                    checked={showIncompleteOnly}
                    onChange={(e) => setShowIncompleteOnly(e.target.checked)}
                  />
                  <span className="text-xs">Incompletos</span>
                </label>
                <label className="flex-1 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-[#e7e5df] hover:bg-slate-50 rounded-lg px-3 py-1.5 bg-[#f8f7f5] cursor-pointer transition">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-3.5 h-3.5"
                    checked={showOutdatedOnly}
                    onChange={(e) => setShowOutdatedOnly(e.target.checked)}
                  />
                  <span className="text-xs">Desatualizados</span>
                </label>

                <button
                  onClick={handleExportToExcel}
                  disabled={exporting}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:border-emerald-300 disabled:text-emerald-400 bg-[#f8f7f5] font-medium px-3 py-2 rounded-lg shadow-sm transition disabled:cursor-not-allowed"
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
          <div className="bg-[#f8f7f5] rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04] p-3">
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
                  className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
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
                  className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Results count */}
        {!loading && (
          <div className="flex items-center justify-between px-1 -mb-1">
            <p className="text-xs text-slate-500">
              {hasActiveFilters ? (
                <>Exibindo <strong className="text-slate-700 font-semibold tabular-nums">{clients.length}</strong> de <strong className="text-slate-700 font-semibold tabular-nums">{stats.total}</strong> {stats.total === 1 ? 'cliente' : 'clientes'} <span className="text-slate-400">· filtros ativos</span></>
              ) : (
                <><strong className="text-slate-700 font-semibold tabular-nums">{clients.length}</strong> {clients.length === 1 ? 'cliente' : 'clientes'}</>
              )}
            </p>
            {selectionMode && selectedClientIds.size > 0 && (
              <p className="text-xs text-indigo-600 font-semibold tabular-nums">{selectedClientIds.size} selecionado{selectedClientIds.size !== 1 ? 's' : ''}</p>
            )}
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
          photoUrls={clientPhotoUrls}
        />
      </div>

      {/* Form Modal */}
      {isFormModalOpen && (
        <ClientModal
          isOpen={isFormModalOpen}
          onClose={() => closeFormModal(true)}
          title={modalState.type === 'edit' ? 'Editar Cliente' : 'Novo Cliente'}
          subtitle={formContext === 'prefill' ? 'Dados pré-preenchidos automaticamente' : undefined}
          size="lg"
        >
          <ClientForm
            client={modalState.client}
            prefill={modalState.type === 'create' ? formPrefill : null}
            onBack={() => closeFormModal(true)}
            onSave={handleFormSaved}
            variant="modal"
          />
        </ClientModal>
      )}

      {/* Manual Merge Modal */}
      <Modal
        open={showManualMerge}
        onClose={() => setShowManualMerge(false)}
        title="Mesclar Contatos Manualmente"
        subtitle="Busque e selecione os contatos a serem mesclados. O mais recente será o principal por padrão."
        icon={<Merge className="w-5 h-5" />}
        size="lg"
        zIndex={50}
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <p className="text-xs text-slate-500">
              {manualMergeSelected.length < 2 ? 'Selecione ao menos 2 contatos' : `${manualMergeSelected.length} contatos selecionados`}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowManualMerge(false)} className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition">Cancelar</button>
              <button type="button" onClick={executeManualMerge} disabled={manualMergeSelected.length < 2 || !manualMergePrimaryId || manualMergeLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">
                {manualMergeLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Mesclando...</> : <><Merge className="w-4 h-4" /> Mesclar contatos</>}
              </button>
            </div>
          </div>
        }
      >
        <ModalBody>
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
                  className="w-full pl-9 pr-9 py-2 rounded-lg border border-[#e7e5df] text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
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
                  <div className="border border-[#e7e5df] rounded-lg overflow-hidden divide-y divide-slate-100 max-h-52 overflow-y-auto">
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
                          {(() => {
                            const statusCfg = clientStatuses.find(s => s.key === client.status);
                            return (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                statusCfg?.badge ??
                                (client.status === 'ativo' ? 'bg-emerald-50 text-emerald-700' :
                                client.status === 'inativo' ? 'bg-slate-100 text-slate-500' :
                                'bg-amber-50 text-amber-700')
                              }`}>
                                {statusCfg?.label ?? client.status}
                              </span>
                            );
                          })()}
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
                  <div className="border border-[#e7e5df] rounded-lg overflow-hidden divide-y divide-slate-100">
                    {manualMergeSelected.map((client) => {
                      const isPrimary = client.id === manualMergePrimaryId;
                      return (
                        <div key={client.id} className={`flex items-center gap-3 px-3 py-2.5 ${isPrimary ? 'bg-orange-50' : 'bg-[#f8f7f5]'}`}>
                          <button
                            type="button"
                            onClick={() => setManualMergePrimaryId(client.id)}
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition ${
                              isPrimary ? 'border-orange-500 bg-orange-500' : 'border-slate-300 hover:border-orange-300'
                            }`}
                            title="Definir como contato principal"
                          >
                            {isPrimary && <div className="w-2 h-2 rounded-full bg-[#f8f7f5]" />}
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

        </ModalBody>
      </Modal>

      {/* Details Modal */}
      {isDetailsModalOpen && selectedClient && (
        <ClientModal
          isOpen={isDetailsModalOpen}
          onClose={closeDetailsModal}
          title="Detalhes do cliente"
          subtitle={detailModalSubtitle}
          icon={detailModalIcon}
          size="xl"
        >
          <div className="p-3">
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
