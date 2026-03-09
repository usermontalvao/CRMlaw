import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Cloud, File, FileText, Folder, Image as ImageIcon, Loader2, Lock, X } from 'lucide-react';
import { cloudService } from '../services/cloud.service';
import SyncfusionEditor, { type SyncfusionEditorRef } from './SyncfusionEditor';
import type { CloudFile, CloudFolder, CloudFolderShare } from '../types/cloud.types';

const isImageFile = (mime?: string | null) => Boolean(mime?.startsWith('image/'));
const isPdfFile = (mime?: string | null, name?: string) => mime === 'application/pdf' || String(name || '').toLowerCase().endsWith('.pdf');
const isDocxFile = (mime?: string | null, name?: string) => {
  const lower = String(name || '').toLowerCase();
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lower.endsWith('.docx');
};

interface PublicCloudSharePageProps {
  token: string;
}

const PublicCloudSharePage: React.FC<PublicCloudSharePageProps> = ({ token }) => {
  const editorRef = useRef<SyncfusionEditorRef | null>(null);
  const [password, setPassword] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [share, setShare] = useState<CloudFolderShare | null>(null);
  const [rootFolder, setRootFolder] = useState<CloudFolder | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [allFolders, setAllFolders] = useState<CloudFolder[]>([]);
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<CloudFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const currentFolder = useMemo(() => (currentFolderId ? allFolders.find((item) => item.id === currentFolderId) ?? null : null), [allFolders, currentFolderId]);

  const breadcrumb = useMemo(() => {
    const items: CloudFolder[] = [];
    let cursor = currentFolder;
    while (cursor) {
      items.unshift(cursor);
      cursor = cursor.parent_id ? allFolders.find((item) => item.id === cursor?.parent_id) ?? null : null;
    }
    return items;
  }, [allFolders, currentFolder]);

  const loadFolderContent = async (folderId: string) => {
    const [foldersData, filesData, allFoldersData] = await Promise.all([
      cloudService.listPublicFolders(folderId),
      cloudService.listPublicFiles(folderId),
      cloudService.listAllFolders(),
    ]);
    setFolders(foldersData);
    setFiles(filesData);
    setAllFolders(allFoldersData);
  };

  const handleAccess = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await cloudService.resolvePublicShare(token, password);
      setShare(result.share);
      setRootFolder(result.folder);
      setCurrentFolderId(result.folder.id);
      await loadFolderContent(result.folder.id);
      setAuthorized(true);
    } catch (err: any) {
      setError(err.message || 'Não foi possível acessar a pasta.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authorized && currentFolderId) {
      loadFolderContent(currentFolderId).catch((err) => setError(err.message || 'Erro ao carregar conteúdo.'));
    }
  }, [authorized, currentFolderId]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewUrl(null);
      return;
    }

    const loadPreview = async () => {
      try {
        setPreviewLoading(true);
        const signedUrl = await cloudService.getFileSignedUrl(previewFile.storage_path);
        if (isDocxFile(previewFile.mime_type, previewFile.original_name)) {
          const response = await fetch(signedUrl);
          const buffer = await response.arrayBuffer();
          await editorRef.current?.loadDocxViaImport(buffer, previewFile.original_name);
          setPreviewUrl(null);
        } else {
          setPreviewUrl(signedUrl);
        }
      } catch (err: any) {
        setError(err.message || 'Erro ao abrir preview.');
      } finally {
        setPreviewLoading(false);
      }
    };

    loadPreview();
  }, [previewFile]);

  if (!authorized) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/15 flex items-center justify-center"><Cloud className="w-6 h-6 text-sky-400" /></div>
            <div>
              <h1 className="text-xl font-bold">Pasta compartilhada</h1>
              <p className="text-sm text-slate-400">Acesse os arquivos públicos desta pasta.</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Senha</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm" placeholder="Digite a senha se existir" />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={handleAccess} disabled={loading} className="w-full px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}Acessar pasta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">{rootFolder?.name || 'Pasta compartilhada'}</h1>
          <div className="flex items-center flex-wrap gap-2 text-sm text-slate-500 mt-2">
            {breadcrumb.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 && <ChevronRight className="w-4 h-4" />}
                <button onClick={() => setCurrentFolderId(item.id)} className="hover:text-sky-600">{item.name}</button>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          {folders.map((folder) => (
            <button key={folder.id} onClick={() => setCurrentFolderId(folder.id)} className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50">
              <Folder className="w-5 h-5 text-amber-500" />
              <span className="font-medium text-slate-900">{folder.name}</span>
            </button>
          ))}
          {files.map((file) => (
            <button key={file.id} onClick={() => setPreviewFile(file)} className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50">
              {isPdfFile(file.mime_type, file.original_name) ? <FileText className="w-5 h-5 text-red-500" /> : isImageFile(file.mime_type) ? <ImageIcon className="w-5 h-5 text-emerald-500" /> : <File className="w-5 h-5 text-slate-500" />}
              <span className="font-medium text-slate-900">{file.original_name}</span>
            </button>
          ))}
        </div>
      </div>

      {previewFile && (
        <div className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-6xl h-[88vh] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">{previewFile.original_name}</h3>
              <button onClick={() => setPreviewFile(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="flex-1 bg-slate-100 overflow-auto">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-sky-600" /></div>
              ) : isDocxFile(previewFile.mime_type, previewFile.original_name) ? (
                <div className="h-full bg-white"><SyncfusionEditor ref={editorRef} readOnly height="100%" enableToolbar={false} showPropertiesPane={false} showNavigationPane={false} /></div>
              ) : isPdfFile(previewFile.mime_type, previewFile.original_name) && previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full" title={previewFile.original_name} />
              ) : isImageFile(previewFile.mime_type) && previewUrl ? (
                <div className="h-full flex items-center justify-center p-6"><img src={previewUrl} alt={previewFile.original_name} className="max-w-full max-h-full object-contain rounded-xl shadow" /></div>
              ) : previewUrl ? (
                <div className="h-full flex items-center justify-center"><a href={previewUrl} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-slate-900 text-white">Abrir arquivo</a></div>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">Não foi possível gerar preview.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PublicCloudSharePage;
