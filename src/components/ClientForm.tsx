import React, { useState, useEffect } from 'react';
import { X, Save, User, Building2 } from 'lucide-react';
import { clientService } from '../services/client.service';
import type { Client, CreateClientDTO, ClientType, MaritalStatus } from '../types/client.types';

interface ClientFormProps {
  client: Client | null;
  prefill?: Partial<CreateClientDTO> | null;
  onBack: () => void;
  onSave: (savedClient: Client) => void;
}

// Função para aplicar máscara de CPF
const applyCpfMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
  if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
  return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
};

// Função para aplicar máscara de CNPJ
const applyCnpjMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 14);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 5) return `${numbers.slice(0, 2)}.${numbers.slice(2)}`;
  if (numbers.length <= 8) return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5)}`;
  if (numbers.length <= 12) return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5, 8)}/${numbers.slice(8)}`;
  return `${numbers.slice(0, 2)}.${numbers.slice(2, 5)}.${numbers.slice(5, 8)}/${numbers.slice(8, 12)}-${numbers.slice(12, 14)}`;
};

// Função para aplicar máscara de telefone
const applyPhoneMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 3)} ${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

const ClientForm: React.FC<ClientFormProps> = ({ client, prefill, onBack, onSave }) => {
  const [loading, setLoading] = useState(false);
  const [isCepLoading, setIsCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
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
  const [lastCepConsulted, setLastCepConsulted] = useState<string | null>(null);

  useEffect(() => {
    if (client) {
      const rawCpfCnpj = client.cpf_cnpj || '';
      const maskedCpfCnpj = client.client_type === 'pessoa_fisica'
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

  useEffect(() => {
    const rawCep = (formData.address_zip_code || '').replace(/\D/g, '');

    if (rawCep.length === 8 && rawCep !== lastCepConsulted && !isCepLoading) {
      lookupCep(rawCep);
    }

    if (rawCep.length < 8 && lastCepConsulted) {
      setLastCepConsulted(null);
    }
  }, [formData.address_zip_code, lastCepConsulted, isCepLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔵 Iniciando cadastro de cliente...');
    setLoading(true);

    try {
      // Limpar campos vazios antes de enviar
      const cleanedData = { ...formData };
      if (!cleanedData.birth_date) delete cleanedData.birth_date;
      if (!cleanedData.rg) delete cleanedData.rg;
      if (!cleanedData.cpf_cnpj) delete cleanedData.cpf_cnpj;
      if (!cleanedData.marital_status) delete cleanedData.marital_status;
      if (!cleanedData.profession) delete cleanedData.profession;
      if (!cleanedData.nationality) delete cleanedData.nationality;

      const stripDigits = (value?: string) => (value ? value.replace(/\D/g, '') : '');

      if (cleanedData.cpf_cnpj) {
        const numericCpfCnpj = stripDigits(cleanedData.cpf_cnpj);
        if (numericCpfCnpj) {
          cleanedData.cpf_cnpj = numericCpfCnpj;
        } else {
          delete cleanedData.cpf_cnpj;
        }
      }

      let savedClient: Client;
      const phoneDigits = stripDigits(cleanedData.phone || cleanedData.mobile || '');
      if (phoneDigits) {
        cleanedData.phone = phoneDigits;
        cleanedData.mobile = phoneDigits;
      } else {
        delete cleanedData.phone;
        delete cleanedData.mobile;
      }

      if (client) {
        console.log('🔄 Atualizando cliente existente...');
        savedClient = await clientService.updateClient(client.id, cleanedData);
      } else {
        console.log('➕ Criando novo cliente...');
        savedClient = await clientService.createClient(cleanedData);
      }
      console.log('✅ Cliente salvo com sucesso:', savedClient);
      onSave(savedClient);
    } catch (error: any) {
      console.error('Erro ao salvar cliente:', error);
      alert(error.message || 'Erro ao salvar cliente');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof CreateClientDTO, value: any) => {
    if (field === 'address_zip_code') {
      const digits = (value as string).replace(/\D/g, '').slice(0, 8);
      const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
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

  return (
    <div className="bg-white rounded-lg">
      {/* Header Compacto */}
      <div className="border-b border-slate-200 px-3 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">
              {client ? 'Editar Cliente' : 'Novo Cliente'}
            </h2>
            <p className="text-[10px] sm:text-xs text-slate-500">Preencha os dados do cliente</p>
          </div>
          <button
            onClick={onBack}
            className="p-1 sm:p-1.5 hover:bg-slate-100 rounded-lg transition"
            type="button"
            aria-label="Fechar"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-2 sm:p-4 space-y-3 sm:space-y-4 max-h-[calc(100vh-150px)] sm:max-h-[calc(100vh-200px)] overflow-y-auto">
        {/* Tipo de Cliente */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Tipo de Cliente *</label>
          <div className="flex gap-3">
            <label className="flex-1 flex items-center gap-2 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition">
              <input
                type="radio"
                name="client_type"
                value="pessoa_fisica"
                checked={formData.client_type === 'pessoa_fisica'}
                onChange={(e) => handleChange('client_type', e.target.value as ClientType)}
                className="w-4 h-4 text-blue-600"
              />
              <User className="w-4 h-4 text-slate-600" />
              <span className="text-sm">Pessoa Física</span>
            </label>
            <label className="flex-1 flex items-center gap-2 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition">
              <input
                type="radio"
                name="client_type"
                value="pessoa_juridica"
                checked={formData.client_type === 'pessoa_juridica'}
                onChange={(e) => handleChange('client_type', e.target.value as ClientType)}
                className="w-4 h-4 text-blue-600"
              />
              <Building2 className="w-4 h-4 text-slate-600" />
              <span className="text-sm">Pessoa Jurídica</span>
            </label>
          </div>
        </div>

        {/* Dados Pessoais */}
        <div className="bg-slate-50 rounded-lg p-2 sm:p-3">
          <h3 className="text-xs sm:text-sm font-semibold text-slate-900 mb-2 sm:mb-3">Dados Pessoais</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {formData.client_type === 'pessoa_fisica' ? 'Nome Completo' : 'Razão Social'} *
              </label>
              <input
                type="text"
                required
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.full_name}
                onChange={(e) => handleChange('full_name', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {formData.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'}
              </label>
              <input
                type="text"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.cpf_cnpj}
                onChange={(e) => {
                  const masked = formData.client_type === 'pessoa_fisica' 
                    ? applyCpfMask(e.target.value)
                    : applyCnpjMask(e.target.value);
                  handleChange('cpf_cnpj', masked);
                }}
                placeholder={formData.client_type === 'pessoa_fisica' ? '000.000.000-00' : '00.000.000/0000-00'}
                maxLength={formData.client_type === 'pessoa_fisica' ? 14 : 18}
              />
            </div>

            {formData.client_type === 'pessoa_fisica' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">RG</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Data de Nascimento</label>
                  <input
                    type="date"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.birth_date}
                    onChange={(e) => handleChange('birth_date', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nacionalidade</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.nationality}
                    onChange={(e) => handleChange('nationality', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Estado Civil</label>
                  <select
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.marital_status || ''}
                    onChange={(e) => handleChange('marital_status', e.target.value as MaritalStatus)}
                  >
                    <option value="">Selecione...</option>
                    <option value="solteiro">solteiro(a)</option>
                    <option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option>
                    <option value="viuvo">Viúvo(a)</option>
                    <option value="uniao_estavel">União Estável</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Profissão</label>
                  <input
                    type="text"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formData.profession}
                    onChange={(e) => handleChange('profession', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dados de Contato */}
        <div className="bg-slate-50 rounded-lg p-2 sm:p-3">
          <h3 className="text-xs sm:text-sm font-semibold text-slate-900 mb-2 sm:mb-3">Dados de Contato</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="email"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Telefone / WhatsApp</label>
              <input
                type="tel"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.phone}
                onChange={(e) => {
                  const masked = applyPhoneMask(e.target.value);
                  handleChange('phone', masked);
                }}
                placeholder="(00) 0 0000-0000"
                maxLength={16}
              />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="bg-slate-50 rounded-lg p-2 sm:p-3">
          <h3 className="text-xs sm:text-sm font-semibold text-slate-900 mb-2 sm:mb-3">Endereço</h3>
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-2 sm:gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">CEP *</label>
              <div className="relative">
                <input
                  type="text"
                  className={`input-field pr-10 ${isCepLoading ? 'pr-12' : ''}`}
                  value={formData.address_zip_code}
                  onChange={(e) => handleChange('address_zip_code', e.target.value)}
                  placeholder="00000-000"
                />
                {isCepLoading && (
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    <div className="animate-spin h-4 w-4 border-2 border-amber-600 border-t-transparent rounded-full"></div>
                  </div>
                )}
              </div>
              {cepError && <p className="text-sm text-red-600 mt-2">{cepError}</p>}
            </div>

            <div className="lg:col-span-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Rua/Avenida</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_street}
                onChange={(e) => handleChange('address_street', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_number}
                onChange={(e) => handleChange('address_number', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Complemento</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_complement}
                onChange={(e) => handleChange('address_complement', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bairro</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_neighborhood}
                onChange={(e) => handleChange('address_neighborhood', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_city}
                onChange={(e) => handleChange('address_city', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <input
                type="text"
                className="input-field"
                value={formData.address_state}
                onChange={(e) => handleChange('address_state', e.target.value)}
                maxLength={2}
                placeholder="MT"
              />
            </div>
          </div>
        </div>

        {/* Observações */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Informações Adicionais</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
              <textarea
                className="input-field"
                rows={4}
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                placeholder="Informações adicionais sobre o cliente..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                className="input-field"
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
                <option value="suspenso">Suspenso</option>
              </select>
            </div>
          </div>
        </div>

        {/* Botões */}
        <div className="flex justify-end gap-4 pt-6 border-t border-gray-200">
          <button type="button" onClick={onBack} className="btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-5 h-5" />
            {loading ? 'Salvando...' : 'Salvar Cliente'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClientForm;
