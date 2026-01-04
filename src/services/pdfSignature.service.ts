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
          console.log(`[PDF] URL assinada obtida do bucket ${bucket}:`, data.signedUrl);
          signedUrl = data.signedUrl;
          break;
        }
        console.log(`[PDF] Bucket ${bucket}: nÃ£o encontrado ou erro:`, error?.message);
      } catch (e) {
        console.log(`[PDF] Bucket ${bucket}: exceÃ§Ã£o:`, e);
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
  }) {
    const { page, pageWidth, pageHeight, signer, verificationUrl, qrImage, helvetica, helveticaBold, docHash, integritySha256, variant } = params;

    void pageHeight;
    void docHash;

    const mode: 'card' | 'strip' = variant ?? 'strip';
    const integrityFull = this.formatIntegrityHash(integritySha256, false);

    const versionLabel = `Jurius v${__APP_VERSION__}`;

    if (mode === 'strip') {
      const h = 32;
      const x = 24;
      const y = 10;
      const w = pageWidth - 48;

      page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.98, 0.99, 1), borderColor: rgb(0.85, 0.88, 0.95), borderWidth: 1 });
      page.drawText(`Hash SHA-256: ${integrityFull}`, { x: x + 10, y: y + 21, size: 5.5, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
      if (signer.verification_hash) {
        page.drawText(`Código: ${(signer.verification_hash || '').toUpperCase()}`, { x: x + 10, y: y + 13, size: 6, font: helveticaBold, color: rgb(0.15, 0.25, 0.25) });
      }

      if (verificationUrl) {
        const urlToDraw = verificationUrl.length > 80 ? `${verificationUrl.slice(0, 77)}...` : verificationUrl;
        page.drawText(`Verificar: ${urlToDraw}`, { x: x + 10, y: y + 5, size: 5.2, font: helvetica, color: rgb(0.12, 0.35, 0.7) });
      }

      const versionSize = 6;
      const versionTextWidth = typeof helveticaBold?.widthOfTextAtSize === 'function'
        ? helveticaBold.widthOfTextAtSize(versionLabel, versionSize)
        : 70;
      page.drawText(versionLabel, {
        x: x + w - versionTextWidth - 10,
        y: y + 13,
        size: versionSize,
        font: helveticaBold,
        color: rgb(0.15, 0.25, 0.25),
      });
      return;
    }

    const boxH = 80;
    const boxX = 24;
    const boxY = 10;
    const boxW = pageWidth - 48;

    // Card
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      color: rgb(0.98, 0.99, 1),
      borderColor: rgb(0.2, 0.45, 0.9),
      borderWidth: 1,
    });

    // Accent line
    page.drawRectangle({
      x: boxX,
      y: boxY + boxH - 3,
      width: boxW,
      height: 3,
      color: rgb(0.2, 0.45, 0.9),
    });

    const qrSize = 58;
    const qrX = boxX + boxW - qrSize - 8;
    const qrY = boxY + (boxH - qrSize) / 2 - 1;
    if (qrImage) {
      page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    }

    const textX = boxX + 10;
    const textMaxW = qrX - textX - 8;
    void textMaxW;

    const title = 'Escaneie o QR Code para verificar a autenticidade do documento';
    page.drawText(title, { x: textX, y: boxY + boxH - 14, size: 8, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });

    const versionSize = 5.5;
    const versionTextWidth = typeof helveticaBold?.widthOfTextAtSize === 'function'
      ? helveticaBold.widthOfTextAtSize(versionLabel, versionSize)
      : 70;
    page.drawText(versionLabel, {
      x: boxX + boxW - versionTextWidth - 10,
      y: boxY + boxH - 14,
      size: versionSize,
      font: helveticaBold,
      color: rgb(0.12, 0.12, 0.12),
    });

    const codeLabel = 'Código de autenticação:';
    const code = (signer.verification_hash || '').toUpperCase() || 'N/A';
    page.drawText(codeLabel, { x: textX, y: boxY + boxH - 28, size: 7, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(code, { x: textX + 88, y: boxY + boxH - 28, size: 7, font: helveticaBold, color: rgb(0.15, 0.25, 0.25) });

    page.drawText(`Hash SHA-256: ${integrityFull}`, { x: textX, y: boxY + boxH - 42, size: 5.2, font: helvetica, color: rgb(0.35, 0.35, 0.35) });

    if (verificationUrl) {
      const urlToDraw = verificationUrl.length > 85 ? `${verificationUrl.slice(0, 82)}...` : verificationUrl;
      page.drawText(urlToDraw, { x: textX, y: boxY + 6, size: 5.5, font: helvetica, color: rgb(0.12, 0.35, 0.7) });
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

    const geo = this.parseGeolocation(signer.signer_geolocation);
    const ua = this.parseUserAgent(signer.signer_user_agent);
    const signedAt = signer.signed_at ? new Date(signer.signed_at) : new Date();
    const signedAtStr = signedAt.toLocaleString('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const now = new Date();
    const nowStr = now.toLocaleString('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // ==================== PÁGINA 1 - Relatório de Assinaturas ====================
    const page1 = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page1.getSize();
    const lm = 50;

    // Header com logo e data
    page1.drawText('Juris CRM', { x: lm, y: height - 45, size: 20, font: helveticaBold, color: rgb(0.2, 0.4, 0.8) });
    page1.drawText('Relatorio de Assinaturas', { x: lm + 95, y: height - 45, size: 14, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    
    // Data e timezone no canto direito
    page1.drawText('Datas e horarios em UTC-0400 (America/Manaus)', { x: width - lm - 200, y: height - 30, size: 7, font: helvetica, color: rgb(0.5, 0.5, 0.5) });
    page1.drawText(`Ultima atualizacao em ${nowStr}`, { x: width - lm - 200, y: height - 42, size: 7, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

    // Linha separadora
    page1.drawLine({ start: { x: lm, y: height - 60 }, end: { x: width - lm, y: height - 60 }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });

    // Nome do documento
    page1.drawText(request.document_name.toUpperCase(), { x: lm, y: height - 90, size: 16, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
    page1.drawText(`Documento numero ${request.id}`, { x: lm, y: height - 108, size: 8, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

    // QR Code grande no canto direito do header
    if (qrImage) {
      page1.drawImage(qrImage, { x: width - lm - 90, y: height - 130, width: 85, height: 85 });
    }

    // Linha separadora
    page1.drawLine({ start: { x: lm, y: height - 145 }, end: { x: width - lm, y: height - 145 }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });

    // Seção Assinaturas
    page1.drawText('Assinaturas', { x: lm, y: height - 175, size: 16, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });

    // Card do signatário com ícone verde
    let cardY = height - 210;
    
    // Ícone de check verde (círculo)
    page1.drawCircle({ x: lm + 12, y: cardY + 5, size: 10, color: rgb(0.2, 0.7, 0.3) });
    page1.drawText('v', { x: lm + 8, y: cardY + 1, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
    
    // Nome e status
    page1.drawText(signer.name.toUpperCase(), { x: lm + 30, y: cardY + 8, size: 11, font: helveticaBold, color: rgb(0.2, 0.7, 0.3) });
    page1.drawText('Assinou', { x: lm + 30, y: cardY - 6, size: 9, font: helvetica, color: rgb(0.2, 0.7, 0.3) });

    // Coluna esquerda - Informações
    let infoY = cardY - 35;
    const infoX = lm;
    
    // Pontos de autenticação
    page1.drawText('Pontos de autenticação:', { x: infoX, y: infoY, size: 8, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    infoY -= 14;
    
    // Lista de pontos de autenticação com bullets
    const authPoints: string[] = ['Assinatura manuscrita digital'];
    
    // Método de autenticação
    if (signer.auth_provider === 'google') {
      authPoints.push(`Autenticação via Google (${signer.auth_email || 'não informado'})`);
      if (signer.auth_google_sub) authPoints.push(`Google ID: ${signer.auth_google_sub}`);
    } else if (signer.auth_provider === 'email_link') {
      authPoints.push(`Autenticação via Link por E-mail (${signer.auth_email || 'não informado'})`);
    } else if (signer.auth_provider === 'phone') {
      authPoints.push(`Autenticação via Telefone (${signer.phone || 'verificado'})`);
    }
    
    if (signer.signer_ip) authPoints.push(`Endereço IP: ${signer.signer_ip}`);
    if (geo.coordinates) authPoints.push(`Geolocalização: ${geo.coordinates}`);
    if (signer.facial_image_path) authPoints.push('Verificação facial (selfie)');
    if (ua.device) authPoints.push(`Dispositivo: ${ua.device} - ${ua.browser || 'Navegador'} - ${ua.os || 'Sistema'}`);
    
    for (const point of authPoints) {
      // Evitar caractere bullet ("•") por incompatibilidade de encoding/fonte (pode virar "â€¢" no PDF).
      // Desenhar bullet como um pequeno círculo.
      page1.drawCircle({ x: infoX + 7, y: infoY + 2.5, size: 1.2, color: rgb(0.35, 0.35, 0.35) });
      page1.drawText(point, { x: infoX + 12, y: infoY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
    }
    
    infoY -= 5;
    
    if (signer.signer_user_agent) {
      const uaText = signer.signer_user_agent.slice(0, 65);
      page1.drawText(`Dispositivo: ${uaText}`, { x: infoX, y: infoY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
      if (signer.signer_user_agent.length > 65) {
        page1.drawText(signer.signer_user_agent.slice(65, 130), { x: infoX, y: infoY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
        infoY -= 10;
      }
    }
    
    page1.drawText(`Data e hora: ${signedAtStr}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    infoY -= 10;
    
    if (signer.auth_email) {
      page1.drawText(`E-mail autenticado: ${signer.auth_email}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
    }
    
    if (signer.auth_provider === 'phone' && signer.phone) {
      page1.drawText(`Telefone autenticado: ${signer.phone}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
    }
    
    if (signer.public_token) {
      page1.drawText(`Token: ${signer.public_token}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
    }
    
    if (signer.facial_image_path) {
      page1.drawText('Foto do rosto (selfie) anexa.', { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    }

    // Coluna direita - Assinatura manuscrita grande
    const sigX = width - lm - 180;
    const sigY = cardY - 30;
    
    // Caixa da assinatura
    page1.drawRectangle({ x: sigX, y: sigY - 100, width: 175, height: 100, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
    
    if (signatureImage) {
      page1.drawImage(signatureImage, { x: sigX + 10, y: sigY - 90, width: 155, height: 80 });
    }
    
    // Label da assinatura
    page1.drawText(`Assinatura de ${signer.name.toUpperCase()}`, { x: sigX, y: sigY - 115, size: 7, font: helvetica, color: rgb(0.5, 0.5, 0.5) });

    // ==================== PÁGINA 2 - Foto Selfie Grande ====================
    const page2 = pdfDoc.addPage([595.28, 841.89]);

    // Título da foto
    page2.drawText(`Foto do rosto (selfie) de ${signer.name.toUpperCase()}:`, { x: lm, y: height - 50, size: 10, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    // Foto GRANDE com borda tracejada
    const photoW = 350;
    const photoH = 350;
    const photoX = lm;
    const photoY = height - 60 - photoH;

    // Borda tracejada (simulada com linhas)
    for (let i = 0; i < photoW; i += 8) {
      page2.drawLine({ start: { x: photoX + i, y: photoY + photoH }, end: { x: photoX + i + 4, y: photoY + photoH }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
      page2.drawLine({ start: { x: photoX + i, y: photoY }, end: { x: photoX + i + 4, y: photoY }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    }
    for (let i = 0; i < photoH; i += 8) {
      page2.drawLine({ start: { x: photoX, y: photoY + i }, end: { x: photoX, y: photoY + i + 4 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
      page2.drawLine({ start: { x: photoX + photoW, y: photoY + i }, end: { x: photoX + photoW, y: photoY + i + 4 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    }

    if (facialImage) {
      page2.drawImage(facialImage, { x: photoX + 5, y: photoY + 5, width: photoW - 10, height: photoH - 10 });
      
      // Marca d'água CONFIDENTIAL com data (cinza e mais transparente)
      const wmY = photoY + photoH / 2;
      page2.drawText('- - - - - - - - - - - - - - - - - - - - - - - -', { x: photoX + 40, y: wmY + 30, size: 10, font: helvetica, color: rgb(0.25, 0.25, 0.25), opacity: 0.42 });
      page2.drawText('C O N F I D E N T I A L', { x: photoX + 80, y: wmY + 10, size: 14, font: helveticaBold, color: rgb(0.25, 0.25, 0.25), opacity: 0.42 });
      page2.drawText(signedAtStr, { x: photoX + 115, y: wmY - 10, size: 9, font: helvetica, color: rgb(0.25, 0.25, 0.25), opacity: 0.42 });

      page2.drawRectangle({ x: photoX, y: photoY, width: photoW, height: photoH, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1, borderDashArray: [4, 4] });
    } else {
      page2.drawText('Selfie não coletada', { x: photoX + 100, y: photoY + photoH / 2, size: 14, font: helveticaBold, color: rgb(0.6, 0.6, 0.6) });
    }

    // Seção Fundamentação Legal e Validade
    let legalY = photoY - 30;
    
    // Título da seção
    page2.drawText('VALIDADE JURIDICA (MP 2.200-2/2001)', { x: lm, y: legalY, size: 11, font: helveticaBold, color: rgb(0.15, 0.4, 0.85) });
    legalY -= 18;

    page2.drawText('A Medida Provisoria n 2.200-2, de 27 de julho de 2001, dispoe sobre a validade', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('juridica dos documentos eletronicos no Brasil e institui a Infraestrutura de Chaves', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('Publicas Brasileira (ICP-Brasil), reconhecendo, igualmente, a utilizacao de outros', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('meios de comprovacao da autoria e da integridade de documentos em meio eletronico,', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('desde que admitidos pelas partes como validos.', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 14;

    page2.drawText('Trecho (MP 2.200-2/2001, Art. 2):', { x: lm, y: legalY, size: 8, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    legalY -= 12;
    page2.drawText('"Art. 2 O disposto nesta Medida Provisoria nao obsta a utilizacao de outro meio de', { x: lm, y: legalY, size: 6.6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    legalY -= 10;
    page2.drawText('comprovacao da autoria e integridade de documentos em forma eletronica, inclusive os', { x: lm, y: legalY, size: 6.6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    legalY -= 10;
    page2.drawText('que utilizem certificados nao emitidos pela ICP-Brasil, desde que admitido pelas', { x: lm, y: legalY, size: 6.6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    legalY -= 10;
    page2.drawText('partes como valido ou aceito pela pessoa a quem for oposto o documento"', { x: lm, y: legalY, size: 6.6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    legalY -= 14;

    page2.drawText('Dessa forma, a assinatura eletronica ou digital aposta neste documento possui plena', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('validade juridica, produzindo os mesmos efeitos legais de um documento assinado', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('fisicamente, desde que as partes reconhecam e aceitem sua validade, o que ocorre', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('mediante a manifestacao de vontade expressa ao realizar a assinatura eletronica.', { x: lm, y: legalY, size: 7.5, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    legalY -= 25;
    page2.drawLine({ start: { x: lm, y: legalY }, end: { x: width - lm, y: legalY }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    legalY -= 20;
    
    page2.drawText('CÓDIGO DE AUTENTICAÇÃO:', { x: lm, y: legalY, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    legalY -= 14;
    page2.drawText(signer.verification_hash || 'N/A', { x: lm, y: legalY, size: 12, font: helveticaBold, color: rgb(0.15, 0.2, 0.2) });

    legalY -= 22;
    page2.drawText('VERIFICAR AUTENTICIDADE:', { x: lm, y: legalY, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    legalY -= 14;
    if (verificationUrl) {
      page2.drawText(verificationUrl, { x: lm, y: legalY, size: 8, font: helvetica, color: rgb(0.2, 0.4, 0.7) });
    }

    // QR Code no canto direito
    if (qrImage) {
      page2.drawImage(qrImage, { x: width - lm - 100, y: legalY + 20, width: 90, height: 90 });
    }

    // Texto legal final
    legalY -= 30;
    page2.drawLine({ start: { x: lm, y: legalY }, end: { x: width - lm, y: legalY }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    legalY -= 18;
    
    page2.drawText(`Este registro e exclusivo e parte integrante do documento ID: ${request.id}`, { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    legalY -= 10;
    page2.drawText('A integridade deste documento pode ser verificada atraves do QR Code ou URL acima.', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    legalY -= 10;
    page2.drawText('Qualquer alteracao no documento invalida esta assinatura digital.', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.4, 0.4, 0.4) });

    // Banner no rodapÃ© em vez de logo
    legalY -= 25;
    
    // Desenhar banner azul
    const bannerHeight = 20;
    const bannerWidth = width - (lm * 2);
    
    page2.drawRectangle({
      x: lm,
      y: legalY,
      width: bannerWidth,
      height: bannerHeight,
      color: rgb(0.15, 0.4, 0.85),
    });
    
    // Texto "Documento Assinado Digitalmente" sobre o banner
    page2.drawText('DOCUMENTO ASSINADO DIGITALMENTE', { 
      x: lm + bannerWidth/2 - 100, 
      y: legalY + bannerHeight/2 - 5, 
      size: 12, 
      font: helveticaBold, 
      color: rgb(1, 1, 1) 
    });

    // ==================== PÁGINA 3 - Histórico ====================
    const page3 = pdfDoc.addPage([595.28, 841.89]);
    const { width: w3, height: h3 } = page3.getSize();

    page3.drawText('HISTÓRICO', { x: lm, y: h3 - 60, size: 14, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
    page3.drawLine({ start: { x: lm, y: h3 - 74 }, end: { x: w3 - lm, y: h3 - 74 }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });

    const geo2 = geo;
    const createdAtStr = request.created_at ? new Date(request.created_at).toLocaleString('pt-BR', { timeZone: 'America/Manaus' }) : nowStr;
    const viewedAtStr = signer.viewed_at ? new Date(signer.viewed_at).toLocaleString('pt-BR', { timeZone: 'America/Manaus' }) : null;
    const signedAtStr2 = signer.signed_at ? new Date(signer.signed_at).toLocaleString('pt-BR', { timeZone: 'America/Manaus' }) : signedAtStr;

    type HistoryItem = { label: string; when: string; detail: string };
    const history: HistoryItem[] = [];

    const creatorName = creator?.name || 'Sistema';
    const creatorEmail = creator?.email ? ` (Email: ${creator.email})` : '';
    history.push({ label: 'Criado', when: createdAtStr, detail: `${creatorName} criou este documento.${creatorEmail}` });

    const authEmail = String(signer.auth_email || '').trim();
    const phone = String((signer as any).phone || '').trim();
    const rawEmail = String(signer.email || '').trim();
    const displayContact =
      authEmail ||
      (signer.auth_provider === 'phone' ? phone : '') ||
      (!this.isInternalPlaceholderEmail(rawEmail) ? rawEmail : '');
    const displayContactLabel = authEmail
      ? 'Email'
      : signer.auth_provider === 'phone'
        ? 'Telefone'
        : 'Email';
    const signerContact = displayContact ? ` (${displayContactLabel}: ${displayContact})` : '';
    const signerCpf = (signer as any).cpf ? `, CPF: ${(signer as any).cpf}` : '';
    const locationInfo = geo2.coordinates ? ` localizado em ${geo2.coordinates}${geo2.address ? ` - ${geo2.address}` : ''}` : '';
    if (viewedAtStr) {
      history.push({
        label: 'Visualizado',
        when: viewedAtStr,
        detail: `${signer.name}${signerContact}${signerCpf} visualizou este documento${signer.signer_ip ? ` por meio do IP ${signer.signer_ip}` : ''}${locationInfo}`,
      });
    }

    const authSummary = (() => {
      if (signer.auth_provider === 'phone') {
        const digits = String((signer as any).phone || '').replace(/\D/g, '');
        return digits ? `Autenticação via Telefone (${digits})` : 'Autenticação via Telefone';
      }
      if (signer.auth_provider === 'email_link') {
        return signer.auth_email ? `Autenticação via Link por E-mail (${signer.auth_email})` : 'Autenticação via Link por E-mail';
      }
      if (signer.auth_provider === 'google') {
        return signer.auth_email ? `Autenticação via Google (${signer.auth_email})` : 'Autenticação via Google';
      }
      return '';
    })();

    history.push({
      label: 'Assinado',
      when: signedAtStr2,
      detail: `${signer.name}${signerContact}${signerCpf} assinou este documento${signer.signer_ip ? ` por meio do IP ${signer.signer_ip}` : ''}${locationInfo}${authSummary ? `. ${authSummary}` : ''}`,
    });

    let y = h3 - 105;
    const colDateW = 110;
    const lineGap = 14;
    for (const item of history) {
      page3.drawText(item.when, { x: lm, y, size: 8, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
      page3.drawText(item.label, { x: lm, y: y - 10, size: 7, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
      page3.drawText(item.detail, { x: lm + colDateW, y: y - 2, size: 8, font: helvetica, color: rgb(0.2, 0.2, 0.2), maxWidth: w3 - lm - (lm + colDateW) });
      y -= 40;
      if (y < 80) break;
      page3.drawLine({ start: { x: lm, y }, end: { x: w3 - lm, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
      y -= lineGap;
    }
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

    const signatureFields = fields.filter((f) => f.field_type === 'signature' && (!f.signer_id || f.signer_id === signer.id));

    console.log('[PDF] Campos encontrados:', fields.length, 'Campos de assinatura:', signatureFields.length);
    console.log('[PDF] Campos:', signatureFields);

    const pages = pdfDoc.getPages();

    // Place signature image where marked
    if (signatureImage && signatureFields.length > 0) {
      for (const f of signatureFields) {
        const docId = (f as any).document_id || 'main';
        const offset = documentOffsets[docId] ?? 0;
        const pageIndex = Math.max(0, offset + Math.max(1, (f.page_number ?? 1)) - 1);
        const page = pages[pageIndex];
        if (!page) continue;
        const { width, height } = page.getSize();
        const { x, y, w, h } = this.percentToPdfRect(width, height, f);

        // Escala 1.5x para melhor visibilidade
        const scale = 1.5;
        const desiredW = w * scale;
        const desiredH = h * scale;
        const drawX = Math.max(0, Math.min(width, x));
        const drawY = Math.max(0, Math.min(height, y));
        const drawW = Math.max(1, Math.min(desiredW, width - drawX));
        const drawH = Math.max(1, Math.min(desiredH, height - drawY));
        console.log('[PDF] Desenhando assinatura na pÃ¡gina', pageIndex + 1, '- PosiÃ§Ã£o:', { x, y, w, h }, '- PÃ¡gina:', { width, height });
        console.log('[PDF] Campo original:', { x_percent: f.x_percent, y_percent: f.y_percent, w_percent: f.w_percent, h_percent: f.h_percent });
        page.drawImage(signatureImage, { x: drawX, y: drawY, width: drawW, height: drawH });
      }
    } else if (signatureImage) {
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
    } else {
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
    const FOOTER_RESERVED_H = 100; // em pontos (pt) - deve ser >= boxY(10) + boxH(82)
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
      // Escala 1.5x para melhor visibilidade
      const scale = 1.5;
      const desiredW = w * scale;
      const desiredH = h * scale;
      const drawX = Math.max(0, Math.min(pageW, x));
      const drawY = Math.max(minY, Math.min(maxY, y));
      const drawW = Math.max(1, Math.min(desiredW, pageW - drawX));
      const drawH = Math.max(1, Math.min(desiredH, maxY - drawY));
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

        // Evitar reflow: nÃ£o forÃ§ar largura/margens aqui.
        // Apenas remover sombra (visual) para nÃ£o "sujar" o PDF.
        section.style.boxShadow = 'none';
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

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
          });

          // Regra: sempre encaixar pela LARGURA (com recuo lateral).
          // Se a altura ficar maior que a área de conteúdo, fatiar em múltiplas páginas.
          const scalePtPerPx = contentWidthPt / canvas.width;
          const scaledHeightPt = canvas.height * scalePtPerPx;
          const drawWPt = contentWidthPt;

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
              variant: 'card',
            });

            if (!signatureImage) return;

            const docFields = fields.filter((f: any) =>
              f.field_type === 'signature' &&
              (f.signer_id == null || f.signer_id === signer.id) &&
              (f.document_id || 'main') === documentId
            );

            for (const field of docFields as any[]) {
              const fieldX = drawX + (field.x_percent / 100) * drawWPt;
              const fieldW = (field.w_percent / 100) * drawWPt;

              // Se o DOCX foi fatiado (1 section) usamos coordenadas do documento inteiro
              if (typeof sliceStartPt === 'number' && typeof fullScaledHeightPt === 'number') {
                const fieldYTopFull = (field.y_percent / 100) * fullScaledHeightPt;
                const fieldHFull = (field.h_percent / 100) * fullScaledHeightPt;

                // Se for campo manual com page_number por fatia, respeitar
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
                  signatureImage,
                });
              } else {
                // Caso normal: page_number é a section
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
                  signatureImage,
                });
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
            await drawOnePage(sliceCanvas, pageNumberForFields, isSingleSection ? sliceStartPt : undefined, isSingleSection ? scaledHeightPt : undefined);
          }
        } finally {
          section.style.boxShadow = originalStyles.boxShadow;
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

      if (signatureImage) {
        const pages = pdfDoc.getPages();
        const signatureFields = fields.filter((f: any) =>
          f.field_type === 'signature' &&
          (f.signer_id == null || f.signer_id === signer.id) &&
          (f.document_id || 'main') in documentOffsets
        );

        for (const f of signatureFields as any[]) {
          const offset = documentOffsets[f.document_id || 'main'] ?? 0;
          const pageIndex = Math.max(0, offset + Math.max(1, (f.page_number ?? 1)) - 1);
          const page = pages[pageIndex];
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
            signatureImage,
          });
        }
      }
    }
    
    // Carregar imagem facial para o relatÃ³rio
    let facialImage: EmbeddedImage | null = null;
    if (signer.facial_image_path) {
      facialImage = await this.loadStorageImage(pdfDoc, signer.facial_image_path);
    }
    
    // Gerar QR code para relatÃ³rio (pode ser o mesmo do footer)
    let qrImage: EmbeddedImage | null = qrImageForFooter;
    if (!qrImage && typeof verificationUrl === 'string') {
      try {
        const qrDataUrl = await QRCode.toDataURL(verificationUrl, { width: 150, margin: 1 });
        const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), (c) => c.charCodeAt(0));
        qrImage = await pdfDoc.embedPng(qrBytes);
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
