import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import JSZip from 'jszip';
import { Document, Page, pdfjs } from 'react-pdf';
import { renderAsync } from 'docx-preview';
import {
  FileText, Upload, Plus, Trash2, X, Check, Clock, CheckCircle, Send, Copy,
  User, Mail, Loader2, ChevronLeft, Eye, EyeOff, Filter, Search, MousePointer2,
  Type, Hash, Calendar, PenTool, Users, Download, AlertTriangle, ExternalLink, ChevronRight, ZoomIn, ZoomOut, Shield, Lightbulb, Pencil, Maximize2, Minimize2, LayoutList, LayoutGrid, FolderOpen, Phone,
  ArrowUpDown, FileSignature, ChevronUp, ChevronDown, Lock, LockOpen, RotateCcw, Inbox,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { useSecurityPin } from '../contexts/SecurityPinContext';
import { signatureService } from '../services/signature.service';
import { buildWaPreviewUrl } from '../utils/publicAppUrl';
import { processService } from '../services/process.service';
import { pdfSignatureService } from '../services/pdfSignature.service';
import { cloudService } from '../services/cloud.service';
import { supabase } from '../config/supabase';
import { events, SYSTEM_EVENTS } from '../utils/events';
import { documentTemplateService } from '../services/documentTemplate.service';
import { signatureFieldsService } from '../services/signatureFields.service';
import { settingsService } from '../services/settings.service';
import { useDeleteConfirm } from '../contexts/DeleteConfirmContext';
import { userNotificationService } from '../services/userNotification.service';
import { signatureExplorerService } from '../services/signatureExplorer.service';
import { clientService } from '../services/client.service';
import { useSilentRefresh } from '../hooks/useSilentRefresh';
import { useMinLoading } from '../hooks/useMinLoading';
import { useSelectionState } from '../hooks/useSelectionState';
import FacialCapture from './FacialCapture';
import { filterGeneratedDocumentsByFolder, filterSignatureRequests } from '../utils/signatureFilters';
import type {
  SignatureRequest, SignatureRequestWithSigners, Signer, CreateSignatureRequestDTO,
  SignerAuthMethod, SignatureFieldType, SignatureAuditLog, SignatureRequestDocument,
} from '../types/signature.types';
import SignatureCanvas from './SignatureCanvas';
import SignatureReport from './SignatureReport';
import ForensicDossier from './ForensicDossier';
import SignatureCertificateMockup from './SignatureCertificateMockup';
import type { GeneratedDocument } from '../types/document.types';
import type { CloudFile, CloudFolder } from '../types/cloud.types';
import type { SignatureExplorerFolder, SignatureExplorerItem } from '../types/signatureExplorer.types';
import type { ProcessPracticeArea } from '../types/process.types';
import type { Client } from '../types/client.types';
import { Modal, ModalBody, SignatureSkeleton } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type WizardStep = 'list' | 'upload' | 'signers' | 'position' | 'settings' | 'success';

interface DraftSigner {
  id: string; name: string; email: string; cpf: string; role: string; order: number; deliveryMethod: 'email' | 'link';
}

interface DraftField {
  localId: string; signerId: string; fieldType: SignatureFieldType;
  pageNumber: number; xPercent: number; yPercent: number; wPercent: number; hPercent: number;
  documentId: string; // ID do documento no viewer (main ou attachment-X)
}

interface SignatureSettings {
  requireCpf: boolean; allowRefusal: boolean;
  blockAfterDeadline: boolean; expiresAt: string;
  authMethod: SignerAuthMethod;
}

const FIELD_PRESETS: Record<SignatureFieldType, { w: number; h: number; label: string; icon: React.ElementType }> = {
  signature: { w: 24, h: 5.4, label: 'Assinatura', icon: FileSignature },
  initials: { w: 8, h: 3, label: 'Rubrica', icon: PenTool },
  name: { w: 12, h: 2.5, label: 'Nome', icon: Type },
  cpf: { w: 10, h: 2.5, label: 'CPF', icon: Hash },
  date: { w: 10, h: 2.5, label: 'Data', icon: Calendar },
};

const normalizeCloudCompareText = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const isImagePath = (path: string) => {
  const lower = path.toLowerCase().split('?')[0];
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.bmp');
};

const getProcessFolderName = (processNumber?: string | null) => {
  const normalized = String(processNumber || '').trim();
  return normalized ? `PROCESSO ${normalized}` : null;
};

const GENERIC_CONTRACT_FOLDER_TOKENS = new Set([
  'novo contrato',
  'contrato',
  'kit consumidor',
  'kit',
  'consumidor',
  'acordo',
  'documento',
]);

const cleanCounterpartyCandidate = (value?: string | null) => {
  const normalized = String(value || '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;
  if (GENERIC_CONTRACT_FOLDER_TOKENS.has(normalizeCloudCompareText(normalized))) return null;
  return normalized;
};

const getCounterpartyFromDocumentName = (documentName?: string | null, clientName?: string | null) => {
  const normalizedClientName = normalizeCloudCompareText(clientName || '');
  const rawParts = String(documentName || '')
    .split('-')
    .map((part) => cleanCounterpartyCandidate(part))
    .filter(Boolean) as string[];

  const candidate = rawParts.find((part) => normalizeCloudCompareText(part) !== normalizedClientName);
  return candidate || null;
};

const getCounterpartyFolderName = (request: SignatureRequestWithSigners) => {
  const rawClientName = request.client_name || request.signers?.[0]?.name || '';
  const clientName = normalizeCloudCompareText(rawClientName);
  const documentCounterparty = getCounterpartyFromDocumentName(request.document_name, rawClientName);

  if (documentCounterparty) {
    return documentCounterparty;
  }

  const counterparties = Array.from(new Set(
    (request.signers || [])
      .map((signer) => cleanCounterpartyCandidate(signer.name))
      .filter(Boolean)
      .filter((name) => normalizeCloudCompareText(name) !== clientName),
  ));

  if (counterparties.length === 0) return null;
  if (counterparties.length === 1) return counterparties[0];
  return counterparties.join(' + ');
};

const getPrimaryClientPhone = (client?: Pick<Client, 'phone' | 'mobile'> | null) => String(client?.mobile || client?.phone || '').trim();

const normalizePhoneDigits = (value?: string | null) => String(value || '').replace(/\D/g, '');

const getWhatsappLink = (phone?: string | null) => {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const internationalDigits = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${internationalDigits}`;
};

interface SignatureModulePrefillData {
  documentPath: string;
  documentName: string;
  attachmentPaths?: string[] | null;
  clientId: string;
  clientName: string;
  clientEmail?: string;
  clientCpf?: string;
  clientPhone?: string;
  templateId?: string;
}

interface SignatureModuleProps {
  prefillData?: SignatureModulePrefillData;
  focusRequestId?: string;
  onParamConsumed?: () => void;
}

const SignatureModule: React.FC<SignatureModuleProps> = ({ prefillData, focusRequestId, onParamConsumed }) => {
  const toast = useToastContext();
  const { user } = useAuth();
  const { navigateTo } = useNavigation();
  const { confirmDelete } = useDeleteConfirm();
  const { requirePin } = useSecurityPin();

  const toastRef = useRef(toast);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [loading, setLoading] = useState(true);
  const showListSkeleton = useMinLoading(loading);
  const [signerRoles, setSignerRoles] = useState<string[]>(['Signatário','Contratante','Contratado','Testemunha','Fiador','Cônjuge','Representante Legal']);
  const [requests, setRequests] = useState<SignatureRequestWithSigners[]>([]);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [cloudSyncStatusByRequestId, setCloudSyncStatusByRequestId] = useState<Record<string, boolean>>({});

  const [explorerLoading, setExplorerLoading] = useState(true);
  const [explorerFolders, setExplorerFolders] = useState<SignatureExplorerFolder[]>([]);
  const [explorerItems, setExplorerItems] = useState<SignatureExplorerItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const [deleteFolderTarget, setDeleteFolderTarget] = useState<SignatureExplorerFolder | null>(null);

  const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState('');
  const [createFolderSaving, setCreateFolderSaving] = useState(false);

  const [contextMenu, setContextMenu] = useState<null | {
    x: number;
    y: number;
    itemType: 'signature_request' | 'generated_document';
    itemId: string;
    createdBy?: string;
  }>(null);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<null | {
    itemType: 'signature_request' | 'generated_document';
    itemId: string;
    createdBy?: string;
  }>(null);
  const [moveSelectedFolderId, setMoveSelectedFolderId] = useState<string | null>(null);
  const [moveSaving, setMoveSaving] = useState(false);

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [isDraggingExplorer, setIsDraggingExplorer] = useState(false);
  const [draggingExplorer, setDraggingExplorer] = useState<null | {
    type: 'folder' | 'item';
    id: string;
    itemType?: 'signature_request' | 'generated_document';
  }>(null);
  const [folderReorderOver, setFolderReorderOver] = useState<null | { parentId: string | null; beforeId: string | null }>(null);
  const [folderReorderMode, setFolderReorderMode] = useState(false);

  const dragImageElRef = useRef<HTMLDivElement | null>(null);
  const suppressExplorerClickRef = useRef(false);

  const [deleteFolderSaving, setDeleteFolderSaving] = useState<'move_root' | 'delete_all' | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'signed' | 'expired'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [filterPeriod, setFilterPeriod] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [filterMonth, setFilterMonth] = useState(''); // yyyy-mm
  const [filterDateFrom, setFilterDateFrom] = useState(''); // yyyy-mm-dd
  const [filterDateTo, setFilterDateTo] = useState(''); // yyyy-mm-dd
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('signature_view_mode') : null;
      return saved === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const [wizardStep, setWizardStep] = useState<WizardStep>('list');
  const [wizardLoading, setWizardLoading] = useState(false);

  const [openProcessLoading, setOpenProcessLoading] = useState(false);
  const [showCreateProcess, setShowCreateProcess] = useState(false);
  const [createProcessArea, setCreateProcessArea] = useState<ProcessPracticeArea>('previdenciario');
  const [createProcessUrgent, setCreateProcessUrgent] = useState(false);
  const [createProcessLoading, setCreateProcessLoading] = useState(false);
  const [copyToCloudLoading, setCopyToCloudLoading] = useState(false);
  const [sendEmailLoading, setSendEmailLoading] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem('signature_view_mode', viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedDocumentName, setSelectedDocumentName] = useState('');
  const [selectedDocumentPath, setSelectedDocumentPath] = useState('');
  const [selectedAttachmentPaths, setSelectedAttachmentPaths] = useState<string[] | null>(null);
  
  // Estado para múltiplos documentos no visualizador
  interface ViewerDocument {
    id: string;
    name: string;
    path: string;
    type: 'main' | 'attachment';
    blob?: Blob | null;
    previewUrl?: string | null;
    docxHtml?: string;
    pageCount?: number;
  }
  const [viewerDocuments, setViewerDocuments] = useState<ViewerDocument[]>([]);
  const [currentViewerDocIndex, setCurrentViewerDocIndex] = useState(0);
  const [loadingViewerDoc, setLoadingViewerDoc] = useState(false);

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string | null>(null);
  const [selectedClientPhone, setSelectedClientPhone] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]); // Múltiplos arquivos (envelope)
  const [selectedGenDocIds, setSelectedGenDocIds] = useState<string[]>([]); // Multi-seleção de documentos gerados
  const [genDocsSearchTerm, setGenDocsSearchTerm] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSelectedClientPhone = async () => {
      if (!selectedClientId) {
        setSelectedClientPhone(null);
        return;
      }

      try {
        const client = await clientService.getClientById(selectedClientId);
        if (cancelled) return;
        setSelectedClientPhone(getPrimaryClientPhone(client));
      } catch {
        if (!cancelled) {
          setSelectedClientPhone(null);
        }
      }
    };

    void loadSelectedClientPhone();

    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  const [signers, setSigners] = useState<DraftSigner[]>([
    { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Signatário', order: 1, deliveryMethod: 'email' },
  ]);
  const [signerOrder, setSignerOrder] = useState<'none' | 'sequential'>('none');

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isDocxFile, setIsDocxFile] = useState(false);
  const [isImageFile, setIsImageFile] = useState(false);
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [fields, setFields] = useState<DraftField[]>([]);
  const [draggingField, setDraggingField] = useState<{
    localId: string;
    pageNumber: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    rect: { width: number; height: number };
  } | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const viewerScrollRef = useRef<HTMLDivElement>(null);
  const documentLoadedRef = useRef<string | null>(null);

  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1);
  const [pdfAutoFitEnabled, setPdfAutoFitEnabled] = useState(true);
  const [pdfViewMode, setPdfViewMode] = useState<'fit' | 'expanded' | 'manual'>('fit');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfPreviewUrls, setPdfPreviewUrls] = useState<string[]>([]); // URLs para múltiplos PDFs
  const [footerMockupLoading, setFooterMockupLoading] = useState(false);
  const [certificateMockupOpen, setCertificateMockupOpen] = useState(false);
  const certificateMockupWindowRef = useRef<Window | null>(null);
  const certificateMockupRootRef = useRef<Root | null>(null);
  const [pdfNumPagesByDoc, setPdfNumPagesByDoc] = useState<Record<number, number>>({}); // Páginas por documento

  const [settings, setSettings] = useState<SignatureSettings>({
    requireCpf: false, allowRefusal: true,
    blockAfterDeadline: false, expiresAt: '',
    authMethod: 'signature_only',
  });
  const [availableAuthMethods, setAvailableAuthMethods] = useState<Array<{ value: SignerAuthMethod; label: string }>>([
    { value: 'signature_only', label: 'Só assinatura' },
    { value: 'signature_facial', label: 'Assinatura + Validação Facial' },
    { value: 'signature_facial_document', label: 'Assinatura + Facial + Documento' },
  ]);

  const [createdRequest, setCreatedRequest] = useState<SignatureRequestWithSigners | null>(null);
  const [detailsRequest, setDetailsRequest] = useState<SignatureRequestWithSigners | null>(null);
  // Modelo per_document: documentos assinados individuais do envelope em foco (detalhes).
  const [detailsDocuments, setDetailsDocuments] = useState<SignatureRequestDocument[]>([]);
  const [reportTarget, setReportTarget] = useState<{ request: SignatureRequestWithSigners; signer: Signer } | null>(null);
  const [dossierTarget, setDossierTarget] = useState<{ requestId: string; documentName?: string | null } | null>(null);
  const [waEditOpen, setWaEditOpen] = useState<string | null>(null);
  const [waEditMsg, setWaEditMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    setShowCreateProcess(false);
    setOpenProcessLoading(false);
    setCreateProcessLoading(false);
    setCopyToCloudLoading(false);
  }, [detailsRequest?.id]);

  // Carrega os documentos assinados individuais quando o envelope em foco usa o
  // modelo per_document (1 PDF por arquivo). Envelopes consolidados (legado) não
  // consultam a nova tabela.
  useEffect(() => {
    let active = true;
    const id = detailsRequest?.id;
    if (!id || (detailsRequest as any)?.signature_model !== 'per_document') {
      setDetailsDocuments([]);
      return;
    }
    (async () => {
      try {
        const docs = await signatureService.listRequestDocuments(id);
        if (active) setDetailsDocuments(docs);
      } catch {
        if (active) setDetailsDocuments([]);
      }
    })();
    return () => { active = false; };
  }, [detailsRequest?.id, (detailsRequest as any)?.signature_model]);

  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signingSigner, setSigningSigner] = useState<Signer | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [signStep, setSignStep] = useState<'signature' | 'facial' | 'confirm'>('signature');
  const [signCpf, setSignCpf] = useState('');
  const [signLoading, setSignLoading] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [viewDocLoading, setViewDocLoading] = useState(false);
  const [downloadZipLoading, setDownloadZipLoading] = useState(false);
  const [signerImages, setSignerImages] = useState<Record<string, { facial?: string; signature?: string }>>({});
  const [deleteLoading, setDeleteLoading] = useState(false);

  const {
    selectionMode,
    selectedIds: selectedRequestIds,
    toggleSelectionMode,
    toggleSelectedId: toggleSelectedRequestId,
    selectIds,
    clearSelectedIds,
    pruneSelectedIds,
  } = useSelectionState<string>();

  const {
    selectedIds: selectedUploadFileIndexes,
    toggleSelectedId: toggleSelectedUploadIndex,
    selectIds: selectUploadFileIndexes,
    clearSelectedIds: clearSelectedUploadFileIndexes,
    setSelectedIds: setSelectedUploadFileIndexes,
  } = useSelectionState<number>();

  const detailsLoadTokenRef = useRef(0);
  const detailsRequestIdRef = useRef<string | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const loadData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    try {
      if (!silent || !hasLoadedOnceRef.current) {
        setLoading(true);
      }
      const [requestsData, docsData, foldersData, itemsData, cloudFoldersData, cloudFilesData] = await Promise.all([
        signatureService.listRequestsWithSigners(),
        documentTemplateService.listGeneratedDocuments(),
        signatureExplorerService.listFolders(),
        signatureExplorerService.listItems(),
        cloudService.listAllFolders(),
        cloudService.listAllFiles(),
      ]);

      const cloudStatusMap = requestsData.reduce<Record<string, boolean>>((acc, request) => {
        const clientFolderName = normalizeCloudCompareText(request.client_name || request.signers?.[0]?.name || '');
        const expectedFileName = normalizeCloudCompareText(`${request.document_name}_assinado.pdf`);
        const processFolderName = getProcessFolderName(request.process_number);
        const counterpartyFolderName = getCounterpartyFolderName(request);

        if (!request.client_id || !clientFolderName) {
          acc[request.id] = false;
          return acc;
        }

        const clientFolder = cloudFoldersData.find((folder: CloudFolder) =>
          !folder.parent_id
          && (folder.client_id || null) === request.client_id
          && normalizeCloudCompareText(folder.name) === clientFolderName,
        );

        if (!clientFolder) {
          acc[request.id] = false;
          return acc;
        }

        const processFolder = processFolderName
          ? cloudFoldersData.find((folder: CloudFolder) =>
              folder.parent_id === clientFolder.id
              && normalizeCloudCompareText(folder.name) === normalizeCloudCompareText(processFolderName),
            )
          : null;

        const processOrClientParentId = processFolder?.id || clientFolder.id;

        const counterpartyFolder = counterpartyFolderName
          ? cloudFoldersData.find((folder: CloudFolder) =>
              folder.parent_id === processOrClientParentId
              && normalizeCloudCompareText(folder.name) === normalizeCloudCompareText(counterpartyFolderName),
            )
          : null;

        const targetParentId = counterpartyFolder?.id || processOrClientParentId;

        const nonProtocolFolder = cloudFoldersData.find((folder: CloudFolder) =>
          folder.parent_id === targetParentId
          && normalizeCloudCompareText(folder.name) === normalizeCloudCompareText('NÃO PROTOCOLAR'),
        ) || (!counterpartyFolderName && !processFolderName
          ? null
          : cloudFoldersData.find((folder: CloudFolder) =>
              folder.parent_id === processOrClientParentId
              && normalizeCloudCompareText(folder.name) === normalizeCloudCompareText('NÃO PROTOCOLAR'),
            )) || (!processFolderName
          ? null
          : cloudFoldersData.find((folder: CloudFolder) =>
              folder.parent_id === clientFolder.id
              && normalizeCloudCompareText(folder.name) === normalizeCloudCompareText('NÃO PROTOCOLAR'),
            ));

        if (!nonProtocolFolder) {
          acc[request.id] = false;
          return acc;
        }

        const hasSignedCopy = cloudFilesData.some((file: CloudFile) =>
          file.folder_id === nonProtocolFolder.id
          && normalizeCloudCompareText(file.original_name) === expectedFileName,
        );

        acc[request.id] = hasSignedCopy;
        return acc;
      }, {});

      setRequests(requestsData);
      setGeneratedDocuments(docsData);
      setExplorerFolders(foldersData);
      setExplorerItems(itemsData);
      setCloudSyncStatusByRequestId(cloudStatusMap);
      hasLoadedOnceRef.current = true;
    } catch (error: any) {
      toastRef.current.error('Erro ao carregar dados');
    } finally {
      if (!silent || !hasLoadedOnceRef.current) {
        setLoading(false);
      }
      setExplorerLoading(false);
    }
  }, []);

  const { scheduleRefresh: scheduleDataRefresh, refreshTimerRef } = useSilentRefresh({
    enabled: wizardStep === 'list',
    // O Realtime (signature_requests/signers/generated_documents) já dispara um
    // refresh com debounce de 150ms a cada mudança real. Este polling é apenas
    // rede de segurança para eventos perdidos — 30s reduz em ~6x o custo das 6
    // queries pesadas do loadData (requests + explorer + cloud folders/files)
    // sem prejudicar a percepção de "ao vivo".
    intervalMs: 30000,
    isVisible: () => document.visibilityState === 'visible' && wizardStep === 'list',
    onRefresh: loadData,
  });

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    settingsService.getSignatureModuleConfig().then(cfg => {
      if (cfg.signer_roles?.length) setSignerRoles(cfg.signer_roles);
    }).catch(() => {});
  }, []);

  // Supabase Realtime - atualização automática da lista
  useEffect(() => {
    const channel = supabase
      .channel('signature-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signature_requests' },
        (payload) => {
          console.log('[Realtime] signature_requests change:', payload.eventType);
          scheduleDataRefresh(150);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'generated_documents' },
        (payload) => {
          console.log('[Realtime] generated_documents change:', payload.eventType);
          scheduleDataRefresh(150);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signature_signers' },
        (payload) => {
          console.log('[Realtime] signature_signers update:', payload.new);
          scheduleDataRefresh(150);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications' },
        (payload) => {
          console.log('[Realtime] user_notifications change:', payload.eventType);
          scheduleDataRefresh(300);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
      });

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [scheduleDataRefresh]);

  // Expor funções para acesso externo via DOM
  useEffect(() => {
    const element = document.querySelector('[data-signature-module]');
    if (element) {
      (element as any).__signatureModuleInstance = {
        resetWizard,
        setWizardStep
      };
    }
    return () => {
      const el = document.querySelector('[data-signature-module]');
      if (el) {
        delete (el as any).__signatureModuleInstance;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      certificateMockupRootRef.current?.unmount();
      certificateMockupRootRef.current = null;
      if (certificateMockupWindowRef.current && !certificateMockupWindowRef.current.closed) {
        certificateMockupWindowRef.current.close();
      }
      certificateMockupWindowRef.current = null;
    };
  }, []);

  const loadDocumentPreview = useCallback(async (doc: ViewerDocument) => {
    try {
      setPdfLoading(true);
      setLoadingViewerDoc(true);

      currentViewerDocIdRef.current = doc.id;
      
      // Verificar tipo de arquivo
      const isDocx = (doc.path ?? '').toLowerCase().endsWith('.docx');
      const isImg = doc.path ? isImagePath(doc.path) : false;
      setIsDocxFile(isDocx);
      setIsImageFile(isImg);

      if (isDocx && doc.docxHtml && docxContainerRef.current) {
        docxRenderedRef.current = true;
        docxHtmlContentRef.current = doc.docxHtml;
        docxContainerRef.current.innerHTML = doc.docxHtml;
        setPdfNumPages(doc.pageCount || 1);
        setPdfCurrentPage(1);
        setDocxBlob(null);
        setPdfPreviewUrl(doc.previewUrl || null);
        return;
      }

      if (doc.previewUrl) {
        setPdfPreviewUrl(doc.previewUrl);
      }

      // Obter URL assinada
      const url = doc.previewUrl || (await signatureService.getDocumentPreviewUrl(doc.path));
      if (url) {
        setPdfPreviewUrl(url);

        if (!doc.previewUrl) {
          setViewerDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, previewUrl: url } : d)));
        }

        if (isDocx) {
          // Resetar estados de renderização do DOCX apenas quando for renderizar de fato
          docxRenderedRef.current = false;
          docxHtmlContentRef.current = '';
          if (docxContainerRef.current) {
            docxContainerRef.current.innerHTML = '';
          }

          // Se já tivermos o blob em cache, usar ele
          if (doc.blob) {
            setDocxBlob(doc.blob);
          } else {
            const response = await fetch(url);
            const blob = await response.blob();
            setDocxBlob(blob);

            // Salvar blob em cache para evitar download repetido
            setViewerDocuments(prev => prev.map(d =>
              d.id === doc.id ? { ...d, blob } : d
            ));
          }
        } else {
          setDocxBlob(null);
          // Para imagens, 1 "página"
          if (isImg) {
            setPdfNumPages(1);
            setPdfCurrentPage(1);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar preview:', err);
      toast.error('Erro ao carregar documento');
    } finally {
      setPdfLoading(false);
      setLoadingViewerDoc(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  // Ref para evitar processamento duplicado do prefill
  const prefillProcessedRef = useRef(false);
  
  // Processar dados prefill vindos do DocumentsModule
  useEffect(() => {
    if (prefillData && !prefillProcessedRef.current) {
      prefillProcessedRef.current = true;
      console.log('📄 Recebendo documento do módulo de documentos:', prefillData);
      
      // Configurar documento principal e anexos
      setSelectedDocumentPath(prefillData.documentPath);
      setSelectedDocumentName(prefillData.documentName);
      setSelectedAttachmentPaths(prefillData.attachmentPaths || null);
      
      // Preparar lista de documentos para o visualizador
      const docs: ViewerDocument[] = [
        {
          id: 'main',
          name: prefillData.documentName,
          path: prefillData.documentPath,
          type: 'main'
        }
      ];
      
      if (prefillData.attachmentPaths && prefillData.attachmentPaths.length > 0) {
        prefillData.attachmentPaths.forEach((path, index) => {
          const name = path.split('/').pop() || `Anexo ${index + 1}`;
          docs.push({
            id: `attachment-${index}`,
            name: name,
            path: path,
            type: 'attachment'
          });
        });
      }
      setViewerDocuments(docs);
      setCurrentViewerDocIndex(0);

      setSelectedClientId(prefillData.clientId);
      setSelectedClientName(prefillData.clientName);
      
      console.log('📎 Anexos salvos no estado:', prefillData.attachmentPaths);
      
      // Detectar tipo do documento atual
      const currentDocPath = docs[0]?.path ?? '';
      const isDocx = currentDocPath.toLowerCase().endsWith('.docx');
      setIsDocxFile(isDocx);
      setIsImageFile(currentDocPath ? isImagePath(currentDocPath) : false);
      
      // Configurar signatário com dados do cliente
      setSigners([{
        id: crypto.randomUUID(),
        name: prefillData.clientName,
        email: prefillData.clientEmail || '',
        cpf: prefillData.clientCpf || '',
        role: 'Signatário',
        order: 1,
        deliveryMethod: 'email',
      }]);
      
      // Ir direto para a etapa de posicionamento
      setWizardStep('position');
      
      // Carregar preview do primeiro documento
      loadDocumentPreview(docs[0]);
      
      // Consumir parâmetros após um pequeno delay para garantir que os estados foram atualizados
      setTimeout(() => {
        if (onParamConsumed) {
          onParamConsumed();
        }
      }, 100);
    }
  }, [prefillData, onParamConsumed, toast]);
  
  // Ref para controlar se o DOCX já foi renderizado e armazenar o HTML
  const docxRenderedRef = useRef(false);
  const docxHtmlContentRef = useRef<string>('');
  const currentViewerDocIdRef = useRef<string>('main');
  const docxRenderTokenRef = useRef(0);
  
  // Renderizar DOCX quando o blob estiver disponível
  useEffect(() => {
    if (isDocxFile && docxBlob && docxContainerRef.current && !docxRenderedRef.current) {
      docxRenderedRef.current = true;
      const renderToken = ++docxRenderTokenRef.current;
      const renderDocId = currentViewerDocIdRef.current;
      
      // Adicionar estilos para separador de páginas
      const styleId = 'docx-page-break-styles';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          .docx-wrapper {
            background: #e2e8f0 !important;
            padding: 24px !important;
          }
          /* Estilo para sections (páginas) - FORÇAR A4 FIXO */
          .docx-wrapper > section,
          .docx-wrapper article,
          .docx-wrapper .docx {
            width: 794px !important; /* A4 width at 96 DPI */
            min-width: 794px !important;
            max-width: 794px !important;
            background: white !important;
            box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
            margin-bottom: 30px !important;
            border-radius: 4px !important;
            position: relative !important;
            padding: 40px !important;
            /* margin: 0 auto !important; Centralizar */
          }
          /* Centralizar o wrapper */
          .docx-wrapper {
             display: flex !important;
             flex-direction: column !important;
             align-items: center !important;
          }
          /* Separador visual entre páginas */
          .docx-wrapper > section::after,
          .docx-wrapper article::after {
            content: '— Fim da Página —' !important;
            display: block !important;
            text-align: center !important;
            padding: 16px !important;
            margin-top: 20px !important;
            color: #64748b !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            border-top: 2px dashed #cbd5e1 !important;
          }
          .docx-wrapper > section:last-child::after,
          .docx-wrapper article:last-child::after {
            content: '— Última Página —' !important;
            border-top-color: #3b82f6 !important;
            color: #3b82f6 !important;
          }
          /* Forçar quebra de página visual em elementos de quebra */
          .docx-wrapper [style*="page-break"],
          .docx-wrapper [style*="break-after"],
          .docx-wrapper [style*="break-before"] {
            margin-top: 40px !important;
            padding-top: 40px !important;
            border-top: 3px dashed #94a3b8 !important;
          }
          .docx-wrapper [style*="page-break"]::before,
          .docx-wrapper [style*="break-after"]::before,
          .docx-wrapper [style*="break-before"]::before {
            content: '📄 Nova Página' !important;
            display: block !important;
            text-align: center !important;
            color: #64748b !important;
            font-size: 11px !important;
            margin-bottom: 20px !important;
            margin-top: -30px !important;
            background: #e2e8f0 !important;
            padding: 4px 12px !important;
            width: fit-content !important;
            margin-left: auto !important;
            margin-right: auto !important;
            border-radius: 4px !important;
          }
        `;
        document.head.appendChild(style);
      }
      
      renderAsync(docxBlob, docxContainerRef.current, undefined, {
        className: 'docx-wrapper',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
      })
        .then(() => {
          // Se o usuário trocou de documento no meio do render, ignorar o resultado
          if (renderToken !== docxRenderTokenRef.current || renderDocId !== currentViewerDocIdRef.current) {
            return;
          }

          console.log('✅ DOCX renderizado com sucesso');

          const container = docxContainerRef.current;
          if (!container) {
            setPdfNumPages(1);
            return;
          }

          const wrapper = container.querySelector('.docx-wrapper');
          const sectionsEls = container.querySelectorAll('section');
          const articlesEls = container.querySelectorAll('article');
          const docxEls = container.querySelectorAll('.docx');
          const pageBreaksEls = container.querySelectorAll('[style*="page-break"], [style*="break-"]');

          console.log('📊 Estrutura do DOCX:', {
            hasWrapper: !!wrapper,
            sections: sectionsEls.length,
            articles: articlesEls.length,
            docx: docxEls.length,
            pageBreaks: pageBreaksEls.length,
            firstChildTag: container.firstElementChild?.tagName,
          });

          // Salvar o HTML renderizado para restaurar se necessário
          docxHtmlContentRef.current = container.innerHTML;

          // Contar páginas renderizadas.
          // Preferência: section/article/.docx. Fallback: estimar por altura (A4) quando vier uma única página "alta".
          const explicitPages = (sectionsEls.length || articlesEls.length || docxEls.length);
          let pageCount = explicitPages || 1;
          if (pageCount <= 1 && wrapper) {
            const wrapperEl = wrapper as HTMLElement;
            const a4Height = 1123;
            const estimated = Math.max(1, Math.ceil(wrapperEl.scrollHeight / a4Height));
            if (estimated > pageCount) pageCount = estimated;
          }
          console.log(`📄 ${pageCount} página(s) detectada(s)`);
          setPdfNumPages(pageCount);

          // Cache do HTML renderizado por documento (para trocar anexos sem recarregar)
          const html = container.innerHTML || '';
          setViewerDocuments((prev) =>
            prev.map((d) => (d.id === renderDocId ? { ...d, docxHtml: html, pageCount } : d))
          );
        })
        .catch((err: any) => {
          // Evitar que um erro antigo "trave" novos renders
          if (renderToken !== docxRenderTokenRef.current || renderDocId !== currentViewerDocIdRef.current) {
            return;
          }
          console.error('Erro ao renderizar DOCX:', err);
        });
    }
  }, [isDocxFile, docxBlob]);
  
  // Restaurar conteúdo do DOCX se foi perdido durante re-renderização
  // (React pode limpar DOM injetado por bibliotecas externas ao re-renderizar)
  useLayoutEffect(() => {
    if (wizardStep !== 'position') return;
    if (!isDocxFile) return;
    if (!docxRenderedRef.current) return;
    if (!docxContainerRef.current) return;
    if (!docxHtmlContentRef.current) return;

    // Verificar se o container está vazio mas deveria ter conteúdo
    if (docxContainerRef.current.innerHTML === '' || !docxContainerRef.current.querySelector('.docx-wrapper')) {
      console.log('🔄 Restaurando conteúdo do DOCX...');
      const prevScrollTop = viewerScrollRef.current?.scrollTop ?? 0;
      docxContainerRef.current.innerHTML = docxHtmlContentRef.current;

      // Evitar "pular" para o topo quando o DOM é restaurado
      requestAnimationFrame(() => {
        if (viewerScrollRef.current) viewerScrollRef.current.scrollTop = prevScrollTop;
      });
    }
  }, [wizardStep, isDocxFile]);

  useEffect(() => {
    if (wizardStep !== 'position') return;
    setFields((prev) => {
      let changed = false;
      const next = prev.map((f) => {
        if (f.fieldType !== 'signature') return f;
        if (f.hPercent <= FIELD_PRESETS.signature.h) return f;
        changed = true;
        return { ...f, hPercent: FIELD_PRESETS.signature.h };
      });
      return changed ? next : prev;
    });
  }, [wizardStep]);

  const filteredRequests = useMemo(() => {
    return filterSignatureRequests(requests, {
      searchTerm,
      filterStatus,
      filterPeriod,
      filterMonth,
      filterDateFrom,
      filterDateTo,
      sortOrder,
    });
  }, [requests, searchTerm, filterStatus, filterPeriod, filterMonth, filterDateFrom, filterDateTo, sortOrder]);

  const explorerItemIndex = useMemo(() => {
    const byKey = new Map<string, SignatureExplorerItem>();
    for (const item of explorerItems) {
      const key = `${item.item_type}:${item.item_id}`;
      if (!byKey.has(key)) byKey.set(key, item);
    }
    return byKey;
  }, [explorerItems]);

  const filteredRequestsByFolder = useMemo(() => {
    return filteredRequests.filter((req) => {
      const item = explorerItemIndex.get(`signature_request:${req.id}`);
      const folderId = item?.folder_id ?? null;
      return folderId === selectedFolderId;
    });
  }, [filteredRequests, explorerItemIndex, selectedFolderId]);

  const filteredGeneratedDocumentsByFolder = useMemo(() => {
    return filterGeneratedDocumentsByFolder(generatedDocuments, explorerItemIndex, searchTerm, selectedFolderId);
  }, [generatedDocuments, explorerItemIndex, searchTerm, selectedFolderId]);

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, SignatureExplorerFolder[]>();
    for (const f of explorerFolders) {
      const key = f.parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    for (const [key, arr] of map.entries()) {
      arr.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
      map.set(key, arr);
    }
    return map;
  }, [explorerFolders]);

  const foldersById = useMemo(() => {
    const map = new Map<string, SignatureExplorerFolder>();
    for (const f of explorerFolders) map.set(f.id, f);
    return map;
  }, [explorerFolders]);

  const folderPathLabelById = useMemo(() => {
    const map = new Map<string, string>();
    const compute = (id: string): string => {
      const cached = map.get(id);
      if (cached) return cached;
      const f = foldersById.get(id);
      if (!f) return '';
      const parentId = f.parent_id ?? null;
      const out = parentId ? `${compute(parentId)} / ${f.name}` : f.name;
      map.set(id, out);
      return out;
    };
    for (const f of explorerFolders) compute(f.id);
    return map;
  }, [explorerFolders, foldersById]);

  // Lista achatada (DFS) das pastas na ordem da árvore — para as abas lado a lado.
  const orderedFolders = useMemo(() => {
    const out: SignatureExplorerFolder[] = [];
    const walk = (pid: string | null) => {
      for (const f of (foldersByParent.get(pid) ?? [])) { out.push(f); walk(f.id); }
    };
    walk(null);
    return out;
  }, [foldersByParent]);

  const folderDescendantsIndex = useMemo(() => {
    const descendants = new Map<string, Set<string>>();

    const childrenMap = new Map<string | null, string[]>();
    for (const f of explorerFolders) {
      const key = f.parent_id ?? null;
      const arr = childrenMap.get(key) ?? [];
      arr.push(f.id);
      childrenMap.set(key, arr);
    }

    const compute = (id: string): Set<string> => {
      const cached = descendants.get(id);
      if (cached) return cached;
      const set = new Set<string>();
      const children = childrenMap.get(id) ?? [];
      for (const childId of children) {
        set.add(childId);
        const childDesc = compute(childId);
        for (const x of childDesc) set.add(x);
      }
      descendants.set(id, set);
      return set;
    };

    for (const f of explorerFolders) compute(f.id);
    return descendants;
  }, [explorerFolders]);

  const folderItemCountById = useMemo(() => {
    const counts = new Map<string, number>();

    for (const req of requests) {
      const item = explorerItemIndex.get(`signature_request:${req.id}`);
      const folderId = item?.folder_id ?? null;
      if (!folderId) continue;
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    }

    for (const doc of generatedDocuments) {
      const item = explorerItemIndex.get(`generated_document:${doc.id}`);
      const folderId = item?.folder_id ?? null;
      if (!folderId) continue;
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1);
    }

    // Add subtree counts (folder + descendants)
    for (const f of explorerFolders) {
      const desc = folderDescendantsIndex.get(f.id);
      if (!desc || desc.size === 0) continue;
      let total = counts.get(f.id) ?? 0;
      for (const childId of desc) {
        total += counts.get(childId) ?? 0;
      }
      counts.set(f.id, total);
    }

    return counts;
  }, [explorerFolders, explorerItemIndex, folderDescendantsIndex, generatedDocuments, requests]);

  const rootItemCount = useMemo(() => {
    let total = 0;

    for (const req of requests) {
      const item = explorerItemIndex.get(`signature_request:${req.id}`);
      const folderId = item?.folder_id ?? null;
      if (!folderId) total += 1;
    }

    for (const doc of generatedDocuments) {
      const item = explorerItemIndex.get(`generated_document:${doc.id}`);
      const folderId = item?.folder_id ?? null;
      if (!folderId) total += 1;
    }

    return total;
  }, [explorerItemIndex, generatedDocuments, requests]);

  const reloadExplorer = useCallback(async () => {
    const [foldersData, itemsData] = await Promise.all([
      signatureExplorerService.listFolders(),
      signatureExplorerService.listItems(),
    ]);
    setExplorerFolders(foldersData);
    setExplorerItems(itemsData);
  }, []);

  const canDropFolderInto = useCallback((folderId: string, newParentId: string | null) => {
    if (newParentId === null) return true;
    if (folderId === newParentId) return false;
    const desc = folderDescendantsIndex.get(folderId);
    if (desc?.has(newParentId)) return false;
    return true;
  }, [folderDescendantsIndex]);

  const handleReorderFolderDrop = useCallback(
    async (e: React.DragEvent, targetParentId: string | null, beforeId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      setFolderReorderOver(null);
      setDragOverFolderId(null);

      const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
      if (!raw) return;
      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }

      if (payload?.type !== 'folder' || typeof payload?.id !== 'string') return;
      const draggedFolderId = payload.id as string;

      const dragged = explorerFolders.find((f) => f.id === draggedFolderId);
      if (!dragged) return;

      const siblings = (foldersByParent.get(targetParentId) ?? []).slice();
      const filtered = siblings.filter((f) => f.id !== draggedFolderId);
      const beforeIndex = beforeId ? filtered.findIndex((f) => f.id === beforeId) : -1;
      const insertIndex = beforeId ? (beforeIndex >= 0 ? beforeIndex : filtered.length) : filtered.length;

      const next = filtered.slice();
      next.splice(insertIndex, 0, { ...dragged, parent_id: targetParentId } as any);

      const updates = next.map((f, idx) => ({
        id: f.id,
        parent_id: (f as any).parent_id ?? null,
        sort_order: (idx + 1) * 10,
      }));

      try {
        await Promise.all(
          updates.map((u) =>
            signatureExplorerService.updateFolder(u.id, {
              parent_id: u.parent_id,
              sort_order: u.sort_order,
            })
          )
        );
        await reloadExplorer();
      } catch (err: any) {
        toast.error(err?.message || 'Erro ao reordenar pastas');
      }
    },
    [explorerFolders, foldersByParent, reloadExplorer, toast]
  );

  const openCreateFolderModal = useCallback((parentId: string | null) => {
    setCreateFolderParentId(parentId);
    setCreateFolderName('');
    setCreateFolderModalOpen(true);
  }, []);

  const handleSubmitCreateFolder = useCallback(async () => {
    const name = createFolderName.trim();
    if (!name) return;
    try {
      setCreateFolderSaving(true);
      await signatureExplorerService.createFolder({
        name,
        parent_id: createFolderParentId,
        sort_order: 0,
        created_by: user?.id ?? null,
      });
      setCreateFolderModalOpen(false);
      await reloadExplorer();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao criar pasta');
    } finally {
      setCreateFolderSaving(false);
    }
  }, [createFolderName, createFolderParentId, reloadExplorer, toast, user?.id]);

  const handleRenameFolder = useCallback(async (folder: SignatureExplorerFolder) => {
    const name = (window.prompt('Renomear pasta:', folder.name) || '').trim();
    if (!name || name === folder.name) return;
    try {
      await signatureExplorerService.updateFolder(folder.id, { name });
      await reloadExplorer();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao renomear pasta');
    }
  }, [reloadExplorer, toast]);

  const handleMoveItemToFolder = useCallback(async (params: { itemType: 'signature_request' | 'generated_document'; itemId: string; folderId: string | null }) => {
    if (!user?.id) return;
    try {
      setMoveSaving(true);
      const explorerItem = explorerItemIndex.get(`${params.itemType}:${params.itemId}`);
      await signatureExplorerService.moveItem({
        itemType: params.itemType,
        itemId: params.itemId,
        folderId: params.folderId,
        createdBy: explorerItem?.created_by || user.id,
      });
      await reloadExplorer();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao mover item');
    } finally {
      setMoveSaving(false);
    }
  }, [explorerItemIndex, reloadExplorer, toast, user?.id]);

  const handleDeleteFolder = useCallback(async (params: { folder: SignatureExplorerFolder; mode: 'move_root' | 'delete_all' }) => {
    const folder = params.folder;
    const subtreeIds = new Set<string>([folder.id]);
    const descendants = folderDescendantsIndex.get(folder.id);
    if (descendants) {
      for (const x of descendants) subtreeIds.add(x);
    }

    const itemsInSubtree = explorerItems.filter((it) => (it.folder_id ? subtreeIds.has(it.folder_id) : false));
    const ownedItems = user?.id ? itemsInSubtree.filter((it) => it.created_by === user.id) : [];

    try {
      setDeleteFolderSaving(params.mode);
      if (params.mode === 'delete_all' && user?.id) {
        let archivedReq = 0;
        let deletedDocs = 0;

        for (const it of ownedItems) {
          if (it.item_type === 'signature_request') {
            try {
              await signatureService.archiveRequest(it.item_id);
              archivedReq += 1;
            } catch {
              // ignore
            }
          }
          if (it.item_type === 'generated_document') {
            try {
              await documentTemplateService.deleteGeneratedDocument(it.item_id);
              deletedDocs += 1;
            } catch {
              // ignore
            }
          }
          try {
            await signatureExplorerService.deleteItem({ itemType: it.item_type, itemId: it.item_id, createdBy: user.id });
          } catch {
            // ignore
          }
        }

        if (itemsInSubtree.length > ownedItems.length) {
          toast.error('Alguns itens não foram removidos (você só pode remover itens que você criou). Eles irão para "Sem pasta".');
        }

        if (archivedReq || deletedDocs) {
          toast.success(`Remoção concluída: ${archivedReq} assinatura(s) removida(s) do painel, ${deletedDocs} documento(s) excluído(s).`);
        }
      }

      await signatureExplorerService.deleteFolder(folder.id);
      setDeleteFolderTarget(null);
      if (selectedFolderId && subtreeIds.has(selectedFolderId)) {
        setSelectedFolderId(null);
      }
      await reloadExplorer();
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao remover pasta');
    } finally {
      setDeleteFolderSaving(null);
    }
  }, [documentTemplateService, explorerItems, folderDescendantsIndex, loadData, reloadExplorer, selectedFolderId, toast, user?.id]);

  const handleMoveFolder = useCallback(async (folderId: string, newParentId: string | null) => {
    if (!canDropFolderInto(folderId, newParentId)) {
      toast.error('Movimento inválido');
      return;
    }
    try {
      await signatureExplorerService.updateFolder(folderId, { parent_id: newParentId });
      await reloadExplorer();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao mover pasta');
    }
  }, [canDropFolderInto, reloadExplorer, toast]);

  const handleDropOnFolder = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    setDragOverFolderId(null);
    setIsDraggingExplorer(false);
    setDraggingExplorer(null);
    setFolderReorderOver(null);
    if (dragImageElRef.current) {
      try {
        document.body.removeChild(dragImageElRef.current);
      } catch {
        // ignore
      }
      dragImageElRef.current = null;
    }
    const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload?.type === 'folder') {
      if (typeof payload?.id !== 'string') return;
      // Pastas não são movidas/aninhadas por drop.
      // Reordenação de pastas é feita exclusivamente pelo modo "Organizar" via handleReorderFolderDrop.
      return;
    }

    if (payload?.type === 'item') {
      if (!user?.id) return;
      const itemType = payload?.item_type as 'signature_request' | 'generated_document' | undefined;
      const itemId = payload?.item_id as string | undefined;
      if (!itemType || !itemId) return;

      if (itemType === 'signature_request' && Array.isArray(payload?.selected_request_ids) && payload.selected_request_ids.length > 1) {
        const selectedIds = (payload.selected_request_ids as any[]).filter((x: any): x is string => typeof x === 'string');
        const uniqueIds: string[] = Array.from(new Set(selectedIds));
        if (uniqueIds.length <= 1) {
          await handleMoveItemToFolder({ itemType, itemId, folderId: targetFolderId });
          return;
        }

        const selected = uniqueIds
          .map((id: string) => requests.find((r) => r.id === id))
          .filter(Boolean) as SignatureRequestWithSigners[];

        try {
          await Promise.all(
            selected.map((r) =>
              signatureExplorerService.moveItem({
                itemType: 'signature_request',
                itemId: r.id,
                folderId: targetFolderId,
                createdBy: r.created_by || user.id,
              })
            )
          );
          await reloadExplorer();
        } finally {
          // ignore
        }
        return;
      }

      await handleMoveItemToFolder({ itemType, itemId, folderId: targetFolderId });
    }
  }, [handleMoveFolder, handleMoveItemToFolder, reloadExplorer, requests, toast, user?.id]);

  const handleAllowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch {
      // ignore
    }
  };

  const handleFolderDragEnter = useCallback((folderId: string | null) => {
    setDragOverFolderId(folderId);
  }, []);

  const handleFolderDragLeave = useCallback((e: React.DragEvent, folderId: string | null) => {
    const related = (e as any).relatedTarget as Node | null | undefined;
    if (related && e.currentTarget && (e.currentTarget as any).contains?.(related)) return;
    setDragOverFolderId((prev) => (prev === folderId ? null : prev));
  }, []);

  const setExplorerDragData = (e: React.DragEvent, payload: any, sourceElement?: HTMLElement) => {
    const data = JSON.stringify(payload);
    e.dataTransfer.setData('application/json', data);
    e.dataTransfer.setData('text/plain', data);
    e.dataTransfer.effectAllowed = 'move';
    setIsDraggingExplorer(true);
    suppressExplorerClickRef.current = true;

    if (payload?.type === 'folder' && typeof payload?.id === 'string') {
      setDraggingExplorer({ type: 'folder', id: payload.id });
    } else if (payload?.type === 'item' && typeof payload?.item_id === 'string') {
      setDraggingExplorer({ type: 'item', id: payload.item_id, itemType: payload?.item_type });
    }

    try {
      if (dragImageElRef.current) {
        try {
          document.body.removeChild(dragImageElRef.current);
        } catch {
          // ignore
        }
        dragImageElRef.current = null;
      }

      let ghost: HTMLElement;

      if (sourceElement) {
        ghost = sourceElement.cloneNode(true) as HTMLElement;
        ghost.style.position = 'fixed';
        ghost.style.top = '0px';
        ghost.style.left = '0px';
        ghost.style.transform = 'translate(-9999px, -9999px) rotate(-2deg)';
        ghost.style.width = `${sourceElement.offsetWidth}px`;
        ghost.style.height = `${sourceElement.offsetHeight}px`;
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '999999';
        ghost.style.opacity = '0.95';
        ghost.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.4)';
      } else {
        ghost = document.createElement('div');
        ghost.style.position = 'fixed';
        ghost.style.top = '0px';
        ghost.style.left = '0px';
        ghost.style.transform = 'translate(-9999px, -9999px)';
        ghost.style.padding = '10px 12px';
        ghost.style.borderRadius = '14px';
        ghost.style.background = 'rgba(15, 23, 42, 0.92)';
        ghost.style.color = 'white';
        ghost.style.fontSize = '12px';
        ghost.style.fontWeight = '600';
        ghost.style.boxShadow = '0 18px 40px rgba(0,0,0,0.25)';
        ghost.style.maxWidth = '320px';
        ghost.style.whiteSpace = 'nowrap';
        ghost.style.overflow = 'hidden';
        ghost.style.textOverflow = 'ellipsis';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '999999';
        ghost.textContent = 'Movendo...';
      }

      document.body.appendChild(ghost);
      dragImageElRef.current = ghost as HTMLDivElement;

      const offsetX = sourceElement ? sourceElement.offsetWidth / 2 : 16;
      const offsetY = sourceElement ? sourceElement.offsetHeight / 2 : 14;
      e.dataTransfer.setDragImage(ghost, offsetX, offsetY);
    } catch {
      // ignore
    }
  };

  const releaseSuppressExplorerClick = () => {
    // Delay to avoid click firing right after dragend/drop
    window.setTimeout(() => {
      suppressExplorerClickRef.current = false;
    }, 0);
  };

  useEffect(() => {
    const onDocClick = () => setContextMenu(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // Liga/desliga o modo "Organizar" (reordenar pastas via drag), limpando estados de drag.
  const toggleFolderReorder = useCallback(() => {
    setFolderReorderMode((prev) => {
      const next = !prev;
      if (!next) {
        setIsDraggingExplorer(false);
        setDraggingExplorer(null);
        setDragOverFolderId(null);
        setFolderReorderOver(null);
      }
      return next;
    });
  }, []);



  useEffect(() => {
    pruneSelectedIds(filteredRequests.map((r) => r.id));
  }, [filteredRequests, pruneSelectedIds]);

  const selectAllFilteredRequests = () => {
    selectIds(filteredRequests.map((r) => r.id));
  };

  const selectAllInFolder = () => {
    if (!selectedFolderId) return;
    const folderItems = filteredRequestsByFolder.map((r) => r.id);
    selectIds(folderItems);
  };

  const deleteSelectedRequests = async () => {
    if (selectedRequestIds.size === 0) return;

    const confirmed = await confirmDelete({
      title: 'Remover documentos selecionados',
      message: `Você tem certeza que deseja remover ${selectedRequestIds.size} documento(s) do painel? Os links de assinatura serão invalidados.`,
      confirmLabel: 'Remover',
    });
    if (!confirmed) return;

    try {
      setBulkDeleteLoading(true);
      const ids = Array.from(selectedRequestIds);
      for (const id of ids) {
        await signatureService.archiveRequest(id);
      }
      toast.success('Documentos removidos do painel.');
      clearSelectedIds();
      detailsRequestIdRef.current = null;
      setDetailsRequest(null);
      loadData();
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao excluir selecionados');
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const revokeIfBlobUrl = (url?: string | null) => {
    if (!url) return;
    if (!url.startsWith('blob:')) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // noop
    }
  };

  const cleanupLocalViewerUrls = (docs: ViewerDocument[], extraUrls: string[]) => {
    for (const d of docs) revokeIfBlobUrl(d.previewUrl);
    for (const u of extraUrls) revokeIfBlobUrl(u);
  };

  const buildViewerDocumentsFromUploads = (files: File[]): ViewerDocument[] => {
    return files.map((f, idx) => {
      const isMain = idx === 0;
      const attachmentIndex = Math.max(0, idx - 1);
      return {
        id: isMain ? 'main' : `attachment-${attachmentIndex}`,
        name: f.name,
        path: f.name,
        type: isMain ? 'main' : 'attachment',
        blob: f,
        previewUrl: URL.createObjectURL(f),
      };
    });
  };

  const resetWizard = () => {
    cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
    setWizardStep('list');
    setSelectedDocumentId(''); setSelectedDocumentName(''); setSelectedDocumentPath('');
    setSelectedAttachmentPaths(null);
    setSelectedClientId(null); setSelectedClientName(null);
    setUploadedFile(null);
    setUploadedFiles([]);
    setSelectedGenDocIds([]);
    setGenDocsSearchTerm('');
    clearSelectedUploadFileIndexes();
    setSigners([{ id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Signatário', order: 1, deliveryMethod: 'email' }]);
    setSignerOrder('none');
    setFields([]); setPdfPreviewUrl(null); setCreatedRequest(null);
    setPdfPreviewUrls([]); setPdfNumPagesByDoc({});
    setIsDocxFile(false); setIsImageFile(false); setDocxBlob(null);
    setViewerDocuments([]); // Limpar documentos do viewer
    setCurrentViewerDocIndex(0); // Resetar índice
    docxRenderedRef.current = false; // Resetar flag de renderização do DOCX
    docxHtmlContentRef.current = ''; // Resetar HTML do DOCX
    prefillProcessedRef.current = false; // Resetar flag de prefill
    setSettings({ requireCpf: false, allowRefusal: true, blockAfterDeadline: false, expiresAt: '', authMethod: 'signature_only' });
    settingsService.getSignatureModuleConfig().then(cfg => {
      const map: Record<string, SignerAuthMethod> = {
        'Só assinatura': 'signature_only',
        'Assinatura + Validação Facial': 'signature_facial',
        'Assinatura + Facial + Documento': 'signature_facial_document',
        signature_only: 'signature_only', signature_facial: 'signature_facial', signature_facial_document: 'signature_facial_document',
      };
      const m = map[cfg.default_auth_method];
      if (m) setSettings(prev => ({ ...prev, authMethod: m }));
      if (Array.isArray(cfg.auth_methods) && cfg.auth_methods.length > 0) {
        const all: Array<{ value: SignerAuthMethod; label: string }> = [
          { value: 'signature_only',          label: 'Só assinatura' },
          { value: 'signature_facial',         label: 'Assinatura + Validação Facial' },
          { value: 'signature_facial_document',label: 'Assinatura + Facial + Documento' },
        ];
        const enabled = all.filter(opt => cfg.auth_methods.includes(opt.label) || cfg.auth_methods.includes(opt.value));
        if (enabled.length > 0) setAvailableAuthMethods(enabled);
      }
    }).catch(() => {/* mantém fallback */});
  };

  const handleFileSelect = (file: File) => {
    if (!file.type.includes('pdf')) { toast.error('Selecione um arquivo PDF'); return; }
    setUploadedFile(file); setSelectedDocumentName(file.name); setSelectedDocumentId('');
    setSelectedDocumentPath('');
    setSelectedClientId(null);
    setSelectedClientName(null);
    setUploadedFiles([file]);
    clearSelectedUploadFileIndexes();
  };

  // Múltiplos arquivos (envelope)
  const handleFilesSelect = (fileList: FileList) => {
    const files = Array.from(fileList).filter((f) => f.type.includes('pdf'));
    if (files.length === 0) { toast.error('Selecione arquivos PDF'); return; }

    cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);

    setUploadedFiles(files);
    clearSelectedUploadFileIndexes();
    setUploadedFile(files[0]);
    setSelectedDocumentName(files[0].name);
    setSelectedDocumentId('');
    setSelectedDocumentPath('');
    setSelectedClientId(null);
    setSelectedClientName(null);
    setSelectedGenDocIds([]);

    const docs = buildViewerDocumentsFromUploads(files);
    setViewerDocuments(docs);
    setCurrentViewerDocIndex(0);
    setPdfPreviewUrl(docs[0]?.previewUrl || null);
    setPdfPreviewUrls([]);
    setPdfNumPagesByDoc({});
  };

  const clearUploadedFiles = () => {
    cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
    setUploadedFiles([]);
    setUploadedFile(null);
    setSelectedDocumentName('');
    setSelectedDocumentId('');
    setSelectedDocumentPath('');
    setSelectedGenDocIds([]);
    setViewerDocuments([]);
    setCurrentViewerDocIndex(0);
    setPdfPreviewUrl(null);
    setPdfPreviewUrls([]);
    setPdfNumPagesByDoc({});
    clearSelectedUploadFileIndexes();
  };

  const selectAllUploadedFiles = () => {
    selectUploadFileIndexes(uploadedFiles.map((_, i) => i));
  };

  const removeUploadedFilesByIndexes = (indexes: Set<number>) => {
    if (indexes.size === 0) return;

    setUploadedFiles((prev) => {
      const next = prev.filter((_, i) => !indexes.has(i));

      cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);

      if (next.length === 0) {
        setUploadedFile(null);
        setSelectedDocumentName('');
        setViewerDocuments([]);
        setCurrentViewerDocIndex(0);
        setPdfPreviewUrl(null);
        setPdfPreviewUrls([]);
        setPdfNumPagesByDoc({});
        clearSelectedUploadFileIndexes();
        return next;
      }

      setUploadedFile(next[0]);
      setSelectedDocumentName(next[0].name);
      const docs = buildViewerDocumentsFromUploads(next);
      setViewerDocuments(docs);
      setCurrentViewerDocIndex(0);
      setPdfPreviewUrl(docs[0]?.previewUrl || null);
      setPdfPreviewUrls([]);
      setPdfNumPagesByDoc({});
      clearSelectedUploadFileIndexes();
      return next;
    });
  };

  const moveUploadedFileAt = (index: number, direction: 'up' | 'down') => {
    setUploadedFiles((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      setUploadedFile(next[0]);
      setSelectedDocumentName(next[0].name);
      cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
      const docs = buildViewerDocumentsFromUploads(next);
      setViewerDocuments(docs);
      setCurrentViewerDocIndex(0);
      setPdfPreviewUrl(docs[0]?.previewUrl || null);
      setPdfPreviewUrls([]);
      setPdfNumPagesByDoc({});
      return next;
    });
  };

  const removeUploadedFileAt = (index: number) => {
    setUploadedFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
        setUploadedFile(null);
        setSelectedDocumentName('');
        setViewerDocuments([]);
        setCurrentViewerDocIndex(0);
        setPdfPreviewUrl(null);
        setPdfPreviewUrls([]);
        setPdfNumPagesByDoc({});
      } else if (index === 0) {
        setUploadedFile(next[0]);
        setSelectedDocumentName(next[0].name);

        cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
        const docs = buildViewerDocumentsFromUploads(next);
        setViewerDocuments(docs);
        setCurrentViewerDocIndex(0);
        setPdfPreviewUrl(docs[0]?.previewUrl || null);
        setPdfPreviewUrls([]);
        setPdfNumPagesByDoc({});
      } else {
        cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
        const docs = buildViewerDocumentsFromUploads(next);
        setViewerDocuments(docs);
        setCurrentViewerDocIndex(0);
        setPdfPreviewUrl(docs[0]?.previewUrl || null);
        setPdfPreviewUrls([]);
        setPdfNumPagesByDoc({});
      }
      return next;
    });
    setSelectedUploadFileIndexes((prev) => {
      if (!prev.size) return prev;
      const next = new Set<number>();
      for (const i of prev) {
        if (i === index) continue;
        if (i > index) next.add(i - 1);
        else next.add(i);
      }
      return next;
    });
  };

  const handleSelectGeneratedDoc = async (doc: GeneratedDocument) => {
    setSelectedDocumentId(doc.id);
    setSelectedDocumentName(doc.file_name || doc.template_name);
    setSelectedDocumentPath(doc.file_path || '');
    setSelectedClientId(doc.client_id || null);
    setSelectedClientName(doc.client_name || null);
    setUploadedFile(null);
    setUploadedFiles([]);
    setSelectedGenDocIds([doc.id]);
    setSelectedAttachmentPaths(null);
    if (doc.file_path) {
      try { const url = await documentTemplateService.getGeneratedDocumentSignedUrl(doc); setPdfPreviewUrl(url); } catch {}
    }
    
    // Carregar campos de assinatura do template original
    if (doc.template_id) {
      try {
        const template = await documentTemplateService.getTemplate(doc.template_id);
        if (template?.signature_field_config) {
          const config = template.signature_field_config;
          const configArray = Array.isArray(config) ? config : [config];
          
          // Converter configuração do template para DraftField
          const loadedFields: DraftField[] = configArray
            .filter(c => c !== null)
            .map((c, idx) => ({
              localId: crypto.randomUUID(),
              signerId: signers[0]?.id || '', // Associar ao primeiro signatário por padrão
              fieldType: 'signature' as SignatureFieldType,
              pageNumber: c.page || 1,
              xPercent: c.x_percent || 0,
              yPercent: c.y_percent || 0,
              wPercent: c.width_percent || FIELD_PRESETS.signature.w,
              hPercent: c.height_percent || FIELD_PRESETS.signature.h,
              documentId: 'main', // Padrão: documento principal
            }));
          
          if (loadedFields.length > 0) {
            setFields(loadedFields);
            toast.success(`${loadedFields.length} campo(s) de assinatura carregado(s) do template`);
          }
        }
      } catch (e) {
        console.warn('Erro ao carregar campos do template:', e);
      }
    }
  };

  // Multi-seleção de documentos gerados (para o step de upload)
  const toggleGenDocInSelection = async (doc: GeneratedDocument) => {
    // Limpar arquivos enviados localmente
    if (uploadedFiles.length > 0 || uploadedFile) {
      cleanupLocalViewerUrls(viewerDocuments, pdfPreviewUrls);
      setUploadedFiles([]);
      setUploadedFile(null);
      setPdfPreviewUrls([]);
      setPdfNumPagesByDoc({});
      clearSelectedUploadFileIndexes();
    }

    setSelectedGenDocIds((prev) => {
      const alreadyIn = prev.includes(doc.id);
      const next = alreadyIn ? prev.filter((id) => id !== doc.id) : [...prev, doc.id];

      if (next.length === 0) {
        // Nenhum selecionado — limpar tudo
        setSelectedDocumentId('');
        setSelectedDocumentName('');
        setSelectedDocumentPath('');
        setSelectedAttachmentPaths(null);
        setSelectedClientId(null);
        setSelectedClientName(null);
        setViewerDocuments([]);
        setCurrentViewerDocIndex(0);
        setPdfPreviewUrl(null);
        setFields([]);
        return next;
      }

      // Primeiro = documento principal
      const mainId = next[0];
      const mainDoc = generatedDocuments.find((d) => d.id === mainId);
      if (mainDoc) {
        setSelectedDocumentId(mainDoc.id);
        setSelectedDocumentName(mainDoc.file_name || mainDoc.template_name);
        setSelectedDocumentPath(mainDoc.file_path || '');
        setSelectedClientId(mainDoc.client_id || null);
        setSelectedClientName(mainDoc.client_name || null);
      }

      // Restantes = anexos
      const attachmentDocs = next
        .slice(1)
        .map((id) => generatedDocuments.find((d) => d.id === id))
        .filter(Boolean) as GeneratedDocument[];
      const attachPaths = attachmentDocs
        .map((d) => d.file_path || '')
        .filter(Boolean);
      setSelectedAttachmentPaths(attachPaths.length > 0 ? attachPaths : null);

      // Montar viewerDocuments
      const docs: ViewerDocument[] = [];
      if (mainDoc?.file_path) {
        docs.push({ id: 'main', name: mainDoc.file_name || mainDoc.template_name, path: mainDoc.file_path, type: 'main' });
      }
      attachmentDocs.forEach((d, i) => {
        if (d.file_path) {
          docs.push({ id: `attachment-${i}`, name: d.file_name || d.template_name, path: d.file_path, type: 'attachment' });
        }
      });
      setViewerDocuments(docs);
      setCurrentViewerDocIndex(0);
      setPdfPreviewUrl(null);

      // Carregar campos do template apenas se o doc principal mudou
      const mainChanged = !alreadyIn || mainId !== prev[0];
      if (mainChanged && mainDoc?.template_id) {
        documentTemplateService.getTemplate(mainDoc.template_id).then((template) => {
          if (!template?.signature_field_config) return;
          const config = template.signature_field_config;
          const configArray = Array.isArray(config) ? config : [config];
          const loadedFields: DraftField[] = configArray
            .filter((c) => c !== null)
            .map((c) => ({
              localId: crypto.randomUUID(),
              signerId: signers[0]?.id || '',
              fieldType: 'signature' as SignatureFieldType,
              pageNumber: c.page || 1,
              xPercent: c.x_percent || 0,
              yPercent: c.y_percent || 0,
              wPercent: c.width_percent || FIELD_PRESETS.signature.w,
              hPercent: c.height_percent || FIELD_PRESETS.signature.h,
              documentId: 'main',
            }));
          if (loadedFields.length > 0) {
            setFields(loadedFields);
            toast.success(`${loadedFields.length} campo(s) de assinatura carregado(s) do template`);
          }
        }).catch((e) => console.warn('Erro ao carregar campos do template:', e));
      }

      return next;
    });
  };

  const addSigner = () => {
    setSigners((prev) => [...prev, { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Signatário', order: prev.length + 1, deliveryMethod: 'email' }]);
  };

  const removeSigner = (id: string) => { if (signers.length > 1) setSigners((prev) => prev.filter((s) => s.id !== id)); };

  const updateSigner = (id: string, field: keyof DraftSigner, value: string | number) => {
    setSigners((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  useEffect(() => {
    if (wizardStep === 'position' && !pdfPreviewUrl && uploadedFile) {
      setPdfPreviewUrl(URL.createObjectURL(uploadedFile));
    }
  }, [wizardStep, pdfPreviewUrl, uploadedFile]);

  // Gerar URLs para múltiplos PDFs quando entrar no passo position
  useEffect(() => {
    if (wizardStep === 'position' && uploadedFiles.length > 0 && pdfPreviewUrls.length === 0) {
      const urls = uploadedFiles.map((f) => URL.createObjectURL(f));
      setPdfPreviewUrls(urls);
      setPdfNumPagesByDoc({});
    }
  }, [wizardStep, uploadedFiles, pdfPreviewUrls.length]);

  useEffect(() => {
    if (wizardStep !== 'position') return;
    if (selectedDocumentId || selectedDocumentPath) return;
    if (uploadedFiles.length === 0) return;

    if (viewerDocuments.length === 0) {
      const docs = buildViewerDocumentsFromUploads(uploadedFiles);
      setViewerDocuments(docs);
      setCurrentViewerDocIndex(0);
      // Evitar chamada duplicada
      if (documentLoadedRef.current !== docs[0].id) {
        documentLoadedRef.current = docs[0].id;
        loadDocumentPreview(docs[0]);
      }
      return;
    }

    const currentDoc = viewerDocuments[currentViewerDocIndex];
    // Evitar loop: só atualizar se realmente mudou e não está carregando
    if (currentDoc?.previewUrl && currentDoc.previewUrl !== pdfPreviewUrl && documentLoadedRef.current !== currentDoc.id) {
      documentLoadedRef.current = currentDoc.id;
      setPdfPreviewUrl(currentDoc.previewUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep]);

  useEffect(() => {
    if (!pdfPreviewUrl) return;
    setPdfLoading(true);
    setPdfNumPages(0);
    setPdfCurrentPage(1);
    setPdfScale(1);
    setPdfAutoFitEnabled(true);
    setPdfViewMode('fit');
  }, [pdfPreviewUrl]);

  // SOLUÇÃO DEFINITIVA: Auto-fit apenas UMA VEZ no carregamento inicial.
  // Depois disso, a escala só muda via botões de zoom manuais.
  // Isso elimina 100% dos reloads/flickers causados por ResizeObserver ou mudanças de estado.
  const initialFitAppliedRef = useRef(false);
  
  const applyInitialFit = useCallback(() => {
    if (initialFitAppliedRef.current) return;
    if (!viewerScrollRef.current) return;
    
    const el = viewerScrollRef.current;
    const styles = window.getComputedStyle(el);
    const padX = (parseFloat(styles.paddingLeft || '0') || 0) + (parseFloat(styles.paddingRight || '0') || 0);
    const padY = (parseFloat(styles.paddingTop || '0') || 0) + (parseFloat(styles.paddingBottom || '0') || 0);

    const availableW = Math.max(0, el.clientWidth - padX);
    const availableH = Math.max(0, el.clientHeight - padY);

    const baseW = isDocxFile ? 794 : 595;
    const baseH = isDocxFile ? 1123 : 842;

    if (!availableW || !availableH) return;

    const fitScale = Math.min(availableW / baseW, availableH / baseH);
    const clamped = Math.max(0.5, Math.min(1.4, fitScale));
    
    setPdfScale(clamped);
    setPdfViewMode('fit');
    initialFitAppliedRef.current = true;
  }, [isDocxFile]);

  const scrollToPdfPage = useCallback((pageNumber: number) => {
    if (!viewerScrollRef.current || !pdfContainerRef.current) return;
    const targetPage = pdfContainerRef.current.querySelector(`[data-pdf-page-number="${pageNumber}"]`) as HTMLElement | null;
    if (!targetPage) return;

    const containerRect = viewerScrollRef.current.getBoundingClientRect();
    const pageRect = targetPage.getBoundingClientRect();
    const nextTop = viewerScrollRef.current.scrollTop + (pageRect.top - containerRect.top) - 24;

    viewerScrollRef.current.scrollTo({
      top: Math.max(0, nextTop),
      behavior: 'smooth',
    });
  }, []);

  // Aplicar fit inicial apenas uma vez quando o documento carrega
  useLayoutEffect(() => {
    if (wizardStep !== 'position') return;
    if (!pdfAutoFitEnabled) return;
    if (initialFitAppliedRef.current) return;
    
    // Pequeno delay para garantir que o container está renderizado
    const timer = setTimeout(applyInitialFit, 100);
    return () => clearTimeout(timer);
  }, [applyInitialFit, pdfAutoFitEnabled, wizardStep]);

  // Reset do flag quando muda de documento
  useEffect(() => {
    initialFitAppliedRef.current = false;
  }, [pdfPreviewUrl]);

  // Entrar no passo de posicionamento com "Adicionar campo" ativo por padrão
  useEffect(() => {
    if (wizardStep !== 'position') return;
    setPositionMode('place');
    setIsPlacingField(true);
  }, [wizardStep]);

  const handlePdfLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setPdfNumPages(numPages);
    setPdfLoading(false);
    // Travar auto-fit após carregamento inicial para evitar re-renders durante edição
    setPdfAutoFitEnabled(false);
  }, []);

  const handlePdfLoadError = useCallback((err: any) => {
    console.error('Erro ao carregar PDF:', err);
    setPdfLoading(false);
    toast.error('Erro ao carregar o PDF');
  }, [toast]);

  // SOLUÇÃO DEFINITIVA: Renderizar PDF em escala fixa (1.0) e aplicar zoom via CSS transform.
  // Isso evita que o react-pdf recarregue o documento inteiro quando a escala muda.
  const pdfPagesNode = useMemo(() => {
    if (isDocxFile || !pdfPreviewUrl) return null;

    return (
      <Document
        file={pdfPreviewUrl}
        onLoadSuccess={handlePdfLoadSuccess}
        onLoadError={handlePdfLoadError}
        loading={null}
      >
        {Array.from({ length: pdfNumPages || 1 }, (_, index) => {
          const pageNumber = index + 1;
          return (
            <div key={pageNumber} data-pdf-page-number={pageNumber} className="relative bg-white shadow-xl rounded-lg overflow-hidden">
              <Page
                pageNumber={pageNumber}
                scale={1}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />

              {fields.filter(f => 
                f.fieldType === 'signature' &&
                f.documentId === (viewerDocuments[currentViewerDocIndex]?.id || 'main') &&
                f.pageNumber === pageNumber
              ).map((field) => {
                const preset = FIELD_PRESETS[field.fieldType];
                const signer = signers.find(s => s.id === field.signerId);
                const signerIndex = signers.findIndex(s => s.id === field.signerId);
                const signerColor = ['#3B82F6', '#EF4444', '#10B981', '#8B5CF6', '#F59E0B'][signerIndex % 5];
                const isSignature = field.fieldType === 'signature';

                return (
                  <div
                    key={field.localId}
                    className="absolute cursor-move border-2 rounded-md flex items-center justify-center transition-shadow hover:shadow-lg"
                    style={{
                      left: `${field.xPercent}%`,
                      top: `${field.yPercent}%`,
                      width: `${field.wPercent}%`,
                      height: `${field.hPercent}%`,
                      borderColor: signerColor,
                      backgroundColor: isSignature ? `${signerColor}08` : `${signerColor}20`,
                      borderStyle: isSignature ? 'dashed' : 'solid',
                    }}
                    onMouseDown={(e) => startDragging(e, field)}
                  >
                    <div className="flex items-center justify-center w-full h-full relative group px-3 py-2 overflow-hidden rounded-[20px]">
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md z-10" style={{ backgroundColor: signerColor }}>
                        {signerIndex + 1}
                      </div>

                      {isSignature ? (
                        <div className="w-full h-full rounded-[16px] border border-white/70 bg-[#f8f7f5]/92 backdrop-blur-sm shadow-[0_10px_30px_-18px_rgba(0,0,0,0.28)] px-3 py-1 flex items-center gap-3">
                          <div
                            className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center shadow-sm"
                            style={{ backgroundColor: `${signerColor}18`, color: signerColor }}
                          >
                            <FileSignature className="w-3 h-3" />
                          </div>
                          <div className="min-w-0 flex-1 flex flex-col items-start justify-center leading-tight">
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: signerColor }}>
                              Assinatura
                            </span>
                            <span className="text-[9px] text-slate-500 truncate max-w-full">
                              {signer?.name || 'Signatário'}
                            </span>
                          </div>
                          <div
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-semibold border bg-[#f8f7f5]/95"
                            style={{ color: signerColor, borderColor: `${signerColor}35` }}
                          >
                            Assinar
                          </div>
                        </div>
                      ) : (
                        <>
                          <preset.icon className="w-4 h-4" style={{ color: signerColor }} />
                          <span className="text-xs font-medium" style={{ color: signerColor }}>{preset.label}</span>
                        </>
                      )}

                      <span className="absolute bottom-1 left-1 text-[8px] font-bold px-2 py-0.5 rounded-full bg-[#f8f7f5] shadow-sm border border-slate-100" style={{ color: signerColor }}>
                        {signer?.name || 'Signatário'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeField(field.localId);
                      }}
                      className={
                        isSignature
                          ? 'absolute top-1 left-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors'
                          : 'absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors'
                      }
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </Document>
    );
  }, [currentViewerDocIndex, fields, handlePdfLoadError, handlePdfLoadSuccess, isDocxFile, pdfNumPages, pdfPreviewUrl, signers]);

  // Estado simplificado para posicionamento
  const [positionMode, setPositionMode] = useState<'select' | 'place'>('select');
  const [currentSignerIndex, setCurrentSignerIndex] = useState(0);
  const [currentFieldType, setCurrentFieldType] = useState<SignatureFieldType>('signature');
  const [isPlacingField, setIsPlacingField] = useState(false);
  const suppressNextPlacementClickRef = useRef(false);
  const dragMovedRef = useRef(false);

  // Forçar apenas campo de assinatura (UI e lógica)
  useEffect(() => {
    if (wizardStep !== 'position') return;
    if (currentFieldType !== 'signature') setCurrentFieldType('signature');
  }, [wizardStep, currentFieldType]);

  // Função auxiliar para obter coordenadas relativas ao PDF/DOCX
  const getPdfCoordinates = (e: React.MouseEvent) => {
    // Para DOCX, usar o elemento da página (section/article) específico
    if (isDocxFile && docxContainerRef.current) {
      const target = e.target as HTMLElement;

      const wrapper = docxContainerRef.current.querySelector('.docx-wrapper') || docxContainerRef.current;
      const explicitPages = Array.from(wrapper.querySelectorAll('section, article')) as HTMLElement[];
      const hasMultipleExplicitPages = explicitPages.length > 1;

      if (hasMultipleExplicitPages) {
        const pageEl = (target.closest('section') || target.closest('article')) as HTMLElement | null;
        if (!pageEl) {
          console.warn('Clique fora da área da página');
          return null;
        }

        const rect = pageEl.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        const pageIndex = explicitPages.indexOf(pageEl);
        const pageNumber = pageIndex >= 0 ? pageIndex + 1 : 1;
        return { x, y, rect, pageNumber };
      }

      // Fallback robusto: tratar como páginas virtuais A4 dentro do conteúdo.
      // Preferir .docx (conteúdo) ao wrapper (que pode ter padding/fundo).
      const baseEl = (wrapper.querySelector('.docx') as HTMLElement | null) || (wrapper as HTMLElement);
      const rect = baseEl.getBoundingClientRect();

      const a4Ratio = 1123 / 794;
      const pageHeightPx = rect.width * a4Ratio;

      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      const pageNumber = Math.max(1, Math.floor(relY / pageHeightPx) + 1);
      const yInPage = relY - (pageNumber - 1) * pageHeightPx;

      const x = (relX / rect.width) * 100;
      const y = (yInPage / pageHeightPx) * 100;

      return { x, y, rect, pageNumber };
    }
    
    // Para PDF, usar o container do react-pdf
    if (!pdfContainerRef.current) return null;
    const target = e.target as HTMLElement;
    const pdfPageWrapper = target.closest('[data-pdf-page-number]') as HTMLElement | null;
    const pdfElement = (pdfPageWrapper?.querySelector('.react-pdf__Page') || pdfPageWrapper || pdfContainerRef.current.querySelector('.react-pdf__Page')) as HTMLElement | null;
    if (!pdfElement) return null;
    
    const rect = pdfElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const pageNumberAttr = pdfPageWrapper?.getAttribute('data-pdf-page-number');
    const pageNumber = pageNumberAttr ? Number(pageNumberAttr) || 1 : pdfCurrentPage;
    
    return { x, y, rect, pageNumber };
  };

  // Adicionar campo na posição clicada
  const addFieldAtPosition = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Desativar auto-fit ao interagir manualmente para evitar flickering/reload
    if (pdfAutoFitEnabled) {
      setPdfAutoFitEnabled(false);
      setPdfViewMode('manual');
    }

    console.log('🖱️ addFieldAtPosition chamado', { isPlacingField, positionMode, isDocxFile });

    if (suppressNextPlacementClickRef.current) {
      console.log('⛔ Clique ignorado após drag');
      suppressNextPlacementClickRef.current = false;
      return;
    }
    
    if (!isPlacingField || positionMode !== 'place') {
      console.log('❌ Não está em modo de posicionamento');
      return;
    }
    
    const coords = getPdfCoordinates(e);
    console.log('📍 Coordenadas:', coords);
    if (!coords) {
      console.log('❌ Não foi possível obter coordenadas');
      return;
    }
    
    const currentSigner = signers[currentSignerIndex];
    if (!currentSigner) {
      console.log('❌ Signatário não encontrado');
      return;
    }
    
    const preset = FIELD_PRESETS.signature;
    
    // Identificar o documento atual
    const currentDoc = viewerDocuments[currentViewerDocIndex];
    const docId = currentDoc ? currentDoc.id : 'main';

    const prevScrollTop = viewerScrollRef.current?.scrollTop ?? 0;

    const newField: DraftField = {
      localId: crypto.randomUUID(),
      signerId: currentSigner.id,
      fieldType: 'signature',
      pageNumber: coords.pageNumber,
      xPercent: Math.max(0, Math.min(100 - preset.w, coords.x - (preset.w / 2))),
      yPercent: Math.max(0, Math.min(100 - preset.h, coords.y - (preset.h / 2))),
      wPercent: preset.w,
      hPercent: preset.h,
      documentId: docId,
    };
    
    setFields(prev => [...prev, newField]);
    toast.success(`Campo ${preset.label} adicionado para ${currentSigner.name || currentSigner.email}`);

    // Evitar voltar ao topo do container após setState
    requestAnimationFrame(() => {
      if (viewerScrollRef.current) viewerScrollRef.current.scrollTop = prevScrollTop;
    });
    
    // Manter modo de posicionamento ativo para adicionar vários campos em sequência
    setPositionMode('place');
    setIsPlacingField(true);
  };

  // Remover campo
  const removeField = (fieldId: string) => {
    setFields(prev => prev.filter(f => f.localId !== fieldId));
    toast.success('Campo removido');
  };

  // Iniciar drag de campo
  const startDragging = (e: React.MouseEvent, field: DraftField) => {
    e.preventDefault();
    e.stopPropagation();
    dragMovedRef.current = false;

    // No DOCX, ao clicar no overlay do campo, o e.target pode não estar dentro de section/article
    // (logo getPdfCoordinates pode falhar). Então derivamos o rect da página pelo pageNumber.
    let rect: DOMRect | null = null;
    if (isDocxFile && docxContainerRef.current) {
      const wrapper = docxContainerRef.current.querySelector('.docx-wrapper') || docxContainerRef.current;
      const explicitPages = Array.from(wrapper.querySelectorAll('section, article')) as HTMLElement[];

      if (explicitPages.length > 1) {
        const pageEl = explicitPages[field.pageNumber - 1] || explicitPages[0] || (wrapper as HTMLElement);
        rect = pageEl.getBoundingClientRect();
      } else {
        const baseEl = (wrapper.querySelector('.docx') as HTMLElement | null) || (wrapper as HTMLElement);
        const baseRect = baseEl.getBoundingClientRect();
        const a4Ratio = 1123 / 794;
        const pageHeightPx = baseRect.width * a4Ratio;
        rect = new DOMRect(baseRect.x, baseRect.y, baseRect.width, pageHeightPx);
      }
    } else {
      const coords = getPdfCoordinates(e);
      if (!coords) return;
      rect = coords.rect;
    }

    if (!rect) return;
    
    setDraggingField({
      localId: field.localId,
      pageNumber: field.pageNumber,
      startX: e.clientX,
      startY: e.clientY,
      originX: field.xPercent,
      originY: field.yPercent,
      rect: { width: rect.width, height: rect.height },
    });
  };

  // Handler para clique no PDF
  const handlePdfClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggingField) {
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) {
      return;
    }

    if (positionMode === 'place') {
      addFieldAtPosition(e);
    }
  };

  // Atualizar mouse move handler
  useEffect(() => {
    if (!draggingField) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const dx = ((e.clientX - draggingField.startX) / draggingField.rect.width) * 100;
      const dy = ((e.clientY - draggingField.startY) / draggingField.rect.height) * 100;

      if (Math.abs(e.clientX - draggingField.startX) > 3 || Math.abs(e.clientY - draggingField.startY) > 3) {
        dragMovedRef.current = true;
      }
      
      setFields(prev => prev.map(f => {
        if (f.localId !== draggingField.localId) return f;
        
        const newX = Math.max(0, Math.min(100 - f.wPercent, draggingField.originX + dx));
        const newY = Math.max(0, Math.min(100 - f.hPercent, draggingField.originY + dy));
        
        return { ...f, xPercent: newX, yPercent: newY };
      }));
    };
    
    const handleMouseUp = () => {
      if (dragMovedRef.current) {
        suppressNextPlacementClickRef.current = true;
        window.setTimeout(() => {
          suppressNextPlacementClickRef.current = false;
        }, 120);
      }

      dragMovedRef.current = false;
      setDraggingField(null);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingField]);

  const handleSubmit = async () => {
    try {
      setWizardLoading(true);
      const docId = selectedDocumentId || crypto.randomUUID();
      let docPath: string | null = selectedDocumentPath || null;
      if (!docPath && uploadedFile) {
        docPath = await signatureService.uploadSignatureDocumentPdf(uploadedFile, docId);
        setSelectedDocumentPath(docPath);
      }

      // Upload attachment files (uploadedFiles[1+]) when coming from manual file upload
      let attachPaths: string[] | null = selectedAttachmentPaths;
      if (uploadedFiles.length > 1 && !selectedAttachmentPaths) {
        const uploaded: string[] = [];
        for (let i = 1; i < uploadedFiles.length; i++) {
          const p = await signatureService.uploadSignatureDocumentPdf(uploadedFiles[i], docId);
          uploaded.push(p);
        }
        attachPaths = uploaded.length > 0 ? uploaded : null;
      }

      // Envelope com MÚLTIPLOS documentos (principal + anexos) usa o modelo
      // `per_document`: 1 PDF assinado + código de verificação PRÓPRIO por arquivo,
      // além do protocolo do envelope. Cobre tanto o upload de vários arquivos
      // (attachPaths recém-enviados) quanto a seleção de vários documentos gerados
      // (selectedAttachmentPaths). Documento único permanece no fluxo consolidado
      // (legado) — 1 PDF assinado único.
      const isMultiDocEnvelope = (attachPaths?.length ?? 0) > 0;

      const payload: CreateSignatureRequestDTO = {
        document_id: docId,
        document_name: selectedDocumentName, document_path: docPath,
        attachment_paths: attachPaths,
        client_id: selectedClientId, client_name: selectedClientName, auth_method: settings.authMethod,
        expires_at: settings.expiresAt || null,
        require_cpf: settings.requireCpf,
        allow_refusal: settings.allowRefusal,
        signing_order: signerOrder === 'sequential' ? 'sequential' : 'parallel',
        signature_model: isMultiDocEnvelope ? 'per_document' : 'consolidated',
        signers: signers.map((s, i) => ({ name: s.name, email: s.email, cpf: s.cpf || null, phone: null, role: s.role || 'Signatário', order: i + 1 })),
      };
      
      console.log('📎 Criando solicitação com anexos:', selectedAttachmentPaths);
      console.log('📦 Payload completo:', JSON.stringify(payload, null, 2));
      const created = await signatureService.createRequest(payload);
      console.log('✅ Solicitação criada:', created.id, 'attachment_paths no response:', (created as any).attachment_paths);
      console.log('📍 Campos de assinatura no estado:', fields.length, fields.map(f => ({ doc: f.documentId, page: f.pageNumber, type: f.fieldType })));
      if (fields.length > 0) {
        const createdSignersOrdered = [...created.signers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const fieldsPayload = fields.filter((f) => f.fieldType === 'signature').map((f) => {
          const signer = signers.find((s) => s.id === f.signerId);
          const signerIndex = signers.findIndex((s) => s.id === f.signerId);
          const signerOrder = signer?.order ?? (signerIndex >= 0 ? signerIndex + 1 : null);
          const createdSigner = createdSignersOrdered.find((cs) => (cs.order ?? null) === signerOrder)
            ?? created.signers.find((cs) => cs.email === signer?.email)
            ?? (signerIndex >= 0 ? createdSignersOrdered[signerIndex] : null);
          return {
            document_id: f.documentId,
            signer_id: createdSigner?.id ?? null,
            field_type: f.fieldType,
            page_number: f.pageNumber,
            x_percent: f.xPercent,
            y_percent: f.yPercent,
            w_percent: f.wPercent,
            h_percent: f.hPercent,
          };
        });
        console.log('📍 Salvando campos no banco:', fieldsPayload.length, fieldsPayload);
        const savedFields = await signatureFieldsService.upsertFields(created.id, fieldsPayload);
        console.log('📍 Campos salvos:', savedFields);
      } else {
        console.warn('⚠️ NENHUM campo de assinatura para salvar!');
      }
      setCreatedRequest(created); setWizardStep('success'); toast.success('Documento enviado!'); loadData();
    } catch (error: any) { toast.error(error.message || 'Erro'); } finally { setWizardLoading(false); }
  };

  const handleOpenFooterMockup = async () => {
    const popup = window.open('', 'jurius-certificate-mockup', 'width=1100,height=900,scrollbars=yes,resizable=yes');
    if (!popup) {
      setCertificateMockupOpen(true);
      return;
    }

    popup.document.title = 'Mockup do Certificado';
    popup.document.body.innerHTML = '<div id="signature-certificate-mockup-root"></div>';
    popup.document.body.style.margin = '0';
    popup.document.body.style.background = '#1f2937';

    popup.document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => node.remove());
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      popup.document.head.appendChild(node.cloneNode(true));
    });

    const rootEl = popup.document.getElementById('signature-certificate-mockup-root');
    if (!rootEl) {
      setCertificateMockupOpen(true);
      return;
    }

    certificateMockupRootRef.current?.unmount();
    const root = createRoot(rootEl);
    certificateMockupRootRef.current = root;
    certificateMockupWindowRef.current = popup;

    root.render(
      <SignatureCertificateMockup
        open
        standalone
        onClose={() => popup.close()}
        documentName={selectedDocumentName || 'KIT CONSUMIDOR - PEDRO RODRIGUES MONTALVAO NETO'}
        signerName={signers[0]?.name || selectedClientName || 'PEDRO RODRIGUES MONTALVAO NETO'}
        signerEmail={signers[0]?.email || 'pedro@advcuiaba.com'}
        signerCpf={signers[0]?.cpf || '045.748.031-93'}
        authMethodLabel={
          settings.authMethod === 'signature_facial_document'
            ? 'Google (pedro@advcuiaba.com) + verificaÃ§Ã£o facial + documento'
            : settings.authMethod === 'signature_facial'
              ? 'Google (pedro@advcuiaba.com) + verificaÃ§Ã£o facial'
              : 'Google (pedro@advcuiaba.com)'
        }
      />
    );

    popup.addEventListener('beforeunload', () => {
      certificateMockupRootRef.current?.unmount();
      certificateMockupRootRef.current = null;
      certificateMockupWindowRef.current = null;
    }, { once: true });
  };

  const openDetails = (req: SignatureRequest | SignatureRequestWithSigners) => {
    const token = ++detailsLoadTokenRef.current;
    detailsRequestIdRef.current = req.id;

    // Abrir o modal imediatamente (UI first)
    setDetailsRequest(req as SignatureRequestWithSigners);
    setSignerImages({});
    setAuditLog([]);
    setAuditLogLoading(true);

    const bucketsToTry = ['document-templates', 'generated-documents', 'signatures', 'cloud-files'];

    const tryGetSignedUrl = async (path: string): Promise<string | null> => {
      if (!path) return null;
      
      // Remover barras iniciais
      const sanitizedPath = path.replace(/^\/+/, '');
      
      // Verificar se o path já contém um bucket conhecido
      const pathParts = sanitizedPath.split('/');
      const firstPart = pathParts[0];
      
      // Se o primeiro segmento do path é um bucket conhecido, usar apenas esse bucket
      if (bucketsToTry.includes(firstPart)) {
        // Remover o bucket do path para evitar duplicação
        const objectPath = pathParts.slice(1).join('/');
        if (!objectPath) return null; // Path inválido (só tem o bucket)
        
        console.log(`🔍 Tentando bucket específico: ${firstPart}, path: ${objectPath}`);
        
        const { data: signedData, error } = await supabase.storage
          .from(firstPart)
          .createSignedUrl(objectPath, 3600);
          
        if (!error && signedData?.signedUrl) {
          return signedData.signedUrl;
        }
        
        // Se falhou com o bucket específico, não tentar outros buckets
        console.log(`❌ Falha ao obter URL assinada para ${firstPart}/${objectPath}:`, error?.message);
        return null;
      }
      
      // Se não tem bucket no path, tentar todos os buckets em sequência
      console.log(`🔍 Tentando todos os buckets para: ${sanitizedPath}`);
      
      for (const bucket of bucketsToTry) {
        try {
          const { data: signedData, error } = await supabase.storage
            .from(bucket)
            .createSignedUrl(sanitizedPath, 3600);
            
          if (!error && signedData?.signedUrl) {
            return signedData.signedUrl;
          }
        } catch (e) {
          console.log(`❌ Erro ao tentar bucket ${bucket}:`, e);
        }
      }
      
      return null;
    };

    (async () => {
      try {
        const requestPromise = signatureService.getRequestWithSigners(req.id).catch(() => null);
        const auditPromise = signatureService.getAuditLog(req.id).catch(() => []);

        const data = await requestPromise;
        if (token !== detailsLoadTokenRef.current) return;
        if (detailsRequestIdRef.current !== req.id) return;
        if (data) setDetailsRequest(data);

        const signersToLoad = data?.signers ?? (req as SignatureRequestWithSigners)?.signers ?? [];
        if (signersToLoad.length > 0) {
          const imageResults = await Promise.all(
            signersToLoad.map(async (signer) => {
              const images: { facial?: string; signature?: string } = {};

              if (signer.facial_image_path) {
                images.facial = (await tryGetSignedUrl(signer.facial_image_path)) || undefined;
              }

              if (signer.signature_image_path) {
                images.signature = (await tryGetSignedUrl(signer.signature_image_path)) || undefined;
              }

              return { signerId: signer.id, images };
            })
          );

          if (token !== detailsLoadTokenRef.current) return;
          if (detailsRequestIdRef.current !== req.id) return;

          const imagesMap: Record<string, { facial?: string; signature?: string }> = {};
          imageResults.forEach(({ signerId, images }) => {
            imagesMap[signerId] = images;
          });
          setSignerImages(imagesMap);
        }

        const logs = await auditPromise;
        if (token !== detailsLoadTokenRef.current) return;
        if (detailsRequestIdRef.current !== req.id) return;
        setAuditLog(logs);
      } catch {
        if (token !== detailsLoadTokenRef.current) return;
        if (detailsRequestIdRef.current !== req.id) return;
        toast.error('Erro');
      } finally {
        if (token !== detailsLoadTokenRef.current) return;
        if (detailsRequestIdRef.current !== req.id) return;
        setAuditLogLoading(false);
      }
    })();
  };

  const focusConsumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusRequestId) return;
    if (focusConsumedRef.current === focusRequestId) return;
    focusConsumedRef.current = focusRequestId;

    (async () => {
      try {
        const data = await signatureService.getRequestWithSigners(focusRequestId).catch(() => null);
        if (data) {
          openDetails(data);
        }
      } finally {
        if (onParamConsumed) {
          onParamConsumed();
        }
      }
    })();
  }, [focusRequestId, onParamConsumed]);

  const copyLink = (token: string) => { navigator.clipboard.writeText(signatureService.generatePublicSigningUrl(token)); toast.success('Link copiado!'); };

  // ── Lixeira (excluídas) + bloqueio/revogação ──
  const [trashOpen, setTrashOpen] = useState(false);
  const [archivedList, setArchivedList] = useState<SignatureRequestWithSigners[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [trashSearch, setTrashSearch] = useState('');
  const [blockLoading, setBlockLoading] = useState(false);
  const [trashSelected, setTrashSelected] = useState<Set<string>>(new Set());
  const [trashBulkLoading, setTrashBulkLoading] = useState(false);
  // Modal de exclusão customizado
  const [deleteModalTarget, setDeleteModalTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteAlsoBlock, setDeleteAlsoBlock] = useState(false);
  const isAdmin = user?.email === 'pedro@advcuiaba.com';

  const loadArchived = async () => {
    setArchivedLoading(true);
    setTrashSelected(new Set());
    try {
      setArchivedList(await signatureService.listArchivedRequests());
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao carregar excluídas');
    } finally {
      setArchivedLoading(false);
    }
  };
  const openTrash = () => { setTrashOpen(true); void loadArchived(); };

  const toggleTrashSelect = (id: string) => {
    setTrashSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (trashSelected.size === archivedList.length) {
      setTrashSelected(new Set());
    } else {
      setTrashSelected(new Set(archivedList.map(r => r.id)));
    }
  };
  const handleBulkRestore = async () => {
    if (trashSelected.size === 0) return;
    setTrashBulkLoading(true);
    try {
      await Promise.all([...trashSelected].map(async id => {
        await signatureService.restoreRequest(id);
        // Desbloquear automaticamente ao restaurar
        const item = archivedList.find(r => r.id === id);
        if ((item as any)?.blocked_at) {
          await signatureService.unblockRequest(id);
        }
      }));
      toast.success(`${trashSelected.size} documento(s) restaurado(s) e desbloqueado(s).`);
      await loadArchived();
      loadData();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao restaurar');
    } finally {
      setTrashBulkLoading(false);
    }
  };
  const handleBulkPermanentDelete = async () => {
    if (trashSelected.size === 0) return;
    const ok = await confirmDelete({
      title: `Excluir definitivamente (${trashSelected.size})`,
      message: `Ação IRREVERSÍVEL: apaga ${trashSelected.size} documento(s) e TODOS os arquivos do servidor. Não poderão mais ser validados.`,
      confirmLabel: 'Excluir tudo',
    });
    if (!ok) return;
    setTrashBulkLoading(true);
    try {
      const items = archivedList.filter(r => trashSelected.has(r.id));
      await Promise.all(items.map(r => signatureService.permanentlyDeleteRequest(r.id, true)));
      toast.success(`${trashSelected.size} documento(s) excluído(s) definitivamente.`);
      await loadArchived();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao excluir');
    } finally {
      setTrashBulkLoading(false);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await signatureService.restoreRequest(id);
      // Desbloquear automaticamente ao restaurar
      const item = archivedList.find(r => r.id === id);
      if ((item as any)?.blocked_at) {
        await signatureService.unblockRequest(id);
      }
      toast.success('Documento restaurado e desbloqueado.');
      await loadArchived();
      loadData();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao restaurar');
    }
  };

  const handlePermanentDelete = async (req: SignatureRequestWithSigners) => {
    const ok = await confirmDelete({
      title: 'Excluir definitivamente',
      entityName: req.document_name || undefined,
      message: 'Ação IRREVERSÍVEL: apaga o registro e TODOS os arquivos do servidor (documento, anexos, PDF assinado, imagens). Não poderá mais ser validado.',
      confirmLabel: 'Excluir definitivamente',
    });
    if (!ok) return;
    try {
      await signatureService.permanentlyDeleteRequest(req.id, true);
      toast.success('Documento excluído definitivamente.');
      await loadArchived();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao excluir');
    }
  };

  const handleBlockRequest = async (req: { id: string; document_name?: string | null }) => {
    const ok = await confirmDelete({
      title: 'Bloquear / revogar documento',
      entityName: req.document_name || undefined,
      message: 'O documento bloqueado/revogado NÃO poderá ser validado publicamente pelo código nem por upload do arquivo. Você pode desbloquear depois.',
      confirmLabel: 'Bloquear',
    });
    if (!ok) return;
    try {
      setBlockLoading(true);
      await signatureService.blockRequest(req.id);
      toast.success('Documento bloqueado/revogado. Validação pública desativada.');
      loadData();
      setDetailsRequest((prev) => (prev && prev.id === req.id ? { ...prev, blocked_at: new Date().toISOString() } : prev));
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao bloquear');
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUnblockRequest = async (req: { id: string }) => {
    try {
      setBlockLoading(true);
      await signatureService.unblockRequest(req.id);
      toast.success('Documento desbloqueado. Validação pública reativada.');
      loadData();
      setDetailsRequest((prev) => (prev && prev.id === req.id ? { ...prev, blocked_at: null } : prev));
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao desbloquear');
    } finally {
      setBlockLoading(false);
    }
  };

  const handleDeleteRequest = (requestId: string) => {
    const req = requests.find((r) => r.id === requestId);
    setDeleteAlsoBlock(false);
    setDeleteModalTarget({ id: requestId, name: req?.document_name || 'Documento' });
  };

  const confirmDeleteRequest = async () => {
    if (!deleteModalTarget) return;
    const pinOk = await requirePin({
      action: 'delete_signature_request',
      resourceType: 'signature_request',
      resourceId: deleteModalTarget.id,
      sensitivity: 'critical',
      title: 'Confirmar exclusão',
      description: `Informe o PIN para remover "${deleteModalTarget.name}". Esta ação arquiva o documento e invalida o link público.`,
      actionLabel: deleteAlsoBlock ? 'Remover e bloquear' : 'Remover documento',
    });
    if (!pinOk) return;
    try {
      setDeleteLoading(true);
      await signatureService.archiveRequest(deleteModalTarget.id);
      if (deleteAlsoBlock) {
        await signatureService.blockRequest(deleteModalTarget.id, 'Bloqueado ao excluir do painel');
      }
      toast.success(deleteAlsoBlock
        ? 'Documento removido e bloqueado. Validação pública desativada.'
        : 'Documento removido do painel. Consulta disponível pelo código de autenticidade.');
      setDeleteModalTarget(null);
      detailsRequestIdRef.current = null;
      setDetailsRequest(null);
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDownloadDocument = async (request: SignatureRequestWithSigners) => {
    // Modelo per_document: o artefato legal são os PDFs assinados INDIVIDUAIS em
    // signature_request_documents — NÃO o signed_document_path do signatário
    // (que é do fluxo consolidated). Baixa o(s) documento(s) final(is) do envelope.
    if ((request as any).signature_model === 'per_document') {
      try {
        const docs = await signatureService.listRequestDocuments(request.id);
        const signedDocs = docs.filter((d) => d.signed_file_path);
        if (signedDocs.length === 0) {
          toast.error('Nenhum documento assinado disponível ainda.');
          return;
        }
        if (signedDocs.length === 1) {
          const only = signedDocs[0];
          const url = await pdfSignatureService.getSignedPdfUrl(only.signed_file_path!);
          if (!url) { toast.error('Não foi possível acessar o PDF assinado.'); return; }
          await downloadOriginalPdf(url, `${only.display_name || only.document_key}_assinado.pdf`);
          return;
        }
        // Vários documentos finais → baixa tudo em ZIP (coerente com a seção).
        await handleDownloadAllSignedAsZip(request);
      } catch (e: any) {
        console.error('[DOWNLOAD per_document]', e);
        toast.error(e?.message || 'Erro ao baixar documentos assinados.');
      }
      return;
    }

    if (!request.document_path) {
      toast.error('Documento não disponível para download');
      return;
    }
    try {
      toast.info('Preparando download...');

      // Buscar dados atualizados do request com signers do banco
      const freshRequest = await signatureService.getRequestWithSigners(request.id);
      if (!freshRequest) {
        toast.error('Erro ao carregar dados do documento');
        return;
      }
      
      // Se tem signatário que assinou, verificar se já existe PDF assinado salvo
      const signedSigner = [...freshRequest.signers]
        .filter(s => s.status === 'signed')
        .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime())[0];
      console.log('[DOWNLOAD] signedSigner:', signedSigner?.name, signedSigner?.status);
      
      if (signedSigner) {
        // Verificar se já existe PDF assinado salvo no bucket 'assinados'
        if (signedSigner.signed_document_path) {
          const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedSigner.signed_document_path);
          if (signedUrl) {
            console.log('[DOWNLOAD] Usando PDF já salvo:', signedSigner.signed_document_path);
            await downloadOriginalPdf(signedUrl, `${request.document_name}_assinado.pdf`);
            return;
          }
        }
        
        // Se não existe, verificar se é DOCX ou PDF
        const docPath = request.document_path?.toLowerCase() || '';
        const isDocxFile = docPath.endsWith('.docx') || docPath.endsWith('.doc');
        
        if (isDocxFile) {
          // DOCX: se não houver PDF completo salvo, gerar agora (offscreen) e salvar no signer.
          toast.info('Documento DOCX - gerando PDF completo...');

          const freshSigner = await signatureService.getSignerById(signedSigner.id);
          if (!freshSigner) {
            toast.error('Erro ao carregar dados do signatário');
            return;
          }

          const ensureOffscreenDocxStyle = () => {
            const styleId = 'docx-offscreen-style';
            if (document.getElementById(styleId)) return;
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
              .docx-wrapper {
                background: #ffffff !important;
                padding: 0 !important;
              }
              .docx-wrapper > section,
              .docx-wrapper article,
              .docx-wrapper .docx {
                width: 794px !important;
                min-width: 794px !important;
                max-width: 794px !important;
                background: #ffffff !important;
              }
              /* Impede o docx-preview de quebrar palavras no meio (overflow-wrap:
                 break-word / hyphens: auto). Sem isso, html2canvas parte palavras
                 como "Trabalhista" → "Trabal" + "hista" no PDF gerado. */
              .docx-wrapper,
              .docx-wrapper *,
              .docx-wrapper p,
              .docx-wrapper span {
                overflow-wrap: normal !important;
                word-wrap: normal !important;
                word-break: normal !important;
                hyphens: none !important;
                -webkit-hyphens: none !important;
              }
            `;
            document.head.appendChild(style);
          };

          const renderDocxOffscreen = async (docxUrl: string) => {
            ensureOffscreenDocxStyle();
            const res = await fetch(docxUrl);
            if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
            const blob = await res.blob();

            const host = document.createElement('div');
            host.style.position = 'fixed';
            host.style.left = '-100000px';
            host.style.top = '0';
            host.style.width = '794px';
            host.style.background = '#ffffff';
            host.style.zIndex = '-1';
            host.style.pointerEvents = 'none';
            document.body.appendChild(host);

            await renderAsync(blob, host, undefined, {
              className: 'docx-wrapper',
              inWrapper: true,
              ignoreWidth: false,
              ignoreHeight: true,   // permitir altura contínua (sem forçar altura da página DOCX)
              breakPages: false,    // renderizar como bloco contínuo — nós fatiamos em páginas
              renderHeaders: true,
              renderFooters: true,
              renderFootnotes: true,
            });

            return host;
          };

          const attachmentPaths = (freshRequest as any).attachment_paths as string[] | null | undefined;

          const cleanupHosts: HTMLElement[] = [];
          try {
            const mainDocUrl = await signatureService.getDocumentPreviewUrl(request.document_path);
            if (!mainDocUrl) {
              toast.error('Erro ao obter URL do documento');
              return;
            }

            const mainHost = await renderDocxOffscreen(mainDocUrl);
            cleanupHosts.push(mainHost);

            const attachmentDocxItems: { documentId: string; container: HTMLElement }[] = [];
            const attachmentPdfItems: { documentId: string; url: string }[] = [];

            for (let i = 0; i < (attachmentPaths ?? []).length; i++) {
              const p = attachmentPaths?.[i];
              if (!p) continue;
              const lower = p.toLowerCase();

              if (lower.endsWith('.pdf')) {
                const u = await signatureService.getDocumentPreviewUrl(p);
                if (u) attachmentPdfItems.push({ documentId: `attachment-${i}`, url: u });
                continue;
              }

              if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
                const u = await signatureService.getDocumentPreviewUrl(p);
                if (!u) continue;
                const host = await renderDocxOffscreen(u);
                cleanupHosts.push(host);
                attachmentDocxItems.push({ documentId: `attachment-${i}`, container: host });
              }
            }

            const fieldsOverride = await signatureFieldsService.listByRequest(freshRequest.id);

            const { filePath: signedPdfPath, sha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
              request: freshRequest,
              signer: freshSigner,
              creator: null,
              docxContainer: mainHost,
              attachmentDocxItems,
              attachmentPdfItems,
              fieldsOverride,
            });

            await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: sha256 });

            const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
            if (signedUrl) {
              await downloadOriginalPdf(signedUrl, `${request.document_name}_assinado.pdf`);
            } else {
              toast.error('Erro ao obter URL do PDF assinado');
            }
          } catch (e) {
            console.error('[DOWNLOAD] Erro ao gerar PDF completo do DOCX:', e);
            toast.error('Erro ao gerar PDF completo. Baixando relatório...');

            // Fallback: relatório
            try {
              const { filePath: reportPath, sha256 } = await pdfSignatureService.saveSignatureReportToStorage({
                request: freshRequest,
                signer: freshSigner,
                creator: null,
              });
              await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: reportPath, signed_pdf_sha256: sha256 });
              const signedUrl = await pdfSignatureService.getSignedPdfUrl(reportPath);
              if (signedUrl) await downloadOriginalPdf(signedUrl, `${request.document_name}_relatorio.pdf`);
            } catch (e2) {
              console.error('[DOWNLOAD] Erro ao gerar relatório:', e2);
              toast.error('Erro ao gerar relatório de assinatura');
            }
          } finally {
            for (const el of cleanupHosts) {
              try { el.remove(); } catch { /* noop */ }
            }
          }

          return;
        }
        
        // Para PDF, gerar documento completo
        const url = await signatureService.getDocumentPreviewUrl(request.document_path);
        if (!url) {
          toast.error('Erro ao obter URL do documento');
          return;
        }
        
        const freshSigner = await signatureService.getSignerById(signedSigner.id);
        if (!freshSigner) {
          toast.error('Erro ao carregar dados do signatário');
          return;
        }
        
        console.log('[DOWNLOAD] Gerando e salvando PDF assinado...');
        try {
          const attachmentPaths = (freshRequest as any).attachment_paths as string[] | null | undefined;
          const attachmentPdfItems: { documentId: string; url: string }[] = [];
          for (let i = 0; i < (attachmentPaths ?? []).length; i++) {
            const p = attachmentPaths?.[i];
            if (!p || !p.toLowerCase().endsWith('.pdf')) continue;
            const u = await signatureService.getDocumentPreviewUrl(p);
            if (u) attachmentPdfItems.push({ documentId: `attachment-${i}`, url: u });
          }

          // Gerar e salvar PDF no bucket 'assinados'
          const { filePath: signedPdfPath, sha256 } = await pdfSignatureService.saveSignedPdfToStorage({
            request: freshRequest,
            signer: freshSigner,
            originalPdfUrl: url,
            creator: null,
            attachmentPdfItems,
          });
          
          // Atualizar o signer com o path do PDF assinado
          await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: sha256 });
          
          // Baixar o PDF salvo
          const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
          if (signedUrl) {
            await downloadOriginalPdf(signedUrl, `${request.document_name}_assinado.pdf`);
          } else {
            toast.error('Erro ao obter URL do PDF assinado');
          }
        } catch (pdfError: any) {
          console.error('[DOWNLOAD] Erro ao gerar PDF assinado:', pdfError);
          toast.error('Erro ao gerar PDF assinado. Baixando original...');
          const url = await signatureService.getDocumentPreviewUrl(request.document_path);
          if (url) await downloadOriginalPdf(url, request.document_name);
        }
      } else {
        // Documento sem assinatura - baixar original
        const url = await signatureService.getDocumentPreviewUrl(request.document_path);
        if (url) await downloadOriginalPdf(url, request.document_name);
        else toast.error('Erro ao obter URL do documento');
      }
    } catch (error: any) {
      console.error('[DOWNLOAD] Erro geral:', error);
      toast.error('Erro ao baixar documento: ' + (error.message || 'Erro desconhecido'));
    }
  };

  const downloadOriginalPdf = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 5000);
      toast.success('Download iniciado!');
    } catch (err: any) {
      console.error('[DOWNLOAD] Erro ao baixar original:', err);
      // Fallback: abrir em nova aba
      window.open(url, '_blank');
      toast.info('Documento aberto em nova aba');
    }
  };

  const fetchBlobFromUrl = async (url: string): Promise<Blob> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  };

  const sanitizeDownloadName = (value: string, fallback: string) => {
    const normalized = (value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
    return normalized || fallback;
  };

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 5000);
  };

  const ensureCloudFolderByName = async (name: string, parentId: string | null, clientId?: string | null) => {
    const folders = await cloudService.listFolders(parentId);
    const normalizedName = (name || '').trim().toLocaleLowerCase('pt-BR');
    const existing = folders.find((folder) => {
      const sameName = folder.name.trim().toLocaleLowerCase('pt-BR') === normalizedName;
      if (!sameName) return false;
      if (parentId === null) {
        return (folder.client_id || null) === (clientId || null);
      }
      return true;
    });

    if (existing) {
      if (clientId && existing.client_id !== clientId) {
        return cloudService.updateFolder(existing.id, { client_id: clientId });
      }
      return existing;
    }

    return cloudService.createFolder({
      name,
      parent_id: parentId,
      client_id: clientId || null,
    });
  };

  const resolveCloudTargetFolder = async (request: SignatureRequestWithSigners) => {
    const clientFolderName = (request.client_name || request.signers?.[0]?.name || '').trim();
    if (!clientFolderName) {
      throw new Error('Não foi possível identificar o nome do cliente para a pasta.');
    }

    const clientFolder = await ensureCloudFolderByName(clientFolderName, null, request.client_id);
    const processFolderName = getProcessFolderName(request.process_number);
    const counterpartyFolderName = getCounterpartyFolderName(request);

    let currentParentFolder = clientFolder;
    const pathSegments = [clientFolder.name];
    let processFolder: CloudFolder | null = null;
    let counterpartyFolder: CloudFolder | null = null;

    if (request.process_id && processFolderName) {
      processFolder = await ensureCloudFolderByName(processFolderName, clientFolder.id, request.client_id);
      currentParentFolder = processFolder;
      pathSegments.push(processFolder.name);
    }

    if (counterpartyFolderName) {
      counterpartyFolder = await ensureCloudFolderByName(counterpartyFolderName, currentParentFolder.id, request.client_id);
      currentParentFolder = counterpartyFolder;
      pathSegments.push(counterpartyFolder.name);
    }

    const nonProtocolFolder = await ensureCloudFolderByName('NÃO PROTOCOLAR', currentParentFolder.id, request.client_id);
    pathSegments.push('NÃO PROTOCOLAR');

    return {
      clientFolder,
      processFolder,
      counterpartyFolder,
      nonProtocolFolder,
      locationLabel: pathSegments.join(' / '),
    };
  };

  const resolveSignedDocumentBlob = async (request: SignatureRequestWithSigners): Promise<{ blob: Blob; fileName: string }> => {
    const freshRequest = await signatureService.getRequestWithSigners(request.id);
    if (!freshRequest) {
      throw new Error('Não foi possível carregar a assinatura.');
    }

    const signedSigner = [...freshRequest.signers]
      .filter((s) => s.status === 'signed')
      .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime())[0];

    if (!signedSigner) {
      throw new Error('Ainda não existe documento assinado para copiar.');
    }

    if (signedSigner.signed_document_path) {
      const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedSigner.signed_document_path);
      if (!signedUrl) {
        throw new Error('Não foi possível acessar o PDF assinado.');
      }

      return {
        blob: await fetchBlobFromUrl(signedUrl),
        fileName: `${request.document_name}_assinado.pdf`,
      };
    }

    throw new Error('O PDF assinado ainda não foi gerado. Faça o download do documento assinado uma vez para gerar o PDF e tente novamente.');
  };

  const handleDownloadAllSignedAsZip = async (request: SignatureRequestWithSigners) => {
    try {
      setDownloadZipLoading(true);
      toast.info('Aguarde... montando ZIP...');

      const docs = await signatureService.listRequestDocuments(request.id);
      const signedDocs = docs.filter((doc) => doc.signed_file_path);

      if (signedDocs.length === 0) {
        toast.error('Nenhum PDF assinado foi encontrado para baixar em ZIP.');
        return;
      }

      const zip = new JSZip();
      const usedNames = new Set<string>();
      const uniqueName = (rawName: string) => {
        const dot = rawName.lastIndexOf('.');
        const base = dot > 0 ? rawName.slice(0, dot) : rawName;
        const ext = dot > 0 ? rawName.slice(dot) : '';
        let candidate = rawName;
        let index = 2;
        while (usedNames.has(candidate)) {
          candidate = `${base} (${index})${ext}`;
          index += 1;
        }
        usedNames.add(candidate);
        return candidate;
      };

      for (const [index, doc] of signedDocs.entries()) {
        const signedUrl = await pdfSignatureService.getSignedPdfUrl(doc.signed_file_path!);
        if (!signedUrl) {
          throw new Error(`NÃ£o foi possÃ­vel acessar o PDF assinado de ${doc.display_name || doc.document_key}.`);
        }

        const blob = await fetchBlobFromUrl(signedUrl);
        const fileName = sanitizeDownloadName(
          `${doc.display_name || doc.document_key || `documento-${index + 1}`}_assinado.pdf`,
          `documento-${index + 1}_assinado.pdf`,
        );
        zip.file(uniqueName(fileName), blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = sanitizeDownloadName(`${request.document_name || 'documentos-assinados'}.zip`, 'documentos-assinados.zip');
      triggerBlobDownload(zipBlob, zipName);
      toast.success(`ZIP com ${signedDocs.length} documento(s) iniciado.`);
    } catch (error: any) {
      console.error('[DOWNLOAD ZIP] Erro ao montar ZIP:', error);
      toast.error(error.message || 'Erro ao montar ZIP dos documentos assinados.');
    } finally {
      setDownloadZipLoading(false);
    }
  };

  const handleCopySignedDocumentToCloud = async (request: SignatureRequestWithSigners) => {
    if (!request.client_id) {
      toast.error('Vincule um cliente para criar a pasta no Cloud.');
      return;
    }

    try {
      setCopyToCloudLoading(true);
      const { nonProtocolFolder, locationLabel } = await resolveCloudTargetFolder(request);

      // Modelo per_document: envia CADA documento assinado individual (fonte de
      // verdade em signature_request_documents), não um único PDF consolidado.
      let files: File[];
      if ((request as any).signature_model === 'per_document') {
        const docs = await signatureService.listRequestDocuments(request.id);
        const signedDocs = docs.filter((d) => d.signed_file_path);
        if (signedDocs.length === 0) {
          throw new Error('Ainda não há documentos assinados para copiar.');
        }
        files = [];
        for (const doc of signedDocs) {
          const url = await pdfSignatureService.getSignedPdfUrl(doc.signed_file_path!);
          if (!url) throw new Error(`Não foi possível acessar o PDF assinado de ${doc.display_name || doc.document_key}.`);
          const b = await fetchBlobFromUrl(url);
          const name = sanitizeDownloadName(
            `${doc.display_name || doc.document_key}_assinado.pdf`,
            `${doc.document_key}_assinado.pdf`,
          );
          files.push(new File([b], name, { type: b.type || 'application/pdf' }));
        }
      } else {
        const { blob, fileName } = await resolveSignedDocumentBlob(request);
        files = [new File([blob], fileName, { type: blob.type || 'application/pdf' })];
      }

      await cloudService.uploadFiles(nonProtocolFolder.id, files, request.client_id);
      events.emit(SYSTEM_EVENTS.CLOUD_CHANGED, {
        action: 'signed_document_copied',
        folderId: nonProtocolFolder.id,
        clientId: request.client_id,
      });
      setCloudSyncStatusByRequestId((prev) => ({ ...prev, [request.id]: true }));

      toast.success(`Cópia enviada para o Cloud em ${locationLabel}.`);
    } catch (error: any) {
      toast.error(error.message || 'Não foi possível copiar o documento assinado para o Cloud.');
    } finally {
      setCopyToCloudLoading(false);
    }
  };

  const openSignModal = (signer: Signer) => { setSigningSigner(signer); setSignatureData(null); setFacialData(null); setSignCpf(signer.cpf || ''); setSignStep('signature'); setSignModalOpen(true); };

  // Solicitação do signatário em assinatura (para aplicar require_cpf no modal interno)
  const signingRequest = signingSigner ? requests.find((r) => r.id === signingSigner.signature_request_id) : null;
  const signRequiresCpf = !!(signingRequest as any)?.require_cpf;
  const signCpfDigits = signCpf.replace(/\D/g, '');

  const confirmSignature = async () => {
    if (!signingSigner || !signatureData) return;
    if (signRequiresCpf && signCpfDigits.length !== 11) { toast.error('Informe o CPF (11 dígitos) do signatário para assinar este documento.'); return; }
    try {
      setSignLoading(true);
      await signatureService.signDocument(signingSigner.id, { signature_image: signatureData, facial_image: facialData, signer_cpf: signRequiresCpf ? signCpf : undefined });
      // Notificação já é criada automaticamente pelo signatureService quando todos assinarem
      toast.success('Assinado!'); setSignModalOpen(false); loadData();
      if (detailsRequest) openDetails(detailsRequest);
    } catch (error: any) { toast.error(error.message || 'Erro'); } finally { setSignLoading(false); }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'pending') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded"><Clock className="w-3 h-3" />Aguardando</span>;
    if (status === 'signed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded"><CheckCircle className="w-3 h-3" />Assinado</span>;
    if (status === 'refused') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-700 rounded"><X className="w-3 h-3" />Recusado</span>;
    return null;
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', {
    timeZone: 'America/Cuiaba',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeAgo = (d: string): string => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora mesmo';
    if (mins < 60) return `há ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `há ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'há 1 dia';
    if (days < 7) return `há ${days} dias`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return 'há 1 semana';
    return `há ${weeks} semanas`;
  };

  if (showListSkeleton && wizardStep === 'list') return <SignatureSkeleton rows={8} />;

  // SUCCESS
  if (wizardStep === 'success' && createdRequest) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-white rounded-2xl shadow-lg text-center overflow-hidden">
          <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
          <div className="p-8">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6"><Check className="w-10 h-10 text-orange-600" /></div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Documento criado e enviado com sucesso</h2>
          <p className="text-slate-600 mb-8">Seu documento foi <strong>enviado</strong> para os destinatários.</p>
          <div className="bg-slate-50 rounded-xl p-4 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Links de assinatura</h3>
            <div className="space-y-3">
              {createdRequest.signers.map((signer) => (
                <div key={signer.id} className="flex items-center justify-between gap-3 p-3 bg-[#f8f7f5] rounded-lg border border-[#e7e5df]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center"><User className="w-4 h-4 text-orange-600" /></div>
                    <div className="min-w-0"><p className="font-medium text-slate-800 truncate">{signer.name}</p><p className="text-xs text-slate-500 truncate">{signatureService.generatePublicSigningUrl(signer.public_token!)}</p></div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => copyLink(signer.public_token!)} 
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50 rounded-lg"
                  >
                    <Copy className="w-4 h-4" />Copiar
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button 
            type="button"
            onClick={resetWizard} 
            className="px-6 py-2.5 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700"
          >
            Fechar
          </button>
          </div>
        </div>
      </div>
    );
  }

  // WIZARD
  if (wizardStep !== 'list') {
    const canProceedUpload = selectedDocumentName || uploadedFile || selectedGenDocIds.length > 0;
    const canProceedSigners = signers.every((s) => (s.name ?? '').trim());
    const steps = [
      { key: 'upload', label: 'Documento', icon: FileText },
      { key: 'signers', label: 'Signatários', icon: Users },
      { key: 'position', label: 'Posicionar', icon: MousePointer2 },
      { key: 'settings', label: 'Configurações', icon: Filter },
    ];
    const currentStepIndex = steps.findIndex(s => s.key === wizardStep);
    
    return (
      <div className="bg-[#f5f5f3]">
        {/* Header simples */}
        {wizardStep !== 'position' && (
          <div className="bg-[#f8f7f5] border-b border-[#e7e5df] sticky top-0 z-20">
            <div className="h-1 bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
              <button 
                type="button"
                onClick={() => { 
                  if (wizardStep === 'upload') resetWizard(); 
                  else if (wizardStep === 'signers') setWizardStep('upload'); 
                  else if (wizardStep === 'settings') setWizardStep('position'); 
                }} 
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
              >
                <ChevronLeft className="w-4 h-4" />
                Voltar
              </button>
              
              {/* Steps simples */}
              <div className="flex items-center gap-6">
                {steps.map((step, i) => {
                  const isActive = wizardStep === step.key;
                  const isCompleted = i < currentStepIndex;
                  return (
                    <div key={step.key} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isActive ? 'bg-slate-900 text-white' : isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'
                      }`}>
                        {isCompleted ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      <span className={`text-sm font-medium hidden sm:block ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>{step.label}</span>
                    </div>
                  );
                })}
              </div>
              
              <button 
                type="button"
                onClick={() => { 
                  if (wizardStep === 'upload' && canProceedUpload) setWizardStep('signers'); 
                  else if (wizardStep === 'signers' && canProceedSigners) setWizardStep('position'); 
                  else if (wizardStep === 'settings') handleSubmit(); 
                }} 
                disabled={(wizardStep === 'upload' && !canProceedUpload) || (wizardStep === 'signers' && !canProceedSigners) || wizardLoading} 
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {wizardLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : wizardStep === 'settings' ? <><Send className="w-4 h-4" />Enviar</> : <>Avançar<ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        )}

        {wizardStep === 'upload' && (
          <div className="max-w-6xl mx-auto p-6">
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-slate-900">Nova solicitação de assinatura</h1>
              <p className="text-sm text-slate-500 mt-1">Selecione o documento e adicione os signatários</p>
              {selectedClientName ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[#e7e5df] bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                    {selectedClientName}
                  </span>
                  {selectedClientPhone ? (
                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700">
                      <Phone className="h-3.5 w-3.5" />
                      <span>{selectedClientPhone}</span>
                      {getWhatsappLink(selectedClientPhone) ? (
                        <a
                          href={getWhatsappLink(selectedClientPhone) || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition"
                          onClick={(event) => event.stopPropagation()}
                        >
                          WA.me
                        </a>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Upload */}
              <div className="bg-[#f8f7f5] rounded-lg border border-[#e7e5df] p-6">
                <h2 className="text-sm font-medium text-slate-700 mb-4">Documento</h2>
                <div 
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                    dragOver ? 'border-slate-400 bg-slate-50' : uploadedFiles.length > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-[#e7e5df] hover:border-slate-300'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFilesSelect(e.dataTransfer.files); }}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={(e) => e.target.files?.length && handleFilesSelect(e.target.files)} className="hidden" />
                  {uploadedFiles.length > 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <CheckCircle className="w-10 h-10 text-emerald-500" />
                      <div>
                        <p className="font-medium text-slate-800">{selectedDocumentName}</p>
                        {uploadedFiles.length > 1 && <p className="text-xs text-slate-500 mt-1">{uploadedFiles.length} arquivos selecionados</p>}
                      </div>
                      {uploadedFiles.length > 1 && (
                        <div className="w-full max-w-sm text-left bg-[#f8f7f5] rounded border border-[#e7e5df] p-3 mt-2 max-h-48 overflow-y-auto">
                          <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => selectAllUploadedFiles()}
                                className="text-[11px] font-semibold text-slate-600 hover:text-slate-800"
                              >
                                Selecionar todos
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                type="button"
                                onClick={() => clearSelectedUploadFileIndexes()}
                                className="text-[11px] font-semibold text-slate-600 hover:text-slate-800"
                              >
                                Limpar
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                if (selectedUploadFileIndexes.size === 0) return;
                                const confirmed = await confirmDelete({
                                  title: 'Excluir arquivos selecionados',
                                  message: `Você tem certeza que deseja excluir ${selectedUploadFileIndexes.size} arquivo(s) do upload?`,
                                  confirmLabel: 'Excluir',
                                });
                                if (!confirmed) return;
                                removeUploadedFilesByIndexes(new Set(selectedUploadFileIndexes));
                              }}
                              disabled={selectedUploadFileIndexes.size === 0}
                              className="text-[11px] font-semibold text-red-600 hover:text-red-700 disabled:text-slate-300 disabled:cursor-not-allowed"
                            >
                              Excluir selecionados
                            </button>
                          </div>
                          {uploadedFiles.map((f, i) => (
                            <div key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-xs py-1">
                              {/* Reorder arrows */}
                              <div className="flex flex-col gap-0.5 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => moveUploadedFileAt(i, 'up')}
                                  disabled={i === 0}
                                  className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                  title="Mover para cima"
                                >
                                  <ChevronUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveUploadedFileAt(i, 'down')}
                                  disabled={i === uploadedFiles.length - 1}
                                  className="text-slate-400 hover:text-slate-600 disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                  title="Mover para baixo"
                                >
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                              </div>
                              <label className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selectedUploadFileIndexes.has(i)}
                                  onChange={() => toggleSelectedUploadIndex(i)}
                                />
                                <span className="truncate text-slate-600">{f.name}</span>
                                {i === 0 && <span className="flex-shrink-0 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">Principal</span>}
                              </label>
                              <button type="button" onClick={() => removeUploadedFileAt(i)} className="text-red-400 hover:text-red-600 flex-shrink-0"><X className="w-3 h-3" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button type="button" onClick={clearUploadedFiles} className="text-xs text-red-500 hover:text-red-600">Remover</button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-500 mb-3">Arraste arquivos ou</p>
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-800">Selecionar arquivos</button>
                    </>
                  )}
                </div>
                
                {generatedDocuments.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {/* Header com contador */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Documentos gerados</p>
                      <div className="flex items-center gap-2">
                        {selectedGenDocIds.length > 0 && (
                          <>
                            <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                              {selectedGenDocIds.length} selecionado{selectedGenDocIds.length !== 1 ? 's' : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedGenDocIds([]);
                                setSelectedDocumentId('');
                                setSelectedDocumentName('');
                                setSelectedDocumentPath('');
                                setSelectedAttachmentPaths(null);
                                setSelectedClientId(null);
                                setSelectedClientName(null);
                                setViewerDocuments([]);
                                setCurrentViewerDocIndex(0);
                                setPdfPreviewUrl(null);
                                setFields([]);
                              }}
                              className="text-[11px] text-red-500 hover:text-red-600 font-medium"
                            >
                              Limpar
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Busca */}
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={genDocsSearchTerm}
                        onChange={(e) => setGenDocsSearchTerm(e.target.value)}
                        placeholder="Buscar documento..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#e7e5df] rounded focus:outline-none focus:ring-1 focus:ring-slate-400 placeholder:text-slate-400"
                      />
                    </div>

                    {/* Lista com multi-seleção */}
                    <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                      {generatedDocuments
                        .filter((doc) => {
                          const q = genDocsSearchTerm.trim().toLowerCase();
                          if (!q) return true;
                          return (
                            (doc.file_name || '').toLowerCase().includes(q) ||
                            (doc.template_name || '').toLowerCase().includes(q) ||
                            (doc.client_name || '').toLowerCase().includes(q)
                          );
                        })
                        .map((doc) => {
                          const selIdx = selectedGenDocIds.indexOf(doc.id);
                          const isSelected = selIdx !== -1;
                          const isMain = selIdx === 0;
                          return (
                            <button
                              type="button"
                              key={doc.id}
                              onClick={() => void toggleGenDocInSelection(doc)}
                              className={`w-full flex items-center gap-2.5 p-2.5 rounded border text-left transition ${
                                isSelected
                                  ? 'border-slate-900 bg-slate-50'
                                  : 'border-[#e7e5df] hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {/* Checkbox / número de ordem */}
                              {isSelected ? (
                                <span className="w-5 h-5 rounded bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                  {selIdx + 1}
                                </span>
                              ) : (
                                <span className="w-5 h-5 rounded border border-slate-300 flex-shrink-0" />
                              )}
                              <FileText className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate text-slate-700">{doc.file_name || doc.template_name}</p>
                                <p className="text-[11px] text-slate-400 truncate">
                                  {doc.client_name || '—'}
                                  {isMain && <span className="ml-1 text-slate-500 font-medium">· Principal</span>}
                                  {isSelected && !isMain && <span className="ml-1 text-slate-400">· Anexo</span>}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      {generatedDocuments.filter((doc) => {
                        const q = genDocsSearchTerm.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          (doc.file_name || '').toLowerCase().includes(q) ||
                          (doc.template_name || '').toLowerCase().includes(q) ||
                          (doc.client_name || '').toLowerCase().includes(q)
                        );
                      }).length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-3">Nenhum documento encontrado</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Signatários */}
              <div className="bg-[#f8f7f5] rounded-lg border border-[#e7e5df] p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-medium text-slate-700">Signatários</h2>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setSignerOrder('none')} className={`px-2 py-1 rounded text-xs font-medium ${signerOrder === 'none' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>Sem ordem</button>
                    <button type="button" onClick={() => setSignerOrder('sequential')} className={`px-2 py-1 rounded text-xs font-medium ${signerOrder === 'sequential' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>Com ordem</button>
                  </div>
                </div>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {signers.map((signer, index) => (
                    <div key={signer.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded">
                      <span className="w-6 h-6 bg-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1">{index + 1}</span>
                      <div className="flex-1 space-y-2">
                        <input type="text" value={signer.name} onChange={(e) => updateSigner(signer.id, 'name', e.target.value)} placeholder="Nome" className="w-full px-3 py-2 border border-[#e7e5df] rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        <div className="flex gap-2">
                          <input type="email" value={signer.email} onChange={(e) => updateSigner(signer.id, 'email', e.target.value)} placeholder="Email" className="flex-1 px-3 py-2 border border-[#e7e5df] rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                          <select value={signer.role} onChange={(e) => updateSigner(signer.id, 'role', e.target.value)} className="px-3 py-2 border border-[#e7e5df] rounded text-sm bg-white">
                            {signerRoles.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeSigner(signer.id)} disabled={signers.length <= 1} className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addSigner} className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded text-sm text-slate-500 hover:border-slate-400 hover:text-slate-600">
                  <Plus className="w-4 h-4" /> Adicionar signatário
                </button>
              </div>
            </div>
          </div>
        )}

        {wizardStep === 'signers' && (
          <div className="max-w-3xl mx-auto p-6">
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-slate-900">Confirmar signatários</h1>
              <p className="text-sm text-slate-500 mt-1">Revise os dados antes de continuar</p>
            </div>
            <div className="bg-[#f8f7f5] rounded-lg border border-[#e7e5df] divide-y divide-slate-100">
              {signers.map((s, i) => (
                <div key={s.id} className="flex items-center gap-4 p-4">
                  <span className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-sm font-medium text-slate-600">{i + 1}</span>
                  <div className="flex-1">
                    <p className="font-medium text-slate-800">{s.name || 'Sem nome'}</p>
                    <p className="text-sm text-slate-500">{s.email || 'Sem email'}</p>
                  </div>
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">{s.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {wizardStep === 'position' && (
          <div className="h-[calc(100vh-140px)] flex flex-col bg-gray-100">
            {/* Header do step position */}
            <div className="bg-[#f8f7f5] border-b border-[#e7e5df] px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWizardStep('signers')}
                  className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Voltar
                </button>
                <span className="text-gray-300">|</span>
                <span className="text-sm font-semibold text-gray-900 truncate max-w-xs">
                  {viewerDocuments[currentViewerDocIndex]?.name || selectedDocumentName || 'Documento'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={resetWizard}
                  className="px-4 py-2 bg-white border border-[#e7e5df] text-gray-700 rounded-lg hover:bg-gray-50 transition shadow-sm font-medium text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setWizardStep('settings')}
                  className="px-5 py-2 bg-[#00C48C] text-white rounded-lg hover:bg-emerald-600 transition shadow-lg flex items-center gap-2 font-medium text-sm"
                >
                  Avançar
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Main content */}
            <main className="flex-1 p-6 flex gap-6 min-h-0 overflow-hidden bg-gray-100">
              {/* Sidebar (Ferramentas) */}
              <aside className="w-80 flex-shrink-0 bg-[#f8f7f5] rounded-xl border border-[#e7e5df] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-1px_rgba(0,0,0,0.03)] flex flex-col overflow-hidden">
                {/* Header da sidebar */}
                <div className="p-4 border-b border-[#e7e5df]">
                  <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">Ferramentas</h2>
                  <button
                    type="button"
                    onClick={(e) => { 
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('🔘 Ativando modo de posicionamento');
                      setPositionMode('place'); 
                      setIsPlacingField(true); 
                    }}
                    disabled={isPlacingField}
                    className={`w-full text-white py-3 px-4 rounded-lg font-medium shadow-md transition-all duration-300 flex items-center justify-center gap-2 group active:scale-95 ${
                      isPlacingField ? 'bg-emerald-600 ring-4 ring-emerald-100' : 'bg-[#00C48C] hover:bg-emerald-600 hover:shadow-emerald-200'
                    }`}
                  >
                    {isPlacingField ? (
                      <><MousePointer2 className="w-4 h-4 animate-pulse" /> Clique no documento</>
                    ) : (
                      <><MousePointer2 className="w-4 h-4" /> Posicionar Assinatura</>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-2 text-center">Clique no botão e depois no local do documento.</p>
                </div>


              {/* Conteúdo scrollável */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                {/* Seletor de documento (quando houver múltiplos) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase">Documentos</h3>
                    <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded-full">{viewerDocuments.length}</span>
                  </div>
                  <div className="space-y-2">
                    {viewerDocuments.map((doc, idx) => (
                      <button
                        type="button"
                        key={doc.id}
                        onClick={() => { setCurrentViewerDocIndex(idx); loadDocumentPreview(doc); }}
                        className={`group w-full flex items-center gap-3 p-3 rounded-lg text-left text-sm transition cursor-pointer ${
                          currentViewerDocIndex === idx
                            ? 'bg-emerald-50 border border-emerald-200'
                            : 'hover:bg-gray-50 border border-transparent'
                        }`}
                      >
                        <FileText className={`w-5 h-5 flex-shrink-0 ${currentViewerDocIndex === idx ? 'text-[#00C48C]' : 'text-gray-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`truncate text-sm font-medium ${currentViewerDocIndex === idx ? 'text-gray-900' : 'text-gray-700'}`}>{doc.name}</p>
                          <p className={`text-xs ${currentViewerDocIndex === idx ? 'text-emerald-600' : 'text-gray-400'}`}>
                            {currentViewerDocIndex === idx ? 'Em edição' : (doc.type === 'main' ? 'Principal' : 'Anexo')}
                          </p>
                        </div>
                        {currentViewerDocIndex === idx && (
                          <Pencil className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Signatário ativo */}
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Signatários</h3>
                  {signers.map((signer, index) => (
                    <button
                      type="button"
                      key={signer.id}
                      onClick={() => setCurrentSignerIndex(index)}
                      className={`w-full rounded-lg p-3 mb-2 transition ${
                        currentSignerIndex === index
                          ? 'bg-orange-50 border border-orange-100'
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-white ${
                          currentSignerIndex === index ? 'bg-orange-500' : 'bg-gray-400'
                        }`}>
                          {(signer.name || 'S').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="text-left">
                          <p className={`text-sm font-medium ${currentSignerIndex === index ? 'text-gray-900' : 'text-gray-700'}`}>
                            {signer.name || 'Signatário'}
                          </p>
                          <p className={`text-xs ${currentSignerIndex === index ? 'text-orange-600' : 'text-gray-400'}`}>
                            {signer.email || `Signatário ${index + 1}`}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                  <button type="button" onClick={addSigner} className="mt-1 w-full py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:text-[#00C48C] hover:border-[#00C48C] hover:bg-emerald-50/50 transition flex items-center justify-center gap-1">
                    <Plus className="w-4 h-4" /> Adicionar Signatário
                  </button>
                </div>


                {/* Campos adicionados */}
                {fields.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase">Campos Adicionados</h3>
                      <button type="button" onClick={() => setFields([])} className="text-xs text-red-500 hover:text-red-600 font-medium">Limpar</button>
                    </div>
                    <div className="space-y-2">
                      {fields.map((field) => {
                        const signer = signers.find(s => s.id === field.signerId);
                        const signerIndex = signers.findIndex(s => s.id === field.signerId);
                        return (
                          <div key={field.localId} className="flex items-center justify-between text-sm bg-[#f8f7f5] rounded-lg p-2 border border-gray-100">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-[#00C48C] text-white flex items-center justify-center text-xs font-bold">{signerIndex + 1}</span>
                              <span className="text-gray-600">{signer?.name || 'Signatário'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">Pág. {field.pageNumber}</span>
                              <button type="button" onClick={() => removeField(field.localId)} className="text-gray-400 hover:text-red-500 transition">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dica Pro */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-amber-800">Dica Pro</h4>
                      <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                        Se o template já possui <code className="bg-[#f8f7f5]/50 px-1 py-0.5 rounded text-amber-900 font-mono text-[10px]">[[assinatura_X]]</code>, o sistema posicionará automaticamente.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* Área do PDF */}
            <section className="flex-1 bg-gray-100 rounded-xl border border-[#e7e5df] flex flex-col relative overflow-hidden">
              {/* Toolbar flutuante centralizada */}
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-full px-4 py-2 flex items-center gap-4 z-10 border border-[#e7e5df]">
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => { setPdfAutoFitEnabled(false); setPdfViewMode('manual'); setPdfScale((s) => Math.max(0.5, s - 0.1)); }} 
                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition" 
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-medium w-12 text-center text-gray-900">{Math.round(pdfScale * 100)}%</span>
                  <button 
                    type="button"
                    onClick={() => { setPdfAutoFitEnabled(false); setPdfViewMode('manual'); setPdfScale((s) => Math.min(2, s + 0.1)); }} 
                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition" 
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      viewerScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });

                      if (pdfViewMode === 'expanded') {
                        // Resetar para fit inicial
                        initialFitAppliedRef.current = false;
                        setPdfAutoFitEnabled(true);
                        setPdfViewMode('fit');
                        return;
                      }

                      // Expandir para 100%
                      setPdfAutoFitEnabled(false);
                      setPdfViewMode('expanded');
                      setPdfScale(1);
                    }}
                    className={`p-1.5 hover:bg-gray-100 rounded-full transition ${pdfViewMode === 'expanded' ? 'text-[#00C48C]' : 'text-gray-500'}`}
                    title={pdfViewMode === 'expanded' ? 'Recolher' : 'Expandir'}
                  >
                    {pdfViewMode === 'expanded' ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                </div>
                <div className="w-px h-4 bg-gray-300"></div>
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => {
                      const nextPage = Math.max(1, pdfCurrentPage - 1);
                      setPdfCurrentPage(nextPage);
                      scrollToPdfPage(nextPage);
                    }} 
                    disabled={pdfCurrentPage <= 1} 
                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-medium text-gray-900">{pdfCurrentPage} / {pdfNumPages || 1}</span>
                  <button 
                    type="button"
                    onClick={() => {
                      const nextPage = Math.min(pdfNumPages || 1, pdfCurrentPage + 1);
                      setPdfCurrentPage(nextPage);
                      scrollToPdfPage(nextPage);
                    }} 
                    disabled={pdfCurrentPage >= (pdfNumPages || 1)} 
                    className="p-1.5 hover:bg-gray-100 rounded-full text-gray-600 transition disabled:opacity-30"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Container do PDF/DOCX */}
              <div ref={viewerScrollRef} className="flex-1 overflow-auto pt-16 pb-6 px-6 flex justify-center items-start bg-gray-200/50 min-h-0">
                {(pdfPreviewUrl || isDocxFile || isImageFile) ? (
                  <div className="w-full flex justify-center items-start min-w-0">
                    {isDocxFile && (
                      <div className="relative" style={{ width: `${794 * pdfScale}px`, minHeight: `${1123 * pdfScale}px` }}>
                        <div
                          className="relative"
                          style={{
                            width: '794px',
                            minHeight: '1123px',
                            transform: `scale(${pdfScale})`,
                            transformOrigin: 'top left',
                          }}
                        >
                          <div
                            ref={docxContainerRef}
                            className={`bg-white shadow-lg rounded-lg overflow-hidden ${
                              isPlacingField ? 'cursor-crosshair' : 'cursor-default'
                            }`}
                            onClick={handlePdfClick}
                            style={{ width: '100%', minHeight: '1123px' }}
                          />

                          {pdfLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[#f8f7f5]/80 z-10">
                              <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                            </div>
                          )}

                          <div className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                            {fields.filter(f => 
                              f.fieldType === 'signature' &&
                              f.pageNumber === pdfCurrentPage && 
                              (f.documentId === (viewerDocuments[currentViewerDocIndex]?.id || 'main'))
                            ).map((field) => {
                              const preset = FIELD_PRESETS[field.fieldType];
                              const signer = signers.find(s => s.id === field.signerId);
                              const signerIndex = signers.findIndex(s => s.id === field.signerId);
                              const signerColor = ['#3B82F6', '#EF4444', '#10B981', '#8B5CF6', '#F59E0B'][signerIndex % 5];
                              const isSignature = field.fieldType === 'signature';

                              return (
                                <div
                                  key={field.localId}
                                  className="absolute cursor-move border-2 rounded-md flex items-center justify-center transition-shadow hover:shadow-lg pointer-events-auto"
                                  style={{
                                    left: `${field.xPercent}%`,
                                    top: `${field.yPercent}%`,
                                    width: `${field.wPercent}%`,
                                    height: `${field.hPercent}%`,
                                    borderColor: signerColor,
                                    backgroundColor: isSignature ? `${signerColor}08` : `${signerColor}20`,
                                    borderStyle: isSignature ? 'dashed' : 'solid',
                                    zIndex: 50,
                                  }}
                                  onMouseDown={(e) => startDragging(e, field)}
                                >
                                  <div className="flex items-center justify-center w-full h-full relative group overflow-hidden rounded-[20px] px-3 py-2">
                                    <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity duration-500" style={{ background: `linear-gradient(135deg, ${signerColor}, transparent)` }} />
                                    <div className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md z-20" style={{ backgroundColor: signerColor }}>
                                      {signerIndex + 1}
                                    </div>
                                    {isSignature ? (
                                      <div className="w-full h-full rounded-[16px] border border-white/70 bg-[#f8f7f5]/90 backdrop-blur-sm shadow-[0_10px_30px_-18px_rgba(0,0,0,0.28)] px-3 py-1.5 flex items-center gap-3">
                                        <div
                                          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
                                          style={{ backgroundColor: `${signerColor}18`, color: signerColor }}
                                        >
                                          <FileSignature className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0 flex-1 flex flex-col items-start justify-center leading-tight">
                                          <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: signerColor }}>
                                            Assinatura
                                          </span>
                                          <span className="text-[9px] text-slate-500 truncate max-w-full">
                                            {signer?.name || 'Signatário'}
                                          </span>
                                        </div>
                                        <div
                                          className="shrink-0 rounded-full px-2 py-0.5 text-[8px] font-semibold border bg-[#f8f7f5]/95"
                                          style={{ color: signerColor, borderColor: `${signerColor}35` }}
                                        >
                                          Assinar
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <preset.icon className="w-4 h-4" style={{ color: signerColor }} />
                                        <span className="text-xs font-medium" style={{ color: signerColor }}>{preset.label}</span>
                                      </>
                                    )}

                                    <span className="absolute bottom-1 left-1 text-[8px] font-bold px-2 py-0.5 rounded-full bg-[#f8f7f5] shadow-sm border border-slate-100" style={{ color: signerColor }}>
                                      {signer?.name || 'Signatário'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeField(field.localId);
                                    }}
                                    className={
                                      isSignature
                                        ? 'absolute top-1 left-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors'
                                        : 'absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors'
                                    }
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Viewer de imagem */}
                    {isImageFile && pdfPreviewUrl && (
                      <div className="relative self-start flex-none inline-block" style={{ width: `${595 * pdfScale}px` }}>
                        <div
                          ref={pdfContainerRef}
                          className={`relative bg-white shadow-lg rounded-lg overflow-hidden ${isPlacingField ? 'cursor-crosshair' : 'cursor-default'}`}
                          style={{ width: '595px', transform: `scale(${pdfScale})`, transformOrigin: 'top left' }}
                          onClick={handlePdfClick}
                        >
                          {pdfLoading && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#f8f7f5]/80 rounded-lg">
                              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                            </div>
                          )}
                          <img
                            src={pdfPreviewUrl}
                            alt="Documento"
                            className="w-full h-auto block select-none"
                            draggable={false}
                          />
                          {/* Campos de assinatura sobrepostos */}
                          <div className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                            {fields.filter(f =>
                              f.fieldType === 'signature' &&
                              f.pageNumber === 1 &&
                              (f.documentId === (viewerDocuments[currentViewerDocIndex]?.id || 'main'))
                            ).map((field) => {
                              const signer = signers.find(s => s.id === field.signerId);
                              const signerIndex = signers.findIndex(s => s.id === field.signerId);
                              const signerColor = ['#3B82F6', '#EF4444', '#10B981', '#8B5CF6', '#F59E0B'][signerIndex % 5];
                              return (
                                <div
                                  key={field.localId}
                                  className="absolute cursor-move border-2 rounded-md flex items-center justify-center pointer-events-auto"
                                  style={{
                                    left: `${field.xPercent}%`,
                                    top: `${field.yPercent}%`,
                                    width: `${field.wPercent}%`,
                                    height: `${field.hPercent}%`,
                                    borderColor: signerColor,
                                    borderStyle: 'dashed',
                                    backgroundColor: `${signerColor}10`,
                                  }}
                                >
                                  <span className="text-[9px] font-semibold" style={{ color: signerColor }}>{signer?.name || 'Assinar'}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removeField(field.localId); }}
                                    className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Viewer de PDF */}
                    {!isDocxFile && !isImageFile && pdfPreviewUrl && (
                      <div className="relative self-start flex-none inline-block" style={{ width: `${595 * pdfScale}px` }}>
                        <div
                          ref={pdfContainerRef}
                          className={`relative bg-transparent ${isPlacingField ? 'cursor-crosshair' : 'cursor-default'}`}
                          style={{ width: '595px', transform: `scale(${pdfScale})`, transformOrigin: 'top left' }}
                          onClick={handlePdfClick}
                        >
                          {pdfLoading && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#f8f7f5]/80 rounded-lg">
                              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                            </div>
                          )}

                          <div className="flex flex-col gap-6 items-center">
                            {pdfPagesNode}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                      <p className="text-slate-500">Carregue um documento para posicionar as assinaturas</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
            </main>
          </div>
        )}

        {wizardStep === 'settings' && (
          <div className="max-w-xl mx-auto p-6"><div className="bg-[#f8f7f5] rounded-xl border border-[#e7e5df] p-6"><h3 className="text-lg font-semibold mb-6">Configurações</h3><div className="space-y-4">
            <div><label className="block text-sm font-medium mb-2">Método de autenticação</label><select value={settings.authMethod} onChange={(e) => setSettings((s) => ({ ...s, authMethod: e.target.value as SignerAuthMethod }))} className="w-full px-3 py-2 border border-[#e7e5df] rounded-lg text-sm">{availableAuthMethods.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
            <div className="space-y-3 pt-4 border-t">
              {[{ key: 'requireCpf', label: 'Exigir CPF do cliente', hint: 'O CPF informado na assinatura deve conferir com o CPF cadastrado do signatário.' }, { key: 'allowRefusal', label: 'Permitir recusa' }, { key: 'blockAfterDeadline', label: 'Bloquear após prazo' }].map(({ key, label, hint }) => <label key={key} className="flex items-center justify-between gap-3"><span className="text-sm">{label}{hint && <span className="block text-xs text-slate-400 font-normal">{hint}</span>}</span><button type="button" onClick={() => setSettings((s) => ({ ...s, [key]: !(s as any)[key] }))} className={`shrink-0 w-10 h-6 rounded-full ${(settings as any)[key] ? 'bg-orange-600' : 'bg-slate-300'}`}><div className={`w-4 h-4 bg-[#f8f7f5] rounded-full shadow transform ${(settings as any)[key] ? 'translate-x-5' : 'translate-x-1'}`} /></button></label>)}
            </div>
            {settings.blockAfterDeadline && <div className="pt-4"><label className="block text-sm font-medium mb-2">Data limite</label><input type="date" value={settings.expiresAt} onChange={(e) => setSettings((s) => ({ ...s, expiresAt: e.target.value }))} className="w-full px-3 py-2 border border-[#e7e5df] rounded-lg text-sm" /></div>}
            <div className="pt-4 border-t">
              <button type="button" onClick={handleOpenFooterMockup} disabled={footerMockupLoading} className="inline-flex items-center gap-2 rounded-lg border border-[#e7e5df] bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                {footerMockupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Ver mockup do certificado
              </button>
              <p className="mt-2 text-xs text-slate-500">Abre uma prévia visual das páginas finais do certificado sem precisar assinar nem gerar PDF.</p>
            </div>
          </div></div></div>
        )}
    </div>
    );
  }

  // LIST
  const totalRequestsCount = requests.length;
  const nowTs = Date.now();
  const expiredRequestsCount = requests.filter((r) => {
    const exp = (r as any).expires_at as string | null | undefined;
    return exp && new Date(exp).getTime() < nowTs && r.status !== 'signed';
  }).length;
  const pendingRequestsCount = requests.filter((r) => {
    const exp = (r as any).expires_at as string | null | undefined;
    const isExp = exp && new Date(exp).getTime() < nowTs;
    return r.status === 'pending' && !isExp;
  }).length;
  const signedRequestsCount = requests.filter((r) => r.status === 'signed').length;

  return (
    <div className="@container flex flex-col gap-3 max-w-full overflow-x-hidden h-[calc(100vh-96px)] overflow-hidden" style={{ background: 'transparent' }} data-signature-module>
      {selectionMode && selectedRequestIds.size > 0 && (
        <div className="rounded-xl border border-[#e7e5df] bg-[#f8f7f5] px-3 sm:px-4 py-3">
          <div className="flex flex-col @sm:flex-row @sm:items-center @sm:justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">{selectedRequestIds.size}</span> selecionado(s)
              <span className="text-slate-400"> · </span>
              <span className="text-slate-500">Filtro atual ({filteredRequests.length})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFilteredRequests}
                className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Limpar seleção
              </button>
              <button
                type="button"
                onClick={deleteSelectedRequests}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
              >
                Excluir selecionados
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-4">

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {/* Pastas — abas lado a lado (mesmo estilo das abas de status). Arrastar documento -> aba move. */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-[#f8f7f5] px-2 py-1.5" style={{ border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' }}>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide min-w-0 py-0.5">
              {[{ id: null as string | null, label: 'Caixa de Entrada', count: rootItemCount, parentId: null as string | null }]
                .concat(orderedFolders.map((f) => ({ id: f.id, label: f.name, count: folderItemCountById.get(f.id) ?? 0, parentId: f.parent_id ?? null })))
                .map((tab) => {
                  const isSel = selectedFolderId === tab.id;
                  const isDropOver = isDraggingExplorer && draggingExplorer?.type === 'item' && dragOverFolderId === tab.id;
                  return (
                    <button
                      key={tab.id ?? '__root__'}
                      type="button"
                      draggable={folderReorderMode && tab.id != null}
                      onClick={() => setSelectedFolderId(tab.id)}
                      onDragStart={(e) => {
                        if (!folderReorderMode || tab.id == null) return;
                        setExplorerDragData(e, { type: 'folder', id: tab.id }, e.currentTarget as HTMLElement);
                      }}
                      onDragEnd={() => { setIsDraggingExplorer(false); setDragOverFolderId(null); setDraggingExplorer(null); }}
                      onDragOver={(e) => {
                        if (draggingExplorer?.type === 'item') { handleAllowDrop(e); setDragOverFolderId(tab.id); }
                        else if (folderReorderMode && draggingExplorer?.type === 'folder') { handleAllowDrop(e); }
                      }}
                      onDragLeave={(e) => { if (draggingExplorer?.type === 'item') handleFolderDragLeave(e, tab.id); }}
                      onDrop={(e) => {
                        if (draggingExplorer?.type === 'item') { void handleDropOnFolder(e, tab.id); }
                        else if (folderReorderMode && draggingExplorer?.type === 'folder' && tab.id != null) { void handleReorderFolderDrop(e, tab.parentId, tab.id); }
                      }}
                      title={tab.id ? (folderPathLabelById.get(tab.id) || tab.label) : 'Caixa de Entrada'}
                      className={`group shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        isSel ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                      } ${isDropOver ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-[#f8f7f5]' : ''} ${
                        folderReorderMode && tab.id != null ? 'cursor-grab active:cursor-grabbing' : ''
                      }`}
                    >
                      {tab.id === null
                        ? <Inbox className={`w-3.5 h-3.5 ${isSel ? 'text-white' : 'text-slate-400'}`} />
                        : <FolderOpen className={`w-3.5 h-3.5 ${isSel ? 'text-white' : 'text-slate-400'}`} />}
                      <span className="max-w-[180px] truncate">{tab.label}</span>
                      <span className={`tabular-nums ${isSel ? 'text-slate-300' : 'text-slate-400'}`}>{tab.count}</span>
                    </button>
                  );
                })}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={toggleFolderReorder}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition ${folderReorderMode ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-500/20' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
                title={folderReorderMode ? 'Sair do modo de organização' : 'Organizar pastas'}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="hidden @sm:inline">Organizar</span>
              </button>
              <button
                type="button"
                onClick={() => openCreateFolderModal(selectedFolderId)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition"
                title="Nova pasta"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden @sm:inline">Nova pasta</span>
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="rounded-xl bg-[#f8f7f5] overflow-hidden" style={{ border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}>

            {/* Row 1: tabs + ações primárias */}
            <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid #f1f5f9' }}>
              {/* Tabs de status */}
              <div className="flex items-center gap-0.5 overflow-x-auto">
                {[
                  { key: 'all',     label: 'Todos',      count: requests.length,                                     countCls: 'text-slate-400' },
                  { key: 'pending', label: 'Pendentes',  count: requests.filter(r => r.status === 'pending').length, countCls: 'text-amber-500' },
                  { key: 'signed',  label: 'Assinados',  count: requests.filter(r => r.status === 'signed').length,  countCls: 'text-emerald-600' },
                  ...(expiredRequestsCount > 0 ? [{ key: 'expired', label: 'Expirados', count: expiredRequestsCount, countCls: 'text-red-500' }] : []),
                ].map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilterStatus(tab.key as any)}
                    className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      filterStatus === tab.key
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label} <span className={filterStatus === tab.key ? 'text-slate-300' : tab.countCls}>{tab.count}</span>
                  </button>
                ))}
                <div className="w-px h-4 bg-slate-200 mx-1.5 flex-shrink-0" />
                <span className="shrink-0 whitespace-nowrap px-3 py-1.5 text-xs text-slate-400">
                  Assinantes <span className="text-slate-600 font-medium">{requests.reduce((acc, r) => acc + (r.signers?.length || 0), 0)}</span>
                </span>
              </div>

              {/* Ações primárias */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { resetWizard(); setWizardStep('upload'); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Novo documento
                </button>
              </div>
            </div>

            {/* Row 2: busca + utilitários */}
            <div className="flex items-center gap-2 px-4 py-2">
              {/* Busca */}
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar documentos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500/10"
                />
              </div>

              {/* Separador */}
              <div className="w-px h-5 bg-slate-200 flex-shrink-0" />

              {/* Filtros */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  showFilters
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-[#e7e5df] text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filtros
              </button>

              {/* Seleção */}
              <button
                type="button"
                onClick={toggleSelectionMode}
                title="Selecionar múltiplos"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition ${
                  selectionMode
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : 'border-[#e7e5df] text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
              </button>

              {/* View toggle */}
              <div className="flex items-center rounded-lg border border-[#e7e5df] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`flex items-center justify-center w-7 h-7 transition ${
                    viewMode === 'list' ? 'bg-slate-800 text-white' : 'bg-[#f8f7f5] text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center justify-center w-7 h-7 transition ${
                    viewMode === 'grid' ? 'bg-slate-800 text-white' : 'bg-[#f8f7f5] text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Separador */}
              <div className="w-px h-5 bg-slate-200 flex-shrink-0" />

              {/* Excluídas */}
              <button
                type="button"
                onClick={openTrash}
                title="Documentos excluídos"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluídas
              </button>
            </div>
          </div>

        {/* Painel de seleção em massa */}
        {selectionMode && (
          <div className="rounded-xl border border-[#e7e5df] bg-[#f8f7f5] px-3 sm:px-4 py-3">
            <div className="flex flex-col @sm:flex-row @sm:items-center @sm:justify-between gap-3">
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-900">{selectedRequestIds.size}</span> selecionado(s)
                <span className="text-slate-400"> · </span>
                <span className="text-slate-500">
                  {selectedFolderId ? `Pasta atual (${filteredRequestsByFolder.length})` : `Filtro atual (${filteredRequests.length})`}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedFolderId && (
                  <button
                    type="button"
                    onClick={selectAllInFolder}
                    className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Selecionar tudo da pasta
                  </button>
                )}
                <button
                  type="button"
                  onClick={selectAllFilteredRequests}
                  className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={clearSelectedIds}
                  className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Limpar seleção
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedRequests}
                  disabled={bulkDeleteLoading}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {bulkDeleteLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Remover
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Painel: Filtros avançados */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Período</label>
                <select
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value as any)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                >
                  <option value="all">Todos</option>
                  <option value="7d">7 dias</option>
                  <option value="30d">30 dias</option>
                  <option value="90d">90 dias</option>
                </select>
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Mês</label>
                <input
                  type="month"
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">De</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Até</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Ordem</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="w-full rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                >
                  <option value="newest">Recentes</option>
                  <option value="oldest">Antigos</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFilterPeriod('all');
                  setFilterMonth('');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                  setSortOrder('newest');
                }}
                className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Limpar
              </button>
            </div>
          </div>
        )}

        {/* Barra de seleção em massa */}
        {selectionMode && selectedRequestIds.size > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">{selectedRequestIds.size}</span> de {filteredRequests.length} selecionado(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllFilteredRequests}
                className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                className="rounded-lg border border-[#e7e5df] bg-[#f8f7f5] px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => void deleteSelectedRequests()}
                disabled={bulkDeleteLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {bulkDeleteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Excluir
              </button>
            </div>
          </div>
        )}

          {/* Lista de documentos */}
          <div className="rounded-2xl bg-[#f8f7f5]" style={{ border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
        {filteredRequestsByFolder.length === 0 && filteredGeneratedDocumentsByFolder.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-slate-900 mb-1">Nenhum documento encontrado</h3>
            <p className="text-sm text-slate-500 mb-6">Crie seu primeiro documento para assinatura digital</p>
            <button
              onClick={() => { resetWizard(); setWizardStep('upload'); }}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="w-4 h-4" />
              Criar documento
            </button>
          </div>
        ) : viewMode === 'list' ? (
          <div className="p-3 space-y-2">
            {filteredRequestsByFolder.map((req) => {
              const allSigned = req.signers?.length > 0 && req.signers.every((s: Signer) => s.status === 'signed');
              const signedCount = req.signers?.filter((s: Signer) => s.status === 'signed').length || 0;
              const totalSigners = req.signers?.length || 0;
              const clientLabel = req.client_name || req.signers?.[0]?.name || 'Cliente não informado';
              const pct = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;
              const isInCloud = Boolean(cloudSyncStatusByRequestId[req.id]);
              const reqExpiresAt = (req as any).expires_at as string | null | undefined;
              const isExpiredCard = reqExpiresAt && new Date(reqExpiresAt).getTime() < Date.now() && !allSigned;
              const expiresWithin48h = reqExpiresAt && !isExpiredCard && !allSigned &&
                (new Date(reqExpiresAt).getTime() - Date.now()) < 48 * 3600 * 1000;
              const attachmentCount = ((req as any).attachment_paths as string[] | null | undefined)?.length ?? 0;
              // "Visto mas não assinado"
              const viewedPendingSigners = !allSigned
                ? req.signers?.filter((s: Signer) => s.status === 'pending' && s.viewed_at) ?? []
                : [];
              const hasViewedPending = viewedPendingSigners.length > 0;
              // Tempo relativo da visualização mais recente
              const lastViewedAt = viewedPendingSigners.length > 0
                ? viewedPendingSigners.reduce((latest: Signer, s: Signer) =>
                    new Date(s.viewed_at!).getTime() > new Date(latest.viewed_at!).getTime() ? s : latest
                  ).viewed_at
                : null;
              const isDraggingThisItem =
                draggingExplorer?.type === 'item'
                && draggingExplorer.itemType === 'signature_request'
                && draggingExplorer.id === req.id;

              const isBlocked = !!(req as any).blocked_at;
              const statusColor  = isBlocked ? '#dc2626' : allSigned ? '#16a34a' : '#d97706';
              const statusBg     = isBlocked ? '#fef2f2' : allSigned ? '#f0fdf4' : '#fffbeb';
              const statusBorder = isBlocked ? '#fecaca' : allSigned ? '#bbf7d0' : '#fde68a';

              return (
                <div
                  key={req.id}
                  draggable
                  onDragStart={(e) => {
                    const payload: any = { type: 'item', item_type: 'signature_request', item_id: req.id, created_by: req.created_by };
                    if (selectionMode && selectedRequestIds.size > 1 && selectedRequestIds.has(req.id)) {
                      payload.selected_request_ids = Array.from(selectedRequestIds);
                    }
                    setExplorerDragData(e, payload, e.currentTarget as HTMLElement);
                  }}
                  onDragEnd={() => {
                    setIsDraggingExplorer(false);
                    setDragOverFolderId(null);
                    setDraggingExplorer(null);
                    if (dragImageElRef.current) {
                      try { document.body.removeChild(dragImageElRef.current); } catch { /* ignore */ }
                      dragImageElRef.current = null;
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'signature_request', itemId: req.id, createdBy: req.created_by });
                  }}
                  onClick={() => {
                    if (suppressExplorerClickRef.current || isDraggingExplorer) return;
                    openDetails(req);
                  }}
                  style={{
                    background: '#ffffff',
                    borderRadius: 12,
                    border: '1px solid #e8edf2',
                    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
                    cursor: 'grab',
                    transition: 'box-shadow 0.15s, border-color 0.15s, background 0.15s',
                    opacity: isDraggingThisItem ? 0.6 : 1,
                    overflow: 'hidden',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(15,23,42,0.09)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#c7d2da';
                    (e.currentTarget as HTMLElement).style.background = '#fafcfe';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(15,23,42,0.05)';
                    (e.currentTarget as HTMLElement).style.borderColor = '#e8edf2';
                    (e.currentTarget as HTMLElement).style.background = '#ffffff';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12 }}>

                    {/* Status strip */}
                    <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 99, background: statusColor, flexShrink: 0 }} />

                    {/* Checkbox */}
                    {selectionMode && (
                      <div onClick={e => e.stopPropagation()}>
                        <input type="checkbox" style={{ width: 15, height: 15, accentColor: '#ea580c', cursor: 'pointer', flexShrink: 0 }}
                          checked={selectedRequestIds.has(req.id)} onChange={() => toggleSelectedRequestId(req.id)} />
                      </div>
                    )}

                    {/* Doc icon */}
                    <div style={{ width: 38, height: 38, borderRadius: 9, background: statusBg, border: `1px solid ${statusBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <FileSignature style={{ width: 17, height: 17, color: statusColor }} />
                    </div>

                    {/* Main info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                          {req.document_name}
                        </span>
                        {req.process_id && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                            <FileText style={{ width: 9, height: 9 }} />Processo
                          </span>
                        )}
                        {req.requirement_id && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', whiteSpace: 'nowrap' }}>
                            <FileText style={{ width: 9, height: 9 }} />Req.
                          </span>
                        )}
                        {isBlocked && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', whiteSpace: 'nowrap' }}>
                            <Lock style={{ width: 9, height: 9 }} />Bloqueado
                          </span>
                        )}
                        {isExpiredCard && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', whiteSpace: 'nowrap' }}>
                            <AlertTriangle style={{ width: 9, height: 9 }} />Expirado
                          </span>
                        )}
                        {expiresWithin48h && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', whiteSpace: 'nowrap' }}>
                            <Clock style={{ width: 9, height: 9 }} />Expira em breve
                          </span>
                        )}
                        {hasViewedPending && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}
                            title={lastViewedAt ? `Visualizado ${timeAgo(lastViewedAt)}` : 'Visualizado'}>
                            <Eye style={{ width: 9, height: 9 }} />Visto {lastViewedAt ? timeAgo(lastViewedAt) : ''}
                          </span>
                        )}
                        {attachmentCount > 0 && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                            📎 +{attachmentCount}
                          </span>
                        )}
                        {isInCloud && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>
                            <FolderOpen style={{ width: 9, height: 9 }} />Pasta
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientLabel}</span>
                        <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1', flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatDate(req.created_at)}</span>
                      </div>
                    </div>

                    {/* Signatários avatars */}
                    {req.signers && req.signers.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        {req.signers.slice(0, 3).map((s: Signer, i: number) => {
                          const initials = s.name.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
                          const signed = s.status === 'signed';
                          return (
                            <div key={s.id} title={`${s.name} — ${signed ? 'Assinou' : 'Aguardando'}`} style={{
                              width: 26, height: 26, borderRadius: '50%',
                              background: signed ? '#dcfce7' : '#f1f5f9',
                              border: `2px solid ${signed ? '#16a34a' : '#e2e8f0'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 9, fontWeight: 800, color: signed ? '#15803d' : '#64748b',
                              marginLeft: i > 0 ? -8 : 0, position: 'relative', zIndex: req.signers.length - i,
                            }}>
                              {initials}
                            </div>
                          );
                        })}
                        {req.signers.length > 3 && (
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#f1f5f9', border: '2px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#94a3b8', marginLeft: -8 }}>
                            +{req.signers.length - 3}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Status badge + progress */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, minWidth: 110 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '4px 10px', borderRadius: 20,
                        fontSize: 11, fontWeight: 700,
                        color: statusColor, background: statusBg, border: `1px solid ${statusBorder}`,
                      }}>
                        {isBlocked ? <Lock style={{ width: 10, height: 10 }} /> : allSigned ? <CheckCircle style={{ width: 10, height: 10 }} /> : <Clock style={{ width: 10, height: 10 }} />}
                        {isBlocked ? 'Bloqueado' : allSigned ? 'Assinado' : `${signedCount}/${totalSigners}`}
                      </span>
                      {totalSigners > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 72, height: 4, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, background: statusColor, transition: 'width 0.4s' }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, color: pct === 100 ? '#16a34a' : '#94a3b8', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <ChevronRight style={{ width: 16, height: 16, color: '#cbd5e1', flexShrink: 0 }} />
                  </div>
                </div>
              );
            })}

            {filteredGeneratedDocumentsByFolder.length > 0 && (
              <div className="pt-2">
                <div className="px-4 pb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                  Documentos gerados
                </div>
                <div className="divide-y divide-slate-100">
                  {filteredGeneratedDocumentsByFolder.map((doc) => {
                    const isDraggingThisDoc =
                      draggingExplorer?.type === 'item' &&
                      draggingExplorer.itemType === 'generated_document' &&
                      draggingExplorer.id === doc.id;

                    return (
                      <button
                        key={doc.id}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          const explorerItem = explorerItemIndex.get(`generated_document:${doc.id}`);
                          setExplorerDragData(
                            e,
                            { type: 'item', item_type: 'generated_document', item_id: doc.id, created_by: explorerItem?.created_by },
                            e.currentTarget as HTMLElement
                          );
                        }}
                        onDragEnd={() => {
                          setIsDraggingExplorer(false);
                          setDragOverFolderId(null);
                          setDraggingExplorer(null);
                          if (dragImageElRef.current) {
                            try {
                              document.body.removeChild(dragImageElRef.current);
                            } catch {
                              // ignore
                            }
                            dragImageElRef.current = null;
                          }
                          releaseSuppressExplorerClick();
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const explorerItem = explorerItemIndex.get(`generated_document:${doc.id}`);
                          setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'generated_document', itemId: doc.id, createdBy: explorerItem?.created_by });
                        }}
                        onClick={() => {
                          if (suppressExplorerClickRef.current || isDraggingExplorer) return;
                          void handleSelectGeneratedDoc(doc);
                        }}
                        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition cursor-grab active:cursor-grabbing ${
                          isDraggingThisDoc ? 'opacity-60' : ''
                        } hover:bg-slate-50`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{doc.file_name}</div>
                          <div className="text-xs text-slate-500 truncate">{doc.client_name || '—'}</div>
                        </div>
                        <div className="text-xs text-slate-400 shrink-0">{formatDate(doc.created_at)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-4">
              {filteredRequestsByFolder.map((req) => {
                const allSigned = req.signers?.length > 0 && req.signers.every((s: Signer) => s.status === 'signed');
                const signedCount = req.signers?.filter((s: Signer) => s.status === 'signed').length || 0;
                const totalSigners = req.signers?.length || 0;
                const clientLabel = req.client_name || req.signers?.[0]?.name || 'Cliente não informado';
                const pct = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;
                const isInCloud = Boolean(cloudSyncStatusByRequestId[req.id]);

                const isBlocked = !!(req as any).blocked_at;
                const statusColor  = isBlocked ? '#ef4444' : allSigned ? '#16a34a' : '#d97706';
                const statusBg     = isBlocked ? '#fef2f2' : allSigned ? '#f0fdf4' : '#fffbeb';
                const statusBorder = isBlocked ? '#fecaca' : allSigned ? '#bbf7d0' : '#fde68a';
                const statusLabel  = isBlocked ? 'Bloqueado' : allSigned ? 'Assinado' : 'Aguardando';

                return (
                  <div
                    key={req.id}
                    draggable
                    onDragStart={(e) => {
                      const payload: any = { type: 'item', item_type: 'signature_request', item_id: req.id, created_by: req.created_by };
                      if (selectionMode && selectedRequestIds.size > 1 && selectedRequestIds.has(req.id)) {
                        payload.selected_request_ids = Array.from(selectedRequestIds);
                      }
                      setExplorerDragData(e, payload, e.currentTarget as HTMLElement);
                    }}
                    onDragEnd={() => {
                      setIsDraggingExplorer(false);
                      setDragOverFolderId(null);
                      setDraggingExplorer(null);
                      if (dragImageElRef.current) {
                        try { document.body.removeChild(dragImageElRef.current); } catch { /* ignore */ }
                        dragImageElRef.current = null;
                      }
                      releaseSuppressExplorerClick();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'signature_request', itemId: req.id, createdBy: req.created_by });
                    }}
                    onClick={() => {
                      if (suppressExplorerClickRef.current || isDraggingExplorer) return;
                      openDetails(req);
                    }}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <div
                      style={{
                        background: '#ffffff',
                        borderRadius: 14,
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 1px 4px rgba(15,23,42,0.07)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease',
                      }}
                      onMouseEnter={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.boxShadow = '0 12px 32px rgba(15,23,42,0.12), 0 2px 8px rgba(15,23,42,0.06)';
                        el.style.borderColor = '#c7d2da';
                        el.style.transform = 'translateY(-3px)';
                      }}
                      onMouseLeave={e => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.boxShadow = '0 1px 4px rgba(15,23,42,0.07)';
                        el.style.borderColor = '#e2e8f0';
                        el.style.transform = 'translateY(0)';
                      }}
                    >
                      {/* ── Header strip ── */}
                      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        {/* Status badge */}
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '3px 9px', borderRadius: 20,
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                          color: statusColor, background: statusBg, border: `1px solid ${statusBorder}`,
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                          {statusLabel}
                        </span>

                        {/* Right controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {isInCloud && (
                            <span title="Pasta na nuvem criada" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                              <FolderOpen style={{ width: 11, height: 11, color: '#16a34a' }} />
                            </span>
                          )}
                          {selectionMode && (
                            <div onClick={e => e.stopPropagation()}>
                              <input type="checkbox" style={{ width: 14, height: 14, accentColor: '#ea580c', cursor: 'pointer' }}
                                checked={selectedRequestIds.has(req.id)} onChange={() => toggleSelectedRequestId(req.id)} />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Body ── */}
                      <div style={{ padding: '14px 14px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>

                        {/* Doc icon + title */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
                          {/* File icon */}
                          <div style={{ flexShrink: 0, width: 36, height: 44, borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, background: '#e2e8f0', borderBottomLeftRadius: 4 }} />
                            <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, background: '#fff', borderRadius: '0 0 0 4px', transform: 'translate(-1px, -1px)', border: '1px solid #e2e8f0' }} />
                            <FileSignature style={{ width: 14, height: 14, color: '#ea580c', marginTop: 4 }} />
                            <span style={{ fontSize: 7, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.05em', marginTop: 2 }}>PDF</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#0f172a', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>
                              {req.document_name}
                            </p>
                          </div>
                        </div>

                        {/* Client */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12 }}>
                          <User style={{ width: 11, height: 11, color: '#94a3b8', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientLabel}</span>
                        </div>

                        {/* Tags */}
                        {(req.process_id || req.requirement_id) && (
                          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                            {req.process_id && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                <FileText style={{ width: 9, height: 9 }} />Processo
                              </span>
                            )}
                            {req.requirement_id && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa' }}>
                                <FileText style={{ width: 9, height: 9 }} />Req.
                              </span>
                            )}
                          </div>
                        )}

                        {/* Signatários avatars */}
                        {req.signers && req.signers.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              {req.signers.slice(0, 4).map((s: Signer, i: number) => {
                                const initials = s.name.split(' ').slice(0, 2).map((n: string) => n[0]).join('').toUpperCase();
                                const signed = s.status === 'signed';
                                return (
                                  <div key={s.id} title={`${s.name} — ${signed ? 'Assinou' : 'Aguardando'}`} style={{
                                    width: 24, height: 24, borderRadius: '50%',
                                    background: signed ? '#dcfce7' : '#f1f5f9',
                                    border: `2px solid ${signed ? '#16a34a' : '#cbd5e1'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 8, fontWeight: 800, color: signed ? '#15803d' : '#64748b',
                                    marginLeft: i > 0 ? -6 : 0, zIndex: req.signers.length - i,
                                    position: 'relative',
                                  }}>
                                    {initials}
                                  </div>
                                );
                              })}
                              {req.signers.length > 4 && (
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#f1f5f9', border: '2px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#94a3b8', marginLeft: -6 }}>
                                  +{req.signers.length - 4}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>
                              {signedCount}/{totalSigners} {totalSigners === 1 ? 'assinante' : 'assinantes'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* ── Footer ── */}
                      <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f5f9', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>{formatDate(req.created_at)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                          {totalSigners > 0 && (
                            <>
                              <div style={{ flex: 1, maxWidth: 72, height: 4, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                                <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, background: statusColor, transition: 'width 0.4s' }} />
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, color: pct === 100 ? '#16a34a' : '#94a3b8', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredGeneratedDocumentsByFolder.length > 0 && (
              <div className="mt-6">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Documentos gerados
                </div>
                <div className="grid grid-cols-1 @sm:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-4">
                  {filteredGeneratedDocumentsByFolder.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        const explorerItem = explorerItemIndex.get(`generated_document:${doc.id}`);
                        setExplorerDragData(
                          e,
                          { type: 'item', item_type: 'generated_document', item_id: doc.id, created_by: explorerItem?.created_by },
                          e.currentTarget as HTMLElement
                        );
                      }}
                      onDragEnd={() => {
                        setIsDraggingExplorer(false);
                        setDragOverFolderId(null);
                        setDraggingExplorer(null);
                        if (dragImageElRef.current) {
                          try {
                            document.body.removeChild(dragImageElRef.current);
                          } catch {
                            // ignore
                          }
                          dragImageElRef.current = null;
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const explorerItem = explorerItemIndex.get(`generated_document:${doc.id}`);
                        setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'generated_document', itemId: doc.id, createdBy: explorerItem?.created_by });
                      }}
                      onClick={() => void handleSelectGeneratedDoc(doc)}
                      className="rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] p-4 text-left shadow-sm ring-1 ring-black/5 hover:shadow-md hover:border-slate-300 transition cursor-grab active:cursor-grabbing"
                    >
                      <div className="text-xs text-slate-500 truncate">{formatDate(doc.created_at)}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 line-clamp-2">{doc.file_name}</div>
                      <div className="mt-1 text-xs text-slate-600 truncate">{doc.client_name || '—'}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

        </div>
      </div>

      <Modal
        open={!!deleteFolderTarget}
        onClose={() => setDeleteFolderTarget(null)}
        title="Remover pasta"
        eyebrow="Explorer"
        subtitle={deleteFolderTarget?.name}
        size="sm"
        zIndex={70}
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteFolderTarget(null)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500"
            >
              Cancelar
            </button>
          </div>
        }
      >
        <ModalBody className="space-y-3">
          <div className="text-sm text-slate-600">
            O que você deseja fazer com os itens dentro desta pasta?
          </div>
          {deleteFolderTarget && (
            <>
              <button
                type="button"
                onClick={() => void handleDeleteFolder({ folder: deleteFolderTarget, mode: 'move_root' })}
                disabled={deleteFolderSaving !== null}
                className="w-full rounded-2xl border border-[#e7e5df] bg-[#f8f7f5] px-4 py-4 text-left hover:bg-slate-50 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">Mover itens para "Sem pasta"</div>
                  {deleteFolderSaving === 'move_root' && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
                </div>
                <div className="text-xs text-slate-500 mt-1">Remove apenas a pasta. Os itens ficam na raiz do Explorer.</div>
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteFolder({ folder: deleteFolderTarget, mode: 'delete_all' })}
                disabled={deleteFolderSaving !== null}
                className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-left hover:bg-red-100 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-red-800">Excluir tudo</div>
                  {deleteFolderSaving === 'delete_all' && <Loader2 className="w-4 h-4 animate-spin text-red-700" />}
                </div>
                <div className="text-xs text-red-700/80 mt-1">Tenta remover também os itens que você criou.</div>
              </button>
            </>
          )}
        </ModalBody>
      </Modal>

      <Modal
        open={createFolderModalOpen}
        onClose={() => setCreateFolderModalOpen(false)}
        title="Nova pasta"
        eyebrow="Explorer"
        subtitle={createFolderParentId ? `Em: ${folderPathLabelById.get(createFolderParentId) || '—'}` : undefined}
        size="sm"
        zIndex={70}
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setCreateFolderModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={createFolderSaving || !createFolderName.trim()}
              onClick={() => void handleSubmitCreateFolder()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
            >
              {createFolderSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar
            </button>
          </div>
        }
      >
        <ModalBody className="space-y-2">
          <label className="text-xs font-semibold text-slate-500">Nome da pasta</label>
          <input
            autoFocus
            value={createFolderName}
            onChange={(e) => setCreateFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmitCreateFolder();
            }}
            className="w-full rounded-xl border border-[#e7e5df] bg-[#f8f7f5] px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
            placeholder="Ex: Clientes, Contratos..."
          />
        </ModalBody>
      </Modal>

      {contextMenu && (
        <div
          className="fixed z-[80]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-56 rounded-xl border border-[#e7e5df] bg-[#f8f7f5] shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setMoveTarget({ itemType: contextMenu.itemType, itemId: contextMenu.itemId, createdBy: contextMenu.createdBy });
                const current = explorerItemIndex.get(`${contextMenu.itemType}:${contextMenu.itemId}`);
                setMoveSelectedFolderId(current?.folder_id ?? null);
                setMoveModalOpen(true);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Mover...
            </button>
          </div>
        </div>
      )}

      <Modal
        open={moveModalOpen && !!moveTarget}
        onClose={() => setMoveModalOpen(false)}
        title="Mover item"
        eyebrow="Explorer"
        size="md"
        zIndex={70}
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500 truncate">
              {moveSelectedFolderId ? `Destino: ${folderPathLabelById.get(moveSelectedFolderId) || '—'}` : 'Destino: Sem pasta'}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setMoveModalOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!user?.id || !moveTarget) return;
                  setMoveSaving(true);
                  try {
                    await handleMoveItemToFolder({ itemType: moveTarget.itemType, itemId: moveTarget.itemId, folderId: moveSelectedFolderId });
                  } finally {
                    setMoveSaving(false);
                  }
                  setMoveModalOpen(false);
                }}
                disabled={moveSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
              >
                {moveSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Mover
              </button>
            </div>
          </div>
        }
      >
        <ModalBody>
          <div className="text-xs font-semibold text-slate-500 mb-2">Destino</div>
          <div className="max-h-72 overflow-y-auto rounded-2xl border border-[#e7e5df]">
            <button
              type="button"
              onClick={() => setMoveSelectedFolderId(null)}
              className={`relative w-full px-4 py-3 text-left text-sm font-medium transition ${
                moveSelectedFolderId === null
                  ? 'bg-orange-50 text-slate-900'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              {moveSelectedFolderId === null && (
                <span className="absolute left-0 top-0 h-full w-1.5 bg-orange-500" />
              )}
              Sem pasta
            </button>
            {explorerFolders
              .slice()
              .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setMoveSelectedFolderId(f.id)}
                  className={`relative w-full px-4 py-3 text-left text-sm transition ${
                    moveSelectedFolderId === f.id
                      ? 'bg-orange-50 text-slate-900'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  title={folderPathLabelById.get(f.id) || f.name}
                >
                  {moveSelectedFolderId === f.id && (
                    <span className="absolute left-0 top-0 h-full w-1.5 bg-orange-500" />
                  )}
                  {folderPathLabelById.get(f.id) || f.name}
                </button>
              ))}
          </div>
        </ModalBody>
      </Modal>

      {/* ── Modal: Excluir documento (com opção de bloquear) ── */}
      <Modal
        open={!!deleteModalTarget}
        onClose={() => setDeleteModalTarget(null)}
        title="Remover documento"
        subtitle={deleteModalTarget?.name}
        icon={<Trash2 className="w-5 h-5" />}
        size="sm"
        zIndex={60}
        footer={
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteModalTarget(null)}
              className="flex-1 rounded-xl border border-[#e7e5df] bg-[#f8f7f5] py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Cancelar
            </button>
            <button
              onClick={confirmDeleteRequest}
              disabled={deleteLoading}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ background: deleteAlsoBlock ? '#dc2626' : '#ea580c' }}
            >
              {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : deleteAlsoBlock ? 'Remover e bloquear' : 'Remover'}
            </button>
          </div>
        }
      >
        <ModalBody className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            O documento será movido para a lixeira. O link de assinatura pública será invalidado. O PDF assinado permanece preservado e consultável pelo código.
          </p>

          {/* Opção: bloquear também */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-[#e7e5df] bg-slate-50 cursor-pointer hover:bg-orange-50 hover:border-orange-200 transition-colors">
            <input
              type="checkbox"
              checked={deleteAlsoBlock}
              onChange={(e) => setDeleteAlsoBlock(e.target.checked)}
              className="mt-0.5 accent-orange-500 w-4 h-4 flex-shrink-0"
            />
            <div>
              <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-orange-500" />
                Bloquear também
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Impede a validação pública pelo código de autenticação. Útil quando o documento foi revogado ou houve erro.
              </p>
            </div>
          </label>
        </ModalBody>
      </Modal>

      {/* ── Modal: Documentos excluídos (lixeira) ── */}
      <Modal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        title="Documentos excluídos"
        subtitle={`${archivedList.length} ${archivedList.length === 1 ? 'documento' : 'documentos'} na lixeira`}
        icon={<Trash2 className="w-5 h-5" />}
        size="lg"
        zIndex={50}
        headerActions={
          <button
            onClick={() => void loadArchived()}
            disabled={archivedLoading}
            title="Atualizar"
            className="w-8 h-8 rounded-lg border border-[#e7e5df] bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 transition disabled:opacity-50"
          >
            <RotateCcw style={{ width: 14, height: 14, animation: archivedLoading ? 'spin 1s linear infinite' : undefined }} />
          </button>
        }
        footer={
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isAdmin
              ? '⚠️ Excluir definitivamente apaga o registro e TODOS os arquivos do servidor. Ação irreversível.'
              : 'Documentos restaurados voltam ao painel e ficam disponíveis normalmente.'}
          </p>
        }
      >
        <div>{/* search + bulk bar + list */}

            {/* Search */}
            {archivedList.length > 0 && (
              <div style={{ padding: '8px 20px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
                <div style={{ position: 'relative' }}>
                  <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94a3b8', pointerEvents: 'none' }} />
                  <input
                    type="text"
                    placeholder="Buscar na lixeira..."
                    value={trashSearch}
                    onChange={e => setTrashSearch(e.target.value)}
                    style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 12, color: '#0f172a', outline: 'none', boxSizing: 'border-box' }}
                    onFocus={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#ea580c'; }}
                    onBlur={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                  {trashSearch && (
                    <button
                      onClick={() => setTrashSearch('')}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'flex' }}
                    >
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Barra de seleção em massa */}
            {archivedList.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', flexShrink: 0 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={trashSelected.size === archivedList.length && archivedList.length > 0}
                    onChange={toggleSelectAll}
                    style={{ width: 16, height: 16, accentColor: '#ea580c', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                    {trashSelected.size === 0 ? 'Selecionar todos' : `${trashSelected.size} selecionado(s)`}
                  </span>
                </label>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {trashSelected.size > 0 && (
                    <>
                      <button
                        onClick={handleBulkRestore}
                        disabled={trashBulkLoading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: trashBulkLoading ? 0.5 : 1 }}
                      >
                        {trashBulkLoading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <RotateCcw style={{ width: 13, height: 13 }} />}
                        Restaurar
                      </button>
                      {isAdmin && (
                        <button
                          onClick={handleBulkPermanentDelete}
                          disabled={trashBulkLoading}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: trashBulkLoading ? 0.5 : 1 }}
                        >
                          {trashBulkLoading ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Trash2 style={{ width: 13, height: 13 }} />}
                          Excluir
                        </button>
                      )}
                    </>
                  )}
                  {isAdmin && trashSelected.size === 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <Shield style={{ width: 12, height: 12 }} />Admin
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Lista */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {archivedLoading ? (
                <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#94a3b8' }}>
                  <Loader2 style={{ width: 24, height: 24 }} className="animate-spin" />
                  <span style={{ fontSize: 13 }}>Carregando...</span>
                </div>
              ) : archivedList.length === 0 ? (
                <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 style={{ width: 24, height: 24, color: '#cbd5e1' }} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>Nenhum documento excluído</p>
                </div>
              ) : (() => {
                const filteredArchived = trashSearch.trim()
                  ? archivedList.filter(r =>
                      (r.document_name || '').toLowerCase().includes(trashSearch.toLowerCase()) ||
                      (r.client_name || '').toLowerCase().includes(trashSearch.toLowerCase())
                    )
                  : archivedList;
                if (filteredArchived.length === 0) return (
                  <div style={{ padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <Search style={{ width: 24, height: 24, color: '#cbd5e1' }} />
                    <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>Nenhum resultado para "{trashSearch}"</p>
                  </div>
                );
                return filteredArchived.map((r, idx) => {
                  const isSelected = trashSelected.has(r.id);
                  const isBlocked = !!(r as any).blocked_at;
                  const isSigned = r.signers.length > 0 && r.signers.every(s => s.status === 'signed');
                  return (
                    <div
                      key={r.id}
                      onClick={() => toggleTrashSelect(r.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 20px',
                        borderBottom: idx < archivedList.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: isSelected ? '#fff7ed' : '#fff',
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTrashSelect(r.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 16, height: 16, accentColor: '#ea580c', cursor: 'pointer', flexShrink: 0 }}
                      />

                      {/* Info — flex:1 com minWidth:0 para truncar corretamente */}
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {/* Badges */}
                        {(isSigned || isBlocked) && (
                          <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                            {isSigned && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, background: '#f0fdf4', color: '#16a34a', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <CheckCircle style={{ width: 9, height: 9 }} />Assinado
                              </span>
                            )}
                            {isBlocked && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, background: '#fef2f2', color: '#dc2626', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Lock style={{ width: 9, height: 9 }} />Bloqueado
                              </span>
                            )}
                          </div>
                        )}
                        {/* Título */}
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.document_name || 'Sem título'}
                        </p>
                        {/* Meta */}
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.client_name ? <span style={{ color: '#64748b', fontWeight: 500 }}>{r.client_name}</span> : null}
                          {r.client_name ? ' · ' : ''}
                          Excluído em {r.archived_at ? new Date(r.archived_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </p>
                      </div>

                      {/* Botões */}
                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => handleRestore(r.id)}
                          title="Restaurar para o painel"
                          style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <RotateCcw style={{ width: 14, height: 14 }} />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handlePermanentDelete(r)}
                            title="Excluir definitivamente do servidor"
                            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                          >
                            <Trash2 style={{ width: 14, height: 14 }} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

        </div>
      </Modal>

      <Modal
        open={!!detailsRequest}
        onClose={() => {
          detailsRequestIdRef.current = null;
          detailsLoadTokenRef.current += 1;
          setAuditLogLoading(false);
          setAuditLog([]);
          setSignerImages({});
          setDetailsRequest(null);
        }}
        title={detailsRequest?.document_name ?? ''}
        eyebrow="Assinatura Digital"
        subtitle={detailsRequest ? [
          formatDate(detailsRequest.created_at),
          detailsRequest.client_name,
          detailsRequest.process_number,
        ].filter(Boolean).join(' · ') : undefined}
        size="lg"
        zIndex={50}
        headerActions={detailsRequest ? (
          <div className="flex items-center gap-2">
            {detailsRequest.signers.every(s => s.status === 'signed') ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide" style={{ border: '1px solid #bbf7d0' }}>
                <CheckCircle className="w-3 h-3" />Concluído
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase tracking-wide" style={{ border: '1px solid #fde68a' }}>
                <Clock className="w-3 h-3" />{detailsRequest.signers.filter(s => s.status === 'pending').length} pendente(s)
              </span>
            )}
            {(detailsRequest as any).signature_model === 'per_document' && (
              <button
                onClick={() => handleDeleteRequest(detailsRequest.id)}
                title="Excluir"
                className="flex items-center justify-center w-7 h-7 rounded-lg transition"
                style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#ffe4e6')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff1f2')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : undefined}
      >
        {detailsRequest && (<>
            {/* ── Banner de bloqueio ── */}
            {(detailsRequest as any).blocked_at && (
              <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#fee2e2' }}>
                    <Lock className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-red-700 leading-none">Validação pública bloqueada</p>
                    <p className="text-[11px] text-red-500 mt-0.5">O QR Code e o link de verificação estão desativados para este documento.</p>
                  </div>
                </div>
                <button
                  onClick={() => handleUnblockRequest(detailsRequest)}
                  disabled={blockLoading}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50"
                  style={{ background: '#ffffff', border: '1px solid #fca5a5', color: '#dc2626' }}
                >
                  {blockLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <LockOpen className="w-3 h-3" />}
                  Desbloquear
                </button>
              </div>
            )}

            <div className="overflow-hidden">

              {/* ── Ações principais ── */}
              <div className="px-5 py-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
                {(detailsRequest as any).signature_model !== 'per_document' && (
                <div className="flex gap-2.5">
                  {detailsRequest.document_path && (
                    <button
                      disabled={viewDocLoading}
                      onClick={async () => {
                        try {
                          setViewDocLoading(true);

                          // Modelo per_document: abre o documento PRINCIPAL assinado
                          // individual (signature_request_documents). A lista completa
                          // com cada documento fica na seção "Documentos assinados".
                          if ((detailsRequest as any).signature_model === 'per_document') {
                            const docs = await signatureService.listRequestDocuments(detailsRequest.id);
                            const signedDocs = docs.filter((d) => d.signed_file_path);
                            const target = signedDocs.find((d) => d.document_type === 'main') || signedDocs[0];
                            if (!target) {
                              toast.error('Nenhum documento assinado disponível ainda.');
                              return;
                            }
                            const url = await pdfSignatureService.getSignedPdfUrl(target.signed_file_path!);
                            if (url) window.open(url, '_blank');
                            else toast.error('Não foi possível abrir o PDF assinado');
                            return;
                          }

                          // Buscar dados atualizados do banco
                          const freshRequest = await signatureService.getRequestWithSigners(detailsRequest.id);
                          if (!freshRequest) {
                            toast.error('Erro ao carregar dados do documento');
                            return;
                          }

                          const signedSigner = [...freshRequest.signers]
                            .filter(s => s.status === 'signed')
                            .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime())[0];
                          const docPathLower = (freshRequest.document_path || '').toLowerCase();
                          const isDocxFile = docPathLower.endsWith('.docx') || docPathLower.endsWith('.doc');
                          
                          // Se tem signatário assinado
                          if (signedSigner) {
                            // Verificar se já existe PDF assinado salvo no bucket 'assinados'
                            if (signedSigner.signed_document_path) {
                              const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedSigner.signed_document_path);
                              if (signedUrl) {
                                console.log('[VIEW] Usando PDF já salvo:', signedSigner.signed_document_path);
                                window.open(signedUrl, '_blank');
                                return;
                              }
                            }
                            
                            // Se não existe, gerar, salvar e abrir
                            // Importante: se for DOCX, renderizar offscreen e converter para PDF completo
                            if (isDocxFile) {
                              toast.info('Gerando documento DOCX assinado...');
                              const freshSigner = await signatureService.getSignerById(signedSigner.id);
                              if (!freshSigner) {
                                toast.error('Erro ao carregar dados do signatário');
                                return;
                              }
                              
                              try {
                                // Renderizar DOCX offscreen
                                const ensureOffscreenDocxStyle = () => {
                                  const styleId = 'docx-offscreen-style-view';
                                  if (document.getElementById(styleId)) return;
                                  const style = document.createElement('style');
                                  style.id = styleId;
                                  style.textContent = `
                                    .docx-wrapper {
                                      background: #ffffff !important;
                                      padding: 0 !important;
                                    }
                                    .docx-wrapper > section,
                                    .docx-wrapper article,
                                    .docx-wrapper .docx {
                                      width: 794px !important;
                                      min-width: 794px !important;
                                      max-width: 794px !important;
                                      background: #ffffff !important;
                                    }
                                    /* Impede quebra de palavra no meio (overflow-wrap/hyphens
                                       do docx-preview) que partia "Trabalhista" no PDF. */
                                    .docx-wrapper,
                                    .docx-wrapper *,
                                    .docx-wrapper p,
                                    .docx-wrapper span {
                                      overflow-wrap: normal !important;
                                      word-wrap: normal !important;
                                      word-break: normal !important;
                                      hyphens: none !important;
                                      -webkit-hyphens: none !important;
                                    }
                                  `;
                                  document.head.appendChild(style);
                                };

                                const renderDocxOffscreen = async (docxUrl: string) => {
                                  ensureOffscreenDocxStyle();
                                  const res = await fetch(docxUrl);
                                  if (!res.ok) throw new Error(`Falha ao baixar DOCX: HTTP ${res.status}`);
                                  const blob = await res.blob();

                                  const host = document.createElement('div');
                                  host.style.position = 'fixed';
                                  host.style.left = '-100000px';
                                  host.style.top = '0';
                                  host.style.width = '794px';
                                  host.style.background = '#ffffff';
                                  host.style.zIndex = '-1';
                                  host.style.pointerEvents = 'none';
                                  document.body.appendChild(host);

                                  await renderAsync(blob, host, undefined, {
                                    className: 'docx-wrapper',
                                    inWrapper: true,
                                    ignoreWidth: false,
                                    ignoreHeight: true,   // permitir altura contínua
                                    breakPages: false,    // renderizar como bloco contínuo — nós fatiamos
                                    renderHeaders: true,
                                    renderFooters: true,
                                    renderFootnotes: true,
                                  });

                                  await new Promise(r => setTimeout(r, 500));
                                  return host;
                                };

                                const mainDocUrl = await signatureService.getDocumentPreviewUrl(freshRequest.document_path!);
                                if (!mainDocUrl) {
                                  toast.error('Erro ao obter URL do documento');
                                  return;
                                }

                                const mainHost = await renderDocxOffscreen(mainDocUrl);
                                
                                try {
                                  const fieldsOverride = await signatureFieldsService.listByRequest(freshRequest.id);
                                  
                                  const { filePath: signedPdfPath, sha256 } = await pdfSignatureService.saveSignedDocxAsPdf({
                                    request: freshRequest,
                                    signer: freshSigner,
                                    creator: null,
                                    docxContainer: mainHost,
                                    attachmentDocxItems: [],
                                    attachmentPdfItems: [],
                                    fieldsOverride,
                                  });
                                  
                                  await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: sha256 });
                                  const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
                                  if (signedUrl) window.open(signedUrl, '_blank');
                                  else toast.error('Erro ao abrir documento assinado');
                                } finally {
                                  try { mainHost.remove(); } catch { /* noop */ }
                                }
                              } catch (e) {
                                console.error('[VIEW] Erro ao gerar PDF do DOCX:', e);
                                toast.error('Erro ao gerar documento. Gerando relatório...');
                                // Fallback: gerar apenas relatório
                                const { filePath: signedPdfPath, sha256 } = await pdfSignatureService.saveSignatureReportToStorage({
                                  request: freshRequest,
                                  signer: freshSigner,
                                  creator: null,
                                });
                                await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: sha256 });
                                const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
                                if (signedUrl) window.open(signedUrl, '_blank');
                                else toast.error('Erro ao abrir relatório');
                              }
                              return;
                            }

                            toast.info('Gerando documento assinado...');
                            const originalUrl = await signatureService.getDocumentPreviewUrl(freshRequest.document_path!);
                            if (!originalUrl) {
                              toast.error('Erro ao obter documento original');
                              return;
                            }
                            
                            const freshSigner = await signatureService.getSignerById(signedSigner.id);
                            if (!freshSigner) {
                              toast.error('Erro ao carregar dados do signatário');
                              return;
                            }
                            
                            // Gerar e salvar PDF no bucket 'assinados'
                            const attachmentPaths = (freshRequest as any).attachment_paths as string[] | null | undefined;
                            const attachmentPdfItems: { documentId: string; url: string }[] = [];
                            for (let i = 0; i < (attachmentPaths ?? []).length; i++) {
                              const p = attachmentPaths?.[i];
                              if (!p || !p.toLowerCase().endsWith('.pdf')) continue;
                              const u = await signatureService.getDocumentPreviewUrl(p);
                              if (u) attachmentPdfItems.push({ documentId: `attachment-${i}`, url: u });
                            }

                            const { filePath: signedPdfPath, sha256 } = await pdfSignatureService.saveSignedPdfToStorage({
                              request: freshRequest,
                              signer: freshSigner,
                              originalPdfUrl: originalUrl,
                              creator: null,
                              attachmentPdfItems,
                            });
                            
                            // Atualizar o signer com o path do PDF assinado
                            await signatureService.updateSignerSignedDocumentMeta(freshSigner.id, { signed_document_path: signedPdfPath, signed_pdf_sha256: sha256 });
                            
                            // Abrir o PDF salvo
                            const signedUrl = await pdfSignatureService.getSignedPdfUrl(signedPdfPath);
                            if (signedUrl) {
                              window.open(signedUrl, '_blank');
                            } else {
                              toast.error('Erro ao abrir documento assinado');
                            }
                            return;
                          }
                          
                          // Se não está assinado, mostrar documento original
                          const url = await signatureService.getDocumentPreviewUrl(detailsRequest.document_path!);
                          if (url) window.open(url, '_blank');
                          else toast.error('Erro ao obter URL do documento');
                        } catch (e) {
                          console.error('Erro ao abrir documento:', e);
                          toast.error('Erro ao abrir documento');
                        } finally {
                          setViewDocLoading(false);
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-70 disabled:cursor-wait"
                    >
                      {viewDocLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" />Abrindo...</>
                      ) : (
                        <><Eye className="w-3.5 h-3.5" />{detailsRequest.signers.some(s => s.status === 'signed') ? ((detailsRequest as any).signature_model === 'per_document' ? 'Ver principal' : 'Ver assinado') : 'Visualizar'}</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDownloadDocument(detailsRequest)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition"
                    style={{ background: '#0f172a', color: '#ffffff' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#0f172a')}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar
                  </button>
                  <button
                    onClick={() => handleDeleteRequest(detailsRequest.id)}
                    className="flex items-center justify-center px-3 py-2.5 rounded-xl text-sm transition ml-auto"
                    style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#ffe4e6')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff1f2')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                )}

                {detailsRequest.signers.every((s) => s.status === 'signed') && (
                  <div className={(detailsRequest as any).signature_model === 'per_document' ? '' : 'mt-3 pt-3'} style={(detailsRequest as any).signature_model === 'per_document' ? undefined : { borderTop: '1px solid #f1f5f9' }}>
                    <div className="flex flex-nowrap items-center gap-x-3 overflow-x-auto scrollbar-hide">
                      <button
                        disabled={openProcessLoading}
                        onClick={async () => {
                          if (openProcessLoading) return;
                          try {
                            setOpenProcessLoading(true);
                            if (detailsRequest.process_id) {
                              setDetailsRequest(null);
                              navigateTo('processos', { mode: 'details', entityId: detailsRequest.process_id } as any);
                              return;
                            }
                            setShowCreateProcess((v) => !v);
                          } catch (e) {
                            console.error('Erro ao abrir processo:', e);
                            toast.error('Erro ao abrir processo');
                          } finally {
                            setOpenProcessLoading(false);
                          }
                        }}
                        className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-60"
                      >
                        {openProcessLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : detailsRequest.process_id ? <ExternalLink className="w-3.5 h-3.5" /> : showCreateProcess ? <EyeOff className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        <span className="group-hover:underline underline-offset-2">
                          {detailsRequest.process_id ? 'Abrir processo' : (showCreateProcess ? 'Ocultar' : 'Criar processo')}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          if (!detailsRequest.client_id) {
                            toast.error('Vincule um cliente para criar o requerimento.');
                            return;
                          }
                          const cpf = detailsRequest.signers.find((s) => s.cpf)?.cpf || undefined;
                          setDetailsRequest(null);
                          navigateTo('requerimentos', { mode: 'create', prefill: { client_id: detailsRequest.client_id, beneficiary: detailsRequest.client_name || undefined, cpf, signature_id: detailsRequest.id } } as any);
                        }}
                        className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span className="group-hover:underline underline-offset-2">Requerimento</span>
                      </button>
                      <button
                        disabled={copyToCloudLoading}
                        onClick={() => handleCopySignedDocumentToCloud(detailsRequest)}
                        className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-60"
                      >
                        {copyToCloudLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderOpen className="w-3.5 h-3.5" />}
                        <span className="group-hover:underline underline-offset-2">{copyToCloudLoading ? 'Copiando...' : 'Criar pasta'}</span>
                      </button>
                      {detailsRequest.public_token && (
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/#/documento/${detailsRequest.public_token}`;
                            navigator.clipboard.writeText(url).then(() => toast.success('Link público copiado!'));
                          }}
                          className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span className="group-hover:underline underline-offset-2">Página pública</span>
                        </button>
                      )}
                      {detailsRequest.signers.some(s => s.status === 'signed') && (
                        <button
                          disabled={sendEmailLoading}
                          onClick={async () => {
                            try {
                              setSendEmailLoading(true);
                              const { sent, failed } = await signatureService.sendSignatureLinkEmail(detailsRequest.id, true);
                              if (sent.length > 0) {
                                toast.success(`E-mail enviado para ${sent.length} signatário(s)!`);
                              }
                              if (failed.length > 0) {
                                toast.error(`Falha ao enviar para ${failed.length} endereço(s).`);
                              }
                            } catch (e: any) {
                              toast.error(e.message || 'Erro ao enviar e-mail');
                            } finally {
                              setSendEmailLoading(false);
                            }
                          }}
                          className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-50"
                        >
                          {sendEmailLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                          <span className="group-hover:underline underline-offset-2">{sendEmailLoading ? 'Enviando...' : 'Enviar ao cliente'}</span>
                        </button>
                      )}
                      {detailsRequest.signers.some(s => s.status === 'signed') && (
                        <button
                          type="button"
                          onClick={() => setDossierTarget({ requestId: detailsRequest.id, documentName: detailsRequest.document_name })}
                          className="group flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-orange-600 transition-colors whitespace-nowrap flex-shrink-0"
                          title="Abrir dossiê probatório completo"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          <span className="group-hover:underline underline-offset-2">Dossiê probatório</span>
                        </button>
                      )}
                    </div>

                    {showCreateProcess && !detailsRequest.process_id && (
                      <div className="mt-3 p-4 rounded-xl bg-slate-50 border border-[#e7e5df]">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Novo Processo</p>
                        <div className="flex flex-col @sm:flex-row gap-2 @sm:gap-3">
                          <select
                            value={createProcessArea}
                            onChange={(e) => setCreateProcessArea(e.target.value as ProcessPracticeArea)}
                            className="w-full @sm:w-auto px-3 py-2 border border-[#e7e5df] rounded-lg text-sm font-medium text-slate-700 bg-[#f8f7f5] focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all"
                          >
                            <option value="trabalhista">Trabalhista</option>
                            <option value="familia">Família</option>
                            <option value="consumidor">Consumidor</option>
                            <option value="previdenciario">Previdenciário</option>
                            <option value="civel">Cível</option>
                          </select>
                          <button
                            disabled={createProcessLoading}
                            onClick={async () => {
                              if (!detailsRequest.client_id) {
                                toast.error('Vincule um cliente para criar o processo.');
                                return;
                              }
                              try {
                                setCreateProcessLoading(true);
                                const created = await processService.createProcess({
                                  client_id: detailsRequest.client_id,
                                  process_code: (detailsRequest.process_number || '').trim(),
                                  status: 'aguardando_confeccao',
                                  practice_area: createProcessArea,
                                  priority: createProcessUrgent ? 'urgente' : 'normal',
                                  notes: `Origem: Assinatura ${detailsRequest.document_name}`,
                                } as any);

                                await signatureService.updateRequest(detailsRequest.id, {
                                  process_id: created.id,
                                  process_number: created.process_code || detailsRequest.process_number || null,
                                });

                                setShowCreateProcess(false);
                                setDetailsRequest(null);
                                navigateTo('processos', { mode: 'details', entityId: created.id } as any);
                                toast.success('Processo criado (Aguardando confecção).');
                              } catch (err: any) {
                                console.error(err);
                                toast.error(err.message || 'Não foi possível criar o processo.');
                              } finally {
                                setCreateProcessLoading(false);
                              }
                            }}
                            className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-70 disabled:cursor-wait w-full sm:w-auto"
                          >
                            {createProcessLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Criando...</> : <><Plus className="w-4 h-4" />Criar</>}
                          </button>
                        </div>
                        <label className="mt-3 flex items-center gap-2 cursor-pointer w-fit">
                          <input
                            type="checkbox"
                            checked={createProcessUrgent}
                            onChange={(e) => setCreateProcessUrgent(e.target.checked)}
                            className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          />
                          <span className="text-sm font-medium text-red-700 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Marcar como urgente
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Content sections ── */}
              <div className="px-5 py-4 space-y-5">

              {/* Documentos */}
              {(() => {
                // Após a assinatura concluída, o artefato legal é o PDF assinado.
                // Os DOCX provisórios são apagados do servidor para economizar espaço,
                // então a lista passa a mostrar apenas o PDF assinado.
                const allSigned = detailsRequest.signers.length > 0 && detailsRequest.signers.every(s => s.status === 'signed');
                const signedSigner = [...detailsRequest.signers]
                  .filter(s => s.status === 'signed')
                  .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime())[0];
                const signedPath = signedSigner?.signed_document_path || null;

                // Modelo per_document: lista os PDFs assinados INDIVIDUAIS do envelope,
                // cada um com seu código de verificação e download próprio.
                if ((detailsRequest as any).signature_model === 'per_document' && allSigned && detailsDocuments.length > 0) {
                  const openDoc = async (path: string | null | undefined, name: string, download: boolean) => {
                    if (!path) { toast.error('PDF assinado indisponível'); return; }
                    try {
                      const url = await pdfSignatureService.getSignedPdfUrl(path);
                      if (!url) { toast.error('Não foi possível abrir o PDF assinado'); return; }
                      if (download) await downloadOriginalPdf(url, `${name}_assinado.pdf`);
                      else window.open(url, '_blank');
                    } catch { toast.error('Erro'); }
                  };
                  return (
                    <section>
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Documentos assinados ({detailsDocuments.length})</p>
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                            <FileSignature style={{ width: 9, height: 9 }} />Envelope · validação por arquivo
                          </span>
                        </div>
                        {detailsDocuments.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDownloadAllSignedAsZip(detailsRequest)}
                            disabled={downloadZipLoading}
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-70 disabled:cursor-wait"
                          >
                            {downloadZipLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            {downloadZipLoading ? 'Montando ZIP...' : 'Baixar tudo em ZIP'}
                          </button>
                        )}
                      </div>
                      {(detailsRequest as any).envelope_verification_code && (
                        <p className="mb-1.5 font-mono text-[10px] text-slate-400">
                          Envelope: {(detailsRequest as any).envelope_verification_code}
                        </p>
                      )}
                      <div className="space-y-1">
                        {detailsDocuments.map((doc) => (
                          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                            <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <FileSignature style={{ width: 13, height: 13, color: '#16a34a' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.display_name || doc.document_key}</p>
                              <p style={{ fontSize: 10, color: '#16a34a', margin: 0, fontWeight: 600 }}>
                                {doc.document_type === 'main' ? 'Principal' : 'Anexo'} · {doc.verification_code || 's/ código'}
                              </p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                              <button type="button" onClick={() => openDoc(doc.signed_file_path, doc.display_name || doc.document_key, false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                <Eye style={{ width: 11, height: 11 }} />Ver
                              </button>
                              <button type="button" onClick={() => openDoc(doc.signed_file_path, doc.display_name || doc.document_key, true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#ea580c', background: '#fff7ed', border: '1px solid #fed7aa', cursor: 'pointer' }}>
                                <Download style={{ width: 11, height: 11 }} />Baixar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                }

                if (allSigned && signedPath) {
                  const openSigned = async (download: boolean) => {
                    try {
                      const url = await pdfSignatureService.getSignedPdfUrl(signedPath);
                      if (!url) { toast.error('Não foi possível abrir o PDF assinado'); return; }
                      if (download) await downloadOriginalPdf(url, `${detailsRequest.document_name || 'documento'}_assinado.pdf`);
                      else window.open(url, '_blank');
                    } catch { toast.error('Erro'); }
                  };
                  return (
                    <section>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Documento (1)</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                        <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <FileSignature style={{ width: 13, height: 13, color: '#16a34a' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detailsRequest.document_name || 'Documento assinado'}</p>
                          <p style={{ fontSize: 10, color: '#16a34a', margin: 0, fontWeight: 600 }}>PDF assinado · certificado</p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <button type="button" onClick={() => openSigned(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                            <Eye style={{ width: 11, height: 11 }} />Ver
                          </button>
                          <button type="button" onClick={() => openSigned(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#ea580c', background: '#fff7ed', border: '1px solid #fed7aa', cursor: 'pointer' }}>
                            <Download style={{ width: 11, height: 11 }} />Baixar
                          </button>
                          {signedSigner && (
                            <button type="button" onClick={() => setReportTarget({ request: detailsRequest, signer: signedSigner })} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                              <Shield style={{ width: 11, height: 11 }} />Relatório
                            </button>
                          )}
                          {signedSigner && (
                            <button type="button" onClick={() => setDossierTarget({ requestId: detailsRequest.id, documentName: detailsRequest.document_name })} title="Dossiê probatório completo para instruir processo" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', cursor: 'pointer' }}>
                              <Shield style={{ width: 11, height: 11 }} />Dossiê probatório
                            </button>
                          )}
                          {(detailsRequest as any).blocked_at ? (
                            <button
                              type="button"
                              onClick={() => handleUnblockRequest(detailsRequest)}
                              disabled={blockLoading}
                              title="Desbloquear validação pública"
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', cursor: 'pointer', opacity: blockLoading ? 0.5 : 1 }}
                            >
                              <Lock style={{ width: 12, height: 12, color: '#dc2626' }} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleBlockRequest(detailsRequest)}
                              disabled={blockLoading}
                              title="Bloquear validação pública"
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer', opacity: blockLoading ? 0.5 : 1 }}
                            >
                              <LockOpen style={{ width: 12, height: 12, color: '#94a3b8' }} />
                            </button>
                          )}
                        </div>
                      </div>
                    </section>
                  );
                }

                const mainDoc = detailsRequest.document_path
                  ? [{ name: detailsRequest.document_name || 'Documento principal', path: detailsRequest.document_path, isMain: true }]
                  : [];
                const attachDocs = ((detailsRequest as any).attachment_paths as string[] | null | undefined ?? []).map((p, i) => {
                  const raw = p.split('/').pop() ?? `Anexo ${i + 1}`;
                  // Strip leading timestamp prefix like "1778704291856_" and internal ones like "_1778704291856_"
                  const cleaned = raw.replace(/^\d{10,}_/, '').replace(/_\d{10,}_/g, '_').replace(/_\d{10,}\./, '.');
                  return { name: cleaned || raw, path: p, isMain: false };
                });
                const allDocs = [...mainDoc, ...attachDocs];
                if (allDocs.length === 0) return null;
                return (
                  <section>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Documentos ({allDocs.length})</p>
                    <div className="space-y-1">
                      {allDocs.map((doc) => (
                        <div key={doc.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                          <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, background: doc.isMain ? '#fff7ed' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileText style={{ width: 13, height: 13, color: doc.isMain ? '#f97316' : '#94a3b8' }} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, fontWeight: 500, color: '#334155', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</p>
                            <p style={{ fontSize: 10, color: '#94a3b8', margin: 0 }}>{doc.isMain ? 'Principal' : 'Anexo'}</p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={async () => { try { const url = await signatureService.getDocumentPreviewUrl(doc.path); if (url) window.open(url, '_blank'); else toast.error('Não foi possível abrir'); } catch { toast.error('Erro'); } }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#64748b', background: '#ffffff', border: '1px solid #e2e8f0', cursor: 'pointer' }}
                            >
                              <Eye style={{ width: 11, height: 11 }} />Ver
                            </button>
                            <button
                              type="button"
                              onClick={async () => { try { const url = await signatureService.getDocumentPreviewUrl(doc.path); if (url) await downloadOriginalPdf(url, doc.name); else toast.error('Não foi possível baixar'); } catch { toast.error('Erro'); } }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#ea580c', background: '#fff7ed', border: '1px solid #fed7aa', cursor: 'pointer' }}
                            >
                              <Download style={{ width: 11, height: 11 }} />Baixar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })()}

              {/* Signatários */}
              <section>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Signatários ({detailsRequest.signers.length})</p>
                  {detailsRequest.signers.some(s => s.status === 'pending' && s.public_token) && (
                    <button
                      type="button"
                      onClick={() => {
                        const pendingLinks = detailsRequest.signers
                          .filter(s => s.status === 'pending' && s.public_token)
                          .map(s => `${s.name}: ${signatureService.generatePublicSigningUrl(s.public_token!)}`)
                          .join('\n');
                        void navigator.clipboard.writeText(pendingLinks);
                        toast.success('Links copiados!');
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 500, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', cursor: 'pointer' }}
                    >
                      <Copy style={{ width: 10, height: 10 }} />
                      Copiar todos os links
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {detailsRequest.signers.map((signer) => {
                    const facialUrl = signerImages[signer.id]?.facial || null;
                    const signatureUrl = signerImages[signer.id]?.signature || null;
                    const geoLocation = signer.geolocation || signer.signer_geolocation;
                    const isSigned = signer.status === 'signed';
                    const isRefused = signer.status === 'refused';

                    return (
                      <div key={signer.id} className={`rounded-xl border overflow-hidden ${isSigned ? 'border-emerald-200' : isRefused ? 'border-rose-200' : 'border-[#e7e5df]'}`}>
                        {/* Card header */}
                        <div className={`flex items-center gap-2.5 px-3 py-2.5 ${isSigned ? 'bg-emerald-50' : isRefused ? 'bg-rose-50' : signer.viewed_at ? 'bg-sky-50/60' : 'bg-slate-50'}`}>
                          {isSigned && facialUrl ? (
                            <button onClick={() => setZoomImageUrl(facialUrl)} className="relative group flex-shrink-0" title="Ampliar foto">
                              <img src={facialUrl} alt="Foto facial" className="w-10 h-10 rounded-lg object-cover border-2 border-emerald-300 group-hover:border-emerald-500 transition-all" style={{ transform: 'scaleX(-1)' }} />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 rounded-lg flex items-center justify-center transition-all">
                                <ZoomIn className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                            </button>
                          ) : (
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isSigned ? 'bg-emerald-100' : signer.viewed_at ? 'bg-sky-100' : 'bg-orange-100'}`}>
                              <User className={`w-5 h-5 ${isSigned ? 'text-emerald-600' : signer.viewed_at ? 'text-sky-600' : 'text-orange-500'}`} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{signer.name}</p>
                            {signer.email && <p className="text-[11px] text-slate-500 truncate">{signer.email}</p>}
                            {!isSigned && signer.viewed_at && (
                              <p className="text-[10px] text-sky-600 flex items-center gap-1 mt-0.5">
                                <Eye className="w-3 h-3" />
                                Visualizou o documento {timeAgo(signer.viewed_at)}
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0 flex flex-col items-end gap-1">
                            {getStatusBadge(signer.status)}
                            {!isSigned && !isRefused && signer.viewed_at && (
                              <span className="text-[9px] text-sky-500 font-medium uppercase tracking-wide">Não assinou</span>
                            )}
                          </div>
                        </div>

                        {/* Refused — motivo da recusa */}
                        {isRefused && (
                          <div className="px-3 py-2 bg-white border-t border-rose-100">
                            <p className="text-[11px] font-semibold text-rose-700 flex items-center gap-1">
                              <X className="w-3 h-3" />Recusou {signer.refused_at ? timeAgo(signer.refused_at) : ''}
                            </p>
                            {signer.refusal_reason && (
                              <p className="text-[11px] text-slate-600 mt-0.5 whitespace-pre-wrap">{signer.refusal_reason}</p>
                            )}
                          </div>
                        )}

                        {/* Signed — auth info + signature image */}
                        {isSigned && (signer.auth_provider || signer.signer_user_agent || signer.device_info || signatureUrl) && (
                          <div className="px-3 py-2 bg-white space-y-1.5 border-t border-slate-100">
                            {signer.auth_provider && (
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                                <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                                  <Shield className="w-3 h-3 flex-shrink-0" />
                                  {signer.auth_provider === 'google' && `Google · ${signer.auth_email || signer.email}`}
                                  {signer.auth_provider === 'email_link' && `Link E-mail · ${signer.auth_email || signer.email}`}
                                </span>
                                {geoLocation && (
                                  <a href={`https://www.google.com/maps?q=${geoLocation.replace(/\s/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-orange-600 hover:underline">
                                    {geoLocation}<ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                              </div>
                            )}
                            {(signer.signer_user_agent || signer.device_info) && (
                              <p className="text-[11px] text-slate-400 truncate" title={signer.signer_user_agent || signer.device_info || ''}>
                                {(signer.signer_user_agent || signer.device_info || '').slice(0, 90)}
                              </p>
                            )}
                            {signatureUrl && (
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Assinatura:</p>
                                <div className="inline-block px-2 py-1 bg-slate-50 rounded border border-slate-100">
                                  <img src={signatureUrl} alt="Assinatura" className="max-h-10 object-contain cursor-pointer hover:opacity-75 transition-opacity" onClick={() => setZoomImageUrl(signatureUrl)} title="Ampliar" />
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Pending — signing link */}
                        {!isSigned && (
                          <div className="px-3 py-2 bg-white border-t border-slate-100 flex flex-col gap-1.5">
                            <div className="flex flex-col @sm:flex-row items-stretch @sm:items-center gap-1.5">
                              <input type="text" readOnly value={signatureService.generatePublicSigningUrl(signer.public_token!)} className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-[#e7e5df] rounded-lg text-[11px] font-mono text-slate-500 min-w-0" />
                              <div className="flex gap-1 flex-shrink-0">
                                <button onClick={() => copyLink(signer.public_token!)} className="flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-[11px] font-medium transition">
                                  <Copy className="w-3 h-3" />Copiar
                                </button>
                                <button onClick={() => window.open(signatureService.generatePublicSigningUrl(signer.public_token!), '_blank')} className="flex items-center gap-1 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg text-[11px] font-medium transition">
                                  <ExternalLink className="w-3 h-3" />Abrir
                                </button>
                                <button onClick={() => openSignModal(signer)} className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-500 text-white rounded-lg text-[11px] font-semibold hover:bg-orange-600 transition">
                                  <PenTool className="w-3 h-3" />Assinar
                                </button>
                              </div>
                            </div>
                            {/* WhatsApp quick-send — editable message */}
                            {(signer.phone || signer.email) && (() => {
                              const signingUrl = signatureService.generatePublicSigningUrl(signer.public_token!);
                              const waPreviewUrl = buildWaPreviewUrl('assinar', signer.public_token!);
                              const defaultMsg = `Olá ${signer.name}! Seu documento chegou para assinatura.\n\n*${detailsRequest.document_name}*\n\nAcesse o link abaixo para assinar:\n${waPreviewUrl}`;
                              const currentMsg = waEditMsg[signer.id] ?? defaultMsg;
                              const isEditing = waEditOpen === signer.id;
                              return (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-1.5">
                                    {signer.phone && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const phone = signer.phone!.replace(/\D/g, '');
                                          const msg = encodeURIComponent(currentMsg);
                                          window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
                                        }}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', cursor: 'pointer' }}
                                      >
                                        <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: '#16a34a' }}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                        WhatsApp
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void navigator.clipboard.writeText(currentMsg);
                                        toast.success('Mensagem copiada!');
                                      }}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', cursor: 'pointer' }}
                                    >
                                      <Copy style={{ width: 11, height: 11 }} />
                                      Copiar mensagem
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!isEditing) {
                                          setWaEditMsg(prev => ({ ...prev, [signer.id]: currentMsg }));
                                        }
                                        setWaEditOpen(isEditing ? null : signer.id);
                                      }}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: isEditing ? '#ea580c' : '#64748b', background: isEditing ? '#fff7ed' : '#f8fafc', border: `1px solid ${isEditing ? '#fed7aa' : '#e2e8f0'}`, cursor: 'pointer' }}
                                    >
                                      <Pencil style={{ width: 11, height: 11 }} />
                                      {isEditing ? 'Fechar' : 'Editar'}
                                    </button>
                                  </div>
                                  {isEditing && (
                                    <div className="flex flex-col gap-1">
                                      <textarea
                                        value={currentMsg}
                                        onChange={(e) => setWaEditMsg(prev => ({ ...prev, [signer.id]: e.target.value }))}
                                        rows={5}
                                        className="w-full px-2.5 py-2 bg-slate-50 border border-[#e7e5df] rounded-lg text-[11px] text-slate-700 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                                        style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setWaEditMsg(prev => ({ ...prev, [signer.id]: defaultMsg }))}
                                        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 500, color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                                      >
                                        <RotateCcw style={{ width: 9, height: 9 }} />
                                        Restaurar padrão
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Signed — verification hash */}
                        {isSigned && signer.verification_hash && (
                          <div className="px-3 py-2 bg-white border-t border-emerald-100 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Código de verificação</p>
                              <p className="text-[11px] font-mono text-slate-500 truncate">{signer.verification_hash}</p>
                            </div>
                            <a href={`${window.location.origin}/#/verificar/${signer.verification_hash}`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-[11px] font-semibold hover:bg-emerald-100 transition border border-emerald-200">
                              <Shield className="w-3 h-3" />Verificar
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Histórico */}
              <section>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Histórico</p>
                {auditLogLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-slate-300" />
                  </div>
                ) : auditLog.length === 0 ? (
                  <div className="text-center py-8 text-slate-300">
                    <Clock className="w-7 h-7 mx-auto mb-2" />
                    <p className="text-sm">Nenhuma atividade registrada</p>
                  </div>
                ) : (
                  <div className="relative pl-5">
                    <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-200" />
                    <div className="space-y-3">
                      {auditLog.map((log, index) => {
                        const isLast = index === auditLog.length - 1;
                        let iconBg = 'bg-slate-100'; let iconColor = 'text-slate-500'; let Icon = Clock;
                        if (log.action === 'created') { iconBg = 'bg-orange-100'; iconColor = 'text-orange-600'; Icon = FileText; }
                        else if (log.action === 'sent') { iconBg = 'bg-purple-100'; iconColor = 'text-purple-600'; Icon = Send; }
                        else if (log.action === 'viewed') { iconBg = 'bg-sky-100'; iconColor = 'text-sky-600'; Icon = Eye; }
                        else if (log.action === 'signed') { iconBg = 'bg-emerald-100'; iconColor = 'text-emerald-600'; Icon = CheckCircle; }
                        else if (log.action === 'cancelled') { iconBg = 'bg-red-100'; iconColor = 'text-red-600'; Icon = X; }
                        else if (log.action === 'reminder_sent') { iconBg = 'bg-orange-100'; iconColor = 'text-orange-600'; Icon = Send; }
                        else if (log.action === 'refused') { iconBg = 'bg-rose-100'; iconColor = 'text-rose-600'; Icon = X; }
                        const badgeCls = log.action === 'signed' ? 'bg-emerald-100 text-emerald-700' : log.action === 'viewed' ? 'bg-sky-100 text-sky-700' : log.action === 'created' ? 'bg-orange-100 text-orange-700' : log.action === 'sent' ? 'bg-purple-100 text-purple-700' : log.action === 'refused' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600';
                        const badgeLabel = log.action === 'created' ? 'Criado' : log.action === 'sent' ? 'Enviado' : log.action === 'viewed' ? 'Visualizado' : log.action === 'signed' ? 'Assinado' : log.action === 'cancelled' ? 'Cancelado' : log.action === 'expired' ? 'Expirado' : log.action === 'reminder_sent' ? 'Lembrete' : log.action === 'refused' ? 'Recusado' : log.action;
                        // Parse user agent into readable device label
                        const parseDevice = (ua: string | null | undefined): string | null => {
                          if (!ua) return null;
                          const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
                          const isTablet = /iPad|Tablet/i.test(ua);
                          const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Firefox\//i.test(ua) ? 'Firefox' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Navegador';
                          const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /iPhone/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' : /Linux/i.test(ua) ? 'Linux' : '';
                          const device = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';
                          return [browser, os, device].filter(Boolean).join(' · ');
                        };
                        const deviceLabel = parseDevice((log as any).user_agent);
                        const ipAddress = (log as any).ip_address as string | null | undefined;
                        return (
                          <div key={log.id} className="relative flex items-start gap-2">
                            <div className={`absolute -left-5 top-0.5 w-4 h-4 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0 ring-2 ring-white z-10`}>
                              <Icon className={`w-2 h-2 ${iconColor}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs text-slate-700 font-medium leading-snug">{log.description}</p>
                                <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badgeCls}`}>{badgeLabel}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {new Date(log.created_at).toLocaleString('pt-BR', {
                                  timeZone: 'America/Cuiaba',
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </p>
                              {(ipAddress || deviceLabel) && (
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                  {ipAddress && (
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />
                                      IP: {ipAddress}
                                    </span>
                                  )}
                                  {deviceLabel && (
                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />
                                      {deviceLabel}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              </div>{/* end content sections */}
            </div>{/* end body */}
        </>)}
      </Modal>
      <Modal
        open={signModalOpen && !!signingSigner}
        onClose={() => setSignModalOpen(false)}
        title={signingSigner?.name ?? ''}
        eyebrow="Assinar documento"
        size="md"
        zIndex={60}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => {
                if (signStep === 'signature') setSignModalOpen(false);
                else if (signStep === 'facial') setSignStep('signature');
                else setSignStep('facial');
              }}
              className="px-3 py-2 text-xs sm:text-sm text-slate-600 hover:text-slate-800"
            >
              {signStep === 'signature' ? 'Cancelar' : 'Voltar'}
            </button>
            {signStep === 'confirm' ? (
              <button
                onClick={confirmSignature}
                disabled={signLoading || (signRequiresCpf && signCpfDigits.length !== 11)}
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-slate-900 text-white rounded text-xs sm:text-sm font-medium disabled:opacity-50"
              >
                {signLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar'}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (signStep === 'signature' && signatureData) setSignStep('facial');
                  else if (signStep === 'facial') setSignStep('confirm');
                }}
                disabled={(signStep === 'signature' && !signatureData)}
                className="px-3 sm:px-4 py-2 bg-slate-900 text-white rounded text-xs sm:text-sm font-medium disabled:opacity-50"
              >
                Próximo
              </button>
            )}
          </div>
        }
      >
        <ModalBody>
          {signStep === 'signature' && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Sua Assinatura</p>
              <SignatureCanvas onSignatureChange={setSignatureData} responsive={true} width={420} height={160} />
            </div>
          )}
          {signStep === 'facial' && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Foto Facial</p>
              <FacialCapture onCapture={setFacialData} width={300} height={220} />
            </div>
          )}
          {signStep === 'confirm' && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Confirmar dados</p>
              {signRequiresCpf && (
                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">CPF do signatário <span className="text-orange-600">*</span></label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={signCpf}
                    onChange={(e) => setSignCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    className="w-full px-3 py-2 border border-[#e7e5df] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">Este documento exige CPF. Deve conferir com o CPF cadastrado do signatário.</p>
                </div>
              )}
              {signatureData && (
                <div className="p-3 bg-slate-50 rounded mb-3">
                  <p className="text-xs text-slate-500 mb-1">Assinatura</p>
                  <img src={signatureData} alt="Assinatura" className="max-w-full max-h-20 border border-[#e7e5df] rounded bg-[#f8f7f5]" />
                </div>
              )}
              {facialData && (
                <div className="p-3 bg-slate-50 rounded">
                  <p className="text-xs text-slate-500 mb-1">Foto</p>
                  <img src={facialData} alt="Foto" className="w-20 h-20 object-cover rounded border" style={{ transform: 'scaleX(-1)' }} />
                </div>
              )}
            </div>
          )}
        </ModalBody>
      </Modal>
      {/* Modal de zoom para imagens */}
      <Modal
        open={!!zoomImageUrl}
        onClose={() => setZoomImageUrl(null)}
        title="Visualização"
        size="xl"
        zIndex={70}
      >
        <ModalBody className="bg-slate-50 flex items-center justify-center">
          {zoomImageUrl && (
            <img
              src={zoomImageUrl}
              alt="Imagem ampliada"
              className="max-w-full max-h-[70vh] sm:max-h-[75vh] object-contain rounded-xl border border-[#e7e5df] bg-[#f8f7f5]"
              style={{ transform: zoomImageUrl.includes('facial') ? 'scaleX(-1)' : 'none' }}
            />
          )}
        </ModalBody>
      </Modal>
      {/* Modal de confirmação de exclusão */}

      {/* Modal: Relatório / Certificado de Assinatura */}
      {reportTarget && (
        <div className="fixed inset-0 z-[200] overflow-y-auto" style={{ background: 'rgba(15,23,42,0.6)' }}>
          <SignatureReport
            request={reportTarget.request}
            signer={reportTarget.signer}
            creator={user?.email ? { name: user.email.split('@')[0] } : null}
            onClose={() => setReportTarget(null)}
          />
        </div>
      )}

      {/* Modal: Dossiê Probatório (relatório forense completo do envelope) */}
      {dossierTarget && (
        <div className="fixed inset-0 z-[200] overflow-y-auto" style={{ background: 'rgba(15,23,42,0.6)' }}>
          <ForensicDossier
            requestId={dossierTarget.requestId}
            documentName={dossierTarget.documentName}
            onClose={() => setDossierTarget(null)}
          />
        </div>
      )}

      <SignatureCertificateMockup
        open={certificateMockupOpen}
        onClose={() => setCertificateMockupOpen(false)}
        documentName={selectedDocumentName || 'KIT CONSUMIDOR - PEDRO RODRIGUES MONTALVAO NETO'}
        signerName={signers[0]?.name || selectedClientName || 'PEDRO RODRIGUES MONTALVAO NETO'}
        signerEmail={signers[0]?.email || 'pedro@advcuiaba.com'}
        signerCpf={signers[0]?.cpf || '045.748.031-93'}
        authMethodLabel={
          settings.authMethod === 'signature_facial_document'
            ? 'Google (pedro@advcuiaba.com) + verificação facial + documento'
            : settings.authMethod === 'signature_facial'
              ? 'Google (pedro@advcuiaba.com) + verificação facial'
              : 'Google (pedro@advcuiaba.com)'
        }
      />
    </div>
  );
};

export default SignatureModule;
