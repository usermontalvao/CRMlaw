import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { clientService } from '../services/client.service';
import ClientForm from './ClientForm';
import type { CreateClientDTO } from '../types/client.types';

interface ClientSearchSelectProps {
  value?: string;
  onChange: (clientId: string, clientName: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  className?: string;
  allowCreate?: boolean; // Se true, mostra opção de criar novo cliente
}

type ClientSearchResult = Awaited<ReturnType<typeof clientService.searchClients>>[number];

export const ClientSearchSelect: React.FC<ClientSearchSelectProps> = ({
  value,
  onChange,
  placeholder = 'Buscar cliente...',
  label,
  required = false,
  className = '',
  allowCreate = true,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState('');
  const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);

  // Carregar nome do cliente selecionado
  useEffect(() => {
    if (value && !selectedClientName) {
      clientService.listClients().then((clients) => {
        const client = clients.find(c => c.id === value);
        if (client) {
          setSelectedClientName(client.full_name);
        }
      }).catch(() => {
        // Ignorar erro
      });
    }
  }, [value, selectedClientName]);

  // Buscar clientes com debounce
  useEffect(() => {
    const term = searchTerm.trim();

    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    let isActive = true;
    const handler = setTimeout(async () => {
      try {
        const results = await clientService.searchClients(term);
        if (!isActive) return;
        setSearchResults(results);
      } catch (error) {
        if (!isActive) return;
        console.error('Erro ao buscar clientes:', error);
        setSearchResults([]);
      } finally {
        if (isActive) {
          setSearchLoading(false);
        }
      }
    }, 350);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [searchTerm]);

  const handleSelect = (client: ClientSearchResult) => {
    onChange(client.id, client.full_name);
    setSelectedClientName(client.full_name);
    setSearchTerm('');
    setSearchOpen(false);
  };

  const handleClear = () => {
    onChange('', '');
    setSelectedClientName('');
    setSearchTerm('');
  };

  const handleCreateNew = (_prefill?: Partial<CreateClientDTO>) => {
    setClientFormPrefill(_prefill ?? null);
    setIsClientFormModalOpen(true);
    setSearchOpen(false);
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-slate-600 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div className="relative">
        {/* Campo de busca */}
        {!value && (
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            placeholder={placeholder}
            required={required}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white h-11 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-zinc-500"
          />
        )}

        {/* Cliente selecionado */}
        {value && selectedClientName && (
          <div className="flex items-center justify-between w-full rounded-lg border border-zinc-200 dark:border-zinc-700/50 h-11 px-4 text-sm bg-white dark:bg-zinc-800">
            <span className="text-zinc-900 dark:text-white font-medium truncate">{selectedClientName}</span>
            <button
              type="button"
              onClick={handleClear}
              className="ml-2 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-600 rounded transition flex-shrink-0"
              title="Remover seleção"
            >
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        )}

        {/* Dropdown de resultados */}
        {searchOpen && !value && (searchLoading || searchResults.length > 0 || searchTerm.trim().length >= 2) && (
          <div className="client-search-dropdown absolute left-0 right-0 mt-1 rounded-lg shadow-xl z-[60] max-h-60 overflow-y-auto">
            {searchLoading && (
              <div className="px-3 py-2 text-slate-500 text-sm" style={{ background: '#ffffff' }}>Buscando...</div>
            )}
            
            {!searchLoading && searchResults.length === 0 && searchTerm.trim().length >= 2 && (
              <>
                <div className="px-3 py-2 text-zinc-500 text-sm border-b border-zinc-100" style={{ background: '#ffffff' }}>
                  Nenhum cliente encontrado para "{searchTerm}"
                </div>
                {allowCreate && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleCreateNew({ full_name: searchTerm })}
                    className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition flex items-center gap-2 text-sky-600 font-medium"
                    style={{ background: '#ffffff' }}
                  >
                    <Plus className="w-4 h-4" />
                    <div>
                      <p className="text-sm font-semibold">Adicionar Novo Cliente</p>
                      <p className="text-xs text-zinc-500">Criar cadastro para "{searchTerm}"</p>
                    </div>
                  </button>
                )}
              </>
            )}
            
            {!searchLoading && searchResults.map((client) => {
              const primaryPhone = client.phone || client.mobile || '';
              return (
                <button
                  key={client.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(client)}
                  className="w-full text-left px-3 py-2.5 hover:bg-zinc-100 transition border-b border-zinc-100 last:border-0"
                  style={{ background: '#ffffff', color: '#18181b' }}
                >
                  <p className="text-sm font-semibold truncate" style={{ color: '#18181b' }}>{client.full_name}</p>
                  <p className="text-xs truncate" style={{ color: '#71717a' }}>{client.email || primaryPhone || 'Sem contato cadastrado'}</p>
                </button>
              );
            })}
            
            {allowCreate && !searchLoading && searchResults.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleCreateNew()}
                className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition border-t border-zinc-200 flex items-center gap-2 text-sky-600 font-medium"
                style={{ background: '#ffffff' }}
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm font-semibold">Adicionar Novo Cliente</span>
              </button>
            )}
          </div>
        )}
      </div>

      {isClientFormModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-slate-50/80 backdrop-blur-md"
              onClick={() => {
                setIsClientFormModalOpen(false);
                setClientFormPrefill(null);
              }}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-4xl">
              <div className="bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 overflow-hidden">
                <div className="h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />
                <div className="px-6 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Formulário</div>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900">Novo Cliente</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsClientFormModalOpen(false);
                      setClientFormPrefill(null);
                    }}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                    aria-label="Fechar modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-white">
                  <ClientForm
                    client={null}
                    prefill={clientFormPrefill}
                    variant="modal"
                    onBack={() => {
                      setIsClientFormModalOpen(false);
                      setClientFormPrefill(null);
                    }}
                    onSave={(savedClient) => {
                      onChange(savedClient.id, savedClient.full_name);
                      setSelectedClientName(savedClient.full_name);
                      setIsClientFormModalOpen(false);
                      setClientFormPrefill(null);
                      setSearchTerm('');
                      setSearchOpen(false);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
