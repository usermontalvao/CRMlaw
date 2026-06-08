import React, { useState, useEffect } from 'react';
import { X, Save, Calendar } from 'lucide-react';
import { clientService } from '../services/client.service';
import type { Client, CreateClientDTO, ClientType, MaritalStatus } from '../types/client.types';

const inputClass =
  'w-full px-3 py-1.5 rounded-md border border-slate-200 dark:border-zinc-700 ' +
  'bg-white dark:bg-zinc-800 text-sm text-slate-800 dark:text-zinc-100 ' +
  'placeholder-slate-400 focus:outline-0 focus:ring-1 focus:ring-orange-500 focus:border-orange-500';

const labelClass = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-0.5';

interface ClientFormProps {
  client: Client | null;
  prefill?: Partial<CreateClientDTO> | null;
  onBack: () => void;
  onSave: (savedClient: Client) => void;
  variant?: 'standalone' | 'modal';
}

import { maskCpfInput } from '../utils/formatters';

// Máscara telefone
const applyPhoneMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10)
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(
    3,
    7,
  )}-${numbers.slice(7, 11)}`;
};

// Máscara CNPJ
const applyCnpjMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 14);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 5) return `${numbers.slice(0, 2)}.${numbers.slice(2)}`;
  if (numbers.length <= 8)
    return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5)}`;
  if (numbers.length <= 12)
    return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(
      5,
      8,
    )}/${numbers.slice(8)}`;
  return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(
    5,
    8,
  )}/${numbers.slice(8, 12)}-${numbers.slice(12, 14)}`;
};

const ClientForm: React.FC<ClientFormProps> = ({
  client,
  prefill,
  onBack,
  onSave,
  variant = 'standalone',
}) => {
  const [loading, setLoading] = useState(false);
  const [isCepLoading, setIsCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [lastCepConsulted, setLastCepConsulted] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreateClientDTO>({
    full_name: '',
    client_type: 'pessoa_fisica',
    cpf_cnpj: '',
    rg: '',
    birth_date: '',
    nationality: 'brasileiro (a)',
    marital_status: undefined,
    profession: '',
    email: '',
    phone: '',
    mobile: '',
    address_street: '',
    address_number: '',
    address_complement: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    address_zip_code: '',
    notes: '',
    status: 'ativo',
  });

  // Prefill quando editar
  useEffect(() => {
    if (client) {
      const rawCpfCnpj = client.cpf_cnpj || '';
      const maskedCpfCnpj =
        client.client_type === 'pessoa_fisica'
          ? maskCpfInput(rawCpfCnpj)
          : applyCnpjMask(rawCpfCnpj);

      const rawPhone = client.phone || client.mobile || '';
      const maskedPhone = applyPhoneMask(rawPhone);

      setFormData({
        full_name: client.full_name,
        client_type: client.client_type,
        cpf_cnpj: maskedCpfCnpj,
        rg: client.rg,
        birth_date: client.birth_date,
        nationality: client.nationality,
        marital_status: client.marital_status,
        profession: client.profession,
        email: client.email,
        phone: maskedPhone,
        mobile: maskedPhone,
        address_street: client.address_street,
        address_number: client.address_number,
        address_complement: client.address_complement,
        address_neighborhood: client.address_neighborhood,
        address_city: client.address_city,
        address_state: client.address_state,
        address_zip_code: client.address_zip_code,
        notes: client.notes,
        status: client.status,
      });
      setCepError(null);
      setLastCepConsulted(null);
    }
  }, [client]);

  // Prefill de outro fluxo (ex: veio de lead)
  useEffect(() => {
    if (!client && prefill) {
      setFormData((prev) => ({
        ...prev,
        ...prefill,
        client_type: prefill.client_type ?? prev.client_type,
        status: prefill.status ?? prev.status,
        phone: prefill.phone || prefill.mobile || prev.phone,
        mobile: prefill.phone || prefill.mobile || prev.mobile,
      }));
    }
  }, [client, prefill]);

  const lookupCep = async (cep?: string) => {
    const rawCep = (cep || formData.address_zip_code || '').replace(/\D/g, '');

    if (rawCep.length !== 8) {
      setCepError('Informe um CEP válido com 8 dígitos.');
      return;
    }

    try {
      setIsCepLoading(true);
      setCepError(null);
      setLastCepConsulted(rawCep);

      const response = await fetch(`https://viacep.com.br/ws/${rawCep}/json/`);

      if (!response.ok) {
        throw new Error('Erro ao consultar CEP');
      }

      const data = await response.json();

      if (data?.erro) {
        setCepError('CEP não encontrado. Verifique e tente novamente.');
        return;
      }

      setFormData((prev) => ({
        ...prev,
        address_zip_code: data.cep || prev.address_zip_code,
        address_street: data.logradouro || prev.address_street,
        address_neighborhood: data.bairro || prev.address_neighborhood,
        address_city: data.localidade || prev.address_city,
        address_state: data.uf || prev.address_state,
        address_complement: prev.address_complement || data.complemento || '',
      }));
    } catch (error) {
      console.error('Erro ao buscar CEP:', error);
      setCepError('Não foi possível consultar o CEP. Tente novamente.');
    } finally {
      setIsCepLoading(false);
    }
  };

  // Auto-consulta CEP quando completar 8 dígitos
  useEffect(() => {
    const rawCep = (formData.address_zip_code || '').replace(/\D/g, '');

    if (rawCep.length === 8 && rawCep !== lastCepConsulted && !isCepLoading) {
      lookupCep(rawCep);
    }

    if (rawCep.length < 8 && lastCepConsulted) {
      setLastCepConsulted(null);
    }
  }, [formData.address_zip_code, lastCepConsulted, isCepLoading]);

  const handleChange = (field: keyof CreateClientDTO, value: any) => {
    if (field === 'address_zip_code') {
      const digits = (value as string).replace(/\D/g, '').slice(0, 8);
      const formatted =
        digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      setCepError(null);
      setFormData((prev) => ({ ...prev, address_zip_code: formatted }));
      return;
    }

    if (field === 'full_name') {
      setFormData((prev) => ({ ...prev, full_name: (value as string).toUpperCase() }));
      return;
    }

    if (field === 'address_state') {
      const uf = (value as string).toUpperCase().slice(0, 2);
      setFormData((prev) => ({ ...prev, address_state: uf }));
      return;
    }

    if (field === 'phone') {
      setFormData((prev) => ({ ...prev, phone: value, mobile: value }));
      return;
    }

    if (field === 'mobile') {
      setFormData((prev) => ({ ...prev, phone: value, mobile: value }));
      return;
    }

    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const cleanedData: any = { ...formData };

      if (!cleanedData.birth_date) delete cleanedData.birth_date;
      if (!cleanedData.rg) delete cleanedData.rg;
      if (!cleanedData.cpf_cnpj) delete cleanedData.cpf_cnpj;
      if (!cleanedData.marital_status) delete cleanedData.marital_status;
      if (!cleanedData.profession) delete cleanedData.profession;
      if (!cleanedData.nationality) delete cleanedData.nationality;

      const stripDigits = (value?: string) =>
        value ? value.replace(/\D/g, '') : '';

      if (cleanedData.cpf_cnpj) {
        const numericCpfCnpj = stripDigits(cleanedData.cpf_cnpj);
        if (numericCpfCnpj) {
          cleanedData.cpf_cnpj = numericCpfCnpj;
        } else {
          delete cleanedData.cpf_cnpj;
        }
      }

      const phoneDigits = stripDigits(
        cleanedData.phone || cleanedData.mobile || '',
      );
      if (phoneDigits) {
        cleanedData.phone = phoneDigits;
        cleanedData.mobile = phoneDigits;
      } else {
        delete cleanedData.phone;
        delete cleanedData.mobile;
      }

      let savedClient: Client;
      if (client) {
        savedClient = await clientService.updateClient(client.id, cleanedData);
      } else {
        savedClient = await clientService.createClient(cleanedData);
      }

      onSave(savedClient);
    } catch (error: any) {
      console.error('Erro ao salvar cliente:', error);
      alert(error.message || 'Erro ao salvar cliente');
    } finally {
      setLoading(false);
    }
  };

  const isPessoaFisica = formData.client_type === 'pessoa_fisica';
  const isModalVariant = variant === 'modal';

  return (
    <div className={`w-full bg-white font-display ${isModalVariant ? '' : 'min-h-full'}`}>
      {!isModalVariant && (
        <>
          <div className="h-1 w-full bg-orange-500" />
          <div className="px-4 py-3 border-b border-slate-200">
            <h1 className="text-lg font-bold text-slate-900">
              {client ? 'Editar Cliente' : 'Novo Cliente'}
            </h1>
            <p className="text-xs text-slate-500">Preencha os dados para cadastrar</p>
          </div>
        </>
      )}

      <form
        id="client-form"
        onSubmit={handleSubmit}
        className={`flex flex-col ${isModalVariant ? '' : 'min-h-[calc(100vh-64px)]'}`}
      >
        {/* Body */}
        <div className="px-5 py-3 space-y-3 flex-1">

          {/* Client Type toggle */}
          <div className="flex gap-3 items-center">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Tipo:</span>
            <div className="flex p-0.5 rounded-md bg-slate-100 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => handleChange('client_type', 'pessoa_fisica' as ClientType)}
                className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                  isPessoaFisica
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10'
                }`}
              >
                Pessoa Física
              </button>
              <button
                type="button"
                onClick={() => handleChange('client_type', 'pessoa_juridica' as ClientType)}
                className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                  !isPessoaFisica
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10'
                }`}
              >
                Pessoa Jurídica
              </button>
            </div>
          </div>

          {/* Dados Pessoais */}
          <div className="space-y-1.5">
            <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">Dados Pessoais</h2>
            {isPessoaFisica ? (
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <label className="flex flex-col col-span-6">
                  <span className={labelClass}>Nome Completo</span>
                  <input type="text" required className={inputClass} value={formData.full_name} onChange={(e) => handleChange('full_name', e.target.value)} />
                </label>
                <label className="flex flex-col col-span-2">
                  <span className={labelClass}>CPF</span>
                  <input type="text" className={inputClass} value={formData.cpf_cnpj} onChange={(e) => handleChange('cpf_cnpj', maskCpfInput(e.target.value))} maxLength={14} />
                </label>
                <label className="flex flex-col col-span-2">
                  <span className={labelClass}>RG</span>
                  <input type="text" className={inputClass} value={formData.rg} onChange={(e) => handleChange('rg', e.target.value)} />
                </label>
                <label className="flex flex-col col-span-2">
                  <span className={labelClass}>Nascimento</span>
                  <input
                    type="date"
                    className={`${inputClass} appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden [&::-webkit-clear-button]:hidden`}
                    value={formData.birth_date}
                    onChange={(e) => handleChange('birth_date', e.target.value)}
                  />
                </label>
                <label className="flex flex-col col-span-3">
                  <span className={labelClass}>Estado Civil</span>
                  <select
                    className={`${inputClass} appearance-none`}
                    value={formData.marital_status || ''}
                    onChange={(e) => handleChange('marital_status', e.target.value as MaritalStatus)}
                  >
                    <option value="">Selecione</option>
                    <option value="solteiro">Solteiro(a)</option>
                    <option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option>
                    <option value="viuvo">Viúvo(a)</option>
                    <option value="uniao_estavel">União Estável</option>
                  </select>
                </label>
                <label className="flex flex-col col-span-6">
                  <span className={labelClass}>Email</span>
                  <input type="email" className={inputClass} value={formData.email} onChange={(e) => handleChange('email', e.target.value)} />
                </label>
                <label className="flex flex-col col-span-3">
                  <span className={labelClass}>Telefone</span>
                  <input type="tel" className={inputClass} value={formData.phone} onChange={(e) => handleChange('phone', applyPhoneMask(e.target.value))} maxLength={16} />
                </label>
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-x-3 gap-y-2">
                <label className="flex flex-col col-span-7">
                  <span className={labelClass}>Razão Social</span>
                  <input type="text" required className={inputClass} value={formData.full_name} onChange={(e) => handleChange('full_name', e.target.value)} />
                </label>
                <label className="flex flex-col col-span-5">
                  <span className={labelClass}>CNPJ</span>
                  <input type="text" className={inputClass} value={formData.cpf_cnpj} onChange={(e) => handleChange('cpf_cnpj', applyCnpjMask(e.target.value))} maxLength={18} />
                </label>
                <label className="flex flex-col col-span-8">
                  <span className={labelClass}>Email</span>
                  <input type="email" className={inputClass} value={formData.email} onChange={(e) => handleChange('email', e.target.value)} />
                </label>
                <label className="flex flex-col col-span-4">
                  <span className={labelClass}>Telefone</span>
                  <input type="tel" className={inputClass} value={formData.phone} onChange={(e) => handleChange('phone', applyPhoneMask(e.target.value))} maxLength={16} />
                </label>
              </div>
            )}
          </div>

          {/* Endereço */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">Endereço</h3>
            {cepError && <span className="text-xs text-red-500 block">{cepError}</span>}
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <label className="flex flex-col col-span-2">
                <span className={labelClass}>CEP</span>
                <input type="text" className={inputClass} value={formData.address_zip_code} onChange={(e) => handleChange('address_zip_code', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-6">
                <span className={labelClass}>Rua</span>
                <input type="text" className={inputClass} value={formData.address_street} onChange={(e) => handleChange('address_street', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-2">
                <span className={labelClass}>Nº</span>
                <input type="text" className={inputClass} value={formData.address_number} onChange={(e) => handleChange('address_number', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-2">
                <span className={labelClass}>Compl.</span>
                <input type="text" className={inputClass} value={formData.address_complement} onChange={(e) => handleChange('address_complement', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-4">
                <span className={labelClass}>Bairro</span>
                <input type="text" className={inputClass} value={formData.address_neighborhood} onChange={(e) => handleChange('address_neighborhood', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-6">
                <span className={labelClass}>Cidade</span>
                <input type="text" className={inputClass} value={formData.address_city} onChange={(e) => handleChange('address_city', e.target.value)} />
              </label>
              <label className="flex flex-col col-span-2">
                <span className={labelClass}>UF</span>
                <input type="text" className={`${inputClass} uppercase`} value={formData.address_state} onChange={(e) => handleChange('address_state', e.target.value)} maxLength={2} />
              </label>
            </div>
          </div>

          {/* Status e Observações */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-bold tracking-wider uppercase text-slate-400 dark:text-slate-500">Status e Observações</h3>
            <div className="grid grid-cols-12 gap-x-3 gap-y-2">
              <div className="flex flex-col col-span-4">
                <span className={labelClass}>Status</span>
                <div className="flex p-0.5 rounded-md bg-slate-100 dark:bg-zinc-800 h-[calc(1.75rem+2px)]">
                  {(['ativo', 'inativo', 'suspenso'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleChange('status', s)}
                      className={`flex-1 text-xs font-medium rounded transition-all capitalize ${
                        formData.status === s
                          ? 'bg-orange-500 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col col-span-8">
                <span className={labelClass}>Observações</span>
                <textarea
                  rows={2}
                  className={`${inputClass} resize-none`}
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        <div
          className={`w-full border-t border-slate-200 dark:border-zinc-800 px-5 py-3 flex justify-end gap-2 bg-white dark:bg-zinc-900 ${
            isModalVariant ? '' : 'sticky bottom-0 left-0'
          }`}
        >
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Salvar Cliente'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClientForm;
