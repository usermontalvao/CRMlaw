import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Crop,
  Download,
  EyeOff,
  FileText,
  Loader2,
  RotateCcw,
  RotateCw,
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
  detectScannerCropSuggestion,
  detectScannerFileKind,
  enrichScanItemWithAi,
  extractScannerOcr,
  processPdfFile,
  processScanFile,
  updateScannerImage,
  waitForPendingAiCalls,
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
const MIN_QUAD_AREA = 0.025;
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

function polygonArea(points: Array<{ x: number; y: number }>) {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

function ccw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function isQuadValid(quad: ScannerQuad) {
  const points = [quad.tl, quad.tr, quad.br, quad.bl];
  const area = Math.abs(polygonArea(points));
  if (area < MIN_QUAD_AREA) return false;
  if (segmentsIntersect(quad.tl, quad.tr, quad.br, quad.bl)) return false;
  if (segmentsIntersect(quad.tr, quad.br, quad.bl, quad.tl)) return false;
  return true;
}

function constrainHandleMove(baseQuad: ScannerQuad, handle: Exclude<CropHandle, 'move'>, point: { x: number; y: number }) {
  const next = normalizePoint(point);
  const margin = 0.04;
  switch (handle) {
    case 'tl':
      return {
        x: clamp(next.x, 0, Math.min(baseQuad.tr.x, baseQuad.bl.x) - margin),
        y: clamp(next.y, 0, baseQuad.bl.y - margin),
      };
    case 'tr':
      return {
        x: clamp(next.x, baseQuad.tl.x + margin, 1),
        y: clamp(next.y, 0, baseQuad.br.y - margin),
      };
    case 'br':
      return {
        x: clamp(next.x, baseQuad.bl.x + margin, 1),
        y: clamp(next.y, baseQuad.tr.y + margin, 1),
      };
    case 'bl':
      return {
        x: clamp(next.x, 0, baseQuad.br.x - margin),
        y: clamp(next.y, baseQuad.tl.y + margin, 1),
      };
  }
}

function sanitizeQuad(candidate: ScannerQuad, fallback?: ScannerQuad) {
  const normalized = normalizeQuad(candidate);
  if (isQuadValid(normalized)) return normalized;
  const rectQuad = cropToQuad(quadToCrop(normalized));
  if (isQuadValid(rectQuad)) return rectQuad;
  return fallback ? normalizeQuad(fallback) : cropToQuad({ x: 0, y: 0, width: 1, height: 1 });
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

function rotateDataUrl(dataUrl: string, degrees: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const swap = degrees === 90 || degrees === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.94));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export const PortalScanner: React.FC = () => {
  const { session } = useClientAuth();
  const { navigate } = usePortalRouter();
  const [items, setItems] = useState<ScanStateItem[]>([]);
  const itemsRef = useRef<ScanStateItem[]>([]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // Updated synchronously inside queueAiEnrich .then() — bypasses React render timing
  const latestNamesRef = useRef<Map<string, string>>(new Map());
  // When set to an item id, auto-open crop editor once that item finishes processing
  const autoCropIdRef = useRef<string | null>(null);
  // When set, the next camera capture replaces this item instead of adding a new one
  const retakeForIdRef = useRef<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ current: number; total: number } | null>(null);
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
  const [activeCropHandle, setActiveCropHandle] = useState<CropHandle | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureFrameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const cropDragRef = useRef<{
    handle: CropHandle;
    pointerId: number;
    startX: number;
    startY: number;
    rect: DOMRect;
    quad: ScannerQuad;
    trigger: HTMLElement | null;
  } | null>(null);

  // DOM refs for zero-React-render drag updates
  const svgPolyRef    = useRef<SVGPolygonElement | null>(null);
  const clipHlRef     = useRef<HTMLDivElement | null>(null);
  const moverBtnRef   = useRef<HTMLButtonElement | null>(null);
  const handleElMap   = useRef<Partial<Record<CropHandle, HTMLButtonElement>>>({});
  const liveDragQuad  = useRef<ScannerQuad | null>(null);

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

  // Direct DOM update — skips React re-render entirely during drag
  const applyQuadToDOM = (q: ScannerQuad) => {
    const pts = `${q.tl.x},${q.tl.y} ${q.tr.x},${q.tr.y} ${q.br.x},${q.br.y} ${q.bl.x},${q.bl.y}`;
    svgPolyRef.current?.setAttribute('points', pts);
    if (clipHlRef.current) {
      clipHlRef.current.style.clipPath =
        `polygon(${q.tl.x*100}% ${q.tl.y*100}%,${q.tr.x*100}% ${q.tr.y*100}%,${q.br.x*100}% ${q.br.y*100}%,${q.bl.x*100}% ${q.bl.y*100}%)`;
    }
    (['tl','tr','br','bl'] as const).forEach(h => {
      const el = handleElMap.current[h];
      if (el) { el.style.left = `${q[h].x * 100}%`; el.style.top = `${q[h].y * 100}%`; }
    });
    const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
    const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
    if (moverBtnRef.current) {
      moverBtnRef.current.style.left = `${cx * 100}%`;
      moverBtnRef.current.style.top  = `${cy * 100}%`;
    }
  };

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (!cropEditorId) return undefined;
    const originalOverflow = document.body.style.overflow;
    const originalTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.touchAction = originalTouchAction;
    };
  }, [cropEditorId]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!cropDragRef.current) return;
      const { handle, pointerId, startX, startY, rect, quad } = cropDragRef.current;
      if (event.pointerId !== pointerId) return;
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;
      let next: ScannerQuad = { ...quad };

      if (handle === 'move') {
        next = moveQuad(quad, dx, dy);
      } else {
        // Free drag — no real-time constraints so handles always respond to touch.
        // Quad is validated/corrected only on pointer release.
        next = { ...quad, [handle]: normalizePoint({ x: quad[handle].x + dx, y: quad[handle].y + dy }) };
      }

      // Update DOM directly — no React re-render, no lag
      liveDragQuad.current = next;
      applyQuadToDOM(next);
    };

    const finishDrag = (event?: PointerEvent) => {
      if (!cropDragRef.current) return;
      if (event && event.pointerId !== cropDragRef.current.pointerId) return;
      // Validate and commit on release — if quad is invalid, sanitizeQuad fits
      // the closest valid bounding-box rectangle around the dragged handles.
      if (liveDragQuad.current) {
        const startQuad = cropDragRef.current.quad;
        setDraftQuad(sanitizeQuad(liveDragQuad.current, startQuad));
        liveDragQuad.current = null;
      }
      const activeDrag = cropDragRef.current;
      if (activeDrag?.trigger?.hasPointerCapture?.(activeDrag.pointerId)) {
        try {
          activeDrag.trigger.releasePointerCapture(activeDrag.pointerId);
        } catch {
          // noop
        }
      }
      cropDragRef.current = null;
      setActiveCropHandle(null);
    };

    const updateDragRect = () => {
      if (!cropDragRef.current || !cropStageRef.current) return;
      cropDragRef.current.rect = cropStageRef.current.getBoundingClientRect();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    window.addEventListener('resize', updateDragRect);
    window.addEventListener('orientationchange', updateDragRect);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      window.removeEventListener('resize', updateDragRect);
      window.removeEventListener('orientationchange', updateDragRect);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const replacePlaceholder = (placeholderId: string, next: ScannerItem | null) => {
    setItems((current) =>
      current.flatMap((item) => {
        if (item.id !== placeholderId) return [item];
        return next ? [next] : [];
      }),
    );
    // Auto-open crop editor after camera capture
    if (next?.fileKind === 'image' && autoCropIdRef.current === placeholderId) {
      autoCropIdRef.current = null;
      setTimeout(() => openCropEditor(next), 120);
    }
  };

  const queueAiEnrich = (item: ScannerItem) => {
    if (item.fileKind !== 'image' || !item.dataUrl) return;
    setAiIds((current) => (current.includes(item.id) ? current : [...current, item.id]));
    void enrichScanItemWithAi(item)
      .then((updates) => {
        if (Object.keys(updates).length === 0) return;
        if (updates.suggestedName) latestNamesRef.current.set(item.id, updates.suggestedName);
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

  const addFiles = async (files: File[], autoCropFirst = false, replaceItemId?: string) => {
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
      // For the first camera capture, mark this placeholder so replacePlaceholder
      // auto-opens the crop editor once processing finishes
      if (autoCropFirst && fileIndex === 0) autoCropIdRef.current = placeholderId;
      if (replaceItemId && fileIndex === 0) {
        // Replace existing item in-place (retake photo flow)
        setItems((current) => current.map((item) =>
          item.id === replaceItemId ? { id: placeholderId, originalName: file.name, processing: true as const } : item,
        ));
      } else {
        setItems((current) => [...current, { id: placeholderId, originalName: file.name, processing: true }]);
      }

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
    if (!videoRef.current || !captureFrameRef.current || capturing) return;
    setCapturing(true);

    const video = videoRef.current;
    const videoRect = video.getBoundingClientRect();
    const frameRect = captureFrameRef.current.getBoundingClientRect();
    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;

    const coverScale = Math.max(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
    const renderedWidth = sourceWidth * coverScale;
    const renderedHeight = sourceHeight * coverScale;
    const offsetX = (videoRect.width - renderedWidth) / 2;
    const offsetY = (videoRect.height - renderedHeight) / 2;

    const frameLeft = frameRect.left - videoRect.left;
    const frameTop = frameRect.top - videoRect.top;
    const frameWidth = frameRect.width;
    const frameHeight = frameRect.height;

    const sx = clamp((frameLeft - offsetX) / coverScale, 0, sourceWidth - 1);
    const sy = clamp((frameTop - offsetY) / coverScale, 0, sourceHeight - 1);
    const sw = clamp(frameWidth / coverScale, 1, sourceWidth - sx);
    const sh = clamp(frameHeight / coverScale, 1, sourceHeight - sy);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCapturing(false);
      return;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) {
      // Camera shutter sound — two-curtain metallic click
      try {
        const ac = new AudioContext();
        const sr = ac.sampleRate;
        const dur = Math.floor(sr * 0.20);
        const buf = ac.createBuffer(1, dur, sr);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < dur; i++) {
          const t = i / sr;
          // First curtain: instant attack, fast metallic decay
          const e1 = t < 0.0004 ? t / 0.0004 : Math.exp(-(t - 0.0004) / 0.007);
          // Second curtain: 62ms later, slightly softer
          const t2 = t - 0.062;
          const e2 = t2 < 0 ? 0 : t2 < 0.0004 ? (t2 / 0.0004) * 0.72 : Math.exp(-(t2 - 0.0004) / 0.006) * 0.72;
          const noise = Math.random() * 2 - 1;
          const tone = Math.sin(2 * Math.PI * 4400 * t) * 0.28 + Math.sin(2 * Math.PI * 7000 * t) * 0.12;
          ch[i] = (noise * 0.60 + tone) * (e1 + e2);
        }
        // Highpass to strip low rumble, slight peak at 4 kHz for metallic bite
        const hpf = ac.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 1400;
        hpf.Q.value = 0.7;
        const peak = ac.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 4000;
        peak.gain.value = 7;
        peak.Q.value = 1.4;
        const gain = ac.createGain();
        gain.gain.value = 2.2;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(hpf);
        hpf.connect(peak);
        peak.connect(gain);
        gain.connect(ac.destination);
        src.start();
        setTimeout(() => ac.close().catch(() => {}), 600);
      } catch { /* ignore if audio not available */ }

      const file = new File([blob], `captura_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' });
      setCapturing(false);
      const replaceId = retakeForIdRef.current ?? undefined;
      retakeForIdRef.current = null;
      requestAnimationFrame(() => {
        void addFiles([file], true, replaceId);
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
    const nextQuad = sanitizeQuad(item.quad || cropToQuad(item.crop || { x: 0, y: 0, width: 1, height: 1 }));
    liveDragQuad.current = nextQuad;
    setDraftQuad(nextQuad);
  };

  const closeCropEditor = () => {
    cropDragRef.current = null;
    liveDragQuad.current = null;
    setActiveCropHandle(null);
    setCropEditorId(null);
    setDraftQuad(null);
  };

  const saveCropEditor = async () => {
    if (!cropEditorItem || !draftQuad) return;
    await applyItemEdit(cropEditorItem, { crop: quadToCrop(draftQuad), quad: draftQuad });
    closeCropEditor();
  };

  const rotateCropEditor = async (direction: 1 | -1) => {
    if (!cropEditorItem) return;
    setItemEditing(cropEditorItem.id, true);
    try {
      const degrees = direction === 1 ? 90 : 270;
      const source = cropEditorItem.originalDataUrl || cropEditorItem.dataUrl;
      const rotatedSource = await rotateDataUrl(source, degrees);
      const fullQuad = cropToQuad({ x: 0, y: 0, width: 1, height: 1 });
      // Bake rotation into originalDataUrl so the crop editor shows the rotated image
      const next = await updateScannerImage(
        { ...cropEditorItem, originalDataUrl: rotatedSource },
        { rotation: 0, quad: fullQuad },
      );
      const nextItem = { ...next, originalDataUrl: rotatedSource, ocrText: undefined };
      setItems((current) => current.map((entry) =>
        isProcessed(entry) && entry.id === cropEditorItem.id ? nextItem : entry,
      ));
      liveDragQuad.current = fullQuad;
      setDraftQuad(fullQuad);
      requestAnimationFrame(() => applyQuadToDOM(fullQuad));
    } finally {
      setItemEditing(cropEditorItem.id, false);
    }
  };

  const retakePhoto = () => {
    if (!cropEditorItem) return;
    retakeForIdRef.current = cropEditorItem.id;
    closeCropEditor();
    void openCamera();
  };

  const resetCropEditor = () => {
    const nextQuad = cropToQuad({ x: 0, y: 0, width: 1, height: 1 });
    liveDragQuad.current = nextQuad;
    setDraftQuad(nextQuad);
    requestAnimationFrame(() => applyQuadToDOM(nextQuad));
  };

  const redetectCropEditor = async () => {
    if (!cropEditorItem) return;
    setItemEditing(cropEditorItem.id, true);
    try {
      const sourceDataUrl = cropEditorItem.originalDataUrl || cropEditorItem.dataUrl;
      const suggestion = await detectScannerCropSuggestion(sourceDataUrl);
      const nextQuad = sanitizeQuad(suggestion.quad);
      const nextItem = await applyItemEdit(cropEditorItem, {
        crop: suggestion.crop,
        quad: nextQuad,
        enhancement: suggestion.enhancement,
      });
      if (nextItem) {
        liveDragQuad.current = nextQuad;
        setDraftQuad(nextQuad);
      }
    } finally {
      setItemEditing(cropEditorItem.id, false);
    }
  };

  const startCropDrag = (handle: CropHandle, event: React.PointerEvent) => {
    if (!cropStageRef.current || !draftQuad) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId) === false) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // noop
      }
    }
    const baseQuad = liveDragQuad.current || draftQuad;
    setActiveCropHandle(handle);
    cropDragRef.current = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: cropStageRef.current.getBoundingClientRect(),
      quad: baseQuad,
      trigger: event.currentTarget as HTMLElement,
    };
    liveDragQuad.current = baseQuad;
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

  const buildItemPdfBlob = async (item: ScannerItem) => {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();

    if (item.fileKind === 'pdf' && item.fileBlob) {
      const source = await PDFDocument.load(await item.fileBlob.arrayBuffer());
      const pages = await pdf.copyPages(source, source.getPageIndices());
      pages.forEach((p) => pdf.addPage(p));
    } else if (item.fileKind === 'image' && item.dataUrl) {
      const bytes = new Uint8Array(await dataUrlToBlob(item.dataUrl).arrayBuffer());
      const embedded = await pdf.embedJpg(bytes);
      const page = pdf.addPage();
      const { width: W, height: H } = page.getSize();
      const margin = 24;
      const scale = Math.min((W - margin * 2) / embedded.width, (H - margin * 2) / embedded.height);
      const dw = embedded.width * scale;
      const dh = embedded.height * scale;
      page.drawImage(embedded, { x: (W - dw) / 2, y: (H - dh) / 2, width: dw, height: dh });
    } else {
      return null;
    }

    const bytes = await pdf.save();
    return new Blob([new Uint8Array(Array.from(bytes))], { type: 'application/pdf' });
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

  const buildSafeFileName = (item: ScannerItem, index: number) => {
    const fallback = `Scanner_${new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).replace(/[/:, ]/g, '_')}`;
    const raw = item.suggestedName || '';
    const isGeneric = /^(scanner|arquivo)_\d+$/.test(raw);
    const base = isGeneric || !raw ? `${fallback}_${String(index).padStart(2, '0')}` : raw;
    return `${base}.pdf`;
  };

  const sendBatch = async (forceAll = false) => {
    if (!session?.user?.id || sending) return;
    setSendMessage(null);
    setSendProgress(null);
    setSending(true);
    try {
      // Wait for any in-flight AI rename/OCR calls to finish, then read the
      // freshest items from the ref so suggestedName is always up-to-date.
      await waitForPendingAiCalls();
      const latestProcessed = itemsRef.current.filter(isProcessed);
      const exportItems = forceAll
        ? latestProcessed.filter((item) => item.dataUrl || item.fileBlob)
        : latestProcessed.filter((item) => item.quality === 'ok');

      if (exportItems.length === 0) {
        setSendMessage('Nada válido para enviar.');
        return;
      }

      const { data: sessionData } = await supabasePortal.auth.getSession();
      const jwt = sessionData?.session?.access_token;
      if (!jwt) { setSendMessage('Sessão expirada. Faça login novamente.'); return; }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      let successCount = 0;
      setSendProgress({ current: 0, total: exportItems.length });

      for (let i = 0; i < exportItems.length; i++) {
        setSendProgress({ current: i + 1, total: exportItems.length });
        const item = exportItems[i];
        const blob = await buildItemPdfBlob(item);
        if (!blob) continue;

        const aiName = latestNamesRef.current.get(item.id);
        const effectiveItem = aiName ? { ...item, suggestedName: aiName } : item;
        const fileName = buildSafeFileName(effectiveItem, i + 1);
        const file = new File([blob], fileName, { type: 'application/pdf' });

        const form = new FormData();
        form.append('file', file);

        const uploadRes = await fetch(`${supabaseUrl}/functions/v1/portal-scanner-upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
          body: form,
        });

        if (!uploadRes.ok) {
          const errBody = await uploadRes.json().catch(() => ({}));
          setSendMessage(`Falha ao enviar "${fileName}": ${(errBody as any).error ?? uploadRes.status}`);
          return;
        }

        const { path, bucket, signedUrl } = await uploadRes.json() as { path: string; bucket: string; signedUrl?: string };
        const displayPath = path.split('/').slice(1).join('/');

        const content = `${ATTACH_PREFIX}${JSON.stringify({
          filePath: path,
          fileName,
          mimeType: 'application/pdf',
          size: file.size,
          bucket,
          displayPath,
          ...(signedUrl ? { url: signedUrl } : {}),
        })}`;

        const notified = await clientPortalService.sendChatMessage(session.user.id, content);
        if (!notified) {
          setSendMessage(`Salvo em ${displayPath}. Falha ao notificar o escritório.`);
          return;
        }

        successCount++;
      }

      if (successCount === 0) {
        setSendMessage('Falha ao enviar os arquivos.');
        return;
      }

      latestNamesRef.current.clear();
      setItems([]);
      setSent(true);
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 pb-60 sm:gap-4 sm:pb-6">
      {sending && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
          style={{ background: 'rgba(2,6,23,0.88)' }}
        >
          <div className="flex flex-col items-center gap-7 px-10 text-center">

            {/* Spinner SVG */}
            <div className="relative flex h-28 w-28 items-center justify-center">
              <svg
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 112 112"
                fill="none"
                style={{ animation: 'spin 1.1s linear infinite' }}
              >
                <circle cx="56" cy="56" r="48" stroke="rgba(249,115,22,0.18)" strokeWidth="6" />
                <path
                  d="M56 8 A48 48 0 0 1 104 56"
                  stroke="#f97316"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-500" style={{ boxShadow: '0 0 48px rgba(249,115,22,0.5)' }}>
                <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <p className="text-2xl font-bold text-white tracking-tight">Aguarde…</p>
              <p className="text-base font-semibold text-orange-300">
                Enviando{' '}
                {sendProgress
                  ? <>{sendProgress.current}/{sendProgress.total}</>
                  : '…'
                }
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-64 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.10)' }}>
              <div
                className="h-full rounded-full bg-orange-400 transition-all duration-500"
                style={{ width: sendProgress ? `${(sendProgress.current / sendProgress.total) * 100}%` : '0%' }}
              />
            </div>

          </div>

          {/* keyframes via style tag */}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>,
        document.body,
      )}
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

      {!cameraOpen && items.length === 0 && !sent && (
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

      {/* Success screen — full-screen overlay so it's never hidden */}
      {sent && createPortal(
        <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center px-6" style={{ background: '#f8fafc' }}>
          {/* checkmark */}
          <div
            className="flex h-24 w-24 items-center justify-center rounded-[28px] bg-emerald-50 text-emerald-500"
            style={{ boxShadow: '0 12px 40px rgba(16,185,129,0.22)' }}
          >
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <p className="mt-6 text-2xl font-bold text-slate-900 tracking-tight">Enviado!</p>
          <p className="mt-2 text-center text-sm text-slate-500">
            O escritório já foi notificado.
          </p>

          {/* buttons pinned to bottom with safe-area */}
          <div
            className="fixed inset-x-4 flex flex-col gap-2.5"
            style={{ bottom: 'calc(58px + env(safe-area-inset-bottom) + 10px)' }}
          >
            <button
              onClick={() => { setSent(false); setSendMessage(null); }}
              className="flex w-full items-center justify-center gap-2 rounded-[18px] bg-orange-500 py-4 text-sm font-bold text-white shadow-[0_6px_20px_rgba(249,115,22,0.32)] active:scale-[0.98] transition-transform"
            >
              <Camera className="h-4 w-4" /> Enviar mais arquivos
            </button>
            <button
              onClick={() => { setSent(false); setSendMessage(null); }}
              className="flex w-full items-center justify-center rounded-[18px] bg-white py-4 text-sm font-semibold text-slate-500 shadow-[0_4px_16px_rgba(15,23,42,0.06)] ring-1 ring-slate-200 active:scale-[0.98] transition-transform"
            >
              Fechar
            </button>
          </div>
        </div>,
        document.body,
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
                {processedItems.length} arquivo{processedItems.length > 1 ? 's' : ''} no lote
              </p>
              <p className="text-xs text-slate-400">{okItems.length} válido{okItems.length !== 1 ? 's' : ''} · pronto{okItems.length !== 1 ? 's' : ''} para enviar</p>
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
                <div
                  className={`aspect-[3/4] w-full bg-slate-900${item.fileKind === 'image' ? ' cursor-pointer' : ''}`}
                  onClick={() => item.fileKind === 'image' && openCropEditor(item)}
                >
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

                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2.5 pb-2.5 pt-12">
                  <div className="flex items-end justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      {aiIds.includes(item.id) ? (
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-orange-300" />
                          <span className="text-[11px] font-semibold text-orange-300">Identificando…</span>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.quality === 'ok' ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'}`}>
                          {item.quality === 'ok' ? '✓ Apto' : '⚠ Verificar'}
                        </span>
                      )}
                      {!aiIds.includes(item.id) && item.suggestedName && !/^(scanner|arquivo)_\d+$/.test(item.suggestedName) && (
                        <p className="mt-1 truncate text-[10px] font-semibold leading-tight text-white/80">
                          {item.suggestedName}
                        </p>
                      )}
                      {item.fileKind === 'image' && item.metrics.cropRatio < 0.86 && (
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-semibold text-cyan-300">
                          <Crop className="h-2.5 w-2.5" /> Auto-cortado
                        </span>
                      )}
                      {item.quality === 'ruim' && item.reason && !aiIds.includes(item.id) && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-white/55">{item.reason}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {item.fileKind === 'image' && (
                        <button
                          onClick={() => openCropEditor(item)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition active:bg-orange-500"
                        >
                          <Crop className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => removeItem(item.id)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition active:bg-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
            ref={captureFrameRef}
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
              <div className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {processedItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => item.fileKind === 'image' && openCropEditor(item)}
                    className={`flex h-[80px] w-[60px] shrink-0 overflow-hidden rounded-xl border-2 shadow-lg ${item.fileKind === 'image' ? 'cursor-pointer active:scale-95' : ''} ${item.quality === 'ok' ? 'border-emerald-400' : 'border-rose-400'}`}
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
        <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-4">
          {/* Card — flex column so buttons never scroll off screen */}
          <div
            className="flex w-full flex-col rounded-t-[28px] bg-white text-slate-900 shadow-[0_-8px_40px_rgba(15,23,42,0.22)] sm:max-w-md sm:rounded-[28px] sm:shadow-[0_24px_60px_rgba(15,23,42,0.24)]"
            style={{ maxHeight: 'calc(100dvh - 16px)' }}
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Ajustar recorte</p>
                <p className="text-xs text-slate-500">
                  {activeCropHandle === 'move'
                    ? 'Movendo a área selecionada.'
                    : activeCropHandle
                      ? 'Ajustando um canto do documento.'
                      : 'Arraste os cantos para encaixar o documento.'}
                </p>
              </div>
              <button onClick={closeCropEditor} className="rounded-xl border border-slate-200 p-2 text-slate-500 active:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid shrink-0 grid-cols-3 gap-2 px-4 pb-3">
              <button
                type="button"
                onClick={resetCropEditor}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-50 active:bg-slate-50"
              >
                Resetar
              </button>
              <button
                type="button"
                onClick={() => void redetectCropEditor()}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs font-semibold text-orange-700 disabled:opacity-50 active:bg-orange-100"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Redetectar
              </button>
              <button
                type="button"
                onClick={retakePhoto}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 disabled:opacity-50 active:bg-slate-50"
              >
                <Camera className="h-3.5 w-3.5" />
                Repetir
              </button>
            </div>

            {/* Image — flex-1 so it fills available space between header and buttons */}
            <div className="mx-4 flex min-h-0 flex-1 items-center justify-center rounded-[20px] bg-slate-950">
              <div ref={cropStageRef} className="relative inline-block max-w-full touch-none select-none">
                <img
                  ref={cropImageRef}
                  src={cropEditorItem.originalDataUrl || cropEditorItem.dataUrl}
                  alt={cropEditorItem.suggestedName}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  className="block max-h-[calc(100dvh-220px)] max-w-full select-none rounded-[16px]"
                />
                {/* Dark overlay outside selection */}
                <div className="pointer-events-none absolute inset-0 rounded-[16px] bg-slate-950/40" />
                {/* Highlighted selection area — updated by applyQuadToDOM */}
                <div
                  ref={clipHlRef}
                  className="pointer-events-none absolute inset-0 rounded-[16px] border border-white/20 bg-white/10"
                  style={{ clipPath: `polygon(${draftQuadPolygon})` }}
                />
                {/* SVG border lines */}
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-visible rounded-[16px]"
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                >
                  <polygon
                    ref={svgPolyRef}
                    points={[`${draftQuad.tl.x},${draftQuad.tl.y}`,`${draftQuad.tr.x},${draftQuad.tr.y}`,`${draftQuad.br.x},${draftQuad.br.y}`,`${draftQuad.bl.x},${draftQuad.bl.y}`].join(' ')}
                    fill="none"
                    stroke="rgba(249,115,22,0.9)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {/* Handles overlay */}
                <div className="absolute inset-0 touch-none">
                  {/* Mover */}
                  <button
                    ref={moverBtnRef}
                    type="button"
                    onPointerDown={(event) => startCropDrag('move', event)}
                    className="absolute flex h-11 min-w-[76px] -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full border border-white/60 bg-black/60 px-3 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-sm"
                    style={{ left: draftQuadCenter ? `${draftQuadCenter.x * 100}%` : '50%', top: draftQuadCenter ? `${draftQuadCenter.y * 100}%` : '50%' }}
                  >
                    Mover
                  </button>
                  {/* Corner handles */}
                  {(['tl', 'tr', 'br', 'bl'] as const).map((handle) => {
                    const isActive = activeCropHandle === handle;
                    return (
                      <button
                        key={handle}
                        ref={el => { handleElMap.current[handle] = el ?? undefined; }}
                        type="button"
                        onPointerDown={(event) => startCropDrag(handle, event)}
                        className={`absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full transition-transform duration-100${isActive ? ' scale-125' : ''}`}
                        style={{ left: `${draftQuad[handle].x * 100}%`, top: `${draftQuad[handle].y * 100}%` }}
                      >
                        <span className={`rounded-full border-[3px] border-white bg-orange-500 transition-all duration-100${isActive ? ' h-10 w-10 shadow-[0_0_0_4px_rgba(249,115,22,0.35),0_4px_16px_rgba(249,115,22,0.7)]' : ' h-8 w-8 shadow-[0_4px_16px_rgba(249,115,22,0.55)]'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Buttons — always visible, never scrolled away */}
            <div className="flex shrink-0 gap-2 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-3">
              <button
                onClick={closeCropEditor}
                className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200 py-3.5 text-sm font-semibold text-slate-700 active:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => void rotateCropEditor(-1)}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-600 disabled:opacity-40 active:bg-slate-50"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
              <button
                onClick={() => void rotateCropEditor(1)}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-600 disabled:opacity-40 active:bg-slate-50"
              >
                <RotateCw className="h-5 w-5" />
              </button>
              <button
                onClick={() => void saveCropEditor()}
                disabled={editingIds.includes(cropEditorItem.id)}
                className="flex flex-1 items-center justify-center rounded-2xl bg-orange-500 py-3.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(249,115,22,0.32)] disabled:opacity-50 active:opacity-90"
              >
                {editingIds.includes(cropEditorItem.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {!cameraOpen && processedItems.length > 0 && (
        <div className="fixed inset-x-3 z-20 sm:hidden" style={{ bottom: 'calc(58px + env(safe-area-inset-bottom) + 6px)' }}>
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
                    {sending
                      ? sendProgress ? <span className="text-[11px] font-bold">{sendProgress.current}/{sendProgress.total}</span> : <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />}
                    {sending ? 'Enviando…' : 'Enviar'}
                  </button>
                ) : (
                  <button
                    onClick={() => void sendBatch(true)}
                    disabled={sending || processedItems.length === 0}
                    className="inline-flex h-11 flex-[1.3] items-center justify-center gap-1.5 rounded-[14px] bg-amber-500 text-xs font-bold text-white shadow-[0_6px_18px_rgba(245,158,11,0.28)] disabled:opacity-50"
                  >
                    {sending
                      ? sendProgress ? <span className="text-[11px] font-bold">{sendProgress.current}/{sendProgress.total}</span> : <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    {sending ? 'Enviando…' : 'Enviar assim'}
                  </button>
                )}
              </div>
              <div className="mt-2 flex gap-2">
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
