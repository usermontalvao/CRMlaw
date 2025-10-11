import React, { useState, useEffect } from 'react';
import { Plus, Search, UserPlus, Building2, User, Download } from 'lucide-react';
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
}

const ClientsModule: React.FC<ClientsModuleProps> = ({ prefillData, onClientSaved, onClientCancelled, forceCreate, onParamConsumed, onNavigateToModule }) => {
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
  });

  // Carregar clientes
  const loadClients = async () => {
    try {
      setLoading(true);
      const data = await clientService.listClients(filters);
      setClients(data);
      
      // Atualizar estatísticas
      const total = await clientService.countClients();
      const active = await clientService.countClients({ status: 'ativo' });
      const pessoaFisica = await clientService.countClients({ client_type: 'pessoa_fisica' });
      const pessoaJuridica = await clientService.countClients({ client_type: 'pessoa_juridica' });
      
      setStats({ total, active, pessoaFisica, pessoaJuridica });
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, [filters]);

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
      const exportData = allClients.map(client => ({
        Nome: client.full_name,
        Email: client.email || '',
        Telefone: client.phone || '',
        Celular: client.mobile || '',
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
      }));
      
      // Criar workbook e worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // Configurar largura das colunas
      const colWidths = [
        { wch: 25 }, // Nome
        { wch: 25 }, // Email
        { wch: 15 }, // Telefone
        { wch: 15 }, // Celular
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

  return (
    <div className="space-y-6">
      {/* Estatísticas */}
      {viewMode === 'list' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium mb-1">Total de Clientes</p>
                <p className="text-3xl font-bold text-slate-900">{stats.total}</p>
              </div>
              <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                <User className="w-6 h-6 text-slate-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium mb-1">Clientes Ativos</p>
                <p className="text-3xl font-bold text-emerald-600">{stats.active}</p>
              </div>
              <div className="w-12 h-12 bg-emerald-50 rounded-lg flex items-center justify-center">
                <UserPlus className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium mb-1">Pessoa Física</p>
                <p className="text-3xl font-bold text-blue-600">{stats.pessoaFisica}</p>
              </div>
              <div className="w-12 h-12 bg-blue-50 rounded-lg flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-600 text-sm font-medium mb-1">Pessoa Jurídica</p>
                <p className="text-3xl font-bold text-purple-600">{stats.pessoaJuridica}</p>
              </div>
              <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center">
                <Building2 className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barra de ações */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex-1 flex gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar clientes..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 w-full md:w-auto">
              <select
                className="w-full sm:w-44 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm bg-white"
                value={filters.status || ''}
                onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
              >
                <option value="">Status</option>
                <option value="ativo">Ativos</option>
                <option value="inativo">Inativos</option>
                <option value="suspenso">Suspensos</option>
              </select>

              <select
                className="w-full sm:w-44 px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm bg-white"
                value={filters.client_type || ''}
                onChange={(e) => setFilters({ ...filters, client_type: e.target.value as any })}
              >
                <option value="">Tipo</option>
                <option value="pessoa_fisica">Pessoa Física</option>
                <option value="pessoa_juridica">Pessoa Jurídica</option>
              </select>

              <button 
                onClick={handleExportToExcel}
                disabled={exporting}
                className="w-full sm:w-auto justify-center bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium px-4 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
              >
                {exporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Exportando...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Exportar Excel
                  </>
                )}
              </button>

              <button 
                onClick={handleNewClient} 
                className="w-full sm:w-auto justify-center bg-amber-600 hover:bg-amber-700 text-white font-medium px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
                Novo Cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo principal */}
      {viewMode === 'list' && (
        <ClientList
          clients={clients}
          loading={loading}
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
              }
            });
          } : undefined}
          onCreateRequirement={onNavigateToModule ? () => {
            const prefillData = {
              client_id: selectedClient.id,
              beneficiary: selectedClient.full_name,
              cpf: selectedClient.cpf_cnpj,
            };
            console.log('=== CLIENTS MODULE ===');
            console.log('Enviando para requirements:', prefillData);
            onNavigateToModule('requirements', {
              mode: 'create',
              prefill: prefillData
            });
          } : undefined}
          onCreateDeadline={onNavigateToModule ? () => {
            onNavigateToModule('deadlines', {
              mode: 'create',
              prefill: {
                client_id: selectedClient.id,
                client_name: selectedClient.full_name,
              }
            });
          } : undefined}
        />
      )}
    </div>
  );
};

export default ClientsModule;
