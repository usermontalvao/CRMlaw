import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Trash2,
  Loader2,
  GripVertical,
  Type,
  Hash,
  Calendar,
  List,
  AlignLeft,
  Pencil,
  Save,
  DollarSign,
  Signature,
} from 'lucide-react';
import { documentTemplateService } from '../services/documentTemplate.service';
import type { CustomField, CustomFieldType, CreateCustomFieldDTO, CustomFieldOption } from '../types/document.types';

interface CustomFieldsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const fieldTypeLabels: Record<CustomFieldType, { label: string; icon: React.ReactNode }> = {
  text: { label: 'Texto', icon: <Type className="w-4 h-4" /> },
  number: { label: 'Número', icon: <Hash className="w-4 h-4" /> },
  date: { label: 'Data', icon: <Calendar className="w-4 h-4" /> },
  select: { label: 'Seleção', icon: <List className="w-4 h-4" /> },
  textarea: { label: 'Texto longo', icon: <AlignLeft className="w-4 h-4" /> },
  currency: { label: 'Moeda', icon: <DollarSign className="w-4 h-4" /> },
  signature: { label: 'Assinatura', icon: <Signature className="w-4 h-4" /> },
};

 const builtInPlaceholders: Array<{ label: string; placeholder: string }> = [
   { label: 'Nome completo', placeholder: 'NOME COMPLETO' },
   { label: 'Nacionalidade', placeholder: 'nacionalidade' },
   { label: 'Estado civil', placeholder: 'estado civil' },
   { label: 'Profissão', placeholder: 'profissão' },
   { label: 'CPF/CNPJ', placeholder: 'CPF' },
   { label: 'Endereço (rua)', placeholder: 'endereço' },
   { label: 'Número', placeholder: 'número' },
   { label: 'Complemento', placeholder: 'complemento' },
   { label: 'Bairro', placeholder: 'bairro' },
   { label: 'Cidade', placeholder: 'cidade' },
   { label: 'Estado', placeholder: 'estado' },
   { label: 'CEP', placeholder: 'CEP' },
   { label: 'Telefone', placeholder: 'telefone' },
   { label: 'Celular/WhatsApp', placeholder: 'celular' },
   { label: 'Réu/Parte contrária', placeholder: 'réu' },
   { label: 'Data (geração)', placeholder: 'data' },
 ];

const CustomFieldsManager: React.FC<CustomFieldsManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state para novo campo
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    placeholder: string;
    field_type: CustomFieldType;
    required: boolean;
    default_value: string;
    options: CustomFieldOption[];
  }>({
    name: '',
    placeholder: '',
    field_type: 'text',
    required: false,
    default_value: '',
    options: [],
  });
  const [newOptionLabel, setNewOptionLabel] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadFields();
    }
  }, [isOpen]);

  const loadFields = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await documentTemplateService.listCustomFields();
      setFields(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar campos');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      placeholder: '',
      field_type: 'text',
      required: false,
      default_value: '',
      options: [],
    });
    setNewOptionLabel('');
    setEditingField(null);
    setShowAddForm(false);
  };

  const handleEditField = (field: CustomField) => {
    setEditingField(field);
    setFormData({
      name: field.name,
      placeholder: field.placeholder,
      field_type: field.field_type,
      required: field.required,
      default_value: field.default_value || '',
      options: field.options || [],
    });
    setShowAddForm(true);
  };

  const handleAddOption = () => {
    if (!newOptionLabel.trim()) return;
    const value = newOptionLabel.trim().toLowerCase().replace(/\s+/g, '_');
    setFormData({
      ...formData,
      options: [...formData.options, { value, label: newOptionLabel.trim() }],
    });
    setNewOptionLabel('');
  };

  const handleRemoveOption = (index: number) => {
    setFormData({
      ...formData,
      options: formData.options.filter((_, i) => i !== index),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.placeholder.trim()) {
      setError('Nome e placeholder são obrigatórios');
      return;
    }

    if (formData.field_type === 'select' && formData.options.length === 0) {
      setError('Adicione pelo menos uma opção para campos de seleção');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editingField) {
        await documentTemplateService.updateCustomField(editingField.id, {
          name: formData.name,
          placeholder: formData.placeholder,
          field_type: formData.field_type,
          required: formData.required,
          default_value: formData.default_value || undefined,
          options: formData.field_type === 'select' ? formData.options : undefined,
        });
      } else {
        const dto: CreateCustomFieldDTO = {
          name: formData.name,
          placeholder: formData.placeholder,
          field_type: formData.field_type,
          required: formData.required,
          default_value: formData.default_value || undefined,
          options: formData.field_type === 'select' ? formData.options : undefined,
        };
        await documentTemplateService.createCustomField(dto);
      }
      await loadFields();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar campo');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteField = async (field: CustomField) => {
    if (!confirm(`Deseja excluir o campo "${field.name}"?`)) return;

    try {
      await documentTemplateService.deleteCustomField(field.id);
      await loadFields();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir campo');
    }
  };

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-2xl max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
        <div className="h-2 w-full bg-orange-500" />
        <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              Configurações
            </p>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Campos Personalizados</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-5 sm:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="mb-4 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-800 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Campos padrão
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Placeholders do Cliente / Documento</p>
              </div>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {builtInPlaceholders.length} campos
              </span>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {builtInPlaceholders.map((item) => (
                  <div key={item.placeholder} className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 px-3 py-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</p>
                    <code className="mt-1 inline-block text-xs bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">
                      [[{item.placeholder}]]
                    </code>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Dica de uso */}
          <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>Dica:</strong> Use os placeholders no seu template entre colchetes duplos, ex: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">[[VALOR_CONTRATO]]</code>
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {/* Lista de campos */}
              {fields.length === 0 && !showAddForm ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 dark:text-slate-400 mb-4">Nenhum campo personalizado cadastrado.</p>
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar primeiro campo
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 hover:border-slate-300 dark:hover:border-zinc-600 transition"
                    >
                      <div className="text-slate-400 dark:text-slate-500 cursor-grab">
                        <GripVertical className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-white">{field.name}</span>
                          {field.required && (
                            <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded">
                              Obrigatório
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-xs bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">
                            [[{field.placeholder}]]
                          </code>
                          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            {fieldTypeLabels[field.field_type].icon}
                            {fieldTypeLabels[field.field_type].label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEditField(field)}
                          className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteField(field)}
                          className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Formulário de adicionar/editar */}
              {showAddForm && (
                <form onSubmit={handleSubmit} className="mt-6 p-4 rounded-xl border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">
                    {editingField ? 'Editar Campo' : 'Novo Campo Personalizado'}
                  </h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Nome do Campo *
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Ex: Valor do Contrato"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Placeholder *
                      </label>
                      <input
                        type="text"
                        value={formData.placeholder}
                        onChange={(e) => setFormData({ ...formData, placeholder: e.target.value.toUpperCase().replace(/\s+/g, '_') })}
                        placeholder="Ex: VALOR_CONTRATO"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Tipo do Campo
                      </label>
                      <select
                        value={formData.field_type}
                        onChange={(e) => setFormData({ ...formData, field_type: e.target.value as CustomFieldType })}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        {Object.entries(fieldTypeLabels).map(([value, { label }]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Valor Padrão
                      </label>
                      <input
                        type="text"
                        value={formData.default_value}
                        onChange={(e) => setFormData({ ...formData, default_value: e.target.value })}
                        placeholder="Opcional"
                        className="w-full px-3 py-2 border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.required}
                        onChange={(e) => setFormData({ ...formData, required: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500"
                      />
                      <span className="text-sm text-slate-700 dark:text-slate-300">Campo obrigatório</span>
                    </label>
                  </div>

                  {/* Opções para campo select */}
                  {formData.field_type === 'select' && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Opções
                      </label>
                      <div className="space-y-2">
                        {formData.options.map((option, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="flex-1 px-3 py-1.5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                              {option.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(index)}
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newOptionLabel}
                            onChange={(e) => setNewOptionLabel(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddOption())}
                            placeholder="Nova opção"
                            className="flex-1 px-3 py-1.5 border border-slate-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                          <button
                            type="button"
                            onClick={handleAddOption}
                            className="px-3 py-1.5 bg-slate-200 dark:bg-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-600 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium transition"
                          >
                            Adicionar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mt-6">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-4 py-2 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-zinc-800 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      {editingField ? 'Salvar Alterações' : 'Criar Campo'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {fields.length > 0 && !showAddForm && (
          <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" />
              Adicionar Campo
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default CustomFieldsManager;
