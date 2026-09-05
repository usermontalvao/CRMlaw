import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Modal, ModalBody, ModuleSkeleton } from './ui';
import {
  Plus,
  FileText,
  Loader2,
  Trash2,
  FileDown,
  BookOpen,
  X,
  Sparkles,
  CheckCircle2,
  Link2,
  Copy,
  Search,
  Settings,
  Pencil,
  Upload as UploadIcon,
  PenTool,
  GripVertical,
  AlertTriangle,
  Check,
  ChevronRight,
  MoreHorizontal,
  MessageCircle,
} from 'lucide-react';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { Document as DocxDocument, Packer, Paragraph, TextRun } from 'docx';
import { docxBlobToPdf } from '../utils/docxToPdf';
import { matchesNormalizedSearch } from '../utils/search';
import {
  formatCepForDocument,
  formatCpfCnpjForDocument,
  formatPhoneForDocument,
  formatProperNamePtBr,
  formatQualificationTerm,
  formatUfForDocument,
} from '../utils/clientFieldFormat';
import { documentTemplateService } from '../services/documentTemplate.service';
import { clientService } from '../services/client.service';
import { processService } from '../services/process.service';
import { signatureService } from '../services/signature.service';
import { congelarOriginais } from '../services/congelamentoDeOriginal.service';
import { settingsService } from '../services/settings.service';
import { supabase } from '../config/supabase';
import { buildPublicFillUrl, buildPublicPermalinkUrl, buildPublicSigningUrl } from '../utils/publicAppUrl';
import { signatureFieldsService } from '../services/signatureFields.service';
import { ClientSearchSelect } from './ClientSearchSelect';
import { useToastContext } from '../contexts/ToastContext';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import TemplateFilesManager from './TemplateFilesManager';
import TemplateCard from './documents/TemplateCard';
import TemplateFillLinkPanel from './documents/TemplateFillLinkPanel';
import DocumentLivePreview, { type PreviewDocument } from './documents/DocumentLivePreview';
import SidePanel from './documents/SidePanel';
import LinkGenerationOverlay, {
  DURACAO_DO_FECHO_MS,
  DURACAO_MINIMA_ANIMACAO_MS,
  type LinkOverlayPhase,
} from './documents/LinkGenerationOverlay';
import CustomFieldsManager from './CustomFieldsManager';
import StandardPetitionsModule from './StandardPetitionsModule';
import type { DocumentTemplate, CreateDocumentTemplateDTO, UpsertTemplateCustomFieldDTO } from '../types/document.types';
import type { Client } from '../types/client.types';
import type { Process } from '../types/process.types';
import type { SignatureRequestWithSigners, SignerAuthMethod } from '../types/signature.types';
import { LAYER } from '../styles/layers';
import { openWhatsAppChat } from '../utils/whatsappChat';
import { buildWhatsappUrl } from '../utils/whatsapp';
import { formatPhone } from '../utils/formatters';
import {
  humanizeTemplatePlaceholder,
  isBuiltInTemplatePlaceholder,
  mergeTemplateFieldDefinitions,
  normalizeTemplateFieldKey,
  selectActiveCustomTemplateFields,
} from '../utils/documentTemplateFields';


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

const normalizeKey = (value: string) => removeDiacritics((value || '').trim()).toUpperCase();
const normalizeDefendantValue = (value: string) => (value || '').toLocaleUpperCase('pt-BR');

const formatDateLong = (date: Date) => {
  try {
    const dtf = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const formatted = dtf.format(date);
    return formatted;
  } catch {
    return date.toLocaleDateString('pt-BR');
  }
};

const getManausNow = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Manaus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) return now;
  return new Date(`${year}-${month}-${day}T12:00:00-04:00`);
};

const extractPlaceholdersFromText = (content: string): string[] => {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    if (/^ASSINATURA(_\d+)?$/i.test(raw)) continue;
    const k = normalizeKey(raw);
    if (seen.has(k)) continue;
    seen.add(k);
    found.push(raw);
  }
  return found;
};

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Copia sem quebrar quando o navegador recusa a área de transferência (Safari
// costuma negar depois de um `await`). Devolve se conseguiu, para a tela poder
// dizer "copiado" só quando foi verdade.
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// Um arquivo "assina" quando tem ao menos uma posição de assinatura gravada.
// A coluna aceita objeto, lista ou nulo, e a lista pode vir vazia.
const hasSignatureConfig = (config: unknown): boolean => {
  if (!config) return false;
  if (Array.isArray(config)) return config.length > 0;
  return true;
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('pt-BR');
};

const buildFullAddress = (client: Client) => {
  const parts: string[] = [];
  const street = (client.address_street || '').trim();
  const number = (client.address_number || '').trim();
  const complement = (client.address_complement || '').trim();
  const neighborhood = formatProperNamePtBr(client.address_neighborhood);
  const city = formatProperNamePtBr(client.address_city);
  const state = formatUfForDocument(client.address_state);
  const cep = formatCepForDocument(client.address_zip_code);

  const line1 = [street, number ? `nº ${number}` : '', complement].filter(Boolean).join(', ');
  const line2 = [neighborhood ? `Bairro ${neighborhood}` : '', city, state].filter(Boolean).join(' - ');

  if (line1) parts.push(line1);
  if (line2) parts.push(line2);
  if (cep) parts.push(`CEP ${cep}`);

  return parts.join(', ');
};

const extractPlaceholdersFromDocxZip = (zip: PizZip): string[] => {
  try {
    const xmlFiles = zip.file(/^word\/(document|header\d+|footer\d+)\.xml$/);
    const sources = (Array.isArray(xmlFiles) && xmlFiles.length > 0)
      ? xmlFiles
      : (() => {
          const doc = zip.file('word/document.xml');
          return doc ? [doc] : [];
        })();

    if (sources.length === 0) return [];

    const found = new Set<string>();
    const re = /\[\[([^\]]+)\]\]/g;

    for (const file of sources) {
      const xml = file.asText();
      const text = xml
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const raw = (m[1] || '').trim();
        if (!raw) continue;
        if (/^ASSINATURA(_\d+)?$/i.test(raw)) continue;
        found.add(raw);
      }
    }

    return Array.from(found);
  } catch (error) {
    console.error('Erro ao extrair placeholders do DOCX:', error);
    return [];
  }
};

interface TemplatePlaceholderInventory {
  placeholders: string[];
  filesByKey: Record<string, string[]>;
}

/** Varre o documento principal e todos os DOCX anexos do kit. */
const inspectTemplatePlaceholders = async (template: DocumentTemplate): Promise<TemplatePlaceholderInventory> => {
  const byKey = new Map<string, { placeholder: string; files: Set<string> }>();

  const register = (placeholder: string, fileName: string) => {
    const key = normalizeTemplateFieldKey(placeholder);
    const current = byKey.get(key) ?? { placeholder, files: new Set<string>() };
    current.files.add(fileName);
    byKey.set(key, current);
  };

  const inspectBlob = async (blob: Blob, fileName: string) => {
    const zip = new PizZip(await blob.arrayBuffer());
    extractPlaceholdersFromDocxZip(zip).forEach((placeholder) => register(placeholder, fileName));
  };

  if (template.file_path) {
    const mainFileName = template.file_name || `${template.name}.docx`;
    await inspectBlob(await documentTemplateService.downloadTemplateFile(template), mainFileName);
  } else {
    extractPlaceholdersFromText(template.content || '').forEach((placeholder) => register(placeholder, 'Conteúdo do template'));
  }

  const attachments = await documentTemplateService.listTemplateFiles(template.id);
  for (const attachment of attachments) {
    const isDocx = attachment.file_name.toLocaleLowerCase('pt-BR').endsWith('.docx')
      || attachment.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (!isDocx) continue;
    try {
      await inspectBlob(await documentTemplateService.downloadTemplateFileById(attachment.id), attachment.file_name);
    } catch (error) {
      console.warn(`Não foi possível analisar os campos de ${attachment.file_name}:`, error);
    }
  }

  const filesByKey: Record<string, string[]> = {};
  for (const [key, item] of byKey) filesByKey[key] = Array.from(item.files);
  return {
    placeholders: Array.from(byKey.values()).map((item) => item.placeholder),
    filesByKey,
  };
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
  const toast = useToastContext();
  const { confirmDelete, notifyDeleted } = useDeleteConfirm();
  const { ensurePermission } = useSecurityPin();

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
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [defendantInput, setDefendantInput] = useState('');
  const [generatingDocx, setGeneratingDocx] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [enableDefendantInput, setEnableDefendantInput] = useState(true);
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [downloadingTemplateId, setDownloadingTemplateId] = useState<string | null>(null);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'new-doc' | 'manage' | 'petitions'>('new-doc');
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
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editEnableDefendant, setEditEnableDefendant] = useState(true);
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const jsPdfLoaderRef = useRef<Promise<any> | null>(null);

  // Estados para gerenciador de múltiplos arquivos
  const [filesManagerOpen, setFilesManagerOpen] = useState(false);
  const [filesManagerTemplate, setFilesManagerTemplate] = useState<DocumentTemplate | null>(null);
  const [filesManagerChanged, setFilesManagerChanged] = useState(false);

  // Estados para gerenciador de campos personalizados (global)
  const [customFieldsManagerOpen, setCustomFieldsManagerOpen] = useState(false);

  // Estados para modal de opções de documento gerado
  const [showDocOptionsModal, setShowDocOptionsModal] = useState(false);
  const [generatedDocBlob, setGeneratedDocBlob] = useState<Blob | null>(null);
  const [generatedDocName, setGeneratedDocName] = useState('');
  const [generatedAttachments, setGeneratedAttachments] = useState<Array<{ blob: Blob; name: string }>>([]);

  // Estados para modal de link de assinatura
  const [showSignatureLinkModal, setShowSignatureLinkModal] = useState(false);
  const [signatureLink, setSignatureLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  // Quem recebe o link, congelado no instante em que o modal abre. A seleção da
  // tela de trás continua viva e pode mudar; a mensagem do WhatsApp tem de
  // continuar sendo a do documento que acabou de sair.
  const [signatureLinkTarget, setSignatureLinkTarget] = useState<{
    clientId: string;
    clientName: string;
    phone: string;
    documentName: string;
  } | null>(null);

  const [preparingSignature, setPreparingSignature] = useState(false);

  const [showTemplateFillLinkModal, setShowTemplateFillLinkModal] = useState(false);
  // Dois links por modelo, e eles servem a coisas diferentes:
  //   - o de uso único (/preencher/<token>) nasce NOVO a cada abertura do modal
  //     e vale 7 dias. É o que vai para um cliente específico — mandar o mesmo
  //     para duas pessoas é o problema que ele existe para evitar;
  //   - o permalink (/p/<slug>) é fixo por modelo e serve para divulgação.
  const [templateFillUniqueLink, setTemplateFillUniqueLink] = useState('');
  const [templateFillPermanentLink, setTemplateFillPermanentLink] = useState('');
  const [templateFillCopiedKind, setTemplateFillCopiedKind] = useState<'unique' | 'permanent' | null>(null);
  const [creatingTemplateFillLinkId, setCreatingTemplateFillLinkId] = useState<string | null>(null);
  const [linkOverlayPhase, setLinkOverlayPhase] = useState<LinkOverlayPhase | null>(null);
  const [linkOverlayTemplateName, setLinkOverlayTemplateName] = useState<string | undefined>(undefined);

  const [templateFilesSummary, setTemplateFilesSummary] = useState<Record<string, { count: number; firstFileName?: string; signedCount: number }>>({});

  // Menu "⋯" do cartão do modelo: as ações que não são "usar" moram aqui, para
  // sobrar um alvo principal por cartão em vez de sete do mesmo peso.
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<string | null>(null);

  // A tela de gerar tem três painéis e uma largura só. Conforme cada etapa é
  // resolvida, o painel dela encolhe numa faixa e devolve o espaço para a
  // folha — que é o que a pessoa precisa olhar no fim.
  const [activeStep, setActiveStep] = useState<'template' | 'data' | 'preview'>('template');
  // A prévia só carrega quando a etapa 3 abre — e ela só abre por clique.
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // Arquivos do modelo para a folha ao vivo: o principal e TODOS os anexos, na
  // ordem em que são gerados. Conferir só o primeiro não diz nada sobre os
  // outros cinco de um kit.
  const [livePreviewDocs, setLivePreviewDocs] = useState<PreviewDocument[]>([]);
  const [livePreviewError, setLivePreviewError] = useState<string | null>(null);

  const [templateExtraFields, setTemplateExtraFields] = useState<UpsertTemplateCustomFieldDTO[]>([]);
  const [templateExtraFieldsLoading, setTemplateExtraFieldsLoading] = useState(false);
  const [templateExtraValues, setTemplateExtraValues] = useState<Record<string, string>>({});

  const [showTemplateFormConfigModal, setShowTemplateFormConfigModal] = useState(false);
  const [templateConfigMode, setTemplateConfigMode] = useState<'form' | 'custom'>('form');
  const [templateFormConfigTemplate, setTemplateFormConfigTemplate] = useState<DocumentTemplate | null>(null);
  const [templateFormConfigLoading, setTemplateFormConfigLoading] = useState(false);
  const [templateFormConfigSaving, setTemplateFormConfigSaving] = useState(false);
  const [templateFormConfigError, setTemplateFormConfigError] = useState<string | null>(null);
  const [templateFormConfigFields, setTemplateFormConfigFields] = useState<UpsertTemplateCustomFieldDTO[]>([]);
  const [templateFormDetectedKeys, setTemplateFormDetectedKeys] = useState<string[]>([]);
  const [templateFormExistingKeys, setTemplateFormExistingKeys] = useState<string[]>([]);
  const [templateFormNewCustomKeys, setTemplateFormNewCustomKeys] = useState<string[]>([]);
  const [templateFormFilesByKey, setTemplateFormFilesByKey] = useState<Record<string, string[]>>({});
  const [showNewTemplateFieldForm, setShowNewTemplateFieldForm] = useState(false);
  const [newTemplateField, setNewTemplateField] = useState({
    name: '',
    placeholder: '',
    field_type: 'text' as UpsertTemplateCustomFieldDTO['field_type'],
    required: true,
    description: '',
  });
  const templateFormConfigDragIndexRef = useRef<number | null>(null);

  const templateConfigVisibleFields = useMemo(
    () => templateFormConfigFields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => templateConfigMode === 'form' || !isBuiltInTemplatePlaceholder(field.placeholder)),
    [templateConfigMode, templateFormConfigFields],
  );

  const currentDate = useMemo(() => getManausNow(), []);

  const handleOpenTemplateFormConfig = async (
    template: DocumentTemplate,
    mode: 'form' | 'custom' = 'form',
  ) => {
    try {
      setTemplateConfigMode(mode);
      setTemplateFormConfigTemplate(template);
      setShowTemplateFormConfigModal(true);
      setTemplateFormConfigLoading(true);
      setTemplateFormConfigError(null);
      setShowNewTemplateFieldForm(false);
      setNewTemplateField({ name: '', placeholder: '', field_type: 'text', required: true, description: '' });

      const [existingConfig, globalCustomFields, inventory] = await Promise.all([
        documentTemplateService.listTemplateCustomFields(template.id),
        documentTemplateService.listCustomFields(),
        inspectTemplatePlaceholders(template),
      ]);

      const merged = mergeTemplateFieldDefinitions(inventory.placeholders, existingConfig, globalCustomFields);
      setTemplateFormConfigFields(merged.fields);
      setTemplateFormDetectedKeys(inventory.placeholders.map(normalizeTemplateFieldKey));
      setTemplateFormExistingKeys(existingConfig.map((field) => normalizeTemplateFieldKey(field.placeholder)));
      setTemplateFormNewCustomKeys(merged.newCustomFieldKeys);
      setTemplateFormFilesByKey(inventory.filesByKey);
    } catch (err: any) {
      console.error(err);
      setTemplateFormConfigError(err?.message || 'Erro ao carregar configuração do formulário.');
    } finally {
      setTemplateFormConfigLoading(false);
    }
  };

  const handleOpenTemplateCustomFields = (template: DocumentTemplate) =>
    handleOpenTemplateFormConfig(template, 'custom');

  const openTemplateConfigWhenUnknownFieldsExist = async (template: DocumentTemplate) => {
    try {
      const [existingConfig, globalCustomFields, inventory] = await Promise.all([
        documentTemplateService.listTemplateCustomFields(template.id),
        documentTemplateService.listCustomFields(),
        inspectTemplatePlaceholders(template),
      ]);
      const merged = mergeTemplateFieldDefinitions(inventory.placeholders, existingConfig, globalCustomFields);
      if (merged.newCustomFieldKeys.length > 0) await handleOpenTemplateFormConfig(template);
    } catch (error) {
      console.warn('Não foi possível conferir os novos campos dos anexos:', error);
    }
  };

  const handleAddTemplateCustomField = () => {
    const name = newTemplateField.name.trim();
    const placeholder = newTemplateField.placeholder.trim().replace(/^\[\[|\]\]$/g, '').trim();
    if (!name || !placeholder) {
      setTemplateFormConfigError('Informe o nome e o placeholder do campo personalizado.');
      return;
    }
    const key = normalizeTemplateFieldKey(placeholder);
    if (templateFormConfigFields.some((field) => normalizeTemplateFieldKey(field.placeholder) === key)) {
      setTemplateFormConfigError(`O placeholder [[${placeholder}]] já está configurado neste template.`);
      return;
    }

    setTemplateFormConfigError(null);
    setTemplateFormConfigFields((current) => [
      ...current,
      {
        name,
        placeholder,
        field_type: newTemplateField.field_type,
        enabled: true,
        show_in_generation: true,
        required: newTemplateField.required,
        default_value: null,
        options: null,
        description: newTemplateField.description.trim() || null,
        order: current.length,
      },
    ]);
    setNewTemplateField({ name: '', placeholder: '', field_type: 'text', required: true, description: '' });
    setShowNewTemplateFieldForm(false);
  };

  const handleSaveTemplateFormConfig = async () => {
    if (!templateFormConfigTemplate) return;
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
    try {
      setTemplateFormConfigSaving(true);
      setTemplateFormConfigError(null);

      const payload = templateFormConfigFields
        .map((f, idx) => ({
          ...f,
          name: (f.name || '').trim() || f.placeholder,
          description: (f.description || '').trim() || null,
          enabled: f.enabled !== false,
          show_in_generation: f.show_in_generation !== false,
          order: typeof f.order === 'number' ? f.order : idx,
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      await documentTemplateService.replaceTemplateCustomFields(templateFormConfigTemplate.id, payload);
      toast.success(
        'Campos configurados',
        templateConfigMode === 'form'
          ? 'A coleta de dados do formulário foi salva.'
          : 'A exibição dos campos personalizados na geração interna foi salva.',
      );
      setShowTemplateFormConfigModal(false);
      setTemplateFormConfigTemplate(null);
      setTemplateFormConfigFields([]);
      setTemplateFormDetectedKeys([]);
      setTemplateFormExistingKeys([]);
      setTemplateFormNewCustomKeys([]);
      setTemplateFormFilesByKey({});
    } catch (err: any) {
      console.error(err);
      setTemplateFormConfigError(err?.message || 'Erro ao salvar configuração do formulário.');
    } finally {
      setTemplateFormConfigSaving(false);
    }
  };

  const templateFormConfigRecomputeOrder = (items: UpsertTemplateCustomFieldDTO[]) =>
    items.map((it, i) => ({ ...it, order: i }));

  const templateFormConfigParseOptions = (raw: string) => {
    const lines = (raw || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return null;
    return lines.map((label) => ({ label, value: label }));
  };

  const templateFormConfigOptionsToText = (options: any) => {
    const arr = Array.isArray(options) ? options : [];
    return arr
      .map((o) => (o?.label || o?.value || '').toString().trim())
      .filter(Boolean)
      .join('\n');
  };

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
    (async () => {
      try {
        const ids = (templates ?? []).map((t) => t.id).filter(Boolean);
        if (ids.length === 0) {
          setTemplateFilesSummary({});
          return;
        }

        const { data, error } = await supabase
          .from('template_files')
          .select('template_id, file_name, order, signature_field_config')
          .in('template_id', ids)
          .order('order', { ascending: true });

        if (error) {
          console.warn('Erro ao carregar template_files:', error.message);
          return;
        }

        const byTemplate: Record<string, { count: number; firstFileName?: string; signedCount: number }> = {};
        for (const row of data ?? []) {
          const templateId = (row as any).template_id as string;
          const fileName = (row as any).file_name as string | undefined;
          if (!templateId) continue;
          if (!byTemplate[templateId]) {
            byTemplate[templateId] = { count: 0, firstFileName: fileName, signedCount: 0 };
          }
          byTemplate[templateId].count += 1;
          if (hasSignatureConfig((row as any).signature_field_config)) {
            byTemplate[templateId].signedCount += 1;
          }
          if (!byTemplate[templateId].firstFileName && fileName) {
            byTemplate[templateId].firstFileName = fileName;
          }
        }

        setTemplateFilesSummary(byTemplate);
      } catch (e) {
        console.warn('Falha ao montar resumo de arquivos:', e);
      }
    })();
  }, [templates]);

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

  // Fecha o menu "⋯" ao clicar fora ou apertar Esc. Sem isto o menu de um
  // cartão fica aberto por cima dos vizinhos até alguém clicar nele de novo.
  useEffect(() => {
    if (!openCardMenuId) return;

    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-template-card-menu]')) return;
      setOpenCardMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenCardMenuId(null);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openCardMenuId]);

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

  // O que ainda impede de seguir para a prévia. O réu é opcional por definição
  // do próprio modelo e não entra na conta.
  const camposPendentes = useMemo(() => {
    const pendentes: string[] = [];
    if (!selectedClientId) pendentes.push('Cliente');
    templateExtraFields.forEach((field) => {
      if (field.required && !(templateExtraValues[field.placeholder] || '').trim()) pendentes.push(field.name || field.placeholder);
    });
    return pendentes;
  }, [selectedClientId, templateExtraFields, templateExtraValues]);

  const dadosCompletos = !templateExtraFieldsLoading && camposPendentes.length === 0;

  // O que a etapa 2 mostra quando está encolhida.
  const resumoDosDados = useMemo(() => {
    const partes = [selectedClient?.full_name || 'Sem cliente'];
    if (camposPendentes.length === 1) partes.push('1 campo em branco');
    else if (camposPendentes.length > 1) partes.push(`${camposPendentes.length} campos em branco`);
    return partes.join(' · ');
  }, [selectedClient, camposPendentes]);

  // O botão de gerar existe em duas cópias (desktop e mobile sticky). A cor
  // saía de dois blocos `style` inline idênticos; agora é uma classe só.
  const canGenerateDocx = !generatingDocx && !!selectedClientId && !!selectedTemplateId && dadosCompletos;
  const generateButtonClass = canGenerateDocx
    ? 'bg-primary-500 text-white hover:bg-primary-600 hover:shadow-md active:shadow-sm cursor-pointer'
    : 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500';

  // A ÚNICA porta para a etapa 3. Nenhum efeito abre a prévia sozinho.
  const handleContinuarParaPrevia = () => {
    if (!dadosCompletos) {
      setActiveStep('data');
      return;
    }
    setActiveStep('preview');
  };

  // Trocar de modelo invalida o que já foi conferido e devolve o usuário aos
  // dados — os campos compatíveis são preservados pelo efeito que recalcula
  // `templateExtraValues`.
  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setLivePreviewDocs([]);
    setPreviewStatus('idle');
    setGeneratedDocBlob(null);
    setGenerationSuccess(null);
    setGenerationError(null);
    setActiveStep('data');
  };

  // Baixa os arquivos do modelo APENAS quando a etapa da prévia está aberta.
  // Enquanto o usuário escolhe cliente e preenche campos, nada é baixado.
  useEffect(() => {
    if (!selectedTemplate || activeStep !== 'preview') return;

    let ativo = true;
    setPreviewStatus('loading');
    setLivePreviewError(null);

    (async () => {
      try {
        const arquivos: PreviewDocument[] = [];

        if (selectedTemplate.file_path) {
          const blob = await documentTemplateService.downloadTemplateFile(selectedTemplate);
          arquivos.push({
            id: `principal-${selectedTemplate.id}`,
            name: selectedTemplate.file_name || `${selectedTemplate.name}.docx`,
            blob,
            role: 'principal',
          });
        }

        const anexos = await documentTemplateService.listTemplateFiles(selectedTemplate.id);
        for (const anexo of anexos) {
          const ehDocx = anexo.file_name.toLowerCase().endsWith('.docx')
            || anexo.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          if (!ehDocx) continue;
          try {
            const blob = await documentTemplateService.downloadTemplateFileById(anexo.id);
            arquivos.push({ id: anexo.id, name: anexo.file_name, blob, role: 'anexo' });
          } catch (err) {
            console.warn(`Anexo fora da prévia (${anexo.file_name}):`, err);
          }
        }

        if (!ativo) return;
        setLivePreviewDocs(arquivos);
        if (arquivos.length === 0) {
          setLivePreviewError('Este modelo não tem arquivo .docx para desenhar.');
          setPreviewStatus('error');
        } else {
          setPreviewStatus('ready');
        }
      } catch (err) {
        console.warn('Não foi possível carregar os arquivos da prévia:', err);
        if (!ativo) return;
        setLivePreviewDocs([]);
        setLivePreviewError('Não foi possível abrir os arquivos deste modelo.');
        setPreviewStatus('error');
      }
    })();

    return () => {
      ativo = false;
    };
  }, [selectedTemplate, activeStep]);

  const isRequirementsMsTemplate = (template: DocumentTemplate) => {
    const name = removeDiacritics((template.name || '').toString()).toUpperCase();
    const description = removeDiacritics((template.description || '').toString()).toUpperCase();
    return name.startsWith('MODELO MS (REQUERIMENTOS)') || description.includes('[REQUERIMENTOS_MS]');
  };

  const newDocTemplates = useMemo(() => templates.filter((t) => !isRequirementsMsTemplate(t)), [templates]);
  const filteredNewDocTemplates = useMemo(() => {
    if (!templateSearchQuery.trim()) return newDocTemplates;
    return newDocTemplates.filter((template) => matchesNormalizedSearch(templateSearchQuery, [template.name || '']));
  }, [newDocTemplates, templateSearchQuery]);
  const manageTemplates = useMemo(() => templates.filter((t) => !isRequirementsMsTemplate(t)), [templates]);

  useEffect(() => {
    if (activeView !== 'new-doc' || !selectedTemplateId) return;
    const current = templates.find((t) => t.id === selectedTemplateId);
    if (current && isRequirementsMsTemplate(current)) {
      setSelectedTemplateId('');
    }
  }, [activeView, selectedTemplateId, templates]);

  const shouldShowDefendantField = (selectedTemplate?.enable_defendant ?? true) === true;

  useEffect(() => {
    if (!shouldShowDefendantField) {
      setDefendantInput('');
    }
  }, [shouldShowDefendantField]);

  useEffect(() => {
    if (!selectedTemplateId || !selectedTemplate) {
      setTemplateExtraFields([]);
      setTemplateExtraValues({});
      return;
    }

    let active = true;
    setTemplateExtraFieldsLoading(true);

    (async () => {
      try {
        const [existingConfig, globalCustomFields, inventory] = await Promise.all([
          documentTemplateService.listTemplateCustomFields(selectedTemplate.id),
          documentTemplateService.listCustomFields(),
          inspectTemplatePlaceholders(selectedTemplate),
        ]);
        if (!active) return;

        const merged = mergeTemplateFieldDefinitions(inventory.placeholders, existingConfig, globalCustomFields);
        const extraFields = selectActiveCustomTemplateFields(merged.fields, inventory.placeholders);
        setTemplateExtraFields(extraFields);

        const defaults: Record<string, string> = {
          DATA_ATUAL_EXTENSO: formatDateLong(new Date()),
          SUBSECAO_JUDICIARIA: 'BALSAS',
          UF_SUBSECAO: 'MA',
          CIDADE_REFERENCIA_INSS: selectedClient?.address_city || 'CUIABÁ',
          UF_REFERENCIA_INSS: selectedClient?.address_state || 'MT',
        };

        setTemplateExtraValues((previous) => {
          const next: Record<string, string> = {};
          for (const field of extraFields) {
            const key = normalizeTemplateFieldKey(field.placeholder);
            const previousKey = Object.keys(previous).find((candidate) => normalizeTemplateFieldKey(candidate) === key);
            const defaultKey = Object.keys(defaults).find((candidate) => normalizeTemplateFieldKey(candidate) === key);
            next[field.placeholder] = previousKey
              ? previous[previousKey]
              : (field.default_value || (defaultKey ? defaults[defaultKey] : '') || '');
          }
          return next;
        });
      } catch (error) {
        console.error('Erro ao carregar campos específicos do template:', error);
        if (!active) return;
        setTemplateExtraFields([]);
        setTemplateExtraValues({});
        setGenerationError('Não foi possível carregar os campos personalizados deste template.');
      } finally {
        if (active) setTemplateExtraFieldsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedTemplateId, selectedTemplate]);

  useEffect(() => {
    if (!selectedClient) return;
    const clientDefaults: Record<string, string> = {
      CIDADE_REFERENCIA_INSS: selectedClient.address_city || 'CUIABÁ',
      UF_REFERENCIA_INSS: selectedClient.address_state || 'MT',
    };
    setTemplateExtraValues((current) => {
      const next = { ...current };
      for (const field of templateExtraFields) {
        const key = normalizeTemplateFieldKey(field.placeholder);
        if (!next[field.placeholder]?.trim() && clientDefaults[key]) next[field.placeholder] = clientDefaults[key];
      }
      return next;
    });
  }, [selectedClient, templateExtraFields]);

  const handleOpenModal = () => {
    if (!ensurePermission({ module: 'documentos', action: 'create' })) return;
    setIsModalOpen(true);
    setUploadError(null);
    setNameInput('');
    setDescriptionInput('');
    setEnableDefendantInput(true);
    setFileInput(null);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNameInput('');
    setDescriptionInput('');
    setEnableDefendantInput(true);
    setFileInput(null);
    setUploadError(null);
  };

  const handleUploadTemplate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ensurePermission({ module: 'documentos', action: 'create' })) return;
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
        enable_defendant: enableDefendantInput,
      };

      const createdTemplate = await documentTemplateService.createTemplateWithFile(payload, fileInput);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      handleCloseModal();
      await handleOpenTemplateFormConfig(createdTemplate);
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

    // Tudo que vem da ficha passa por uma máscara antes de virar texto do
    // documento. O banco guarda o dado cru (CPF `04544803193`, telefone
    // `65984046375`) porque é assim que se busca e se compara — mas um contrato
    // impresso com o número cru parece rascunho. Ver `utils/clientFieldFormat`.
    registerPlaceholder('NOME COMPLETO', client.full_name);
    registerPlaceholder('NOME', client.full_name);
    registerPlaceholder('nacionalidade', formatQualificationTerm(client.nationality));
    registerPlaceholder('estado civil', formatQualificationTerm(formatMaritalStatus(client.marital_status)));
    registerPlaceholder('profissão', formatQualificationTerm(client.profession));
    registerPlaceholder('RG', client.rg);
    registerPlaceholder('DATA_NASCIMENTO', formatDate(client.birth_date));
    registerPlaceholder('CPF', formatCpfCnpjForDocument(client.cpf_cnpj));
    registerPlaceholder('endereço', formatProperNamePtBr(client.address_street));
    registerPlaceholder('número', client.address_number);
    registerPlaceholder('complemento', client.address_complement);
    registerPlaceholder('bairro', formatProperNamePtBr(client.address_neighborhood));
    registerPlaceholder('cidade', formatProperNamePtBr(client.address_city));
    registerPlaceholder('estado', formatUfForDocument(client.address_state));
    registerPlaceholder('UF', formatUfForDocument(client.address_state));
    registerPlaceholder('CEP', formatCepForDocument(client.address_zip_code));
    registerPlaceholder('ENDERECO_COMPLETO', buildFullAddress(client));
    const primaryPhone = formatPhoneForDocument(client.phone || client.mobile || '');
    registerPlaceholder('telefone', primaryPhone);
    registerPlaceholder('celular', primaryPhone);
    registerPlaceholder('email', client.email);
    registerPlaceholder('réu', shouldShowDefendantField ? normalizeDefendantValue(defendantInput) : '');
    registerPlaceholder('data', formatDate(currentDate.toISOString()));
    registerPlaceholder('DATA_ATUAL', formatDate(currentDate.toISOString()));

    Object.entries(templateExtraValues).forEach(([key, value]) => {
      const field = templateExtraFields.find((candidate) => normalizeTemplateFieldKey(candidate.placeholder) === normalizeTemplateFieldKey(key));
      registerPlaceholder(key, field?.field_type === 'date' ? formatDate(value) : value);
    });

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

  // Resolve um campo com o MESMO mapa que a geração usa, para a folha não
  // mostrar uma coisa e o arquivo sair com outra.
  const resolveLivePreviewField = useMemo(() => {
    const mapa = selectedClient ? buildPlaceholderMap(selectedClient) : {};
    return (chave: string) => {
      const direto = mapa[chave];
      if (direto) return direto;
      const semAcento = removeDiacritics(chave);
      return mapa[chave.toUpperCase()] || mapa[semAcento] || mapa[semAcento.toUpperCase()] || '';
    };
    // `buildPlaceholderMap` lê o réu e os campos digitados; ambos entram aqui.
  }, [selectedClient, defendantInput, templateExtraFields, templateExtraValues, shouldShowDefendantField, currentDate]);

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
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
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
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;

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
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;
    setEditingTemplate(template);
    setEditName(template.name);
    setEditDescription(template.description || '');
    setEditContent(template.content || '');
    setEditEnableDefendant((template.enable_defendant ?? true) === true);
    setEditFile(null);
    setEditError(null);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setEditingTemplate(null);
    setEditFile(null);
    setEditEnableDefendant(true);
  };

  const handleSaveTemplateEdits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTemplate) return;
    if (!ensurePermission({ module: 'documentos', action: 'edit' })) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Informe um nome para o template.');
      return;
    }

    try {
      setEditSaving(true);
      setEditError(null);
      const shouldInspectFields = !!editFile || (!editingTemplate.file_path && editContent !== (editingTemplate.content || ''));

      const basePayload: Partial<CreateDocumentTemplateDTO> = {
        name: trimmedName,
        description: editDescription,
        enable_defendant: editEnableDefendant,
      };

      if (!editingTemplate.file_path) {
        basePayload.content = editContent || '';
      }

      const updatedTemplate = editFile
        ? await documentTemplateService.updateTemplateWithFile(editingTemplate, basePayload, editFile)
        : await documentTemplateService.updateTemplate(editingTemplate.id, basePayload);

      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      handleCloseEditModal();
      if (shouldInspectFields) await handleOpenTemplateFormConfig(updatedTemplate);
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

  // A ação principal do cartão: escolher o modelo e cair na tela de gerar já
  // com ele selecionado. Antes esse caminho simplesmente não existia — para
  // usar um modelo era preciso voltar de aba e procurá-lo de novo na lista.
  const handleUseTemplate = (template: DocumentTemplate) => {
    setOpenCardMenuId(null);
    handleSelectTemplate(template.id);
    setTemplateSearchQuery('');
    setActiveView('new-doc');
  };

  // Clonar um kit inteiro — arquivo principal, anexos, campos e posições de
  // assinatura. O trabalho pesado (cópia no storage) está no serviço.
  const handleDuplicateTemplate = async (template: DocumentTemplate) => {
    if (!ensurePermission({ module: 'documentos', action: 'create' })) return;
    try {
      setDuplicatingTemplateId(template.id);
      setTemplateActionError(null);
      const copia = await documentTemplateService.duplicateTemplate(template.id);
      setTemplates(await documentTemplateService.listTemplates());
      toast.success(`"${copia.name}" criado a partir de ${template.name}`);
    } catch (err: any) {
      console.error('Erro ao duplicar modelo:', err);
      const mensagem = err?.message || 'Não foi possível duplicar este modelo.';
      setTemplateActionError(mensagem);
      toast.error(mensagem);
    } finally {
      setDuplicatingTemplateId(null);
    }
  };

  const handleDownloadTemplate = async (template: DocumentTemplate) => {
    try {
      setTemplateActionError(null);
      setDownloadingTemplateId(template.id);

      const templateFiles = await documentTemplateService.listTemplateFiles(template.id);
      if (!template.file_path && !template.content && templateFiles.length === 0) {
        setTemplateActionError('Template n?o possui arquivos dispon?veis para download.');
        return;
      }

      const zip = new PizZip();
      const usedNames = new Set<string>();
      const reserveFileName = (rawName: string) => {
        const trimmed = rawName.trim();
        const fallback = trimmed || 'arquivo';
        const dotIndex = fallback.lastIndexOf('.');
        const hasExtension = dotIndex > 0 && dotIndex < fallback.length - 1;
        const baseName = hasExtension ? fallback.slice(0, dotIndex) : fallback;
        const extension = hasExtension ? fallback.slice(dotIndex) : '';

        let candidate = fallback;
        let counter = 2;
        while (usedNames.has(candidate.toLowerCase())) {
          candidate = `${baseName} (${counter})${extension}`;
          counter += 1;
        }

        usedNames.add(candidate.toLowerCase());
        return candidate;
      };

      if (template.file_path) {
        const file = await documentTemplateService.downloadTemplateFile(template);
        zip.file(reserveFileName(template.file_name || `${template.name}.docx`), await file.arrayBuffer());
      } else if (template.content) {
        const content = sanitizeText(template.content || '');
        const blob = await createDocxFromContent(content);
        const fileName = `${removeDiacritics(template.name).replace(/\s+/g, '-') || 'template'}.docx`;
        zip.file(reserveFileName(fileName), await blob.arrayBuffer());
      }

      for (const templateFile of templateFiles) {
        const fileBlob = await documentTemplateService.downloadTemplateFileById(templateFile.id);
        const fileName = templateFile.file_name || `anexo-${templateFile.order + 1}.docx`;
        zip.file(reserveFileName(fileName), await fileBlob.arrayBuffer());
      }

      const zipBlob = zip.generate({ type: 'blob', mimeType: 'application/zip' });
      const archiveName = `${removeDiacritics(template.name).replace(/\s+/g, '-') || 'template'}.zip`;
      saveAs(zipBlob, archiveName);
    } catch (err: any) {
      console.error(err);
      setTemplateActionError(err.message || 'N?o foi poss?vel baixar este template.');
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

      // Processar anexos do template (template_files)
      const attachments: Array<{ blob: Blob; name: string }> = [];
      try {
        const templateFiles = await documentTemplateService.listTemplateFiles(selectedTemplate.id);
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
            
            attachments.push({ blob: processedBlob, name: templateFile.file_name });
            console.log(`📎 Anexo processado: ${templateFile.file_name}`);
          } catch (err) {
            console.warn(`Erro ao processar anexo ${templateFile.file_name}:`, err);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar anexos do template:', err);
      }

      // Salvar blob, anexos e mostrar modal de opções
      setGeneratedDocBlob(result.blob);
      setGeneratedDocName(fileName);
      setGeneratedAttachments(attachments);
      setShowDocOptionsModal(true);
      
      const attachmentMsg = attachments.length > 0 ? ` (+ ${attachments.length} anexo${attachments.length > 1 ? 's' : ''})` : '';
      setGenerationSuccess(`Documento gerado${attachmentMsg}! Escolha uma opção.`);
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || 'Erro ao gerar documento.');
    } finally {
      setGeneratingDocx(false);
    }
  };

  // Baixar como Word (ZIP se houver anexos)
  const handleDownloadWord = async () => {
    if (!generatedDocBlob) return;
    
    if (generatedAttachments.length === 0) {
      // Sem anexos: baixar apenas o documento principal
      saveAs(generatedDocBlob, `${generatedDocName}.docx`);
    } else {
      // Com anexos: criar ZIP com todos os arquivos
      const zip = new PizZip();
      
      // Adicionar documento principal
      const mainDocBuffer = await generatedDocBlob.arrayBuffer();
      zip.file(`${generatedDocName}.docx`, mainDocBuffer);
      
      // Adicionar anexos
      for (const attachment of generatedAttachments) {
        const attachBuffer = await attachment.blob.arrayBuffer();
        zip.file(attachment.name, attachBuffer);
      }
      
      // Gerar e baixar ZIP
      const zipBlob = zip.generate({ type: 'blob', mimeType: 'application/zip' });
      saveAs(zipBlob, `${generatedDocName}.zip`);
    }
  };

  // Converter DOCX para PDF: pipeline único em `utils/docxToPdf.ts`, que faz o
  // layout folha por folha e monta o PDF no tamanho/orientação de cada folha.
  // A versão anterior rasterizava o documento inteiro em uma imagem e cortava a
  // cada 297 mm — o corte caía no meio das linhas.
  const convertDocxToPdf = async (docxBlob: Blob): Promise<Blob> => docxBlobToPdf(docxBlob);

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

  // Baixar como PDF (mescla anexos em um único PDF)
  const handleDownloadPdf = async () => {
    if (!generatedDocBlob) return;
    
    try {
      if (generatedAttachments.length === 0) {
        // Sem anexos: converter apenas o documento principal
        const pdfBlob = await convertDocxToPdf(generatedDocBlob);
        saveAs(pdfBlob, `${generatedDocName}.pdf`);
      } else {
        // Com anexos: converter e mesclar todos em um único PDF
        const attachmentBlobs = generatedAttachments.map(a => a.blob);
        const mergedPdfBlob = await convertAndMergeDocxToPdf(generatedDocBlob, attachmentBlobs);
        saveAs(mergedPdfBlob, `${generatedDocName}.pdf`);
      }
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      // Fallback: baixar como Word (ZIP se houver anexos)
      await handleDownloadWord();
      alert('Erro ao converter para PDF. Arquivo salvo como Word.');
    }
  };

  // Enviar para assinatura — converte e congela todos os arquivos antes do link existir.
  const handleSendForSignature = async () => {
    if (!selectedTemplate || !selectedClient || !generatedDocBlob) return;
    if (!ensurePermission({ module: 'assinaturas', action: 'create' })) return;

    let signatureRequest: SignatureRequestWithSigners | null = null;
    try {
      setPreparingSignature(true);
      setShowDocOptionsModal(false);

      const sigCfg = await settingsService.getSignatureModuleConfig().catch(() => null);
      const authMethodMapDocs: Record<string, SignerAuthMethod> = {
        'Só assinatura': 'signature_only',
        'Assinatura + Validação Facial': 'signature_facial',
        'Assinatura + Facial + Documento': 'signature_facial_document',
        signature_only: 'signature_only',
        signature_facial: 'signature_facial',
        signature_facial_document: 'signature_facial_document',
      };
      const resolvedAuthMethod: SignerAuthMethod = (sigCfg && authMethodMapDocs[sigCfg.default_auth_method]) || 'signature_only';
      
      // O Word não entra mais no envelope. Documento principal e anexos são
      // convertidos pela mesma paginação usada no designer e enviados como PDF;
      // depois o servidor relê os bytes e só então libera a solicitação.
      const fileName = `${generatedDocName}.docx`;
      const file = new File([generatedDocBlob], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const templateFiles = await documentTemplateService.listTemplateFiles(selectedTemplate.id);
      const processedAttachments: Array<{ file: File; templateFile: (typeof templateFiles)[number] }> = [];
      const placeholders = buildPlaceholderMap(selectedClient);
      
      for (const templateFile of templateFiles) {
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

        processedAttachments.push({
          file: new File([processedBlob], templateFile.file_name, { type: templateFile.mime_type }),
          templateFile,
        });
      }

      const documentId = crypto.randomUUID();
      const congelado = await congelarOriginais([
        { nome: fileName, arquivo: file },
        ...processedAttachments.map(({ file: attachmentFile }) => ({
          nome: attachmentFile.name,
          arquivo: attachmentFile,
        })),
      ], { documentId });

      console.log('✅ PDFs preparados para o envelope:',
        congelado.caminhoPrincipal, congelado.caminhosDosAnexos);

      const createdRequest = await signatureService.createRequest({
        document_id: documentId,
        document_name: congelado.nomePrincipal,
        document_path: congelado.caminhoPrincipal,
        attachment_paths: congelado.caminhosDosAnexos.length > 0
          ? congelado.caminhosDosAnexos
          : null,
        client_id: selectedClient.id,
        client_name: selectedClient.full_name,
        auth_method: resolvedAuthMethod,
        signature_model: selectedTemplate.signature_model === 'per_document' ? 'per_document' : 'consolidated',
        signers: [{
          name: selectedClient.full_name,
          email: selectedClient.email || '',
          cpf: selectedClient.cpf_cnpj || '',
          phone: selectedClient.phone || '',
          role: 'Signatário',
          order: 1,
        }],
      }, { sourceProvenance: congelado.proveniencia });
      signatureRequest = createdRequest;
      
      const signerToken = createdRequest.signers[0]?.public_token;

      const manualSignatureFields = [
        ...(selectedTemplate.signature_field_config
          ? (Array.isArray(selectedTemplate.signature_field_config)
              ? selectedTemplate.signature_field_config
              : [selectedTemplate.signature_field_config]
            )
              .filter((field) => field !== null)
              .map((field) => ({
                document_id: 'main',
                signer_id: createdRequest.signers[0]?.id ?? null,
                field_type: 'signature' as const,
                page_number: field.page || 1,
                x_percent: field.x_percent || 0,
                y_percent: field.y_percent || 0,
                w_percent: field.width_percent || 25,
                h_percent: field.height_percent || 8,
              }))
          : []),
        ...processedAttachments.flatMap(({ templateFile }, index) => {
          const config = templateFile.signature_field_config;
          const configArray = config
            ? (Array.isArray(config) ? config : [config]).filter((field) => field !== null)
            : [];

          return configArray.map((field) => ({
            document_id: `attachment-${index}`,
            signer_id: createdRequest.signers[0]?.id ?? null,
            field_type: 'signature' as const,
            page_number: field.page || 1,
            x_percent: field.x_percent || 0,
            y_percent: field.y_percent || 0,
            w_percent: field.width_percent || 25,
            h_percent: field.height_percent || 8,
          }));
        }),
      ];

      // Marcadores automáticos foram ocultados na conversão para não aparecerem
      // no PDF. Transforme-os em campos, exceto no documento que já tem posição
      // manual — a mesma precedência usada no assistente de Assinaturas.
      const documentosComCampoManual = new Set(
        manualSignatureFields.map((field) => field.document_id),
      );
      const markerSignatureFields = Object.entries(congelado.marcadores).flatMap(([documentKey, markers]) => {
        if (documentosComCampoManual.has(documentKey)) return [];
        return markers
          .filter((marker) => marker.indiceDoAssinante === 1)
          .map((marker) => ({
            document_id: documentKey,
            signer_id: createdRequest.signers[0]?.id ?? null,
            field_type: 'signature' as const,
            page_number: marker.pagina,
            x_percent: marker.x_percent,
            y_percent: marker.y_percent,
            w_percent: marker.w_percent,
            h_percent: marker.h_percent,
          }));
      });
      const signatureFields = [...manualSignatureFields, ...markerSignatureFields];

      if (signatureFields.length > 0) {
        await signatureFieldsService.upsertFields(createdRequest.id, signatureFields);
      }
      
      if (!signerToken) {
        throw new Error('Erro ao gerar link de assinatura');
      }
      
      const link = buildPublicSigningUrl(signerToken);
      
      // Mostrar modal com o link
      setSignatureLink(link);
      setLinkCopied(false);
      setSignatureLinkTarget({
        clientId: selectedClient.id,
        clientName: selectedClient.full_name,
        phone: selectedClient.phone || selectedClient.mobile || '',
        documentName: `${selectedTemplate.name} - ${selectedClient.full_name}`,
      });
      setShowSignatureLinkModal(true);

      // Limpar estados
      setGeneratedDocBlob(null);
      setGeneratedDocName('');
      setGeneratedAttachments([]);
      
    } catch (err: any) {
      if (signatureRequest?.id) {
        try {
          await signatureService.permanentlyDeleteRequest(signatureRequest.id, true);
        } catch (rollbackError) {
          console.error('Falha ao desfazer envelope incompleto:', rollbackError);
        }
      }
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

  /**
   * Manda o link de assinatura pela conversa do CRM.
   *
   * O modal FECHA antes de pedir a conversa, e isso não é cosmético: o widget
   * flutuante mora em `FLOATING` e este modal em `MODAL_NESTED` — deixá-lo
   * aberto faria a conversa subir atrás dele e o clique pareceria não ter feito
   * nada. Ver `utils/whatsappChat`.
   *
   * A resposta de `openWhatsAppChat` é síncrona de propósito: `false` quer dizer
   * "não há como abrir aqui dentro" (sem permissão no módulo ou sem canal
   * conectado), e só aí vale o `wa.me` de sempre — decidir depois de um `await`
   * faria o navegador tratar o `window.open` como pop-up e bloquear.
   */
  const handleSendSignatureLinkOnWhatsApp = () => {
    if (!signatureLinkTarget?.phone || !signatureLink) return;
    const { phone, clientId, clientName, documentName } = signatureLinkTarget;
    const mensagem = `Olá ${clientName}! Seu documento chegou para assinatura.\n\n*${documentName}*\n\nAcesse o link abaixo para assinar:\n${signatureLink}`;

    setShowSignatureLinkModal(false);

    if (openWhatsAppChat({ phone, clientId, contactName: clientName, text: mensagem })) {
      toast.success('Conversa aberta', 'A mensagem já está escrita no compositor — revise e envie.');
      return;
    }

    const fallback = buildWhatsappUrl(phone, mensagem);
    if (fallback) {
      window.open(fallback, '_blank');
      return;
    }
    toast.error('Não foi possível abrir o WhatsApp', 'Confira o telefone cadastrado deste cliente.');
  };

  const handleGenerateTemplateFillLink = async (template: DocumentTemplate) => {
    if (!ensurePermission({ module: 'documentos', action: 'create' })) return;
    const inicioDaCena = Date.now();
    try {
      setCreatingTemplateFillLinkId(template.id);
      setLinkOverlayTemplateName(template.name);
      setLinkOverlayPhase('working');
      setTemplateActionError(null);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('Usuário não autenticado');

      // Verificar se já existe um permalink para este template
      const { data: existingPermalink } = await supabase
        .from('template_fill_permalinks')
        .select('slug')
        .eq('template_id', template.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      let permalinkSlug = existingPermalink?.slug;

      // Se não existe, criar um permalink automaticamente
      if (!permalinkSlug) {
        // Gerar slug a partir do nome do template
        const baseSlug = (template.name || 'documento')
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50);
        
        // Adicionar sufixo único para evitar colisão
        const uniqueSuffix = Date.now().toString(36).slice(-4);
        permalinkSlug = `${baseSlug}-${uniqueSuffix}`;

        const { error: permalinkError } = await supabase
          .from('template_fill_permalinks')
          .insert({
            template_id: template.id,
            slug: permalinkSlug,
            created_by: userData.user.id,
            is_active: true,
          });

        if (permalinkError) {
          console.warn('Não foi possível criar permalink:', permalinkError.message);
          permalinkSlug = null;
        }
      }

      // Link fixo (permalink) — reutilizável; pode não existir se o insert falhou.
      const fixedLink = permalinkSlug
        ? buildPublicPermalinkUrl(permalinkSlug)
        : '';

      // Link de uso único — SEMPRE um novo, a cada abertura do modal. Reaproveitar
      // um token já enviado deixaria dois clientes preenchendo o mesmo formulário.
      let uniqueLink = '';
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: uniqueRow, error: uniqueError } = await supabase
        .from('template_fill_links')
        .insert({
          template_id: template.id,
          created_by: userData.user.id,
          expires_at: expiresAt,
          status: 'pending',
        })
        .select('public_token')
        .single();

      if (uniqueError) {
        console.warn('Não foi possível criar link de uso único:', uniqueError.message);
      } else if (uniqueRow?.public_token) {
        uniqueLink = buildPublicFillUrl(uniqueRow.public_token);
      }

      if (!uniqueLink && !fixedLink) {
        throw new Error('Não foi possível gerar nenhum link para este modelo');
      }

      // Nada de copiar sozinho: quem escolhe qual dos dois links vai para a
      // área de transferência é a pessoa, no botão de cada um.
      setTemplateFillUniqueLink(uniqueLink);
      setTemplateFillPermanentLink(fixedLink);
      setTemplateFillCopiedKind(null);

      // Piso de exibição da cena, para ela não virar um flash quando o banco
      // responde em ~200 ms.
      const restante = DURACAO_MINIMA_ANIMACAO_MS - (Date.now() - inicioDaCena);
      if (restante > 0) await esperar(restante);
      setLinkOverlayPhase('done');
      await esperar(DURACAO_DO_FECHO_MS);

      setShowTemplateFillLinkModal(true);
      toast.success('Link pronto para enviar');
    } catch (err: any) {
      console.error('Erro ao gerar link de preenchimento:', err);
      toast.error(err?.message || 'Erro ao gerar link de preenchimento');
    } finally {
      setLinkOverlayPhase(null);
      setCreatingTemplateFillLinkId(null);
    }
  };

  const handleCopyTemplateFillLink = async (kind: 'unique' | 'permanent') => {
    const value = kind === 'unique' ? templateFillUniqueLink : templateFillPermanentLink;
    if (!value) return;

    let copied = await copyToClipboard(value);
    if (!copied) {
      // Navegador antigo ou permissão negada: cai no truque do input escondido.
      const input = document.createElement('input');
      input.value = value;
      document.body.appendChild(input);
      input.select();
      copied = document.execCommand('copy');
      document.body.removeChild(input);
    }
    if (copied) setTemplateFillCopiedKind(kind);
  };

  const handleDeleteTemplate = async (template: DocumentTemplate) => {
    const confirmed = await confirmDelete({
      title: 'Excluir Template',
      entityName: template.name,
      message: 'Tem certeza que deseja excluir este template?',
      confirmLabel: 'Excluir Template',
      permission: { module: 'documentos', action: 'delete' },
    });

    if (!confirmed) return;

    try {
      setDeletingTemplateId(template.id);
      setTemplateActionError(null);
      await documentTemplateService.deleteTemplate(template.id);
      notifyDeleted(template.name);
      const data = await documentTemplateService.listTemplates();
      setTemplates(data);
      if (selectedTemplateId === template.id) setSelectedTemplateId('');
      toast.success('Template excluído', `O template "${template.name}" foi removido.`);
    } catch (err: any) {
      console.error(err);
      setTemplateActionError(err.message || 'Não foi possível remover este template.');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const totalTemplates = templates.length;
  const templatesWithFile = templates.filter((template) => template.file_path).length;

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-4 sm:gap-6">
      {/* Espera entre o clique e o modal — branca, com os três tempos do trabalho. */}
      {linkOverlayPhase && (
        <LinkGenerationOverlay phase={linkOverlayPhase} templateName={linkOverlayTemplateName} />
      )}

      {/* Header com tabs */}
      <div className="flex-none rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-1 border-b border-[#e7e5df] p-2 @sm:inline-flex @sm:flex-row @sm:m-3 @sm:mb-3 @sm:rounded-xl @sm:border @sm:border-[#e7e5df] @sm:bg-slate-100/70 @sm:p-1 dark:border-zinc-800 @sm:dark:bg-zinc-800/60">
          <button
            onClick={() => setActiveView('new-doc')}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeView === 'new-doc'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100'
            }`}
          >
            <Plus className="h-4 w-4" />
            Novo documento
          </button>
          <button
            onClick={() => setActiveView('manage')}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeView === 'manage'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100'
            }`}
          >
            <Settings className="h-4 w-4" />
            Gerenciar templates
          </button>
          <button
            onClick={() => setActiveView('petitions')}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeView === 'petitions'
                ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-100'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Petições Padrões
          </button>
        </div>
      </div>

      {/* Novo documento — uma faixa horizontal: a etapa resolvida vira um trilho
          em pé à esquerda e devolve a largura para a próxima, e no fim para a
          prévia. Em tela estreita as etapas se empilham. */}
      {/* Novo documento — accordion estrito: uma etapa aberta por vez, e o
          avanço para a prévia só acontece por clique, nunca por efeito. */}
      {activeView === 'new-doc' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto @lg:flex-row @lg:items-stretch @lg:overflow-visible">
          <SidePanel
            step={1}
            title="Escolha o modelo"
            hint="O documento que vai ser gerado"
            summary={selectedTemplate?.name}
            open={activeStep === 'template'}
            onToggle={() => setActiveStep('template')}
            done={!!selectedTemplateId}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3">
            {loading ? (
              <ModuleSkeleton variant="list" rows={5} />
            ) : newDocTemplates.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-[#e7e5df] bg-slate-50 p-6 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <FileText className="mx-auto h-8 w-8 text-slate-300 dark:text-zinc-600" />
                <p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">Nenhum template disponível</p>
                <button
                  onClick={() => setActiveView('manage')}
                  className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  Criar template →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={templateSearchQuery}
                      onChange={(e) => setTemplateSearchQuery(e.target.value)}
                      placeholder="Buscar modelo..."
                      className="w-full rounded-xl border border-[#e7e5df] bg-[#f8f7f5] pl-10 pr-4 py-2.5 text-sm text-slate-900 transition hover:border-slate-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    />
                  </div>
                  {templateSearchQuery.trim() && filteredNewDocTemplates.length === 0 && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">Nenhum template encontrado.</p>
                  )}
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {filteredNewDocTemplates.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  const summary = templateFilesSummary[template.id];
                  const filesCount = summary?.count ?? 0;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleSelectTemplate(template.id)}
                      className={`w-full text-left p-3 rounded-xl border-2 transition ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20 dark:bg-primary-500/10'
                          : 'border-[#e7e5df] bg-[#f8f7f5] hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                          isSelected ? 'bg-primary-100 dark:bg-primary-500/20' : 'bg-slate-100 dark:bg-zinc-800'
                        }`}>
                          <FileText className={`h-4 w-4 ${isSelected ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500 dark:text-zinc-400'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-primary-900 dark:text-primary-200' : 'text-slate-900 dark:text-zinc-100'}`}>
                            {template.name}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 dark:text-zinc-400">
                            {template.file_path
                              ? filesCount > 0
                                ? `1 doc + ${filesCount} anexo(s)`
                                : '1 documento'
                              : 'Template em texto'}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="flex-shrink-0">
                            <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
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
            </div>
          </SidePanel>

          {selectedTemplateId && (
            <SidePanel
              step={2}
              title="Dados do documento"
              hint="Cliente e os campos que o modelo pede"
              summary={resumoDosDados}
              open={activeStep === 'data'}
              onToggle={() => setActiveStep('data')}
              done={dadosCompletos}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {/* Cliente */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                    Cliente *
                  </label>
                  <ClientSearchSelect
                    value={selectedClientId}
                    onChange={(clientId, clientName) => {
                      setSelectedClientId(clientId);
                      setClientSearchTerm(clientName);
                    }}
                    label=""
                    placeholder="Buscar cliente pelo nome..."
                    required
                    allowCreate={true}
                  />
                </div>

                {/* Template selecionado (resumo) */}
                {selectedTemplateId && (
                  <div className="rounded-lg bg-primary-50 border border-primary-100 p-3 dark:border-primary-500/30 dark:bg-primary-500/10">
                    <div className="flex items-center gap-2 text-xs text-primary-700 dark:text-primary-300">
                      <FileText className="h-3.5 w-3.5" />
                      <span className="font-medium">Template:</span>
                      <span>{templates.find(t => t.id === selectedTemplateId)?.name}</span>
                    </div>
                  </div>
                )}

                {/* Réu */}
                {shouldShowDefendantField && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                      Réu / Parte contrária <span className="text-slate-400 font-normal">(opcional)</span>
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-4 py-2.5 text-sm text-slate-900 transition hover:border-slate-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      placeholder="Ex: Empresa XPTO Ltda"
                      value={defendantInput}
                      onChange={(e) => setDefendantInput(normalizeDefendantValue(e.target.value))}
                    />
                  </div>
                )}

                {templateExtraFieldsLoading && (
                  <div className="flex items-center gap-2 rounded-xl border border-[#e7e5df] bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analisando os campos deste template e dos anexos…
                  </div>
                )}

                {/* Campos específicos cadastrados ou detectados no template. */}
                {!templateExtraFieldsLoading && templateExtraFields.length > 0 && (
                  <div className="rounded-xl border border-[#e7e5df] bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/60">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-slate-500 dark:text-zinc-400" />
                      <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Campos personalizados</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                      Preencha os campos específicos do template selecionado.
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-3">
                      {templateExtraFields.map((field) => {
                        const value = templateExtraValues[field.placeholder] ?? '';
                        const updateValue = (nextValue: string) =>
                          setTemplateExtraValues((previous) => ({ ...previous, [field.placeholder]: nextValue }));
                        const inputClass = 'w-full rounded-lg border border-[#e7e5df] bg-white px-4 py-2.5 text-sm text-slate-900 transition hover:border-slate-300 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-600 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

                        return (
                          <div key={normalizeTemplateFieldKey(field.placeholder)}>
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                              {field.name || humanizeTemplatePlaceholder(field.placeholder)}
                              {field.required ? <span className="text-primary-500"> *</span> : <span className="font-normal normal-case text-slate-400"> (opcional)</span>}
                            </label>
                            {field.field_type === 'textarea' ? (
                              <textarea
                                rows={3}
                                className={inputClass}
                                placeholder={field.description || `Preencher ${field.name || field.placeholder}…`}
                                value={value}
                                onChange={(event) => updateValue(event.target.value)}
                              />
                            ) : field.field_type === 'select' ? (
                              <select className={inputClass} value={value} onChange={(event) => updateValue(event.target.value)}>
                                <option value="">Selecione…</option>
                                {(field.options || []).map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                                className={inputClass}
                                placeholder={field.description || `Preencher ${field.name || field.placeholder}…`}
                                value={value}
                                onChange={(event) => updateValue(event.target.value)}
                              />
                            )}
                            {field.description && field.field_type === 'select' && (
                              <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">{field.description}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>

              <div className="mt-4 flex flex-none flex-col gap-2 border-t border-[#e7e5df] pt-4 dark:border-zinc-800">
                {camposPendentes.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      {camposPendentes.length === 1 ? 'Falta preencher: ' : `Faltam ${camposPendentes.length} campos: `}
                      <b>{camposPendentes.join(', ')}</b>
                    </span>
                  </div>
                )}
                <button
                  onClick={handleContinuarParaPrevia}
                  disabled={!dadosCompletos}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition ${
                    dadosCompletos
                      ? 'bg-primary-500 text-white hover:bg-primary-600'
                      : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500'
                  }`}
                >
                  Continuar para a prévia
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </SidePanel>
          )}

          {selectedTemplateId && (
            <SidePanel
              step={3}
              title="Prévia do documento"
              hint="Confira antes de gerar"
              summary={previewStatus === 'ready' ? 'Documento conferido' : 'Ainda não revisado'}
              open={activeStep === 'preview'}
              onToggle={handleContinuarParaPrevia}
              done={!!generatedDocBlob}
            >
              <div className="relative flex min-h-0 flex-1 flex-col">
                {(generationError || generationSuccess) && (
                  <div className="mb-3 flex flex-none flex-col gap-2">
                    {generationError && (
                      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span>{generationError}</span>
                      </div>
                    )}
                    {generationSuccess && (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span>{generationSuccess}</span>
                      </div>
                    )}
                  </div>
                )}

                <DocumentLivePreview
                  documents={livePreviewDocs}
                  resolve={resolveLivePreviewField}
                  loading={previewStatus === 'loading'}
                  error={previewStatus === 'error' ? livePreviewError : null}
                />

                {/* Barra flutuante sobre o documento: as ações não podem tomar
                    altura da folha, que é o que a pessoa veio ver. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3">
                  <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-full border border-[#e7e5df] bg-white/95 p-1.5 shadow-[0_12px_32px_-12px_rgba(15,23,42,.45)] backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
                    <button
                      onClick={handleGenerateDocx}
                      disabled={!canGenerateDocx}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                        canGenerateDocx
                          ? 'bg-primary-500 text-white hover:bg-primary-600'
                          : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500'
                      }`}
                    >
                      {generatingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                      {generatingDocx ? 'Gerando...' : generatedDocBlob ? 'Gerar de novo' : 'Gerar documentos'}
                    </button>

                    {generatedDocBlob && (
                      <>
                        <span className="mx-0.5 h-6 w-px bg-[#e7e5df] dark:bg-zinc-700" />
                        <button
                          onClick={handleDownloadWord}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          Word
                        </button>
                        <button
                          onClick={handleDownloadPdf}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          PDF
                        </button>
                        <button
                          onClick={handleSendForSignature}
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                        >
                          <PenTool className="h-3.5 w-3.5" />
                          Assinatura
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </SidePanel>
          )}
        </div>
      )}

      {/* Gerenciar templates */}
      {activeView === 'manage' && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
          {/* Header com ações globais */}
          <div className="flex flex-col gap-3 @sm:flex-row @sm:items-center @sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Meus Templates</h4>
              <p className="text-sm text-slate-500 dark:text-zinc-400">{manageTemplates.length} template(s) cadastrado(s)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setCustomFieldsManagerOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden @sm:inline">Campos Personalizados</span>
                <span className="@sm:hidden">Campos</span>
              </button>
              <button
                onClick={handleOpenModal}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600"
              >
                <Plus className="h-4 w-4" />
                Novo Template
              </button>
            </div>
          </div>

          {/* Lista de templates */}
          {loading ? (
            <ModuleSkeleton variant="cards" rows={6} />
          ) : manageTemplates.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-[#e7e5df] bg-slate-50 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
              <FileText className="mx-auto h-10 w-10 text-slate-300 dark:text-zinc-600" />
              <p className="mt-3 text-sm text-slate-500 dark:text-zinc-400">Nenhum template cadastrado</p>
              <button
                onClick={handleOpenModal}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Criar primeiro template
              </button>
            </div>
          ) : (
            <div className="grid gap-4 @sm:grid-cols-2 @md:grid-cols-3">
              {manageTemplates.map((template) => {
                const summary = templateFilesSummary[template.id];
                return (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    attachmentsCount={summary?.count ?? 0}
                    signs={hasSignatureConfig(template.signature_field_config) || (summary?.signedCount ?? 0) > 0}
                    menuOpen={openCardMenuId === template.id}
                    creatingLink={creatingTemplateFillLinkId === template.id}
                    downloading={downloadingTemplateId === template.id}
                    deleting={deletingTemplateId === template.id}
                    onToggleMenu={() => setOpenCardMenuId(openCardMenuId === template.id ? null : template.id)}
                    onUse={() => handleUseTemplate(template)}
                    onGenerateLink={() => { setOpenCardMenuId(null); handleGenerateTemplateFillLink(template); }}
                    onOpenFiles={() => {
                      setOpenCardMenuId(null);
                      setFilesManagerTemplate(template);
                      setFilesManagerChanged(false);
                      setFilesManagerOpen(true);
                    }}
                    onDownload={() => { setOpenCardMenuId(null); handleDownloadTemplate(template); }}
                    onEdit={() => { setOpenCardMenuId(null); handleOpenEditModal(template); }}
                    onFormConfig={() => { setOpenCardMenuId(null); handleOpenTemplateFormConfig(template); }}
                    onCustomFields={() => { setOpenCardMenuId(null); handleOpenTemplateCustomFields(template); }}
                    duplicating={duplicatingTemplateId === template.id}
                    onDuplicate={() => { setOpenCardMenuId(null); handleDuplicateTemplate(template); }}
                    onDelete={() => { setOpenCardMenuId(null); handleDeleteTemplate(template); }}
                  />
                );
              })}
            </div>
          )}

          {templateActionError && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {templateActionError}
            </div>
          )}
        </div>
      )}

      {/* Petições Padrões */}
      {activeView === 'petitions' && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <StandardPetitionsModule onNavigateToModule={onNavigateToModule} />
        </div>
      )}

      {/* Novo template modal */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Adicionar Template"
        eyebrow="Formulário"
        size="md"
        zIndex={LAYER.MODAL}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCloseModal}
              className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="template-form"
              disabled={uploading}
              className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
            >
              {uploading ? 'Enviando...' : 'Salvar Template'}
            </button>
          </div>
        }
      >
        <ModalBody className="px-5 py-4">
          <form id="template-form" onSubmit={handleUploadTemplate} className="flex flex-col gap-6">
            {/* Form Fields */}
            <div className="space-y-5">
              {/* Nome */}
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Nome do Template</label>
                <input
                  type="text"
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Digite o nome do template"
                />
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Descrição</label>
                <textarea
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
                  rows={3}
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder="Digite a descrição do template"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-[#e7e5df] bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Parte contrária (Réu)</p>
                  <p className="text-xs text-slate-500">Mostra/oculta o campo na tela de geração de documento.</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={enableDefendantInput}
                    onChange={(e) => setEnableDefendantInput(e.target.checked)}
                  />
                  Habilitar
                </label>
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Arquivo do Template</label>
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
        </ModalBody>
      </Modal>

    {/* Preview Modal */}
    <Modal
      open={isPreviewModalOpen}
      onClose={handleClosePreviewModal}
      title={previewTemplate?.name ?? ''}
      eyebrow="Visualizar Template"
      size="xl"
      zIndex={LAYER.MODAL}
    >
      <ModalBody className="px-5 py-4">
        {previewLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : previewError ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{previewError}</div>
        ) : previewTemplate?.file_path ? (
          <div className="flex h-full flex-col gap-4">
            {previewPdfUrl ? (
              <iframe src={previewPdfUrl} title="Preview DOCX" className="h-full w-full rounded-xl border border-[#e7e5df]" />
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
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                  value={previewEditName}
                  onChange={(e) => setPreviewEditName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Descrição</label>
                <textarea
                  className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
                  rows={3}
                  value={previewEditDescription}
                  onChange={(e) => setPreviewEditDescription(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conteúdo</label>
                <textarea
                  className="w-full min-h-[280px] rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
                  value={previewEditContent}
                  onChange={(e) => setPreviewEditContent(e.target.value)}
                />
              </div>
              {previewEditError && <p className="text-sm text-red-600">{previewEditError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCancelPreviewEditing}
                  className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={previewSaving}
                  className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
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
              <pre className="flex-1 overflow-auto rounded-xl border border-[#e7e5df] bg-gray-50 p-4 text-xs text-gray-700 whitespace-pre-wrap">
                {previewEditContent}
              </pre>
            </div>
          )
        ) : (
          <p className="text-sm text-gray-500">Nenhum conteúdo para visualizar.</p>
        )}
      </ModalBody>
    </Modal>

    {/* Modal Preparando Assinatura */}
    <Modal
      open={preparingSignature}
      onClose={() => {}}
      title="Preparando documentos..."
      eyebrow="Aguarde"
      size="sm"
      zIndex={LAYER.MODAL_NESTED + 2}
    >
      <ModalBody className="px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-500 dark:text-slate-400">Enviando documento e anexos para assinatura digital</p>
          </div>
        </div>
      </ModalBody>
    </Modal>

    {/* Edit Modal */}
    <Modal
      open={isEditModalOpen && !!editingTemplate}
      onClose={handleCloseEditModal}
      title={editingTemplate?.name ?? ''}
      eyebrow="Editar Template"
      size="lg"
      zIndex={LAYER.MODAL}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCloseEditModal}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="edit-form"
            disabled={previewSaving}
            className="flex items-center gap-2 rounded bg-orange-500 hover:bg-orange-600 px-4 py-1.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
          >
            {previewSaving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        <form id="edit-form" onSubmit={handleSaveTemplateEdits} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Nome</label>
            <input
              type="text"
              className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Descrição</label>
            <textarea
              className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-200 mb-1">Conteúdo</label>
            <textarea
              className="w-full h-64 rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Conteúdo do template com variáveis entre colchetes duplos, ex: [[NOME]]"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[#e7e5df] bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Parte contrária (Réu)</p>
              <p className="text-xs text-slate-500">Mostra/oculta o campo na tela de geração de documento.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editEnableDefendant}
                onChange={(e) => setEditEnableDefendant(e.target.checked)}
              />
              Habilitar
            </label>
          </div>
          {editError && <p className="text-sm text-red-600">{editError}</p>}
        </form>
      </ModalBody>
    </Modal>

    {/* Gerenciador de múltiplos arquivos por template */}
    {filesManagerTemplate && (
      <TemplateFilesManager
        isOpen={filesManagerOpen}
        onClose={() => {
          const changedTemplate = filesManagerChanged ? filesManagerTemplate : null;
          setFilesManagerOpen(false);
          setFilesManagerTemplate(null);
          setFilesManagerChanged(false);
          if (changedTemplate) void openTemplateConfigWhenUnknownFieldsExist(changedTemplate);
        }}
        template={filesManagerTemplate}
        onUpdate={async () => {
          setFilesManagerChanged(true);
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
    <Modal
      open={showDocOptionsModal}
      onClose={() => setShowDocOptionsModal(false)}
      title="Documento Gerado!"
      eyebrow="Sucesso"
      icon={<CheckCircle2 className="w-5 h-5" />}
      size="sm"
      zIndex={LAYER.MODAL}
      footer={
        <button
          onClick={() => setShowDocOptionsModal(false)}
          className="w-full px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition"
        >
          Fechar
        </button>
      }
    >
      <ModalBody className="px-5 py-4">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2 break-all">{generatedDocName}</p>
        {generatedAttachments.length > 0 && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-4">
            + {generatedAttachments.length} anexo{generatedAttachments.length > 1 ? 's' : ''}: {generatedAttachments.map(a => a.name).join(', ')}
          </p>
        )}

        <div className="space-y-3">
          <button
            onClick={handleDownloadWord}
            className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded-xl transition border border-[#e7e5df] dark:border-slate-700"
          >
            <div className="w-10 h-10 bg-slate-700 dark:bg-slate-600 rounded-lg flex items-center justify-center">
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
      </ModalBody>
    </Modal>

    <Modal
      open={showTemplateFillLinkModal}
      onClose={() => setShowTemplateFillLinkModal(false)}
      title="Link de Preenchimento"
      eyebrow="Pronto para enviar"
      icon={<Link2 className="w-5 h-5" />}
      size="md"
      zIndex={LAYER.MODAL_NESTED}
      footer={
        <button
          onClick={() => setShowTemplateFillLinkModal(false)}
          className="w-full px-4 py-2.5 bg-slate-900 dark:bg-[#f8f7f5] text-white dark:text-slate-900 rounded-xl font-semibold transition hover:bg-slate-800 dark:hover:bg-slate-100"
        >
          Fechar
        </button>
      }
    >
      <ModalBody className="px-5 py-4">
        <TemplateFillLinkPanel
          uniqueLink={templateFillUniqueLink}
          permanentLink={templateFillPermanentLink}
          copiedKind={templateFillCopiedKind}
          onCopy={handleCopyTemplateFillLink}
        />
      </ModalBody>
    </Modal>

    <Modal
      open={showTemplateFormConfigModal && !!templateFormConfigTemplate}
      onClose={() => {
        if (!templateFormConfigSaving) {
          setShowTemplateFormConfigModal(false);
          setTemplateFormConfigTemplate(null);
        }
      }}
      title={templateFormConfigTemplate?.name ?? ''}
      eyebrow={templateConfigMode === 'form' ? 'Campos do formulário' : 'Campos personalizados'}
      subtitle={templateConfigMode === 'form'
        ? 'Escolha quais dados serão coletados no formulário público enviado ao cliente.'
        : 'Consulte os dados definidos no formulário e escolha apenas quais serão solicitados na geração interna.'}
      size="lg"
      zIndex={LAYER.MODAL_NESTED + 1}
      headerActions={
        <button
          type="button"
          onClick={() => {
            if (templateFormConfigSaving || templateFormConfigLoading) return;
            void handleSaveTemplateFormConfig();
          }}
          className={`px-3 py-2 rounded-xl bg-slate-900 dark:bg-[#f8f7f5] text-white dark:text-slate-900 text-sm font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition inline-flex items-center justify-center gap-2 ${(templateFormConfigSaving || templateFormConfigLoading) ? 'opacity-60 pointer-events-none' : ''}`}
        >
          {templateFormConfigSaving && <Loader2 className="w-4 h-4 animate-spin" />}
          Salvar
        </button>
      }
      footer={
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={() => {
              if (!templateFormConfigSaving) {
                setShowTemplateFormConfigModal(false);
                setTemplateFormConfigTemplate(null);
              }
            }}
            className="px-3 py-1.5 text-[13px] font-medium text-slate-500 dark:text-slate-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-800 rounded transition"
            disabled={templateFormConfigSaving}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (templateFormConfigSaving || templateFormConfigLoading) return;
              void handleSaveTemplateFormConfig();
            }}
            disabled={templateFormConfigSaving || templateFormConfigLoading}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold transition inline-flex items-center justify-center gap-2"
            style={{
              backgroundColor: (templateFormConfigSaving || templateFormConfigLoading) ? '#cbd5e1' : '#0f172a',
              color: (templateFormConfigSaving || templateFormConfigLoading) ? '#475569' : '#ffffff',
              cursor: (templateFormConfigSaving || templateFormConfigLoading) ? 'not-allowed' : 'pointer',
            }}
          >
            {templateFormConfigSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar configuração
          </button>
        </div>
      }
    >
      <ModalBody className="px-5 py-4">
        {templateFormConfigError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {templateFormConfigError}
          </div>
        )}

        {!templateFormConfigLoading && templateConfigMode === 'form' && (
          <div className="mb-4 space-y-3">
            {templateFormNewCustomKeys.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <p className="font-semibold">
                    {templateFormNewCustomKeys.length === 1
                      ? 'Foi encontrado 1 campo adicional ainda não cadastrado.'
                      : `Foram encontrados ${templateFormNewCustomKeys.length} campos adicionais ainda não cadastrados.`}
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">Revise o título e o tipo. Ao salvar, eles ficarão disponíveis somente neste template.</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-xl border border-[#e7e5df] bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">Campos personalizados</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">Cadastre um dado específico deste template ou deixe o sistema identificá-lo pelo placeholder.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTemplateFieldForm((current) => !current)}
                className="inline-flex flex-none items-center justify-center gap-2 rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                {showNewTemplateFieldForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {showNewTemplateFieldForm ? 'Cancelar' : 'Adicionar campo'}
              </button>
            </div>

            {showNewTemplateFieldForm && (
              <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-500/30 dark:bg-primary-500/10">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Nome do campo</span>
                    <input
                      value={newTemplateField.name}
                      onChange={(event) => setNewTemplateField((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Ex: Nome do menor"
                      className="mt-1 h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Placeholder</span>
                    <input
                      value={newTemplateField.placeholder}
                      onChange={(event) => setNewTemplateField((current) => ({ ...current, placeholder: event.target.value.toLocaleUpperCase('pt-BR').replace(/\s+/g, '_') }))}
                      placeholder="NOME_MENOR"
                      className="mt-1 h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Tipo</span>
                    <select
                      value={newTemplateField.field_type}
                      onChange={(event) => setNewTemplateField((current) => ({ ...current, field_type: event.target.value as UpsertTemplateCustomFieldDTO['field_type'] }))}
                      className="mt-1 h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="text">Texto</option>
                      <option value="name">Nome</option>
                      <option value="cpf">CPF</option>
                      <option value="phone">Telefone</option>
                      <option value="cep">CEP</option>
                      <option value="textarea">Texto longo</option>
                      <option value="number">Número</option>
                      <option value="date">Data</option>
                      <option value="select">Seleção</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">Descrição</span>
                    <input
                      value={newTemplateField.description}
                      onChange={(event) => setNewTemplateField((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Orientação para o preenchimento"
                      className="mt-1 h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={newTemplateField.required}
                      onChange={(event) => setNewTemplateField((current) => ({ ...current, required: event.target.checked }))}
                    />
                    Obrigatório
                  </label>
                  <button
                    type="button"
                    onClick={handleAddTemplateCustomField}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar ao template
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {templateFormConfigLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : templateConfigVisibleFields.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {templateConfigMode === 'form'
              ? 'Nenhum placeholder encontrado no template.'
              : 'Nenhum campo personalizado foi cadastrado. Faça o cadastro em “Campos do formulário”.'}
          </p>
        ) : (
          <div className="space-y-3">
            {templateConfigVisibleFields.map(({ field: f, index: idx }) => (
              <div
                key={`${f.placeholder}-${idx}`}
                className="rounded-xl border border-[#e7e5df] dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-4"
                draggable={templateConfigMode === 'form' && !templateFormConfigSaving && !templateFormConfigLoading}
                onDragStart={() => {
                  if (templateConfigMode !== 'form') return;
                  templateFormConfigDragIndexRef.current = idx;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (templateConfigMode !== 'form') return;
                  const from = templateFormConfigDragIndexRef.current;
                  templateFormConfigDragIndexRef.current = null;
                  if (from === null) return;
                  if (from === idx) return;
                  setTemplateFormConfigFields((prev) => {
                    const next = [...prev];
                    const [moved] = next.splice(from, 1);
                    next.splice(idx, 0, moved);
                    return templateFormConfigRecomputeOrder(next);
                  });
                }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold">Placeholder</p>
                    <p className="font-mono text-sm text-slate-800 dark:text-white break-all">[[{f.placeholder}]]</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {isBuiltInTemplatePlaceholder(f.placeholder) ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600 dark:bg-zinc-700 dark:text-zinc-300">Campo do sistema</span>
                      ) : templateFormNewCustomKeys.includes(normalizeTemplateFieldKey(f.placeholder))
                        && !templateFormExistingKeys.includes(normalizeTemplateFieldKey(f.placeholder)) ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">Novo campo detectado</span>
                      ) : (
                        <span className="rounded-full bg-primary-100 px-2 py-0.5 font-medium text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">Campo personalizado</span>
                      )}
                      {templateConfigMode === 'custom' && (
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${
                          f.show_in_generation !== false
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-500 dark:bg-zinc-700 dark:text-zinc-400'
                        }`}>
                          {f.show_in_generation !== false ? 'Exibido na geração' : 'Oculto na geração'}
                        </span>
                      )}
                      {templateFormDetectedKeys.includes(normalizeTemplateFieldKey(f.placeholder)) ? (
                        <span className="text-slate-500 dark:text-zinc-400">
                          Encontrado em {(templateFormFilesByKey[normalizeTemplateFieldKey(f.placeholder)] || []).join(', ')}
                        </span>
                      ) : (
                        <span className="font-medium text-amber-600 dark:text-amber-300">Não encontrado nos arquivos do kit</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {templateConfigMode === 'form'
                      && !isBuiltInTemplatePlaceholder(f.placeholder)
                      && !templateFormDetectedKeys.includes(normalizeTemplateFieldKey(f.placeholder)) && (
                      <button
                        type="button"
                        onClick={() => {
                          const key = normalizeTemplateFieldKey(f.placeholder);
                          setTemplateFormConfigFields((current) => templateFormConfigRecomputeOrder(current.filter((_, fieldIndex) => fieldIndex !== idx)));
                          setTemplateFormNewCustomKeys((current) => current.filter((candidate) => candidate !== key));
                        }}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        title="Remover campo personalizado"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {templateConfigMode === 'form' && (
                      <div className="text-slate-400 dark:text-slate-500 cursor-grab active:cursor-grabbing select-none">
                        <GripVertical className="w-5 h-5" />
                      </div>
                    )}
                  <div className="flex flex-col sm:items-end gap-2">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={templateConfigMode === 'form' ? f.enabled !== false : f.show_in_generation !== false}
                        onChange={(e) =>
                          setTemplateFormConfigFields((prev) =>
                            prev.map((p, i) => i === idx
                              ? templateConfigMode === 'form'
                                ? { ...p, enabled: e.target.checked }
                                : { ...p, show_in_generation: e.target.checked }
                              : p),
                          )
                        }
                      />
                      {templateConfigMode === 'form' ? 'Coletar no formulário' : 'Exibir na geração'}
                    </label>
                    {templateConfigMode === 'form' && (
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={!!f.required}
                          onChange={(e) =>
                            setTemplateFormConfigFields((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, required: e.target.checked } : p)),
                            )
                          }
                        />
                        Obrigatório
                      </label>
                    )}
                  </div>
                  </div>
                </div>

                {templateConfigMode === 'form' ? (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Título</span>
                    <input
                      value={f.name}
                      onChange={(e) =>
                        setTemplateFormConfigFields((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)),
                        )
                      }
                      className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tipo</span>
                    <select
                      value={f.field_type}
                      onChange={(e) => {
                        const nextType = e.target.value as any;
                        setTemplateFormConfigFields((prev) =>
                          prev.map((p, i) => {
                            if (i !== idx) return p;
                            if (nextType !== 'select') {
                              return { ...p, field_type: nextType, options: null };
                            }
                            const k = normalizeKey(p.placeholder);
                            const hasAny = Array.isArray(p.options) && p.options.length > 0;
                            const preset =
                              k === 'ESTADO CIVIL'
                                ? [
                                    { label: 'Solteiro(a)', value: 'Solteiro(a)' },
                                    { label: 'Casado(a)', value: 'Casado(a)' },
                                    { label: 'União estável', value: 'União estável' },
                                    { label: 'Divorciado(a)', value: 'Divorciado(a)' },
                                    { label: 'Viúvo(a)', value: 'Viúvo(a)' },
                                  ]
                                : k === 'NACIONALIDADE'
                                  ? [
                                      { label: 'Brasileiro(a)', value: 'Brasileiro(a)' },
                                      { label: 'Estrangeiro(a)', value: 'Estrangeiro(a)' },
                                    ]
                                  : null;
                            return { ...p, field_type: nextType, options: hasAny ? p.options : preset };
                          }),
                        );
                      }}
                      className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition mt-1"
                    >
                      <option value="text">Texto</option>
                      <option value="name">Nome</option>
                      <option value="cpf">CPF</option>
                      <option value="phone">Telefone</option>
                      <option value="cep">CEP</option>
                      <option value="textarea">Texto longo</option>
                      <option value="number">Número</option>
                      <option value="date">Data</option>
                      <option value="select">Seleção</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Descrição</span>
                    <input
                      value={(f.description as any) ?? ''}
                      onChange={(e) =>
                        setTemplateFormConfigFields((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, description: e.target.value } : p)),
                        )
                      }
                      className="w-full rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] placeholder:text-slate-400 transition mt-1"
                      placeholder="Ex: Digite o número com DDD"
                    />
                  </label>
                </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 dark:border-zinc-700 dark:bg-zinc-900/60">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Título</p>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{f.name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tipo</p>
                      <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{{
                        text: 'Texto',
                        name: 'Nome',
                        cpf: 'CPF',
                        phone: 'Telefone',
                        cep: 'CEP',
                        textarea: 'Texto longo',
                        number: 'Número',
                        date: 'Data',
                        select: 'Seleção',
                      }[f.field_type]}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Descrição</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{f.description || 'Sem descrição cadastrada.'}</p>
                    </div>
                  </div>
                )}

                {templateConfigMode === 'form' && f.field_type === 'select' && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Opções (1 por linha)</span>
                      <div className="flex items-center gap-2">
                        {['ESTADO CIVIL', 'NACIONALIDADE'].includes(normalizeKey(f.placeholder)) && (
                          <button
                            type="button"
                            onClick={() => {
                              const k = normalizeKey(f.placeholder);
                              const preset =
                                k === 'ESTADO CIVIL'
                                  ? [
                                      { label: 'Solteiro(a)', value: 'Solteiro(a)' },
                                      { label: 'Casado(a)', value: 'Casado(a)' },
                                      { label: 'União estável', value: 'União estável' },
                                      { label: 'Divorciado(a)', value: 'Divorciado(a)' },
                                      { label: 'Viúvo(a)', value: 'Viúvo(a)' },
                                    ]
                                  : [
                                      { label: 'Brasileiro(a)', value: 'Brasileiro(a)' },
                                      { label: 'Estrangeiro(a)', value: 'Estrangeiro(a)' },
                                    ];
                              setTemplateFormConfigFields((prev) => prev.map((p, i) => (i === idx ? { ...p, options: preset } : p)));
                            }}
                            className="px-3 py-1.5 rounded-lg border border-[#e7e5df] dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                          >
                            Aplicar padrão
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setTemplateFormConfigFields((prev) => prev.map((p, i) => (i === idx ? { ...p, options: null } : p)))}
                          className="px-3 py-1.5 rounded-lg border border-[#e7e5df] dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition"
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={templateFormConfigOptionsToText(f.options)}
                      onChange={(e) => {
                        const parsed = templateFormConfigParseOptions(e.target.value);
                        setTemplateFormConfigFields((prev) => prev.map((p, i) => (i === idx ? { ...p, options: parsed } : p)));
                      }}
                      className="w-full min-h-[96px] rounded text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-400/40 focus:border-orange-400 border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 placeholder:text-slate-400 px-3 py-2 text-[13px] resize-none transition mt-2"
                      placeholder="Ex:\nSolteiro(a)\nCasado(a)"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ModalBody>
    </Modal>

    {/* Modal de Link de Assinatura */}
    <Modal
      open={showSignatureLinkModal}
      onClose={() => setShowSignatureLinkModal(false)}
      title="Link de Assinatura"
      eyebrow="Pronto para enviar"
      icon={<Link2 className="w-5 h-5" />}
      size="md"
      zIndex={LAYER.MODAL_NESTED}
      footer={
        <button
          onClick={() => setShowSignatureLinkModal(false)}
          className="w-full px-4 py-2.5 bg-slate-900 dark:bg-[#f8f7f5] text-white dark:text-slate-900 rounded-xl font-semibold transition hover:bg-slate-800 dark:hover:bg-slate-100"
        >
          Fechar
        </button>
      }
    >
      <ModalBody className="px-5 py-4">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Envie este link para o cliente assinar o documento.
        </p>

        <div className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 mb-4 border border-[#e7e5df] dark:border-zinc-700">
          <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-2">Link para assinatura:</p>
          <div className="flex items-center gap-2 flex-col sm:flex-row">
            <input
              type="text"
              readOnly
              value={signatureLink}
              className="flex-1 w-full rounded text-slate-900 dark:text-white border border-slate-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 h-[34px] px-3 text-[13px] font-mono transition"
            />
            <button
              onClick={handleCopyLink}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 w-full sm:w-auto ${
                linkCopied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
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

        {/*
          Copiar e colar em algum lugar era o único caminho. Quando o cliente já
          tem telefone na ficha, o envio sai daqui pela conversa do CRM — é lá
          que ficam a thread, o vínculo com o cadastro e o acompanhamento da
          assinatura. Sem telefone cadastrado, o botão não aparece: prometer um
          envio que não tem para onde ir é pior do que não oferecer.
        */}
        {signatureLinkTarget?.phone && (
          <button
            type="button"
            onClick={handleSendSignatureLinkOnWhatsApp}
            className="mb-4 flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-emerald-500 text-white">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                Enviar no WhatsApp
              </span>
              <span className="block truncate text-xs text-emerald-700 dark:text-emerald-300">
                Abre a conversa com {signatureLinkTarget.clientName} ({formatPhone(signatureLinkTarget.phone)}) com a mensagem pronta.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-emerald-600 dark:text-emerald-400" />
          </button>
        )}

        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {signatureLinkTarget && !signatureLinkTarget.phone ? (
              <>
                <strong>Dica:</strong> este cliente não tem telefone cadastrado, então o envio direto pelo
                WhatsApp não aparece aqui. Copie o link e mande por e-mail ou SMS — ou cadastre o telefone na
                ficha dele.
              </>
            ) : (
              <>
                <strong>Dica:</strong> Envie este link por WhatsApp, e-mail ou SMS para o cliente. Ele poderá assinar o documento diretamente pelo celular ou computador.
              </>
            )}
          </p>
        </div>
      </ModalBody>
    </Modal>
    </div>
  );
}

export default DocumentsModule;
