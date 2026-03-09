import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { renderAsync } from 'docx-preview';
import {
  FileText, Upload, Plus, Trash2, X, Check, Clock, CheckCircle, Send, Copy,
  User, Mail, Loader2, ChevronLeft, Eye, EyeOff, Filter, Search, MousePointer2,
  Type, Hash, Calendar, PenTool, Users, Download, AlertTriangle, ExternalLink, ChevronRight, ZoomIn, ZoomOut, Shield, Lightbulb, Pencil, Maximize2, Minimize2, LayoutList, LayoutGrid, Globe, FolderOpen,
  ArrowUpDown, FileSignature,
} from 'lucide-react';
import { useToastContext } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { signatureService } from '../services/signature.service';
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
import { useSilentRefresh } from '../hooks/useSilentRefresh';
import { useSelectionState } from '../hooks/useSelectionState';
import FacialCapture from './FacialCapture';
import { filterGeneratedDocumentsByFolder, filterSignatureRequests } from '../utils/signatureFilters';
import type {
  SignatureRequest, SignatureRequestWithSigners, Signer, CreateSignatureRequestDTO,
  SignerAuthMethod, SignatureFieldType, SignatureAuditLog,
} from '../types/signature.types';
import SignatureCanvas from './SignatureCanvas';
import type { GeneratedDocument } from '../types/document.types';
import type { CloudFile, CloudFolder } from '../types/cloud.types';
import type { SignatureExplorerFolder, SignatureExplorerItem } from '../types/signatureExplorer.types';
import type { ProcessPracticeArea } from '../types/process.types';

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
  requireCpf: boolean; requireBirthdate: boolean; allowRefusal: boolean;
  blockAfterDeadline: boolean; expiresAt: string; signatureAppearance: string;
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

  const toastRef = useRef(toast);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [showPublicAuthSettings, setShowPublicAuthSettings] = useState(false);
  const [publicAuthLoading, setPublicAuthLoading] = useState(false);
  const [publicAuthSaving, setPublicAuthSaving] = useState(false);
  const [publicAuthConfig, setPublicAuthConfig] = useState<{ google: boolean; email: boolean; phone: boolean }>({
    google: true,
    email: true,
    phone: true,
  });
  const publicAuthSaveTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
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
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'signed'>('all');
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
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]); // Múltiplos arquivos (envelope)
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [signers, setSigners] = useState<DraftSigner[]>([
    { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: 1, deliveryMethod: 'email' },
  ]);
  const [signerOrder, setSignerOrder] = useState<'none' | 'sequential'>('none');

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isDocxFile, setIsDocxFile] = useState(false);
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
  const [pdfNumPagesByDoc, setPdfNumPagesByDoc] = useState<Record<number, number>>({}); // Páginas por documento

  const [settings, setSettings] = useState<SignatureSettings>({
    requireCpf: false, requireBirthdate: false, allowRefusal: true,
    blockAfterDeadline: false, expiresAt: '', signatureAppearance: 'signature_only',
  });

  const [createdRequest, setCreatedRequest] = useState<SignatureRequestWithSigners | null>(null);
  const [detailsRequest, setDetailsRequest] = useState<SignatureRequestWithSigners | null>(null);

  useEffect(() => {
    setShowCreateProcess(false);
    setOpenProcessLoading(false);
    setCreateProcessLoading(false);
    setCopyToCloudLoading(false);
  }, [detailsRequest?.id]);

  const [signModalOpen, setSignModalOpen] = useState(false);
  const [signingSigner, setSigningSigner] = useState<Signer | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [facialData, setFacialData] = useState<string | null>(null);
  const [signStep, setSignStep] = useState<'signature' | 'facial' | 'confirm'>('signature');
  const [signLoading, setSignLoading] = useState(false);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);
  const [auditLog, setAuditLog] = useState<SignatureAuditLog[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [viewDocLoading, setViewDocLoading] = useState(false);
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
    intervalMs: 5000,
    isVisible: () => document.visibilityState === 'visible' && wizardStep === 'list',
    onRefresh: loadData,
  });

  useEffect(() => { void loadData(); }, [loadData]);

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
    let cancelled = false;
    const run = async () => {
      try {
        setPublicAuthLoading(true);
        const [g, e, p] = await Promise.all([
          settingsService.getSetting<boolean>('public_signature_auth_google'),
          settingsService.getSetting<boolean>('public_signature_auth_email'),
          settingsService.getSetting<boolean>('public_signature_auth_phone'),
        ]);

        if (cancelled) return;
        setPublicAuthConfig({
          google: g ?? true,
          email: e ?? true,
          phone: p ?? true,
        });
      } catch (err) {
        if (!cancelled) {
          console.warn('Não foi possível carregar configuração de autenticação pública:', err);
        }
      } finally {
        if (!cancelled) setPublicAuthLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (publicAuthSaveTimerRef.current) {
        window.clearTimeout(publicAuthSaveTimerRef.current);
        publicAuthSaveTimerRef.current = null;
      }
    };
  }, []);

  const savePublicAuthConfig = async (config: { google: boolean; email: boolean; phone: boolean }) => {
    if (!config.google && !config.email && !config.phone) {
      toast.error('Ative pelo menos um método de autenticação.');
      return;
    }

    try {
      setPublicAuthSaving(true);
      await Promise.all([
        settingsService.updateSetting('public_signature_auth_google', config.google, user?.email || undefined),
        settingsService.updateSetting('public_signature_auth_email', config.email, user?.email || undefined),
        settingsService.updateSetting('public_signature_auth_phone', config.phone, user?.email || undefined),
      ]);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Erro ao salvar configurações');
    } finally {
      setPublicAuthSaving(false);
    }
  };

  const queueSavePublicAuthConfig = (config: { google: boolean; email: boolean; phone: boolean }) => {
    if (publicAuthSaveTimerRef.current) {
      window.clearTimeout(publicAuthSaveTimerRef.current);
    }
    publicAuthSaveTimerRef.current = window.setTimeout(() => {
      publicAuthSaveTimerRef.current = null;
      void savePublicAuthConfig(config);
    }, 500);
  };

  const loadDocumentPreview = useCallback(async (doc: ViewerDocument) => {
    try {
      setPdfLoading(true);
      setLoadingViewerDoc(true);

      currentViewerDocIdRef.current = doc.id;
      
      // Verificar tipo de arquivo
      const isDocx = doc.path.toLowerCase().endsWith('.docx');
      setIsDocxFile(isDocx);

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
        
        // Se for DOCX, baixar o blob para renderizar
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
      
      // Detectar se é DOCX (baseado no documento atual)
      const currentDocPath = docs[0].path;
      const isDocx = currentDocPath.toLowerCase().endsWith('.docx');
      setIsDocxFile(isDocx);
      
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
          // Preferência: section/article/.docx. Fallback: estimar por altura (A4) quando vier uma única página “alta”.
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
          // Evitar que um erro antigo “trave” novos renders
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
      await signatureExplorerService.moveItem({
        itemType: params.itemType,
        itemId: params.itemId,
        folderId: params.folderId,
        createdBy: user.id,
      });
      await reloadExplorer();
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao mover item');
    } finally {
      setMoveSaving(false);
    }
  }, [reloadExplorer, toast, user?.id]);

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

        const owned = selected.filter((r) => r.created_by === user.id);
        const skipped = selected.length - owned.length;

        if (owned.length === 0) {
          toast.error('Você só pode mover itens que você criou');
          return;
        }

        try {
          await Promise.all(
            owned.map((r) =>
              signatureExplorerService.moveItem({
                itemType: 'signature_request',
                itemId: r.id,
                folderId: targetFolderId,
                createdBy: user.id,
              })
            )
          );
          await reloadExplorer();
          if (skipped > 0) {
            toast.error(`Alguns itens não foram movidos (permissão): ${skipped}.`);
          }
        } finally {
          // ignore
        }
        return;
      }

      if (payload?.created_by && payload.created_by !== user.id) {
        toast.error('Você só pode mover itens que você criou');
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

  const renderFolderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const children = foldersByParent.get(parentId) ?? [];
    if (!children.length) return null;

    return (
      <div className={depth === 0 ? 'space-y-2' : 'space-y-2 mt-1'}>
        {children.map((folder, index) => {
          const isSelected = selectedFolderId === folder.id;
          const isDraggingThisFolder = draggingExplorer?.type === 'folder' && draggingExplorer.id === folder.id;
          const itemCount = folderItemCountById.get(folder.id) ?? 0;
          const nextSiblingId = children[index + 1]?.id ?? null;
          const isInsertLineHere =
            folderReorderMode &&
            isDraggingExplorer &&
            folderReorderOver?.parentId === parentId &&
            folderReorderOver?.beforeId === folder.id;
          return (
            <div key={folder.id}>
              {folderReorderMode && (
                <div className="px-1">
                  <div className={`h-0.5 rounded-full transition ${isInsertLineHere ? 'bg-orange-500' : 'bg-transparent'}`} />
                </div>
              )}

              <div
                className={`group relative flex items-center rounded-xl transition ${
                  isDraggingExplorer && dragOverFolderId === folder.id ? 'ring-2 ring-orange-500/40 bg-orange-50/40' : ''
                }`}
                onDragOver={(e) => {
                  // Reordenação de pastas (modo organizar) usando midpoint do item
                  if (folderReorderMode && draggingExplorer?.type === 'folder') {
                    handleAllowDrop(e);
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const midpointY = rect.top + rect.height / 2;
                    const beforeId = e.clientY < midpointY ? folder.id : nextSiblingId;
                    setFolderReorderOver({ parentId, beforeId });
                    return;
                  }

                  // Drop de itens (documentos) dentro de pasta
                  if (draggingExplorer?.type === 'item') {
                    handleAllowDrop(e);
                    setDragOverFolderId(folder.id);
                  }
                }}
                onDragEnter={() => {
                  if (draggingExplorer?.type !== 'item') return;
                  handleFolderDragEnter(folder.id);
                }}
                onDragLeave={(e) => {
                  if (draggingExplorer?.type !== 'item') return;
                  handleFolderDragLeave(e, folder.id);
                }}
                onDrop={(e) => {
                  // Reordenação de pastas (modo organizar)
                  if (folderReorderMode && draggingExplorer?.type === 'folder') {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const midpointY = rect.top + rect.height / 2;
                    const beforeId = e.clientY < midpointY ? folder.id : nextSiblingId;
                    void handleReorderFolderDrop(e, parentId, beforeId);
                    return;
                  }

                  // Drop de itens (documentos)
                  if (draggingExplorer?.type === 'item') {
                    void handleDropOnFolder(e, folder.id);
                  }
                }}
              >
                <div
                  draggable={folderReorderMode}
                  onDragStart={(e) => {
                    if (!folderReorderMode) return;
                    setExplorerDragData(e, { type: 'folder', id: folder.id }, e.currentTarget as HTMLElement);
                  }}
                  onDragEnd={() => {
                    if (!folderReorderMode) return;
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
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`relative flex-1 w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 pr-24 text-left text-[13px] font-semibold transition ${
                    isSelected
                      ? 'bg-orange-50 text-slate-900 shadow-sm ring-1 ring-orange-500/10'
                      : 'text-slate-700 hover:bg-slate-50'
                  } ${
                    isDraggingThisFolder ? 'opacity-60 scale-[1.02] shadow-lg shadow-slate-900/10 bg-white ring-1 ring-slate-200' : ''
                  } ${
                    folderReorderMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                  } ${
                    depth > 0 ? "before:content-[''] before:absolute before:left-[18px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200" : ''
                  }`}
                  style={depth > 0 ? { paddingLeft: `${14 + depth * 16}px` } : undefined}
                  title={folder.name}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-0 h-full w-1.5 bg-orange-500 rounded-l-xl" />
                  )}
                  <span className="min-w-0 flex items-center gap-2.5">
                    <FolderOpen className={`w-4 h-4 ${isSelected ? 'text-orange-600' : 'text-slate-400'}`} />
                    <span
                      className="text-left leading-snug"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      title={folder.name}
                    >
                      {folder.name}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 tabular-nums rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      isSelected ? 'bg-orange-200 text-orange-800' : 'bg-slate-100 text-slate-600'
                    }`}
                    title="Itens nesta pasta"
                  >
                    {itemCount}
                  </span>
                </div>

                <div
                  className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1 py-0.5 rounded-lg bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm opacity-0 group-hover:opacity-100 transition"
                  onDragOver={(e) => {
                    if (draggingExplorer?.type === 'folder') return;
                    handleAllowDrop(e);
                    setDragOverFolderId(folder.id);
                  }}
                  onDragEnter={() => {
                    if (draggingExplorer?.type === 'folder') return;
                    handleFolderDragEnter(folder.id);
                  }}
                  onDragLeave={(e) => {
                    if (draggingExplorer?.type === 'folder') return;
                    handleFolderDragLeave(e, folder.id);
                  }}
                  onDrop={(e) => {
                    if (draggingExplorer?.type === 'folder') return;
                    void handleDropOnFolder(e, folder.id);
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreateFolderModal(folder.id);
                    }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                    title="Nova subpasta"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRenameFolder(folder);
                    }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                    title="Renomear"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteFolderTarget(folder);
                    }}
                    className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
                    title="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}

        <div
          onDragOver={folderReorderMode ? handleAllowDrop : undefined}
          onDragEnter={folderReorderMode ? () => setFolderReorderOver({ parentId, beforeId: null }) : undefined}
          onDragLeave={
            folderReorderMode
              ? () => setFolderReorderOver((prev) => (prev?.parentId === parentId && prev?.beforeId === null ? null : prev))
              : undefined
          }
          onDrop={folderReorderMode ? (e) => void handleReorderFolderDrop(e, parentId, null) : undefined}
          className={`px-1 ${
            folderReorderMode && isDraggingExplorer && folderReorderOver?.parentId === parentId && folderReorderOver?.beforeId === null ? 'py-1' : folderReorderMode ? 'py-0.5' : 'hidden'
          }`}
        >
          <div
            className={`h-0.5 rounded-full transition ${
              folderReorderMode && isDraggingExplorer && folderReorderOver?.parentId === parentId && folderReorderOver?.beforeId === null
                ? 'bg-orange-500'
                : 'bg-transparent'
            }`}
          />
        </div>
      </div>
    );
  };

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
    clearSelectedUploadFileIndexes();
    setSigners([{ id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: 1, deliveryMethod: 'email' }]);
    setFields([]); setPdfPreviewUrl(null); setCreatedRequest(null);
    setPdfPreviewUrls([]); setPdfNumPagesByDoc({});
    setIsDocxFile(false); setDocxBlob(null);
    setViewerDocuments([]); // Limpar documentos do viewer
    setCurrentViewerDocIndex(0); // Resetar índice
    docxRenderedRef.current = false; // Resetar flag de renderização do DOCX
    docxHtmlContentRef.current = ''; // Resetar HTML do DOCX
    prefillProcessedRef.current = false; // Resetar flag de prefill
    setSettings({ requireCpf: false, requireBirthdate: false, allowRefusal: true, blockAfterDeadline: false, expiresAt: '', signatureAppearance: 'signature_only' });
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

  const addSigner = () => {
    setSigners((prev) => [...prev, { id: crypto.randomUUID(), name: '', email: '', cpf: '', role: 'Assinar', order: prev.length + 1, deliveryMethod: 'email' }]);
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
                        <div className="w-full h-full rounded-[16px] border border-white/70 bg-white/92 backdrop-blur-sm shadow-[0_10px_30px_-18px_rgba(0,0,0,0.28)] px-3 py-1 flex items-center gap-3">
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
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-semibold border bg-white/95"
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

                      <span className="absolute bottom-1 left-1 text-[8px] font-bold px-2 py-0.5 rounded-full bg-white shadow-sm border border-slate-100" style={{ color: signerColor }}>
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

      const payload: CreateSignatureRequestDTO = {
        document_id: docId,
        document_name: selectedDocumentName, document_path: docPath,
        attachment_paths: selectedAttachmentPaths,
        client_id: selectedClientId, client_name: selectedClientName, auth_method: 'signature_only' as SignerAuthMethod,
        expires_at: settings.expiresAt || null,
        signers: signers.map((s, i) => ({ name: s.name, email: s.email, cpf: s.cpf || null, phone: null, role: s.role || null, order: i + 1 })),
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

  const openDetails = (req: SignatureRequest | SignatureRequestWithSigners) => {
    const token = ++detailsLoadTokenRef.current;
    detailsRequestIdRef.current = req.id;

    // Abrir o modal imediatamente (UI first)
    setDetailsRequest(req as SignatureRequestWithSigners);
    setSignerImages({});
    setAuditLog([]);
    setAuditLogLoading(true);

    const bucketsToTry = ['document-templates', 'generated-documents', 'signatures'];

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

  const handleDeleteRequest = async (requestId: string) => {
    const req = requests.find((r) => r.id === requestId);
    const confirmed = await confirmDelete({
      title: 'Remover documento',
      entityName: req?.document_name || undefined,
      message: 'Esta ação remove o documento do painel e invalida o link de assinatura. O documento assinado permanece preservado.',
      confirmLabel: 'Remover',
    });
    if (!confirmed) return;

    try {
      setDeleteLoading(true);
      await signatureService.archiveRequest(requestId);
      toast.success('Documento removido do painel. Consulta disponível apenas pelo código de autenticidade.');
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
              ignoreHeight: false,
              breakPages: true,
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

  const handleCopySignedDocumentToCloud = async (request: SignatureRequestWithSigners) => {
    if (!request.client_id) {
      toast.error('Vincule um cliente para criar a pasta no Cloud.');
      return;
    }

    try {
      setCopyToCloudLoading(true);
      const { blob, fileName } = await resolveSignedDocumentBlob(request);
      const { nonProtocolFolder, locationLabel } = await resolveCloudTargetFolder(request);

      const file = new File([blob], fileName, { type: blob.type || 'application/pdf' });
      await cloudService.uploadFiles(nonProtocolFolder.id, [file], request.client_id);
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

  const openSignModal = (signer: Signer) => { setSigningSigner(signer); setSignatureData(null); setFacialData(null); setSignStep('signature'); setSignModalOpen(true); };

  const confirmSignature = async () => {
    if (!signingSigner || !signatureData) return;
    try {
      setSignLoading(true);
      await signatureService.signDocument(signingSigner.id, { signature_image: signatureData, facial_image: facialData });
      // Notificação já é criada automaticamente pelo signatureService quando todos assinarem
      toast.success('Assinado!'); setSignModalOpen(false); loadData();
      if (detailsRequest) openDetails(detailsRequest);
    } catch (error: any) { toast.error(error.message || 'Erro'); } finally { setSignLoading(false); }
  };

  const getStatusBadge = (status: string) => {
    if (status === 'pending') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded"><Clock className="w-3 h-3" />Aguardando</span>;
    if (status === 'signed') return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded"><CheckCircle className="w-3 h-3" />Assinado</span>;
    return null;
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

  if (loading && wizardStep === 'list') return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-orange-600" /></div>;

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
                <div key={signer.id} className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200">
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
    const canProceedUpload = selectedDocumentName || uploadedFile;
    const canProceedSigners = signers.every((s) => s.name.trim());
    const steps = [
      { key: 'upload', label: 'Documento', icon: FileText },
      { key: 'signers', label: 'Signatários', icon: Users },
      { key: 'position', label: 'Posicionar', icon: MousePointer2 },
      { key: 'settings', label: 'Configurações', icon: Filter },
    ];
    const currentStepIndex = steps.findIndex(s => s.key === wizardStep);
    
    return (
      <div className="bg-slate-50">
        {/* Header simples */}
        {wizardStep !== 'position' && (
          <div className="bg-white border-b border-slate-200 sticky top-0 z-20">
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
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Upload */}
              <div className="bg-white rounded-lg border border-slate-200 p-6">
                <h2 className="text-sm font-medium text-slate-700 mb-4">Documento</h2>
                <div 
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                    dragOver ? 'border-slate-400 bg-slate-50' : selectedDocumentName ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'
                  }`} 
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} 
                  onDragLeave={() => setDragOver(false)} 
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFilesSelect(e.dataTransfer.files); }}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={(e) => e.target.files?.length && handleFilesSelect(e.target.files)} className="hidden" />
                  {selectedDocumentName ? (
                    <div className="flex flex-col items-center gap-3">
                      <CheckCircle className="w-10 h-10 text-emerald-500" />
                      <div>
                        <p className="font-medium text-slate-800">{selectedDocumentName}</p>
                        {uploadedFiles.length > 1 && <p className="text-xs text-slate-500 mt-1">{uploadedFiles.length} arquivos selecionados</p>}
                      </div>
                      {uploadedFiles.length > 1 && (
                        <div className="w-full max-w-sm text-left bg-white rounded border border-slate-200 p-3 mt-2 max-h-32 overflow-y-auto">
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
                            <div key={`${f.name}-${i}`} className="flex items-center justify-between text-xs py-1 gap-2">
                              <label className="flex items-center gap-2 min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={selectedUploadFileIndexes.has(i)}
                                  onChange={() => toggleSelectedUploadIndex(i)}
                                />
                                <span className="truncate text-slate-600">{f.name}</span>
                              </label>
                              <button type="button" onClick={() => removeUploadedFileAt(i)} className="text-red-500 hover:text-red-600 ml-2"><X className="w-3 h-3" /></button>
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
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Documentos gerados</p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {generatedDocuments.slice(0, 5).map((doc) => (
                        <button 
                          type="button"
                          key={doc.id} 
                          onClick={() => handleSelectGeneratedDoc(doc)} 
                          className={`w-full flex items-center gap-3 p-3 rounded border text-left text-sm transition ${
                            selectedDocumentId === doc.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <FileText className="w-4 h-4 text-slate-400" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate text-slate-700">{doc.file_name || doc.template_name}</p>
                            <p className="text-xs text-slate-400">{doc.client_name}</p>
                          </div>
                          {selectedDocumentId === doc.id && <Check className="w-4 h-4 text-slate-900" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Signatários */}
              <div className="bg-white rounded-lg border border-slate-200 p-6">
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
                        <input type="text" value={signer.name} onChange={(e) => updateSigner(signer.id, 'name', e.target.value)} placeholder="Nome" className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        <div className="flex gap-2">
                          <input type="email" value={signer.email} onChange={(e) => updateSigner(signer.id, 'email', e.target.value)} placeholder="Email" className="flex-1 px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400" />
                          <select value={signer.role} onChange={(e) => updateSigner(signer.id, 'role', e.target.value)} className="px-3 py-2 border border-slate-200 rounded text-sm bg-white">
                            <option>Assinar</option>
                            <option>Testemunha</option>
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
            <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
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
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
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
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition shadow-sm font-medium text-sm"
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
              <aside className="w-80 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05),0_2px_4px_-1px_rgba(0,0,0,0.03)] flex flex-col overflow-hidden">
                {/* Header da sidebar */}
                <div className="p-4 border-b border-gray-200">
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
                          <div key={field.localId} className="flex items-center justify-between text-sm bg-white rounded-lg p-2 border border-gray-100">
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
                        Se o template já possui <code className="bg-white/50 px-1 py-0.5 rounded text-amber-900 font-mono text-[10px]">[[assinatura_X]]</code>, o sistema posicionará automaticamente.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* Área do PDF */}
            <section className="flex-1 bg-gray-100 rounded-xl border border-gray-200 flex flex-col relative overflow-hidden">
              {/* Toolbar flutuante centralizada */}
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white shadow-lg rounded-full px-4 py-2 flex items-center gap-4 z-10 border border-gray-200">
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
                {(pdfPreviewUrl || isDocxFile) ? (
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
                            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
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
                                      <div className="w-full h-full rounded-[16px] border border-white/70 bg-white/90 backdrop-blur-sm shadow-[0_10px_30px_-18px_rgba(0,0,0,0.28)] px-3 py-1.5 flex items-center gap-3">
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
                                          className="shrink-0 rounded-full px-2 py-0.5 text-[8px] font-semibold border bg-white/95"
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

                                    <span className="absolute bottom-1 left-1 text-[8px] font-bold px-2 py-0.5 rounded-full bg-white shadow-sm border border-slate-100" style={{ color: signerColor }}>
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

                    {!isDocxFile && pdfPreviewUrl && (
                      <div className="relative self-start flex-none inline-block" style={{ width: `${595 * pdfScale}px` }}>
                        <div
                          ref={pdfContainerRef}
                          className={`relative bg-transparent ${isPlacingField ? 'cursor-crosshair' : 'cursor-default'}`}
                          style={{ width: '595px', transform: `scale(${pdfScale})`, transformOrigin: 'top left' }}
                          onClick={handlePdfClick}
                        >
                          {pdfLoading && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 rounded-lg">
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
          <div className="max-w-xl mx-auto p-6"><div className="bg-white rounded-xl border border-slate-200 p-6"><h3 className="text-lg font-semibold mb-6">Configurações</h3><div className="space-y-4">
            <div><label className="block text-sm font-medium mb-2">Aparência</label><select value={settings.signatureAppearance} onChange={(e) => setSettings((s) => ({ ...s, signatureAppearance: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"><option value="signature_only">Apenas assinatura</option><option value="signature_name">Assinatura + Nome</option></select></div>
            <div className="space-y-3 pt-4 border-t">
              {[{ key: 'requireCpf', label: 'Não exigir CPF' }, { key: 'allowRefusal', label: 'Permitir recusa' }, { key: 'blockAfterDeadline', label: 'Bloquear após prazo' }].map(({ key, label }) => <label key={key} className="flex items-center justify-between"><span className="text-sm">{label}</span><button type="button" onClick={() => setSettings((s) => ({ ...s, [key]: !(s as any)[key] }))} className={`w-10 h-6 rounded-full ${(settings as any)[key] ? 'bg-orange-600' : 'bg-slate-300'}`}><div className={`w-4 h-4 bg-white rounded-full shadow transform ${(settings as any)[key] ? 'translate-x-5' : 'translate-x-1'}`} /></button></label>)}
            </div>
            {settings.blockAfterDeadline && <div className="pt-4"><label className="block text-sm font-medium mb-2">Data limite</label><input type="date" value={settings.expiresAt} onChange={(e) => setSettings((s) => ({ ...s, expiresAt: e.target.value }))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" /></div>}
          </div></div></div>
        )}
      </div>
    );
  }

  // LIST
  const totalRequestsCount = requests.length;
  const pendingRequestsCount = requests.filter((r) => r.status === 'pending').length;
  const signedRequestsCount = requests.filter((r) => r.status === 'signed').length;

  return (
    <div className="flex flex-col gap-4 max-w-full overflow-x-hidden h-[calc(100vh-96px)] overflow-hidden" data-signature-module>
      {selectionMode && selectedRequestIds.size > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 sm:px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">{selectedRequestIds.size}</span> selecionado(s)
              <span className="text-slate-400"> · </span>
              <span className="text-slate-500">Filtro atual ({filteredRequests.length})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFilteredRequests}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
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
        {/* Sidebar Explorer */}
        <div className="hidden lg:block w-[280px] flex-shrink-0">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[11px] font-bold tracking-[0.18em] text-slate-500 uppercase">Pastas</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
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
                }}
                className={`p-1.5 rounded-lg transition ${
                  folderReorderMode ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-500/20' : 'hover:bg-slate-100 text-slate-500'
                }`}
                title={folderReorderMode ? 'Sair do modo de organização' : 'Organizar pastas'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => openCreateFolderModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                title="Nova pasta"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {explorerLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Carregando...</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div
                draggable={false}
                onDragOver={(e) => {
                  if (draggingExplorer?.type === 'folder') return;
                  handleAllowDrop(e);
                  setDragOverFolderId(null);
                }}
                onDragEnter={() => {
                  if (draggingExplorer?.type === 'folder') return;
                  handleFolderDragEnter(null);
                }}
                onDragLeave={(e) => {
                  if (draggingExplorer?.type === 'folder') return;
                  handleFolderDragLeave(e, null);
                }}
                onDrop={(e) => {
                  if (draggingExplorer?.type === 'folder') return;
                  void handleDropOnFolder(e, null);
                }}
                className={isDraggingExplorer && dragOverFolderId === null ? 'ring-2 ring-orange-500/40 rounded-xl bg-orange-50/40' : ''}
              >
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(null)}
                  className={`relative w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 pr-10 text-left text-[13px] font-semibold transition ${
                    selectedFolderId === null
                      ? 'bg-orange-50 text-slate-900 shadow-sm ring-1 ring-orange-500/10'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {selectedFolderId === null && (
                    <span className="absolute left-0 top-0 h-full w-1.5 bg-orange-500 rounded-l-xl" />
                  )}
                  <span className="min-w-0 flex items-center gap-2.5">
                    <FolderOpen className={`w-4 h-4 ${selectedFolderId === null ? 'text-orange-600' : 'text-slate-400'}`} />
                    <span
                      className="text-left leading-snug"
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      title="Caixa de Entrada"
                    >
                      Caixa de Entrada
                    </span>
                  </span>
                  <span
                    className={`shrink-0 tabular-nums rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      selectedFolderId === null ? 'bg-orange-200 text-orange-800' : 'bg-slate-100 text-slate-600'
                    }`}
                    title="Itens em Caixa de Entrada"
                  >
                    {rootItemCount}
                  </span>
                </button>
              </div>

              {renderFolderTree(null, 0)}
            </div>
          )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
          {/* Toolbar compacta e limpa */}
          <div className="rounded-xl border border-slate-200 bg-white px-3 sm:px-4 py-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          {/* Lado esquerdo: Filtros de status como tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filterStatus === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos <span className="text-slate-400">{requests.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('pending')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filterStatus === 'pending'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pendentes <span className="text-amber-500">{requests.filter(r => r.status === 'pending').length}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('signed')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filterStatus === 'signed'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Concluídos <span className="text-emerald-500">{requests.filter(r => r.status === 'signed').length}</span>
            </button>
            <button
              type="button"
              className="shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 border-l border-slate-300 pl-2 ml-1"
            >
              Assinantes <span className="text-blue-500">{requests.reduce((acc, r) => acc + (r.signers?.length || 0), 0)}</span>
            </button>
          </div>

          {/* Centro: Busca */}
          <div className="relative w-full md:flex-1 md:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar documentos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
            />
          </div>

          {/* Lado direito: Ações */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto md:justify-end">
            {/* Assinatura Pública */}
            <button
              type="button"
              onClick={() => setShowPublicAuthSettings((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                showPublicAuthSettings
                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Público
              {publicAuthSaving && <Loader2 className="w-3 h-3 animate-spin" />}
            </button>

            {/* Novo documento */}
            <button
              onClick={() => { resetWizard(); setWizardStep('upload'); }}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Novo documento
            </button>

            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                showFilters
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              Filtros
            </button>

            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                selectionMode
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`p-2 transition ${
                  viewMode === 'list'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-2 transition ${
                  viewMode === 'grid'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Painel de seleção em massa */}
        {selectionMode && (
          <div className="rounded-xl border border-slate-200 bg-white px-3 sm:px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Selecionar tudo da pasta
                  </button>
                )}
                <button
                  type="button"
                  onClick={selectAllFilteredRequests}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Selecionar todos
                </button>
                <button
                  type="button"
                  onClick={clearSelectedIds}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
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

        {/* Painel: Configuração de autenticação pública */}
        {showPublicAuthSettings && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4">
            <span className="text-xs font-medium text-slate-500">Autenticação pública:</span>
            {(
              [
                { key: 'google', label: 'Google', icon: '🔵' },
                { key: 'email', label: 'E-mail', icon: '✉️' },
                { key: 'phone', label: 'Telefone', icon: '📱' },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="inline-flex items-center gap-2 cursor-pointer select-none"
              >
                <button
                  type="button"
                  disabled={publicAuthLoading}
                  onClick={() =>
                    setPublicAuthConfig((prev) => {
                      const next = { ...prev, [item.key]: !prev[item.key] };
                      if (!next.google && !next.email && !next.phone) {
                        toast.error('Ative pelo menos um método.');
                        return prev;
                      }
                      queueSavePublicAuthConfig(next);
                      return next;
                    })
                  }
                  className={`relative w-8 h-5 rounded-full transition ${
                    publicAuthConfig[item.key] ? 'bg-orange-500' : 'bg-slate-300'
                  } disabled:opacity-50`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      publicAuthConfig[item.key] ? 'translate-x-3' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-xs text-slate-700">{item.label}</span>
              </label>
            ))}
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
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
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
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">De</label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Até</label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                />
              </div>
              <div className="flex-1 min-w-[120px]">
                <label className="mb-1 block text-xs font-medium text-slate-500">Ordem</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
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
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
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
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={clearSelectedIds}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
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
      </div>

          {/* Lista de documentos */}
          <div className="rounded-2xl border border-slate-200 bg-white">
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
          <div className="space-y-3">
            {filteredRequestsByFolder.map((req) => {
              const allSigned = req.signers?.length > 0 && req.signers.every((s: Signer) => s.status === 'signed');
              const signedCount = req.signers?.filter((s: Signer) => s.status === 'signed').length || 0;
              const totalSigners = req.signers?.length || 0;
              const clientLabel = req.client_name || req.signers?.[0]?.name || 'Cliente não informado';
              const pct = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;
              const isInCloud = Boolean(cloudSyncStatusByRequestId[req.id]);
              const isDraggingThisItem =
                draggingExplorer?.type === 'item'
                && draggingExplorer.itemType === 'signature_request'
                && draggingExplorer.id === req.id;

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
                    setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'signature_request', itemId: req.id, createdBy: req.created_by });
                  }}
                  onClick={() => {
                    if (suppressExplorerClickRef.current || isDraggingExplorer) return;
                    openDetails(req);
                  }}
                  className={`group bg-white rounded-2xl border border-slate-200 p-4 shadow-sm ring-1 ring-black/5 hover:border-slate-300 hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                    isDraggingExplorer ? 'select-none' : ''
                  } ${
                    isDraggingThisItem ? 'opacity-60 scale-[1.01] shadow-lg shadow-slate-900/10' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {selectionMode && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            checked={selectedRequestIds.has(req.id)}
                            onChange={() => toggleSelectedRequestId(req.id)}
                          />
                        </div>
                      )}
                      
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        allSigned ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        <FileText className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-slate-900 truncate">
                            {req.document_name}
                          </h3>
                          {req.process_id && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-sky-200 bg-sky-50 text-sky-700">
                              <FileText className="w-3 h-3" />
                              Processo
                            </span>
                          )}
                          {req.requirement_id && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700">
                              <Plus className="w-3 h-3" />
                              Req.
                            </span>
                          )}
                          {isInCloud && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-emerald-200 bg-emerald-50 text-emerald-700">
                              <FolderOpen className="w-3 h-3" />
                              Pasta criada
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 truncate">
                          {clientLabel}
                        </p>
                        <p className="text-xs text-slate-400">
                          {formatDate(req.created_at)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                          allSigned 
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' 
                            : 'bg-amber-100 text-amber-700 border border-amber-200'
                        }`}>
                          {allSigned ? (
                            <>
                              <CheckCircle className="w-3.5 h-3.5" />
                              Concluído
                            </>
                          ) : (
                            <>
                              <Clock className="w-3.5 h-3.5" />
                              {signedCount}/{totalSigners}
                            </>
                          )}
                        </div>
                        
                        {totalSigners > 0 && (
                          <div className="mt-2">
                            <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  allSigned ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {pct}%
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition flex-shrink-0" />
                    </div>
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
          <div className="p-4 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filteredRequestsByFolder.map((req) => {
                const allSigned = req.signers?.length > 0 && req.signers.every((s: Signer) => s.status === 'signed');
                const signedCount = req.signers?.filter((s: Signer) => s.status === 'signed').length || 0;
                const totalSigners = req.signers?.length || 0;
                const clientLabel = req.client_name || req.signers?.[0]?.name || 'Cliente não informado';
                const pct = totalSigners > 0 ? Math.round((signedCount / totalSigners) * 100) : 0;
                const isInCloud = Boolean(cloudSyncStatusByRequestId[req.id]);

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
                      setContextMenu({ x: e.clientX, y: e.clientY, itemType: 'signature_request', itemId: req.id, createdBy: req.created_by });
                    }}
                    onClick={() => {
                      if (suppressExplorerClickRef.current || isDraggingExplorer) return;
                      openDetails(req);
                    }}
                    className="group relative cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className={`absolute left-4 top-0 h-3 w-24 rounded-t-lg border border-b-0 ${
                        allSigned
                          ? 'border-emerald-300 bg-emerald-100/90'
                          : 'border-amber-300 bg-amber-100/90'
                      }`}
                    />

                    <div
                      className={`relative mt-2 rounded-2xl border p-4 shadow-sm ring-1 ring-black/5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                        allSigned
                          ? 'border-emerald-300 bg-gradient-to-b from-emerald-50 to-white'
                          : 'border-amber-300 bg-gradient-to-b from-amber-50 to-white'
                      }`}
                    >
                      {selectionMode && (
                        <div className="absolute top-3 right-3 z-10" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            checked={selectedRequestIds.has(req.id)}
                            onChange={() => toggleSelectedRequestId(req.id)}
                          />
                        </div>
                      )}

                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            allSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          <FolderOpen className="w-5 h-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-slate-500">{formatDate(req.created_at)}</p>
                          <h3 className="mt-1 text-sm font-semibold text-slate-900 line-clamp-2 leading-tight">
                            {req.document_name}
                          </h3>
                          <p className="mt-1 text-xs text-slate-600 truncate">{clientLabel}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {req.process_id && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                            <FileText className="w-3 h-3" /> Processo
                          </span>
                        )}
                        {req.requirement_id && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                            <Plus className="w-3 h-3" /> Req.
                          </span>
                        )}
                        {isInCloud && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            <FolderOpen className="w-3 h-3" /> Pasta criada
                          </span>
                        )}
                      </div>

                      <div className="mt-4 border-t border-slate-200/70 pt-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                              allSigned ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {allSigned ? (
                              <>
                                <CheckCircle className="w-3 h-3" /> Concluído
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" /> {signedCount}/{totalSigners}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                            {pct}%
                            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 transition" />
                          </div>
                        </div>

                        {totalSigners > 0 && (
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full transition-all duration-300 ${allSigned ? 'bg-emerald-500' : 'bg-amber-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                      className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm ring-1 ring-black/5 hover:shadow-md hover:border-slate-300 transition cursor-grab active:cursor-grabbing"
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

      {deleteFolderTarget && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setDeleteFolderTarget(null)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-red-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Explorer</p>
                <h2 className="text-xl font-semibold text-slate-900 truncate">Remover pasta</h2>
                <p className="text-xs text-slate-500 mt-1 truncate">{deleteFolderTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 sm:px-8 py-5 space-y-3">
              <div className="text-sm text-slate-600">
                O que você deseja fazer com os itens dentro desta pasta?
              </div>
              <button
                type="button"
                onClick={() => void handleDeleteFolder({ folder: deleteFolderTarget, mode: 'move_root' })}
                disabled={deleteFolderSaving !== null}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left hover:bg-slate-50 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">Mover itens para “Sem pasta”</div>
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
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteFolderTarget(null)}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {createFolderModalOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setCreateFolderModalOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-orange-500" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Explorer</p>
                <h2 className="text-xl font-semibold text-slate-900">Nova pasta</h2>
                {createFolderParentId && (
                  <p className="text-xs text-slate-500 mt-1 truncate">Em: {folderPathLabelById.get(createFolderParentId) || '—'}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setCreateFolderModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 sm:px-8 py-6 space-y-2">
              <label className="text-xs font-semibold text-slate-500">Nome da pasta</label>
              <input
                autoFocus
                value={createFolderName}
                onChange={(e) => setCreateFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitCreateFolder();
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400"
                placeholder="Ex: Clientes, Contratos..."
              />
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
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
            </div>
          </div>
        </div>,
        document.body
      )}

      {contextMenu && (
        <div
          className="fixed z-[80]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-56 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
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

      {moveModalOpen && moveTarget && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-3 sm:px-6 py-4">
          <div
            className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
            onClick={() => setMoveModalOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg max-h-[92vh] bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
            <div className="h-2 w-full bg-indigo-600" />
            <div className="px-5 sm:px-8 py-5 border-b border-slate-200 bg-white flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Explorer</p>
                <h2 className="text-xl font-semibold text-slate-900">Mover item</h2>
              </div>
              <button
                type="button"
                onClick={() => setMoveModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition"
                aria-label="Fechar modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 sm:px-8 py-6">
              <div className="text-xs font-semibold text-slate-500 mb-2">Destino</div>
              <div className="max-h-72 overflow-y-auto rounded-2xl border border-slate-200">
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
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-4 sm:px-6 py-3">
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
                      if (!user?.id) return;
                      if (moveTarget.createdBy && moveTarget.createdBy !== user.id) {
                        toast.error('Você só pode mover itens que você criou');
                        return;
                      }
                      setMoveSaving(true);
                      try {
                        await handleMoveItemToFolder({ itemType: moveTarget.itemType, itemId: moveTarget.itemId, folderId: moveSelectedFolderId });
                      } finally {
                        setMoveSaving(false);
                      }
                      setMoveModalOpen(false);
                    }}
                    disabled={moveSaving}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
                  >
                    {moveSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Mover
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {detailsRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-slate-50/80 dark:bg-slate-50/80 backdrop-blur-md">
          <div className="bg-white dark:bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 dark:border-slate-200 w-full max-w-2xl max-h-[92vh] sm:max-h-[82vh] overflow-hidden flex flex-col mx-auto">
            <div className="h-2 sm:h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />

            <div className="relative px-3 sm:px-6 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-200 bg-white dark:bg-white flex flex-col gap-1.5 sm:gap-2">
              <div className="min-w-0">
                <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-400">Detalhes</div>
                <h2 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-900 truncate">{detailsRequest.document_name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Criado em {formatDate(detailsRequest.created_at)}</p>
              </div>
              <button
                onClick={() => {
                  detailsRequestIdRef.current = null;
                  detailsLoadTokenRef.current += 1;
                  setAuditLogLoading(false);
                  setAuditLog([]);
                  setSignerImages({});
                  setDetailsRequest(null);
                }}
                className="absolute top-2 sm:top-3 right-2 sm:right-3 p-2 text-slate-400 hover:text-slate-600 rounded-lg disabled:opacity-50"
                aria-label="Fechar detalhes"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 sm:space-y-5 bg-white dark:bg-white">
              {/* Info compacta */}
              <div className="flex flex-wrap gap-4 text-sm">
                {detailsRequest.client_name && (
                  <div><span className="text-slate-500">Cliente:</span> <span className="font-medium text-slate-700">{detailsRequest.client_name}</span></div>
                )}
                {detailsRequest.process_number && (
                  <div><span className="text-slate-500">Processo:</span> <span className="font-medium text-slate-700">{detailsRequest.process_number}</span></div>
                )}
                {cloudSyncStatusByRequestId[detailsRequest.id] ? (
                  <div><span className="text-slate-500">Cloud:</span> <span className="font-medium text-emerald-700">Pasta criada</span></div>
                ) : null}
                <div>
                  <span className="text-slate-500">Status:</span>{' '}
                  {detailsRequest.signers.every(s => s.status === 'signed') ? (
                    <span className="text-emerald-600 font-medium">Todos assinaram</span>
                  ) : (
                    <span className="text-amber-600 font-medium">{detailsRequest.signers.filter(s => s.status === 'pending').length} pendente(s)</span>
                  )}
                </div>
              </div>

              {/* Botões de ação */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  {detailsRequest.document_path && (
                    <button
                      disabled={viewDocLoading}
                      onClick={async () => {
                        try {
                          setViewDocLoading(true);
                          
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
                                    ignoreHeight: false,
                                    breakPages: true,
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
                      className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition shadow-sm disabled:opacity-70 disabled:cursor-wait w-full sm:flex-1"
                    >
                      {viewDocLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Abrindo...
                        </>
                      ) : (
                        <>
                          <Eye className="w-4 h-4" />
                          {detailsRequest.signers.some(s => s.status === 'signed') ? 'Ver assinado' : 'Visualizar'}
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => handleDownloadDocument(detailsRequest)}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 transition shadow-sm w-full sm:flex-1"
                  >
                    <Download className="w-4 h-4" />
                    Baixar documento
                  </button>
                  <button
                    onClick={() => handleDeleteRequest(detailsRequest.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 transition shadow-sm w-full sm:w-auto sm:px-6"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir
                  </button>
                </div>

                {detailsRequest.signers.every((s) => s.status === 'signed') && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap items-center justify-start gap-6 mt-2 pl-1">
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
                        className="group flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-orange-500 transition-colors disabled:opacity-70"
                      >
                        {openProcessLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Abrindo...</span>
                          </>
                        ) : (
                          <>
                            {detailsRequest.process_id ? (
                              <ExternalLink className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            ) : showCreateProcess ? (
                              <EyeOff className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            ) : (
                              <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            )}
                            <span className="hover:underline underline-offset-4">
                              {detailsRequest.process_id ? 'Abrir processo' : (showCreateProcess ? 'Ocultar processo' : 'Criar processo')}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          if (!detailsRequest.client_id) {
                            toast.error('Vincule um cliente para criar o requerimento.');
                            return;
                          }
                          const cpf = detailsRequest.signers.find((s) => s.cpf)?.cpf || undefined;
                          const beneficiary = detailsRequest.client_name || undefined;
                          setDetailsRequest(null);
                          const prefillData = {
                            client_id: detailsRequest.client_id,
                            beneficiary,
                            cpf,
                            signature_id: detailsRequest.id,
                          };
                          
                          navigateTo('requerimentos', {
                            mode: 'create',
                            prefill: prefillData,
                          } as any);
                        }}
                        className="group flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-orange-500 transition-colors"
                      >
                        <FileText className="w-4 h-4 group-hover:scale-110 transition-transform" />
                        <span className="hover:underline underline-offset-4">Requerimento</span>
                      </button>
                      <button
                        disabled={copyToCloudLoading}
                        onClick={() => handleCopySignedDocumentToCloud(detailsRequest)}
                        className="group flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-orange-500 transition-colors disabled:opacity-70"
                      >
                        {copyToCloudLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Copiando...</span>
                          </>
                        ) : (
                          <>
                            <FolderOpen className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            <span className="hover:underline underline-offset-4">Criar pasta</span>
                          </>
                        )}
                      </button>
                    </div>

                    {showCreateProcess && !detailsRequest.process_id && (
                      <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                          <select
                            value={createProcessArea}
                            onChange={(e) => setCreateProcessArea(e.target.value as ProcessPracticeArea)}
                            className="w-full sm:w-auto px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all"
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
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm w-full sm:w-auto disabled:opacity-70 disabled:cursor-wait"
                          >
                            {createProcessLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Criando...
                              </>
                            ) : (
                              <>
                                <Plus className="w-4 h-4" />
                                Criar
                              </>
                            )}
                          </button>
                        </div>
                        <div className="mt-4 p-3 rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-200">
                          <div className="flex items-start gap-3">
                            <div className="relative">
                              <input
                                type="checkbox"
                                id="urgent-process"
                                checked={createProcessUrgent}
                                onChange={(e) => setCreateProcessUrgent(e.target.checked)}
                                className="w-5 h-5 rounded border-red-300 text-red-600 focus:ring-2 focus:ring-red-500 focus:ring-offset-0 cursor-pointer"
                              />
                              {createProcessUrgent && (
                                <div className="absolute -top-1 -left-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                              )}
                            </div>
                            <div className="flex-1">
                              <label htmlFor="urgent-process" className="flex items-center gap-2 text-sm font-semibold text-red-800 cursor-pointer hover:text-red-900 transition-colors">
                                <AlertTriangle className="w-4 h-4" />
                                Marcar como urgente
                              </label>
                              <p className="text-xs text-red-600 mt-1">Processo será priorizado em todas as visualizações</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Signatários */}
              <div>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Signatários ({detailsRequest.signers.length})
                </h3>
                <div className="space-y-3">
                  {detailsRequest.signers.map((signer) => {
                    const facialUrl = signerImages[signer.id]?.facial || null;
                    const signatureUrl = signerImages[signer.id]?.signature || null;
                    const geoLocation = signer.geolocation || signer.signer_geolocation;
                    
                    return (
                    <div key={signer.id} className={`p-3 sm:p-5 rounded-xl border ${signer.status === 'signed' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                        <div className="flex items-start gap-3 sm:gap-4">
                          {/* Foto facial do signatário - clicável para ampliar */}
                          {signer.status === 'signed' && facialUrl ? (
                            <button 
                              onClick={() => setZoomImageUrl(facialUrl)}
                              className="relative group flex-shrink-0"
                              title="Clique para ampliar"
                            >
                              <img 
                                src={facialUrl}
                                alt="Foto facial"
                                className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border-2 border-emerald-300 group-hover:border-emerald-500 transition-all"
                                style={{ transform: 'scaleX(-1)' }}
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-xl flex items-center justify-center transition-all">
                                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-all" />
                              </div>
                            </button>
                          ) : (
                            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-xl flex items-center justify-center flex-shrink-0 ${signer.status === 'signed' ? 'bg-emerald-100' : 'bg-orange-100'}`}>
                              <User className={`w-8 h-8 sm:w-10 sm:h-10 ${signer.status === 'signed' ? 'text-emerald-600' : 'text-orange-600'}`} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                              <p className="font-semibold text-slate-800 text-base sm:text-lg truncate">{signer.name}</p>
                              <div className="sm:ml-auto">{getStatusBadge(signer.status)}</div>
                            </div>
                            
                            {/* Grid de informações */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                              {/* Método de autenticação */}
                              {signer.auth_provider && (
                                <div className="flex flex-col sm:flex-row items-start gap-2 col-span-2">
                                  <div className="flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                    <p className="text-sm text-emerald-600 font-medium">
                                      {signer.auth_provider === 'google' && `Autenticado via Google (${signer.auth_email || signer.email})`}
                                      {signer.auth_provider === 'email_link' && `Autenticado via Link por E-mail (${signer.auth_email || signer.email})`}
                                    </p>
                                  </div>
                                  {geoLocation && (
                                    <a 
                                      href={`https://www.google.com/maps?q=${geoLocation.replace(/\s/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-orange-600 hover:text-orange-800 hover:underline flex items-center gap-1 ml-0 sm:ml-auto"
                                    >
                                      {geoLocation}
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                              )}
                              
                              {/* User Agent */}
                              {signer.signer_user_agent && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                                  <p className="text-sm text-slate-500 break-all" title={signer.signer_user_agent}>
                                    User Agent: {signer.signer_user_agent.length > 80 ? signer.signer_user_agent.slice(0, 80) + '...' : signer.signer_user_agent}
                                  </p>
                                </div>
                              )}
                              
                              {/* Device Info */}
                              {signer.device_info && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                                  <p className="text-sm text-slate-500 break-all" title={signer.device_info}>
                                    Dispositivo: {signer.device_info.length > 80 ? signer.device_info.slice(0, 80) + '...' : signer.device_info}
                                  </p>
                                </div>
                              )}
                            </div>
                            
                            {/* Imagem da assinatura */}
                            {signer.status === 'signed' && signatureUrl && (
                              <div className="mt-4 p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs text-slate-500 mb-2 font-medium">Assinatura:</p>
                                <img 
                                  src={signatureUrl}
                                  alt="Assinatura"
                                  className="max-h-20 object-contain cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={() => setZoomImageUrl(signatureUrl)}
                                  title="Clique para ampliar"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {signer.status === 'pending' && (
                        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input 
                            type="text" 
                            readOnly 
                            value={signatureService.generatePublicSigningUrl(signer.public_token!)} 
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono" 
                          />
                          <div className="flex gap-2">
                            <button 
                              onClick={() => copyLink(signer.public_token!)} 
                              className="flex items-center gap-1.5 px-3 py-2 text-orange-600 hover:bg-orange-50 rounded-lg text-sm font-medium"
                            >
                              <Copy className="w-4 h-4" />
                              Copiar
                            </button>
                            <button 
                              onClick={() => window.open(signatureService.generatePublicSigningUrl(signer.public_token!), '_blank')}
                              className="flex items-center gap-1.5 px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Abrir
                            </button>
                            <button 
                              onClick={() => openSignModal(signer)} 
                              className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                            >
                              <PenTool className="w-4 h-4" />
                              Assinar
                            </button>
                          </div>
                        </div>
                      )}
                      {signer.status === 'signed' && signer.verification_hash && (
                        <div className="mt-3 pt-3 border-t border-emerald-200">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Hash de verificação:</p>
                              <p className="text-xs font-mono text-slate-600 truncate">{signer.verification_hash}</p>
                            </div>
                            <a
                              href={`${window.location.origin}/#/verificar/${signer.verification_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-200 transition-colors"
                            >
                              <Shield className="w-3.5 h-3.5" />
                              Verificar autenticidade
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Histórico de Atividades (Audit Log) */}
              <div className="mt-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Histórico de Atividades
                </h3>
                {auditLogLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                ) : auditLog.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhuma atividade registrada</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Linha vertical da timeline (mostra apenas em telas médias+) */}
                    <div className="hidden sm:block absolute left-4 top-2 bottom-2 w-0.5 bg-slate-200" />
                    
                    <div className="space-y-4">
                      {auditLog.map((log, index) => {
                        const isFirst = index === 0;
                        const isLast = index === auditLog.length - 1;
                        
                        // Ícone e cor baseado na ação
                        let iconBg = 'bg-slate-100';
                        let iconColor = 'text-slate-500';
                        let Icon = Clock;
                        
                        if (log.action === 'created') {
                          iconBg = 'bg-orange-100';
                          iconColor = 'text-orange-600';
                          Icon = FileText;
                        } else if (log.action === 'sent') {
                          iconBg = 'bg-purple-100';
                          iconColor = 'text-purple-600';
                          Icon = Send;
                        } else if (log.action === 'viewed') {
                          iconBg = 'bg-amber-100';
                          iconColor = 'text-amber-600';
                          Icon = Eye;
                        } else if (log.action === 'signed') {
                          iconBg = 'bg-emerald-100';
                          iconColor = 'text-emerald-600';
                          Icon = CheckCircle;
                        } else if (log.action === 'cancelled') {
                          iconBg = 'bg-red-100';
                          iconColor = 'text-red-600';
                          Icon = X;
                        } else if (log.action === 'reminder_sent') {
                          iconBg = 'bg-orange-100';
                          iconColor = 'text-orange-600';
                          Icon = Send;
                        }
                        
                        return (
                          <div key={log.id} className="relative flex flex-col sm:flex-row gap-3 sm:gap-4 sm:pl-2 border border-slate-100 sm:border-0 rounded-xl sm:rounded-none p-3 sm:p-0">
                            {/* Ícone */}
                            <div className={`relative z-10 w-9 h-9 sm:w-8 sm:h-8 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-4 h-4 ${iconColor}`} />
                            </div>
                            
                            {/* Conteúdo */}
                            <div className={`flex-1 pb-0 sm:pb-4 ${!isLast ? 'sm:border-b sm:border-slate-100' : ''}`}>
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="text-sm text-slate-800">
                                  <p className="font-medium">{log.description}</p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {new Date(log.created_at).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </p>
                                </div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-fit ${
                                  log.action === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                                  log.action === 'viewed' ? 'bg-amber-100 text-amber-700' :
                                  log.action === 'created' ? 'bg-orange-100 text-orange-700' :
                                  log.action === 'sent' ? 'bg-purple-100 text-purple-700' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {log.action === 'created' && 'Criado'}
                                  {log.action === 'sent' && 'Enviado'}
                                  {log.action === 'viewed' && 'Visualizado'}
                                  {log.action === 'signed' && 'Assinado'}
                                  {log.action === 'cancelled' && 'Cancelado'}
                                  {log.action === 'expired' && 'Expirado'}
                                  {log.action === 'reminder_sent' && 'Lembrete'}
                                </span>
                              </div>
                              
                              {/* Detalhes extras */}
                              {(log.ip_address || log.user_agent) && (
                                <div className="mt-2 p-2 bg-slate-50 rounded-lg text-xs text-slate-500">
                                  {log.ip_address && <p>IP: {log.ip_address}</p>}
                                  {log.user_agent && (
                                    <p className="truncate" title={log.user_agent}>
                                      Dispositivo: {log.user_agent.slice(0, 60)}...
                                    </p>
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
              </div>
            </div>
          </div>
        </div>
      )}
      {signModalOpen && signingSigner && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-50/80 dark:bg-slate-50/80 backdrop-blur-md">
          <div className="bg-white dark:bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 dark:border-slate-200 w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col mx-auto">
            <div className="h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-200 bg-white dark:bg-white flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assinar documento</div>
                <h2 className="mt-1 text-base sm:text-lg font-semibold text-slate-900 truncate">{signingSigner.name}</h2>
              </div>
              <button onClick={() => setSignModalOpen(false)} className="self-end sm:self-auto p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-white dark:bg-white">
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
                  {signatureData && (
                    <div className="p-3 bg-slate-50 rounded mb-3">
                      <p className="text-xs text-slate-500 mb-1">Assinatura</p>
                      <img src={signatureData} alt="Assinatura" className="max-w-full max-h-20 border border-slate-200 rounded bg-white" />
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
            </div>
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-slate-200">
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
                  disabled={signLoading} 
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
          </div>
        </div>
      )}
      {/* Modal de zoom para imagens */}
      {zoomImageUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-slate-50/80 dark:bg-slate-50/80 backdrop-blur-md"
          onClick={() => setZoomImageUrl(null)}
        >
          <div
            className="bg-white dark:bg-white rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] border border-slate-200 dark:border-slate-200 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-3 w-full shrink-0 bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-200 bg-white dark:bg-white flex items-start justify-between gap-3">
              <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-400">Visualização</div>
              <button
                onClick={() => setZoomImageUrl(null)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-2 sm:p-4 bg-slate-50 dark:bg-slate-50 flex items-center justify-center">
              <img
                src={zoomImageUrl}
                alt="Imagem ampliada"
                className="max-w-full max-h-[70vh] sm:max-h-[75vh] object-contain rounded-xl border border-slate-200 bg-white"
                style={{ transform: zoomImageUrl.includes('facial') ? 'scaleX(-1)' : 'none' }}
              />
            </div>
          </div>
        </div>
      )}
      {/* Modal de confirmação de exclusão */}
    </div>
  );
};

export default SignatureModule;
