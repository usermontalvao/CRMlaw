import React from 'react';
import { Eye, Edit, Trash2, User, Building2, MessageCircle, AlertTriangle, Clock, Search } from 'lucide-react';
import type { Client } from '../types/client.types';
import { formatCPF, formatCNPJ } from '../utils/formatters';

/* ───── Avatar com iniciais determinísticas ─────
 * Para PF: gera fundo pastel + texto contrastante a partir do hash do nome.
 * Para PJ: ícone neutro de prédio em escala de cinza.
 */
const stringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const ClientAvatar: React.FC<{ client: Client; size?: number; photoUrl?: string }> = ({ client, size = 40, photoUrl }) => {
  // 1ª prioridade: foto real do cliente
  if (photoUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full overflow-hidden ring-1 ring-slate-200 shadow-sm bg-slate-100"
        style={{ width: size, height: size }}
      >
        <img src={photoUrl} alt={client.full_name} className="w-full h-full object-cover" />
      </div>
    );
  }
  // 2º: PJ → ícone neutro
  if (client.client_type === 'pessoa_juridica') {
    return (
      <div
        className="flex-shrink-0 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <Building2 style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }
  // 3º: PF sem foto → iniciais coloridas determinísticas
  const hue = stringToHue(client.full_name);
  return (
    <div
      className="flex-shrink-0 rounded-full flex items-center justify-center font-semibold ring-1 ring-inset"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue}, 55%, 94%)`,
        color: `hsl(${hue}, 50%, 32%)`,
        fontSize: size * 0.38,
        // @ts-ignore — ring-color via inline style
        '--tw-ring-color': `hsl(${hue}, 50%, 80%)`,
      } as React.CSSProperties}
    >
      {getInitials(client.full_name)}
    </div>
  );
};

interface ClientListProps {
  clients: Client[];
  loading: boolean;
  onView: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: string) => void;
  duplicateSummaryMap?: Map<string, { count: number; reasons: string[]; partnerNames: string[] }>;
  missingFieldsMap?: Map<string, string[]>;
  outdatedSet?: Set<string>;
  isFiltered?: boolean;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (clientId: string) => void;
  photoUrls?: Map<string, string>;
}

const ClientList: React.FC<ClientListProps> = ({ clients, loading, onView, onEdit, onDelete, duplicateSummaryMap, missingFieldsMap, outdatedSet, isFiltered, selectionMode = false, selectedIds, onToggleSelected, photoUrls }) => {
  const formatCpfCnpj = (client: Client) => {
    const raw = client.cpf_cnpj || '';
    const digits = raw.replace(/\D/g, '');
    if (!digits) return 'N/A';

    if (client.client_type === 'pessoa_juridica' || digits.length > 11) {
      return formatCNPJ(digits);
    }

    return formatCPF(digits);
  };

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
          const duplicateInfo = duplicateSummaryMap?.get(client.id);
          const missingFields = missingFieldsMap?.get(client.id) || [];
          const isOutdated = outdatedSet?.has(client.id) ?? false;
          const primaryPhone = client.phone || client.mobile || '';
          const isSelected = selectionMode && Boolean(selectedIds?.has(client.id));
          
          return (
            <div key={client.id} className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {selectionMode && (
                    <div className="flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelected?.(client.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                  <ClientAvatar client={client} size={40} photoUrl={photoUrls?.get(client.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{client.full_name}</div>
                    <div className="text-xs text-slate-500 truncate">{client.profession || (client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica')}</div>
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

              {(missingFields.length > 0 || isOutdated || duplicateInfo) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {duplicateInfo && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      <AlertTriangle className="w-3 h-3" />
                      {duplicateInfo.count} duplicado{duplicateInfo.count > 1 ? 's' : ''}
                    </span>
                  )}
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

              {duplicateInfo && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2">
                  <p className="text-[10px] font-semibold text-red-800">Possível contato duplicado</p>
                  <p className="mt-1 text-[10px] text-red-700">
                    Motivo: {duplicateInfo.reasons.join(', ')}.
                  </p>
                  {duplicateInfo.partnerNames.length > 0 && (
                    <p className="mt-1 text-[10px] text-red-700 truncate">
                      Relacionado com: {duplicateInfo.partnerNames.join(', ')}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <span className="text-gray-500">CPF/CNPJ:</span>
                  <div className="font-medium text-gray-900">{formatCpfCnpj(client)}</div>
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
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/60 border-b border-slate-200">
              <tr>
                {selectionMode && (
                  <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Sel.
                  </th>
                )}
                <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Cliente
                </th>
                <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Tipo
                </th>
                <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  CPF / CNPJ
                </th>
                <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Contato
                </th>
                <th className="px-6 py-3.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Status
                </th>
                <th className="px-6 py-3.5 text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {clients.map((client) => {
                const duplicateInfo = duplicateSummaryMap?.get(client.id);
                const missingFields = missingFieldsMap?.get(client.id) || [];
                const isOutdated = outdatedSet?.has(client.id) ?? false;
                const primaryPhone = client.phone || client.mobile || '';
                const isSelected = selectionMode && Boolean(selectedIds?.has(client.id));
                return (
                <tr key={client.id} className="group hover:bg-slate-50/70 transition-colors cursor-pointer" onClick={() => onView(client)}>
                {selectionMode && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelected?.(client.id)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                )}
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <ClientAvatar client={client} size={42} photoUrl={photoUrls?.get(client.id)} />
                    <div className="ml-4">
                      <div className="text-sm font-semibold text-slate-900">{client.full_name}</div>
                      <div className="text-xs text-slate-500">{client.profession || (client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica')}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {duplicateInfo && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            <AlertTriangle className="w-3 h-3" />
                            Possível duplicado: {duplicateInfo.reasons.join(', ')}
                          </span>
                        )}
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
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    {client.client_type === 'pessoa_fisica' ? (
                      <><User className="w-3 h-3 text-slate-400" /> Pessoa Física</>
                    ) : (
                      <><Building2 className="w-3 h-3 text-slate-400" /> Pessoa Jurídica</>
                    )}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatCpfCnpj(client)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {primaryPhone ? (
                      <>
                        <a
                          href={`https://wa.me/${primaryPhone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                          title={`WhatsApp: ${primaryPhone}`}
                        >
                          <MessageCircle className="w-4 h-4" />
                        </a>
                        <span className="text-xs text-slate-600 tabular-nums">{primaryPhone}</span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Sem contato</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ${
                    client.status === 'ativo'
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : client.status === 'inativo'
                      ? 'bg-slate-100 text-slate-600 ring-slate-200'
                      : 'bg-amber-50 text-amber-700 ring-amber-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      client.status === 'ativo' ? 'bg-emerald-500' :
                      client.status === 'inativo' ? 'bg-slate-400' :
                      'bg-amber-500'
                    }`} />
                    {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onView(client); }}
                      className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition"
                      title="Ver detalhes"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(client); }}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition"
                      title="Editar"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(client.id); }}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition"
                      title="Desativar"
                    >
                      <Trash2 className="w-4 h-4" />
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
