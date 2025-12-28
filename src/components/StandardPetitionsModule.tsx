import React, { useEffect, useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  FileText,
  Loader2,
  Trash2,
  X,
  Search,
  Eye,
  Pencil,
  Upload,
  Download,
  Check,
  AlertTriangle,
  FileDown,
  Settings,
  List,
  FolderOpen,
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { standardPetitionService } from '../services/standardPetition.service';
import { clientService } from '../services/client.service';
import { useToastContext } from '../contexts/ToastContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { ClientSearchSelect } from './ClientSearchSelect';
import type {
  StandardPetition,
  StandardPetitionField,
  StandardPetitionCategory,
  StandardPetitionFieldType,
  CreateStandardPetitionFieldDTO,
} from '../types/standardPetition.types';

const CATEGORY_LABELS: Record<StandardPetitionCategory, string> = {
  requerimento_administrativo: 'Requerimento Administrativo',
  peticao_inicial: 'Petição Inicial',
  recurso: 'Recurso',
  contestacao: 'Contestação',
  outros: 'Outros',
};

const FIELD_TYPE_LABELS: Record<StandardPetitionFieldType, string> = {
  text: 'Texto',
  number: 'Número',
  date: 'Data',
  select: 'Seleção',
  textarea: 'Texto Longo',
  currency: 'Moeda',
  cpf: 'CPF',
  phone: 'Telefone',
  cep: 'CEP',
};

const CATEGORY_COLORS: Record<StandardPetitionCategory, string> = {
  requerimento_administrativo: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900/60',
  peticao_inicial: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/60',
  recurso: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900/60',
  contestacao: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-900/60',
  outros: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700',
};

interface StandardPetitionsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, any>) => void;
}

const StandardPetitionsModule: React.FC<StandardPetitionsModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const { confirmDelete } = useDeleteConfirm();

  const [petitions, setPetitions] = useState<StandardPetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'list' | 'generate'>('generate');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<StandardPetitionCategory | ''>('');

  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingPetition, setEditingPetition] = useState<StandardPetition | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'requerimento_administrativo' as StandardPetitionCategory,
    content: '',
    is_active: true,
  });
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [isFieldsModalOpen, setIsFieldsModalOpen] = useState(false);
  const [fieldsPetition, setFieldsPetition] = useState<StandardPetition | null>(null);
  const [fields, setFields] = useState<StandardPetitionField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [editingField, setEditingField] = useState<StandardPetitionField | null>(null);
  const [newField, setNewField] = useState<CreateStandardPetitionFieldDTO>({
    name: '',
    placeholder: '',
    field_type: 'text',
    required: false,
    description: '',
  });
  const [fieldSaving, setFieldSaving] = useState(false);

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingPetition, setViewingPetition] = useState<StandardPetition | null>(null);
  const [viewingFields, setViewingFields] = useState<StandardPetitionField[]>([]);
  const [viewLoading, setViewLoading] = useState(false);

  const [selectedPetitionId, setSelectedPetitionId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<StandardPetitionCategory | ''>('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [petitionFields, setPetitionFields] = useState<StandardPetitionField[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const stepModeloRef = useRef<HTMLDivElement>(null);
  const stepClienteRef = useRef<HTMLDivElement>(null);
  const stepCamposRef = useRef<HTMLDivElement>(null);
  const stepGerarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPetitions();
  }, []);

  useEffect(() => {
    if (selectedCategory && stepModeloRef.current) {
      setTimeout(() => {
        stepModeloRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (selectedPetitionId && stepClienteRef.current) {
      setTimeout(() => {
        stepClienteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedPetitionId]);

  useEffect(() => {
    if (selectedClientId && petitionFields.length > 0 && stepCamposRef.current) {
      setTimeout(() => {
        stepCamposRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } else if (selectedClientId && stepGerarRef.current) {
      setTimeout(() => {
        stepGerarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [selectedClientId, petitionFields.length]);

  const loadPetitions = async () => {
    try {
      setLoading(true);
      const data = await standardPetitionService.listPetitions();
      setPetitions(data);
    } catch (err: any) {
      toast.error('Erro ao carregar petições', err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredPetitions = useMemo(() => {
    return petitions.filter((p) => {
      const matchesSearch =
        !searchTerm ||
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !categoryFilter || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [petitions, searchTerm, categoryFilter]);

  const activePetitions = useMemo(() => petitions.filter((p) => p.is_active), [petitions]);

  const petitionCounts = useMemo(() => {
    const total = petitions.length;
    const active = petitions.filter((p) => p.is_active).length;
    const withFile = petitions.filter((p) => !!p.file_path).length;
    return { total, active, withFile };
  }, [petitions]);

  const selectedPetition = useMemo(
    () => petitions.find((p) => p.id === selectedPetitionId) || null,
    [petitions, selectedPetitionId]
  );

  useEffect(() => {
    if (!selectedPetitionId) {
      setFieldValues({});
      setPetitionFields([]);
      return;
    }
    const loadFields = async () => {
      try {
        const loadedFields = await standardPetitionService.listFields(selectedPetitionId);
        setPetitionFields(loadedFields);
        const initialValues: Record<string, string> = {};
        loadedFields.forEach((f) => {
          initialValues[f.placeholder] = f.default_value || '';
        });
        setFieldValues(initialValues);
      } catch (err) {
        console.error('Erro ao carregar campos:', err);
      }
    };
    loadFields();
  }, [selectedPetitionId]);

  const handleOpenCreateModal = () => {
    setEditingPetition(null);
    setFormData({ name: '', description: '', category: 'requerimento_administrativo', content: '', is_active: true });
    setFormFile(null);
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (petition: StandardPetition) => {
    setEditingPetition(petition);
    setFormData({
      name: petition.name,
      description: petition.description || '',
      category: petition.category,
      content: petition.content,
      is_active: petition.is_active,
    });
    setFormFile(null);
    setFormError(null);
    setIsFormModalOpen(true);
  };

  const handleCloseFormModal = () => {
    setIsFormModalOpen(false);
    setEditingPetition(null);
    setFormFile(null);
    setFormError(null);
  };

  const handleSavePetition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Informe o nome da petição.');
      return;
    }
    try {
      setFormSaving(true);
      setFormError(null);
      if (editingPetition) {
        await standardPetitionService.updatePetition(editingPetition.id, {
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          category: formData.category,
          content: formData.content,
          is_active: formData.is_active,
        });
        if (formFile) {
          await standardPetitionService.updatePetitionFile(editingPetition.id, formFile);
        }
        toast.success('Petição atualizada', `"${formData.name}" foi atualizada.`);
      } else {
        if (formFile) {
          await standardPetitionService.createPetitionWithFile(
            { name: formData.name.trim(), description: formData.description.trim() || null, category: formData.category, content: formData.content, is_active: formData.is_active },
            formFile
          );
        } else {
          await standardPetitionService.createPetition({
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            category: formData.category,
            content: formData.content,
            is_active: formData.is_active,
          });
        }
        toast.success('Petição criada', `"${formData.name}" foi criada.`);
      }
      await loadPetitions();
      handleCloseFormModal();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao salvar petição.');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeletePetition = async (petition: StandardPetition) => {
    const confirmed = await confirmDelete({
      title: 'Excluir Petição',
      entityName: petition.name,
      message: 'Tem certeza que deseja excluir esta petição?',
      confirmLabel: 'Excluir Petição',
    });
    if (!confirmed) return;
    try {
      await standardPetitionService.deletePetition(petition.id);
      toast.success('Petição excluída', `"${petition.name}" foi removida.`);
      await loadPetitions();
    } catch (err: any) {
      toast.error('Erro ao excluir', err.message);
    }
  };

  const handleOpenFieldsModal = async (petition: StandardPetition) => {
    setFieldsPetition(petition);
    setIsFieldsModalOpen(true);
    setFieldsLoading(true);
    setEditingField(null);
    setNewField({ name: '', placeholder: '', field_type: 'text', required: false, description: '' });
    try {
      const data = await standardPetitionService.listFields(petition.id);
      setFields(data);
    } catch (err: any) {
      toast.error('Erro ao carregar campos', err.message);
    } finally {
      setFieldsLoading(false);
    }
  };

  const handleCloseFieldsModal = () => {
    setIsFieldsModalOpen(false);
    setFieldsPetition(null);
    setFields([]);
    setEditingField(null);
    setNewField({ name: '', placeholder: '', field_type: 'text', required: false, description: '' });
  };

  const handleStartEditField = (field: StandardPetitionField) => {
    setEditingField(field);
    setNewField({
      name: field.name,
      placeholder: field.placeholder,
      field_type: field.field_type,
      required: field.required,
      description: field.description || '',
    });
  };

  const handleCancelEditField = () => {
    setEditingField(null);
    setNewField({ name: '', placeholder: '', field_type: 'text', required: false, description: '' });
  };

  const handleSaveField = async () => {
    if (!fieldsPetition || !newField.name.trim() || !newField.placeholder.trim()) {
      toast.error('Preencha nome e placeholder do campo.');
      return;
    }
    try {
      setFieldSaving(true);
      if (editingField) {
        await standardPetitionService.updateField(editingField.id, {
          name: newField.name.trim(),
          placeholder: newField.placeholder.trim(),
          field_type: newField.field_type,
          required: newField.required,
          description: newField.description?.trim() || null,
        });
        toast.success('Campo atualizado');
      } else {
        await standardPetitionService.createField(fieldsPetition.id, {
          name: newField.name.trim(),
          placeholder: newField.placeholder.trim(),
          field_type: newField.field_type,
          required: newField.required,
          description: newField.description?.trim() || null,
        });
        toast.success('Campo adicionado');
      }

      const data = await standardPetitionService.listFields(fieldsPetition.id);
      setFields(data);
      setEditingField(null);
      setNewField({ name: '', placeholder: '', field_type: 'text', required: false, description: '' });
    } catch (err: any) {
      toast.error(editingField ? 'Erro ao atualizar campo' : 'Erro ao adicionar campo', err.message);
    } finally {
      setFieldSaving(false);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    try {
      await standardPetitionService.deleteField(fieldId);
      setFields((prev) => prev.filter((f) => f.id !== fieldId));
      toast.success('Campo removido');
    } catch (err: any) {
      toast.error('Erro ao remover campo', err.message);
    }
  };

  const handleViewPetition = async (petition: StandardPetition) => {
    setViewingPetition(petition);
    setIsViewModalOpen(true);
    setViewLoading(true);
    try {
      const data = await standardPetitionService.listFields(petition.id);
      setViewingFields(data);
    } catch (err: any) {
      console.error('Erro ao carregar campos:', err);
    } finally {
      setViewLoading(false);
    }
  };

  const handleCloseViewModal = () => {
    setIsViewModalOpen(false);
    setViewingPetition(null);
    setViewingFields([]);
  };

  const handleDownloadFile = async (petition: StandardPetition) => {
    if (!petition.file_path) {
      toast.error('Esta petição não possui arquivo.');
      return;
    }
    try {
      const blob = await standardPetitionService.downloadPetitionFile(petition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = petition.file_name || `${petition.name}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error('Erro ao baixar arquivo', err.message);
    }
  };

  const handleGenerateDocument = async () => {
    if (!selectedPetition || !selectedClientId) {
      setGenerationError('Selecione uma petição e um cliente.');
      return;
    }
    try {
      setGenerating(true);
      setGenerationError(null);
      const client = await clientService.getClientById(selectedClientId);
      if (!client) throw new Error('Cliente não encontrado.');

      let content = selectedPetition.content;
      
      // Função para remover acentos
      const removeDiacritics = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      
      // Função para aplicar máscara de CPF: 000.000.000-00
      const formatCpf = (cpf?: string | null) => {
        if (!cpf) return '';
        const digits = cpf.replace(/\D/g, '');
        if (digits.length === 11) {
          return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        return cpf;
      };
      
      // Função para aplicar máscara de CEP: 00000-000
      const formatCep = (cep?: string | null) => {
        if (!cep) return '';
        const digits = cep.replace(/\D/g, '');
        if (digits.length === 8) {
          return digits.replace(/(\d{5})(\d{3})/, '$1-$2');
        }
        return cep;
      };
      
      // Função para formatar em minúsculo (nacionalidade, estado civil, profissão)
      const formatLowerCase = (value?: string | null) => {
        if (!value) return '';
        return value.toLowerCase();
      };

      const formatUf = (value?: string | null) => {
        if (!value) return '';
        return value.trim().toUpperCase();
      };

      const formatTitleCasePtBr = (value?: string | null) => {
        if (!value) return '';

        const lowerConnectors = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
        const normalize = value.trim().replace(/\s+/g, ' ');
        const words = normalize.split(' ');

        const titleWord = (word: string, isFirst: boolean) => {
          if (!word) return '';
          const lower = word.toLocaleLowerCase('pt-BR');
          if (!isFirst && lowerConnectors.has(lower)) return lower;
          return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
        };

        return words
          .map((word, idx) => word.split('-').map((part) => titleWord(part, idx === 0)).join('-'))
          .join(' ');
      };

      const cleanupDuplicateCommas = (text: string) => {
        let out = text;
        out = out.replace(/\s+,/g, ',');
        for (let i = 0; i < 10; i += 1) {
          const next = out.replace(/,\s*,/g, ',');
          if (next === out) break;
          out = next;
        }
        out = out.replace(/,{2,}/g, ',');
        out = out.replace(/,\s{2,}/g, ', ');
        out = out.replace(/,([A-Za-zÀ-ÿ])/g, ', $1');
        return out;
      };
      
      // Função para registrar placeholder com múltiplas variações
      const clientPlaceholders: Record<string, string> = {};
      const registerPlaceholder = (key: string, value?: string | null) => {
        const safeValue = value ?? '';
        clientPlaceholders[key] = safeValue;
        clientPlaceholders[key.toUpperCase()] = safeValue;
        clientPlaceholders[key.toLowerCase()] = safeValue;
        const normalizedKey = removeDiacritics(key);
        clientPlaceholders[normalizedKey] = safeValue;
        clientPlaceholders[normalizedKey.toUpperCase()] = safeValue;
        clientPlaceholders[normalizedKey.toLowerCase()] = safeValue;
        // Versão com underscore
        const underscoreKey = key.replace(/\s+/g, '_');
        clientPlaceholders[underscoreKey] = safeValue;
        clientPlaceholders[underscoreKey.toUpperCase()] = safeValue;
        clientPlaceholders[underscoreKey.toLowerCase()] = safeValue;
      };

      // Registrar todos os placeholders do cliente
      registerPlaceholder('NOME COMPLETO', client.full_name);
      registerPlaceholder('NOME', client.full_name);
      registerPlaceholder('nacionalidade', formatLowerCase(client.nationality));
      registerPlaceholder('estado civil', formatLowerCase(client.marital_status));
      registerPlaceholder('profissão', formatLowerCase(client.profession));
      registerPlaceholder('RG', client.rg);
      registerPlaceholder('CPF', formatCpf(client.cpf_cnpj));
      registerPlaceholder('endereço', client.address_street);
      registerPlaceholder('número', client.address_number);
      registerPlaceholder('complemento', client.address_complement);
      registerPlaceholder('bairro', client.address_neighborhood);
      const formattedCity = formatTitleCasePtBr(client.address_city);
      const formattedUf = formatUf(client.address_state);
      registerPlaceholder('cidade', formattedCity);
      // Registrar variações adicionais de cidade para garantir substituição
      clientPlaceholders['Cidade'] = formattedCity;
      clientPlaceholders['CIDADE'] = formattedCity;
      registerPlaceholder('UF', formattedUf);
      // Registrar 'estado' separadamente para não conflitar com 'estado civil'
      clientPlaceholders['estado'] = formattedUf;
      clientPlaceholders['ESTADO'] = formattedUf;
      clientPlaceholders['Estado'] = formattedUf;
      registerPlaceholder('CEP', formatCep(client.address_zip_code));
      registerPlaceholder('telefone', client.phone || client.mobile);
      registerPlaceholder('celular', client.mobile || client.phone);
      registerPlaceholder('email', client.email);
      
      // Endereço completo
      const fullAddress = [
        client.address_street,
        client.address_number ? `nº ${client.address_number}` : '',
        client.address_complement,
        client.address_neighborhood,
        formatTitleCasePtBr(client.address_city),
        formatUf(client.address_state),
        formatCep(client.address_zip_code) ? `CEP ${formatCep(client.address_zip_code)}` : '',
      ].filter(Boolean).join(', ');
      registerPlaceholder('ENDERECO_COMPLETO', fullAddress);
      registerPlaceholder('endereço completo', fullAddress);

      // Substituir placeholders do cliente
      Object.entries(clientPlaceholders).forEach(([key, value]) => {
        const regex = new RegExp(`\\[\\[${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'gi');
        content = content.replace(regex, value);
      });

      Object.entries(fieldValues).forEach(([placeholder, value]) => {
        let formattedValue = value;
        // Formatar datas de YYYY-MM-DD para DD/MM/YYYY
        const field = petitionFields.find((f) => f.placeholder === placeholder);
        if (field?.field_type === 'date' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          const [year, month, day] = value.split('-');
          formattedValue = `${day}/${month}/${year}`;
        }
        // Formatar moeda
        if (field?.field_type === 'currency' && value) {
          formattedValue = parseFloat(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        }
        const regex = new RegExp(`\\[\\[${placeholder}\\]\\]`, 'gi');
        content = content.replace(regex, formattedValue);
      });

      const today = new Date();
      const dateFormatted = today.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      content = content.replace(/\[\[DATA\]\]/gi, dateFormatted);
      content = content.replace(/\[\[DATA_ATUAL\]\]/gi, dateFormatted);
      content = cleanupDuplicateCommas(content);

      if (selectedPetition.file_path) {
        // Processar arquivo DOCX com docxtemplater
        const fileBlob = await standardPetitionService.downloadPetitionFile(selectedPetition);
        const arrayBuffer = await fileBlob.arrayBuffer();
        const zip = new PizZip(arrayBuffer);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '[[', end: ']]' },
        });

        // Preparar dados para substituição (formato para docxtemplater)
        const allPlaceholders: Record<string, string> = { ...clientPlaceholders };
        
        // Adicionar campos personalizados formatados
        Object.entries(fieldValues).forEach(([placeholder, value]) => {
          let formattedValue = value;
          const field = petitionFields.find((f) => f.placeholder === placeholder);
          if (field?.field_type === 'date' && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [year, month, day] = value.split('-');
            formattedValue = `${day}/${month}/${year}`;
          }
          if (field?.field_type === 'currency' && value) {
            formattedValue = parseFloat(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          }
          allPlaceholders[placeholder] = formattedValue;
        });

        // Adicionar data atual com variações
        allPlaceholders['DATA'] = dateFormatted;
        allPlaceholders['data'] = dateFormatted;
        allPlaceholders['DATA_ATUAL'] = dateFormatted;
        allPlaceholders['data_atual'] = dateFormatted;
        allPlaceholders['DATA ATUAL'] = dateFormatted;
        allPlaceholders['data atual'] = dateFormatted;

        doc.render(allPlaceholders);
        const renderedZip = doc.getZip();
        const xmlFiles = renderedZip.file(/word\/(document|header\d+|footer\d+)\.xml/);
        xmlFiles.forEach((f) => {
          const xmlText = f.asText();
          renderedZip.file(f.name, cleanupDuplicateCommas(xmlText));
        });
        const outputBlob = renderedZip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const fileName = `${selectedPetition.name} - ${client.full_name}.docx`;
        saveAs(outputBlob, fileName);

        await standardPetitionService.createGeneratedDocument({
          petition_id: selectedPetition.id,
          petition_name: selectedPetition.name,
          client_id: client.id,
          client_name: client.full_name,
          file_name: fileName,
          field_values: fieldValues,
        });
        toast.success('Documento gerado', 'O documento DOCX foi gerado e baixado com os campos preenchidos.');
      } else {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedPetition.name} - ${client.full_name}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        await standardPetitionService.createGeneratedDocument({
          petition_id: selectedPetition.id,
          petition_name: selectedPetition.name,
          client_id: client.id,
          client_name: client.full_name,
          file_name: `${selectedPetition.name} - ${client.full_name}.txt`,
          field_values: fieldValues,
        });
        toast.success('Documento gerado', 'O documento foi gerado e baixado.');
      }
    } catch (err: any) {
      setGenerationError(err.message || 'Erro ao gerar documento.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2 dark:text-zinc-100">
              <FileText className="w-6 h-6 text-blue-600" />
              Modelos de Documentos
            </h1>
            <p className="text-sm text-slate-600 mt-1 dark:text-zinc-400">
              Crie, organize e gere documentos com campos dinâmicos
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-[10px] font-medium text-slate-600 uppercase dark:text-zinc-400">Total</span>
                <p className="text-lg font-semibold text-slate-900 dark:text-zinc-100">{petitionCounts.total}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-[10px] font-medium text-emerald-600 uppercase">Ativos</span>
                <p className="text-lg font-semibold text-emerald-600">{petitionCounts.active}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-[10px] font-medium text-blue-600 uppercase">DOCX</span>
                <p className="text-lg font-semibold text-blue-600">{petitionCounts.withFile}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 border border-slate-200 p-1 dark:bg-zinc-800 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setActiveView('generate')}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === 'generate' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-700 hover:bg-white dark:text-zinc-200 dark:hover:bg-zinc-700'}`}
            >
              <FileDown className="h-4 w-4" />
              Gerar
            </button>
            <button
              type="button"
              onClick={() => setActiveView('list')}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${activeView === 'list' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-700 hover:bg-white dark:text-zinc-200 dark:hover:bg-zinc-700'}`}
            >
              <List className="h-4 w-4" />
              Gerenciar
            </button>
          </div>
        </div>
      </div>

      {activeView === 'list' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-1 gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar modelos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as StandardPetitionCategory | '')}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="">Todas as categorias</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <button onClick={handleOpenCreateModal} className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-orange-500/30">
                <Plus className="h-4 w-4" />
                Novo Modelo
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : filteredPetitions.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
              <FolderOpen className="mx-auto h-10 w-10 text-slate-300 dark:text-zinc-700" />
              <p className="mt-3 text-sm font-medium text-slate-600 dark:text-zinc-300">Nenhuma petição encontrada</p>
              {!searchTerm && !categoryFilter && (
                <button onClick={handleOpenCreateModal} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-600 hover:text-orange-700">
                  <Plus className="h-4 w-4" />Criar petição
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredPetitions.map((petition) => (
                <div key={petition.id} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_COLORS[petition.category]}`}>
                          {CATEGORY_LABELS[petition.category]}
                        </span>
                        {!petition.is_active && <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-zinc-800 dark:text-zinc-300">Inativo</span>}
                      </div>
                      <h4 className="mt-2 text-sm font-semibold text-slate-900 truncate dark:text-zinc-100">{petition.name}</h4>
                      {petition.description && <p className="mt-1 text-xs text-slate-500 line-clamp-2 dark:text-zinc-400">{petition.description}</p>}
                    </div>
                    {petition.file_path && (
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center dark:bg-blue-950/30">
                          <FileText className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button onClick={() => handleViewPetition(petition)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800">
                      <Eye className="h-3.5 w-3.5" />Ver
                    </button>
                    <button onClick={() => handleOpenFieldsModal(petition)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800">
                      <Settings className="h-3.5 w-3.5" />Campos
                    </button>
                    <button onClick={() => handleOpenEditModal(petition)} className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDeletePetition(petition)} className="inline-flex items-center justify-center rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/30">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeView === 'generate' && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="p-4 border-b border-slate-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center dark:bg-orange-950/30">
                <FileDown className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Gerar Documento</h3>
                <p className="text-sm text-slate-600 dark:text-zinc-400">Selecione a categoria, modelo e cliente</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${selectedCategory ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200' : 'bg-orange-500 text-white'}`}>
                <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">1</span>
                Categoria
              </div>
              <div className="w-8 h-0.5 bg-slate-200" />
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${selectedCategory && selectedPetitionId ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200' : selectedCategory ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">2</span>
                Modelo
              </div>
              <div className="w-8 h-0.5 bg-slate-200" />
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${selectedCategory && selectedPetitionId && selectedClientId ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-200' : selectedCategory && selectedPetitionId ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-[10px] font-bold">3</span>
                Cliente
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-zinc-200">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold dark:bg-orange-950/40 dark:text-orange-400">1</span>
                    Selecione a Categoria
                  </span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                    const categoryPetitions = activePetitions.filter(p => p.category === key);
                    const isSelected = selectedCategory === key;
                    const hasModels = categoryPetitions.length > 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedCategory(key as StandardPetitionCategory);
                          setSelectedPetitionId('');
                        }}
                        disabled={!hasModels}
                        className={`relative p-3 rounded-xl border-2 text-left transition ${
                          isSelected 
                            ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-500/20 dark:bg-orange-950/20' 
                            : hasModels 
                              ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800' 
                              : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900/40'
                        }`}
                      >
                        <p className={`text-sm font-medium truncate ${isSelected ? 'text-orange-900 dark:text-orange-200' : 'text-slate-700 dark:text-zinc-200'}`}>{label}</p>
                        <p className={`text-xs mt-0.5 ${isSelected ? 'text-orange-600 dark:text-orange-300' : 'text-slate-400 dark:text-zinc-500'}`}>
                          {categoryPetitions.length} {categoryPetitions.length === 1 ? 'modelo' : 'modelos'}
                        </p>
                        {isSelected && (
                          <div className="absolute top-2 right-2">
                            <Check className="h-4 w-4 text-orange-600" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedCategory && (
                <div ref={stepModeloRef} className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-zinc-200">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold dark:bg-orange-950/40 dark:text-orange-400">2</span>
                      Selecione o Modelo
                    </span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activePetitions
                      .filter(p => p.category === selectedCategory)
                      .map((petition) => {
                        const isSelected = selectedPetitionId === petition.id;
                        return (
                          <button
                            key={petition.id}
                            type="button"
                            onClick={() => setSelectedPetitionId(petition.id)}
                            className={`p-4 rounded-xl border-2 text-left transition ${
                              isSelected 
                                ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-500/20 dark:bg-orange-950/20' 
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? 'bg-orange-100 dark:bg-orange-950/40' : 'bg-slate-100 dark:bg-zinc-800'}`}>
                                <FileText className={`h-5 w-5 ${isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-zinc-400'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${isSelected ? 'text-orange-900 dark:text-orange-200' : 'text-slate-900 dark:text-zinc-100'}`}>{petition.name}</p>
                                {petition.description && (
                                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 dark:text-zinc-400">{petition.description}</p>
                                )}
                              </div>
                              {isSelected && (
                                <div className="flex-shrink-0">
                                  <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center">
                                    <Check className="h-3.5 w-3.5 text-white" />
                                  </div>
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {selectedCategory && selectedPetitionId && (
                <div ref={stepClienteRef} className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-zinc-200">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center text-xs font-bold dark:bg-orange-950/40 dark:text-orange-400">3</span>
                      Selecione o Cliente
                    </span>
                  </label>
                  <ClientSearchSelect value={selectedClientId} onChange={(clientId) => setSelectedClientId(clientId)} label="" placeholder="Buscar cliente pelo nome..." required allowCreate={true} />
                </div>
              )}

              {selectedPetition && selectedClientId && petitionFields.length > 0 && (
                <div ref={stepCamposRef} className="animate-in fade-in slide-in-from-top-2 duration-300 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="flex items-center gap-2"><Settings className="h-4 w-4 text-slate-500 dark:text-zinc-400" /><p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Campos Personalizados</p></div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Preencha os campos específicos desta petição.</p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {petitionFields.map((field) => {
                      const value = fieldValues[field.placeholder] || '';
                      const inputType = field.field_type === 'date' ? 'date' : field.field_type === 'number' || field.field_type === 'currency' ? 'number' : 'text';
                      return (
                        <div key={field.id} className={field.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {field.name}{field.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          {field.field_type === 'textarea' ? (
                            <textarea
                              value={value}
                              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.placeholder]: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                              placeholder={field.description || `Preencher ${field.name}...`}
                              rows={3}
                            />
                          ) : field.field_type === 'select' && field.options ? (
                            <select
                              value={value}
                              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.placeholder]: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                            >
                              <option value="">Selecione...</option>
                              {field.options.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={inputType}
                              value={value}
                              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.placeholder]: e.target.value }))}
                              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                              placeholder={field.description || `Preencher ${field.name}...`}
                              step={field.field_type === 'currency' ? '0.01' : undefined}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {generationError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /><span>{generationError}</span>
                </div>
              )}

              {selectedCategory && selectedPetitionId && selectedClientId && (
                <div ref={stepGerarRef} className="animate-in fade-in slide-in-from-top-2 duration-300 pt-2">
                  <button 
                    onClick={handleGenerateDocument} 
                    disabled={generating} 
                    className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 px-6 py-4 text-sm font-semibold text-white transition inline-flex items-center justify-center gap-2 shadow-lg shadow-orange-500/30 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generating ? (<><Loader2 className="h-5 w-5 animate-spin" />Gerando documento...</>) : (<><FileDown className="h-5 w-5" />Gerar Petição</>)}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isFormModalOpen && createPortal(
        <div className="pericia-light-modal fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseFormModal} />
          <div className="pericia-light-modal__panel relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden dark:bg-zinc-900">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 dark:border-zinc-800">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center dark:bg-orange-950/40"><FileText className="w-6 h-6 text-orange-600 dark:text-orange-400" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{editingPetition ? 'Editar' : 'Nova'}</p>
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-zinc-100">{editingPetition ? 'Editar Petição' : 'Nova Petição'}</h2>
                </div>
              </div>
              <button type="button" onClick={handleCloseFormModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl dark:hover:bg-zinc-800"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSavePetition} className="flex-1 overflow-y-auto">
              <div className="p-5 sm:p-6 space-y-4">
                <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Nome *</label><input type="text" value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="Ex: Requerimento Administrativo INSS" required /></div>
                <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</label><input type="text" value={formData.description} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="Breve descrição da petição" /></div>
                <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Categoria *</label><select value={formData.category} onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value as StandardPetitionCategory }))} className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">{Object.entries(CATEGORY_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}</select></div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {editingPetition?.file_path ? 'Arquivo Template' : 'Arquivo DOCX (opcional)'}
                  </label>
                  {editingPetition?.file_path && !formFile ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-5 w-5 text-orange-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate dark:text-zinc-200">{editingPetition.file_name}</p>
                            <p className="text-xs text-slate-500 dark:text-zinc-400">Template atual</p>
                          </div>
                        </div>
                        <label className="cursor-pointer">
                          <div className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-semibold hover:bg-amber-200 inline-flex items-center gap-1.5">
                            <Upload className="h-3.5 w-3.5" />
                            Substituir
                          </div>
                          <input type="file" accept=".doc,.docx" onChange={(e) => setFormFile(e.target.files?.[0] || null)} className="hidden" />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <label className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 dark:hover:bg-zinc-800">
                          <Upload className="h-4 w-4" />
                          {formFile ? formFile.name : 'Selecionar arquivo .docx'}
                        </div>
                        <input type="file" accept=".doc,.docx" onChange={(e) => setFormFile(e.target.files?.[0] || null)} className="hidden" />
                      </label>
                      {formFile && (
                        <button type="button" onClick={() => setFormFile(null)} className="p-2 text-slate-400 hover:text-red-600 dark:hover:bg-zinc-800 rounded-lg">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                  {formFile && editingPetition?.file_path && (
                    <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      O arquivo atual será substituído por: {formFile.name}
                    </p>
                  )}
                </div>
                {!formFile && !editingPetition?.file_path && (<div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Conteúdo do Template</label><textarea value={formData.content} onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))} rows={8} className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="Use [[PLACEHOLDER]] para campos dinâmicos..." /><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Use [[NOME_COMPLETO]], [[CPF]], [[ENDERECO]], etc.</p></div>)}
                <div className="flex items-center gap-3"><button type="button" onClick={() => setFormData((prev) => ({ ...prev, is_active: !prev.is_active }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${formData.is_active ? 'bg-orange-500' : 'bg-slate-200 dark:bg-zinc-800'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} /></button><span className="text-sm text-slate-700 dark:text-zinc-200">{formData.is_active ? 'Petição ativa' : 'Petição inativa'}</span></div>
                {formError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /><span>{formError}</span></div>}
              </div>
              <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                  <button type="button" onClick={handleCloseFormModal} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800" disabled={formSaving}>Cancelar</button>
                  <button type="submit" disabled={formSaving} className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm shadow-orange-500/30">{formSaving && <Loader2 className="w-4 h-4 animate-spin" />}{editingPetition ? 'Salvar Alterações' : 'Criar Petição'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isFieldsModalOpen && fieldsPetition && createPortal(
        <div className="pericia-light-modal fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseFieldsModal} />
          <div className="pericia-light-modal__panel relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden dark:bg-zinc-900">
            <div className="h-2 w-full bg-amber-500" />
            <div className="px-5 sm:px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 dark:border-zinc-800">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center"><Settings className="w-6 h-6 text-amber-600" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Campos Personalizados</p>
                  <h2 className="text-xl font-semibold text-slate-900 truncate max-w-md dark:text-zinc-100">{fieldsPetition.name}</h2>
                </div>
              </div>
              <button type="button" onClick={handleCloseFieldsModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl dark:hover:bg-zinc-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{editingField ? 'Editar Campo' : 'Adicionar Campo'}</h4>
                  {editingField && (
                    <button type="button" onClick={handleCancelEditField} className="text-xs font-semibold text-slate-600 hover:text-slate-800">
                      Cancelar edição
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="mb-1 block text-xs font-medium text-slate-500">Nome do Campo</label><input type="text" value={newField.name} onChange={(e) => setNewField((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="Ex: Valor do Benefício" /></div>
                  <div><label className="mb-1 block text-xs font-medium text-slate-500">Placeholder</label><input type="text" value={newField.placeholder} onChange={(e) => setNewField((prev) => ({ ...prev, placeholder: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500" placeholder="Ex: VALOR_BENEFICIO" /></div>
                  <div><label className="mb-1 block text-xs font-medium text-slate-500">Tipo</label><select value={newField.field_type} onChange={(e) => setNewField((prev) => ({ ...prev, field_type: e.target.value as StandardPetitionFieldType }))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">{Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}</select></div>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-200"><input type="checkbox" checked={newField.required} onChange={(e) => setNewField((prev) => ({ ...prev, required: e.target.checked }))} className="rounded border-slate-300 dark:border-zinc-700" />Obrigatório</label>
                    <button type="button" onClick={handleSaveField} disabled={fieldSaving || !newField.name.trim() || !newField.placeholder.trim()} className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2">{fieldSaving && <Loader2 className="w-4 h-4 animate-spin" />}{editingField ? (<><Pencil className="h-4 w-4" />Salvar</>) : (<><Plus className="h-4 w-4" />Adicionar</>)}</button>
                  </div>
                </div>
              </div>
              {fieldsLoading ? (<div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>) : fields.length === 0 ? (<div className="text-center py-8 text-sm text-slate-500 dark:text-zinc-400">Nenhum campo personalizado cadastrado.</div>) : (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Campos Cadastrados ({fields.length})</h4>
                  {fields.map((field) => (
                    <div key={field.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">{field.name}</span>
                          <span className="text-xs text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded dark:bg-zinc-800 dark:text-zinc-300">[[{field.placeholder}]]</span>
                          <span className="text-xs text-slate-500 dark:text-zinc-400">{FIELD_TYPE_LABELS[field.field_type]}</span>
                          {field.required && <span className="text-xs text-red-600 font-medium">*</span>}
                        </div>
                        {field.description && <p className="text-xs text-slate-500 mt-0.5 dark:text-zinc-400">{field.description}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => handleStartEditField(field)} className="p-2 text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg dark:hover:bg-amber-950/30" title="Editar campo">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => handleDeleteField(field.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg dark:hover:bg-red-950/30" title="Excluir campo">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <button type="button" onClick={handleCloseFieldsModal} className="w-full px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700">Fechar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {isViewModalOpen && viewingPetition && createPortal(
        <div className="pericia-light-modal fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleCloseViewModal} />
          <div className="pericia-light-modal__panel relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden dark:bg-zinc-900">
            <div className="h-2 w-full bg-emerald-500" />
            <div className="px-5 sm:px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 dark:border-zinc-800">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center"><Eye className="w-6 h-6 text-emerald-600" /></div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Visualizar</p>
                  <h2 className="text-xl font-semibold text-slate-900 truncate max-w-md dark:text-zinc-100">{viewingPetition.name}</h2>
                </div>
              </div>
              <button type="button" onClick={handleCloseViewModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl dark:hover:bg-zinc-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Categoria</p><span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${CATEGORY_COLORS[viewingPetition.category]}`}>{CATEGORY_LABELS[viewingPetition.category]}</span></div>
                <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Status</p><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${viewingPetition.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>{viewingPetition.is_active ? 'Ativa' : 'Inativa'}</span></div>
              </div>
              {viewingPetition.description && <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Descrição</p><p className="text-sm text-slate-700 dark:text-zinc-200">{viewingPetition.description}</p></div>}
              {viewingPetition.file_path && (<div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/60"><FileText className="h-5 w-5 text-blue-600 dark:text-blue-300" /><div className="flex-1"><p className="text-sm font-medium text-blue-900 dark:text-blue-100">{viewingPetition.file_name}</p><p className="text-xs text-blue-600 dark:text-blue-200">{viewingPetition.file_size ? `${(viewingPetition.file_size / 1024).toFixed(1)} KB` : 'Arquivo DOCX'}</p></div><button onClick={() => handleDownloadFile(viewingPetition)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" />Baixar</button></div>)}
              {!viewingPetition.file_path && viewingPetition.content && (<div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Conteúdo</p><div className="p-3 rounded-lg bg-slate-50 border border-slate-200 max-h-64 overflow-y-auto dark:border-zinc-800 dark:bg-zinc-900/40"><pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono dark:text-zinc-200">{viewingPetition.content}</pre></div></div>)}
              {viewLoading ? (<div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>) : viewingFields.length > 0 && (<div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Campos Personalizados ({viewingFields.length})</p><div className="space-y-2">{viewingFields.map((field) => (<div key={field.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 dark:border-zinc-800 dark:bg-zinc-900/40"><span className="text-sm font-medium text-slate-900 dark:text-zinc-100">{field.name}</span><span className="text-xs text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700">[[{field.placeholder}]]</span><span className="text-xs text-slate-500 dark:text-zinc-400">{FIELD_TYPE_LABELS[field.field_type]}</span>{field.required && <span className="text-xs text-red-600">*</span>}</div>))}</div></div>)}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3 flex gap-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <button type="button" onClick={handleCloseViewModal} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800">Fechar</button>
              <button type="button" onClick={() => { handleCloseViewModal(); handleOpenEditModal(viewingPetition); }} className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 inline-flex items-center justify-center gap-2"><Pencil className="h-4 w-4" />Editar</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default StandardPetitionsModule;
