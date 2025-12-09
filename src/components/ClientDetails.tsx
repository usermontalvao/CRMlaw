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

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const rawCpfCnpj = client.cpf_cnpj || '';
  const formattedCpfCnpj = client.client_type === 'pessoa_fisica' ? formatCpf(rawCpfCnpj) : formatCnpj(rawCpfCnpj);

  const primaryPhone = client.phone || client.mobile || '';
  const formattedPhone = primaryPhone ? formatPhone(primaryPhone) : '';
  const whatsappLink = primaryPhone ? `https://wa.me/${primaryPhone.replace(/\D/g, '')}` : null;

  const getMaritalStatusLabel = (status?: string) => {
    const labels: Record<string, string> = {
      solteiro: 'Solteiro(a)',
      casado: 'Casado(a)',
      divorciado: 'Divorciado(a)',
      viuvo: 'Viúvo(a)',
      uniao_estavel: 'União Estável',
    };
    return status ? labels[status] || status : 'Não informado';
  };

  return (
    <div className="w-full max-w-4xl mx-auto rounded-xl bg-white shadow-2xl">
      {/* Header com botões */}
      <div className="flex items-center justify-between gap-3 p-6 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-gray-600 bg-white border border-gray-300 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onEdit}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-white bg-[#2b8cee] hover:bg-[#2b8cee]/90"
          >
            <Edit className="w-4 h-4" />
            Editar
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="p-6 space-y-8">
        {/* Nome e Status */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-gray-900 text-2xl font-bold">{client.full_name}</h2>
            <p className="text-gray-500 text-sm">Cliente desde {formatDate(client.created_at)}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-medium ${
              client.status === 'ativo'
                ? 'bg-green-100 text-green-800'
                : client.status === 'inativo'
                ? 'bg-gray-100 text-gray-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}>
              {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
            </span>
            <span className="text-gray-500">
              {client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
            </span>
          </div>
        </div>

        {/* Ações */}
        <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
          <h3 className="text-gray-900 text-base font-bold mb-3">Ações</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {onCreateProcess && (
              <button 
                onClick={onCreateProcess}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100"
              >
                Novo Processo
              </button>
            )}
            {onCreateRequirement && (
              <button 
                onClick={onCreateRequirement}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100"
              >
                Novo Requerimento
              </button>
            )}
            {onCreateDeadline && (
              <button 
                onClick={onCreateDeadline}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100"
              >
                Novo Prazo
              </button>
            )}
          </div>
        </div>

        {/* Grid de informações */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-8">
          {/* Dados Pessoais */}
          <div className="space-y-4">
            <h3 className="text-gray-900 text-lg font-bold">Dados Pessoais</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">{client.client_type === 'pessoa_fisica' ? 'CPF:' : 'CNPJ:'}</span>
                <span className="font-medium text-gray-800">{formattedCpfCnpj || 'Não informado'}</span>
              </div>
              {client.client_type === 'pessoa_fisica' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">RG:</span>
                    <span className="font-medium text-gray-800">{client.rg || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Data de Nascimento:</span>
                    <span className="font-medium text-gray-800">{formatDate(client.birth_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Nacionalidade:</span>
                    <span className="font-medium text-gray-800">{client.nationality || 'Não informado'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Estado Civil:</span>
                    <span className="font-medium text-gray-800">{getMaritalStatusLabel(client.marital_status)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Profissão:</span>
                    <span className="font-medium text-gray-800">{client.profession || 'Não informado'}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Contato */}
          <div className="space-y-4">
            <h3 className="text-gray-900 text-lg font-bold">Contato</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Email:</span>
                <span className="font-medium text-gray-800">{client.email || 'Não informado'}</span>
              </div>
              <div className="flex justify-between items-center">
                <div>
                  <span className="text-gray-500">Telefone / WhatsApp:</span>
                  <p className="font-medium text-gray-800">{formattedPhone || 'Não informado'}</p>
                </div>
                {whatsappLink && (
                  <a 
                    href={whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#2b8cee] text-xs font-semibold hover:underline"
                  >
                    Abrir WhatsApp
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div className="space-y-4">
            <h3 className="text-gray-900 text-lg font-bold">Endereço</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Rua:</span>
                <span className="font-medium text-gray-800">{client.address_street || 'Não informado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Nº:</span>
                <span className="font-medium text-gray-800">{client.address_number || 'Não informado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Bairro:</span>
                <span className="font-medium text-gray-800">{client.address_neighborhood || 'Não informado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Cidade:</span>
                <span className="font-medium text-gray-800">{client.address_city || 'Não informado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">UF:</span>
                <span className="font-medium text-gray-800">{client.address_state || 'Não informado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">CEP:</span>
                <span className="font-medium text-gray-800">{client.address_zip_code || 'Não informado'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Processos e Requerimentos */}
        <div className="space-y-6 pt-4 border-t border-gray-200">
          {/* Processos vinculados */}
          <div>
            <h3 className="text-gray-900 text-lg font-bold mb-2">Processos vinculados</h3>
            {relationsLoading ? (
              <div className="py-4 flex items-center text-gray-500 gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando processos...
              </div>
            ) : processes.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhum processo vinculado a este cliente.</p>
            ) : (
              <div className="space-y-3">
                {processes.map((process) => (
                  <div key={process.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{process.process_code || 'Código não informado'}</p>
                        <p className="text-xs text-gray-500">{capitalizeSentence(process.practice_area)}</p>
                      </div>
                      <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-700">
                        {capitalizeSentence(process.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Requerimentos vinculados */}
          <div>
            <h3 className="text-gray-900 text-lg font-bold mb-2">Requerimentos vinculados</h3>
            {relationsLoading ? (
              <div className="py-4 flex items-center text-gray-500 gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando requerimentos...
              </div>
            ) : requirements.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhum requerimento vinculado a este cliente.</p>
            ) : (
              <div className="space-y-3">
                {requirements.map((requirement) => (
                  <div key={requirement.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{requirement.protocol || 'Sem protocolo'}</p>
                        <p className="text-xs text-gray-500">Beneficiário: {requirement.beneficiary}</p>
                      </div>
                      <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-700">
                        {capitalizeSentence(requirement.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Informações do Sistema */}
        <div className="pt-6 border-t border-gray-200">
          <h3 className="text-gray-900 text-lg font-bold mb-4">Informações do Sistema</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Data de Cadastro:</span>
              <p className="font-medium text-gray-800">{formatDateTime(client.created_at)}</p>
            </div>
            <div>
              <span className="text-gray-500">Última Atualização:</span>
              <p className="font-medium text-gray-800">{formatDateTime(client.updated_at)}</p>
            </div>
            <div>
              <span className="text-gray-500">ID do Cliente:</span>
              <p className="font-medium text-gray-800 font-mono text-xs">{client.id.slice(0, 8).toUpperCase()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDetails;
