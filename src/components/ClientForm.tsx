import React, { useState, useEffect } from 'react';
import { X, Save, User, Building2 } from 'lucide-react';
import { clientService } from '../services/client.service';
import type { Client, CreateClientDTO, ClientType, MaritalStatus } from '../types/client.types';

// Estilos minimalistas
const inputClass =
  'w-full h-10 px-3 rounded-lg text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 ' +
  'text-zinc-900 dark:text-white placeholder:text-zinc-400 ' +
  'focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors';

const labelClass = 'block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5';

interface ClientFormProps {
  client: Client | null;
  prefill?: Partial<CreateClientDTO> | null;
  onBack: () => void;
  onSave: (savedClient: Client) => void;
}

// Máscara CPF
const applyCpfMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
  if (numbers.length <= 9)
    return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
  return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(
    6,
    9,
  )}-${numbers.slice(9, 11)}`;
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

const ClientForm: React.FC<ClientFormProps> = ({
  client,
  prefill,
  onBack,
  onSave,
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
          ? applyCpfMask(rawCpfCnpj)
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

  return (
    <div className="w-full max-w-4xl mx-auto bg-white dark:bg-[#1a1a1a] rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
      {/* HEADER */}
      <div className="flex justify-between items-center px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
            {client ? 'Editar Cliente' : 'Novo Cliente'}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">Preencha os dados para cadastrar</p>
        </div>
        <button type="button" onClick={onBack} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* TIPO DE CLIENTE */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleChange('client_type', 'pessoa_fisica' as ClientType)}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${
                isPessoaFisica
                  ? 'bg-emerald-500 text-white dark:bg-red-500 dark:text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              Pessoa Física
            </button>
            <button
              type="button"
              onClick={() => handleChange('client_type', 'pessoa_juridica' as ClientType)}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all ${
                !isPessoaFisica
                  ? 'bg-emerald-500 text-white dark:bg-red-500 dark:text-white'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              Pessoa Jurídica
            </button>
          </div>

          {/* DADOS PRINCIPAIS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className={labelClass}>{isPessoaFisica ? 'Nome Completo' : 'Razão Social'}</label>
              <input type="text" required className={inputClass} value={formData.full_name} onChange={(e) => handleChange('full_name', e.target.value)} placeholder={isPessoaFisica ? 'Nome completo' : 'Razão social'} />
            </div>
            <div>
              <label className={labelClass}>{isPessoaFisica ? 'CPF' : 'CNPJ'}</label>
              <input type="text" className={inputClass} value={formData.cpf_cnpj} onChange={(e) => handleChange('cpf_cnpj', isPessoaFisica ? applyCpfMask(e.target.value) : applyCnpjMask(e.target.value))} placeholder={isPessoaFisica ? '000.000.000-00' : '00.000.000/0000-00'} maxLength={isPessoaFisica ? 14 : 18} />
            </div>
            {isPessoaFisica && (
              <div>
                <label className={labelClass}>RG</label>
                <input type="text" className={inputClass} value={formData.rg} onChange={(e) => handleChange('rg', e.target.value)} placeholder="" />
              </div>
            )}
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" className={inputClass} value={formData.email} onChange={(e) => handleChange('email', e.target.value)} placeholder="email@exemplo.com" />
            </div>
            <div>
              <label className={labelClass}>Telefone</label>
              <input type="tel" className={inputClass} value={formData.phone} onChange={(e) => handleChange('phone', applyPhoneMask(e.target.value))} placeholder="(00) 0 0000-0000" maxLength={16} />
            </div>
          </div>

          {/* DADOS PESSOAIS (apenas PF) */}
          {isPessoaFisica && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className={labelClass}>Nascimento</label>
                <input type="date" className={inputClass} value={formData.birth_date} onChange={(e) => handleChange('birth_date', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Estado Civil</label>
                <select className={inputClass} value={formData.marital_status || ''} onChange={(e) => handleChange('marital_status', e.target.value as MaritalStatus)}>
                  <option value="">Selecione</option>
                  <option value="solteiro">Solteiro(a)</option>
                  <option value="casado">Casado(a)</option>
                  <option value="divorciado">Divorciado(a)</option>
                  <option value="viuvo">Viúvo(a)</option>
                  <option value="uniao_estavel">União Estável</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Nacionalidade</label>
                <input type="text" className={inputClass} value={formData.nationality} onChange={(e) => handleChange('nationality', e.target.value)} placeholder="Brasileiro(a)" />
              </div>
              <div>
                <label className={labelClass}>Profissão</label>
                <input type="text" className={inputClass} value={formData.profession} onChange={(e) => handleChange('profession', e.target.value)} placeholder="" />
              </div>
            </div>
          )}

          {/* ENDEREÇO */}
          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Endereço</span>
              {cepError && <span className="text-xs text-red-500">{cepError}</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="relative">
                <label className={labelClass}>CEP</label>
                <input type="text" className={inputClass} value={formData.address_zip_code} onChange={(e) => handleChange('address_zip_code', e.target.value)} placeholder="" />
                {isCepLoading && <div className="absolute right-3 top-8 h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />}
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Rua</label>
                <input type="text" className={inputClass} value={formData.address_street} onChange={(e) => handleChange('address_street', e.target.value)} placeholder="" />
              </div>
              <div>
                <label className={labelClass}>Nº</label>
                <input type="text" className={inputClass} value={formData.address_number} onChange={(e) => handleChange('address_number', e.target.value)} placeholder="" />
              </div>
              <div>
                <label className={labelClass}>Compl.</label>
                <input type="text" className={inputClass} value={formData.address_complement} onChange={(e) => handleChange('address_complement', e.target.value)} placeholder="" />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Bairro</label>
                <input type="text" className={inputClass} value={formData.address_neighborhood} onChange={(e) => handleChange('address_neighborhood', e.target.value)} placeholder="" />
              </div>
              <div className="md:col-span-3">
                <label className={labelClass}>Cidade</label>
                <input type="text" className={inputClass} value={formData.address_city} onChange={(e) => handleChange('address_city', e.target.value)} placeholder="" />
              </div>
              <div>
                <label className={labelClass}>UF</label>
                <input type="text" className={`${inputClass} uppercase text-center`} value={formData.address_state} onChange={(e) => handleChange('address_state', e.target.value)} maxLength={2} placeholder="" />
              </div>
            </div>
          </div>

          {/* STATUS E OBSERVAÇÕES */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Status</label>
              <select className={inputClass} value={formData.status} onChange={(e) => handleChange('status', e.target.value)}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
                <option value="suspenso">Suspenso</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Observações</label>
              <input type="text" className={inputClass} value={formData.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="Notas adicionais..." />
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="flex justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={onBack} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />
            {loading ? 'Salvando...' : 'Salvar Cliente'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClientForm;
