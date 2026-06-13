import { useState, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { clientService } from '../services/client.service';
import ClientForm from './ClientForm';
import type { CreateClientDTO } from '../types/client.types';

interface ClientSearchSelectProps {
  value?: string;
  initialClientName?: string;
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
  initialClientName,
  onChange,
  placeholder = 'Buscar cliente...',
  label,
  required = false,
  className = '',
  allowCreate = true,
}) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedClientName, setSelectedClientName] = useState(initialClientName ?? '');
  const [isClientFormModalOpen, setIsClientFormModalOpen] = useState(false);
  const [clientFormPrefill, setClientFormPrefill] = useState<Partial<CreateClientDTO> | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

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

  useLayoutEffect(() => {
    if (!searchOpen || value) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const maxHeight = 240;
      const margin = 8;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const shouldScroll = spaceBelow < maxHeight + 16;
      
      if (shouldScroll) {
        // Rola a página para cima para que o dropdown caiba
        const scrollY = window.scrollY + (rect.bottom + maxHeight + margin - window.innerHeight);
        window.scrollTo({ top: scrollY, behavior: 'smooth' });
      }
      
      const top = rect.bottom + 4;

      setDropdownStyle({
        position: 'fixed',
        top,
        left: rect.left,
        width: rect.width,
        zIndex: 10000,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [searchOpen, value, searchLoading, searchResults.length, searchTerm]);

  useEffect(() => {
    if (!searchOpen) {
      setDropdownStyle(null);
    }
  }, [searchOpen]);

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-medium text-slate-600 mb-1">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div ref={anchorRef} className="relative">
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
            className="w-full rounded border border-slate-300 bg-white text-slate-900 h-[34px] px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 placeholder:text-slate-400"
          />
        )}

        {/* Cliente selecionado */}
        {value && selectedClientName && (
          <div className="flex items-center justify-between w-full rounded border border-slate-300 h-[34px] px-3 text-[13px] bg-white">
            <span className="text-slate-900 font-medium truncate">{selectedClientName}</span>
            <button
              type="button"
              onClick={handleClear}
              className="ml-2 p-1 hover:bg-slate-100 rounded transition flex-shrink-0"
              title="Remover seleção"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
        )}

        {/* Dropdown de resultados */}
        {searchOpen && !value && dropdownStyle && (searchLoading || searchResults.length > 0 || searchTerm.trim().length >= 2) && typeof document !== 'undefined' && (
          createPortal(
            <div
              className="client-search-dropdown rounded shadow-md z-[60] max-h-[220px] overflow-y-auto border border-slate-200 bg-white"
              style={dropdownStyle}
            >
            {searchLoading && (
              <div className="px-3 py-1.5 text-slate-500 text-[13px]">Buscando...</div>
            )}

            {!searchLoading && searchResults.length === 0 && searchTerm.trim().length >= 2 && (
              <>
                <div className="px-3 py-1.5 text-zinc-500 text-[13px] border-b border-zinc-100">
                  Nenhum cliente encontrado.
                </div>
                {allowCreate && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleCreateNew({ full_name: searchTerm })}
                    className="w-full text-left px-3 py-1.5 hover:bg-orange-50 transition flex items-center gap-1.5 text-orange-600"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[13px] font-medium">Adicionar "{searchTerm}"</span>
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
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 transition border-b border-zinc-100 last:border-0"
                >
                  <p className="text-[13px] font-medium truncate text-slate-900">{client.full_name}</p>
                  <p className="text-[11px] truncate text-slate-400">{client.email || primaryPhone || ''}</p>
                </button>
              );
            })}

            {allowCreate && !searchLoading && searchResults.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleCreateNew()}
                className="w-full text-left px-3 py-1.5 hover:bg-orange-50 transition border-t border-zinc-200 flex items-center gap-1.5 text-orange-600"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[13px] font-medium">Adicionar Novo Cliente</span>
              </button>
            )}
            </div>,
            document.body,
          )
        )}
      </div>

      {isClientFormModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-end justify-center px-0 py-0 sm:items-center sm:p-4">
            <div
              className="absolute inset-0 bg-slate-50/80 backdrop-blur-md"
              onClick={() => {
                setIsClientFormModalOpen(false);
                setClientFormPrefill(null);
              }}
              aria-hidden="true"
            />
            <div className="relative w-full max-w-[calc(100vw-12px)] sm:max-w-4xl">
              <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden rounded-t-[28px] border border-[#e7e5df] bg-[#f8f7f5] shadow-[0_24px_60px_rgba(15,23,42,0.12)] sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
                <div className="h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />
                <div className="flex items-start justify-between gap-3 border-b border-[#e7e5df] bg-[#f8f7f5] px-4 py-4 sm:px-6 sm:py-5">
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

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#f8f7f5]">
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
