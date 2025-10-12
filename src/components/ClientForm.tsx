import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, User, Building2 } from 'lucide-react';
import { clientService } from '../services/client.service';
import type { Client, CreateClientDTO, ClientType, MaritalStatus } from '../types/client.types';

interface ClientFormProps {
  client: Client | null;
  prefill?: Partial<CreateClientDTO> | null;
  onBack: () => void;
  onSave: (savedClient: Client) => void;
}

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
    nationality: 'Brasileira',
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
      setFormData({
        full_name: client.full_name,
        client_type: client.client_type,
        cpf_cnpj: client.cpf_cnpj,
        rg: client.rg,
        birth_date: client.birth_date,
        nationality: client.nationality,
        marital_status: client.marital_status,
        profession: client.profession,
        email: client.email,
        phone: client.phone || client.mobile || '',
        mobile: client.phone || client.mobile || '',
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

      let savedClient: Client;
      cleanedData.mobile = cleanedData.phone || cleanedData.mobile || '';

      if (!cleanedData.phone) delete cleanedData.phone;
      if (!cleanedData.mobile) delete cleanedData.mobile;

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
    <div className="card">
      <div className="mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-5 h-5" />
          Voltar
        </button>
        <h2 className="text-2xl font-bold text-gray-900 mt-4">
          {client ? 'Editar Cliente' : 'Novo Cliente'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Tipo de Cliente */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de Cliente *</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="client_type"
                value="pessoa_fisica"
                checked={formData.client_type === 'pessoa_fisica'}
                onChange={(e) => handleChange('client_type', e.target.value as ClientType)}
                className="w-4 h-4 text-primary-600"
              />
              <User className="w-5 h-5" />
              <span>Pessoa Física</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="client_type"
                value="pessoa_juridica"
                checked={formData.client_type === 'pessoa_juridica'}
                onChange={(e) => handleChange('client_type', e.target.value as ClientType)}
                className="w-4 h-4 text-primary-600"
              />
              <Building2 className="w-5 h-5" />
              <span>Pessoa Jurídica</span>
            </label>
          </div>
        </div>

        {/* Dados Pessoais */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Dados Pessoais</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {formData.client_type === 'pessoa_fisica' ? 'Nome Completo' : 'Razão Social'} *
              </label>
              <input
                type="text"
                required
                className="input-field"
                value={formData.full_name}
                onChange={(e) => handleChange('full_name', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {formData.client_type === 'pessoa_fisica' ? 'CPF' : 'CNPJ'}
              </label>
              <input
                type="text"
                className="input-field"
                value={formData.cpf_cnpj}
                onChange={(e) => handleChange('cpf_cnpj', e.target.value)}
                placeholder={formData.client_type === 'pessoa_fisica' ? '000.000.000-00' : '00.000.000/0000-00'}
              />
            </div>

            {formData.client_type === 'pessoa_fisica' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">RG</label>
                  <input
                    type="text"
                    className="input-field"
                    value={formData.rg}
                    onChange={(e) => handleChange('rg', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de Nascimento</label>
                  <input
                    type="date"
                    className="input-field"
                    value={formData.birth_date}
                    onChange={(e) => handleChange('birth_date', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidade</label>
                  <input
                    type="text"
                    className="input-field"
                    value={formData.nationality}
                    onChange={(e) => handleChange('nationality', e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado Civil</label>
                  <select
                    className="input-field"
                    value={formData.marital_status || ''}
                    onChange={(e) => handleChange('marital_status', e.target.value as MaritalStatus)}
                  >
                    <option value="">Selecione...</option>
                    <option value="solteiro">Solteiro(a)</option>
                    <option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option>
                    <option value="viuvo">Viúvo(a)</option>
                    <option value="uniao_estavel">União Estável</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Profissão</label>
                  <input
                    type="text"
                    className="input-field"
                    value={formData.profession}
                    onChange={(e) => handleChange('profession', e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dados de Contato */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Dados de Contato</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="input-field"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone / WhatsApp</label>
              <input
                type="tel"
                className="input-field"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Endereço</h3>
          <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">CEP *</label>
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
