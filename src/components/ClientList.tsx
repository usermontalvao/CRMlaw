import React from 'react';
import { Eye, Edit, Trash2, User, Building2, MessageCircle, AlertTriangle, Clock, Search } from 'lucide-react';
import type { Client } from '../types/client.types';

interface ClientListProps {
  clients: Client[];
  loading: boolean;
  onView: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
  missingFieldsMap?: Map<string, string[]>;
  outdatedSet?: Set<string>;
  isFiltered?: boolean;
}

const ClientList: React.FC<ClientListProps> = ({ clients, loading, onView, onEdit, onDelete, missingFieldsMap, outdatedSet, isFiltered }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12">
        <div className="flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600 mb-4"></div>
          <p className="text-slate-600">Carregando clientes...</p>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    if (isFiltered) {
      return (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Nenhum cliente corresponde aos filtros</h3>
          <p className="text-slate-600 text-sm">Ajuste os filtros ou limpe-os para visualizar todos os cadastros.</p>
        </div>
      );
    }

    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <User className="w-10 h-10 text-slate-400" />
        </div>
        <h3 className="text-xl font-semibold text-slate-900 mb-2">Nenhum cliente encontrado</h3>
        <p className="text-slate-600">Comece adicionando um novo cliente ao sistema.</p>
      </div>
    );
  }

  return (
    <>
      {/* Layout de Cards para Mobile */}
      <div className="md:hidden space-y-3">
        {clients.map((client) => {
          const missingFields = missingFieldsMap?.get(client.id) || [];
          const isOutdated = outdatedSet?.has(client.id) ?? false;
          const primaryPhone = client.phone || client.mobile || '';
          
          return (
            <div key={client.id} className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                    client.client_type === 'pessoa_fisica' 
                      ? 'bg-blue-100 text-blue-600' 
                      : 'bg-purple-100 text-purple-600'
                  }`}>
                    {client.client_type === 'pessoa_fisica' ? (
                      <User className="w-5 h-5" />
                    ) : (
                      <Building2 className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{client.full_name}</div>
                    <div className="text-xs text-gray-500">{client.profession || 'N/A'}</div>
                  </div>
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] leading-4 font-semibold rounded-full ${
                  client.status === 'ativo'
                    ? 'bg-green-100 text-green-800'
                    : client.status === 'inativo'
                    ? 'bg-gray-100 text-gray-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                </span>
              </div>

              {(missingFields.length > 0 || isOutdated) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {missingFields.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      <AlertTriangle className="w-3 h-3" />
                      {missingFields.length} pendente{missingFields.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {isOutdated && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                      <Clock className="w-3 h-3" />
                      Desatualizado
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <span className="text-gray-500">CPF/CNPJ:</span>
                  <div className="font-medium text-gray-900">{client.cpf_cnpj || 'N/A'}</div>
                </div>
                <div>
                  <span className="text-gray-500">Contato:</span>
                  <div className="flex items-center gap-1">
                    {primaryPhone ? (
                      <>
                        <a
                          href={`https://wa.me/${primaryPhone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageCircle className="w-3 h-3" />
                        </a>
                        <span className="text-[10px] text-slate-600 truncate">{primaryPhone}</span>
                      </>
                    ) : (
                      <span className="text-gray-400">Sem contato</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => onView(client)}
                  className="p-1.5 text-primary-600 hover:bg-primary-50 rounded transition"
                  title="Ver detalhes"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onEdit(client)}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                  title="Editar"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(client.id)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                  title="Desativar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Layout de Tabela para Desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Cliente
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Tipo
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  CPF/CNPJ
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Contato
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clients.map((client) => {
                const missingFields = missingFieldsMap?.get(client.id) || [];
                const isOutdated = outdatedSet?.has(client.id) ?? false;
                const primaryPhone = client.phone || client.mobile || '';
                return (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                      client.client_type === 'pessoa_fisica' 
                        ? 'bg-blue-100 text-blue-600' 
                        : 'bg-purple-100 text-purple-600'
                    }`}>
                      {client.client_type === 'pessoa_fisica' ? (
                        <User className="w-5 h-5" />
                      ) : (
                        <Building2 className="w-5 h-5" />
                      )}
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{client.full_name}</div>
                      <div className="text-sm text-gray-500">{client.profession || 'N/A'}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {missingFields.length > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="w-3 h-3" />
                            {missingFields.length === 1 ? '1 campo obrigatório pendente' : `${missingFields.length} campos pendentes`}
                          </span>
                        )}
                        {isOutdated && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                            <Clock className="w-3 h-3" />
                            Cadastro desatualizado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    client.client_type === 'pessoa_fisica'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-purple-100 text-purple-800'
                  }`}>
                    {client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {client.cpf_cnpj || 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {primaryPhone ? (
                      <>
                        <a
                          href={`https://wa.me/${primaryPhone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                          title={primaryPhone}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                        <span className="text-xs text-slate-600">{primaryPhone}</span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">Sem contato</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    client.status === 'ativo'
                      ? 'bg-green-100 text-green-800'
                      : client.status === 'inativo'
                      ? 'bg-gray-100 text-gray-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => onView(client)}
                      className="text-primary-600 hover:text-primary-900 transition-colors"
                      title="Ver detalhes"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => onEdit(client)}
                      className="text-blue-600 hover:text-blue-900 transition-colors"
                      title="Editar"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => onDelete(client.id)}
                      className="text-red-600 hover:text-red-900 transition-colors"
                      title="Desativar"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
};

export default ClientList;
