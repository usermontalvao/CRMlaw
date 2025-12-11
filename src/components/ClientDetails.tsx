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

  const InfoItem = (label: string, value?: React.ReactNode) => (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-900 mt-0.5">{value ?? 'Não informado'}</p>
    </div>
  );

  return (
    <div className="w-full rounded-2xl bg-white shadow-xl border border-slate-200 text-xs sm:text-sm">
      <div className="p-5 sm:p-7 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-slate-400">Status</p>
            <span
              className={`mt-2 inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-semibold ${
                client.status === 'ativo'
                  ? 'bg-emerald-100 text-emerald-700'
                  : client.status === 'inativo'
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {client.status.charAt(0).toUpperCase() + client.status.slice(1)}
            </span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-slate-400">Tipo</p>
            <p className="text-sm font-semibold text-slate-900 mt-2">
              {client.client_type === 'pessoa_fisica' ? 'Pessoa Física' : 'Pessoa Jurídica'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-slate-400">Cliente desde</p>
            <p className="text-sm font-semibold text-slate-900 mt-2">{formatDate(client.created_at)}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
          <h3 className="text-slate-900 text-base font-semibold">Ações rápidas</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {onCreateProcess && (
              <button
                onClick={onCreateProcess}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Novo Processo
              </button>
            )}
            {onCreateRequirement && (
              <button
                onClick={onCreateRequirement}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Novo Requerimento
              </button>
            )}
            {onCreateDeadline && (
              <button
                onClick={onCreateDeadline}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Novo Prazo
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-slate-900 text-base font-semibold">Dados pessoais</h3>
              {(missingFields.length > 0 || isOutdated) && (
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  {missingFields.length > 0 && (
                    <span className="text-amber-600">{missingFields.length} pendências</span>
                  )}
                  {isOutdated && <span className="text-sky-600">Dados desatualizados</span>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 text-left">
              {InfoItem(client.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ', formattedCpfCnpj || 'Não informado')}
              {client.client_type === 'pessoa_fisica' && InfoItem('RG', client.rg || 'Não informado')}
              {client.client_type === 'pessoa_fisica' && InfoItem('Nascimento', formatDate(client.birth_date))}
              {InfoItem('Nacionalidade', client.nationality || 'Não informado')}
              {client.client_type === 'pessoa_fisica' &&
                InfoItem('Estado civil', getMaritalStatusLabel(client.marital_status))}
              {InfoItem('Profissão', client.profession || 'Não informado')}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
            <h3 className="text-slate-900 text-base font-semibold">Contato</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {InfoItem('Email', client.email || 'Não informado')}
              <div>
                {InfoItem('Telefone / WhatsApp', formattedPhone || 'Não informado')}
                {whatsappLink && (
                  <a
                    href={whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex text-[11px] font-semibold text-blue-600 hover:underline"
                  >
                    Abrir no WhatsApp
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
            <h3 className="text-slate-900 text-base font-semibold">Endereço</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {InfoItem('Rua', client.address_street || 'Não informado')}
              {InfoItem('Número', client.address_number || 'Não informado')}
              {InfoItem('Bairro', client.address_neighborhood || 'Não informado')}
              {InfoItem('Cidade', client.address_city || 'Não informado')}
              {InfoItem('UF', client.address_state || 'Não informado')}
              {InfoItem('CEP', client.address_zip_code || 'Não informado')}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <h3 className="text-slate-900 text-base font-semibold mb-4">Informações do sistema</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {InfoItem('Cadastro', formatDateTime(client.created_at))}
              {InfoItem('Última atualização', formatDateTime(client.updated_at))}
              {InfoItem('ID interno', client.id.slice(0, 8).toUpperCase())}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
            <h3 className="text-slate-900 text-base font-semibold">Processos vinculados</h3>
            {relationsLoading ? (
              <div className="py-4 flex items-center text-slate-500 gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando processos...
              </div>
            ) : processes.length === 0 ? (
              <p className="text-slate-500 text-sm">Nenhum processo vinculado a este cliente.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {processes.map((process) => (
                  <div key={process.id} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{process.process_code || 'Código não informado'}</p>
                        <p className="text-xs text-slate-500">{capitalizeSentence(process.practice_area)}</p>
                      </div>
                      <span className="px-3 py-1 inline-flex text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
                        {capitalizeSentence(process.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-3">
            <h3 className="text-slate-900 text-base font-semibold">Requerimentos vinculados</h3>
            {relationsLoading ? (
              <div className="py-4 flex items-center text-slate-500 gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando requerimentos...
              </div>
            ) : requirements.length === 0 ? (
              <p className="text-slate-500 text-sm">Nenhum requerimento vinculado a este cliente.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {requirements.map((requirement) => (
                  <div key={requirement.id} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{requirement.protocol || 'Sem protocolo'}</p>
                        <p className="text-xs text-slate-500">Beneficiário: {requirement.beneficiary}</p>
                      </div>
                      <span className="px-3 py-1 inline-flex text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">
                        {capitalizeSentence(requirement.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientDetails;
