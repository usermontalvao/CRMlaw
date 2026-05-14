import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import { supabase } from '../config/supabase';
import { signatureFieldsService } from './signatureFields.service';
import type { Signer, SignatureRequest, SignatureField } from '../types/signature.types';

interface SignedPdfOptions {
  request: SignatureRequest;
  signer: Signer;
  originalPdfUrl: string;
  creator?: { name: string; email: string } | null;
  attachmentPdfItems?: { documentId: string; url: string }[]; // anexos PDF para compilar
}

type EmbeddedImage = any;

interface GeoInfo {
  coordinates?: string;
  address?: string;
}

class PdfSignatureService {
  private readonly storageBucketCache = new Map<string, string>();

  private isInternalPlaceholderEmail(email: string | null | undefined): boolean {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return false;
    return e.startsWith('public+') && e.endsWith('@crm.local');
  }

  private async sha256Hex(bytes: Uint8Array): Promise<string> {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', ab);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  private async canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) throw new Error('Falha ao exportar imagem');
    return new Uint8Array(await blob.arrayBuffer());
  }

  private concatBytes(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }

  private async fetchBytesFromPathOrUrl(pathOrUrl: string): Promise<Uint8Array | null> {
    if (!pathOrUrl) return null;

    // URL direto
    if (/^https?:\/\//i.test(pathOrUrl)) {
      const res = await fetch(pathOrUrl);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    }

    // Path do storage (tentar buckets conhecidos)
    const preferredBucket = this.storageBucketCache.get(pathOrUrl);
    const defaultBuckets = ['document-templates', 'generated-documents', 'assinados'];
    const bucketsToTry = preferredBucket ? [preferredBucket] : defaultBuckets;
    const tryBuckets = async (buckets: string[]) => {
      for (const bucket of buckets) {
        try {
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(pathOrUrl, 3600);
          if (error || !data?.signedUrl) continue;
          const res = await fetch(data.signedUrl);
          if (!res.ok) continue;
          this.storageBucketCache.set(pathOrUrl, bucket);
          return new Uint8Array(await res.arrayBuffer());
        } catch {
          // ignore
        }
      }
      return null;
    };

    const firstTry = await tryBuckets(bucketsToTry);
    if (firstTry) return firstTry;

    if (preferredBucket) {
      const fallbackBuckets = defaultBuckets.filter((b) => b !== preferredBucket);
      const fallbackTry = await tryBuckets(fallbackBuckets);
      if (fallbackTry) return fallbackTry;
    }

    return null;
  }

  private formatIntegrityHash(hash: string | null | undefined, truncate = false): string {
    const h = (hash || '').trim();
    if (!h) return 'N/A';
    if (!truncate) return h;
    if (h.length <= 18) return h;
    return `${h.slice(0, 10)}…${h.slice(-8)}`;
  }

  private parseGeolocation(value: string | null | undefined): GeoInfo {
    if (!value) return {};
    const [coords, addr] = value.split('|');
    return { coordinates: coords?.trim() || undefined, address: addr?.trim() || undefined };
  }

  private parseUserAgent(ua: string | null | undefined): { device?: string; browser?: string; os?: string } {
    if (!ua) return {};

    let device: string | undefined;
    let browser: string | undefined;
    let os: string | undefined;

    if (ua.includes('iPhone')) device = 'iPhone';
    else if (ua.includes('iPad')) device = 'iPad';
    else if (ua.includes('Android') || ua.includes('Mobile')) device = 'Celular';
    else device = 'Desktop';

    if (ua.includes('Edg')) browser = 'Microsoft Edge';
    else if (ua.includes('Chrome')) browser = 'Google Chrome';
    else if (ua.includes('Firefox')) browser = 'Mozilla Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';

    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS X')) os = 'macOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Linux')) os = 'Linux';

    return { device, browser, os };
  }

  private toDateValue(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private formatManausDateTime(value: string | Date | null | undefined, options?: { withSeconds?: boolean }): string {
    const date = this.toDateValue(value);
    if (!date) return 'Nao informado';

    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(options?.withSeconds ? { second: '2-digit' } : {}),
    }).format(date);
  }

  private generateHash(docId: string, signerId: string): string {
    const input = `${docId}-${signerId}`;
    let hash = '';
    let seed = 0;
    for (let i = 0; i < input.length; i++) seed = ((seed << 5) - seed + input.charCodeAt(i)) | 0;
    for (let i = 0; i < 64; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      hash += '0123456789abcdef'[seed % 16];
    }
    return hash;
  }

  private async loadStorageImage(pdfDoc: PDFDocument, path: string | null | undefined, removeWhiteBg = false): Promise<EmbeddedImage | null> {
    if (!path) {
      console.log('[PDF] loadStorageImage: path vazio');
      return null;
    }
    console.log('[PDF] loadStorageImage: tentando carregar', path);
    
    // Tentar mÃºltiplos buckets onde as imagens podem estar
    const bucketsToTry = ['document-templates', 'generated-documents', 'signatures'];
    let signedUrl: string | null = null;
    
    for (const bucket of bucketsToTry) {
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (!error && data?.signedUrl) {
          console.log(`[PDF] Imagem localizada no bucket ${bucket}`);
          signedUrl = data.signedUrl;
          break;
        }
      } catch {
        // silencioso — tenta próximo bucket
      }
    }
    
    if (!signedUrl) {
      console.log('[PDF] Imagem nÃ£o encontrada em nenhum bucket');
      return null;
    }
    
    try {
      const response = await fetch(signedUrl);
      if (!response.ok) {
        console.error('[PDF] Erro ao buscar imagem:', response.status, response.statusText);
        return null;
      }
      const bytes = await response.arrayBuffer();
      console.log('[PDF] Bytes carregados:', bytes.byteLength);
      let u8 = new Uint8Array(bytes);
      
      // Remover fundo branco da assinatura se solicitado
      const originalU8 = u8;
      if (removeWhiteBg) {
        try {
          console.log('[PDF] Removendo fundo branco...');
          u8 = await this.removeWhiteBackground(u8) as Uint8Array<ArrayBuffer>;
          console.log('[PDF] Fundo branco removido, novo tamanho:', u8.byteLength);
        } catch (bgErr) {
          console.error('[PDF] Erro ao remover fundo branco, usando original:', bgErr);
          u8 = originalU8;
        }
      }
      
      try {
        const img = await pdfDoc.embedPng(u8);
        console.log('[PDF] Imagem embedada como PNG');
        return img;
      } catch (pngErr) {
        console.log('[PDF] Falha PNG, tentando JPG:', pngErr);
        try {
          const img = await pdfDoc.embedJpg(u8);
          console.log('[PDF] Imagem embedada como JPG');
          return img;
        } catch (jpgErr) {
          console.error('[PDF] Falha ao embedar imagem, tentando original sem remoÃ§Ã£o de fundo...');
          // Fallback: tentar com imagem original se a remoÃ§Ã£o de fundo corrompeu
          if (removeWhiteBg) {
            try {
              const img = await pdfDoc.embedPng(originalU8);
              console.log('[PDF] Imagem original embedada como PNG');
              return img;
            } catch {
              try {
                const img = await pdfDoc.embedJpg(originalU8);
                console.log('[PDF] Imagem original embedada como JPG');
                return img;
              } catch {
                console.error('[PDF] Falha total ao embedar imagem');
                return null;
              }
            }
          }
          return null;
        }
      }
    } catch (err) {
      console.error('[PDF] Erro geral ao carregar imagem:', err);
      return null;
    }
  }

  private async removeWhiteBackground(imageBytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const blob = new Blob([imageBytes as BlobPart], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageBytes);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Converter pixels brancos/quase brancos para transparente
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Se o pixel Ã© branco ou quase branco (threshold 240)
          if (r > 240 && g > 240 && b > 240) {
            data[i + 3] = 0; // Tornar transparente
          }
        }
        
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            blob.arrayBuffer().then((buffer) => {
              resolve(new Uint8Array(buffer));
            });
          } else {
            resolve(imageBytes);
          }
        }, 'image/png');
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(imageBytes);
      };
      img.src = url;
    });
  }

  private async buildQrPng(pdfDoc: PDFDocument, url: string): Promise<EmbeddedImage | null> {
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
      const base64 = dataUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return await pdfDoc.embedPng(bytes);
    } catch {
      return null;
    }
  }

  private percentToPdfRect(
    pageWidth: number,
    pageHeight: number,
    field: Pick<SignatureField, 'x_percent' | 'y_percent' | 'w_percent' | 'h_percent'>
  ) {
    // UI trabalha com origem no topo-esquerdo; pdf-lib usa origem no bottom-esquerdo.
    const w = (pageWidth * field.w_percent) / 100;
    const h = (pageHeight * field.h_percent) / 100;
    const x = (pageWidth * field.x_percent) / 100;
    const yTop = (pageHeight * field.y_percent) / 100;
    const y = pageHeight - yTop - h;
    return { x, y, w, h };
  }

  private drawFooterStamp(params: {
    page: any;
    pageWidth: number;
    pageHeight: number;
    signer: Signer;
    verificationUrl?: string | null;
    qrImage?: EmbeddedImage | null;
    helvetica: any;
    helveticaBold: any;
    docHash: string;
    integritySha256?: string | null;
    variant?: 'card' | 'strip';
    /** Quando true o fundo do strip é totalmente opaco (espaço reservado, nada por baixo) */
    opaqueStrip?: boolean;
  }) {
    const { page, pageWidth, pageHeight, signer, verificationUrl, qrImage, helvetica, helveticaBold, integritySha256, variant, opaqueStrip } = params;
    void pageHeight;

    const integrityFull = this.formatIntegrityHash(integritySha256, false);
    const code = (signer.verification_hash || '').toUpperCase() || 'N/A';
    const mode: 'card' | 'strip' = variant ?? 'strip';

    if (mode === 'strip') {
      const h = 52;
      const x = 0;
      const y = 0;
      const w = pageWidth;
      const qrPad = 5;
      const qrSize = h - qrPad * 2;
      const qrX = x + w - qrSize - qrPad - 2;
      const qrY = y + qrPad;

      const stripWhite  = rgb(1, 1, 1);
      const stripBorder = rgb(0.86, 0.89, 0.93);
      const stripDark   = rgb(0.09, 0.12, 0.18);
      const stripSoft   = rgb(0.45, 0.50, 0.58);
      const stripMuted  = rgb(0.62, 0.67, 0.74);
      const stripOrange = rgb(0.91, 0.32, 0.04);

      // White background: opaque when space is reserved (nothing behind), semi-opaque as overlay
      page.drawRectangle({ x, y, width: w, height: h, color: stripWhite, opacity: opaqueStrip ? 1 : 0.92 });

      // Top border line
      page.drawLine({
        start: { x, y: y + h }, end: { x: x + w, y: y + h },
        thickness: 0.6, color: stripBorder,
      });

      // Thin orange top stripe (3px)
      page.drawRectangle({ x, y: y + h - 3, width: w, height: 3, color: stripOrange });

      // QR code
      if (qrImage) {
        page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: stripWhite });
        page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      }

      const tx = x + 12;

      // Brand + label
      page.drawText('JURIUS', { x: tx, y: y + h - 16, size: 7, font: helveticaBold, color: stripDark });
      page.drawText('·', { x: tx + 30, y: y + h - 16, size: 7, font: helvetica, color: stripOrange });
      page.drawText('Assinatura Eletrônica', { x: tx + 38, y: y + h - 16, size: 6.5, font: helvetica, color: stripSoft });

      // Thin separator
      page.drawLine({
        start: { x: tx, y: y + h - 23 }, end: { x: qrX - 8, y: y + h - 23 },
        thickness: 0.4, color: stripBorder,
      });

      // Code row
      if (signer.verification_hash) {
        page.drawText('CODIGO:', { x: tx, y: y + h - 34, size: 5.5, font: helvetica, color: stripMuted });
        page.drawText(code, { x: tx + 38, y: y + h - 34, size: 6.5, font: helveticaBold, color: stripDark });
      }

      // Hash
      const hashDisplay = integrityFull.length > 64 ? `${integrityFull.slice(0, 61)}...` : integrityFull;
      page.drawText(`SHA-256: ${hashDisplay}`, {
        x: tx, y: y + 9, size: 5, font: helvetica, color: stripMuted,
      });

      return;
    }

    // ── CARD MODE ──────────────────────────────────────────────────────
    // ZapSign-inspired: white background, thin lines, text left, QR right
    const boxH = 88;
    const boxX = 0;
    const boxY = 0;
    const boxW = pageWidth;

    const cardWhite  = rgb(1, 1, 1);
    const cardBorder = rgb(0.86, 0.89, 0.93);   // #dbe2ee
    const cardDark   = rgb(0.09, 0.12, 0.18);   // #171e2e
    const cardSoft   = rgb(0.45, 0.50, 0.58);   // mid gray
    const cardMuted  = rgb(0.62, 0.67, 0.74);   // light gray
    const cardOrange = rgb(0.91, 0.32, 0.04);   // #e85208

    // White background
    page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: cardWhite });

    // Top thin border line
    page.drawLine({
      start: { x: boxX, y: boxY + boxH },
      end: { x: boxX + boxW, y: boxY + boxH },
      thickness: 0.6, color: cardBorder,
    });

    // Thin orange top stripe (3px)
    page.drawRectangle({ x: boxX, y: boxY + boxH - 3, width: boxW, height: 3, color: cardOrange });

    // QR code — right side, vertically centered
    const qrSize = 62;
    const qrX = boxX + boxW - qrSize - 14;
    const qrY = boxY + (boxH - qrSize) / 2;
    if (qrImage) {
      // White padding behind QR
      page.drawRectangle({ x: qrX - 3, y: qrY - 3, width: qrSize + 6, height: qrSize + 6, color: cardWhite });
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    }

    // Left text area
    const tx = boxX + 14;
    const textW = qrX - tx - 12;
    void textW;

    // Brand + title line
    page.drawText('JURIUS', {
      x: tx, y: boxY + boxH - 19, size: 8, font: helveticaBold, color: cardDark,
    });
    page.drawText('·', {
      x: tx + 34, y: boxY + boxH - 19, size: 8, font: helvetica, color: cardOrange,
    });
    page.drawText('Certificado de Assinatura Eletrônica', {
      x: tx + 42, y: boxY + boxH - 19, size: 7.5, font: helvetica, color: cardSoft,
    });

    // Thin separator
    page.drawLine({
      start: { x: tx, y: boxY + boxH - 27 },
      end: { x: qrX - 8, y: boxY + boxH - 27 },
      thickness: 0.4, color: cardBorder,
    });

    // Verification code row
    page.drawText('CODIGO:', {
      x: tx, y: boxY + boxH - 39, size: 6, font: helvetica, color: cardMuted,
    });
    page.drawText(code, {
      x: tx + 42, y: boxY + boxH - 39, size: 7, font: helveticaBold, color: cardDark,
    });

    // SHA-256 row
    const hashDisplay = integrityFull.length > 74 ? `${integrityFull.slice(0, 71)}...` : integrityFull;
    page.drawText('SHA-256:', {
      x: tx, y: boxY + boxH - 52, size: 6, font: helvetica, color: cardMuted,
    });
    page.drawText(hashDisplay, {
      x: tx + 42, y: boxY + boxH - 52, size: 5.5, font: helvetica, color: cardSoft,
    });

    // Verification URL
    if (verificationUrl) {
      const urlDisplay = verificationUrl.length > 90 ? `${verificationUrl.slice(0, 87)}...` : verificationUrl;
      page.drawLine({
        start: { x: tx, y: boxY + boxH - 60 },
        end: { x: qrX - 8, y: boxY + boxH - 60 },
        thickness: 0.4, color: cardBorder,
      });
      page.drawText(urlDisplay, {
        x: tx, y: boxY + 12, size: 5.5, font: helvetica, color: cardOrange,
      });
    }
  }
  private async addReportPages(params: {
    pdfDoc: PDFDocument;
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string; email: string } | null;
    signatureImage?: EmbeddedImage | null;
    facialImage?: EmbeddedImage | null;
    qrImage?: EmbeddedImage | null;
    verificationUrl?: string | null;
  }) {
    const { pdfDoc, request, signer, creator, signatureImage, facialImage, qrImage, verificationUrl } = params;

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const lm = 50;
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const signedRequestSigners = await (async () => {
      try {
        const { data } = await supabase
          .from('signature_signers')
          .select('*')
          .eq('signature_request_id', request.id)
          .order('order', { ascending: true });
        const all = (data as Signer[] | null) ?? [];
        const signed = all.filter((item) => item.status === 'signed');
        return signed.length > 0 ? signed : [signer];
      } catch {
        return [signer];
      }
    })();

    // Fetch all audit log entries for the full history (multiple view events per signer)
    type AuditEntry = {
      id: string;
      signer_id: string | null;
      action: string;
      description: string;
      ip_address: string | null;
      user_agent: string | null;
      created_at: string;
    };
    const auditLogEntries: AuditEntry[] = await (async () => {
      try {
        const { data } = await supabase
          .from('signature_audit_log')
          .select('id, signer_id, action, description, ip_address, user_agent, created_at')
          .eq('signature_request_id', request.id)
          .order('created_at', { ascending: true });
        return (data as AuditEntry[] | null) ?? [];
      } catch {
        return [];
      }
    })();

    const nowStr = this.formatManausDateTime(new Date());

    const signerAssets = await Promise.all(
      signedRequestSigners.map(async (item) => ({
        signer: item,
        signature: item.id === signer.id ? (signatureImage ?? null) : await this.loadStorageImage(pdfDoc, item.signature_image_path, true),
        facial: item.id === signer.id ? (facialImage ?? null) : await this.loadStorageImage(pdfDoc, item.facial_image_path),
        qr: item.id === signer.id
          ? (qrImage ?? null)
          : (item.verification_hash ? await this.buildQrPng(pdfDoc, `${window.location.origin}/#/verificar/${item.verification_hash}`) : null),
        verificationUrl: item.id === signer.id
          ? (verificationUrl ?? null)
          : (item.verification_hash ? `${window.location.origin}/#/verificar/${item.verification_hash}` : null),
      }))
    );

    const wrapText = (text: string, font: any, size: number, maxWidth: number) => {
      const safe = String(text || '').trim();
      if (!safe) return [''];
      const words = safe.split(/\s+/);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        const width = typeof font?.widthOfTextAtSize === 'function'
          ? font.widthOfTextAtSize(candidate, size)
          : candidate.length * size * 0.5;
        if (width <= maxWidth || !current) {
          current = candidate;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    // Design tokens
    const navy    = rgb(0.06, 0.09, 0.18);
    const navyMid = rgb(0.12, 0.16, 0.25);
    const orange  = rgb(0.91, 0.32, 0.04);
    const emerald = rgb(0.06, 0.47, 0.25);
    const white   = rgb(1, 1, 1);
    const bgLight = rgb(0.96, 0.97, 0.98);
    const border  = rgb(0.86, 0.89, 0.93);
    const txtDark = rgb(0.09, 0.12, 0.18);
    const txtMid  = rgb(0.35, 0.40, 0.48);
    const txtSoft = rgb(0.55, 0.60, 0.68);
    const silver  = rgb(0.78, 0.82, 0.87);

    const createReportHeader = (page: PDFPage, title: string, subtitle?: string) => {
      // Thin orange top stripe only — page background stays white
      page.drawRectangle({ x: 0, y: pageHeight - 5, width: pageWidth, height: 5, color: orange });

      // Top separator line
      page.drawLine({ start: { x: lm, y: pageHeight - 20 }, end: { x: pageWidth - lm, y: pageHeight - 20 }, thickness: 0.4, color: border });

      // "JURIUS" logotype in dark
      page.drawText('JURIUS', { x: lm, y: pageHeight - 38, size: 16, font: helveticaBold, color: txtDark });
      // Separator dot
      page.drawText('·', { x: lm + 68, y: pageHeight - 38, size: 12, font: helvetica, color: orange });
      // Page title in soft gray
      page.drawText(title, { x: lm + 78, y: pageHeight - 37, size: 10, font: helvetica, color: txtSoft });

      // Right: date
      page.drawText(nowStr, { x: pageWidth - lm - 118, y: pageHeight - 37, size: 7, font: helvetica, color: silver });

      // Bottom separator
      page.drawLine({ start: { x: lm, y: pageHeight - 50 }, end: { x: pageWidth - lm, y: pageHeight - 50 }, thickness: 0.4, color: border });

      // Document name
      const docName = request.document_name.length > 72 ? `${request.document_name.slice(0, 69)}...` : request.document_name;
      page.drawText(docName, { x: lm, y: pageHeight - 74, size: 13, font: helveticaBold, color: txtDark });

      // Subtitle / protocol line
      const protocolLine = subtitle ? subtitle : `Protocolo: ${request.id}`;
      page.drawText(protocolLine, { x: lm, y: pageHeight - 90, size: 7.5, font: helvetica, color: txtSoft });

      // Section divider
      page.drawLine({ start: { x: lm, y: pageHeight - 104 }, end: { x: pageWidth - lm, y: pageHeight - 104 }, thickness: 0.4, color: border });
    };

    const buildAuthPoints = (item: Signer) => {
      const geo = this.parseGeolocation(item.signer_geolocation);
      const ua = this.parseUserAgent(item.signer_user_agent);
      const points: string[] = ['Assinatura manuscrita digital'];
      if (item.auth_provider === 'google') {
        points.push(`Autenticação via Google (${item.auth_email || 'não informado'})`);
        if (item.auth_google_sub) points.push(`Google ID: ${item.auth_google_sub}`);
      } else if (item.auth_provider === 'email_link') {
        points.push(`Autenticação via Link por E-mail (${item.auth_email || 'não informado'})`);
      } else if (item.auth_provider === 'phone') {
        points.push(`Autenticação via Telefone (${item.phone || 'verificado'})`);
      }
      if (item.signer_ip) points.push(`Endereço IP: ${item.signer_ip}`);
      if (geo.coordinates) points.push(`Geolocalização: ${geo.coordinates}`);
      if (item.facial_image_path) points.push('Verificação facial (selfie)');
      const deviceParts = [ua.device, ua.browser, ua.os].filter(Boolean);
      if (deviceParts.length > 0) points.push(`Dispositivo: ${deviceParts.join(' - ')}`);
      return points;
    };

    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    const sigCount1 = signedRequestSigners.length;
    createReportHeader(page1, 'CERTIFICADO DE ASSINATURA', `${sigCount1} ${sigCount1 === 1 ? 'signatario' : 'signatarios'} · Emitido em ${nowStr}`);

    // Section title
    const sectionY1 = pageHeight - 136;
    page1.drawRectangle({ x: lm, y: sectionY1 - 2, width: 3, height: 16, color: orange });
    page1.drawText('ASSINATURAS', { x: lm + 10, y: sectionY1, size: 9, font: helveticaBold, color: txtDark });
    page1.drawLine({ start: { x: lm + 10, y: sectionY1 - 6 }, end: { x: pageWidth - lm, y: sectionY1 - 6 }, thickness: 0.4, color: border });

    let yCards = pageHeight - 162;
    for (const asset of signerAssets) {
      const item = asset.signer;
      const signedAtStr = this.formatManausDateTime(item.signed_at, { withSeconds: true });
      const authPoints = buildAuthPoints(item);
      const rightColW = 175;
      const rightStartX = pageWidth - lm - rightColW;
      const cardHeight = Math.max(185, 80 + (authPoints.length * 13));
      if (yCards - cardHeight < 90) break;

      const cw = pageWidth - lm * 2;
      const cx = lm;
      const cy = yCards - cardHeight;

      // Card shadow
      page1.drawRectangle({ x: cx + 2, y: cy - 2, width: cw, height: cardHeight, color: rgb(0.88, 0.90, 0.93) });
      // Card body
      page1.drawRectangle({ x: cx, y: cy, width: cw, height: cardHeight, color: white, borderColor: border, borderWidth: 0.8 });

      // Left orange accent bar
      page1.drawRectangle({ x: cx, y: cy, width: 4, height: cardHeight, color: orange });

      // Dark header band inside card
      const hdrH = 32;
      page1.drawRectangle({ x: cx, y: yCards - hdrH, width: cw, height: hdrH, color: navy });

      // Signed badge — clean design, no fake tick (WinAnsi limitation)
      page1.drawRectangle({ x: cx + 12, y: yCards - hdrH + 7, width: 68, height: 18, color: emerald });
      // Small white square bullet
      page1.drawRectangle({ x: cx + 18, y: yCards - hdrH + 13, width: 5, height: 5, color: white });
      page1.drawText('ASSINADO', { x: cx + 26, y: yCards - hdrH + 13, size: 7.5, font: helveticaBold, color: white });

      // Signer name in header
      const nameDisplay = item.name.length > 32 ? `${item.name.slice(0, 30)}...` : item.name;
      page1.drawText(nameDisplay.toUpperCase(), { x: cx + 84, y: yCards - hdrH + 12, size: 11, font: helveticaBold, color: white });
      if (item.role) {
        page1.drawText(item.role, { x: cx + 84, y: yCards - hdrH + 2, size: 7, font: helvetica, color: silver });
      }

      // Timestamp
      page1.drawText(`Assinado em:`, { x: cx + 12, y: yCards - hdrH - 16, size: 7.5, font: helvetica, color: txtSoft });
      page1.drawText(signedAtStr, { x: cx + 65, y: yCards - hdrH - 16, size: 7.5, font: helveticaBold, color: txtDark });

      // Thin divider
      page1.drawLine({ start: { x: cx + 12, y: yCards - hdrH - 26 }, end: { x: rightStartX - 8, y: yCards - hdrH - 26 }, thickness: 0.4, color: border });

      // Auth factors label
      page1.drawText('FATORES DE AUTENTICAÇÃO:', { x: cx + 12, y: yCards - hdrH - 40, size: 6.5, font: helveticaBold, color: txtSoft });

      // Auth points — small navy squares as bullets
      let pointY = yCards - hdrH - 54;
      for (const point of authPoints.slice(0, 8)) {
        page1.drawRectangle({ x: cx + 14, y: pointY, width: 4, height: 4, color: emerald });
        page1.drawText(point, { x: cx + 24, y: pointY, size: 7.5, font: helvetica, color: txtMid, maxWidth: rightStartX - cx - 36 });
        pointY -= 13;
      }

      // Right column — signature box
      // In pdf-lib: y = bottom-left corner, coordinates go UP from bottom of page
      const sigBoxW = rightColW - 16;
      const sigX = rightStartX + 8;
      const sigLabelY = yCards - hdrH - 12;          // y of the label text (baseline)
      const sigBoxTop = sigLabelY - 6;               // top edge of box (just below label)
      const sigBoxBottom = yCards - cardHeight + 12; // bottom edge of box (12px above card bottom)
      const sigBoxH = Math.max(30, sigBoxTop - sigBoxBottom);

      page1.drawText('ASSINATURA MANUSCRITA', { x: sigX, y: sigLabelY, size: 6, font: helveticaBold, color: txtSoft });

      // Signature frame — drawn from bottom-left
      page1.drawRectangle({ x: sigX, y: sigBoxBottom, width: sigBoxW, height: sigBoxH, color: bgLight, borderColor: border, borderWidth: 0.8 });

      // Baseline hint line — 16px above box bottom
      page1.drawLine({
        start: { x: sigX + 10, y: sigBoxBottom + 16 },
        end:   { x: sigX + sigBoxW - 10, y: sigBoxBottom + 16 },
        thickness: 0.5, color: border,
      });

      // Signature image — strictly inside box with fixed padding
      if (asset.signature) {
        const imgPad = 8;
        const imgX = sigX + imgPad;
        const imgY = sigBoxBottom + imgPad;           // starts imgPad above box bottom
        const imgW = sigBoxW - imgPad * 2;
        const imgH = Math.max(10, sigBoxH - imgPad * 2); // never overflows box
        page1.drawImage(asset.signature, { x: imgX, y: imgY, width: imgW, height: imgH });
      }

      yCards -= cardHeight + 18;
    }

    for (const asset of signerAssets) {
      const item = asset.signer;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const signedAtStr = this.formatManausDateTime(item.signed_at, { withSeconds: true });
      const geoP2 = this.parseGeolocation(item.signer_geolocation);
      const uaP2  = this.parseUserAgent(item.signer_user_agent);

      createReportHeader(page, 'BIOMETRIA & VERIFICAÇÃO', `Signatario: ${item.name}`);

      // ── Section label ─────────────────────────────────────────
      const sectionLabelY = pageHeight - 132;
      page.drawRectangle({ x: lm, y: sectionLabelY - 2, width: 3, height: 14, color: orange });
      page.drawText('BIOMETRIA FACIAL', { x: lm + 10, y: sectionLabelY, size: 8, font: helveticaBold, color: txtDark });
      page.drawLine({ start: { x: lm + 10, y: sectionLabelY - 6 }, end: { x: pageWidth - lm, y: sectionLabelY - 6 }, thickness: 0.4, color: border });

      // ── Photo — large, portrait ────────────────────────────────
      const photoW = 210;
      const photoH = 260;
      const photoX = lm;
      const photoY = pageHeight - 168 - photoH; // bottom-left Y of photo

      // Caption above photo: "Foto do rosto (selfie) de NAME:"
      const photoCaption = `Foto do rosto (selfie) de ${item.name}:`;
      page.drawText(photoCaption, { x: photoX, y: photoY + photoH + 10, size: 6.5, font: helvetica, color: txtSoft });

      if (asset.facial) {
        // Subtle drop shadow
        page.drawRectangle({ x: photoX + 3, y: photoY - 3, width: photoW, height: photoH, color: rgb(0.82, 0.86, 0.90) });
        // White frame
        page.drawRectangle({ x: photoX, y: photoY, width: photoW, height: photoH, color: white, borderColor: border, borderWidth: 1.2 });
        // Image inside frame
        const imgPad = 3;
        page.drawImage(asset.facial, { x: photoX + imgPad, y: photoY + imgPad, width: photoW - imgPad * 2, height: photoH - imgPad * 2 });

        // ── CONFIDENTIAL watermark — centered with dashed lines ──
        const wmCenterX = photoX + imgPad + (photoW - imgPad * 2) / 2;
        const wmCenterY = photoY + imgPad + (photoH - imgPad * 2) / 2;

        // Dashed line above
        const dashW = 5; const dashGap = 4;
        const dLineY1 = wmCenterY + 14;
        const dLineY2 = wmCenterY - 16;
        const dLineX1 = photoX + imgPad + 16;
        const dLineX2 = photoX + photoW - imgPad - 16;
        for (let cx = dLineX1; cx < dLineX2; cx += dashW + dashGap) {
          const ex = Math.min(cx + dashW, dLineX2);
          page.drawLine({ start: { x: cx, y: dLineY1 }, end: { x: ex, y: dLineY1 }, thickness: 0.6, color: rgb(0.38, 0.38, 0.38), opacity: 0.22 });
        }

        // "CONFIDENTIAL" text centered
        const confSize = 10;
        const confText = 'CONFIDENTIAL';
        const confW = helveticaBold.widthOfTextAtSize(confText, confSize);
        page.drawText(confText, {
          x: wmCenterX - confW / 2, y: wmCenterY + 2,
          size: confSize, font: helveticaBold, color: rgb(0.30, 0.30, 0.30), opacity: 0.28,
        });

        // Date below text
        const dtSize = 6;
        const dtW = helvetica.widthOfTextAtSize(signedAtStr, dtSize);
        page.drawText(signedAtStr, {
          x: wmCenterX - dtW / 2, y: wmCenterY - 9,
          size: dtSize, font: helvetica, color: rgb(0.30, 0.30, 0.30), opacity: 0.22,
        });

        // Dashed line below
        for (let cx = dLineX1; cx < dLineX2; cx += dashW + dashGap) {
          const ex = Math.min(cx + dashW, dLineX2);
          page.drawLine({ start: { x: cx, y: dLineY2 }, end: { x: ex, y: dLineY2 }, thickness: 0.6, color: rgb(0.38, 0.38, 0.38), opacity: 0.22 });
        }
      } else {
        page.drawRectangle({ x: photoX, y: photoY, width: photoW, height: photoH, color: bgLight, borderColor: border, borderWidth: 1 });
        page.drawText('Selfie nao', { x: photoX + 70, y: photoY + photoH / 2 + 8, size: 9, font: helveticaBold, color: rgb(0.70, 0.72, 0.75) });
        page.drawText('coletada', { x: photoX + 76, y: photoY + photoH / 2 - 6, size: 9, font: helveticaBold, color: rgb(0.70, 0.72, 0.75) });
      }

      // ── Signer data — right column ─────────────────────────────
      const detX = photoX + photoW + 20;
      const detW = pageWidth - lm - detX;
      let detY = pageHeight - 148;

      // Data section label
      page.drawRectangle({ x: detX, y: detY - 2, width: 3, height: 14, color: emerald });
      page.drawText('DADOS DO SIGNATARIO', { x: detX + 10, y: detY, size: 8, font: helveticaBold, color: txtDark });
      detY -= 18;

      const deviceStrP2 = (() => {
        const parts = [uaP2.browser, uaP2.os, uaP2.device].filter(Boolean);
        return parts.join(' · ') || '—';
      })();
      const contactStrP2 = (() => {
        const ae = String(item.auth_email || '').trim();
        const ph = String(item.phone || '').trim();
        const re = String(item.email || '').trim();
        return ae || (item.auth_provider === 'phone' ? ph : '') || (!this.isInternalPlaceholderEmail(re) ? re : '') || '—';
      })();
      const authStrP2 = item.auth_provider === 'google'
        ? `Google (${item.auth_email || ''})`
        : item.auth_provider === 'email_link' ? `E-mail (${item.auth_email || ''})`
        : item.auth_provider === 'phone'      ? `SMS (${item.phone || ''})`
        : 'Assinatura direta';

      const dataFieldsP2: [string, string][] = [
        ['Nome', item.name],
        ['Papel', item.role || '—'],
        ['Contato', contactStrP2],
        ['CPF', item.cpf || '—'],
        ['Endereco IP', item.signer_ip || '—'],
        ['Localizacao', geoP2.coordinates || '—'],
        ['Dispositivo', deviceStrP2],
        ['Autenticacao', authStrP2],
        ['Assinado em', signedAtStr],
      ];

      for (let fi = 0; fi < dataFieldsP2.length; fi++) {
        if (detY < photoY + 4) break;
        const [label, rawVal] = dataFieldsP2[fi];
        const value = rawVal.length > 42 ? `${rawVal.slice(0, 40)}...` : rawVal;
        const rowH = 24;
        if (fi % 2 === 0) {
          page.drawRectangle({ x: detX - 4, y: detY - rowH + 4, width: detW + 4, height: rowH, color: bgLight });
        }
        page.drawText(label.toUpperCase() + ':', { x: detX, y: detY - 3, size: 5.5, font: helveticaBold, color: txtSoft });
        page.drawText(value, { x: detX, y: detY - 14, size: 7.5, font: helvetica, color: txtDark, maxWidth: detW });
        detY -= rowH;
      }

      // ── Certificate / integrity block — white, ZapSign-style ──
      const legalTopY  = photoY - 18;
      const verBlockH  = 96;
      const verBlockW  = pageWidth - lm * 2;
      const verBlockY  = legalTopY - verBlockH;

      const cbWhite  = rgb(1, 1, 1);
      const cbBorder = rgb(0.86, 0.89, 0.93);
      const cbDark   = rgb(0.09, 0.12, 0.18);
      const cbSoft   = rgb(0.45, 0.50, 0.58);
      const cbMuted  = rgb(0.62, 0.67, 0.74);
      const cbOrange = rgb(0.91, 0.32, 0.04);

      // White background
      page.drawRectangle({ x: lm, y: verBlockY, width: verBlockW, height: verBlockH, color: cbWhite });
      // Top border
      page.drawLine({ start: { x: lm, y: legalTopY }, end: { x: lm + verBlockW, y: legalTopY }, thickness: 0.6, color: cbBorder });
      // Orange stripe
      page.drawRectangle({ x: lm, y: legalTopY - 3, width: verBlockW, height: 3, color: cbOrange });
      // Bottom border
      page.drawLine({ start: { x: lm, y: verBlockY }, end: { x: lm + verBlockW, y: verBlockY }, thickness: 0.5, color: cbBorder });

      // QR code — right side
      const cbQrSize = 72;
      const cbQrX    = lm + verBlockW - cbQrSize - 14;
      const cbQrY    = verBlockY + (verBlockH - cbQrSize) / 2;
      if (asset.qr) {
        page.drawRectangle({ x: cbQrX - 3, y: cbQrY - 3, width: cbQrSize + 6, height: cbQrSize + 6, color: cbWhite });
        page.drawImage(asset.qr, { x: cbQrX, y: cbQrY, width: cbQrSize, height: cbQrSize });
      }

      const vtx = lm + 14;

      // Brand + title
      page.drawText('JURIUS', { x: vtx, y: legalTopY - 18, size: 8, font: helveticaBold, color: cbDark });
      page.drawText('·', { x: vtx + 34, y: legalTopY - 18, size: 8, font: helvetica, color: cbOrange });
      page.drawText('Certificado de Assinatura Eletrônica', { x: vtx + 42, y: legalTopY - 18, size: 7.5, font: helvetica, color: cbSoft });

      // Thin separator
      page.drawLine({ start: { x: vtx, y: legalTopY - 26 }, end: { x: cbQrX - 8, y: legalTopY - 26 }, thickness: 0.4, color: cbBorder });

      // Code row
      page.drawText('CODIGO:', { x: vtx, y: legalTopY - 38, size: 6, font: helvetica, color: cbMuted });
      page.drawText((item.verification_hash || 'N/A').toUpperCase(), { x: vtx + 42, y: legalTopY - 38, size: 7.5, font: helveticaBold, color: cbDark });

      // SHA-256
      const cbHash = item.verification_hash ? `${item.verification_hash.slice(0, 52)}...` : 'N/A';
      page.drawText('SHA-256:', { x: vtx, y: legalTopY - 52, size: 6, font: helvetica, color: cbMuted });
      page.drawText(cbHash, { x: vtx + 42, y: legalTopY - 52, size: 5.5, font: helvetica, color: cbSoft });

      // Separator
      page.drawLine({ start: { x: vtx, y: legalTopY - 60 }, end: { x: cbQrX - 8, y: legalTopY - 60 }, thickness: 0.4, color: cbBorder });

      // Verification URL
      if (asset.verificationUrl) {
        const urlD = asset.verificationUrl.length > 80 ? `${asset.verificationUrl.slice(0, 77)}...` : asset.verificationUrl;
        page.drawText(urlD, { x: vtx, y: verBlockY + 14, size: 5.5, font: helvetica, color: cbOrange });
      }

      // Signer note
      page.drawText(`Signatario: ${item.name}  ·  Documento: ${request.id}`, { x: vtx, y: verBlockY + 5, size: 5, font: helvetica, color: cbMuted });
    }

    const historyPage = pdfDoc.addPage([pageWidth, pageHeight]);
    createReportHeader(historyPage, 'TRILHA DE AUDITORIA');
    const createdAtDate = this.toDateValue(request.created_at) ?? new Date();
    const createdAtStr = this.formatManausDateTime(createdAtDate);
    type HistoryItem = { label: string; when: string; detail: string; sortAt: number };
    const history: HistoryItem[] = [];
    const creatorName = creator?.name || 'Sistema';
    const creatorEmail = creator?.email ? ` (Email: ${creator.email})` : '';
    history.push({ label: 'Criado', when: createdAtStr, detail: `${creatorName} criou este documento.${creatorEmail}`, sortAt: createdAtDate.getTime() });

    for (const item of signedRequestSigners) {
      const geo = this.parseGeolocation(item.signer_geolocation);
      const authEmail = String(item.auth_email || '').trim();
      const phone = String(item.phone || '').trim();
      const rawEmail = String(item.email || '').trim();
      const displayContact = authEmail || (item.auth_provider === 'phone' ? phone : '') || (!this.isInternalPlaceholderEmail(rawEmail) ? rawEmail : '');
      const displayContactLabel = authEmail ? 'Email' : item.auth_provider === 'phone' ? 'Telefone' : 'Email';
      const signerContact = displayContact ? ` (${displayContactLabel}: ${displayContact})` : '';
      const signerCpf = item.cpf ? `, CPF: ${item.cpf}` : '';
      const locationInfo = geo.coordinates ? ` localizado em ${geo.coordinates}${geo.address ? ` - ${geo.address}` : ''}` : '';

      // ── View events: use audit log to capture ALL visits (multiple opens) ──
      const viewAuditEntries = auditLogEntries.filter(
        (e) => e.action === 'viewed' && e.signer_id === item.id
      );

      if (viewAuditEntries.length > 0) {
        // Use audit log entries — each visit is a separate card in the timeline
        for (const ve of viewAuditEntries) {
          const ts = this.toDateValue(ve.created_at);
          const ipInfo = ve.ip_address ? ` por meio do IP ${ve.ip_address}` : '';
          history.push({
            label: 'Visualizado',
            when: this.formatManausDateTime(ve.created_at),
            detail: `${item.name}${signerContact}${signerCpf} abriu o documento${ipInfo}`,
            sortAt: ts?.getTime() ?? 0,
          });
        }
      } else if (item.viewed_at) {
        // Fallback for older records without audit log entries
        const viewedAtDate = this.toDateValue(item.viewed_at);
        history.push({
          label: 'Visualizado',
          when: this.formatManausDateTime(item.viewed_at),
          detail: `${item.name}${signerContact}${signerCpf} visualizou este documento${item.signer_ip ? ` por meio do IP ${item.signer_ip}` : ''}${locationInfo}`,
          sortAt: viewedAtDate?.getTime() ?? 0,
        });
      }

      if (item.signed_at) {
        const signedAtDate = this.toDateValue(item.signed_at);
        const authSummary = item.auth_provider === 'phone'
          ? `Autenticação via Telefone (${String(item.phone || '').replace(/\D/g, '') || 'não informado'})`
          : item.auth_provider === 'email_link'
            ? `Autenticação via Link por E-mail (${item.auth_email || 'não informado'})`
            : item.auth_provider === 'google'
              ? `Autenticação via Google (${item.auth_email || 'não informado'})`
              : '';
        history.push({
          label: 'Assinado',
          when: this.formatManausDateTime(item.signed_at),
          detail: `${item.name}${signerContact}${signerCpf} assinou este documento${item.signer_ip ? ` por meio do IP ${item.signer_ip}` : ''}${locationInfo}${authSummary ? `. ${authSummary}` : ''}`,
          sortAt: signedAtDate?.getTime() ?? 0,
        });
      }
    }

    history.sort((a, b) => a.sortAt - b.sortAt);

    // Section label
    const histSectionY = pageHeight - 132;
    historyPage.drawRectangle({ x: lm, y: histSectionY - 2, width: 3, height: 14, color: orange });
    historyPage.drawText('REGISTRO DE EVENTOS', { x: lm + 10, y: histSectionY, size: 8, font: helveticaBold, color: txtDark });
    historyPage.drawLine({ start: { x: lm + 10, y: histSectionY - 6 }, end: { x: pageWidth - lm, y: histSectionY - 6 }, thickness: 0.4, color: border });

    let y = pageHeight - 160;
    const timelineX = lm + 14; // vertical line x
    const eventGap = 10;

    // Draw vertical timeline line (approximate)
    historyPage.drawLine({ start: { x: timelineX, y: y + 8 }, end: { x: timelineX, y: 100 }, thickness: 1, color: border });

    for (const histItem of history) {
      const detailLines = wrapText(histItem.detail, helvetica, 7.5, pageWidth - lm * 2 - 46);
      const blockHeight = 36 + detailLines.length * 12;
      if (y - blockHeight < 90) break;

      const isCreated    = histItem.label === 'Criado';
      const isViewed     = histItem.label === 'Visualizado';
      const isSigned     = histItem.label === 'Assinado';

      // Accent color for this event
      const viewedColor = rgb(0.35, 0.40, 0.52);   // slate — neutral, no strong blue
      const dotColor  = isSigned ? emerald : isViewed ? viewedColor : isCreated ? orange : txtSoft;
      const badgeBg   = isSigned ? emerald : isViewed ? viewedColor : isCreated ? orange : navyMid;

      // Timeline dot (circle via rectangle, approximate)
      historyPage.drawRectangle({ x: timelineX - 5, y: y - 5, width: 10, height: 10, color: dotColor, borderColor: white, borderWidth: 1.5 });

      // Event card
      const cardX = timelineX + 16;
      const cardW = pageWidth - lm - cardX - lm + lm;
      historyPage.drawRectangle({ x: cardX, y: y - blockHeight, width: cardW, height: blockHeight, color: bgLight, borderColor: border, borderWidth: 0.6 });
      // Left color accent per event type
      historyPage.drawRectangle({ x: cardX, y: y - blockHeight, width: 3, height: blockHeight, color: dotColor });

      // Badge + timestamp on same line
      historyPage.drawRectangle({ x: cardX + 8, y: y - 20, width: 62, height: 14, color: badgeBg });
      historyPage.drawText(histItem.label.toUpperCase(), { x: cardX + 11, y: y - 16, size: 6.5, font: helveticaBold, color: white });
      historyPage.drawText(histItem.when, { x: cardX + 78, y: y - 16, size: 7.5, font: helvetica, color: txtMid });

      // Detail lines
      let detailY = y - 33;
      for (const line of detailLines.slice(0, 5)) {
        historyPage.drawText(line, { x: cardX + 8, y: detailY, size: 7.5, font: helvetica, color: txtDark });
        detailY -= 12;
      }

      y -= blockHeight + eventGap;
    }

    // Footer note on history page
    historyPage.drawLine({ start: { x: lm, y: 88 }, end: { x: pageWidth - lm, y: 88 }, thickness: 0.4, color: border });
    historyPage.drawText('Este registro de auditoria e parte integrante do certificado de assinatura. Todas as datas em UTC-0400 (America/Manaus).', { x: lm, y: 76, size: 6.5, font: helvetica, color: txtSoft });
    historyPage.drawText(`Documento: ${request.id}  ·  Jurius CRM`, { x: lm, y: 64, size: 6, font: helvetica, color: silver });
  }

  async generateSignedPdf(options: SignedPdfOptions): Promise<Uint8Array> {
    const { request, signer, originalPdfUrl, creator, attachmentPdfItems } = options;

    console.log('[PDF] Gerando PDF assinado para:', signer.name);
    console.log('[PDF] signature_image_path:', signer.signature_image_path);
    console.log('[PDF] facial_image_path:', signer.facial_image_path);
    console.log('[PDF] Anexos para compilar:', attachmentPdfItems?.length || 0);

    const originalPdfBytes = await fetch(originalPdfUrl).then((res) => res.arrayBuffer());
    const integrityChunks: Uint8Array[] = [new Uint8Array(originalPdfBytes)];
    const pdfDoc = await PDFDocument.load(originalPdfBytes);

    const documentOffsets: Record<string, number> = { main: 0 };
    let nextOffset = pdfDoc.getPageCount();
    
    // Adicionar anexos PDF ao documento (antes do relatÃ³rio)
    if (attachmentPdfItems && attachmentPdfItems.length > 0) {
      for (const item of attachmentPdfItems) {
        const attachUrl = item.url;
        try {
          const attachRes = await fetch(attachUrl);
          if (!attachRes.ok) continue;
          const attachBytes = new Uint8Array(await attachRes.arrayBuffer());
          integrityChunks.push(attachBytes);
          const attachDoc = await PDFDocument.load(attachBytes);
          documentOffsets[item.documentId] = nextOffset;
          const attachPages = await pdfDoc.copyPages(attachDoc, attachDoc.getPageIndices());
          for (const p of attachPages) pdfDoc.addPage(p);
          nextOffset += attachDoc.getPageCount();
          console.log('[PDF] Anexo adicionado:', attachUrl);
        } catch (e) {
          console.warn('[PDF] Erro ao adicionar anexo:', attachUrl, e);
        }
      }
    }

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Images
    console.log('[PDF] Carregando imagem de assinatura...');
    const signatureImage = await this.loadStorageImage(pdfDoc, signer.signature_image_path, true); // true = remover fundo branco
    console.log('[PDF] Carregando imagem facial...');
    const facialImage = await this.loadStorageImage(pdfDoc, signer.facial_image_path);
    console.log('[PDF] Imagens carregadas - assinatura:', !!signatureImage, 'facial:', !!facialImage);

    const verificationUrl = signer.verification_hash
      ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
      : null;

    const qrImage = verificationUrl ? await this.buildQrPng(pdfDoc, verificationUrl) : null;

    // Hash de integridade (do(s) arquivo(s) original(is), antes de assinar)
    const integritySha256 = await this.sha256Hex(this.concatBytes(integrityChunks));

    // Load fields and place signature on marked location(s)
    let fields: SignatureField[] = [];
    try {
      fields = await signatureFieldsService.listByRequest(request.id);
    } catch {
      fields = [];
    }
    const { data: requestSignersData } = await supabase
      .from('signature_signers')
      .select('*')
      .eq('signature_request_id', request.id)
      .order('order', { ascending: true });
    const signedRequestSigners = ((requestSignersData as Signer[] | null) ?? []).filter((item) => item.status === 'signed');

    console.log('[PDF] Campos encontrados:', fields.length, 'Signatários assinados:', signedRequestSigners.length);
    console.log('[PDF] Campos:', fields);

    const pages = pdfDoc.getPages();

    const signerDrawAssets = await Promise.all((signedRequestSigners.length > 0 ? signedRequestSigners : [signer]).map(async (item) => ({
      signer: item,
      signature: item.id === signer.id ? signatureImage : await this.loadStorageImage(pdfDoc, item.signature_image_path, true),
    })));

    let drewAnySignature = false;
    for (const asset of signerDrawAssets) {
      if (!asset.signature) continue;
      const assetFields = fields.filter((f) => f.field_type === 'signature' && (f.signer_id === asset.signer.id || (!f.signer_id && signerDrawAssets.length === 1)));
      for (const f of assetFields) {
        const docId = (f as any).document_id || 'main';
        const offset = documentOffsets[docId] ?? 0;
        const pageIndex = Math.max(0, offset + Math.max(1, (f.page_number ?? 1)) - 1);
        const page = pages[pageIndex];
        if (!page) continue;
        const { width, height } = page.getSize();
        const { x, y, w, h } = this.percentToPdfRect(width, height, f);
        const drawX = Math.max(0, Math.min(width, x));
        const drawY = Math.max(0, Math.min(height, y));
        const drawW = Math.max(1, Math.min(w, width - drawX));
        const drawH = Math.max(1, Math.min(h, height - drawY));
        page.drawImage(asset.signature, { x: drawX, y: drawY, width: drawW, height: drawH });
        drewAnySignature = true;
      }
    }

    if (!drewAnySignature && signatureImage) {
      // Fallback: se nÃ£o houver campos marcados, colocar assinatura na Ãºltima pÃ¡gina
      console.log('[PDF] Nenhum campo marcado - usando posiÃ§Ã£o padrÃ£o na Ãºltima pÃ¡gina');
      const lastPage = pages[pages.length - 1];
      if (lastPage) {
        const { width, height } = lastPage.getSize();
        // PosiÃ§Ã£o padrÃ£o: canto inferior direito, acima do rodapÃ©
        const sigWidth = 150;
        const sigHeight = 60;
        const x = width - sigWidth - 80; // 80px da borda direita
        const y = 120; // 120px da borda inferior (acima do footer stamp)
        console.log('[PDF] Desenhando assinatura na posiÃ§Ã£o padrÃ£o:', { x, y, sigWidth, sigHeight });
        lastPage.drawImage(signatureImage, { x, y, width: sigWidth, height: sigHeight });
      }
    } else if (!signatureImage) {
      console.log('[PDF] Imagem de assinatura nÃ£o disponÃ­vel');
    }

    // Gerar hash do documento
    const docHash = this.generateHash(request.id, signer.id);

    // Append report pages
    await this.addReportPages({
      pdfDoc,
      request,
      signer,
      creator,
      signatureImage,
      facialImage,
      qrImage,
      verificationUrl,
    });

    // Rodapé com hash de integridade em TODAS as páginas (documento + anexos + relatório)
    const allPages = pdfDoc.getPages();
    for (const p of allPages) {
      const { width: w, height: h } = p.getSize();
      this.drawFooterStamp({
        page: p,
        pageWidth: w,
        pageHeight: h,
        signer,
        verificationUrl,
        qrImage,
        helvetica,
        helveticaBold,
        docHash: '',
        integritySha256,
        variant: 'strip',
      });
    }

    return await pdfDoc.save();
  }

  /**
   * Desenha assinaturas em uma section do DOCX convertida para PDF
   */
  private drawSignaturesOnSection(
    pdfPage: PDFPage,
    sectionIdx: number,
    fields: SignatureField[],
    signer: Signer,
    signatureImage: EmbeddedImage | null,
    scaledHeight: number,
    pdfPageWidth: number,
    pdfPageHeight: number,
    yOffset: number = 0
  ): void {
    if (!signatureImage || !fields.length) return;
    
    // Filtrar campos desta section (page_number = sectionIdx + 1)
    const sectionFields = fields.filter((f) =>
      f.field_type === 'signature' &&
      (f.signer_id == null || f.signer_id === signer.id) &&
      Math.max(1, (f.page_number ?? 1)) === (sectionIdx + 1)
    );
    
    console.log(`[PDF] Campos para section ${sectionIdx + 1}:`, sectionFields.length);
    
    for (const field of sectionFields) {
      // Coordenadas são percentuais relativos à section
      const x = (field.x_percent / 100) * pdfPageWidth;
      const w = (field.w_percent / 100) * pdfPageWidth;
      
      // Y do campo em pixels (do topo da section escalada)
      const fieldYTop = (field.y_percent / 100) * scaledHeight;
      
      // Altura do campo
      const fieldH = (field.h_percent / 100) * scaledHeight;
      const h = Math.min(fieldH, 50); // Limitar altura máxima
      
      // Para sections longas divididas, verificar se o campo cai nesta fatia
      const sliceStart = yOffset;
      const sliceEnd = yOffset + pdfPageHeight;
      
      if (fieldYTop + h >= sliceStart && fieldYTop < sliceEnd) {
        // Calcular Y na página PDF (0,0 é canto inferior esquerdo)
        // A imagem é desenhada do topo, então precisamos converter
        const yInSlice = fieldYTop - sliceStart;
        const y = pdfPageHeight - yInSlice - h;
        
        console.log(`[PDF] Desenhando assinatura: section=${sectionIdx+1}, x=${x.toFixed(0)}, y=${y.toFixed(0)}, w=${w.toFixed(0)}, h=${h.toFixed(0)}`);
        
        pdfPage.drawImage(signatureImage, { x, y, width: w, height: h });
      }
    }
  }

  async downloadSignedPdf(options: SignedPdfOptions): Promise<void> {
    const pdfBytes = await this.generateSignedPdf(options);

    // @ts-ignore - Uint8Array Ã© aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    // Abrir o documento em uma nova aba para visualizaÃ§Ã£o
    window.open(url, '_blank');
    
    // TambÃ©m oferecer opÃ§Ã£o de download
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${options.request.document_name.replace(/\.pdf$/i, '')}_assinado.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Liberar o URL apÃ³s um tempo para garantir que o download e a visualizaÃ§Ã£o funcionem
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000); // Manter o URL vÃ¡lido por 1 minuto
    }, 1000); // Pequeno delay para garantir que a visualizaÃ§Ã£o abra primeiro
  }

  /**
   * Gera e salva o PDF assinado no bucket 'assinados', retornando o path
   */
  async saveSignedPdfToStorage(options: SignedPdfOptions): Promise<{ filePath: string; sha256: string }> {
    const pdfBytes = await this.generateSignedPdf(options);
    const sha256 = await this.sha256Hex(pdfBytes);
    
    // @ts-ignore - Uint8Array Ã© aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName = `signed_${options.signer.id}_${Date.now()}.pdf`;
    const filePath = `${options.request.id}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('assinados')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        upsert: true,
      });
    
    if (error) {
      console.error('[PDF] Erro ao salvar PDF assinado:', error);
      throw new Error(`Erro ao salvar PDF assinado: ${error.message}`);
    }
    
    console.log('[PDF] PDF assinado salvo no bucket assinados:', filePath);
    return { filePath, sha256 };
  }
  /**
   * Gera e salva PDF completo para documentos DOCX
   * Captura o wrapper DOCX inteiro e divide em páginas A4
   */
  async saveSignedDocxAsPdf(options: {
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string; email: string } | null;
    docxContainer: HTMLElement;
    attachmentDocxItems?: { documentId: string; container: HTMLElement }[];
    attachmentPdfItems?: { documentId: string; url: string }[];
    fieldsOverride?: SignatureField[];
  }): Promise<{ filePath: string; sha256: string }> {
    const { request, signer, creator, docxContainer, attachmentDocxItems, attachmentPdfItems, fieldsOverride } = options;
    
    console.log('[PDF] Convertendo DOCX para PDF...');
    
    const pdfDoc = await PDFDocument.create();
    const pdfPageWidth = 595.28; 
    const pdfPageHeight = 841.89;
    const A4_WIDTH_PX = 794; // A4 @ 96 DPI
    const FOOTER_RESERVED_H = 56; // strip height=52 + 4pt margem — conteúdo escala ~6% p/ rodapé limpo
    const CONTENT_MARGIN_X = 32;
    const CONTENT_MARGIN_TOP = 28;
    const contentTopY = pdfPageHeight - CONTENT_MARGIN_TOP;
    const contentBottomY = FOOTER_RESERVED_H;
    const contentHeightPt = contentTopY - contentBottomY;
    const contentWidthPt = pdfPageWidth - (CONTENT_MARGIN_X * 2);
    const PLACEHOLDER_Y_OFFSET_PT = 40;
    const placeholderDetectedByDocument: Record<string, boolean> = {};
    const ENABLE_ATTACHMENT_FALLBACK_SIGNATURE = false;
    
    let signatureImage: EmbeddedImage | null = null;
    if (signer.signature_image_path) {
      signatureImage = await this.loadStorageImage(pdfDoc, signer.signature_image_path, true);
    }
    console.log('[PDF] signature_image_path:', signer.signature_image_path);
    console.log('[PDF] signatureImage carregada:', !!signatureImage);

    let fields: SignatureField[] = [];
    if (Array.isArray(fieldsOverride)) {
      fields = fieldsOverride;
      console.log('[PDF] Campos de assinatura recebidos via override:', fields.length);
    } else {
      try {
        fields = await signatureFieldsService.listByRequest(request.id);
        console.log('[PDF] Campos de assinatura carregados:', fields.length);
      } catch {
        fields = [];
      }
    }
    
    if (fields.length > 0) {
      console.log('[PDF] Detalhes dos campos:', fields.map(f => ({
        document_id: f.document_id,
        page: f.page_number,
        signer_id: f.signer_id,
        x: f.x_percent,
        y: f.y_percent
      })));
    }

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const integrityChunks: Uint8Array[] = [];

    const integrityPromises: Promise<Uint8Array | null>[] = [];
    if (request.document_path) integrityPromises.push(this.fetchBytesFromPathOrUrl(request.document_path));
    if (Array.isArray((request as any).attachment_paths)) {
      const paths = ((request as any).attachment_paths as string[]).filter(Boolean);
      for (const p of paths) integrityPromises.push(this.fetchBytesFromPathOrUrl(p));
    }
    if (attachmentPdfItems && attachmentPdfItems.length > 0) {
      for (const a of attachmentPdfItems) {
        integrityPromises.push(
          (async () => {
            try {
              const res = await fetch(a.url);
              if (!res.ok) return null;
              return new Uint8Array(await res.arrayBuffer());
            } catch {
              return null;
            }
          })()
        );
      }
    }

    const integrityResults = await Promise.all(integrityPromises);
    for (const b of integrityResults) {
      if (b) integrityChunks.push(b);
    }
    if (integrityChunks.length === 0) {
      integrityChunks.push(new TextEncoder().encode(`${request.id}:${signer.id}:${request.document_name || ''}`));
    }
    const integritySha256 = await this.sha256Hex(this.concatBytes(integrityChunks));
    
    const verificationUrl = signer.verification_hash
      ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
      : null;

    let qrImageForFooter: EmbeddedImage | null = null;
    if (verificationUrl) {
      try {
        qrImageForFooter = await this.buildQrPng(pdfDoc, verificationUrl);
      } catch (e) {
        console.warn('Erro QR footer', e);
      }
    }

    const { data: signedRequestSignersDataForDocx } = await supabase
      .from('signature_signers')
      .select('*')
      .eq('signature_request_id', request.id)
      .order('order', { ascending: true });
    const docxSignedRequestSigners = ((signedRequestSignersDataForDocx as Signer[] | null) ?? []).filter((item) => item.status === 'signed');
    const docxSignerDrawAssets = await Promise.all((docxSignedRequestSigners.length > 0 ? docxSignedRequestSigners : [signer]).map(async (item) => ({
      signer: item,
      signature: item.id === signer.id ? signatureImage : await this.loadStorageImage(pdfDoc, item.signature_image_path, true),
    })));

    const drawSignatureField = (params: {
      pdfPage: any;
      pageW: number;
      pageH: number;
      x: number;
      y: number;
      w: number;
      h: number;
      minY: number;
      maxY: number;
      signatureImage: EmbeddedImage;
    }) => {
      const { pdfPage, pageW, x, y, w, h, minY, maxY, signatureImage } = params;
      const drawX = Math.max(0, Math.min(pageW, x));
      const drawY = Math.max(minY, Math.min(maxY, y));
      const drawW = Math.max(1, Math.min(w, pageW - drawX));
      const drawH = Math.max(1, Math.min(h, maxY - drawY));
      pdfPage.drawImage(signatureImage, { x: drawX, y: drawY, width: drawW, height: drawH });
    };

    const detectSignaturePlaceholdersInElement = (params: {
      scopeEl: HTMLElement;
      documentId: string;
      pageNumber: number;
      signerOrder: number;
    }): SignatureField[] => {
      const { scopeEl, documentId, pageNumber, signerOrder } = params;
      const detectedFields: SignatureField[] = [];

      const baseRect = scopeEl.getBoundingClientRect();
      const placeholderRegex = /\[\[\s*assinatura(?:_(\d+))?\s*\]\]/gi;

      // Coletar todos os nós de texto em ordem e montar uma string contínua.
      // Isso permite detectar placeholders mesmo quando o docx-preview divide em vários "runs".
      const textNodes: Text[] = [];
      const nodeStarts: number[] = [];
      let fullText = '';

      const walker = document.createTreeWalker(scopeEl, NodeFilter.SHOW_TEXT, null);
      let n: Text | null;
      while ((n = walker.nextNode() as Text | null)) {
        textNodes.push(n);
        nodeStarts.push(fullText.length);
        fullText += n.textContent || '';
      }

      const findNodeAt = (absoluteIndex: number) => {
        for (let i = textNodes.length - 1; i >= 0; i--) {
          const start = nodeStarts[i];
          const len = (textNodes[i].textContent || '').length;
          if (absoluteIndex >= start && absoluteIndex <= start + len) {
            return { node: textNodes[i], offset: Math.max(0, Math.min(len, absoluteIndex - start)) };
          }
        }
        return null;
      };

      const maskTextRange = (startAbs: number, endAbs: number) => {
        for (let i = 0; i < textNodes.length; i++) {
          const node = textNodes[i];
          const start = nodeStarts[i];
          const text = node.textContent || '';
          const end = start + text.length;
          const overlapStart = Math.max(startAbs, start);
          const overlapEnd = Math.min(endAbs, end);
          if (overlapEnd <= overlapStart) continue;
          const localStart = overlapStart - start;
          const localEnd = overlapEnd - start;
          const replacement = '\u00A0'.repeat(Math.max(0, localEnd - localStart));
          node.textContent = text.slice(0, localStart) + replacement + text.slice(localEnd);
        }
      };

      placeholderRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = placeholderRegex.exec(fullText)) !== null) {
        const rawIdx = match[1];
        const idx = rawIdx ? parseInt(rawIdx, 10) : 1;
        if (Number.isNaN(idx)) continue;
        if (idx !== signerOrder) continue;

        const startAbs = match.index;
        const endAbs = match.index + match[0].length;

        const startLoc = findNodeAt(startAbs);
        const endLoc = findNodeAt(endAbs);
        if (!startLoc || !endLoc) continue;

        // Calcular o retângulo do placeholder pela seleção exata
        let rect: DOMRect | null = null;
        try {
          const range = document.createRange();
          range.setStart(startLoc.node, startLoc.offset);
          range.setEnd(endLoc.node, endLoc.offset);
          rect = range.getBoundingClientRect();
          range.detach?.();
        } catch {
          rect = null;
        }

        // Ocultar placeholder no render (para não aparecer atrás da assinatura)
        try {
          maskTextRange(startAbs, endAbs);
        } catch {
          // ignore
        }

        const elementRect = rect ?? (startLoc.node.parentElement?.getBoundingClientRect() ?? baseRect);
        if (!elementRect || baseRect.width <= 0 || baseRect.height <= 0) continue;

        const xPercent = ((elementRect.left - baseRect.left) / baseRect.width) * 100;
        const yPercent = ((elementRect.top - baseRect.top) / baseRect.height) * 100;
        const wPercent = (elementRect.width / baseRect.width) * 100;
        const hPercent = (elementRect.height / baseRect.height) * 100;

        console.log(`[PDF] Placeholder [[ASSINATURA${idx > 1 ? `_${idx}` : ''}]] encontrado em ${documentId} (página ${pageNumber})`, {
          x: xPercent.toFixed(2),
          y: yPercent.toFixed(2),
          w: wPercent.toFixed(2),
          h: hPercent.toFixed(2),
        });

        placeholderDetectedByDocument[documentId] = true;

        detectedFields.push({
          id: `auto-${documentId}-${idx}-${pageNumber}`,
          signature_request_id: request.id,
          document_id: documentId,
          signer_id: signer.id,
          field_type: 'signature',
          page_number: pageNumber,
          x_percent: Math.max(0, Math.min(100, xPercent)),
          y_percent: Math.max(0, Math.min(100, yPercent)),
          w_percent: Math.max(8, Math.min(40, wPercent > 0 ? wPercent : 18)),
          h_percent: Math.max(4, Math.min(20, hPercent > 0 ? hPercent : 7)),
          required: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      return detectedFields;
    };

    const pagesWithFooterCard = new Set<number>();

    const convertDocxContainer = async (params: {
      container: HTMLElement;
      documentId: string;
    }) => {
      const { container, documentId } = params;
      console.log('[PDF] convertDocxContainer chamado para:', documentId);
      
      const docxWrapper = container.querySelector('.docx-wrapper') || container;
      const sections = Array.from(docxWrapper.querySelectorAll('section, article, .docx')) as HTMLElement[];
      console.log('[PDF] Sections encontradas:', sections.length, 'para', documentId);

      const pages = sections.length > 0 ? sections : ([docxWrapper as HTMLElement] as HTMLElement[]);
      console.log('[PDF] Páginas a processar:', pages.length, 'para', documentId);
      const pagesBeforeConvert = pdfDoc.getPageCount();

      for (let sectionIdx = 0; sectionIdx < pages.length; sectionIdx++) {
        const section = pages[sectionIdx];
        const originalStyles = {
          boxShadow: section.style.boxShadow,
        };

        // Remover sombra (visual) para não "sujar" o PDF.
        section.style.boxShadow = 'none';

        // Forçar largura A4 para garantir renderização consistente em mobile.
        // Em dispositivos com viewport estreita (< 794px) o texto refluiria de forma
        // diferente do A4, gerando seções mais altas e corte de conteúdo.
        const savedWidth      = section.style.width;
        const savedMinWidth   = section.style.minWidth;
        const savedMaxWidth   = section.style.maxWidth;
        const savedOverflow   = section.style.overflow;
        section.style.width    = `${A4_WIDTH_PX}px`;
        section.style.minWidth = `${A4_WIDTH_PX}px`;
        section.style.maxWidth = `${A4_WIDTH_PX}px`;
        section.style.overflow = 'hidden';

        // Dois frames de reflow para garantir que o layout re-calculou
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

        try {
          // Detectar placeholders ANTES do html2canvas (e ocultar o texto)
          const hasFieldsForThisDocPage = fields.some((f: any) =>
            (f.document_id || 'main') === documentId && Math.max(1, (f.page_number ?? 1)) === (sectionIdx + 1)
          );

          if (!hasFieldsForThisDocPage) {
            const signerOrder = (signer as any)?.order ?? 1;
            const detected = detectSignaturePlaceholdersInElement({
              scopeEl: section,
              documentId,
              pageNumber: sectionIdx + 1,
              signerOrder,
            });

            if (detected.length > 0) {
              console.log('[PDF] Campos detectados automaticamente (placeholders):', detected.length);
              fields.push(...detected);
            }
          }

          const canvas = await html2canvas(section, {
            scale: 1.5,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            imageTimeout: 0,
            windowWidth: A4_WIDTH_PX,   // forçar viewport A4 no cálculo de CSS
          });

          // ── ESCALA ─────────────────────────────────────────────────────────
          // Com breakPages: false, o docx-preview renderiza o documento inteiro
          // como um bloco contínuo (um único canvas alto). Usamos escala por
          // largura e fatiamos em páginas A4 — nunca há duplicação porque não
          // existem seções sobrepostas.
          const scalePtPerPx   = contentWidthPt / canvas.width;
          const drawWPt        = contentWidthPt;
          const scaledHeightPt = canvas.height * scalePtPerPx;

          const isSingleSection = pages.length === 1;

          const drawOnePage = async (sliceCanvas: HTMLCanvasElement, pageNumberForFields: number, sliceStartPt?: number, fullScaledHeightPt?: number) => {
            const sliceHeightPt = sliceCanvas.height * scalePtPerPx;
            const drawHPt = sliceHeightPt;
            const drawX = CONTENT_MARGIN_X;
            const drawY = contentBottomY + (contentHeightPt - drawHPt);

            const imgBytes = await this.canvasToPngBytes(sliceCanvas);
            const image = await pdfDoc.embedPng(imgBytes);
            const pdfPage = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
            pdfPage.drawImage(image, { x: drawX, y: drawY, width: drawWPt, height: drawHPt });

            pagesWithFooterCard.add(pdfDoc.getPageCount() - 1);

            this.drawFooterStamp({
              page: pdfPage,
              pageWidth: pdfPageWidth,
              pageHeight: pdfPageHeight,
              signer,
              verificationUrl,
              qrImage: qrImageForFooter,
              helvetica,
              helveticaBold,
              docHash: '',
              integritySha256,
              variant: 'strip',
              opaqueStrip: true, // espaço reservado → fundo branco puro
            });

            for (const asset of docxSignerDrawAssets) {
              if (!asset.signature) continue;
              const docFields = fields.filter((f: any) =>
                f.field_type === 'signature' &&
                (f.signer_id === asset.signer.id || (!f.signer_id && docxSignerDrawAssets.length === 1)) &&
                (f.document_id || 'main') === documentId
              );

              for (const field of docFields as any[]) {
                const fieldX = drawX + (field.x_percent / 100) * drawWPt;
                const fieldW = (field.w_percent / 100) * drawWPt;

                if (typeof sliceStartPt === 'number' && typeof fullScaledHeightPt === 'number') {
                  const fieldYTopFull = (field.y_percent / 100) * fullScaledHeightPt;
                  const fieldHFull = (field.h_percent / 100) * fullScaledHeightPt;
                  const isAuto = typeof field.id === 'string' && field.id.startsWith('auto-');
                  const manualSlicePage = Math.max(1, (field.page_number ?? 1));
                  if (!isAuto && manualSlicePage !== pageNumberForFields) continue;

                  const sliceEndPt = sliceStartPt + drawHPt;
                  if (fieldYTopFull + fieldHFull < sliceStartPt || fieldYTopFull > sliceEndPt) continue;

                  const yInSlice = fieldYTopFull - sliceStartPt;
                  const y = drawY + (drawHPt - yInSlice - fieldHFull) + (isAuto ? PLACEHOLDER_Y_OFFSET_PT : 0);

                  drawSignatureField({
                    pdfPage,
                    pageW: pdfPageWidth,
                    pageH: pdfPageHeight,
                    x: fieldX,
                    y,
                    w: fieldW,
                    h: fieldHFull,
                    minY: contentBottomY,
                    maxY: contentTopY,
                    signatureImage: asset.signature,
                  });
                } else {
                  if (Math.max(1, (field.page_number ?? 1)) !== pageNumberForFields) continue;
                  const fieldYTop = (field.y_percent / 100) * drawHPt;
                  const fieldH = (field.h_percent / 100) * drawHPt;
                  const isAuto = typeof field.id === 'string' && field.id.startsWith('auto-');
                  const y = drawY + (drawHPt - fieldYTop - fieldH) + (isAuto ? PLACEHOLDER_Y_OFFSET_PT : 0);

                  drawSignatureField({
                    pdfPage,
                    pageW: pdfPageWidth,
                    pageH: pdfPageHeight,
                    x: fieldX,
                    y,
                    w: fieldW,
                    h: fieldH,
                    minY: contentBottomY,
                    maxY: contentTopY,
                    signatureImage: asset.signature,
                  });
                }
              }
            }
          };

          // Se a section cabe em 1 página A4 (área útil), desenhar como antes.
          if (scaledHeightPt <= contentHeightPt) {
            const fullCanvas = canvas;
            await drawOnePage(fullCanvas, sectionIdx + 1);
            continue;
          }

          // Caso contrário: fatiar verticalmente.
          // IMPORTANTE: se o docx-preview entregou apenas 1 section grande,
          // tratamos page_number como páginas A4 fatiadas (page 1,2,3...).
          const sliceHeightPx = Math.floor(contentHeightPt / scalePtPerPx);
          const totalSlices = Math.max(1, Math.ceil(canvas.height / sliceHeightPx));

          for (let sliceIdx = 0; sliceIdx < totalSlices; sliceIdx++) {
            const yPx = sliceIdx * sliceHeightPx;
            const hPx = Math.min(sliceHeightPx, canvas.height - yPx);
            if (hPx <= 0) continue;

            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = hPx;
            const ctx = sliceCanvas.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(canvas, 0, yPx, canvas.width, hPx, 0, 0, canvas.width, hPx);

            const pageNumberForFields = isSingleSection ? (sliceIdx + 1) : (sectionIdx + 1);
            const sliceStartPt = sliceIdx * contentHeightPt;
            await drawOnePage(sliceCanvas, pageNumberForFields, sliceStartPt, scaledHeightPt);
          }
        } finally {
          // Restaurar estilos originais da section
          section.style.boxShadow = originalStyles.boxShadow;
          section.style.width     = savedWidth;
          section.style.minWidth  = savedMinWidth;
          section.style.maxWidth  = savedMaxWidth;
          section.style.overflow  = savedOverflow;
        }
      }
    };

    // Encontrar as páginas do DOCX
    // O docx-preview pode gerar páginas como <section> ou <article> dependendo do documento.
    await convertDocxContainer({ container: docxContainer, documentId: 'main' });
    
    // Fallback: só adicionar assinatura automática se realmente não houver campos para o documento principal
    const hasMainSignatureField = fields.some((f: any) =>
      f.field_type === 'signature' &&
      (f.signer_id == null || f.signer_id === signer.id) &&
      ((f.document_id || 'main') === 'main')
    );

    if (signatureImage && !hasMainSignatureField && !placeholderDetectedByDocument['main']) {
      console.log('[PDF] Nenhum campo marcado - adicionando assinatura na última página');
      const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
      if (lastPage) {
        const { width } = lastPage.getSize();
        // Desenhar assinatura no canto inferior direito
        const sigW = 150;
        const sigH = 50;
        const sigX = width - sigW - 50;
        const sigY = FOOTER_RESERVED_H + 20;
        lastPage.drawImage(signatureImage, { x: sigX, y: sigY, width: sigW, height: sigH });
        
        // Adicionar linha e texto de assinatura
        lastPage.drawLine({
          start: { x: sigX - 20, y: sigY - 5 },
          end: { x: sigX + sigW + 20, y: sigY - 5 },
          thickness: 1,
          color: rgb(0.3, 0.3, 0.3),
        });
        lastPage.drawText(signer.name, {
          x: sigX,
          y: sigY - 20,
          size: 10,
          font: helvetica,
          color: rgb(0.2, 0.2, 0.2),
        });
      }
    }
    
    if (Array.isArray(attachmentDocxItems) && attachmentDocxItems.length > 0) {
      console.log('[PDF] Processando anexos DOCX:', attachmentDocxItems.map(i => i.documentId));
      for (const item of attachmentDocxItems) {
        console.log('[PDF] Convertendo anexo DOCX:', item.documentId);
        console.log('[PDF] Container do anexo:', item.container ? 'OK' : 'NULL');
        console.log('[PDF] Container innerHTML length:', item.container?.innerHTML?.length || 0);
        
        const pagesBeforeAttachment = pdfDoc.getPageCount();
        await convertDocxContainer({ container: item.container, documentId: item.documentId });
        const pagesAfterAttachment = pdfDoc.getPageCount();
        console.log('[PDF] Páginas adicionadas pelo anexo', item.documentId, ':', pagesAfterAttachment - pagesBeforeAttachment);

        // Recalcular campos após a conversão (placeholders podem ter sido detectados durante o convert)
        const attachmentFieldsAfter = fields.filter((f: any) =>
          f.field_type === 'signature' &&
          (f.signer_id == null || f.signer_id === signer.id) &&
          f.document_id === item.documentId
        );
        console.log('[PDF] Campos para anexo', item.documentId, ':', attachmentFieldsAfter.length);
        
        // Se não há campos marcados para este anexo, adicionar assinatura na última página do anexo
        if (
          ENABLE_ATTACHMENT_FALLBACK_SIGNATURE &&
          signatureImage &&
          attachmentFieldsAfter.length === 0 &&
          !placeholderDetectedByDocument[item.documentId] &&
          pagesAfterAttachment > pagesBeforeAttachment
        ) {
          console.log('[PDF] Nenhum campo marcado para anexo', item.documentId, '- adicionando assinatura automática');
          const lastPage = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
          if (lastPage) {
            const { width } = lastPage.getSize();
            const sigW = 150;
            const sigH = 50;
            const sigX = width - sigW - 50;
            const sigY = FOOTER_RESERVED_H + 20;
            lastPage.drawImage(signatureImage, { x: sigX, y: sigY, width: sigW, height: sigH });
            
            lastPage.drawLine({
              start: { x: sigX - 20, y: sigY - 5 },
              end: { x: sigX + sigW + 20, y: sigY - 5 },
              thickness: 1,
              color: rgb(0.3, 0.3, 0.3),
            });
            lastPage.drawText(signer.name, {
              x: sigX,
              y: sigY - 20,
              size: 10,
              font: helvetica,
              color: rgb(0.2, 0.2, 0.2),
            });
          }
        } else if (
          ENABLE_ATTACHMENT_FALLBACK_SIGNATURE &&
          signatureImage &&
          attachmentFieldsAfter.length === 0 &&
          !placeholderDetectedByDocument[item.documentId] &&
          pagesAfterAttachment === pagesBeforeAttachment
        ) {
          console.warn('[PDF] AVISO: Anexo', item.documentId, 'não gerou páginas!');
        }
      }
    }

    if (Array.isArray(attachmentPdfItems) && attachmentPdfItems.length > 0) {
      const documentOffsets: Record<string, number> = {};
      let nextOffset = pdfDoc.getPageCount();
      for (const item of attachmentPdfItems) {
        try {
          const attachRes = await fetch(item.url);
          if (!attachRes.ok) continue;
          const attachBytes = new Uint8Array(await attachRes.arrayBuffer());
          const attachDoc = await PDFDocument.load(attachBytes);
          documentOffsets[item.documentId] = nextOffset;
          const attachPages = await pdfDoc.copyPages(attachDoc, attachDoc.getPageIndices());
          for (const p of attachPages) pdfDoc.addPage(p);
          nextOffset += attachDoc.getPageCount();
        } catch (e) {
          console.warn('[PDF] Erro ao adicionar anexo PDF:', item.url, e);
        }
      }

      const { data: attachmentRequestSignersData } = await supabase
        .from('signature_signers')
        .select('*')
        .eq('signature_request_id', request.id)
        .order('order', { ascending: true });
      const attachmentSignedRequestSigners = ((attachmentRequestSignersData as Signer[] | null) ?? []).filter((item) => item.status === 'signed');
      const attachmentSignerDrawAssets = await Promise.all((attachmentSignedRequestSigners.length > 0 ? attachmentSignedRequestSigners : [signer]).map(async (item) => ({
        signer: item,
        signature: item.id === signer.id ? signatureImage : await this.loadStorageImage(pdfDoc, item.signature_image_path, true),
      })));

      for (const asset of attachmentSignerDrawAssets) {
        if (!asset.signature) continue;
        const signatureFields = fields.filter((f: any) =>
          f.field_type === 'signature' &&
          (f.signer_id === asset.signer.id || (!f.signer_id && attachmentSignerDrawAssets.length === 1)) &&
          (f.document_id || 'main') in documentOffsets
        );

        for (const f of signatureFields as any[]) {
          const offset = documentOffsets[f.document_id || 'main'] ?? 0;
          const pageIndex = Math.max(0, offset + Math.max(1, (f.page_number ?? 1)) - 1);
          const page = pdfDoc.getPages()[pageIndex];
          if (!page) continue;
          const { width, height } = page.getSize();
          const rect = this.percentToPdfRect(width, height, f);
          drawSignatureField({
            pdfPage: page,
            pageW: width,
            pageH: height,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            minY: 0,
            maxY: height,
            signatureImage: asset.signature,
          });
        }
      }
    }

    let facialImage: EmbeddedImage | null = null;
    if (signer.facial_image_path) {
      facialImage = await this.loadStorageImage(pdfDoc, signer.facial_image_path);
    }

    const qrImage: EmbeddedImage | null = qrImageForFooter;

    // Adicionar páginas do relatório
    await this.addReportPages({
      pdfDoc,
      request,
      signer,
      creator,
      signatureImage,
      facialImage,
      qrImage,
      verificationUrl,
    });

    const allPages = pdfDoc.getPages();
    for (let i = 0; i < allPages.length; i++) {
      if (pagesWithFooterCard.has(i)) continue;
      const p = allPages[i];
      const { width: w, height: h } = p.getSize();
      this.drawFooterStamp({
        page: p,
        pageWidth: w,
        pageHeight: h,
        signer,
        verificationUrl,
        qrImage: qrImageForFooter,
        helvetica,
        helveticaBold,
        docHash: '',
        integritySha256,
        variant: 'strip',
      });
    }

    const pdfBytes = await pdfDoc.save();
    const sha256 = await this.sha256Hex(pdfBytes);
    
    // @ts-ignore - Uint8Array Ã© aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName = `signed_${signer.id}_${Date.now()}.pdf`;
    const filePath = `${request.id}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('assinados')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        upsert: true,
      });
    
    if (error) {
      console.error('[PDF] Erro ao salvar PDF do DOCX:', error);
      throw new Error(`Erro ao salvar PDF do DOCX: ${error.message}`);
    }
    
    console.log('[PDF] PDF do DOCX salvo no bucket assinados:', filePath);
    return { filePath, sha256 };
  }

  /**
   * Gera e salva apenas o relatÃ³rio de assinatura (fallback quando nÃ£o conseguimos capturar o DOCX)
   */
  async saveSignatureReportToStorage(options: {
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string; email: string } | null;
  }): Promise<{ filePath: string; sha256: string }> {
    const { request, signer, creator } = options;
    
    // Criar PDF apenas com o relatÃ³rio de assinatura
    const pdfDoc = await PDFDocument.create();
    
    // Carregar imagens
    let signatureImage: EmbeddedImage | null = null;
    let facialImage: EmbeddedImage | null = null;
    
    if (signer.signature_image_path) {
      signatureImage = await this.loadStorageImage(pdfDoc, signer.signature_image_path);
    }
    if (signer.facial_image_path) {
      facialImage = await this.loadStorageImage(pdfDoc, signer.facial_image_path);
    }
    
    // Gerar QR code
    const verificationUrl = signer.verification_hash
      ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
      : null;

    let qrImage: EmbeddedImage | null = null;
    if (verificationUrl) {
      try {
        const qrDataUrl = await QRCode.toDataURL(verificationUrl, { width: 150, margin: 1 });
        const base64 = qrDataUrl.split(',')[1];
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        qrImage = await pdfDoc.embedPng(bytes);
      } catch (e) {
        console.warn('[PDF] Erro ao gerar QR code:', e);
      }
    }
    
    // Adicionar pÃ¡ginas do relatÃ³rio
    await this.addReportPages({
      pdfDoc,
      request,
      signer,
      creator,
      signatureImage,
      facialImage,
      qrImage,
      verificationUrl,
    });
    
    const pdfBytes = await pdfDoc.save();
    const sha256 = await this.sha256Hex(pdfBytes);
    
    // @ts-ignore - Uint8Array Ã© aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName = `report_${signer.id}_${Date.now()}.pdf`;
    const filePath = `${request.id}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('assinados')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        upsert: true,
      });
    
    if (error) {
      console.error('[PDF] Erro ao salvar relatÃ³rio de assinatura:', error);
      throw new Error(`Erro ao salvar relatÃ³rio de assinatura: ${error.message}`);
    }
    
    console.log('[PDF] RelatÃ³rio de assinatura salvo no bucket assinados:', filePath);
    return { filePath, sha256 };
  }

  /**
   * ObtÃ©m URL assinada do PDF assinado do bucket 'assinados'
   */
  async getSignedPdfUrl(signedDocumentPath: string): Promise<string | null> {
    if (!signedDocumentPath) return null;
    
    const { data, error } = await supabase.storage
      .from('assinados')
      .createSignedUrl(signedDocumentPath, 3600); // 1 hora
    
    if (error || !data?.signedUrl) {
      console.warn('[PDF] Erro ao obter URL do PDF assinado:', error?.message);
      return null;
    }
    
    return data.signedUrl;
  }

  async mergePdfUrls(urls: string[]): Promise<Uint8Array> {
    const validUrls = urls.filter(Boolean);
    if (validUrls.length === 0) throw new Error('Nenhum PDF para compilar');

    const merged = await PDFDocument.create();

    for (const url of validUrls) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Erro ao baixar PDF para compilaÃ§Ã£o (HTTP ${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      for (const p of pages) merged.addPage(p);
    }

    return await merged.save();
  }
}

export const pdfSignatureService = new PdfSignatureService();
