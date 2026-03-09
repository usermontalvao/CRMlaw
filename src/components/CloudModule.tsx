import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Image as ImageIcon,
  History,
  Link2,
  Loader2,
  Minimize2,
  MoveRight,
  MoreHorizontal,
  Pin,
  Search,
  Share2,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cloudService } from '../services/cloud.service';
import { clientService } from '../services/client.service';
import { useToastContext } from '../contexts/ToastContext';
import { ClientSearchSelect } from './ClientSearchSelect';
import SyncfusionEditor, { type SyncfusionEditorRef } from './SyncfusionEditor';
import { events, SYSTEM_EVENTS } from '../utils/events';
import type { Client } from '../types/client.types';
import type { CloudFile, CloudFolder } from '../types/cloud.types';

const isImageFile = (mime?: string | null) => Boolean(mime?.startsWith('image/'));
const isPdfFile = (mime?: string | null, name?: string) => mime === 'application/pdf' || String(name || '').toLowerCase().endsWith('.pdf');
const isWordFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mime === 'application/msword'
    || lower.endsWith('.docx')
    || lower.endsWith('.doc');
};

const isDocxFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx');
};

const formatFileSize = (value: number) => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getFileTypeLabel = (file: CloudFile) => {
  if (isPdfFile(file.mime_type, file.original_name)) return 'PDF';
  if (isImageFile(file.mime_type)) return 'Imagem';
  if (isWordFile(file.mime_type, file.original_name)) return 'Documento Word';
  return file.extension?.toUpperCase() || 'Arquivo';
};

type FolderLabelConfig = {
  id: string;
  name: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
};

const DEFAULT_FOLDER_LABELS: FolderLabelConfig[] = [
  {
    id: 'pendente',
    name: 'Pendente',
    color: '#f59e0b',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    borderClass: 'border-amber-200',
  },
  {
    id: 'concluido',
    name: 'Concluído',
    color: '#10b981',
    bgClass: 'bg-emerald-50',
    textClass: 'text-emerald-700',
    borderClass: 'border-emerald-200',
  },
];

const CLOUD_FOLDER_LABELS_STORAGE_KEY = 'cloud-folder-labels-v1';
const CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY = 'cloud-folder-label-assignments-v1';

const normalizeLabelId = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

interface CloudModuleProps {
  onNavigateToModule?: (moduleKey: string, params?: Record<string, any>) => void;
}

const CloudModule: React.FC<CloudModuleProps> = ({ onNavigateToModule }) => {
  const toast = useToastContext();
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [allFolders, setAllFolders] = useState<CloudFolder[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderClientId, setFolderClientId] = useState('');
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [selectedFileToMove, setSelectedFileToMove] = useState<CloudFile | null>(null);
  const [targetFolderId, setTargetFolderId] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [selectedFolderForShare, setSelectedFolderForShare] = useState<CloudFolder | null>(null);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderLabels, setFolderLabels] = useState<FolderLabelConfig[]>(DEFAULT_FOLDER_LABELS);
  const [folderLabelAssignments, setFolderLabelAssignments] = useState<Record<string, string>>({});
  const [selectedFolderLabelId, setSelectedFolderLabelId] = useState('pendente');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#f97316');
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; type: 'folder'; folderId: string }
    | { x: number; y: number; type: 'file'; fileId: string }
    | null
  >(null);

  const currentFolder = useMemo(
    () => (currentFolderId ? allFolders.find((item) => item.id === currentFolderId) ?? null : null),
    [allFolders, currentFolderId],
  );

  const folderChildrenMap = useMemo(() => {
    const map = new Map<string | null, CloudFolder[]>();
    for (const folder of allFolders) {
      const key = folder.parent_id ?? null;
      const current = map.get(key) ?? [];
      current.push(folder);
      map.set(key, current);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    }
    return map;
  }, [allFolders]);

  const breadcrumb = useMemo(() => {
    const items: CloudFolder[] = [];
    let cursor = currentFolder;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parent_id ? allFolders.find((item) => item.id === cursor?.parent_id) ?? null : null;
    }
    return items;
  }, [allFolders, currentFolder]);

  const rootFolders = useMemo(() => folderChildrenMap.get(null) ?? [], [folderChildrenMap]);

  const quickAccessFolders = useMemo(() => {
    return [...allFolders]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 6);
  }, [allFolders]);

  const currentClient = useMemo(
    () => clients.find((item) => item.id === currentFolder?.client_id) ?? null,
    [clients, currentFolder],
  );

  const selectedFile = useMemo(() => {
    if (!selectedItemKey?.startsWith('file:')) return null;
    const fileId = selectedItemKey.replace('file:', '');
    return files.find((item) => item.id === fileId) ?? null;
  }, [files, selectedItemKey]);

  const selectedFolder = useMemo(() => {
    if (!selectedItemKey?.startsWith('folder:')) return null;
    const folderId = selectedItemKey.replace('folder:', '');
    return folders.find((item) => item.id === folderId) ?? allFolders.find((item) => item.id === folderId) ?? null;
  }, [folders, allFolders, selectedItemKey]);

  const selectedClient = useMemo(() => {
    const clientId = selectedFile?.client_id || selectedFolder?.client_id || null;
    return clients.find((item) => item.id === clientId) ?? null;
  }, [clients, selectedFile, selectedFolder]);

  const breadcrumbLabel = useMemo(() => {
    if (breadcrumb.length === 0) return 'Cloud / Raiz';
    return `Cloud / ${breadcrumb.map((item) => item.name).join(' / ')}`;
  }, [breadcrumb]);

  const getFolderLabel = useCallback(
    (folderId: string) => {
      const assignedId = folderLabelAssignments[folderId] || 'pendente';
      return folderLabels.find((item) => item.id === assignedId) ?? DEFAULT_FOLDER_LABELS[0];
    },
    [folderLabelAssignments, folderLabels],
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [foldersData, filesData, allFoldersData, clientsData] = await Promise.all([
        cloudService.listFolders(currentFolderId),
        currentFolderId ? cloudService.listFiles(currentFolderId) : Promise.resolve([]),
        cloudService.listAllFolders(),
        clientService.listClients(),
      ]);
      setFolders(foldersData);
      setFiles(filesData);
      setAllFolders(allFoldersData);
      setClients(clientsData);
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao carregar arquivos.');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }

    let revokedUrl: string | null = null;
    const loadPreview = async () => {
      try {
        setPreviewLoading(true);
        const signedUrl = await cloudService.getFileSignedUrl(previewFile.storage_path);
        if (isDocxFile(previewFile.mime_type, previewFile.original_name)) {
          const response = await fetch(signedUrl);
          const buffer = await response.arrayBuffer();
          await editorRef.current?.loadDocxViaImport(buffer, previewFile.original_name);
          setPreviewUrl(null);
        } else if (isWordFile(previewFile.mime_type, previewFile.original_name)) {
          await handleOpenDocxEditor(previewFile);
        } else {
          setPreviewUrl(signedUrl);
          revokedUrl = signedUrl.startsWith('blob:') ? signedUrl : null;
        }
      } catch (error: any) {
        toast.error('Preview', error.message || 'Erro ao abrir arquivo.');
      } finally {
        setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [previewFile, toast, currentFolder]);

  useEffect(() => {
    if (currentFolderId) {
      setExpandedFolders((prev) => ({ ...prev, [currentFolderId]: true }));
    }
  }, [currentFolderId]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  useEffect(() => {
    try {
      const storedLabels = window.localStorage.getItem(CLOUD_FOLDER_LABELS_STORAGE_KEY);
      const storedAssignments = window.localStorage.getItem(CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY);

      if (storedLabels) {
        const parsed = JSON.parse(storedLabels) as FolderLabelConfig[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setFolderLabels(parsed);
        }
      }

      if (storedAssignments) {
        const parsedAssignments = JSON.parse(storedAssignments) as Record<string, string>;
        if (parsedAssignments && typeof parsedAssignments === 'object') {
          setFolderLabelAssignments(parsedAssignments);
        }
      }
    } catch (error) {
      console.warn('Cloud labels storage load failed:', error);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FOLDER_LABELS_STORAGE_KEY, JSON.stringify(folderLabels));
  }, [folderLabels]);

  useEffect(() => {
    window.localStorage.setItem(CLOUD_FOLDER_LABEL_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(folderLabelAssignments));
  }, [folderLabelAssignments]);

  const filteredFolders = useMemo(() => {
    if (!searchTerm.trim()) return folders;
    const term = searchTerm.toLowerCase();
    return folders.filter((item) => item.name.toLowerCase().includes(term));
  }, [folders, searchTerm]);

  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) return files;
    const term = searchTerm.toLowerCase();
    return files.filter((item) => item.original_name.toLowerCase().includes(term));
  }, [files, searchTerm]);

  const explorerRows = useMemo(
    () => [
      ...filteredFolders.map((folder) => ({ kind: 'folder' as const, folder })),
      ...filteredFiles.map((file) => ({ kind: 'file' as const, file })),
    ],
    [filteredFolders, filteredFiles],
  );

  const handleOpenCreateFolder = () => {
    setFolderName('');
    setFolderClientId(currentFolder?.client_id || '');
    setSelectedFolderLabelId('pendente');
    setNewLabelName('');
    setNewLabelColor('#f97316');
    setFolderModalOpen(true);
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    try {
      await cloudService.createFolder({
        name: folderName.trim(),
        parent_id: currentFolderId,
        client_id: folderClientId || null,
      });
      const refreshedFolders = await cloudService.listAllFolders();
      const createdFolder = refreshedFolders.find((item) => item.name === folderName.trim() && item.parent_id === currentFolderId) ?? null;
      if (createdFolder) {
        setFolderLabelAssignments((prev) => ({ ...prev, [createdFolder.id]: selectedFolderLabelId || 'pendente' }));
      }
      toast.success('Cloud', 'Pasta criada com sucesso.');
      setFolderModalOpen(false);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao criar pasta.');
    }
  };

  const handleUploadFiles = async (list: FileList | File[]) => {
    if (!currentFolderId) {
      toast.info('Cloud', 'Crie ou selecione uma pasta antes de enviar arquivos.');
      return;
    }

    const filesToUpload = Array.from(list);
    if (filesToUpload.length === 0) return;

    try {
      setUploading(true);
      await cloudService.uploadFiles(currentFolderId, filesToUpload, currentFolder?.client_id || null);
      toast.success('Cloud', `${filesToUpload.length} arquivo(s) enviado(s).`);
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro no upload.');
    } finally {
      setUploading(false);
      setDragActive(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleMoveFile = async () => {
    if (!selectedFileToMove || !targetFolderId) return;
    try {
      const targetFolder = allFolders.find((item) => item.id === targetFolderId) ?? null;
      await cloudService.moveFile(selectedFileToMove.id, targetFolderId, targetFolder?.client_id || null);
      toast.success('Cloud', 'Arquivo movido com sucesso.');
      setMoveModalOpen(false);
      setSelectedFileToMove(null);
      setTargetFolderId('');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao mover arquivo.');
    }
  };

  const handleCreateShare = async () => {
    if (!selectedFolderForShare) return;
    try {
      const share = await cloudService.createShare({
        folder_id: selectedFolderForShare.id,
        password: sharePassword || undefined,
        expires_at: shareExpiresAt ? new Date(`${shareExpiresAt}T23:59:59`).toISOString() : null,
      });
      const publicUrl = cloudService.buildPublicShareUrl(share.token);
      setShareLink(publicUrl);
      toast.success('Cloud', 'Link público criado com sucesso.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao criar link público.');
    }
  };

  const handleDeleteFile = async (file: CloudFile) => {
    try {
      await cloudService.deleteFile(file);
      toast.success('Cloud', 'Arquivo removido.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao remover arquivo.');
    }
  };

  const toggleTreeFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleCreateCustomLabel = () => {
    const trimmed = newLabelName.trim();
    if (!trimmed) return;

    const labelId = normalizeLabelId(trimmed);
    if (!labelId) return;

    const exists = folderLabels.some((item) => item.id === labelId || item.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      toast.info('Cloud', 'Essa etiqueta já existe.');
      return;
    }

    const label: FolderLabelConfig = {
      id: labelId,
      name: trimmed,
      color: newLabelColor,
      bgClass: 'bg-orange-50',
      textClass: 'text-orange-700',
      borderClass: 'border-orange-200',
    };

    setFolderLabels((prev) => [...prev, label]);
    setSelectedFolderLabelId(label.id);
    setNewLabelName('');
    toast.success('Cloud', 'Etiqueta cadastrada com sucesso.');
  };

  const handleAssignFolderLabel = (folderId: string, labelId: string) => {
    setFolderLabelAssignments((prev) => ({ ...prev, [folderId]: labelId }));
  };

  const handleLinkFolderClient = async (folderId: string, clientId: string) => {
    try {
      await cloudService.updateFolder(folderId, { client_id: clientId || null });
      toast.success('Cloud', clientId ? 'Cliente vinculado com sucesso.' : 'Vínculo removido com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao atualizar vínculo da pasta.');
    }
  };

  const handleOpenDocxEditor = async (file: CloudFile) => {
    try {
      const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
      toast.info('Cloud', 'Abrindo arquivo Word no editor de petições...');
      events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, {
        clientId: file.client_id || currentFolder?.client_id,
        mode: 'new',
        initialDocumentUrl: signedUrl,
        initialDocumentName: file.original_name,
        initialCloudFileId: file.id,
        openRequestId: crypto.randomUUID(),
      });
      setPreviewFile(null);
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao abrir arquivo Word.');
    }
  };

  const triggerBrowserDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadSingleFile = async (file: CloudFile) => {
    const signedUrl = await cloudService.getFileSignedUrl(file.storage_path);
    const response = await fetch(signedUrl);
    if (!response.ok) throw new Error('Não foi possível baixar o arquivo.');
    const blob = await response.blob();
    triggerBrowserDownload(blob, file.original_name || 'arquivo');
  };

  const collectFolderFiles = async (folderId: string, relativePrefix = ''): Promise<Array<{ file: CloudFile; relativePath: string }>> => {
    const [folderFiles, childFolders] = await Promise.all([
      cloudService.listFiles(folderId),
      cloudService.listFolders(folderId),
    ]);

    const currentEntries = folderFiles.map((file) => ({
      file,
      relativePath: `${relativePrefix}${file.original_name}`,
    }));

    const nestedEntries = await Promise.all(
      childFolders.map((folder) => collectFolderFiles(folder.id, `${relativePrefix}${folder.name}/`)),
    );

    return [...currentEntries, ...nestedEntries.flat()];
  };

  const handleDownloadFile = async (file: CloudFile) => {
    try {
      await downloadSingleFile(file);
      toast.success('Cloud', 'Download iniciado.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao baixar arquivo.');
    }
  };

  const handleDownloadFolder = async (folder: CloudFolder) => {
    try {
      const entries = await collectFolderFiles(folder.id);
      if (entries.length === 0) {
        toast.info('Cloud', 'A pasta não possui arquivos para download.');
        return;
      }

      if (entries.length === 1) {
        await downloadSingleFile(entries[0].file);
        toast.success('Cloud', 'Download iniciado.');
        return;
      }

      const zip = new JSZip();
      for (const entry of entries) {
        const signedUrl = await cloudService.getFileSignedUrl(entry.file.storage_path);
        const response = await fetch(signedUrl);
        if (!response.ok) {
          throw new Error(`Não foi possível baixar ${entry.file.original_name}.`);
        }
        const blob = await response.blob();
        zip.file(entry.relativePath, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      triggerBrowserDownload(zipBlob, `${folder.name || 'pasta'}.zip`);
      toast.success('Cloud', 'Download da pasta iniciado.');
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao baixar pasta.');
    }
  };

  const handleDeleteFolder = async (folder: CloudFolder) => {
    const confirmed = window.confirm(`Deseja excluir a pasta "${folder.name}"?`);
    if (!confirmed) return;

    try {
      await cloudService.deleteFolder(folder.id);
      setFolderLabelAssignments((prev) => {
        const next = { ...prev };
        delete next[folder.id];
        return next;
      });
      if (currentFolderId === folder.id) {
        setCurrentFolderId(folder.parent_id || null);
      }
      if (selectedItemKey === `folder:${folder.id}`) {
        setSelectedItemKey(null);
      }
      toast.success('Cloud', 'Pasta excluída com sucesso.');
      await loadData();
    } catch (error: any) {
      toast.error('Cloud', error.message || 'Erro ao excluir pasta.');
    }
  };

  const handleOpenFolderShare = (folder: CloudFolder) => {
    setSelectedFolderForShare(folder);
    setSharePassword('');
    setShareExpiresAt('');
    setShareLink('');
    setShareModalOpen(true);
  };

  const openFolderFromContextMenu = (folder: CloudFolder) => {
    setCurrentFolderId(folder.id);
    setSelectedItemKey(`folder:${folder.id}`);
    setContextMenu(null);
  };

  const openFileFromContextMenu = (file: CloudFile) => {
    setSelectedItemKey(`file:${file.id}`);
    if (isWordFile(file.mime_type, file.original_name)) {
      handleOpenDocxEditor(file);
    } else {
      setPreviewFile(file);
    }
    setContextMenu(null);
  };

  const selectedContextFolder = useMemo(() => {
    if (!contextMenu || contextMenu.type !== 'folder') return null;
    return allFolders.find((item) => item.id === contextMenu.folderId) ?? null;
  }, [allFolders, contextMenu]);

  const selectedContextFile = useMemo(() => {
    if (!contextMenu || contextMenu.type !== 'file') return null;
    return files.find((item) => item.id === contextMenu.fileId) ?? null;
  }, [files, contextMenu]);

  const handleOpenInPetitionModule = () => {
    events.emit(SYSTEM_EVENTS.PETITION_EDITOR_OPEN, {
      clientId: selectedFile?.client_id || selectedFolder?.client_id,
      mode: 'new',
    });
    toast.info('Cloud', 'Editor de petição aberto.');
  };

  const renderTree = (items: CloudFolder[], depth = 0): React.ReactNode => {
    return items.map((folder) => {
      const children = folderChildrenMap.get(folder.id) ?? [];
      const expanded = expandedFolders[folder.id] ?? false;
      const isActive = currentFolderId === folder.id;

      return (
        <div key={folder.id}>
          <div
            className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition ${
              isActive ? 'bg-orange-100 text-orange-900' : 'text-slate-700 hover:bg-orange-50'
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            <button
              type="button"
              onClick={() => children.length > 0 && toggleTreeFolder(folder.id)}
              className="w-4 h-4 flex items-center justify-center text-slate-400"
            >
              {children.length > 0 ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentFolderId(folder.id);
                setSelectedItemKey(`folder:${folder.id}`);
              }}
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
            >
              {isActive ? <FolderOpen className="w-4 h-4 text-orange-500" /> : <Folder className="w-4 h-4 text-orange-500" />}
              <span className="truncate">{folder.name}</span>
            </button>
          </div>
          {expanded && children.length > 0 ? renderTree(children, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="w-full h-[calc(100vh-10rem)] min-h-[720px] rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm flex flex-col">
      <div className="h-12 border-b border-slate-200 bg-slate-50 px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
            <Cloud className="w-4 h-4 text-orange-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">Cloud</p>
            <p className="text-[11px] text-slate-500 truncate">{breadcrumbLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {uploading ? <Loader2 className="w-4 h-4 text-orange-600 animate-spin" /> : null}
          <span className="text-[11px] text-slate-500">{explorerRows.length} item(ns)</span>
        </div>
      </div>

      <div className="h-12 border-b border-slate-200 bg-white px-3 flex items-center gap-2">
        <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white text-sm shadow-sm">
          <Upload className="w-4 h-4" />
          Enviar
        </button>
        <button onClick={handleOpenCreateFolder} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm border border-orange-200">
          <FolderPlus className="w-4 h-4" />
          Nova pasta
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUploadFiles(e.target.files)} />
        <div className="ml-auto flex items-center gap-2 w-full max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar nesta pasta"
              className="w-full rounded-md border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 pl-9 pr-3 py-2 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[280px] border-r border-slate-200 bg-slate-50 flex flex-col">
          <div className="px-3 py-3 border-b border-slate-200">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud / Raiz</p>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-4">
            <div className="space-y-1">
            <button
              type="button"
              onClick={() => {
                setCurrentFolderId(null);
                setSelectedItemKey('root');
              }}
              className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                currentFolderId === null ? 'bg-orange-100 text-orange-900' : 'text-slate-700 hover:bg-orange-50'
              }`}
            >
              <HardDrive className="w-4 h-4 text-orange-600" />
              <span>Cloud</span>
            </button>
            {renderTree(rootFolders)}
            </div>

            <div className="space-y-2">
              <p className="px-2 text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold">Recentes</p>
              <div className="space-y-1">
                {quickAccessFolders.length === 0 ? (
                  <p className="px-2 text-xs text-slate-500">Nenhuma pasta recente.</p>
                ) : (
                  quickAccessFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        setCurrentFolderId(folder.id);
                        setSelectedItemKey(`folder:${folder.id}`);
                      }}
                      className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-orange-50"
                    >
                      <History className="w-4 h-4 text-slate-400" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col bg-white">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
            <div className="flex items-center flex-wrap gap-2 text-sm text-slate-600 min-w-0">
              <button onClick={() => setCurrentFolderId(null)} className="hover:text-slate-900 inline-flex items-center gap-1"><Home className="w-4 h-4" />Cloud</button>
              {breadcrumb.map((item) => (
                <React.Fragment key={item.id}>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                  <button onClick={() => setCurrentFolderId(item.id)} className="hover:text-slate-900 truncate max-w-[220px]">{item.name}</button>
                </React.Fragment>
              ))}
            </div>
            <div className="text-xs text-slate-500 whitespace-nowrap">{currentClient?.full_name || 'Sem cliente'}</div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files) handleUploadFiles(e.dataTransfer.files);
            }}
            className={`relative flex-1 min-h-0 flex flex-col ${dragActive ? 'bg-sky-50' : ''}`}
          >
            <div className="grid grid-cols-[minmax(320px,2.6fr)_170px_170px_130px_220px] gap-3 px-4 py-2 border-b border-slate-200 text-[11px] uppercase tracking-[0.16em] text-slate-400 bg-slate-50">
              <span>Nome</span>
              <span>Data de modificação</span>
              <span>Tipo</span>
              <span>Tamanho</span>
              <span>Cliente</span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {loading ? (
                <div className="h-full flex items-center justify-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin mr-2" />Carregando...</div>
              ) : explorerRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4 px-6">
                  <div className="w-20 h-20 rounded-3xl bg-orange-50 flex items-center justify-center border border-orange-100">
                    <FolderOpen className="w-10 h-10 text-orange-300" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-slate-900">Esta pasta está vazia</p>
                    <p className="text-sm text-slate-500">Crie pastas ou arraste arquivos para dentro.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm">
                      <Upload className="w-4 h-4" />
                      Enviar arquivos
                    </button>
                    <button onClick={handleOpenCreateFolder} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm border border-orange-200">
                      <FolderPlus className="w-4 h-4" />
                      Criar pasta
                    </button>
                  </div>
                </div>
              ) : (
                explorerRows.map((row) => {
                  if (row.kind === 'folder') {
                    const folder = row.folder;
                    const client = clients.find((item) => item.id === folder.client_id);
                    const isSelected = selectedItemKey === `folder:${folder.id}`;
                    const folderLabel = getFolderLabel(folder.id);
                    return (
                      <div
                        key={folder.id}
                        className={`grid grid-cols-[minmax(320px,2.6fr)_170px_170px_130px_220px] gap-3 px-4 py-2.5 border-b border-slate-100 text-sm cursor-pointer ${
                          isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'
                        }`}
                        onClick={() => setSelectedItemKey(`folder:${folder.id}`)}
                        onDoubleClick={() => setCurrentFolderId(folder.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedItemKey(`folder:${folder.id}`);
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="truncate text-slate-900">{folder.name}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${folderLabel.bgClass} ${folderLabel.textClass} ${folderLabel.borderClass}`}>
                              {folderLabel.name}
                            </span>
                          </div>
                        </div>
                        <span className="text-slate-500">{formatDateTime(folder.updated_at)}</span>
                        <span className="text-slate-500">Pasta de arquivos</span>
                        <span className="text-slate-300">—</span>
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-slate-500 truncate">{client?.full_name || '—'}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedItemKey(`folder:${folder.id}`);
                              setContextMenu({ x: e.clientX, y: e.clientY, type: 'folder', folderId: folder.id });
                            }}
                            className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const file = row.file;
                  const client = clients.find((item) => item.id === file.client_id);
                  const isSelected = selectedItemKey === `file:${file.id}`;
                  return (
                    <div
                      key={file.id}
                      className={`grid grid-cols-[minmax(320px,2.4fr)_170px_170px_130px_220px] gap-3 px-4 py-2.5 border-b border-slate-100 text-sm cursor-pointer ${
                        isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'
                      }`}
                      onClick={() => setSelectedItemKey(`file:${file.id}`)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedItemKey(`file:${file.id}`);
                        setContextMenu({ x: e.clientX, y: e.clientY, type: 'file', fileId: file.id });
                      }}
                      onDoubleClick={() => {
                        if (isWordFile(file.mime_type, file.original_name)) {
                          handleOpenDocxEditor(file);
                          return;
                        }
                        setPreviewFile(file);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isPdfFile(file.mime_type, file.original_name) ? <FileText className="w-4 h-4 text-red-500 flex-shrink-0" /> : isImageFile(file.mime_type) ? <ImageIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" /> : <File className="w-4 h-4 text-sky-500 flex-shrink-0" />}
                        <span className="truncate text-slate-900">{file.original_name}</span>
                      </div>
                      <span className="text-slate-500">{formatDateTime(file.updated_at)}</span>
                      <span className="text-slate-500">{getFileTypeLabel(file)}</span>
                      <span className="text-slate-500">{formatFileSize(file.file_size)}</span>
                      <span className="text-slate-500 truncate">{client?.full_name || '—'}</span>
                    </div>
                  );
                })
              )}
            </div>

            {dragActive ? (
              <div className="absolute inset-x-0 bottom-0 mx-6 mb-6 rounded-xl border border-dashed border-orange-300 bg-orange-50 p-4 text-sm text-orange-900 shadow-lg">
                Solte os arquivos aqui para enviar para <span className="font-semibold">{currentFolder?.name || 'a pasta atual'}</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="w-[300px] border-l border-slate-200 bg-slate-50 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Detalhes</p>
          </div>
          {(selectedFolder || selectedFile) ? (
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {selectedFolder ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="w-8 h-8 text-amber-500" />
                    <div className="min-w-0">
                      <p className="text-slate-900 font-semibold truncate">{selectedFolder.name}</p>
                      <p className="text-xs text-slate-500">Pasta</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {folderLabels.map((label) => {
                      const active = getFolderLabel(selectedFolder.id).id === label.id;
                      return (
                        <button
                          key={label.id}
                          type="button"
                          onClick={() => handleAssignFolderLabel(selectedFolder.id, label.id)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                            active ? `${label.bgClass} ${label.textClass} ${label.borderClass}` : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <Tag className="w-3 h-3" />
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-slate-400 text-xs">Cliente</p>
                      <p className="text-slate-700">{clients.find((item) => item.id === selectedFolder.client_id)?.full_name || 'Sem cliente vinculado'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Modificado</p>
                      <p className="text-slate-700">{formatDateTime(selectedFolder.updated_at)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Local</p>
                      <p className="text-slate-700">{breadcrumbLabel}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-900">Vincular cliente</p>
                  <ClientSearchSelect
                    value={selectedFolder.client_id || ''}
                    onChange={(clientId) => handleLinkFolderClient(selectedFolder.id, clientId)}
                    placeholder="Buscar cliente para vincular"
                    allowCreate={false}
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-sm font-medium text-slate-900">Adicionar mais etiqueta</p>
                  <div className="grid grid-cols-1 gap-3">
                    <input
                      value={newLabelName}
                      onChange={(e) => setNewLabelName(e.target.value)}
                      placeholder="Ex: Protocolado"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400"
                    />
                    <div className="flex items-center gap-3">
                      <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-16 h-11 rounded-xl border border-slate-200 bg-white p-1" />
                      <button type="button" onClick={handleCreateCustomLabel} className="flex-1 px-4 py-2.5 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium hover:bg-orange-100">
                        Adicionar mais
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDownloadFolder(selectedFolder)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200"
                >
                  <Download className="w-4 h-4" />
                  Baixar pasta
                </button>
                <button
                  onClick={() => {
                    setSelectedFolderForShare(selectedFolder);
                    setSharePassword('');
                    setShareExpiresAt('');
                    setShareLink('');
                    setShareModalOpen(true);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm"
                >
                  <Share2 className="w-4 h-4" />
                  Compartilhar pasta
                </button>
              </>
              ) : selectedFile ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {isPdfFile(selectedFile.mime_type, selectedFile.original_name) ? <FileText className="w-8 h-8 text-red-500" /> : isImageFile(selectedFile.mime_type) ? <ImageIcon className="w-8 h-8 text-emerald-500" /> : <File className="w-8 h-8 text-sky-500" />}
                    <div className="min-w-0">
                      <p className="text-slate-900 font-semibold truncate">{selectedFile.original_name}</p>
                      <p className="text-xs text-slate-500">{getFileTypeLabel(selectedFile)}</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-slate-400 text-xs">Tamanho</p>
                      <p className="text-slate-700">{formatFileSize(selectedFile.file_size)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Cliente</p>
                      <p className="text-slate-700">{clients.find((item) => item.id === selectedFile.client_id)?.full_name || 'Sem vínculo'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Modificado</p>
                      <p className="text-slate-700">{formatDateTime(selectedFile.updated_at)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Caminho</p>
                      <p className="text-slate-700">{breadcrumbLabel}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => {
                    if (isWordFile(selectedFile.mime_type, selectedFile.original_name)) {
                      handleOpenDocxEditor(selectedFile);
                      return;
                    }
                    setPreviewFile(selectedFile);
                  }} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm">
                    <FileText className="w-4 h-4" />
                    {isWordFile(selectedFile.mime_type, selectedFile.original_name) ? 'Abrir editor' : 'Abrir preview'}
                  </button>
                  {isWordFile(selectedFile.mime_type, selectedFile.original_name) && (
                    <button onClick={handleOpenInPetitionModule} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm border border-orange-200">
                      <FileText className="w-4 h-4" />
                      Abrir no módulo petição
                    </button>
                  )}
                  <button
                    onClick={() => handleDownloadFile(selectedFile)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200"
                  >
                    <Download className="w-4 h-4" />
                    Baixar arquivo
                  </button>
                  <button
                    onClick={() => {
                      setSelectedFileToMove(selectedFile);
                      setTargetFolderId('');
                      setMoveModalOpen(true);
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm border border-slate-200"
                  >
                    <MoveRight className="w-4 h-4" />
                    Mover arquivo
                  </button>
                  <button onClick={() => handleDeleteFile(selectedFile)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-sm border border-red-200">
                    <Trash2 className="w-4 h-4" />
                    Excluir arquivo
                  </button>
                </div>
              </>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-sm">
                <p className="text-slate-900 font-medium">Resumo</p>
                <p className="text-slate-700 truncate">{breadcrumbLabel}</p>
                <p className="text-slate-500 text-xs">{currentClient ? `Cliente vinculado: ${currentClient.full_name}` : 'Sem cliente vinculado'}</p>
              </div>
            </div>
          ) : <div className="flex-1 bg-slate-50" />}
        </aside>
      </div>

      {folderModalOpen && (
        <div className="fixed inset-0 z-[120] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden">
            <div className="h-2 w-full bg-gradient-to-r from-orange-500 to-orange-600" />
            <div className="p-6 space-y-5 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Cloud</p>
                  <h3 className="text-xl font-semibold text-slate-900">Nova pasta</h3>
                </div>
                <button onClick={() => setFolderModalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                  <input value={folderName} onChange={(e) => setFolderName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" placeholder="Ex: Contratos do cliente" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Etiqueta inicial</label>
                  <select value={selectedFolderLabelId} onChange={(e) => setSelectedFolderLabelId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400">
                    {folderLabels.map((label) => (
                      <option key={label.id} value={label.id}>{label.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <ClientSearchSelect value={folderClientId} onChange={(clientId) => setFolderClientId(clientId)} label="Vincular a cliente" required={false} allowCreate={false} />
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-sm font-medium text-slate-900">Cadastrar nova etiqueta</p>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-3">
                  <input value={newLabelName} onChange={(e) => setNewLabelName(e.target.value)} placeholder="Ex: Em análise" className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-400" />
                  <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)} className="w-full h-[50px] rounded-xl border border-slate-200 bg-white p-2" />
                  <button type="button" onClick={handleCreateCustomLabel} className="px-4 py-3 rounded-xl bg-orange-50 text-orange-700 border border-orange-200 text-sm font-medium hover:bg-orange-100">
                    Cadastrar etiqueta
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setFolderModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
                <button onClick={handleCreateFolder} className="px-5 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Criar pasta</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {moveModalOpen && selectedFileToMove && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Mover arquivo</h3>
              <button onClick={() => setMoveModalOpen(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <p className="text-sm text-slate-500">Arquivo: <span className="font-medium text-slate-900">{selectedFileToMove.original_name}</span></p>
            <select value={targetFolderId} onChange={(e) => setTargetFolderId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Selecione a pasta destino</option>
              {allFolders.filter((item) => item.id !== selectedFileToMove.folder_id).map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMoveModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm">Cancelar</button>
              <button onClick={handleMoveFile} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium">Mover</button>
            </div>
          </div>
        </div>
      )}

      {shareModalOpen && selectedFolderForShare && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Compartilhar pasta</h3>
              <button onClick={() => setShareModalOpen(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <p className="text-sm text-slate-500">Pasta: <span className="font-medium text-slate-900">{selectedFolderForShare.name}</span></p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Senha (opcional)</label>
              <input value={sharePassword} onChange={(e) => setSharePassword(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Defina uma senha para o link" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expira em (opcional)</label>
              <input type="date" value={shareExpiresAt} onChange={(e) => setShareExpiresAt(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            {shareLink && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs font-medium text-sky-700 mb-2">Link público</p>
                <div className="flex gap-2">
                  <input value={shareLink} readOnly className="flex-1 rounded-lg border border-sky-200 px-3 py-2 text-sm bg-white" />
                  <button onClick={async () => {
                    await navigator.clipboard.writeText(shareLink);
                    toast.success('Cloud', 'Link copiado.');
                  }} className="px-3 py-2 rounded-lg bg-sky-600 text-white">
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShareModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm">Fechar</button>
              <button onClick={handleCreateShare} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Gerar link</button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div className="fixed inset-0 z-[130] bg-slate-900/25 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`w-full ${isDocxFile(previewFile.mime_type, previewFile.original_name) ? 'max-w-[98vw] h-[94vh]' : 'max-w-6xl h-[88vh]'} rounded-2xl bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] border border-slate-200 overflow-hidden flex flex-col`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
              <div>
                <h3 className="font-semibold text-slate-900">{previewFile.original_name}</h3>
                <p className="text-xs text-slate-500">{isDocxFile(previewFile.mime_type, previewFile.original_name) ? 'Editor de documento' : 'Preview do arquivo'}</p>
              </div>
              <div className="flex items-center gap-2">
                {isDocxFile(previewFile.mime_type, previewFile.original_name) && (
                  <>
                    <button onClick={() => setPreviewFile(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 inline-flex items-center gap-2">
                      <Minimize2 className="w-4 h-4" />
                      Minimizar
                    </button>
                    <button onClick={handleOpenInPetitionModule} className="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 border border-orange-200 text-sm hover:bg-orange-100 inline-flex items-center gap-2">
                      <FileText className="w-4 h-4" />
                      Abrir no módulo petição
                    </button>
                  </>
                )}
                <button onClick={() => setPreviewFile(null)} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100 overflow-auto">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
              ) : isDocxFile(previewFile.mime_type, previewFile.original_name) ? (
                <div className="h-full bg-white">
                  <SyncfusionEditor ref={editorRef} readOnly={false} height="100%" enableToolbar={true} showPropertiesPane={true} showNavigationPane={false} />
                </div>
              ) : isPdfFile(previewFile.mime_type, previewFile.original_name) && previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full bg-white" title={previewFile.original_name} />
              ) : isImageFile(previewFile.mime_type) && previewUrl ? (
                <div className="h-full flex items-center justify-center p-6"><img src={previewUrl} alt={previewFile.original_name} className="max-w-full max-h-full object-contain rounded-xl shadow" /></div>
              ) : previewUrl ? (
                <div className="h-full flex items-center justify-center">
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium">Abrir arquivo</a>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">Não foi possível gerar preview.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {contextMenu && selectedContextFolder && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => openFolderFromContextMenu(selectedContextFolder)}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              Abrir pasta
            </button>
            <div className="border-t border-slate-100" />
            {folderLabels.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  handleAssignFolderLabel(selectedContextFolder.id, label.id);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                Alterar status para: {label.name}
              </button>
            ))}
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDownloadFolder(selectedContextFolder);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Baixar pasta
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                handleOpenFolderShare(selectedContextFolder);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Compartilhar pasta
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Vincular cliente
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedItemKey(`folder:${selectedContextFolder.id}`);
                handleOpenCreateFolder();
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Criar subpasta
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDeleteFolder(selectedContextFolder);
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              Excluir pasta
            </button>
          </div>
        </div>
      )}

      {contextMenu && selectedContextFile && (
        <div
          className="fixed z-[140]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <button
              type="button"
              onClick={() => openFileFromContextMenu(selectedContextFile)}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              {isWordFile(selectedContextFile.mime_type, selectedContextFile.original_name) ? 'Abrir editor' : 'Abrir preview'}
            </button>
            {isWordFile(selectedContextFile.mime_type, selectedContextFile.original_name) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedItemKey(`file:${selectedContextFile.id}`);
                  setContextMenu(null);
                  window.setTimeout(() => handleOpenInPetitionModule(), 0);
                }}
                className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
              >
                Abrir no módulo petição
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDownloadFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Baixar arquivo
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFileToMove(selectedContextFile);
                setTargetFolderId('');
                setMoveModalOpen(true);
                setContextMenu(null);
              }}
              className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 transition"
            >
              Mover arquivo
            </button>
            <div className="border-t border-slate-100" />
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleDeleteFile(selectedContextFile);
              }}
              className="w-full px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              Excluir arquivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CloudModule;
