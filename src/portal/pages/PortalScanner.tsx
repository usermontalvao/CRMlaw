import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Crop,
  Download,
  EyeOff,
  FileText,
  Loader2,
  ScanLine,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { supabasePortal } from '../lib/supabasePortal';
import { clientPortalService } from '../services/clientPortal.service';
import {
  dataUrlToBlob,
  detectScannerFileKind,
  enrichScanItemWithAi,
  extractScannerOcr,
  processPdfFile,
  processScanFile,
  updateScannerImage,
  type ScannerCrop,
  type ScannerEnhancement,
  type ScannerItem,
  type ScannerQuad,
} from '../services/portalScanner.service';

type ProcessingItem = {
  id: string;
  originalName: string;
  processing: true;
};

type ScanStateItem = ScannerItem | ProcessingItem;
type CropHandle = 'move' | 'tl' | 'tr' | 'br' | 'bl';

const MIN_CROP_SIZE = 0.15;
const DOCS_BUCKET = 'client-documents';
const ATTACH_PREFIX = '__anexo__:';

const isProcessed = (item: ScanStateItem): item is ScannerItem => !('processing' in item);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeCrop(crop: ScannerCrop): ScannerCrop {
  let width = Math.max(MIN_CROP_SIZE, Math.min(1, crop.width));
  let height = Math.max(MIN_CROP_SIZE, Math.min(1, crop.height));
  let x = Math.max(0, Math.min(1 - width, crop.x));
  let y = Math.max(0, Math.min(1 - height, crop.y));

  width = Math.min(width, 1 - x);
  height = Math.min(height, 1 - y);

  return { x, y, width, height };
}

function normalizePoint(point: { x: number; y: number }) {
  return {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1),
  };
}

function cropToQuad(crop: ScannerCrop): ScannerQuad {
  const safeCrop = normalizeCrop(crop);
  return {
    tl: { x: safeCrop.x, y: safeCrop.y },
    tr: { x: safeCrop.x + safeCrop.width, y: safeCrop.y },
    br: { x: safeCrop.x + safeCrop.width, y: safeCrop.y + safeCrop.height },
    bl: { x: safeCrop.x, y: safeCrop.y + safeCrop.height },
  };
}

function normalizeQuad(quad: ScannerQuad): ScannerQuad {
  return {
    tl: normalizePoint(quad.tl),
    tr: normalizePoint(quad.tr),
    br: normalizePoint(quad.br),
    bl: normalizePoint(quad.bl),
  };
}

function quadToCrop(quad: ScannerQuad): ScannerCrop {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  return normalizeCrop({
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  });
}

function moveQuad(quad: ScannerQuad, dx: number, dy: number): ScannerQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const nextDx = clamp(dx, -Math.min(...xs), 1 - Math.max(...xs));
  const nextDy = clamp(dy, -Math.min(...ys), 1 - Math.max(...ys));

  return {
    tl: { x: quad.tl.x + nextDx, y: quad.tl.y + nextDy },
    tr: { x: quad.tr.x + nextDx, y: quad.tr.y + nextDy },
    br: { x: quad.br.x + nextDx, y: quad.br.y + nextDy },
    bl: { x: quad.bl.x + nextDx, y: quad.bl.y + nextDy },
  };
}

function quadCenter(quad: ScannerQuad) {
  return {
    x: (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4,
    y: (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4,
  };
}

export const PortalScanner: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [items, setItems] = useState<ScanStateItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [ocrIds, setOcrIds] = useState<string[]>([]);
  const [aiIds, setAiIds] = useState<string[]>([]);
  const [cropEditorId, setCropEditorId] = useState<string | null>(null);
  const [draftQuad, setDraftQuad] = useState<ScannerQuad | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    rect: DOMRect;
    quad: ScannerQuad;
  } | null>(null);

  const processedItems = useMemo(() => items.filter(isProcessed), [items]);
  const okItems = processedItems.filter((item) => item.quality === 'ok');
  const badItems = processedItems.filter((item) => item.quality === 'ruim');
  const cropEditorItem = useMemo(
    () => processedItems.find((item) => item.id === cropEditorId && item.fileKind === 'image') || null,
    [cropEditorId, processedItems],
  );
  const draftQuadCenter = useMemo(() => (draftQuad ? quadCenter(draftQuad) : null), [draftQuad]);
  const draftQuadPolygon = useMemo(
    () =>
      draftQuad
        ? `${draftQuad.tl.x * 100}% ${draftQuad.tl.y * 100}%, ${draftQuad.tr.x * 100}% ${draftQuad.tr.y * 100}%, ${draftQuad.br.x * 100}% ${draftQuad.br.y * 100}%, ${draftQuad.bl.x * 100}% ${draftQuad.bl.y * 100}%`
        : '',
    [draftQuad],
  );

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!cropDragRef.current) return;
      const { handle, startX, startY, rect, quad } = cropDragRef.current;
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;
      let next: ScannerQuad = { ...quad };

      if (handle === 'move') {
        next = moveQuad(quad, dx, dy);
      } else {
        next = normalizeQuad({
          ...quad,
          [handle]: {
            x: quad[handle].x + dx,
            y: quad[handle].y + dy,
          },
        });
      }

      setDraftQuad(next);
    };

    const onPointerUp = () => {
      cropDragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const replacePlaceholder = (placeholderId: string, next: ScannerItem | null) => {
    setItems((current) =>
      current.flatMap((item) => {
        if (item.id !== placeholderId) return [item];
        return next ? [next] : [];
      }),
    );
  };

  const queueAiEnrich = (item: ScannerItem) => {
    if (item.fileKind !== 'image' || !item.dataUrl) return;
    setAiIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
    void enrichScanItemWithAi(item)
      .then((updates) => {
        if (Object.keys(updates).length === 0) return;
        setItems((current) =>
          current.map((entry) =>
            isProcessed(entry) && entry.id === item.id ? { ...entry, ...updates } : entry,
          ),
        );
      })
      .finally(() => {
        setAiIds((current) => current.filter((value) => value !== item.id));
      });
  };

  const queueAutoOcr = (item: ScannerItem) => {
    if (item.fileKind !== 'image' || !item.dataUrl) return;
    if (item.quality !== 'ok') return;
    if (item.ocrText) return;

    setOcrIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
    void extractScannerOcr(item.dataUrl)
      .then((text) => {
        if (!text) return;
        setItems((current) =>
          current.map((entry) =>
            isProcessed(entry) && entry.id === item.id ? { ...entry, ocrText: text } : entry,
          ),
        );
      })
      .finally(() => {
        setOcrIds((current) => current.filter((value) => value !== item.id));
      });
  };

  const addUnsupportedFile = (file: File, index: number) => {
    const fallbackName = `arquivo_${String(index).padStart(3, '0')}`;
    setItems((current) => [
      {
        id: `unsupported-${Date.now()}-${index}`,
        originalName: file.name,
        suggestedName: fallbackName,
        fileKind: 'image',
        mimeType: file.type || 'application/octet-stream',
        quality: 'ruim',
        reason: 'Formato não suportado. Use imagem ou PDF.',
        createdAt: new Date().toISOString(),
        width: 0,
        height: 0,
        dataUrl: '',
        rotation: 0,
        enhancement: 'color',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        metrics: { brightness: 0, contrast: 0, sharpness: 0, cropRatio: 0 },
      },
      ...current,
    ]);
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setProcessing(true);
    const startIndex = processedItems.length;

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      const itemIndex = startIndex + fileIndex + 1;
      const kind = detectScannerFileKind(file);

      if (!kind) {
        addUnsupportedFile(file, itemIndex);
        continue;
      }

      const placeholderId = `processing-${Date.now()}-${fileIndex}`;
      setItems((current) => [{ id: placeholderId, originalName: file.name, processing: true }, ...current]);

      try {
        const scanned = kind === 'pdf' ? await processPdfFile({ file, index: itemIndex }) : await processScanFile({ file, index: itemIndex });
        replacePlaceholder(placeholderId, scanned);
        queueAiEnrich(scanned);
        queueAutoOcr(scanned);
      } catch (error) {
        replacePlaceholder(placeholderId, {
          id: placeholderId,
          originalName: file.name,
          suggestedName: `scanner_${String(itemIndex).padStart(3, '0')}`,
          fileKind: kind,
          mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'image/jpeg'),
          quality: 'ruim',
          reason: error instanceof Error ? error.message : 'Falha ao processar arquivo.',
          createdAt: new Date().toISOString(),
          width: 0,
          height: 0,
          dataUrl: '',
          fileBlob: kind === 'pdf' ? file : undefined,
          rotation: 0,
          enhancement: 'color',
          crop: { x: 0, y: 0, width: 1, height: 1 },
          metrics: { brightness: 0, contrast: 0, sharpness: 0, cropRatio: 0 },
        });
      }
    }

    setProcessing(false);
  };

  const triggerUpload = () => fileInputRef.current?.click();

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  const openCamera = async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      // iOS Safari requires waiting for the DOM to mount the <video> element
      // before assigning srcObject. Use setTimeout to ensure the portal renders first.
      setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        const tryPlay = () => video.play().catch(() => {});
        video.addEventListener('loadedmetadata', tryPlay, { once: true });
        // Fallback: also try immediately in case loadedmetadata already fired
        if (video.readyState >= 1) tryPlay();
      }, 50);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Não foi possível abrir a câmera.');
      stopCamera();
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || capturing) return;
    setCapturing(true);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCapturing(false);
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) {
      // Camera shutter sound via Web Audio API
      try {
        const ac = new AudioContext();
        const sr = ac.sampleRate;
        const dur = Math.floor(sr * 0.12);
        const buf = ac.createBuffer(1, dur, sr);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < dur; i++) {
          // Mechanical click: sharp noise burst that decays quickly
          const t = i / sr;
          const env = t < 0.003
            ? t / 0.003                              // fast attack
            : Math.exp(-(t - 0.003) / 0.018);        // exponential decay
          const noise = (Math.random() * 2 - 1);
          // Low-frequency component (shutter body resonance ~800 Hz)
          const tone = Math.sin(2 * Math.PI * 800 * t) * 0.4;
          ch[i] = (noise * 0.6 + tone) * env;
        }
        const gain = ac.createGain();
        gain.gain.value = 2.0;
        gain.connect(ac.destination);
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        src.start();
      } catch { /* ignore if audio not available */ }

      const file = new File([blob], `captura_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' });
      setCapturing(false);
      requestAnimationFrame(() => {
        void addFiles([file]);
      });
      return;
    }

    setCapturing(false);
  };

  const updateName = (id: string, nextName: string) => {
    setItems((current) => current.map((item) => (isProcessed(item) && item.id === id ? { ...item, suggestedName: nextName } : item)));
  };

  const removeItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id));

  const moveItem = (id: string, direction: -1 | 1) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const setItemEditing = (id: string, active: boolean) => {
    setEditingIds((current) => (active ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id)));
  };

  const applyItemEdit = async (
    item: ScannerItem,
    updates: { rotation?: number; enhancement?: ScannerEnhancement; crop?: ScannerCrop; quad?: ScannerQuad },
  ) => {
    if (item.fileKind !== 'image') return;
    setItemEditing(item.id, true);
    try {
      const next = await updateScannerImage(item, updates);
      const nextWithOcrReset = { ...next, ocrText: undefined };
      setItems((current) =>
        current.map((entry) => (isProcessed(entry) && entry.id === item.id ? nextWithOcrReset : entry)),
      );
      queueAutoOcr(nextWithOcrReset);
      return next;
    } finally {
      setItemEditing(item.id, false);
    }
  };

  const openCropEditor = (item: ScannerItem) => {
    if (item.fileKind !== 'image') return;
    setCropEditorId(item.id);
    setDraftQuad(item.quad || cropToQuad(item.crop || { x: 0, y: 0, width: 1, height: 1 }));
  };

  const closeCropEditor = () => {
    cropDragRef.current = null;
    setCropEditorId(null);
    setDraftQuad(null);
  };

  const saveCropEditor = async () => {
    if (!cropEditorItem || !draftQuad) return;
    await applyItemEdit(cropEditorItem, { crop: quadToCrop(draftQuad), quad: draftQuad });
    closeCropEditor();
  };

  const startCropDrag = (handle: CropHandle, event: React.PointerEvent) => {
    if (!cropImageRef.current || !draftQuad) return;
    event.preventDefault();
    cropDragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rect: cropImageRef.current.getBoundingClientRect(),
      quad: draftQuad,
    };
  };

  const downloadFile = (item: ScannerItem) => {
    const blob = item.fileKind === 'pdf' ? item.fileBlob : dataUrlToBlob(item.dataUrl);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${item.suggestedName || 'scanner'}.${item.fileKind === 'pdf' ? 'pdf' : 'jpg'}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const buildMergedPdfBlob = async (forceAll = false) => {
    const exportItems = forceAll
      ? processedItems.filter((item) => item.dataUrl || item.fileBlob)
      : processedItems.filter((item) => item.quality === 'ok');
    if (exportItems.length === 0) return null;
    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();

    for (const item of exportItems) {
      if (item.fileKind === 'pdf' && item.fileBlob) {
        const sourcePdf = await PDFDocument.load(await item.fileBlob.arrayBuffer());
        const pages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
        continue;
      }

      if (item.fileKind === 'image' && item.dataUrl) {
        const imageBlob = dataUrlToBlob(item.dataUrl);
        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const embedded = await mergedPdf.embedJpg(imageBytes);
        const page = mergedPdf.addPage();
        const { width: pageWidth, height: pageHeight } = page.getSize();
        const margin = 24;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;
        const scale = Math.min(maxWidth / embedded.width, maxHeight / embedded.height);
        const drawWidth = embedded.width * scale;
        const drawHeight = embedded.height * scale;
        const x = (pageWidth - drawWidth) / 2;
        const y = (pageHeight - drawHeight) / 2;
        page.drawImage(embedded, { x, y, width: drawWidth, height: drawHeight });
      }
    }

    const bytes = await mergedPdf.save();
    return new Blob([new Uint8Array(Array.from(bytes))], { type: 'application/pdf' });
  };

  const downloadPdf = async () => {
    const blob = await buildMergedPdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scanner_${new Date().toISOString().slice(0, 10)}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sendBatch = async (forceAll = false) => {
    if (!session?.user?.id || sending) return;
    setSendMessage(null);
    setSending(true);
    try {
      const blob = await buildMergedPdfBlob(forceAll);
      if (!blob) {
        setSendMessage('Nada válido para enviar.');
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `scanner_${dateStr}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      // Upload via edge function — bypasses Supabase Storage RLS schema sync issue
      const { data: sessionData } = await supabasePortal.auth.getSession();
      const jwt = sessionData?.session?.access_token;
      if (!jwt) { setSendMessage('Sessão expirada. Faça login novamente.'); return; }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const form = new FormData();
      form.append('file', file);

      const uploadRes = await fetch(`${supabaseUrl}/functions/v1/portal-scanner-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
      });

      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => ({}));
        setSendMessage(`Falha ao enviar: ${(errBody as any).error ?? uploadRes.status}`);
        return;
      }

      const { path, bucket } = await uploadRes.json() as { path: string; bucket: string };
      const displayName = path.split('/').slice(1).join('/');

      // Notifica o escritório via chat (com referência ao arquivo)
      const content = `${ATTACH_PREFIX}${JSON.stringify({
        filePath: path,
        fileName,
        mimeType: 'application/pdf',
        size: file.size,
        bucket: bucket,
        displayPath: displayName,
      })}`;

      const result = await clientPortalService.sendChatMessage(session.user.id, content);
      if (!result) {
        // Upload foi bem — só falhou a notificação
        setSendMessage(`Salvo em ${displayName}. Falha ao notificar o escritório.`);
        return;
      }

      // Success — clear items and show success screen
      setItems([]);
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-60 sm:gap-4 sm:pb-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#fff7ed,#fed7aa)] text-orange-600 shadow-[0_4px_12px_rgba(249,115,22,0.15)] ring-1 ring-orange-200">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Envio de arquivos</h1>
            <p className="text-xs text-slate-500">Documentos, prints, fotos e provas</p>
          </div>
        </div>

        {processedItems.length > 0 && (
          <div className="hidden items-center gap-2 sm:flex">
            <button
              onClick={() => void sendBatch()}
              disabled={okItems.length === 0 || sending}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
            </button>
            <button
              onClick={downloadPdf}
              disabled={okItems.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
            <button
              onClick={() => setItems([])}
              disabled={processing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Limpar
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const selected = Array.from(event.target.files || []);
          void addFiles(selected);
          event.currentTarget.value = '';
        }}
      />

      {!cameraOpen && items.length === 0 && (
        <section className="rounded-[28px] bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-orange-50 text-orange-500">
              <ScanLine className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-base font-semibold text-slate-900">Envie seus arquivos</h2>
            <p className="mt-1 text-sm text-slate-400">
              Documentos, fotos ou prints — a IA nomeia e organiza tudo.
            </p>
          </div>
          <div className="mt-5 flex gap-2">
            <button
              onClick={triggerUpload}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform"
            >
              <Upload className="h-4 w-4" />
              Arquivo
            </button>
            <button
              onClick={openCamera}
              className="inline-flex h-12 flex-[2] items-center justify-center gap-2 rounded-xl bg-orange-500 text-sm font-bold text-white shadow-[0_4px_14px_rgba(249,115,22,0.30)] hover:opacity-90 active:scale-95 transition-transform"
            >
              <Camera className="h-4 w-4" />
              Usar câmera
            </button>
          </div>
        </section>
      )}

      {!cameraOpen && cameraError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{cameraError}</div>
      )}

      {/* Success screen */}
      {!cameraOpen && sent && (
        <div className="rounded-[24px] bg-white p-8 shadow-[0_8px_28px_rgba(15,23,42,0.07)] ring-1 ring-slate-100 flex flex-col items-center text-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-emerald-50 text-emerald-500">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">Enviado com sucesso!</p>
            <p className="mt-1 text-sm text-slate-400">O escritório foi notificado e o arquivo está na pasta <strong className="text-slate-600">Documentos do Portal</strong>.</p>
          </div>
          <div className="flex w-full flex-col gap-2 pt-1">
            <button
              onClick={() => { setSent(false); setSendMessage(null); }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(249,115,22,0.28)] hover:opacity-90 active:scale-95 transition-transform"
            >
              <Camera className="h-4 w-4" /> Enviar mais arquivos
            </button>
            <button
              onClick={() => navigate('mensagens')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform"
            >
              Ver mensagens
            </button>
          </div>
        </div>
      )}

      {!cameraOpen && sendMessage && !sent && (
        <div className={`rounded-2xl px-4 py-3 text-sm ${sendMessage.includes('Falha') || sendMessage.includes('Nada') || sendMessage.includes('expirada') ? 'border border-rose-200 bg-rose-50 text-rose-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          <span>{sendMessage}</span>
        </div>
      )}

      {processedItems.length > 0 && !cameraOpen && (
        <section className="flex items-center justify-between gap-3 rounded-[20px] bg-white px-4 py-3 shadow-[0_4px_16px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {processedItems.length} página{processedItems.length > 1 ? 's' : ''} no lote
              </p>
              <p className="text-xs text-slate-400">{okItems.length} válida{okItems.length !== 1 ? 's' : ''} · pronta{okItems.length !== 1 ? 's' : ''} para enviar</p>
            </div>
          </div>
          {badItems.length > 0 && (
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-600">
              {badItems.length} com problema
            </span>
          )}
        </section>
      )}

      {!cameraOpen && items.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          {items.map((item, index) =>
            isProcessed(item) ? (
              <article
                key={item.id}
                className={`relative overflow-hidden rounded-[20px] shadow-[0_8px_24px_rgba(15,23,42,0.10)] ring-2 ${item.quality === 'ok' ? 'ring-emerald-400' : 'ring-amber-400'}`}
              >
                <div className="aspect-[3/4] w-full bg-slate-900">
                  {item.fileKind === 'pdf' ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-white/50">
                      <FileText className="h-10 w-10" />
                      <span className="text-xs font-bold uppercase tracking-widest">PDF</span>
                    </div>
                  ) : item.dataUrl ? (
                    <img src={item.dataUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <EyeOff className="h-8 w-8 text-white/30" />
                    </div>
                  )}
                </div>

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pb-2.5 pt-10">
                  <div className="flex items-end justify-between gap-1.5">
                    <div className="min-w-0">
                      {aiIds.includes(item.id) ? (
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-orange-300" />
                          <span className="text-[11px] font-semibold text-orange-300">Analisando…</span>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.quality === 'ok' ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'}`}>
                          {item.quality === 'ok' ? '✓ Apto' : '⚠ Verificar'}
                        </span>
                      )}
                      {item.quality === 'ruim' && item.reason && !aiIds.includes(item.id) && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-white/60">{item.reason}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition active:bg-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="absolute left-2 top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black/50 px-1.5 text-[11px] font-bold text-white/80 backdrop-blur-sm">
                  {index + 1}
                </div>
              </article>
            ) : (
              <article key={item.id} className="relative overflow-hidden rounded-[20px] bg-slate-100 ring-1 ring-slate-200">
                <div className="aspect-[3/4] flex items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2.5 pb-2.5 pt-8">
                  <p className="truncate text-[11px] text-white/70">{item.originalName}</p>
                </div>
              </article>
            ),
          )}
        </section>
      )}

      {cameraOpen && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />

          {/* ── Frame A4 com box-shadow para escurecer o exterior ── */}
          <div
            className="pointer-events-none absolute left-5 right-5 rounded-xl"
            style={{
              aspectRatio: '210 / 297',
              top: '50%',
              transform: 'translateY(-54%)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.64)',
            }}
          >
            {/* Borda fina interna */}
            <div className="absolute inset-0 rounded-xl border border-white/20" />

            {/* L-brackets laranja nos 4 cantos */}
            <div className="scanner-corner absolute -top-[2px] -left-[2px] h-8 w-8 rounded-tl-xl border-t-[3px] border-l-[3px] border-orange-400" />
            <div className="scanner-corner absolute -top-[2px] -right-[2px] h-8 w-8 rounded-tr-xl border-t-[3px] border-r-[3px] border-orange-400" />
            <div className="scanner-corner absolute -bottom-[2px] -right-[2px] h-8 w-8 rounded-br-xl border-b-[3px] border-r-[3px] border-orange-400" />
            <div className="scanner-corner absolute -bottom-[2px] -left-[2px] h-8 w-8 rounded-bl-xl border-b-[3px] border-l-[3px] border-orange-400" />

            {/* Linha de scan */}
            <div className="scanner-sweep-line" />

            {/* Label no rodapé do frame */}
            <p className="absolute inset-x-0 bottom-3 text-center text-[10px] font-semibold tracking-[0.22em] text-white/55 uppercase">
              Posicione o documento A4
            </p>
          </div>

          {/* ── Topo: fechar + contador ── */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] pb-3">
            <button
              onClick={stopCamera}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-black/50 px-4 text-sm font-semibold text-white backdrop-blur-sm"
            >
              <X className="h-4 w-4" /> Fechar
            </button>
            {processedItems.length > 0 && (
              <div className="rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white shadow-[0_4px_12px_rgba(249,115,22,0.4)]">
                {processedItems.length} no lote
              </div>
            )}
          </div>

          {/* ── Base: thumbnails + controles ── */}
          <div className="absolute inset-x-0 bottom-0 px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3">
            {cameraError && (
              <p className="mb-3 text-center text-sm font-medium text-rose-300">{cameraError}</p>
            )}

            {processedItems.length > 0 && (
              <div className="mb-4 flex items-center justify-center gap-2">
                {processedItems.slice(-5).map((item, i) => (
                  <div
                    key={item.id}
                    className={`flex h-[80px] w-[60px] shrink-0 overflow-hidden rounded-xl border-2 shadow-lg ${item.quality === 'ok' ? 'border-emerald-400' : 'border-rose-400'}`}
                    style={{ opacity: 0.6 + i * 0.1 }}
                  >
                    {item.fileKind === 'pdf' ? (
                      <div className="flex h-full w-full items-center justify-center bg-slate-800">
                        <FileText className="h-3.5 w-3.5 text-white/60" />
                      </div>
                    ) : item.dataUrl ? (
                      <img src={item.dataUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-slate-800" />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={triggerUpload}
                className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/14 text-white backdrop-blur-sm"
              >
                <Upload className="h-5 w-5" />
              </button>

              <button
                onClick={() => void capturePhoto()}
                disabled={capturing || processing}
                className="relative flex h-[78px] w-[78px] items-center justify-center disabled:opacity-50"
              >
                <span className="absolute inset-0 rounded-full border-[3px] border-white/60" />
                <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-orange-500 shadow-[0_0_28px_rgba(249,115,22,0.60)]">
                  {capturing || processing
                    ? <Loader2 className="h-6 w-6 animate-spin text-white" />
                    : <Camera className="h-6 w-6 text-white" />
                  }
                </span>
              </button>

              <button
                onClick={stopCamera}
                className="flex h-12 items-center justify-center rounded-2xl bg-white px-5 text-sm font-bold text-slate-900"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {cropEditorItem && draftQuad && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-white p-4 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.24)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Ajustar documento</p>
                <p className="text-xs text-slate-500">Arraste os 4 cantos para corrigir a perspectiva.</p>
              </div>
              <button onClick={closeCropEditor} className="rounded-xl border border-slate-200 p-2 text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex justify-center overflow-auto rounded-[24px] bg-slate-950 p-3">
              <div className="relative inline-block max-h-[68vh]">
                <img
                  ref={cropImageRef}
                  src={cropEditorItem.originalDataUrl || cropEditorItem.dataUrl}
                  alt={cropEditorItem.suggestedName}
                  className="block max-h-[68vh] rounded-[20px] object-contain"
                />
                <div className="absolute inset-0 rounded-[20px] bg-slate-950/34" />
                <div
                  className="absolute inset-0 rounded-[20px] border border-white/20 bg-white/8"
                  style={{ clipPath: `polygon(${draftQuadPolygon})` }}
                />
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points={[
                      `${draftQuad.tl.x},${draftQuad.tl.y}`,
                      `${draftQuad.tr.x},${draftQuad.tr.y}`,
                      `${draftQuad.br.x},${draftQuad.br.y}`,
                      `${draftQuad.bl.x},${draftQuad.bl.y}`,
                    ].join(' ')}
                    fill="rgba(255,255,255,0.08)"
                    stroke="white"
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="absolute inset-0">
                  {draftQuadCenter && (
                    <button
                      type="button"
                      onPointerDown={(event) => startCropDrag('move', event)}
                      className="absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/75 bg-slate-950/70 px-3 py-1 text-[11px] font-semibold text-white shadow-lg"
                      style={{
                        left: `${draftQuadCenter.x * 100}%`,
                        top: `${draftQuadCenter.y * 100}%`,
                      }}
                    >
                      Mover
                    </button>
                  )}
                  {(['tl', 'tr', 'br', 'bl'] as const).map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      onPointerDown={(event) => startCropDrag(handle, event)}
                      className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-orange-500 shadow-[0_8px_20px_rgba(249,115,22,0.35)]"
                      style={{
                        left: `${draftQuad[handle].x * 100}%`,
                        top: `${draftQuad[handle].y * 100}%`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={closeCropEditor}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                onClick={() => void saveCropEditor()}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {editingIds.includes(cropEditorItem.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {!cameraOpen && processedItems.length > 0 && (
        <div className="fixed inset-x-3 bottom-[78px] z-20 sm:hidden">
          {(
            <div className="rounded-[22px] bg-white p-2 shadow-[0_8px_32px_rgba(15,23,42,0.14)] ring-1 ring-slate-200/80">
              <div className="flex gap-2">
                <button
                  onClick={triggerUpload}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-slate-200 text-slate-500"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <button
                  onClick={openCamera}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] border border-slate-200 text-sm font-semibold text-slate-600"
                >
                  <Camera className="h-4 w-4" />
                  Capturar mais
                </button>
                {okItems.length > 0 ? (
                  <button
                    onClick={() => void sendBatch()}
                    disabled={sending}
                    className="inline-flex h-11 flex-[1.3] items-center justify-center gap-2 rounded-[14px] bg-orange-500 text-sm font-bold text-white shadow-[0_6px_18px_rgba(249,115,22,0.28)] disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Enviar
                  </button>
                ) : (
                  <button
                    onClick={() => void sendBatch(true)}
                    disabled={sending || processedItems.length === 0}
                    className="inline-flex h-11 flex-[1.3] items-center justify-center gap-1.5 rounded-[14px] bg-amber-500 text-xs font-bold text-white shadow-[0_6px_18px_rgba(245,158,11,0.28)] disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Enviar assim
                  </button>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void (okItems.length > 0 ? downloadPdf() : buildMergedPdfBlob(true).then(blob => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `scanner_${new Date().toISOString().slice(0,10)}.pdf`; a.click();
                    URL.revokeObjectURL(url);
                  }))}
                  disabled={processedItems.length === 0}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-slate-200 text-sm font-medium text-slate-500 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  Baixar PDF
                </button>
                <button
                  onClick={() => setItems([])}
                  disabled={processing}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-slate-200 text-sm font-medium text-slate-500 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Limpar tudo
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PortalScanner;
