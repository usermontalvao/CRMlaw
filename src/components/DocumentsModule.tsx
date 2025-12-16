import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Link2,
  Copy,
  Search,
  Settings,
  Eye,
  Pencil,
  Upload as UploadIcon,
  PenTool,
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { documentTemplateService } from '../services/documentTemplate.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { signatureService } from '../services/signature.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import SignaturePositionDesigner from './SignaturePositionDesigner';
import TemplateFilesManager from './TemplateFilesManager';
import CustomFieldsManager from './CustomFieldsManager';
import type { DocumentTemplate, CreateDocumentTemplateDTO } from '../types/document.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';


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

interface DocumentsModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, any>) => void;
}

const DocumentsModule: React.FC<DocumentsModuleProps> = ({ onNavigateToModule }) => {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processesLoading, setProcessesLoading] = useState(true);
  const [processSearchTerm, setProcessSearchTerm] = useState('');
  const [selectedProcessId, setSelectedProcessId] = useState('');
  const [showProcessSuggestions, setShowProcessSuggestions] = useState(false);
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

  // Estados para designer de posição de assinatura
  const [signatureDesignerOpen, setSignatureDesignerOpen] = useState(false);
  const [signatureDesignerTemplate, setSignatureDesignerTemplate] = useState<DocumentTemplate | null>(null);

  // Estados para gerenciador de múltiplos arquivos
  const [filesManagerOpen, setFilesManagerOpen] = useState(false);
  const [filesManagerTemplate, setFilesManagerTemplate] = useState<DocumentTemplate | null>(null);

  // Estados para gerenciador de campos personalizados (global)
  const [customFieldsManagerOpen, setCustomFieldsManagerOpen] = useState(false);

  // Estados para modal de opções de documento gerado
  const [showDocOptionsModal, setShowDocOptionsModal] = useState(false);
  const [generatedDocBlob, setGeneratedDocBlob] = useState<Blob | null>(null);
  const [generatedDocName, setGeneratedDocName] = useState('');

  // Estados para modal de link de assinatura
  const [showSignatureLinkModal, setShowSignatureLinkModal] = useState(false);
  const [signatureLink, setSignatureLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [preparingSignature, setPreparingSignature] = useState(false);

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

  useEffect(() => {
    let isActive = true;
    const handler = setTimeout(() => {
      (async () => {
        try {
          setProcessesLoading(true);
          const trimmed = processSearchTerm.trim();
          const data = await processService.listProcesses(trimmed ? { search: trimmed } : undefined);
          if (!isActive) return;
          setProcesses(data);
          setSelectedProcessId((prev) => {
            if (!prev) return prev;
            return data.some((process) => process.id === prev) ? prev : '';
          });
        } catch (err) {
          if (isActive) {
            console.error(err);
          }
        } finally {
          if (isActive) {
            setProcessesLoading(false);
          }
        }
      })();
    }, 400);

    return () => {
      isActive = false;
      clearTimeout(handler);
    };
  }, [processSearchTerm]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const selectedProcess = useMemo(
    () => processes.find((process) => process.id === selectedProcessId) ?? null,
    [processes, selectedProcessId],
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
          nullGetter: (part: any) => {
            const key = typeof part?.value === 'string' ? part.value.trim() : '';
            if (/^ASSINATURA(_\d+)?$/i.test(key)) return `[[${key}]]`;
            return '';
          },
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

      const fileName = `${selectedTemplate.name.replace(/\s+/g, '-')}-${removeDiacritics(selectedClient.full_name).replace(/\s+/g, '-')}`;

      // Salvar blob e mostrar modal de opções
      setGeneratedDocBlob(result.blob);
      setGeneratedDocName(fileName);
      setShowDocOptionsModal(true);
      setGenerationSuccess('Documento gerado! Escolha uma opção.');
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Erro ao gerar documento.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  // Baixar como Word
  const handleDownloadWord = () => {
    if (generatedDocBlob) {
      saveAs(generatedDocBlob, `${generatedDocName}.docx`);
    }
  };

  // Converter DOCX para PDF usando docx-preview + html2canvas + jsPDF
  const convertDocxToPdf = async (docxBlob: Blob): Promise<Blob> => {
    return new Promise(async (resolve, reject) => {
      try {
        // Criar container temporário
        const container = document.createElement('div');
        container.style.cssText = `
          position: fixed;
          left: -9999px;
          top: 0;
          width: 794px;
          background: white;
          font-family: 'Times New Roman', Times, serif;
        `;
        document.body.appendChild(container);

        // Renderizar DOCX
        await renderAsync(docxBlob, container, undefined, {
          className: 'docx-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
        });

        // Aguardar renderização
        await new Promise(r => setTimeout(r, 300));

        // Capturar como canvas (escala reduzida para diminuir tamanho)
        const canvas = await html2canvas(container, {
          scale: 1.5, // Reduzido de 2 para 1.5
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: 794,
          windowWidth: 794,
        });

        // Criar PDF com JPEG (menor que PNG)
        const pageWidth = 210;
        const pageHeight = 297;
        const imgData = canvas.toDataURL('image/jpeg', 0.85); // JPEG com 85% qualidade
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * pageWidth) / canvas.width;

        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
          compress: true, // Habilitar compressão
        });

        // Dividir em páginas se necessário
        const totalPages = Math.ceil(imgHeight / pageHeight);
        
        for (let page = 0; page < totalPages; page++) {
          if (page > 0) pdf.addPage();
          const yOffset = -(page * pageHeight);
          pdf.addImage(imgData, 'JPEG', 0, yOffset, imgWidth, imgHeight, undefined, 'FAST');
        }

        document.body.removeChild(container);
        resolve(pdf.output('blob'));
      } catch (error) {
        reject(error);
      }
    });
  };

  // Converter múltiplos DOCXs e juntar em um único PDF
  const convertAndMergeDocxToPdf = async (mainDocx: Blob, attachmentBlobs: Blob[]): Promise<Blob> => {
    // Converter documento principal
    console.log('📄 Convertendo documento principal para PDF...');
    const mainPdf = await convertDocxToPdf(mainDocx);
    
    if (attachmentBlobs.length === 0) {
      return mainPdf;
    }

    // Converter anexos e mesclar usando jsPDF
    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();
    
    // Adicionar documento principal
    const mainPdfDoc = await PDFDocument.load(await mainPdf.arrayBuffer());
    const mainPages = await mergedPdf.copyPages(mainPdfDoc, mainPdfDoc.getPageIndices());
    mainPages.forEach(page => mergedPdf.addPage(page));
    
    // Converter e adicionar cada anexo
    for (let i = 0; i < attachmentBlobs.length; i++) {
      console.log(`📄 Convertendo anexo ${i + 1}/${attachmentBlobs.length} para PDF...`);
      try {
        const attachPdf = await convertDocxToPdf(attachmentBlobs[i]);
        const attachPdfDoc = await PDFDocument.load(await attachPdf.arrayBuffer());
        const attachPages = await mergedPdf.copyPages(attachPdfDoc, attachPdfDoc.getPageIndices());
        attachPages.forEach(page => mergedPdf.addPage(page));
      } catch (err) {
        console.warn(`Erro ao converter anexo ${i + 1}:`, err);
      }
    }
    
    const mergedBytes = await mergedPdf.save();
    return new Blob([new Uint8Array(mergedBytes)], { type: 'application/pdf' });
  };

  // Baixar como PDF
  const handleDownloadPdf = async () => {
    if (!generatedDocBlob) return;
    
    try {
      const pdfBlob = await convertDocxToPdf(generatedDocBlob);
      saveAs(pdfBlob, `${generatedDocName}.pdf`);
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      saveAs(generatedDocBlob, `${generatedDocName}.docx`);
      alert('Erro ao converter para PDF. Arquivo salvo como Word.');
    }
  };

  // Enviar para assinatura - Envia DOCXs separados (documento principal + anexos)
  const handleSendForSignature = async () => {
    if (!selectedTemplate || !selectedClient || !generatedDocBlob) return;
    
    try {
      setPreparingSignature(true);
      setShowDocOptionsModal(false);
      
      // 1. Fazer upload do documento principal gerado (DOCX)
      const fileName = `${generatedDocName}.docx`;
      const file = new File([generatedDocBlob], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const documentPath = await signatureService.uploadDocument(file);
      
      // 2. Carregar, processar variáveis e fazer upload dos documentos anexos do template
      const templateFiles = await documentTemplateService.listTemplateFiles(selectedTemplate.id);
      const attachmentPaths: string[] = [];
      const placeholders = buildPlaceholderMap(selectedClient);
      
      for (const templateFile of templateFiles) {
        try {
          const fileBlob = await documentTemplateService.downloadTemplateFileById(templateFile.id);
          
          const isDocx = templateFile.file_name.toLowerCase().endsWith('.docx') || 
                         templateFile.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          
          let processedBlob: Blob;
          
          if (isDocx) {
            const arrayBuffer = await fileBlob.arrayBuffer();
            const zip = new PizZip(arrayBuffer);
            const doc = new Docxtemplater(zip, {
              paragraphLoop: true,
              linebreaks: true,
              delimiters: { start: '[[', end: ']]' },
              nullGetter: (part: any) => {
                const key = typeof part?.value === 'string' ? part.value.trim() : '';
                if (/^ASSINATURA(_\d+)?$/i.test(key)) return `[[${key}]]`;
                return '';
              },
            });
            
            doc.render(placeholders);
            
            processedBlob = doc.getZip().generate({
              type: 'blob',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });
          } else {
            processedBlob = fileBlob;
          }
          
          const attachmentFile = new File([processedBlob], templateFile.file_name, { type: templateFile.mime_type });
          const attachmentPath = await signatureService.uploadDocument(attachmentFile);
          attachmentPaths.push(attachmentPath);
          console.log(`📎 Anexo enviado: ${templateFile.file_name}`);
        } catch (err) {
          console.warn(`Erro ao processar anexo ${templateFile.file_name}:`, err);
        }
      }
      
      console.log('✅ Documento e anexos enviados:', documentPath, attachmentPaths);
      
      // 3. Navegar para o módulo de assinatura com os dados do documento
      if (onNavigateToModule) {
        onNavigateToModule('assinaturas', {
          mode: 'create',
          prefill: {
            documentPath,
            documentName: `${selectedTemplate.name} - ${selectedClient.full_name}`,
            attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : null,
            clientId: selectedClient.id,
            clientName: selectedClient.full_name,
            clientEmail: selectedClient.email || '',
            clientCpf: selectedClient.cpf_cnpj || '',
            clientPhone: selectedClient.phone || '',
            templateId: selectedTemplate.id,
          },
        });
        
        // Limpar estados
        setPreparingSignature(false);
        setGeneratedDocBlob(null);
        setGeneratedDocName('');
        return;
      }
      
      // Fallback: criar solicitação diretamente se não houver navegação
      const documentId = crypto.randomUUID();
      
      const signatureRequest = await signatureService.createRequest({
        document_id: documentId,
        document_name: `${selectedTemplate.name} - ${selectedClient.full_name}`,
        document_path: documentPath,
        attachment_paths: attachmentPaths.length > 0 ? attachmentPaths : null,
        client_id: selectedClient.id,
        client_name: selectedClient.full_name,
        auth_method: 'signature_only',
        signers: [{
          name: selectedClient.full_name,
          email: selectedClient.email || '',
          cpf: selectedClient.cpf_cnpj || '',
          phone: selectedClient.phone || '',
          role: 'Signatário',
          order: 1,
        }],
      });
      
      const signerToken = signatureRequest.signers[0]?.public_token;
      
      if (!signerToken) {
        throw new Error('Erro ao gerar link de assinatura');
      }
      
      const link = `${window.location.origin}/#/assinar/${signerToken}`;
      
      // Mostrar modal com o link
      setSignatureLink(link);
      setLinkCopied(false);
      setShowSignatureLinkModal(true);
      
    } catch (err: any) {
      console.error('Erro ao criar solicitação de assinatura:', err);
      alert('Erro ao criar solicitação de assinatura: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setPreparingSignature(false);
    }
  };

  // Copiar link para clipboard
  const handleCopyLink = () => {
    navigator.clipboard.writeText(signatureLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    }).catch(() => {
      // Fallback para navegadores antigos
      const input = document.createElement('input');
      input.value = signatureLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    });
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
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setCustomFieldsManagerOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-200 bg-white px-4 py-2 text-sm font-semibold text-purple-600 transition hover:bg-purple-50 hover:border-purple-300"
              >
                <Settings className="h-4 w-4" />
                Campos Personalizados
              </button>
              <button
                onClick={handleOpenModal}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Novo template
              </button>
            </div>
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
                      onClick={() => {
                        setFilesManagerTemplate(template);
                        setFilesManagerOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Documentos
                    </button>
                    <button
                      onClick={() => {
                        setSignatureDesignerTemplate(template);
                        setSignatureDesignerOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-600 transition hover:border-emerald-300 hover:bg-emerald-50"
                    >
                      <PenTool className="h-3.5 w-3.5" />
                      Posicionar Assinatura
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
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-200/80 backdrop-blur-sm"
            onClick={handleCloseModal}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-xl max-h-[92vh] bg-white  rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200  bg-white  flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                  Formulário
                </p>
                <h2 className="text-xl font-semibold text-slate-900 ">Adicionar Template</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white ">
              <form id="template-form" onSubmit={handleUploadTemplate} className="flex flex-col p-6 md:p-8 gap-6">
                {/* Form Fields */}
                <div className="space-y-5">
                  {/* Nome */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Template</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="Digite o nome do template"
                    />
                  </div>

                  {/* Descrição */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Descrição</label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      rows={3}
                      value={descriptionInput}
                      onChange={(e) => setDescriptionInput(e.target.value)}
                      placeholder="Digite a descrição do template"
                    />
                  </div>

                  {/* File Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Arquivo do Template</label>
                    <div className="flex items-center gap-3">
                      <input
                        id="template-file-input"
                        type="file"
                        accept=".doc,.docx"
                        className="hidden"
                        onChange={(e) => setFileInput(e.target.files?.[0] || null)}
                      />
                      <button
                        type="button"
                        onClick={() => document.getElementById('template-file-input')?.click()}
                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <UploadIcon className="w-4 h-4" />
                        {fileInput ? fileInput.name : 'Selecionar arquivo...'}
                      </button>
                      {fileInput && (
                        <button
                          type="button"
                          onClick={() => setFileInput(null)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {uploadError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                    {uploadError}
                  </div>
                )}
              </form>
            </div>

            <div className="border-t border-slate-200  bg-slate-50  px-4 sm:px-6 py-3">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  form="template-form"
                  disabled={uploading}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Enviando...' : 'Salvar Template'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    {/* Preview Modal */}
    {isPreviewModalOpen && createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-200/80 backdrop-blur-sm"
          onClick={handleClosePreviewModal}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-4xl max-h-[92vh] bg-white  rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200  bg-white  flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                Visualizar Template
              </p>
              <h2 className="text-xl font-semibold text-slate-900 ">{previewTemplate?.name}</h2>
            </div>
            <button
              type="button"
              onClick={handleClosePreviewModal}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white  p-6">
            {previewLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : previewError ? (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{previewError}</div>
            ) : previewTemplate?.file_path ? (
              <div className="flex h-full flex-col gap-4">
                {previewPdfUrl ? (
                  <iframe src={previewPdfUrl} title="Preview DOCX" className="h-full w-full rounded-xl border border-gray-200" />
                ) : (
                  <p className="text-sm text-gray-500">Carregando documento...</p>
                )}
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => previewTemplate && handleOpenEditModal(previewTemplate)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar Template
                  </button>
                  <button
                    onClick={() => previewTemplate && handleDownloadTemplate(previewTemplate)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <FileDown className="h-4 w-4" />
                    Baixar Arquivo
                  </button>
                </div>
                <p className="text-xs text-gray-500">A edição direta está disponível apenas para templates em texto.</p>
              </div>
            ) : previewTemplate ? (
              isPreviewEditing ? (
                <form onSubmit={handleSavePreviewEdits} className="flex h-full flex-col gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                      value={previewEditName}
                      onChange={(e) => setPreviewEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrição</label>
                    <textarea
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                      rows={3}
                      value={previewEditDescription}
                      onChange={(e) => setPreviewEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conteúdo</label>
                    <textarea
                      className="w-full h-full min-h-[280px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                      value={previewEditContent}
                      onChange={(e) => setPreviewEditContent(e.target.value)}
                    />
                  </div>
                  {previewEditError && <p className="text-sm text-red-600">{previewEditError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCancelPreviewEditing}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={previewSaving}
                      className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {previewSaving ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">Conteúdo em texto com variáveis prontas para edição.</p>
                    <button
                      onClick={handleStartPreviewEditing}
                      className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Pencil className="h-4 w-4" />
                      Editar Conteúdo
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 whitespace-pre-wrap">
                    {previewEditContent}
                  </pre>
                </div>
              )
            ) : (
              <p className="text-sm text-gray-500">Nenhum conteúdo para visualizar.</p>
            )}
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Modal Preparando Assinatura */}
    {preparingSignature && createPortal(
      <div className="fixed inset-0 z-[90] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          aria-hidden="true"
        />
        <div className="relative w-full max-w-md max-h-[92vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Aguarde
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Preparando documentos...</h2>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 dark:text-slate-400">Enviando documento e anexos para assinatura digital</p>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Edit Modal */}
    {isEditModalOpen && editingTemplate && createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-200/80 backdrop-blur-sm"
          onClick={handleCloseEditModal}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-2xl max-h-[92vh] bg-white  rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200  bg-white  flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                Editar Template
              </p>
              <h2 className="text-xl font-semibold text-slate-900 ">{editingTemplate.name}</h2>
            </div>
            <button
              type="button"
              onClick={handleCloseEditModal}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white ">
            <form id="edit-form" onSubmit={handleSaveTemplateEdits} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrição</label>
                <textarea
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conteúdo</label>
                <textarea
                  className="w-full h-64 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="Conteúdo do template com variáveis entre colchetes duplos, ex: [[NOME]]"
                />
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
            </form>
          </div>

          <div className="border-t border-slate-200  bg-slate-50  px-4 sm:px-6 py-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCloseEditModal}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="edit-form"
                disabled={previewSaving}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {previewSaving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Delete confirmation modal */}
    {deleteTemplateTarget && deleteCaptchaNumbers && createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-200/80 backdrop-blur-sm"
          onClick={handleCloseDeleteModal}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-md max-h-[92vh] bg-white  rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-orange-500" />
          <div className="px-5 sm:px-8 py-5 border-b border-slate-200  bg-white  flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                Confirmar Exclusão
              </p>
              <h2 className="text-xl font-semibold text-slate-900 ">Excluir Template</h2>
            </div>
            <button
              type="button"
              onClick={handleCloseDeleteModal}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white  p-6">
            <p className="text-sm text-gray-700 mb-4">
              Tem certeza que deseja excluir o template <strong>{deleteTemplateTarget.name}</strong>?
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Esta ação não pode ser desfeita.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Confirmação</label>
              <p className="text-sm text-gray-700 mb-2">
                Digite <strong>{deleteCaptchaNumbers[0] + deleteCaptchaNumbers[1]}</strong> para confirmar:
              </p>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm"
                value={deleteCaptchaInput}
                onChange={(e) => setDeleteCaptchaInput(e.target.value)}
                placeholder="Digite a soma"
              />
            </div>
            {deleteError && (
              <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {deleteError}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200  bg-slate-50  px-4 sm:px-6 py-3">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTemplateTarget(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleteLoading ? 'Excluindo...' : 'Excluir Template'}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Designer de posição de assinatura */}
    {signatureDesignerTemplate && (
      <SignaturePositionDesigner
        isOpen={signatureDesignerOpen}
        onClose={() => {
          setSignatureDesignerOpen(false);
          setSignatureDesignerTemplate(null);
        }}
        template={signatureDesignerTemplate}
        onSave={(config) => {
          // Atualizar template na lista local
          setTemplates(prev => prev.map(t => 
            t.id === signatureDesignerTemplate.id 
              ? { ...t, signature_field_config: config }
              : t
          ));
        }}
      />
    )}

    {/* Gerenciador de múltiplos arquivos por template */}
    {filesManagerTemplate && (
      <TemplateFilesManager
        isOpen={filesManagerOpen}
        onClose={() => {
          setFilesManagerOpen(false);
          setFilesManagerTemplate(null);
        }}
        template={filesManagerTemplate}
        onUpdate={async () => {
          // Recarregar templates
          const data = await documentTemplateService.listTemplates();
          setTemplates(data);
        }}
      />
    )}

    {/* Gerenciador de campos personalizados (global) */}
    <CustomFieldsManager
      isOpen={customFieldsManagerOpen}
      onClose={() => setCustomFieldsManagerOpen(false)}
    />

    {/* Modal de opções do documento gerado */}
    {showDocOptionsModal && createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          onClick={() => setShowDocOptionsModal(false)}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-emerald-500" />
          <div className="px-5 sm:px-6 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Sucesso
                </p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Documento Gerado!</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowDocOptionsModal(false)}
              className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-5 sm:p-6">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 break-all">{generatedDocName}</p>
            
            <div className="space-y-3">
              <button
                onClick={handleDownloadWord}
                className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-xl transition border border-blue-100 dark:border-blue-800"
              >
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-800 dark:text-white">Baixar Word</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Arquivo .docx editável</p>
                </div>
              </button>

              <button
                onClick={handleDownloadPdf}
                className="w-full flex items-center gap-3 px-4 py-3 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-xl transition border border-rose-100 dark:border-rose-800"
              >
                <div className="w-10 h-10 bg-rose-600 rounded-lg flex items-center justify-center">
                  <FileDown className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-800 dark:text-white">Baixar PDF</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Documento para impressão</p>
                </div>
              </button>

              <button
                onClick={handleSendForSignature}
                className="w-full flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded-xl transition border border-emerald-100 dark:border-emerald-800"
              >
                <div className="w-10 h-10 bg-emerald-600 rounded-lg flex items-center justify-center">
                  <PenTool className="w-5 h-5 text-white" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-800 dark:text-white">Enviar para Assinatura</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Gerar link para cliente assinar</p>
                </div>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
            <button
              onClick={() => setShowDocOptionsModal(false)}
              className="w-full px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* Modal de Link de Assinatura */}
    {showSignatureLinkModal && createPortal(
      <div className="fixed inset-0 z-[80] flex items-center justify-center px-3 sm:px-6 py-4">
        <div
          className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
          onClick={() => setShowSignatureLinkModal(false)}
          aria-hidden="true"
        />
        <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          <div className="h-2 w-full bg-emerald-500" />
          <div className="px-5 sm:px-6 py-5 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                <Link2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Pronto para enviar
                </p>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Link de Assinatura</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSignatureLinkModal(false)}
              className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 p-5 sm:p-6">
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              Envie este link para o cliente assinar o documento
            </p>
            
            <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 mb-4 border border-slate-200 dark:border-zinc-700">
              <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-2">Link para assinatura:</p>
              <div className="flex items-center gap-2 flex-col sm:flex-row">
                <input
                  type="text"
                  readOnly
                  value={signatureLink}
                  className="flex-1 w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white font-mono"
                />
                <button
                  onClick={handleCopyLink}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 w-full sm:w-auto ${
                    linkCopied 
                      ? 'bg-emerald-600 text-white' 
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {linkCopied ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copiar
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <strong>Dica:</strong> Envie este link por WhatsApp, e-mail ou SMS para o cliente. Ele poderá assinar o documento diretamente pelo celular ou computador.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 sm:px-6 py-3">
            <button
              onClick={() => setShowSignatureLinkModal(false)}
              className="w-full px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold transition hover:bg-slate-800 dark:hover:bg-slate-100"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </div>
  );
}

export default DocumentsModule;
