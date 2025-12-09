import React, { useState, useEffect } from 'react';
import { X, Search, Calendar } from 'lucide-react';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import type { Process, CreateProcessDTO } from '../types/process.types';
import type { Client } from '../types/client.types';
import { useAuth } from '../contexts/AuthContext';

interface ProcessFormProps {
  process: Process | null;
  prefill?: Partial<CreateProcessDTO> | null;
  onBack: () => void;
  onSave: (savedProcess: Process) => void;
}

const ProcessForm: React.FC<ProcessFormProps> = ({
  process,
  prefill,
  onBack,
  onSave,
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  
  const [formData, setFormData] = useState<Partial<CreateProcessDTO>>({
    client_id: '',
    client_name: '',
    number: '',
    area: 'Trabalhista',
    status: 'Não Protocolado',
    distribution_date: '',
    court_jurisdiction: '',
    lawyer_id: user?.id || '',
    has_hearing: false,
    notes: '',
  });

  // Carregar dados do processo para edição
  useEffect(() => {
    if (process) {
      setFormData({
        client_id: process.client_id,
        client_name: process.client_name,
        number: process.number || '',
        area: process.area || 'Trabalhista',
        status: process.status || 'Não Protocolado',
        distribution_date: process.distribution_date || '',
        court_jurisdiction: process.court_jurisdiction || '',
        lawyer_id: process.lawyer_id || user?.id || '',
        has_hearing: process.has_hearing || false,
        notes: process.notes || '',
      });
      setClientSearchTerm(process.client_name || '');
    }
  }, [process, user?.id]);

  // Aplicar prefill se disponível
  useEffect(() => {
    if (prefill && !process) {
      setFormData(prev => ({
        ...prev,
        ...prefill
      }));
      
      if (prefill.client_name) {
        setClientSearchTerm(prefill.client_name);
      }
    }
  }, [prefill, process]);

  // Carregar membros da equipe
  useEffect(() => {
    const loadMembers = async () => {
      try {
        // Implementar quando houver um serviço de membros
        setMembers([
          { id: user?.id, name: user?.name || 'Você' }
        ]);
      } catch (error) {
        console.error('Erro ao carregar membros:', error);
      }
    };
    
    loadMembers();
  }, [user]);

  // Buscar clientes ao digitar
  useEffect(() => {
    const searchClients = async () => {
      if (clientSearchTerm.length < 2) {
        setClientSuggestions([]);
        return;
      }
      
      try {
        const clients = await clientService.listClients({ search: clientSearchTerm });
        setClientSuggestions(clients);
      } catch (error) {
        console.error('Erro ao buscar clientes:', error);
        setClientSuggestions([]);
      }
    };
    
    const timer = setTimeout(searchClients, 300);
    return () => clearTimeout(timer);
  }, [clientSearchTerm]);

  const handleChange = (field: keyof CreateProcessDTO, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleClientSelect = (client: Client) => {
    setFormData(prev => ({
      ...prev,
      client_id: client.id,
      client_name: client.full_name
    }));
    setClientSearchTerm(client.full_name);
    setShowClientSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.client_id) {
      alert('Por favor, selecione um cliente');
      return;
    }
    
    try {
      setLoading(true);
      
      let savedProcess: Process;
      
      if (process) {
        // Editar processo existente
        savedProcess = await processService.updateProcess(process.id, formData as CreateProcessDTO);
      } else {
        // Criar novo processo
        savedProcess = await processService.createProcess(formData as CreateProcessDTO);
      }
      
      onSave(savedProcess);
    } catch (error: any) {
      console.error('Erro ao salvar processo:', error);
      alert(error.message || 'Erro ao salvar processo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl overflow-hidden">
        <div className="h-1.5 bg-orange-500"></div>
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            {process ? 'Editar Processo' : 'Novo Processo'}
          </h2>
          <button 
            onClick={onBack}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
            {/* Cliente */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="cliente">
                Cliente <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="cliente"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                  placeholder="Buscar cliente..."
                  type="text"
                  value={clientSearchTerm}
                  onChange={(e) => {
                    setClientSearchTerm(e.target.value);
                    setShowClientSuggestions(true);
                  }}
                  onFocus={() => setShowClientSuggestions(true)}
                />
                
                {showClientSuggestions && clientSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
                    {clientSuggestions.map((client) => (
                      <div
                        key={client.id}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                        onClick={() => handleClientSelect(client)}
                      >
                        <div className="font-medium text-gray-900 dark:text-white">{client.full_name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {client.cpf_cnpj || 'Sem documento'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Número do Processo */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="numero-processo">
                Número do Processo
              </label>
              <div className="flex items-center space-x-2">
                <input
                  id="numero-processo"
                  className="flex-grow bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                  type="text"
                  value={formData.number || ''}
                  onChange={(e) => handleChange('number', e.target.value)}
                  placeholder="0000000-00.0000.0.00.0000"
                />
                <button
                  type="button"
                  className="bg-orange-500/20 text-orange-500 p-3 rounded-lg hover:bg-orange-500/30 transition-colors"
                >
                  <Search className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Grid de 4 colunas */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* Área */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="area">
                  Área
                </label>
                <select
                  id="area"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100"
                  value={formData.area || 'Trabalhista'}
                  onChange={(e) => handleChange('area', e.target.value)}
                >
                  <option value="Trabalhista">Trabalhista</option>
                  <option value="Civil">Civil</option>
                  <option value="Penal">Penal</option>
                  <option value="Previdenciário">Previdenciário</option>
                  <option value="Administrativo">Administrativo</option>
                  <option value="Tributário">Tributário</option>
                </select>
              </div>
              
              {/* Status */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="status">
                  Status
                </label>
                <select
                  id="status"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100"
                  value={formData.status || 'Não Protocolado'}
                  onChange={(e) => handleChange('status', e.target.value)}
                >
                  <option value="Não Protocolado">Não Protocolado</option>
                  <option value="Protocolado">Protocolado</option>
                  <option value="Em Andamento">Em Andamento</option>
                  <option value="Concluído">Concluído</option>
                  <option value="Arquivado">Arquivado</option>
                </select>
              </div>
              
              {/* Distribuição */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="distribuicao">
                  Distribuição
                </label>
                <div className="relative">
                  <input
                    id="distribuicao"
                    className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 pr-10"
                    type="date"
                    value={formData.distribution_date || ''}
                    onChange={(e) => handleChange('distribution_date', e.target.value)}
                  />
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-500 dark:text-gray-400">
                    <Calendar className="w-5 h-5" />
                  </span>
                </div>
              </div>
              
              {/* Vara / Comarca */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="vara-comarca">
                  Vara / Comarca
                </label>
                <input
                  id="vara-comarca"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                  type="text"
                  value={formData.court_jurisdiction || ''}
                  onChange={(e) => handleChange('court_jurisdiction', e.target.value)}
                />
              </div>
            </div>
            
            {/* Grid de 2 colunas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Advogado */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="advogado">
                  Advogado
                </label>
                <select
                  id="advogado"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100"
                  value={formData.lawyer_id || user?.id || ''}
                  onChange={(e) => handleChange('lawyer_id', e.target.value)}
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Audiência */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="audiencia">
                  Audiência
                </label>
                <select
                  id="audiencia"
                  className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100"
                  value={formData.has_hearing ? 'Sim' : 'Não'}
                  onChange={(e) => handleChange('has_hearing', e.target.value === 'Sim')}
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
            </div>
            
            {/* Observações */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="observacoes">
                Observações
              </label>
              <textarea
                id="observacoes"
                className="w-full bg-gray-100 dark:bg-gray-700 border-transparent rounded-lg focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                rows={4}
                value={formData.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
              ></textarea>
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex justify-end items-center p-6 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 mr-2 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-orange-500 rounded-lg hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 dark:focus:ring-offset-gray-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProcessForm;
