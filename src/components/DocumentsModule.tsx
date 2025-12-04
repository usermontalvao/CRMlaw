import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Plus,
  FileText,
  Loader2,
  Trash2,
  FileDown,
  BarChart3,
  Users,
  BookOpen,
  X,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Search,
  Settings,
  Eye,
  Pencil,
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
import { documentTemplateService } from '../services/documentTemplate.service';
import { clientService } from '../services/client.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import type { DocumentTemplate, CreateDocumentTemplateDTO } from '../types/document.types';
import type { Client } from '../types/client.types';


const defaultTemplateContent = `[[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]], inscrito(a) no CPF sob o nº [[CPF]], residente e domiciliado(a) na [[endereço]], nº [[número]], [[complemento]], Bairro [[bairro]], [[cidade]] – [[estado]], CEP [[CEP]], telefone/WhatsApp [[celular]]
AÇÃO EM FACE - [[reu]].

[[cidade]] – [[estado]], [[data]].
[[NOME COMPLETO]]`;

const removeDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const formatMaritalStatus = (status?: string | null) => {
  if (!status) return '';
  const map: Record<string, string> = {
    solteiro: 'Solteiro(a)',
    casado: 'Casado(a)',
    divorciado: 'Divorciado(a)',
    viuvo: 'Viúvo(a)',
    viúva: 'Viúva',
    uniao_estavel: 'União Estável',
  };
  return map[status] ?? status;
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r');

const sanitizeText = (value: string) => value.replace(/[\u2028\u2029\u202c\u202d\u202e]/g, '');

const extractTextFromDocxZip = (zip: PizZip) => {
  try {
    const xmlFile = zip.file('word/document.xml');
    if (!xmlFile) return '';

    const xmlContent = xmlFile.asText();
    return decodeXmlEntities(
      xmlContent
        .replace(/<w:p[^>]*>/g, '\n')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{2,}/g, '\n\n')
        .trim(),
    );
  } catch (error) {
    console.error('Erro ao extrair texto do DOCX:', error);
    return '';
  }
};

const DocumentsModule: React.FC = () => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [defendantInput, setDefendantInput] = useState('');
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [downloadingTemplateId, setDownloadingTemplateId] = useState<string | null>(null);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'new-doc' | 'manage'>('new-doc');
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<DocumentTemplate | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewIsObjectUrl, setPreviewIsObjectUrl] = useState(false);
  const [previewEditName, setPreviewEditName] = useState('');
  const [previewEditDescription, setPreviewEditDescription] = useState('');
  const [previewEditContent, setPreviewEditContent] = useState('');
  const [isPreviewEditing, setIsPreviewEditing] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewEditError, setPreviewEditError] = useState<string | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<DocumentTemplate | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteCaptchaInput, setDeleteCaptchaInput] = useState('');
  const [deleteCaptchaNumbers, setDeleteCaptchaNumbers] = useState<[number, number] | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const jsPdfLoaderRef = useRef<Promise<any> | null>(null);

  const currentDate = useMemo(() => new Date(), []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await documentTemplateService.listTemplates();
        setTemplates(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let isActive = true;
    const handler = setTimeout(() => {
      (async () => {
        try {
          setClientsLoading(true);
          const trimmed = clientSearchTerm.trim();
          const data = await clientService.listClients(trimmed ? { search: trimmed } : undefined);
          if (!isActive) return;
          setClients(data);
          setSelectedClientId((prev) => {
            if (!prev) return prev;
            return data.some((client) => client.id === prev) ? prev : '';
          });
        } catch (err) {
          if (isActive) {
            console.error(err);
          }
        } finally {
          if (isActive) {
            setClientsLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [clientSearchTerm]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const handleOpenModal = () => {
    setIsModalOpen(true);
    setUploadError(null);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNameInput('');
    setDescriptionInput('');
    setFileInput(null);
    setUploadError(null);
  };

  const handleUploadTemplate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fileInput) {
      setUploadError('Selecione um arquivo .doc ou .docx.');
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);

      const payload: CreateDocumentTemplateDTO = {
        name: nameInput || fileInput.name.replace(/\.[^.]+$/, ''),
        description: descriptionInput,
        content: defaultTemplateContent,
      };

      await documentTemplateService.createTemplateWithFile(payload, fileInput);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      handleCloseModal();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const buildPlaceholderMap = (client: Client) => {
    const placeholders: Record<string, string> = {};

    const registerPlaceholder = (key: string, value?: string | null) => {
      const safeValue = value ?? '';
      placeholders[key] = safeValue;
      placeholders[key.toUpperCase()] = safeValue;
      const normalizedKey = removeDiacritics(key);
      placeholders[normalizedKey] = safeValue;
      placeholders[normalizedKey.toUpperCase()] = safeValue;
    };

    registerPlaceholder('NOME COMPLETO', client.full_name);
    registerPlaceholder('nacionalidade', client.nationality);
    registerPlaceholder('estado civil', formatMaritalStatus(client.marital_status));
    registerPlaceholder('profissão', client.profession);
    registerPlaceholder('CPF', client.cpf_cnpj);
    registerPlaceholder('endereço', client.address_street);
    registerPlaceholder('número', client.address_number);
    registerPlaceholder('complemento', client.address_complement);
    registerPlaceholder('bairro', client.address_neighborhood);
    registerPlaceholder('cidade', client.address_city);
    registerPlaceholder('estado', client.address_state);
    registerPlaceholder('CEP', client.address_zip_code);
    const primaryPhone = client.phone || client.mobile || '';
    registerPlaceholder('telefone', primaryPhone);
    registerPlaceholder('celular', primaryPhone);
    registerPlaceholder('réu', defendantInput);
    registerPlaceholder('data', formatDate(currentDate.toISOString()));

    return placeholders;
  };

  const replacePlaceholdersInString = (templateString: string, placeholders: Record<string, string>) => {
    let result = templateString;
    Object.entries(placeholders).forEach(([key, value]) => {
      const pattern = new RegExp(`\[\[${escapeRegExp(key)}\]\]`, 'g');
      result = result.replace(pattern, value ?? '');
    });
    return result;
  };

  const createDocxFromContent = async (content: string) => {
    const paragraphs = content.split(/\n/g).map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, break: 0 })],
        }),
    );

    const doc = new DocxDocument({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    return Packer.toBlob(doc);
  };

  const loadJsPdf = () => {
    const existing = (window as any).jspdf;
    if (existing?.jsPDF) {
      return Promise.resolve(existing);
    }

    if (!jsPdfLoaderRef.current) {
      jsPdfLoaderRef.current = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
        script.async = true;
        script.onload = () => resolve((window as any).jspdf || (window as any).jsPDF);
        script.onerror = () => reject(new Error('Não foi possível carregar dependências de PDF.'));
        document.body.appendChild(script);
      });
    }

    return jsPdfLoaderRef.current;
  };

  const getTemplateTextContent = async (template: DocumentTemplate) => {
    if (template.file_path) {
      const file = await documentTemplateService.downloadTemplateFile(template);
      const arrayBuffer = await file.arrayBuffer();
      const zip = new PizZip(arrayBuffer);
      const extracted = extractTextFromDocxZip(zip);
      return sanitizeText(extracted || template.content || template.description || '');
    }
    return sanitizeText(template.content || template.description || '');
  };

  const handlePreviewTemplate = async (template: DocumentTemplate) => {
    setPreviewTemplate(template);
    setPreviewError(null);
    setIsPreviewModalOpen(true);
    setPreviewLoading(true);
    setIsPreviewEditing(false);
    setPreviewEditError(null);

    try {
      if (template.file_path) {
        const textContent = (await getTemplateTextContent(template)) || '';
        if (previewPdfUrl && previewIsObjectUrl) {
          URL.revokeObjectURL(previewPdfUrl);
        }
        const signedUrl = await documentTemplateService.getTemplateSignedUrl(template);
        const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
        setPreviewPdfUrl(officeViewerUrl);
        setPreviewIsObjectUrl(false);
        setPreviewEditName(template.name);
        setPreviewEditDescription(template.description || '');
        setPreviewEditContent(textContent);
      } else {
        const textContent = (await getTemplateTextContent(template)) || 'Conteúdo não disponível.';
        if (previewPdfUrl && previewIsObjectUrl) {
          URL.revokeObjectURL(previewPdfUrl);
        }
        setPreviewPdfUrl(null);
        setPreviewIsObjectUrl(false);
        setPreviewEditContent(textContent);
        setPreviewEditName(template.name);
        setPreviewEditDescription(template.description || '');
      }
    } catch (err: any) {
      console.error(err);
      setPreviewError(err.message || 'Não foi possível gerar a visualização.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreviewModal = () => {
    if (previewPdfUrl && previewIsObjectUrl) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    setPreviewPdfUrl(null);
    setPreviewIsObjectUrl(false);
    setPreviewTemplate(null);
    setPreviewError(null);
    setIsPreviewModalOpen(false);
    setPreviewEditContent('');
    setPreviewEditName('');
    setPreviewEditDescription('');
    setIsPreviewEditing(false);
    setPreviewEditError(null);
  };

  useEffect(() => {
    return () => {
      if (previewPdfUrl && previewIsObjectUrl) {
        URL.revokeObjectURL(previewPdfUrl);
      }
    };
  }, [previewPdfUrl, previewIsObjectUrl]);

  const handleStartPreviewEditing = () => {
    if (!previewTemplate || previewTemplate.file_path) return;
    setIsPreviewEditing(true);
    setPreviewEditError(null);
  };

  const handleCancelPreviewEditing = () => {
    if (!previewTemplate) return;
    setIsPreviewEditing(false);
    setPreviewEditError(null);
    setPreviewEditName(previewTemplate.name);
    setPreviewEditDescription(previewTemplate.description || '');
    setPreviewEditContent(previewTemplate.content || '');
  };

  const handleSavePreviewEdits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!previewTemplate || previewTemplate.file_path) return;

    const trimmedName = previewEditName.trim();
    if (!trimmedName) {
      setPreviewEditError('Informe um nome para o template.');
      return;
    }

    try {
      setPreviewSaving(true);
      setPreviewEditError(null);

      await documentTemplateService.updateTemplate(previewTemplate.id, {
        name: trimmedName,
        description: previewEditDescription,
        content: previewEditContent,
      });

      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      const updatedTemplate = data.find((t) => t.id === previewTemplate.id) || previewTemplate;
      setPreviewTemplate(updatedTemplate);
      setPreviewEditName(updatedTemplate.name);
      setPreviewEditDescription(updatedTemplate.description || '');
      setPreviewEditContent(updatedTemplate.content || '');
      setIsPreviewEditing(false);
    } catch (err: any) {
      console.error(err);
      setPreviewEditError(err.message || 'Não foi possível salvar as alterações.');
    } finally {
      setPreviewSaving(false);
    }
  };

  const handleOpenEditModal = (template: DocumentTemplate) => {
    setEditingTemplate(template);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditContent(template.content || '');
    setEditFile(null);
    setEditError(null);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingTemplate(null);
    setEditFile(null);
  };

  const handleSaveTemplateEdits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTemplate) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Informe um nome para o template.');
      return;
    }

    try {
      setEditSaving(true);
      setEditError(null);

      const basePayload: Partial<CreateDocumentTemplateDTO> = {
        name: trimmedName,
        description: editDescription,
      };

      if (!editingTemplate.file_path) {
        basePayload.content = editContent || '';
      }

      if (editFile) {
        await documentTemplateService.updateTemplateWithFile(editingTemplate, basePayload, editFile);
      } else {
        await documentTemplateService.updateTemplate(editingTemplate.id, basePayload);
      }

      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      handleCloseEditModal();
    } catch (err: any) {
      console.error(err);
      setEditError(err.message || 'Não foi possível salvar as alterações.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleGenerateDocument = async () => {
    if (!selectedClient || !selectedTemplate) {
      setGenerationError('Selecione o cliente e o modelo antes de gerar.');
      return null;
    }

    try {
      setGenerationError(null);

      const placeholders = buildPlaceholderMap(selectedClient);

      if (selectedTemplate.file_path) {
        const file = await documentTemplateService.downloadTemplateFile(selectedTemplate);
        const arrayBuffer = await file.arrayBuffer();
        const zip = new PizZip(arrayBuffer);
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '[[', end: ']]' },
        });

        doc.render(placeholders);

        const renderedZip = doc.getZip();
        const blob = renderedZip.generate({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const text = sanitizeText(extractTextFromDocxZip(renderedZip) || Object.values(placeholders).join('\n'));
        return { blob, text };
      }

      const content = sanitizeText(replacePlaceholdersInString(selectedTemplate.content, placeholders));
      const blob = await createDocxFromContent(content);
      return { blob, text: content };
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Não foi possível gerar o documento.');
      return null;
    }
  };

  const handleDownloadTemplate = async (template: DocumentTemplate) => {
    if (!template.file_path && !template.content) {
      setTemplateActionError('Template não possui conteúdo disponível para download.');
      return;
    }

    try {
      setTemplateActionError(null);
      setDownloadingTemplateId(template.id);

      if (template.file_path) {
        const file = await documentTemplateService.downloadTemplateFile(template);
        const fileName = template.file_name || `${template.name}.docx`;
        saveAs(file, fileName);
      } else {
        const content = sanitizeText(template.content || '');
        const blob = await createDocxFromContent(content);
        const fileName = `${removeDiacritics(template.name).replace(/\s+/g, '-') || 'template'}.docx`;
        saveAs(blob, fileName);
      }
    } catch (err: any) {
      console.error(err);
      setTemplateActionError(err.message || 'Não foi possível baixar este template.');
    } finally {
      setDownloadingTemplateId(null);
    }
  };

  const handleGenerateDocx = async () => {
    if (!selectedClient || !selectedTemplate) {
      setGenerationError('Selecione o cliente e o modelo antes de gerar.');
      return;
    }

    try {
      setGeneratingDocx(true);
      setGenerationError(null);
      setGenerationSuccess(null);
      const result = await handleGenerateDocument();
      if (!result) return;

      const fileName = `${selectedTemplate.name.replace(/\s+/g, '-')}-${removeDiacritics(selectedClient.full_name).replace(/\s+/g, '-')}.docx`;

      saveAs(result.blob, fileName);

      setGenerationSuccess('Documento Word gerado com sucesso.');
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Erro ao gerar documento.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const generateCaptchaNumbers = () => {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    return [a, b] as [number, number];
  };

  const openDeleteModal = (template: DocumentTemplate) => {
    setDeleteTemplateTarget(template);
    setDeleteConfirmName('');
    setDeleteCaptchaInput('');
    setDeleteCaptchaNumbers(generateCaptchaNumbers());
    setDeleteError(null);
  };

  const handleCloseDeleteModal = () => {
    setDeleteTemplateTarget(null);
    setDeleteConfirmName('');
    setDeleteCaptchaInput('');
    setDeleteCaptchaNumbers(null);
    setDeleteLoading(false);
    setDeleteError(null);
  };

  const handleConfirmDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deleteTemplateTarget || !deleteCaptchaNumbers) return;

    const trimmedName = deleteConfirmName.trim();
    if (!trimmedName) {
      setDeleteError('Digite o nome do template para confirmar.');
      return;
    }

    if (trimmedName !== deleteTemplateTarget.name) {
      setDeleteError('Nome não confere. Digite exatamente como aparece.');
      return;
    }

    const expectedAnswer = deleteCaptchaNumbers[0] + deleteCaptchaNumbers[1];
    if (parseInt(deleteCaptchaInput, 10) !== expectedAnswer) {
      setDeleteError('Resposta do desafio incorreta.');
      return;
    }

    try {
      setDeleteLoading(true);
      setDeleteError(null);
      setTemplateActionError(null);
      await documentTemplateService.deleteTemplate(deleteTemplateTarget.id);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      if (selectedTemplateId === deleteTemplateTarget.id) setSelectedTemplateId('');
      handleCloseDeleteModal();
    } catch (err: any) {
      console.error(err);
      setDeleteError(err.message || 'Não foi possível remover este template.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const totalTemplates = templates.length;
  const templatesWithFile = templates.filter((template) => template.file_path).length;

  return (
    <>
      <div className="space-y-6">
      {/* Header com tabs */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <FileText className="h-4 w-4 text-slate-400" />
            Modelos de documentos
          </div>
          <h3 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Gerencie templates e documentos</h3>
        </div>
        <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:px-6">
          <button
            onClick={() => setActiveView('new-doc')}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeView === 'new-doc'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Plus className="h-4 w-4" />
            Novo documento
          </button>
          <button
            onClick={() => setActiveView('manage')}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeView === 'manage'
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Settings className="h-4 w-4" />
            Gerenciar templates
          </button>
        </div>
      </div>

      {/* Novo documento */}
      {activeView === 'new-doc' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4">
            <h4 className="text-base font-semibold text-slate-900">Gerar novo documento</h4>
            <p className="text-sm text-slate-500">Preencha os campos e clique em gerar para baixar o Word.</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente *</label>
              <ClientSearchSelect
                value={selectedClientId}
                onChange={(clientId, clientName) => {
                  setSelectedClientId(clientId);
                  setClientSearchTerm(clientName);
                }}
                label=""
                placeholder="Buscar cliente pelo nome"
                required
                allowCreate={true}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Template *</label>
              <div className="relative">
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Selecione um modelo</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Réu / Parte contrária (opcional)</label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 transition hover:border-slate-300 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                placeholder="Ex: Empresa XPTO Ltda"
                value={defendantInput}
                onChange={(e) => setDefendantInput(e.target.value)}
              />
            </div>
            {generationError && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {generationError}
              </div>
            )}
            {generationSuccess && (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {generationSuccess}
              </div>
            )}
            <button
              onClick={handleGenerateDocx}
              disabled={generatingDocx || !selectedClientId || !selectedTemplateId}
              className="w-full rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
            >
              {generatingDocx ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando documento...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <FileDown className="h-4 w-4" />
                  Gerar documento Word
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Gerenciar templates */}
      {activeView === 'manage' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Templates cadastrados</h4>
              <p className="text-sm text-slate-500">Visualize, edite, baixe ou remova templates existentes.</p>
            </div>
            <button
              onClick={handleOpenModal}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Novo template
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nenhum template cadastrado ainda.</p>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <h5 className="font-semibold text-slate-900">{template.name}</h5>
                    {template.description && <p className="text-sm text-slate-600">{template.description}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      {template.file_path ? `Arquivo: ${template.file_name || 'template.docx'}` : 'Template em texto'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handlePreviewTemplate(template)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Visualizar
                    </button>
                    <button
                      onClick={() => handleDownloadTemplate(template)}
                      disabled={downloadingTemplateId === template.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                    >
                      {downloadingTemplateId === template.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5" />
                      )}
                      Baixar
                    </button>
                    <button
                      onClick={() => openDeleteModal(template)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {templateActionError && (
            <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {templateActionError}
            </div>
          )}
        </div>
      )}

      {/* Novo template modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Adicionar template</p>
                <h3 className="text-lg font-semibold text-slate-900">Novo template</h3>
              </div>
              <button onClick={handleCloseModal} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUploadTemplate} className="space-y-4 px-5 py-5">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome do template</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Ex: Petição Inicial"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</label>
                <textarea
                  className="input-field text-sm"
                  rows={3}
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder="Breve resumo sobre o uso do template"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arquivo .docx *</label>
                <input
                  type="file"
                  accept=".doc,.docx"
                  className="input-field text-sm"
                  onChange={(e) => setFileInput(e.target.files?.[0] || null)}
                />
              </div>
              {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition disabled:bg-slate-300"
                >
                  {uploading ? 'Enviando...' : 'Salvar template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {isPreviewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visualizar template</p>
                <h3 className="text-lg font-semibold text-slate-900">{previewTemplate?.name}</h3>
              </div>
              <button onClick={handleClosePreviewModal} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="h-[70vh] overflow-hidden p-6">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : previewError ? (
                <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">{previewError}</div>
              ) : previewTemplate?.file_path ? (
                <div className="flex h-full flex-col gap-4">
                  {previewPdfUrl ? (
                    <iframe src={previewPdfUrl} title="Preview DOCX" className="h-full w-full rounded-xl border border-slate-200" />
                  ) : (
                    <p className="text-sm text-slate-500">Carregando documento...</p>
                  )}
                  <div className="flex flex-wrap gap-3 text-sm">
                    <button
                      onClick={() => previewTemplate && handleOpenEditModal(previewTemplate)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 font-medium text-slate-700 hover:border-slate-300"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar template
                    </button>
                    <button
                      onClick={() => previewTemplate && handleDownloadTemplate(previewTemplate)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 font-medium text-slate-700 hover:border-slate-300"
                    >
                      <FileDown className="h-4 w-4" />
                      Baixar arquivo
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">A edição direta está disponível apenas para templates em texto. Para arquivos Word, substitua o arquivo pelo botão "Editar template".</p>
                </div>
              ) : previewTemplate ? (
                isPreviewEditing ? (
                  <form onSubmit={handleSavePreviewEdits} className="flex h-full flex-col gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</label>
                      <input
                        type="text"
                        className="input-field text-sm"
                        value={previewEditName}
                        onChange={(e) => setPreviewEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</label>
                      <textarea
                        className="input-field text-sm"
                        rows={3}
                        value={previewEditDescription}
                        onChange={(e) => setPreviewEditDescription(e.target.value)}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conteúdo</label>
                      <textarea
                        className="input-field h-full min-h-[280px] text-sm"
                        value={previewEditContent}
                        onChange={(e) => setPreviewEditContent(e.target.value)}
                      />
                    </div>
                    {previewEditError && <p className="text-sm text-red-600">{previewEditError}</p>}
                    <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={handleCancelPreviewEditing}
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={previewSaving}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition disabled:bg-slate-300"
                      >
                        {previewSaving ? 'Salvando...' : 'Salvar alterações'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-slate-500">Conteúdo em texto com variáveis prontas para edição.</p>
                      <button
                        onClick={handleStartPreviewEditing}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar conteúdo
                      </button>
                    </div>
                    <pre className="flex-1 overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700 whitespace-pre-wrap">
                      {previewEditContent}
                    </pre>
                  </div>
                )
              ) : (
                <p className="text-sm text-slate-500">Nenhum conteúdo para visualizar.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Editar template</p>
                <h3 className="text-lg font-semibold text-slate-900">{editingTemplate.name}</h3>
              </div>
              <button onClick={handleCloseEditModal} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveTemplateEdits} className="space-y-4 p-6">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome *</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</label>
                <textarea
                  className="input-field text-sm"
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>
              {!editingTemplate.file_path && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conteúdo</label>
                  <textarea
                    className="input-field text-sm"
                    rows={8}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </div>
              )}
              {editingTemplate.file_path && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Substituir arquivo (opcional)</label>
                  <input
                    type="file"
                    accept=".docx"
                    className="input-field text-sm"
                    onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-xs text-slate-500">Deixe em branco para manter o arquivo atual.</p>
                </div>
              )}
              {editError && <p className="text-sm text-red-600">{editError}</p>}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition disabled:bg-slate-300"
                >
                  {editSaving ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTemplateTarget && deleteCaptchaNumbers ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Excluir template</p>
                <h3 className="text-lg font-semibold text-slate-900">{deleteTemplateTarget.name}</h3>
              </div>
              <button onClick={handleCloseDeleteModal} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmDelete} className="space-y-4 px-5 py-5">
              <p className="text-sm text-slate-600">
                Esta ação é permanente. Digite o <strong>nome completo</strong> do template abaixo e resolva o desafio para confirmar.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome do template</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Desafio: quanto é {deleteCaptchaNumbers[0]} + {deleteCaptchaNumbers[1]}?
                </label>
                <input
                  type="number"
                  className="input-field text-sm"
                  value={deleteCaptchaInput}
                  onChange={(e) => setDeleteCaptchaInput(e.target.value)}
                />
              </div>
              {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
              <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleCloseDeleteModal}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deleteLoading}
                  className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition disabled:bg-red-300"
                >
                  {deleteLoading ? 'Removendo...' : 'Confirmar exclusão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      </div>
    </>
  );
};

export default DocumentsModule;
