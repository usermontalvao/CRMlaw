import React from 'react';
import { ArrowLeft, User, Building2, Mail, Phone, MapPin, Calendar, FileText, Edit, MessageCircle, Briefcase, Scale, FileCheck, Plus, Clock, FolderPlus, Gavel, Loader2, ClipboardList, AlertCircle } from 'lucide-react';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { Requirement } from '../types/requirement.types';

interface ClientDetailsProps {
  client: Client;
  processes: Process[];
  requirements: Requirement[];
  relationsLoading?: boolean;
  onBack: () => void;
  onEdit: () => void;
  onCreateProcess?: () => void;
  onCreateRequirement?: () => void;
  onCreateDeadline?: () => void;
  missingFields?: string[];
  isOutdated?: boolean;
}

const capitalizeSentence = (value: string) =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const formatCpf = (value: string) => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
  if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
  return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
};

const formatCnpj = (value: string) => {
  const numbers = value.replace(/\D/g, '').slice(0, 14);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 5) return `${numbers.slice(0, 2)}.${numbers.slice(2)}`;
  if (numbers.length <= 8) return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5)}`;
  if (numbers.length <= 12) return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5, 8)}/${numbers.slice(8)}`;
  return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5, 8)}/${numbers.slice(8, 12)}-${numbers.slice(12, 14)}`;
};

const formatPhone = (value: string) => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

const ClientDetails: React.FC<ClientDetailsProps> = ({ client, processes, requirements, relationsLoading, onBack, onEdit, onCreateProcess, onCreateRequirement, onCreateDeadline, missingFields = [], isOutdated = false }) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  const rawCpfCnpj = client.cpf_cnpj || '';
  const formattedCpfCnpj = client.client_type === 'pessoa_fisica' ? formatCpf(rawCpfCnpj) : formatCnpj(rawCpfCnpj);

  const primaryPhone = client.phone || client.mobile || '';
  const formattedPhone = primaryPhone ? formatPhone(primaryPhone) : '';
  const whatsappLink = primaryPhone ? `https://wa.me/${primaryPhone.replace(/\D/g, '')}` : null;

  const getMaritalStatusLabel = (status?: string) => {
    const labels: Record<string, string> = {
      solteiro: 'solteiro(a)',
      casado: 'casado(a)',
      divorciado: 'divorciado(a)',
      viuvo: 'viúvo(a)',
      uniao_estavel: 'união estável',
    };
    return status ? labels[status] || status : 'N/A';
  };

  return (
    <div className="space-y-3 sm:space-y-6 p-3 sm:p-0">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-6">
        <div className="flex items-center justify-between mb-3 sm:mb-6">
          <button onClick={onBack} className="flex items-center gap-1 sm:gap-2 text-gray-600 hover:text-gray-900 transition-colors text-sm sm:text-base">
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Voltar</span>
          </button>
          <button onClick={onEdit} className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-blue-600 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-blue-700 transition">
            <Edit className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Editar</span>
          </button>
        </div>

        {(missingFields.length > 0 || isOutdated) && (
          <div className="space-y-2 sm:space-y-3 mb-3 sm:mb-6">
            {missingFields.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 sm:px-4 sm:py-3 text-amber-800">
                <p className="text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2">
                  <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4" /> Dados pendentes
                </p>
                <p className="text-[10px] sm:text-sm mt-1 hidden sm:block">Complete os seguintes campos: {missingFields.join(', ')}.</p>
              </div>
            )}
            {isOutdated && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 sm:px-4 sm:py-3 text-sky-800">
                <p className="text-xs sm:text-sm font-semibold flex items-center gap-1 sm:gap-2">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" /> Desatualizado
                </p>
                <p className="text-[10px] sm:text-sm mt-1 hidden sm:block">Última atualização antiga. Revise e confirme os dados do cliente.</p>
              </div>
            )}
          </div>
        )}

        {/* Ações Rápidas */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 sm:mb-6 pb-3 sm:pb-6 border-b border-gray-200">
          <p className="text-xs sm:text-sm font-semibold text-gray-700 w-full sm:w-auto mb-1 sm:mb-0">Ações:</p>
          {onCreateProcess && (
            <button
              onClick={onCreateProcess}
              className="inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-blue-600 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
            >
              <Scale className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Novo</span> Processo
            </button>
          )}
          {onCreateRequirement && (
            <button
              onClick={onCreateRequirement}
              className="inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-purple-600 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-purple-700 transition"
            >
              <FileCheck className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Novo</span> Requerimento
            </button>
          )}
          {onCreateDeadline && (
            <button
              onClick={onCreateDeadline}
              className="inline-flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 sm:py-2 bg-amber-600 text-white text-xs sm:text-sm font-semibold rounded-lg hover:bg-amber-700 transition"
            >
              <Clock className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Novo</span> Prazo
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-6">
          <div className={`flex-shrink-0 h-20 w-20 rounded-full flex items-center justify-center ${
            client.client_type === 'pessoa_fisica' 
              ? 'bg-blue-100 text-blue-600' 
              : 'bg-purple-100 text-purple-600'
          }`}>
            {client.client_type === 'pessoa_fisica' ? (
              <User className="w-10 h-10" />
            ) : (
              <Building2 className="w-10 h-10" />
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{client.full_name}</h1>
              <span className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${
                client.status === 'ativo'
                  ? 'bg-green-100 text-green-800'
                  : client.status === 'inativo'
                  ? 'bg-gray-100 text-gray-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
              </span>
            </div>
            <p className="text-gray-600">
              {client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
              {client.profession && ` • ${client.profession}`}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Cliente desde {formatDate(client.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Informações Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Dados Pessoais */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <User className="w-6 h-6 text-primary-600" />
            Dados Pessoais
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-500">
                {client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'}
              </label>
              <p className="text-gray-900">{formattedCpfCnpj || 'Não informado'}</p>
            </div>

            {client.client_type === 'pessoa_fisica' && (
              <>
                <div>
                  <label className="text-sm font-medium text-gray-500">RG</label>
                  <p className="text-gray-900">{client.rg || 'Não informado'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Data de Nascimento</label>
                  <p className="text-gray-900">{formatDate(client.birth_date)}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Nacionalidade</label>
                  <p className="text-gray-900">{client.nationality || 'Não informado'}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Estado Civil</label>
                  <p className="text-gray-900">{getMaritalStatusLabel(client.marital_status)}</p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Profissão</label>
                  <p className="text-gray-900">{client.profession || 'Não informado'}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dados de Contato */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Phone className="w-6 h-6 text-primary-600" />
            Contato
          </h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary-50 text-primary-600">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Email</p>
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="text-gray-900 hover:text-primary-600 transition-colors">
                    {client.email}
                  </a>
                ) : (
                  <p className="text-sm text-gray-400">Não informado</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Telefone / WhatsApp</p>
                {formattedPhone ? (
                  <div className="flex items-center gap-2">
                    <a href={`tel:${primaryPhone.replace(/\s/g, '')}`} className="text-gray-900 hover:text-primary-600 transition-colors">
                      {formattedPhone}
                    </a>
                    {whatsappLink && (
                      <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-600 hover:underline"
                      >
                        Abrir WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Não informado</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Endereço */}
      <div className="card">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MapPin className="w-6 h-6 text-primary-600" />
          Endereço
        </h2>
        {client.address_street ? (
          <div className="space-y-2">
            <p className="text-gray-900">
              {client.address_street}, {client.address_number}
              {client.address_complement && ` - ${client.address_complement}`}
            </p>
            <p className="text-gray-900">
              {client.address_neighborhood}
            </p>
            <p className="text-gray-900">
              {client.address_city} - {client.address_state}
            </p>
            <p className="text-gray-900">
              CEP: {client.address_zip_code}
            </p>
          </div>
        ) : (
          <p className="text-gray-500">Endereço não informado</p>
        )}
      </div>

      {/* Observações */}
      {client.notes && (
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary-600" />
            Observações
          </h2>
          <p className="text-gray-700 whitespace-pre-wrap">{client.notes}</p>
        </div>
      )}

      {/* Processos vinculados */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Gavel className="w-6 h-6 text-primary-600" />
            Processos vinculados
          </h2>
        </div>
        {relationsLoading ? (
          <div className="py-6 flex items-center justify-center text-gray-500 gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando processos...
          </div>
        ) : processes.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum processo vinculado a este cliente.</p>
        ) : (
          <div className="space-y-3">
            {processes.map((process) => (
              <div key={process.id} className="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{process.process_code || 'Código não informado'}</p>
                    <p className="text-xs text-gray-500">{capitalizeSentence(process.practice_area)}</p>
                  </div>
                  <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-700">
                    {capitalizeSentence(process.status)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600 mt-3">
                  <div>
                    <span className="font-medium text-gray-700 block">Distribuído</span>
                    {process.distributed_at ? formatDate(process.distributed_at) : '—'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 block">Responsável</span>
                    {process.responsible_lawyer || 'Não informado'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 block">Vara / Comarca</span>
                    {process.court || 'Não informado'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Requerimentos vinculados */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary-600" />
            Requerimentos vinculados
          </h2>
        </div>
        {relationsLoading ? (
          <div className="py-6 flex items-center justify-center text-gray-500 gap-2 text-sm">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando requerimentos...
          </div>
        ) : requirements.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum requerimento vinculado a este cliente.</p>
        ) : (
          <div className="space-y-3">
            {requirements.map((requirement) => (
              <div key={requirement.id} className="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {requirement.protocol || 'Sem protocolo'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Beneficiário: {requirement.beneficiary}
                    </p>
                  </div>
                  <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-700">
                    {capitalizeSentence(requirement.status)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600 mt-3">
                  <div>
                    <span className="font-medium text-gray-700 block">CPF</span>
                    {requirement.cpf || '—'}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 block">Tipo de benefício</span>
                    {capitalizeSentence(requirement.benefit_type)}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700 block">Entrada</span>
                    {requirement.entry_date ? formatDate(requirement.entry_date) : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Informações do Sistema */}
      <div className="card bg-gray-50">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <AlertCircle className="w-6 h-6 text-gray-600" />
          Informações do Sistema
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Data de Cadastro
            </label>
            <p className="text-gray-900">{formatDate(client.created_at)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-500 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Última Atualização
            </label>
            <p className="text-gray-900">{formatDate(client.updated_at)}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-500">ID do Cliente</label>
            <p className="text-gray-900 font-mono text-sm">{client.id}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDetails;
