// Navegador da pasta do cliente no Cloud, em modal — aberto a partir da conversa
// do WhatsApp. Os documentos baixados pela IA (process-document-upload) são
// registrados em "Documentos do Portal"; aqui o operador navega, seleciona e
// baixa sem sair do atendimento. Reusa cloudService (listagem + signed URL).
import React, { useCallback, useEffect, useState } from 'react';
import {
  FolderOpen, FileText, Download, ExternalLink, ChevronRight, Loader2,
  RefreshCw, CheckSquare, Square, FolderSearch,
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Modal, ModalBody } from './ui/Modal';
import { cloudService } from '../services/cloud.service';
import type { CloudFolder, CloudFile } from '../types/cloud.types';
import { useToastContext } from '../contexts/ToastContext';

const PORTAL_RE = /portal/i;

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function triggerDownload(file: CloudFile): Promise<void> {
  const url = await cloudService.getFileSignedUrl(file.storage_path, 60 * 60, file.storage_bucket);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Falha ao baixar o arquivo.');
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl; a.download = file.original_name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(objUrl);
}

// ── Modal navegável ────────────────────────────────────────────────────────
export const CloudFolderModal: React.FC<{
  clientId: string;
  clientName?: string | null;
  open: boolean;
  onClose: () => void;
}> = ({ clientId, clientName, open, onClose }) => {
  const toast = useToastContext();
  const [path, setPath] = useState<CloudFolder[]>([]);   // [] = raiz do cliente
  const [subfolders, setSubfolders] = useState<CloudFolder[]>([]);
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const current = path[path.length - 1] || null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!current) {
        const roots = await cloudService.listClientRootFolders(clientId, false);
        setSubfolders(roots); setFiles([]);
      } else {
        const [fs, fl] = await Promise.all([
          cloudService.listFolders(current.id),
          cloudService.listFiles(current.id),
        ]);
        setSubfolders(fs); setFiles(fl);
      }
      setSelected(new Set());
    } catch (e: any) {
      toast.error('Cloud', e?.message || 'Falha ao carregar a pasta.');
      setSubfolders([]); setFiles([]);
    } finally { setLoading(false); }
  }, [clientId, current, toast]);

  // Ao abrir: começa na pasta "Documentos do Portal" se existir; senão na raiz.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setSelected(new Set());
    cloudService.listClientRootFolders(clientId, false)
      .then(roots => { if (alive) setPath(roots.find(f => PORTAL_RE.test(f.name)) ? [roots.find(f => PORTAL_RE.test(f.name))!] : []); })
      .catch(() => { if (alive) setPath([]); });
    return () => { alive = false; };
  }, [open, clientId]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const enter = (f: CloudFolder) => setPath(p => [...p, f]);
  const goTo = (idx: number) => setPath(p => p.slice(0, idx)); // idx=0 → raiz

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSelected = files.length > 0 && selected.size === files.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(files.map(f => f.id)));

  const openFile = async (f: CloudFile) => {
    try {
      const url = await cloudService.getFileSignedUrl(f.storage_path, 60 * 60, f.storage_bucket);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) { toast.error('Cloud', e?.message || 'Falha ao abrir.'); }
  };

  const downloadOne = async (f: CloudFile) => {
    setBusy(true);
    try { await triggerDownload(f); }
    catch (e: any) { toast.error('Cloud', e?.message || 'Falha ao baixar.'); }
    finally { setBusy(false); }
  };

  const downloadSelected = async () => {
    const list = files.filter(f => selected.has(f.id));
    if (list.length === 0) return;
    setBusy(true);
    try {
      // Mais de 2 arquivos → empacota num único .zip (evita enxurrada de downloads).
      if (list.length > 2) {
        const zip = new JSZip();
        const used = new Map<string, number>(); // evita sobrescrever nomes iguais
        let ok = 0;
        for (const f of list) {
          const url = await cloudService.getFileSignedUrl(f.storage_path, 60 * 60, f.storage_bucket);
          const res = await fetch(url);
          if (!res.ok) continue;
          let name = f.original_name;
          const seen = used.get(name) ?? 0;
          if (seen) { const dot = name.lastIndexOf('.'); name = dot > 0 ? `${name.slice(0, dot)} (${seen})${name.slice(dot)}` : `${name} (${seen})`; }
          used.set(f.original_name, seen + 1);
          zip.file(name, await res.blob());
          ok++;
        }
        if (ok === 0) throw new Error('Nenhum arquivo pôde ser baixado.');
        const blob = await zip.generateAsync({ type: 'blob' });
        const base = (clientName || current?.name || 'documentos').replace(/[^\w.-]+/g, '_');
        saveAs(blob, `${base}.zip`);
        toast.success('Cloud', `${ok} arquivos baixados em ZIP.`);
      } else {
        let ok = 0;
        for (const f of list) { try { await triggerDownload(f); ok++; } catch { /* segue */ } }
        if (ok < list.length) toast.error('Cloud', `${list.length - ok} arquivo(s) não baixaram.`);
        else toast.success('Cloud', `${ok} arquivo(s) baixado(s).`);
      }
    } catch (e: any) {
      toast.error('Cloud', e?.message || 'Falha ao baixar.');
    } finally { setBusy(false); }
  };

  const isEmpty = !loading && subfolders.length === 0 && files.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Documentos no Cloud"
      subtitle={clientName || undefined}
      icon={<FolderOpen size={18} />}
      headerActions={
        <button onClick={refresh} title="Atualizar" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      }
    >
      <ModalBody>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] mb-3">
          <button onClick={() => goTo(0)} className={`font-semibold ${path.length === 0 ? 'text-slate-700' : 'text-amber-600 hover:text-amber-700'}`}>
            {clientName || 'Cliente'}
          </button>
          {path.map((f, i) => (
            <span key={f.id} className="inline-flex items-center gap-1">
              <ChevronRight size={13} className="text-slate-300" />
              <button onClick={() => goTo(i + 1)} className={`${i === path.length - 1 ? 'text-slate-700 font-semibold' : 'text-amber-600 hover:text-amber-700'}`}>
                {f.name}
              </button>
            </span>
          ))}
        </div>

        {/* Toolbar de seleção */}
        {files.length > 0 && (
          <div className="flex items-center justify-between gap-2 mb-2">
            <button onClick={toggleAll} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700">
              {allSelected ? <CheckSquare size={15} className="text-amber-600" /> : <Square size={15} />}
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            <button onClick={downloadSelected} disabled={selected.size === 0 || busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700 disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Baixar selecionados{selected.size > 0 ? ` (${selected.size})` : ''}{selected.size > 2 ? ' · ZIP' : ''}
            </button>
          </div>
        )}

        {/* Conteúdo */}
        <div className="min-h-[180px] max-h-[55vh] overflow-auto rounded-xl border border-[#e7e5df] divide-y divide-[#f0eee9]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-[13px]">
              <Loader2 size={16} className="animate-spin" /> Carregando…
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400 text-[13px]">
              <FolderSearch size={26} className="text-slate-300" /> Pasta vazia.
            </div>
          ) : (
            <>
              {subfolders.map(f => (
                <button key={f.id} onClick={() => enter(f)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-amber-50/50 transition text-left">
                  <FolderOpen size={17} className="text-amber-500 flex-shrink-0" />
                  <span className="flex-1 text-[13px] font-medium text-slate-700 truncate">{f.name}</span>
                  <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                </button>
              ))}
              {files.map(f => {
                const sel = selected.has(f.id);
                return (
                  <div key={f.id} className={`flex items-center gap-2.5 px-3 py-2.5 transition ${sel ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}>
                    <button onClick={() => toggle(f.id)} className="flex-shrink-0 text-slate-400 hover:text-amber-600">
                      {sel ? <CheckSquare size={16} className="text-amber-600" /> : <Square size={16} />}
                    </button>
                    <FileText size={16} className="text-slate-400 flex-shrink-0" />
                    <button onClick={() => openFile(f)} className="flex-1 min-w-0 text-left group">
                      <span className="block text-[13px] font-medium text-slate-700 truncate group-hover:text-amber-700">{f.original_name}</span>
                      <span className="block text-[11px] text-slate-400">{formatBytes(f.file_size)}</span>
                    </button>
                    <button onClick={() => openFile(f)} title="Abrir" className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition">
                      <ExternalLink size={15} />
                    </button>
                    <button onClick={() => downloadOne(f)} disabled={busy} title="Baixar" className="flex-shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition disabled:opacity-50">
                      <Download size={15} />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ModalBody>
    </Modal>
  );
};

// ── Link na sidebar da conversa: só aparece se o cliente tem pasta no Cloud ──
export const ClientCloudDocsLink: React.FC<{ clientId: string; clientName?: string | null }> = ({ clientId, clientName }) => {
  const [hasFolder, setHasFolder] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setHasFolder(false);
    cloudService.listClientRootFolders(clientId, false)
      .then(roots => { if (alive) setHasFolder(roots.length > 0); })
      .catch(() => {});
  }, [clientId]);

  if (!hasFolder) return null;
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-[#e7e5df] hover:border-amber-300 hover:bg-amber-50/50 transition text-left">
        <FolderOpen size={15} className="text-amber-500 flex-shrink-0" />
        <span className="flex-1 text-[12.5px] font-semibold text-slate-700">Documentos no Cloud</span>
        <ChevronRight size={14} className="text-slate-300" />
      </button>
      {open && <CloudFolderModal clientId={clientId} clientName={clientName} open={open} onClose={() => setOpen(false)} />}
    </>
  );
};
