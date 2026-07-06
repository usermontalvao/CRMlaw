import { PDFDocument, PDFPage, rgb, StandardFonts, LineCapStyle, PDFString } from 'pdf-lib';
import { getLogoBytes } from '../utils/logoBase64';
import { degrees } from 'pdf-lib';
import QRCode from 'qrcode';
import { BRAND_SERIF, BRAND_DOT, BRAND_WORDMARK } from '../constants/brand';
import html2canvas from 'html2canvas';
import { supabase } from '../config/supabase';
import { signatureFieldsService } from './signatureFields.service';
import { SYSTEM_ISSUER_LABEL } from './signature.service';
import { buildPublicSignatureTermsUrl } from '../utils/publicAppUrl';
import type { Signer, SignatureRequest, SignatureField } from '../types/signature.types';

/**
 * Escopo do modelo `per_document` (VERSIONADO): quando presente, a geração produz
 * o PDF assinado de UM ÚNICO arquivo do kit (principal OU um anexo) com identidade
 * de verificação PRÓPRIA — código, URL/QR e hash de integridade individuais. É o que
 * permite "1 PDF assinado por arquivo" sem tocar no caminho consolidado (legado):
 * quando `perDocument` é undefined, tudo funciona exatamente como antes.
 */
export interface PerDocumentScope {
  /** 'main' | 'attachment-<i>' — casa com signature_fields.document_id. */
  documentKey: string;
  /** Código de verificação próprio do documento (estampado no rodapé/QR). */
  verificationCode: string;
  /** URL pública de verificação com o código próprio (…/#/verificar/<code>). */
  verificationUrl: string;
  /** Paths/URLs do arquivo ORIGINAL para o hash de integridade individual. */
  integritySources?: string[];
  /**
   * Nome PRÓPRIO deste documento (display_name do arquivo em escopo) — usado no
   * cabeçalho do relatório. Sem isto, cada anexo herdaria o nome do envelope
   * (ex.: "KIT CONSUMIDOR …"). Ausente ⇒ cai no request.document_name.
   */
  documentName?: string;
}

interface SignedPdfOptions {
  request: SignatureRequest;
  signer: Signer;
  originalPdfUrl: string;
  creator?: { name: string } | null;
  attachmentPdfItems?: { documentId: string; url: string }[]; // anexos PDF para compilar
  /**
   * Campos de assinatura já resolvidos (fluxo público: vêm do bundle
   * token-scoped `get_public_signing_bundle`). Quando presente, evita a leitura
   * direta de `signature_fields`, que retorna 401 para o anon com o RLS fechado
   * e fazia a assinatura cair no fallback (posição padrão na última página).
   */
  fieldsOverride?: SignatureField[];
  /**
   * Modelo `per_document`: gera o PDF de UM arquivo com verificação própria.
   * Ausente ⇒ comportamento consolidado (legado) inalterado.
   */
  perDocument?: PerDocumentScope;
}

type EmbeddedImage = any;

/** Linha da trilha de auditoria usada na geração do relatório (interno e público). */
export type AuditLogRow = {
  id: string;
  signer_id: string | null;
  action: string;
  description: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

interface GeoInfo {
  coordinates?: string;
  address?: string;
}

class PdfSignatureService {
  private readonly storageBucketCache = new Map<string, string>();
  private wordmarkPngBytes: Uint8Array | null = null;
  private wordmarkPngRatio = 4;
  private readonly serifTextCache = new Map<string, { bytes: Uint8Array; ratio: number }>();

  /**
   * Resolver opcional para o fluxo PÚBLICO. Quando definido (ex.: pela
   * PublicSigningPage / PublicDocumentPage), as leituras de storage da geração
   * de PDF resolvem o path → URL assinada via edge token-scoped
   * (`public-signing-file`) em vez de acessar o bucket diretamente como `anon`.
   * Isso é o que permite fechar o acesso anon a `document-templates` /
   * `assinados` (migration 3) sem quebrar a assinatura pública. Mantém-se o
   * fallback direto enquanto o anon ainda estiver aberto.
   *
   * Singleton com try/finally nas páginas públicas: como as telas públicas são
   * rotas isoladas (uma geração por vez por aba), não há concorrência real.
   */
  private publicFileResolver: ((path: string) => Promise<string | null>) | null = null;

  /** Define (ou limpa, com null) o resolver token-scoped do fluxo público. */
  setPublicFileResolver(fn: ((path: string) => Promise<string | null>) | null): void {
    this.publicFileResolver = fn;
  }

  /**
   * Provider opcional para os DADOS do relatório no fluxo PÚBLICO. Quando
   * definido, as listagens de co-signatários e da trilha de auditoria usadas
   * para montar o certificado/relatório do PDF resolvem via RPC token-scoped
   * (`public_signing_request_signers` / `public_signing_audit_log`) em vez de
   * leitura anon direta nas tabelas (que retorna 401 com RLS fechado e fazia o
   * relatório cair em fallback incompleto: sem co-signatários e sem trilha).
   */
  private publicReportData: {
    signers?: (requestId: string) => Promise<Signer[] | null>;
    auditLog?: (requestId: string) => Promise<AuditLogRow[] | null>;
  } | null = null;

  /** Define (ou limpa, com null) o provider de dados token-scoped do relatório público. */
  setPublicReportDataProvider(
    provider: {
      signers?: (requestId: string) => Promise<Signer[] | null>;
      auditLog?: (requestId: string) => Promise<AuditLogRow[] | null>;
    } | null,
  ): void {
    this.publicReportData = provider;
  }

  /**
   * Resolver opcional de UPLOAD para o fluxo PÚBLICO. Quando definido, a
   * gravação do PDF assinado/relatório vai pela edge token-scoped
   * (`public-signing-upload`) em vez do INSERT anon direto em `assinados` —
   * o que permite remover o INSERT anon (migration 4) sem quebrar a assinatura.
   * Mantém-se o fallback direto enquanto o anon ainda estiver aberto.
   */
  private publicUploadResolver:
    | ((params: { path: string; bytes: Uint8Array; contentType: string }) => Promise<boolean>)
    | null = null;

  /** Define (ou limpa, com null) o resolver de upload token-scoped do fluxo público. */
  setPublicUploadResolver(
    fn: ((params: { path: string; bytes: Uint8Array; contentType: string }) => Promise<boolean>) | null,
  ): void {
    this.publicUploadResolver = fn;
  }

  /**
   * Grava o PDF assinado/relatório em `assinados`: no fluxo público via edge
   * token-scoped; no interno (ou fallback enquanto anon aberto) direto.
   */
  private async persistSignedPdf(filePath: string, pdfBytes: Uint8Array, errorLabel: string): Promise<void> {
    if (this.publicUploadResolver) {
      const ok = await this.publicUploadResolver({ path: filePath, bytes: pdfBytes, contentType: 'application/pdf' });
      if (ok) {
        console.log(`[PDF] ${errorLabel} gravado via edge pública:`, filePath);
        return;
      }
      console.warn(`[PDF] edge de upload falhou para ${filePath}; tentando acesso direto (fallback)`);
    }

    // @ts-ignore - Uint8Array é aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    // A4 (write-once): artefato assinado NUNCA sobrescreve. O filePath já é único
    // por instante (Date.now()); upsert:false impede substituição silenciosa de um
    // PDF assinado no mesmo caminho — requisito forense de imutabilidade.
    const { error } = await supabase.storage
      .from('assinados')
      .upload(filePath, blob, { contentType: 'application/pdf', upsert: false });
    if (error) {
      console.error(`[PDF] Erro ao salvar ${errorLabel}:`, error);
      throw new Error(`Erro ao salvar ${errorLabel}: ${error.message}`);
    }
    console.log(`[PDF] ${errorLabel} salvo no bucket assinados:`, filePath);
  }

  /**
   * Resolve um path de storage para uma URL assinada respeitando o fluxo
   * público: tenta primeiro o resolver token-scoped (edge); se não houver
   * resolver (fluxo interno autenticado) retorna null para o chamador usar o
   * caminho direto.
   */
  private async resolvePublicUrl(path: string): Promise<string | null> {
    if (!this.publicFileResolver || !path || /^https?:\/\//i.test(path)) return null;
    try {
      return await this.publicFileResolver(path);
    } catch (e) {
      console.warn('[PDF] resolver público falhou para', path, e);
      return null;
    }
  }

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

    // Fluxo PÚBLICO: resolve o path via edge token-scoped antes de tentar o
    // acesso direto ao bucket (que será fechado para anon na migration 3).
    const publicUrl = await this.resolvePublicUrl(pathOrUrl);
    if (publicUrl) {
      try {
        const res = await fetch(publicUrl);
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
      } catch {
        // cai no fallback direto abaixo
      }
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

  private formatVerificationDisplay(url: string | null | undefined): string {
    const raw = String(url || '').trim();
    if (!raw) return 'verificar autenticidade';
    try {
      const parsed = new URL(raw);
      const host = parsed.host.replace(/^www\./i, '');
      return `${host}/#/verificar`;
    } catch {
      return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    }
  }

  private drawElectronicWatermark(params: {
    page: PDFPage;
    pageWidth: number;
    pageHeight: number;
    font: any;
  }) {
    const { page, pageWidth, pageHeight, font } = params;
    const text = 'ASSINADO ELETRONICAMENTE';
    const size = 32;
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: (pageWidth - textWidth) / 2,
      y: pageHeight * 0.46,
      size,
      font,
      color: rgb(0.84, 0.87, 0.91),
      opacity: 0.16,
      rotate: degrees(32),
    });
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
    
    // Fluxo PÚBLICO: resolve via edge token-scoped (não acessa o bucket como anon).
    let signedUrl: string | null = await this.resolvePublicUrl(path);
    if (signedUrl) console.log('[PDF] Imagem resolvida via edge pública');

    // Fluxo INTERNO (ou fallback enquanto o anon ainda está aberto):
    // tenta mÃºltiplos buckets onde as imagens podem estar.
    const bucketsToTry = ['document-templates', 'generated-documents', 'signatures'];
    if (!signedUrl) {
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

  /**
   * Renderiza o wordmark oficial "jurius.com.br" na fonte REAL da marca (Spectral,
   * já carregada no index.html) via canvas e devolve PNG + proporção. Cache em bytes
   * (independente do doc) para não re-renderizar a cada página. Fallback: null → o
   * chamador desenha o texto em fonte genérica.
   */
  private async renderWordmarkPng(): Promise<{ bytes: Uint8Array; ratio: number } | null> {
    try {
      if (typeof document === 'undefined') return null;
      const fontPx = 128;
      const family = BRAND_SERIF; // 'Spectral', Georgia, serif
      // Garante a webfont Spectral pronta antes de medir/desenhar (senão cai no serif).
      try {
        const fonts = (document as any).fonts;
        if (fonts?.load) {
          await Promise.all([fonts.load(`700 ${fontPx}px 'Spectral'`), fonts.load(`400 ${fontPx}px 'Spectral'`)]);
          await fonts.ready;
        }
      } catch { /* usa fallback serif */ }

      const lead = BRAND_WORDMARK.lead; // 'jurius'
      const dot = BRAND_WORDMARK.dot;   // '.'
      const tld = BRAND_WORDMARK.tld;   // 'com.br'
      const leadFont = `700 ${fontPx}px ${family}`;
      const tldFont = `400 ${fontPx}px ${family}`;

      const measure = document.createElement('canvas').getContext('2d');
      if (!measure) return null;
      measure.font = leadFont;
      const leadW = measure.measureText(lead).width;
      const dotW = measure.measureText(dot).width;
      measure.font = tldFont;
      const tldW = measure.measureText(tld).width;

      const padX = Math.round(fontPx * 0.06);
      const padY = Math.round(fontPx * 0.14);
      const kern = fontPx * 0.008;
      const w = Math.ceil(padX * 2 + leadW + dotW + tldW + kern * 2);
      const h = Math.ceil(fontPx * 1.02 + padY);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.textBaseline = 'alphabetic';
      const baseY = Math.round(fontPx * 0.86 + padY / 2);
      let cx = padX;
      ctx.font = leadFont;
      ctx.fillStyle = '#211C18'; // lead — near-black quente da marca
      ctx.fillText(lead, cx, baseY);
      cx += leadW + kern;
      ctx.fillStyle = BRAND_DOT; // ponto laranja da marca (#E45C12)
      ctx.fillText(dot, cx, baseY);
      cx += dotW + kern;
      ctx.font = tldFont;
      ctx.fillStyle = '#A0958C'; // "com.br" mutado
      ctx.fillText(tld, cx, baseY);

      const bytes = await this.canvasToPngBytes(canvas);
      return { bytes, ratio: w / h };
    } catch {
      return null;
    }
  }

  /** Wordmark oficial embutido no doc atual (bytes em cache). */
  private async getBrandWordmarkImage(
    pdfDoc: PDFDocument,
  ): Promise<{ image: EmbeddedImage; ratio: number } | null> {
    try {
      if (!this.wordmarkPngBytes) {
        const built = await this.renderWordmarkPng();
        if (!built) return null;
        this.wordmarkPngBytes = built.bytes;
        this.wordmarkPngRatio = built.ratio;
      }
      const image = await pdfDoc.embedPng(this.wordmarkPngBytes);
      return { image, ratio: this.wordmarkPngRatio };
    } catch {
      return null;
    }
  }

  /**
   * Renderiza QUALQUER texto na fonte serifada da marca (Spectral) via canvas e
   * devolve PNG + proporção (w/h). Usado para títulos do certificado (nome do
   * documento, "Documento assinado", nome do signatário). Cache por texto+peso+cor.
   */
  private async renderSerifTextPng(
    text: string,
    opts: { weight?: number; color?: string } = {},
  ): Promise<{ bytes: Uint8Array; ratio: number } | null> {
    try {
      if (typeof document === 'undefined' || !text) return null;
      const weight = opts.weight ?? 600;
      const color = opts.color ?? '#111827';
      const key = `${weight}|${color}|${text}`;
      const cached = this.serifTextCache.get(key);
      if (cached) return cached;

      const fontPx = 96;
      const family = BRAND_SERIF;
      try {
        const fonts = (document as any).fonts;
        if (fonts?.load) {
          await fonts.load(`${weight} ${fontPx}px 'Spectral'`);
          await fonts.ready;
        }
      } catch { /* fallback serif */ }

      const font = `${weight} ${fontPx}px ${family}`;
      const measureCtx = document.createElement('canvas').getContext('2d');
      if (!measureCtx) return null;
      measureCtx.font = font;
      const m = measureCtx.measureText(text);
      const asc = m.actualBoundingBoxAscent || fontPx * 0.78;
      const desc = m.actualBoundingBoxDescent || fontPx * 0.24;
      const padX = Math.round(fontPx * 0.03);
      const padY = Math.round(fontPx * 0.1);
      const w = Math.ceil(m.width + padX * 2);
      const h = Math.ceil(asc + desc + padY * 2);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;
      ctx.fillText(text, padX, Math.round(asc + padY));

      const bytes = await this.canvasToPngBytes(canvas);
      const out = { bytes, ratio: w / h };
      this.serifTextCache.set(key, out);
      return out;
    } catch {
      return null;
    }
  }

  /** Texto serifado (Spectral) embutido no doc atual. */
  private async getSerifTextImage(
    pdfDoc: PDFDocument,
    text: string,
    opts: { weight?: number; color?: string } = {},
  ): Promise<{ image: EmbeddedImage; ratio: number } | null> {
    try {
      const built = await this.renderSerifTextPng(text, opts);
      if (!built) return null;
      const image = await pdfDoc.embedPng(built.bytes);
      return { image, ratio: built.ratio };
    } catch {
      return null;
    }
  }

  private async buildQrPng(pdfDoc: PDFDocument, url: string): Promise<EmbeddedImage | null> {
    try {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      // QR limpo, sem logo central, para maximizar legibilidade nos relatórios.
      await QRCode.toCanvas(canvas, url, {
        width: size,
        margin: 1,
        errorCorrectionLevel: 'H',
        color: { dark: '#111827', light: '#ffffff' },
      });

      const bytes = await this.canvasToPngBytes(canvas);
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
    /** Monoespaçada (Courier) para código/protocolo/hash — cai em helvetica se ausente. */
    courier?: any;
    courierBold?: any;
    /** Wordmark oficial (Spectral) pré-renderizado como imagem — cai no texto se ausente. */
    brandWordmark?: { image: EmbeddedImage; ratio: number } | null;
    docHash: string;
    integritySha256?: string | null;
    variant?: 'card' | 'strip';
    /** Quando true o fundo do strip é totalmente opaco (espaço reservado, nada por baixo) */
    opaqueStrip?: boolean;
    /** Modelo per_document: código de verificação PRÓPRIO do documento (sobrepõe o do signatário). */
    verificationCode?: string;
    /** Protocolo do envelope (signature_requests.id) — carimbado no rodapé de TODAS as folhas. */
    protocol?: string;
  }) {
    const { page, pageWidth, pageHeight, signer, verificationUrl, qrImage, brandWordmark, helvetica, helveticaBold, integritySha256, variant, opaqueStrip, verificationCode, protocol } = params;
    void pageHeight;
    const courier = params.courier ?? helvetica;
    const courierBold = params.courierBold ?? helveticaBold;

    const integrityFull = this.formatIntegrityHash(integritySha256, false);
    const code = (verificationCode || signer.verification_hash || '').toUpperCase() || 'N/A';
    const protocolStr = (protocol || '').trim();
    const mode: 'card' | 'strip' = variant ?? 'strip';

    if (mode === 'strip') {
      const h = 64;
      const x = 0;
      const y = 0;
      const w = pageWidth;

      // Paleta enxuta: uma tinta, um mutado, um rótulo, um fio — e o laranja como único acento.
      const ink       = rgb(0.067, 0.094, 0.153); // #111827 — âncora
      const inkValue  = rgb(0.13, 0.17, 0.24);     // valor em destaque (código)
      const inkSoft   = rgb(0.34, 0.39, 0.47);     // valores técnicos
      const label     = rgb(0.62, 0.66, 0.72);     // rótulos caps
      const hair      = rgb(0.90, 0.92, 0.94);     // divisores
      const hairSoft  = rgb(0.93, 0.95, 0.96);     // hairline interna
      const topDivider = rgb(0.80, 0.83, 0.87);    // separador superior suave
      const orange    = rgb(0.878, 0.380, 0.102);  // #E0611A — acento de marca
      const white     = rgb(1, 1, 1);

      // Desenha texto com tracking (letter-spacing) — pdf-lib não tem nativo. Retorna o x final.
      const drawTracked = (
        text: string,
        opts: { x: number; y: number; size: number; font: any; color: any; tracking: number },
      ): number => {
        let cx = opts.x;
        for (const ch of text) {
          page.drawText(ch, { x: cx, y: opts.y, size: opts.size, font: opts.font, color: opts.color });
          cx += opts.font.widthOfTextAtSize(ch, opts.size) + opts.tracking;
        }
        return cx - opts.tracking;
      };

      // Trunca com reticências para caber numa largura.
      const fit = (text: string, font: any, size: number, maxW: number): string => {
        if (font.widthOfTextAtSize(text, size) <= maxW) return text;
        let t = text;
        while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
        return `${t}…`;
      };

      const compactVerify = this.formatVerificationDisplay(verificationUrl);

      // Fundo + separador superior suave: hairline discreta com um fio laranja fininho de acento.
      page.drawRectangle({ x, y, width: w, height: h, color: white, opacity: opaqueStrip ? 1 : 0.97 });
      page.drawRectangle({ x, y: y + h - 0.8, width: w, height: 0.8, color: topDivider });
      page.drawRectangle({ x, y: y + h - 1.3, width: w, height: 0.4, color: orange });

      const marginL = 26;
      const marginR = 16;
      const tx = x + marginL;

      // ── Zona de validação (direita): QR selado + coluna de texto ──
      const qrSize = 44;
      const qrX = x + w - marginR - qrSize;
      const qrY = y + (h - 2) / 2 - qrSize / 2;
      if (qrImage) {
        page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
      }

      const valTextRight = qrX - 12;
      const valTextX = qrX - 12 - 96;
      const dividerX = valTextX - 16;
      page.drawLine({ start: { x: dividerX, y: y + 10 }, end: { x: dividerX, y: y + h - 12 }, thickness: 0.5, color: hair });

      drawTracked('VALIDAÇÃO DIGITAL', { x: valTextX, y: y + h - 22, size: 5.6, font: helveticaBold, color: ink, tracking: 0.7 });
      page.drawText(fit(compactVerify, courier, 5.4, valTextRight - valTextX), {
        x: valTextX, y: y + h - 33, size: 5.4, font: courier, color: inkSoft,
      });
      page.drawText('Escaneie o QR Code para', { x: valTextX, y: y + 15, size: 4.9, font: helvetica, color: label });
      page.drawText('verificar a autenticidade', { x: valTextX, y: y + 8.5, size: 4.9, font: helvetica, color: label });

      const contentRight = dividerX - 18;

      // ── Marca (esquerda) ──
      const brandY = y + h - 20;
      let brandDotEnd: number;
      if (brandWordmark) {
        // Wordmark oficial renderizado na fonte real da marca (Spectral).
        const wmH = 12;
        const wmW = wmH * brandWordmark.ratio;
        page.drawImage(brandWordmark.image, { x: tx, y: brandY - 2.5, width: wmW, height: wmH });
        brandDotEnd = tx + wmW;
      } else {
        // Fallback (fonte da marca indisponível): "jurius" + ponto laranja em fonte genérica.
        const brandEnd = drawTracked('jurius', { x: tx, y: brandY, size: 13, font: helveticaBold, color: ink, tracking: 0.2 });
        page.drawCircle({ x: brandEnd + 2.8, y: brandY + 1.4, size: 1.6, color: orange });
        brandDotEnd = brandEnd + 2.8 + 1.6;
      }
      page.drawRectangle({ x: brandDotEnd + 8, y: brandY - 0.5, width: 0.5, height: 8.5, color: hair });
      drawTracked('ASSINATURA ELETRÔNICA', { x: brandDotEnd + 14, y: brandY + 1.4, size: 5.6, font: helvetica, color: label, tracking: 1.4 });

      // ── Grade rótulo-sobre-valor: código | protocolo ──
      const gridLabelY = y + 27;
      const gridValueY = y + 15;

      drawTracked('CÓDIGO DE VERIFICAÇÃO', { x: tx, y: gridLabelY, size: 5, font: helveticaBold, color: label, tracking: 0.9 });
      if (code !== 'N/A') {
        page.drawText(fit(code, courierBold, 12.5, contentRight - tx), {
          x: tx, y: gridValueY, size: 12.5, font: courierBold, color: inkValue,
        });
      }
      const codeW = code !== 'N/A' ? courierBold.widthOfTextAtSize(code, 12.5) : 90;

      const col2X = tx + Math.max(codeW, 118) + 34;
      if (protocolStr && col2X < contentRight - 40) {
        drawTracked('PROTOCOLO', { x: col2X, y: gridLabelY, size: 5, font: helveticaBold, color: label, tracking: 0.9 });
        page.drawText(fit(protocolStr, courier, 8.5, contentRight - col2X), {
          x: col2X, y: gridValueY + 1, size: 8.5, font: courier, color: inkSoft,
        });
      }

      // ── SHA-256: faixa inferior separada por hairline ──
      page.drawLine({ start: { x: tx, y: y + 10 }, end: { x: contentRight, y: y + 10 }, thickness: 0.5, color: hairSoft });
      const shaLabelEnd = drawTracked('SHA-256', { x: tx, y: y + 3.5, size: 5, font: helveticaBold, color: label, tracking: 0.9 });
      page.drawText(fit(integrityFull, courier, 5.4, contentRight - (shaLabelEnd + 8)), {
        x: shaLabelEnd + 8, y: y + 3.4, size: 5.4, font: courier, color: inkSoft,
      });

      // Link clicável cobrindo toda a zona de validação (divisor → margem direita).
      if (verificationUrl) {
        try {
          const linkAnnot = (page.doc.context as any).obj({
            Type: 'Annot', Subtype: 'Link',
            Rect: [dividerX, y + 6, x + w - marginR, y + h - 6],
            Border: [0, 0, 0],
            A: { Type: 'Action', S: 'URI', URI: PDFString.of(verificationUrl) },
          });
          page.node.addAnnot((page.doc.context as any).register(linkAnnot));
        } catch { /* best-effort */ }
      }

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
    const cardValue  = rgb(0.20, 0.255, 0.333); // #334155 — código
    const cardValueAlt = rgb(0.278, 0.333, 0.412); // #475569 — link/hash
    const cardOrange = rgb(0.91, 0.32, 0.04);   // #e85208 — acento institucional apenas

    // White background
    page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: cardWhite });

    // Top thin border line
    page.drawLine({
      start: { x: boxX, y: boxY + boxH },
      end: { x: boxX + boxW, y: boxY + boxH },
      thickness: 0.6, color: cardBorder,
    });

    // Separador superior suave: fio laranja fininho (não a faixa grossa de 3px).
    page.drawRectangle({ x: boxX, y: boxY + boxH - 0.6, width: boxW, height: 0.6, color: cardOrange });

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

    // Brand + title line — wordmark oficial (Spectral) com fallback em texto.
    const cardBrandY = boxY + boxH - 19;
    let cardBrandEnd: number;
    if (brandWordmark) {
      const wmH = 11;
      const wmW = wmH * brandWordmark.ratio;
      page.drawImage(brandWordmark.image, { x: tx, y: cardBrandY - 2, width: wmW, height: wmH });
      cardBrandEnd = tx + wmW;
    } else {
      page.drawText('jurius', { x: tx, y: cardBrandY, size: 9, font: helveticaBold, color: cardDark });
      cardBrandEnd = tx + helveticaBold.widthOfTextAtSize('jurius', 9);
    }
    page.drawText('·', {
      x: cardBrandEnd + 6, y: cardBrandY, size: 8, font: helvetica, color: cardOrange,
    });
    page.drawText('Certificado de Assinatura Eletrônica', {
      x: cardBrandEnd + 13, y: cardBrandY, size: 7.5, font: helvetica, color: cardSoft,
    });

    // Thin separator
    page.drawLine({
      start: { x: tx, y: boxY + boxH - 27 },
      end: { x: qrX - 8, y: boxY + boxH - 27 },
      thickness: 0.4, color: cardBorder,
    });

    // Verification code row
    page.drawText('CODIGO:', {
      x: tx, y: boxY + boxH - 38, size: 6, font: helvetica, color: cardMuted,
    });
    page.drawText(code, {
      x: tx + 50, y: boxY + boxH - 38, size: 7, font: courierBold, color: cardValue,
    });

    // Protocolo do envelope row
    if (protocolStr) {
      const cardProtoLabel = 'PROTOCOLO DO ENVELOPE:';
      page.drawText(cardProtoLabel, {
        x: tx, y: boxY + boxH - 50, size: 6, font: helvetica, color: cardMuted,
      });
      const protoDisplay = protocolStr.length > 74 ? `${protocolStr.slice(0, 71)}...` : protocolStr;
      page.drawText(protoDisplay, {
        x: tx + helvetica.widthOfTextAtSize(cardProtoLabel, 6) + 8, y: boxY + boxH - 50, size: 6, font: courier, color: cardValueAlt,
      });
    }

    // SHA-256 row — cor neutra
    const hashDisplay = integrityFull.length > 74 ? `${integrityFull.slice(0, 71)}...` : integrityFull;
    page.drawText('SHA-256:', {
      x: tx, y: boxY + boxH - 62, size: 6, font: helvetica, color: cardMuted,
    });
    page.drawText(hashDisplay, {
      x: tx + 50, y: boxY + boxH - 62, size: 5.5, font: courier, color: cardValueAlt,
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
        x: tx, y: boxY + 12, size: 5.5, font: helvetica, color: cardValueAlt,
      });
    }
  }
  private async addReportPages(params: {
    pdfDoc: PDFDocument;
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string } | null;
    signatureImage?: EmbeddedImage | null;
    facialImage?: EmbeddedImage | null;
    qrImage?: EmbeddedImage | null;
    verificationUrl?: string | null;
    integritySha256?: string | null;
    /** Modelo per_document: nome PRÓPRIO do documento p/ o cabeçalho (senão usa request.document_name). */
    documentName?: string | null;
  }) {
    const { pdfDoc, request, signer, creator, signatureImage, facialImage, qrImage, verificationUrl, integritySha256, documentName } = params;

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);
    const logoImage = await pdfDoc.embedPng(await getLogoBytes()).catch(() => null);
    const lm = 50;
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const signedRequestSigners = await (async () => {
      try {
        // Fluxo PÚBLICO: via RPC token-scoped; INTERNO: leitura direta.
        let all: Signer[] | null = null;
        if (this.publicReportData?.signers) {
          all = await this.publicReportData.signers(request.id);
        }
        if (!all) {
          const { data } = await supabase
            .from('signature_signers')
            .select('*')
            .eq('signature_request_id', request.id)
            .order('order', { ascending: true });
          all = (data as Signer[] | null) ?? [];
        }
        const signed = (all ?? []).filter((item) => item.status === 'signed');
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
        // Fluxo PÚBLICO: via RPC token-scoped; INTERNO: leitura direta.
        if (this.publicReportData?.auditLog) {
          const viaRpc = await this.publicReportData.auditLog(request.id);
          if (viaRpc) return viaRpc as AuditEntry[];
        }
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

    // ── Design system ────────────────────────────────────────────
    const navy       = rgb(0.07, 0.10, 0.19);
    const navyMid    = rgb(0.13, 0.17, 0.27);
    const orange     = rgb(0.91, 0.32, 0.04);
    const emerald    = rgb(0.05, 0.49, 0.29);
    const emeraldSoft= rgb(0.90, 0.96, 0.92);
    const white      = rgb(1, 1, 1);
    const bgLight    = rgb(0.965, 0.975, 0.985);
    const paper      = rgb(0.98, 0.985, 0.992);
    const border     = rgb(0.87, 0.90, 0.94);
    const borderSoft = rgb(0.93, 0.95, 0.97);
    const txtDark    = rgb(0.10, 0.13, 0.20);
    const txtMid     = rgb(0.36, 0.42, 0.50);
    const txtSoft    = rgb(0.55, 0.60, 0.68);
    const silver     = rgb(0.74, 0.78, 0.84);
    const contentW   = pageWidth - lm * 2;

    // Rounded-rect SVG path (origin top-left, y-down)
    const rrPath = (w: number, h: number, r: number) => {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2));
      return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
    };
    // Draw rounded rect by TOP-LEFT corner (topY = top edge in PDF coords)
    const roundRect = (
      page: PDFPage, x: number, topY: number, w: number, h: number, r: number,
      opts: { fill?: any; stroke?: any; strokeW?: number; opacity?: number } = {}
    ) => {
      page.drawSvgPath(rrPath(w, h, r), {
        x, y: topY,
        color: opts.fill,
        borderColor: opts.stroke,
        borderWidth: opts.strokeW ?? (opts.stroke ? 0.8 : 0),
        opacity: opts.opacity,
      });
    };
    // Rounded only on TOP corners (for card headers)
    const roundTopRect = (page: PDFPage, x: number, topY: number, w: number, h: number, r: number, fill: any) => {
      const rr = Math.max(0, Math.min(r, w / 2, h));
      page.drawSvgPath(`M 0 ${h} L 0 ${rr} Q 0 0 ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h} Z`, { x, y: topY, color: fill });
    };
    // Vector checkmark centrado em (cx, cy) num círculo de raio r.
    // Usa drawSvgPath para garantir alinhamento preciso.
    // pdf-lib SVG: origem top-left, y cresce para baixo → inverte y no posicionamento.
    const checkmark = (page: PDFPage, cx: number, cy: number, r: number, color: any, weight = 1.4) => {
      // Pontos do check relativos a um quadrado de lado 2r centrado em (cx, cy)
      // Em pdf-lib coordenadas (y cresce para cima): passamos y = cy + r e deixamos
      // o path interno ir de 0 (topo) a 2r (baixo).
      const s = r * 2;
      // Pontos: (0.15s, 0.50s) → (0.40s, 0.75s) → (0.85s, 0.25s)  em coords top-down
      // Convertendo para svg path (origin top-left, y down):
      const x1 = 0.15 * s; const y1 = 0.50 * s;
      const x2 = 0.40 * s; const y2 = 0.75 * s;
      const x3 = 0.85 * s; const y3 = 0.25 * s;
      const path = `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}`;
      page.drawSvgPath(path, {
        x: cx - r,
        y: cy + r, // pdf-lib posiciona em y-up: topo do bounding box
        borderColor: color,
        borderWidth: weight,
        borderLineCap: LineCapStyle.Round,
      });
    };
    // Filled circle
    const circleDot = (page: PDFPage, cx: number, cy: number, r: number, color: any) => {
      page.drawCircle({ x: cx, y: cy, size: r, color });
    };
    // Corner crop marks around a framed photo (premium detail)
    const cornerMarks = (page: PDFPage, x: number, y: number, w: number, h: number, len: number, color: any) => {
      const t = 0.8;
      const seg = (x1: number, y1: number, x2: number, y2: number) =>
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
      // TL
      seg(x, y + h, x + len, y + h); seg(x, y + h, x, y + h - len);
      // TR
      seg(x + w - len, y + h, x + w, y + h); seg(x + w, y + h, x + w, y + h - len);
      // BL
      seg(x, y, x + len, y); seg(x, y, x, y + len);
      // BR
      seg(x + w - len, y, x + w, y); seg(x + w, y, x + w, y + len);
    };

    const createReportHeader = (page: PDFPage, title: string, subtitle?: string) => {
      // Acento superior laranja (suave)
      page.drawRectangle({ x: 0, y: pageHeight - 2.5, width: pageWidth, height: 2.5, color: orange });

      // Papel timbrado: ícone J + wordmark oficial (Spectral) — travados no mesmo eixo vertical
      const wmY = pageHeight - 32;
      const logoSize = 20;
      const lockCY = wmY - 5; // centro vertical do lockup (ícone + wordmark)
      if (logoImage) {
        page.drawImage(logoImage, { x: lm, y: lockCY - logoSize / 2, width: logoSize, height: logoSize });
      }
      const brandX = lm + logoSize + 9;
      if (brandWordmark) {
        const bwH = 12;
        page.drawImage(brandWordmark.image, { x: brandX, y: lockCY - bwH / 2, width: bwH * brandWordmark.ratio, height: bwH });
      } else {
        page.drawText('jurius', { x: brandX, y: lockCY - 4, size: 11, font: helveticaBold, color: navy });
      }

      // Rótulo da página (eyebrow) + data — à direita
      const eyebrow = title.toUpperCase();
      const ebW = helveticaBold.widthOfTextAtSize(eyebrow, 7.5);
      page.drawText(eyebrow, { x: pageWidth - lm - ebW, y: wmY + 3, size: 7.5, font: helveticaBold, color: txtSoft });
      const dw = helvetica.widthOfTextAtSize(nowStr, 7);
      page.drawText(nowStr, { x: pageWidth - lm - dw, y: wmY - 7, size: 7, font: helvetica, color: silver });

      // Divisória
      page.drawLine({ start: { x: lm, y: pageHeight - 46 }, end: { x: pageWidth - lm, y: pageHeight - 46 }, thickness: 0.6, color: border });

      // Nome do documento — sans profissional (Helvetica Bold).
      // No modelo per_document usa o nome PRÓPRIO do arquivo (documentName); sem
      // ele, cai no nome do envelope. Sempre sem a extensão (.docx/.pdf/…).
      {
        const rawName = String(documentName || request.document_name || '').replace(/\.(pdf|docx?|rtf|odt)$/i, '').trim();
        const docName = rawName.length > 70 ? `${rawName.slice(0, 67)}...` : rawName;
        page.drawText(docName, { x: lm, y: pageHeight - 68, size: 14, font: helveticaBold, color: navy });
      }

      // Subtítulo. Sem subtitle ⇒ grade "Código de verificação" (destaque) + "Protocolo" abaixo, ambos em mono.
      if (subtitle) {
        page.drawText(subtitle, { x: lm, y: pageHeight - 84, size: 8, font: helvetica, color: txtSoft });
      } else {
        const codeVal = (signer.verification_hash || '').toUpperCase();
        let ry = pageHeight - 82;
        if (codeVal) {
          const cLabel = 'Código de verificação';
          page.drawText(cLabel, { x: lm, y: ry, size: 6.5, font: helvetica, color: silver });
          page.drawText(codeVal, { x: lm + helvetica.widthOfTextAtSize(cLabel, 6.5) + 8, y: ry - 0.5, size: 8.5, font: courierBold, color: txtDark });
          ry -= 12;
        }
        const pLabel = 'Protocolo';
        page.drawText(pLabel, { x: lm, y: ry, size: 6.5, font: helvetica, color: silver });
        page.drawText(request.id, { x: lm + helvetica.widthOfTextAtSize(pLabel, 6.5) + 8, y: ry - 0.5, size: 7.5, font: courier, color: txtSoft });
      }

      // Divisória de seção
      page.drawLine({ start: { x: lm, y: pageHeight - 104 }, end: { x: pageWidth - lm, y: pageHeight - 104 }, thickness: 0.6, color: borderSoft });
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

    const REPORT_HEADER_CONTENT_GAP = 10;

    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    const sigCount1 = signedRequestSigners.length;
    createReportHeader(page1, 'CERTIFICADO DE ASSINATURA');

    // ── Hero: selo de validação (flat, sem caixa/barras) ───────
    const heroTop = pageHeight - 116 - REPORT_HEADER_CONTENT_GAP;
    const heroH = 58;

    const sealCX = lm + 20;
    const sealCY = heroTop - heroH / 2;
    circleDot(page1, sealCX, sealCY, 15, emeraldSoft);
    circleDot(page1, sealCX, sealCY, 11, emerald);
    checkmark(page1, sealCX, sealCY, 6.5, white, 2);

    page1.drawText('Documento assinado', { x: sealCX + 26, y: sealCY + 2, size: 12.5, font: helveticaBold, color: navy });
    const heroSub = `${sigCount1} ${sigCount1 === 1 ? 'signatário' : 'signatários'}  ·  Emitido em ${nowStr}`;
    page1.drawText(heroSub, { x: sealCX + 26, y: sealCY - 10, size: 7.5, font: helvetica, color: txtMid });

    // Divisória fina sob o hero
    page1.drawLine({ start: { x: lm, y: heroTop - heroH }, end: { x: pageWidth - lm, y: heroTop - heroH }, thickness: 0.6, color: borderSoft });

    // ── Section: ASSINATURAS ───────────────────────────────────
    const sectionY1 = heroTop - heroH - 24;
    page1.drawRectangle({ x: lm, y: sectionY1 - 1, width: 3, height: 12, color: orange });
    page1.drawText('ASSINATURAS', { x: lm + 10, y: sectionY1, size: 8.5, font: helveticaBold, color: txtDark });
    {
      const lw = helveticaBold.widthOfTextAtSize('ASSINATURAS', 8.5);
      page1.drawLine({ start: { x: lm + 20 + lw, y: sectionY1 + 3 }, end: { x: pageWidth - lm, y: sectionY1 + 3 }, thickness: 0.5, color: borderSoft });
    }

    let yCards = sectionY1 - 22;
    for (const asset of signerAssets) {
      const item = asset.signer;
      const signedAtStr = this.formatManausDateTime(item.signed_at, { withSeconds: true });
      const authPoints = buildAuthPoints(item);
      const rightColW = 175;
      const rightStartX = pageWidth - lm - rightColW;
      const cardHeight = Math.max(180, 78 + (authPoints.length * 13));
      if (yCards - cardHeight < 80) break;

      const cw = contentW;
      const cx = lm;
      const cardTop = yCards;

      // Card branco, flat (sem sombra), borda fina
      roundRect(page1, cx, cardTop, cw, cardHeight, 9, { fill: white, stroke: border, strokeW: 0.8 });

      // Cabeçalho minimalista: card branco + divisória fina (sem faixa navy)
      const hdrH = 34;
      page1.drawLine({ start: { x: cx + 14, y: cardTop - hdrH }, end: { x: cx + cw - 14, y: cardTop - hdrH }, thickness: 0.5, color: borderSoft });

      // ASSINADO badge with vector check
      const badgeX = cx + 14, badgeY = cardTop - hdrH + 8.5, badgeW = 76, badgeH = 17;
      roundRect(page1, badgeX, badgeY + badgeH, badgeW, badgeH, 8.5, { fill: emerald });
      checkmark(page1, badgeX + 14, badgeY + badgeH / 2, 5, white, 1.5);
      page1.drawText('ASSINADO', { x: badgeX + 23, y: badgeY + 5, size: 7.5, font: helveticaBold, color: white });

      // Name + role — sans profissional sobre card branco
      const nameDisplay = item.name.length > 34 ? `${item.name.slice(0, 32)}...` : item.name;
      page1.drawText(nameDisplay, { x: badgeX + badgeW + 12, y: cardTop - hdrH + 13, size: 11.5, font: helveticaBold, color: navy });
      const roleDisplay = item.role && item.role !== 'Assinar' ? item.role : 'Signatário';
      page1.drawText(roleDisplay, { x: badgeX + badgeW + 12, y: cardTop - hdrH + 2, size: 7, font: helvetica, color: txtSoft });

      // Body
      const bodyTop = cardTop - hdrH;
      page1.drawText('Assinado em', { x: cx + 14, y: bodyTop - 17, size: 7.5, font: helvetica, color: txtSoft });
      page1.drawText(signedAtStr, { x: cx + 72, y: bodyTop - 17, size: 7.5, font: helveticaBold, color: txtDark });
      page1.drawLine({ start: { x: cx + 14, y: bodyTop - 27 }, end: { x: rightStartX - 10, y: bodyTop - 27 }, thickness: 0.5, color: borderSoft });
      page1.drawText('FATORES DE AUTENTICAÇÃO', { x: cx + 14, y: bodyTop - 41, size: 6.5, font: helveticaBold, color: txtSoft });

      let pointY = bodyTop - 55;
      for (const point of authPoints.slice(0, 8)) {
        circleDot(page1, cx + 16, pointY + 2.5, 2, emerald);
        page1.drawText(point, { x: cx + 24, y: pointY, size: 7.5, font: helvetica, color: txtMid, maxWidth: rightStartX - cx - 38 });
        pointY -= 13;
      }

      // Right column — signature box (rounded)
      const sigBoxW = rightColW - 16;
      const sigX = rightStartX + 8;
      const sigLabelY = bodyTop - 13;
      const sigBoxTop = sigLabelY - 6;
      const sigBoxBottom = cardTop - cardHeight + 12;
      const sigBoxH = Math.max(30, sigBoxTop - sigBoxBottom);

      page1.drawText('ASSINATURA MANUSCRITA', { x: sigX, y: sigLabelY, size: 6, font: helveticaBold, color: txtSoft });
      roundRect(page1, sigX, sigBoxTop, sigBoxW, sigBoxH, 6, { fill: paper, stroke: border, strokeW: 0.8 });
      page1.drawLine({
        start: { x: sigX + 10, y: sigBoxBottom + 16 },
        end:   { x: sigX + sigBoxW - 10, y: sigBoxBottom + 16 },
        thickness: 0.5, color: border,
      });
      if (asset.signature) {
        const imgPad = 8;
        page1.drawImage(asset.signature, {
          x: sigX + imgPad, y: sigBoxBottom + imgPad,
          width: sigBoxW - imgPad * 2, height: Math.max(10, sigBoxH - imgPad * 2),
        });
      }

      yCards -= cardHeight + 18;
    }

    for (const asset of signerAssets) {
      const item = asset.signer;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const signedAtStr = this.formatManausDateTime(item.signed_at, { withSeconds: true });
      const geoP2 = this.parseGeolocation(item.signer_geolocation);
      const uaP2  = this.parseUserAgent(item.signer_user_agent);

      createReportHeader(page, 'BIOMETRIA & VERIFICAÇÃO', `Signatário: ${item.name}`);

      // ── Section label ─────────────────────────────────────────
      const sectionLabelY = pageHeight - 128 - REPORT_HEADER_CONTENT_GAP;
      page.drawRectangle({ x: lm, y: sectionLabelY - 1, width: 3, height: 12, color: orange });
      page.drawText('BIOMETRIA FACIAL', { x: lm + 10, y: sectionLabelY, size: 8.5, font: helveticaBold, color: txtDark });
      {
        const lw = helveticaBold.widthOfTextAtSize('BIOMETRIA FACIAL', 8.5);
        page.drawLine({ start: { x: lm + 20 + lw, y: sectionLabelY + 3 }, end: { x: pageWidth - lm, y: sectionLabelY + 3 }, thickness: 0.5, color: borderSoft });
      }

      // ── Photo — large, portrait ────────────────────────────────
      const photoW = 210;
      const photoH = 260;
      const photoX = lm;
      const photoY = pageHeight - 168 - photoH; // bottom-left Y of photo

      // Caption above photo: "Foto do rosto (selfie) de NAME:"
      const photoCaption = `Foto do rosto (selfie) de ${item.name}:`;
      page.drawText(photoCaption, { x: photoX, y: photoY + photoH + 10, size: 6.5, font: helvetica, color: txtSoft });

      if (asset.facial) {
        // Moldura branca flat (sem sombra)
        roundRect(page, photoX, photoY + photoH, photoW, photoH, 8, { fill: white, stroke: border, strokeW: 1.2 });
        // Imagem em "contain": preserva o aspect ratio REAL da selfie (evita o
        // rosto achatado/esticado que a moldura fixa 210x260 causava).
        const imgPad = 4;
        const frameW = photoW - imgPad * 2;
        const frameH = photoH - imgPad * 2;
        const natW = (asset.facial as any).width || frameW;
        const natH = (asset.facial as any).height || frameH;
        const fitScale = Math.min(frameW / natW, frameH / natH);
        const drawW = natW * fitScale;
        const drawH = natH * fitScale;
        const imgX = photoX + imgPad + (frameW - drawW) / 2;
        const imgY = photoY + imgPad + (frameH - drawH) / 2;
        page.drawImage(asset.facial, { x: imgX, y: imgY, width: drawW, height: drawH });
        // Corner crop marks (premium detail)
        cornerMarks(page, photoX + 9, photoY + 9, photoW - 18, photoH - 18, 11, rgb(1, 1, 1));

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
          page.drawLine({ start: { x: cx, y: dLineY1 }, end: { x: ex, y: dLineY1 }, thickness: 0.6, color: rgb(0.38, 0.38, 0.38), opacity: 0.3 });
        }

        // "CONFIDENTIAL" text centered
        const confSize = 10;
        const confText = 'CONFIDENTIAL';
        const confW = helveticaBold.widthOfTextAtSize(confText, confSize);
        page.drawText(confText, {
          x: wmCenterX - confW / 2, y: wmCenterY + 2,
          size: confSize, font: helveticaBold, color: rgb(0.30, 0.30, 0.30), opacity: 0.42,
        });

        // Date below text
        const dtSize = 6;
        const dtW = helvetica.widthOfTextAtSize(signedAtStr, dtSize);
        page.drawText(signedAtStr, {
          x: wmCenterX - dtW / 2, y: wmCenterY - 9,
          size: dtSize, font: helvetica, color: rgb(0.30, 0.30, 0.30), opacity: 0.32,
        });

        // Dashed line below
        for (let cx = dLineX1; cx < dLineX2; cx += dashW + dashGap) {
          const ex = Math.min(cx + dashW, dLineX2);
          page.drawLine({ start: { x: cx, y: dLineY2 }, end: { x: ex, y: dLineY2 }, thickness: 0.6, color: rgb(0.38, 0.38, 0.38), opacity: 0.3 });
        }
      } else {
        roundRect(page, photoX, photoY + photoH, photoW, photoH, 8, { fill: bgLight, stroke: border, strokeW: 1 });
        page.drawText('Selfie não', { x: photoX + 68, y: photoY + photoH / 2 + 8, size: 9, font: helveticaBold, color: rgb(0.70, 0.72, 0.75) });
        page.drawText('coletada', { x: photoX + 76, y: photoY + photoH / 2 - 6, size: 9, font: helveticaBold, color: rgb(0.70, 0.72, 0.75) });
      }

      // ── Signer data — right column ─────────────────────────────
      const detX = photoX + photoW + 20;
      const detW = pageWidth - lm - detX;
      let detY = pageHeight - 148;

      // Data section — mantém apenas o título e a lista para evitar sobreposição visual.
      detY -= 2;

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

      const termsStrP2 = item.terms_accepted_at
        ? `Aceitos · versão ${String(item.terms_version || 'v1')}`
        : '—';

      const dataFieldsP2: [string, string][] = [
        ['Nome', item.name],
        ['Papel', item.role && item.role !== 'Assinar' ? item.role : 'Signatário'],
        ['Contato', contactStrP2],
        ['CPF', item.cpf || '—'],
        ['Endereço IP', item.signer_ip || '—'],
        ['Localização', geoP2.coordinates || '—'],
        ['Dispositivo', deviceStrP2],
        ['Autenticação', authStrP2],
        ['Termos de Uso', termsStrP2],
        ['Assinado em', signedAtStr],
      ];

      page.drawText('DADOS DO SIGNATÁRIO', { x: detX, y: detY, size: 6.5, font: helveticaBold, color: txtSoft });
      detY -= 16;

      // Lista com bullets esmeralda (mesmo padrão dos FATORES DE AUTENTICAÇÃO do card)
      const monoLabels = new Set(['CPF', 'Endereço IP', 'Localização', 'Assinado em']);
      for (const [label, rawVal] of dataFieldsP2) {
        if (detY < photoY + 4) break;
        const trimmed = String(rawVal || '').trim();
        const isEmpty = trimmed === '' || trimmed === '—' || trimmed === '-';
        const value = isEmpty ? 'Não informado' : (rawVal.length > 40 ? `${rawVal.slice(0, 38)}…` : rawVal);
        circleDot(page, detX + 2, detY + 2.5, 2, emerald);
        const lbl = `${label}: `;
        page.drawText(lbl, { x: detX + 10, y: detY, size: 7.5, font: helvetica, color: txtSoft });
        const lw = helvetica.widthOfTextAtSize(lbl, 7.5);
        const valFont = !isEmpty && monoLabels.has(label) ? courier : helveticaBold;
        page.drawText(value, { x: detX + 10 + lw, y: detY, size: 7.5, font: valFont, color: isEmpty ? silver : txtDark });
        detY -= 15;
      }

      // ── Certificate / integrity block — white, ZapSign-style ──
      const legalTopY  = photoY - 18;
      const verBlockH  = 162;
      const verBlockW  = pageWidth - lm * 2;
      const verBlockY  = legalTopY - verBlockH;

      const cbWhite  = rgb(1, 1, 1);
      const cbBorder = rgb(0.86, 0.89, 0.93);
      const cbDark   = rgb(0.09, 0.12, 0.18);
      const cbSoft   = rgb(0.45, 0.50, 0.58);
      const cbMuted  = rgb(0.62, 0.67, 0.74);
      const cbValue  = rgb(0.20, 0.255, 0.333); // #334155 — código
      const cbValueAlt = rgb(0.278, 0.333, 0.412); // #475569 — link/hash

      // Card branco sem bordas nem acento — apenas o preenchimento
      roundRect(page, lm, legalTopY, verBlockW, verBlockH, 9, { fill: cbWhite });
      void cbBorder;

      // QR code — right side (grandão: quase encostando no fim do hash)
      const cbQrSize = 150;
      const cbQrX    = lm + verBlockW - cbQrSize - 12;
      const cbQrY    = verBlockY + (verBlockH - cbQrSize) / 2;
      if (asset.qr) {
        page.drawRectangle({ x: cbQrX - 3, y: cbQrY - 3, width: cbQrSize + 6, height: cbQrSize + 6, color: cbWhite });
        page.drawImage(asset.qr, { x: cbQrX, y: cbQrY, width: cbQrSize, height: cbQrSize });
      }

      const vtx = lm + 14;

      // Brand + title
      const cbBrandY = legalTopY - 18;
      let cbBrandEnd: number;
      if (brandWordmark) {
        const wmH = 11;
        const wmW = wmH * brandWordmark.ratio;
        page.drawImage(brandWordmark.image, { x: vtx, y: cbBrandY - 2, width: wmW, height: wmH });
        cbBrandEnd = vtx + wmW;
      } else {
        page.drawText('jurius', { x: vtx, y: cbBrandY, size: 9, font: helveticaBold, color: cbDark });
        cbBrandEnd = vtx + helveticaBold.widthOfTextAtSize('jurius', 9);
      }
      page.drawText('·', { x: cbBrandEnd + 6, y: cbBrandY, size: 8, font: helvetica, color: cbMuted });
      page.drawText('Certificado de Assinatura Eletrônica', { x: cbBrandEnd + 13, y: cbBrandY, size: 7.5, font: helvetica, color: cbSoft });

      // Thin separator
      page.drawLine({ start: { x: vtx, y: legalTopY - 26 }, end: { x: cbQrX - 8, y: legalTopY - 26 }, thickness: 0.4, color: cbBorder });

      // Code row
      page.drawText('CÓDIGO:', { x: vtx, y: legalTopY - 37, size: 6, font: helvetica, color: cbMuted });
      page.drawText((item.verification_hash || 'N/A').toUpperCase(), { x: vtx + 56, y: legalTopY - 37, size: 7.5, font: courierBold, color: cbValue });

      // Protocolo do envelope (identifica o kit/processo)
      const cbProtoLabel = 'PROTOCOLO DO ENVELOPE:';
      page.drawText(cbProtoLabel, { x: vtx, y: legalTopY - 49, size: 6, font: helvetica, color: cbMuted });
      page.drawText(request.id, { x: vtx + helvetica.widthOfTextAtSize(cbProtoLabel, 6) + 8, y: legalTopY - 49, size: 6, font: courier, color: cbValueAlt });

      // SHA-256 — hash de integridade REAL (completo, 64 hex) — cor neutra
      const cbHash = this.formatIntegrityHash(integritySha256, false);
      page.drawText('SHA-256:', { x: vtx, y: legalTopY - 61, size: 6, font: helvetica, color: cbMuted });
      page.drawText(cbHash, { x: vtx + 56, y: legalTopY - 61, size: 5.5, font: courier, color: cbValueAlt });

      // Separator
      page.drawLine({ start: { x: vtx, y: legalTopY - 69 }, end: { x: cbQrX - 8, y: legalTopY - 69 }, thickness: 0.4, color: cbBorder });

      // Verification URL — logo abaixo do separador (segue o conteúdo, não o rodapé)
      if (asset.verificationUrl) {
        const urlD = asset.verificationUrl.length > 80 ? `${asset.verificationUrl.slice(0, 77)}...` : asset.verificationUrl;
        page.drawText(urlD, { x: vtx, y: legalTopY - 80, size: 5.5, font: helvetica, color: cbValueAlt });
      }

      // Signer note
      page.drawText(`Signatário: ${item.name}`, { x: vtx, y: legalTopY - 90, size: 5, font: helvetica, color: cbMuted });
    }

    let currentHistPage = pdfDoc.addPage([pageWidth, pageHeight]);
    createReportHeader(currentHistPage, 'TRILHA DE AUDITORIA');
    const createdAtDate = this.toDateValue(request.created_at) ?? new Date();
    // Horários da trilha COM segundos: eventos próximos (ex.: termos e assinatura
    // no mesmo minuto) precisam do segundo para evidenciar a diferença/ordem.
    const fmtWhen = (v: string | Date | null | undefined) => this.formatManausDateTime(v, { withSeconds: true });
    const createdAtStr = fmtWhen(createdAtDate);
    // `order` = prioridade lógica para desempate quando o horário é idêntico
    // (ex.: aceite dos Termos e Assinatura no mesmo segundo): Termos antes de Assinado.
    type HistoryItem = { label: string; when: string; detail: string; sortAt: number; order: number };
    const history: HistoryItem[] = [];
    // Criador: mostra nome sem email pessoal no PDF público — o email interno
    // do escritório não precisa aparecer no certificado do signatário externo.
    const creatorName = creator?.name || SYSTEM_ISSUER_LABEL;
    history.push({ label: 'Criado', when: createdAtStr, detail: `Documento emitido por ${creatorName}.`, sortAt: createdAtDate.getTime(), order: 0 });

    const buildTimelineAuthSummary = (item: Signer) => {
      const base =
        item.auth_provider === 'phone'
          ? 'Autenticação via Telefone'
          : item.auth_provider === 'email_link'
            ? 'Autenticação via Link por E-mail'
            : item.auth_provider === 'google'
              ? 'Autenticação via Google'
              : 'Autenticação no fluxo de assinatura';

      return item.facial_image_path ? `${base} + verificação facial por IA` : base;
    };

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
      const authTimelineSummary = buildTimelineAuthSummary(item);

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
            when: fmtWhen(ve.created_at),
            detail: `${item.name}${signerContact}${signerCpf} abriu o documento${ipInfo}`,
            sortAt: ts?.getTime() ?? 0,
            order: 1,
          });
          history.push({
            label: 'Autenticação',
            when: fmtWhen(ve.created_at),
            detail: `${item.name}${signerCpf}. ${authTimelineSummary}${ipInfo ? `${ipInfo}.` : '.'}`,
            sortAt: ts?.getTime() ?? 0,
            order: 2,
          });
          if (geo.coordinates) {
            history.push({
              label: 'Localização',
              when: fmtWhen(ve.created_at),
              detail: `${item.name}${signerContact}${signerCpf} ativou a localização com coordenadas ${geo.coordinates}${geo.address ? ` (${geo.address})` : ''}.`,
              sortAt: ts?.getTime() ?? 0,
            order: 3,
          });
          }
        }
      } else if (item.viewed_at) {
        // Fallback for older records without audit log entries
        const viewedAtDate = this.toDateValue(item.viewed_at);
        history.push({
          label: 'Visualizado',
          when: fmtWhen(item.viewed_at),
          detail: `${item.name}${signerContact}${signerCpf} visualizou este documento${item.signer_ip ? ` por meio do IP ${item.signer_ip}` : ''}${locationInfo}`,
          sortAt: viewedAtDate?.getTime() ?? 0,
          order: 1,
        });
        history.push({
          label: 'Autenticação',
          when: fmtWhen(item.viewed_at),
          detail: `${item.name}${signerCpf}. ${authTimelineSummary}${item.signer_ip ? ` por meio do IP ${item.signer_ip}.` : '.'}`,
          sortAt: viewedAtDate?.getTime() ?? 0,
          order: 2,
        });
        if (geo.coordinates) {
          history.push({
            label: 'Localização',
            when: fmtWhen(item.viewed_at),
            detail: `${item.name}${signerContact}${signerCpf} ativou a localização com coordenadas ${geo.coordinates}${geo.address ? ` (${geo.address})` : ''}.`,
            sortAt: viewedAtDate?.getTime() ?? 0,
            order: 3,
          });
        }
      }

      // Biometria facial (selfie): registra explicitamente o consentimento de
      // câmera + a captura da selfie usada na verificação facial por IA. Não há
      // coluna própria de captura, então ancoramos no horário da autenticação
      // (ordem 2.5 = logo após "Autenticação", antes de "Localização").
      if (item.facial_image_path) {
        const facialWhenRaw = viewAuditEntries[0]?.created_at ?? item.viewed_at ?? item.signed_at ?? null;
        history.push({
          label: 'Biometria facial',
          when: fmtWhen(facialWhenRaw),
          detail: `${item.name}${signerContact}${signerCpf} concedeu acesso à câmera e teve a selfie capturada para verificação facial por IA.`,
          sortAt: this.toDateValue(facialWhenRaw)?.getTime() ?? 0,
          order: 2.5,
        });
      }

      const signedAtMs = item.signed_at ? (this.toDateValue(item.signed_at)?.getTime() ?? 0) : 0;

      // Termos vêm ANTES da assinatura (o aceite é pré-requisito do ato de assinar).
      if (item.terms_accepted_at) {
        const termsAtMs = this.toDateValue(item.terms_accepted_at)?.getTime() ?? 0;
        const termsVersion = String(item.terms_version || 'v1');
        history.push({
          label: 'Termos',
          when: fmtWhen(item.terms_accepted_at),
          detail: `${item.name}${signerContact}${signerCpf} declarou ter lido e aceitado os Termos de Uso (versão ${termsVersion})${item.signer_ip ? ` por meio do IP ${item.signer_ip}` : ''}. Consulte em ${buildPublicSignatureTermsUrl(termsVersion)}`,
          // Trava: nunca depois da assinatura (mesmo se o timestamp gravado for igual/posterior).
          sortAt: signedAtMs ? Math.min(termsAtMs, signedAtMs) : termsAtMs,
          order: 4,
        });
      }

      if (item.signed_at) {
        history.push({
          label: 'Assinado',
          when: fmtWhen(item.signed_at),
          detail: `${item.name}${signerContact}${signerCpf} assinou este documento${item.signer_ip ? ` por meio do IP ${item.signer_ip}` : ''}${locationInfo}. ${buildTimelineAuthSummary(item)}`,
          sortAt: signedAtMs,
          order: 5,
        });
      }
    }

    history.sort((a, b) => a.sortAt - b.sortAt || a.order - b.order);

    const drawHistPageSetup = (page: PDFPage, isFirst: boolean) => {
      const sectionY = pageHeight - 128 - REPORT_HEADER_CONTENT_GAP;
      page.drawRectangle({ x: lm, y: sectionY - 1, width: 3, height: 12, color: orange });
      const sectionLabel = isFirst ? 'REGISTRO DE EVENTOS' : 'REGISTRO DE EVENTOS (continuação)';
      page.drawText(sectionLabel, { x: lm + 10, y: sectionY, size: 8.5, font: helveticaBold, color: txtDark });
      const lw = helveticaBold.widthOfTextAtSize(sectionLabel, 8.5);
      page.drawLine({ start: { x: lm + 20 + lw, y: sectionY + 3 }, end: { x: pageWidth - lm, y: sectionY + 3 }, thickness: 0.5, color: borderSoft });
    };

    drawHistPageSetup(currentHistPage, true);

    let y = pageHeight - 158 - REPORT_HEADER_CONTENT_GAP;
    const timelineX = lm + 15; // vertical line x
    const eventGap = 11;

    // Vertical timeline line for first page
    currentHistPage.drawLine({ start: { x: timelineX, y: y + 6 }, end: { x: timelineX, y: 102 }, thickness: 1.2, color: border });

    for (const histItem of history) {
      const detailLines = wrapText(histItem.detail, helvetica, 7.5, pageWidth - lm * 2 - 52);
      const blockHeight = 38 + detailLines.length * 12;

      if (y - blockHeight < 92) {
        // Page full — start a new continuation page
        currentHistPage = pdfDoc.addPage([pageWidth, pageHeight]);
        createReportHeader(currentHistPage, 'TRILHA DE AUDITORIA');
        drawHistPageSetup(currentHistPage, false);
        y = pageHeight - 158 - REPORT_HEADER_CONTENT_GAP;
        currentHistPage.drawLine({ start: { x: timelineX, y: y + 6 }, end: { x: timelineX, y: 102 }, thickness: 1.2, color: border });
        // Safety: skip oversized blocks that won't fit even on a blank page
        if (y - blockHeight < 92) continue;
      }

      const isCreated = histItem.label === 'Criado';
      const isViewed  = histItem.label === 'Visualizado';
      const isSigned  = histItem.label === 'Assinado';
      const isTerms   = histItem.label === 'Termos';

      const viewedColor = rgb(0.35, 0.40, 0.52);
      const termsColor  = rgb(0.45, 0.32, 0.72);
      const dotColor = isSigned ? emerald : isViewed ? viewedColor : isCreated ? orange : isTerms ? termsColor : txtSoft;
      const badgeBg  = isSigned ? emerald : isViewed ? viewedColor : isCreated ? orange : isTerms ? termsColor : navyMid;

      // Timeline node: real circle with white ring + small inner dot
      circleDot(currentHistPage, timelineX, y - 4, 6, white);
      circleDot(currentHistPage, timelineX, y - 4, 5, dotColor);
      circleDot(currentHistPage, timelineX, y - 4, 1.8, white);

      // Event card (rounded) with left accent
      const cardX = timelineX + 18;
      const cardW = pageWidth - lm - cardX;
      const cardTop = y;
      roundRect(currentHistPage, cardX, cardTop, cardW, blockHeight, 7, { fill: bgLight, stroke: border, strokeW: 0.6 });
      roundRect(currentHistPage, cardX, cardTop, 3.5, blockHeight, 1.5, { fill: dotColor });

      // Badge (rounded) + timestamp
      const badgeW = 66;
      roundRect(currentHistPage, cardX + 10, cardTop - 8, badgeW, 14, 7, { fill: badgeBg });
      const blbl = histItem.label.toUpperCase();
      const blblW = helveticaBold.widthOfTextAtSize(blbl, 6.5);
      currentHistPage.drawText(blbl, { x: cardX + 10 + (badgeW - blblW) / 2, y: cardTop - 17, size: 6.5, font: helveticaBold, color: white });
      currentHistPage.drawText(histItem.when, { x: cardX + 10 + badgeW + 10, y: cardTop - 17, size: 7, font: courier, color: txtMid });

      // Detail lines
      let detailY = cardTop - 33;
      for (const line of detailLines.slice(0, 5)) {
        currentHistPage.drawText(line, { x: cardX + 12, y: detailY, size: 7.5, font: helvetica, color: txtDark });
        detailY -= 12;
      }

      y -= blockHeight + eventGap;
    }

    // Footer note on last page
    currentHistPage.drawLine({ start: { x: lm, y: 90 }, end: { x: pageWidth - lm, y: 90 }, thickness: 0.5, color: borderSoft });
    currentHistPage.drawText('Este registro de auditoria é parte integrante do certificado de assinatura. Datas em horário de Manaus (UTC-04:00).', { x: lm, y: 77, size: 6.5, font: helvetica, color: txtSoft });
    currentHistPage.drawText(`Documento ${request.id}  ·  Jurius`, { x: lm, y: 65, size: 6, font: helvetica, color: silver });
  }

  async generateSignedPdf(options: SignedPdfOptions): Promise<{ bytes: Uint8Array; integritySha256: string; pageCount: number }> {
    const { request, signer, originalPdfUrl, creator, attachmentPdfItems, perDocument } = options;
    if (perDocument) {
      console.log('[PER-DOC] generateSignedPdf (PDF) documento único:', perDocument.documentKey, 'código:', perDocument.verificationCode);
    }

    console.log('[PDF] Gerando PDF assinado para:', signer.name);
    console.log('[PDF] signature_image_path:', signer.signature_image_path);
    console.log('[PDF] facial_image_path:', signer.facial_image_path);
    console.log('[PDF] Anexos para compilar:', attachmentPdfItems?.length || 0);

    const originalPdfBytes = await fetch(originalPdfUrl).then((res) => res.arrayBuffer());
    const integrityChunks: Uint8Array[] = [new Uint8Array(originalPdfBytes)];
    const pdfDoc = await PDFDocument.load(originalPdfBytes);

    // No modelo per_document a única fonte é o próprio arquivo (principal OU um anexo);
    // mapeamos o offset 0 tanto para 'main' quanto para a chave do documento em escopo,
    // para que os campos (com document_id = documentKey) caiam na página correta.
    const documentOffsets: Record<string, number> = perDocument
      ? { main: 0, [perDocument.documentKey]: 0 }
      : { main: 0 };
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
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);

    // Images
    console.log('[PDF] Carregando imagem de assinatura...');
    const signatureImage = await this.loadStorageImage(pdfDoc, signer.signature_image_path, true); // true = remover fundo branco
    console.log('[PDF] Carregando imagem facial...');
    const facialImage = await this.loadStorageImage(pdfDoc, signer.facial_image_path);
    console.log('[PDF] Imagens carregadas - assinatura:', !!signatureImage, 'facial:', !!facialImage);

    // Identidade de verificação: no per_document usa o código PRÓPRIO do documento;
    // no consolidado (legado) usa o verification_hash do signatário, como antes.
    const verificationUrl = perDocument
      ? perDocument.verificationUrl
      : (signer.verification_hash
        ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
        : null);

    const qrImage = verificationUrl ? await this.buildQrPng(pdfDoc, verificationUrl) : null;

    // Hash de integridade (do(s) arquivo(s) original(is), antes de assinar). No
    // per_document, integrityChunks já contém apenas a fonte única deste documento.
    const integritySha256 = await this.sha256Hex(this.concatBytes(integrityChunks));

    // Load fields and place signature on marked location(s).
    // No fluxo público os campos vêm do bundle token-scoped (fieldsOverride);
    // a leitura direta de `signature_fields` retorna 401 com o anon revogado e
    // fazia a assinatura cair no fallback (posição padrão na última página).
    let fields: SignatureField[] = [];
    if (Array.isArray(options.fieldsOverride)) {
      fields = options.fieldsOverride;
    } else {
      try {
        fields = await signatureFieldsService.listByRequest(request.id);
      } catch {
        fields = [];
      }
    }

    // Signatários: no fluxo público usar o provider token-scoped (a leitura
    // direta de `signature_signers` também é 401 para o anon). No interno, ler
    // direto da tabela como antes.
    let requestSignersData: Signer[] | null = null;
    if (this.publicReportData?.signers) {
      try {
        requestSignersData = await this.publicReportData.signers(request.id);
      } catch {
        requestSignersData = null;
      }
    }
    if (!requestSignersData) {
      const { data } = await supabase
        .from('signature_signers')
        .select('*')
        .eq('signature_request_id', request.id)
        .order('order', { ascending: true });
      requestSignersData = (data as Signer[] | null) ?? null;
    }
    const signedRequestSigners = (requestSignersData ?? []).filter((item) => item.status === 'signed');

    console.log('[PDF] Campos encontrados:', fields.length, 'Signatários assinados:', signedRequestSigners.length);
    console.log('[PDF] Campos:', fields);

    const pages = pdfDoc.getPages();

    const signerDrawAssets = await Promise.all((signedRequestSigners.length > 0 ? signedRequestSigners : [signer]).map(async (item) => ({
      signer: item,
      signature: item.id === signer.id ? signatureImage : await this.loadStorageImage(pdfDoc, item.signature_image_path, true),
    })));

    // Mapa signatário→imagem (apenas quem JÁ assinou possui imagem).
    const signatureBySignerId = new Map<string, EmbeddedImage | null>(
      signerDrawAssets.map((a) => [a.signer.id, a.signature]),
    );
    const knownSignerIds = new Set<string>(((requestSignersData as Signer[] | null) ?? []).map((s) => s.id));
    // Imagem de reserva para campos SEM signer_id ou com signer_id órfão: a do
    // signatário que está assinando agora (ou a 1ª disponível).
    const fallbackSignature = signatureImage || signerDrawAssets.find((a) => a.signature)?.signature || null;

    // IMPORTANTE: iteramos pelos CAMPOS (não por signatário) para garantir que
    // cada assinatura caia exatamente na página marcada (page_number). O fallback
    // de "última página" abaixo só dispara quando NÃO existe nenhum campo de
    // assinatura — antes ele disparava sempre que o signer_id não casava, jogando
    // a assinatura para a última página mesmo com campos posicionados.
    let drewAnySignature = false;
    const signatureFields = fields.filter((f) => f.field_type === 'signature');
    for (const f of signatureFields) {
      let img: EmbeddedImage | null = null;
      if (f.signer_id) {
        if (signatureBySignerId.has(f.signer_id)) {
          img = signatureBySignerId.get(f.signer_id) ?? null; // signatário assinou
        } else if (knownSignerIds.has(f.signer_id)) {
          continue; // signatário existe mas ainda não assinou → não estampar imagem de outro
        } else {
          img = fallbackSignature; // signer_id órfão → reserva
        }
      } else {
        img = fallbackSignature; // campo sem signer_id → signatário atual
      }
      if (!img) continue;

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
      page.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
      drewAnySignature = true;
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

    // ── Reservar espaço para o rodapé de assinatura ──────────────────────────
    // O strip do rodapé tem 52pt e é desenhado em y=0. Em PDFs que preenchem
    // até a borda inferior (ex: gerados a partir de template), o strip cobriria
    // o texto. Para garantir rodapé limpo em QUALQUER documento, comprimimos
    // levemente o conteúdo de cada página de documento/anexo para cima,
    // liberando a faixa inferior — mesmo comportamento do fluxo DOCX.
    //
    // A assinatura já foi desenhada como conteúdo da página acima, então é
    // comprimida junto, permanecendo alinhada ao documento.
    //
    // As páginas do relatório (criadas depois deste passo) NÃO são afetadas,
    // pois já têm layout próprio com espaço para o rodapé.
    const FOOTER_RESERVED_H = 64;
    const contentPageCount = pdfDoc.getPageCount();
    for (let i = 0; i < contentPageCount; i++) {
      const p = pdfDoc.getPage(i);
      const { width: pw, height: ph } = p.getSize();
      if (ph <= FOOTER_RESERVED_H) continue;
      const s = (ph - FOOTER_RESERVED_H) / ph;
      // Ordem: scaleContent depois translateContent → ponto final = (s·x + tx, s·y + R)
      //   y=0 → R (acima da faixa do rodapé)   |   y=H → H (topo intacto)
      //   x centralizado para compensar a leve redução de largura
      p.scaleContent(s, s);
      p.translateContent((pw * (1 - s)) / 2, FOOTER_RESERVED_H);
    }

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
      integritySha256,
      documentName: perDocument?.documentName,
    });

    // Rodapé com hash de integridade em TODAS as páginas (documento + anexos + relatório)
    const allPages = pdfDoc.getPages();
    for (let i = 0; i < allPages.length; i++) {
      const p = allPages[i];
      const { width: w, height: h } = p.getSize();
      if (i < contentPageCount) {
        this.drawElectronicWatermark({
          page: p,
          pageWidth: w,
          pageHeight: h,
          font: helveticaBold,
        });
      }
      this.drawFooterStamp({
        page: p,
        pageWidth: w,
        pageHeight: h,
        signer,
        verificationUrl,
        qrImage,
        helvetica,
        helveticaBold,
        courier,
        courierBold,
        brandWordmark,
        docHash: '',
        integritySha256,
        variant: 'strip',
        // Páginas de conteúdo têm espaço reservado → fundo branco puro.
        // Páginas do relatório mantêm overlay semitransparente (layout próprio).
        opaqueStrip: i < contentPageCount,
        verificationCode: perDocument?.verificationCode,
        protocol: request.id,
      });
    }

    return { bytes: await pdfDoc.save(), integritySha256, pageCount: contentPageCount };
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
    const { bytes: pdfBytes } = await this.generateSignedPdf(options);

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

  async openFooterMockupPreview(params?: {
    documentName?: string;
    signerName?: string;
    verificationCode?: string;
    protocol?: string;
    originalPdfUrl?: string | null;
    docxContainer?: HTMLElement | null;
  }): Promise<void> {
    const documentName = String(params?.documentName || 'Contrato de Prestação de Serviços').trim();
    const signerName = String(params?.signerName || 'Cliente').trim();
    const verificationCode = String(params?.verificationCode || '2C39E5BA30B17D71').trim().toUpperCase();
    const protocol = String(params?.protocol || '615af4b6-5334-44e6-af69-7f0a9f28222c').trim();
    const verificationUrl = `${window.location.origin}/#/verificar/${verificationCode}`;
    const mockSigner = {
      id: 'mock-signer',
      signature_request_id: 'mock-request',
      name: signerName,
      email: 'mock@example.com',
      status: 'signed',
      auth_method: 'signature_only',
      verification_hash: verificationCode,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Signer;

    let pdfBytes: Uint8Array;
    if (params?.docxContainer) {
      pdfBytes = await this.buildFooterMockupFromDocx({
        docxContainer: params.docxContainer,
        signer: mockSigner,
        verificationUrl,
        verificationCode,
        protocol,
      });
    } else if (params?.originalPdfUrl) {
      pdfBytes = await this.buildFooterMockupFromPdf({
        originalPdfUrl: params.originalPdfUrl,
        signer: mockSigner,
        verificationUrl,
        verificationCode,
        protocol,
      });
    } else {
      pdfBytes = await this.buildStandaloneFooterMockup({
        documentName,
        signer: mockSigner,
        verificationUrl,
        verificationCode,
        protocol,
      });
    }

    // @ts-ignore runtime aceita Uint8Array
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  private async buildStandaloneFooterMockup(params: {
    documentName: string;
    signer: Signer;
    verificationUrl: string;
    verificationCode: string;
    protocol: string;
  }): Promise<Uint8Array> {
    const { documentName, signer, verificationUrl, verificationCode, protocol } = params;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);

    const fitMockTitle = (text: string, size: number, maxW: number) => {
      if (helveticaBold.widthOfTextAtSize(text, size) <= maxW) return text;
      let t = text;
      while (t.length > 1 && helveticaBold.widthOfTextAtSize(`${t}…`, size) > maxW) t = t.slice(0, -1);
      return `${t}…`;
    };
    const safeTitle = fitMockTitle(documentName, 14, pageWidth - 104);

    let qrImage: EmbeddedImage | null = null;
    try {
      qrImage = await this.buildQrPng(pdfDoc, verificationUrl);
    } catch (e) {
      console.warn('[PDF] Erro ao gerar QR do mockup:', e);
    }

    page.drawText(safeTitle, {
      x: 52,
      y: pageHeight - 72,
      size: 14,
      font: helveticaBold,
      color: rgb(0.12, 0.14, 0.18),
    });
    page.drawText(`Prévia visual do rodapé de assinatura para ${signer.name}`, {
      x: 52,
      y: pageHeight - 92,
      size: 9.5,
      font: helvetica,
      color: rgb(0.38, 0.43, 0.50),
    });
    page.drawLine({
      start: { x: 52, y: pageHeight - 110 },
      end: { x: pageWidth - 52, y: pageHeight - 110 },
      thickness: 0.6,
      color: rgb(0.88, 0.91, 0.94),
    });

    this.drawFooterStamp({
      page,
      pageWidth,
      pageHeight,
      signer,
      verificationUrl,
      qrImage,
      helvetica,
      helveticaBold,
      courier,
      courierBold,
      brandWordmark,
      docHash: verificationCode,
      integritySha256: '2B685B8CAC143D86AD84DD064FB4CEFFE20443A03D34042FD1C3AC1495EF5F8',
      variant: 'strip',
      verificationCode,
      protocol,
    });

    return pdfDoc.save();
  }

  private async buildFooterMockupFromPdf(params: {
    originalPdfUrl: string;
    signer: Signer;
    verificationUrl: string;
    verificationCode: string;
    protocol: string;
  }): Promise<Uint8Array> {
    const { originalPdfUrl, signer, verificationUrl, verificationCode, protocol } = params;
    const originalBytes = new Uint8Array(await (await fetch(originalPdfUrl)).arrayBuffer());
    const integritySha256 = await this.sha256Hex(originalBytes);
    const pdfDoc = await PDFDocument.load(originalBytes);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);

    let qrImage: EmbeddedImage | null = null;
    try {
      qrImage = await this.buildQrPng(pdfDoc, verificationUrl);
    } catch (e) {
      console.warn('[PDF] Erro ao gerar QR do mockup (PDF real):', e);
    }

    const pages = pdfDoc.getPages();
    for (const p of pages) {
      const { width: w, height: h } = p.getSize();
      this.drawElectronicWatermark({
        page: p,
        pageWidth: w,
        pageHeight: h,
        font: helveticaBold,
      });
      this.drawFooterStamp({
        page: p,
        pageWidth: w,
        pageHeight: h,
        signer,
        verificationUrl,
        qrImage,
        helvetica,
        helveticaBold,
        courier,
        courierBold,
        brandWordmark,
        docHash: '',
        integritySha256,
        variant: 'strip',
        verificationCode,
        protocol,
      });
    }

    return pdfDoc.save();
  }

  private async buildFooterMockupFromDocx(params: {
    docxContainer: HTMLElement;
    signer: Signer;
    verificationUrl: string;
    verificationCode: string;
    protocol: string;
  }): Promise<Uint8Array> {
    const { docxContainer, signer, verificationUrl, verificationCode, protocol } = params;
    const pdfDoc = await PDFDocument.create();
    const pdfPageWidth = 595.28;
    const pdfPageHeight = 841.89;
    const A4_WIDTH_PX = 794;
    const FOOTER_RESERVED_H = 64;
    const CONTENT_MARGIN_X = 32;
    const CONTENT_MARGIN_TOP = 28;
    const contentTopY = pdfPageHeight - CONTENT_MARGIN_TOP;
    const contentBottomY = FOOTER_RESERVED_H;
    const contentHeightPt = contentTopY - contentBottomY;
    const contentWidthPt = pdfPageWidth - (CONTENT_MARGIN_X * 2);

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);

    let qrImage: EmbeddedImage | null = null;
    try {
      qrImage = await this.buildQrPng(pdfDoc, verificationUrl);
    } catch (e) {
      console.warn('[PDF] Erro ao gerar QR do mockup (DOCX real):', e);
    }

    const docxWrapper = docxContainer.querySelector('.docx-wrapper') || docxContainer;
    const sections = Array.from(docxWrapper.querySelectorAll('section, article, .docx')) as HTMLElement[];
    const pages = sections.length > 0 ? sections : [docxWrapper as HTMLElement];
    const integritySha256 = await this.sha256Hex(new TextEncoder().encode(docxWrapper.textContent || signer.name || 'mockup'));

    for (const section of pages) {
      const originalStyles = {
        boxShadow: section.style.boxShadow,
        width: section.style.width,
        minWidth: section.style.minWidth,
        maxWidth: section.style.maxWidth,
        overflow: section.style.overflow,
      };

      section.style.boxShadow = 'none';
      section.style.width = `${A4_WIDTH_PX}px`;
      section.style.minWidth = `${A4_WIDTH_PX}px`;
      section.style.maxWidth = `${A4_WIDTH_PX}px`;
      section.style.overflow = 'hidden';

      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      try {
        const canvas = await html2canvas(section, {
          scale: 2.5,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 0,
          windowWidth: A4_WIDTH_PX,
        });

        const scalePtPerPx = contentWidthPt / canvas.width;
        const drawWPt = contentWidthPt;
        const scaledHeightPt = canvas.height * scalePtPerPx;
        const drawHPt = Math.min(contentHeightPt, scaledHeightPt);
        const drawX = CONTENT_MARGIN_X;
        const drawY = contentBottomY + (contentHeightPt - drawHPt);

        const imgBytes = await this.canvasToPngBytes(canvas);
        const image = await pdfDoc.embedPng(imgBytes);
        const page = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
        page.drawImage(image, { x: drawX, y: drawY, width: drawWPt, height: drawHPt });

        this.drawElectronicWatermark({
          page,
          pageWidth: pdfPageWidth,
          pageHeight: pdfPageHeight,
          font: helveticaBold,
        });
        this.drawFooterStamp({
          page,
          pageWidth: pdfPageWidth,
          pageHeight: pdfPageHeight,
          signer,
          verificationUrl,
          qrImage,
          helvetica,
          helveticaBold,
          courier,
          courierBold,
          docHash: '',
          integritySha256,
          variant: 'strip',
          opaqueStrip: true,
          verificationCode,
          protocol,
        });
      } finally {
        section.style.boxShadow = originalStyles.boxShadow;
        section.style.width = originalStyles.width;
        section.style.minWidth = originalStyles.minWidth;
        section.style.maxWidth = originalStyles.maxWidth;
        section.style.overflow = originalStyles.overflow;
      }
    }

    return pdfDoc.save();
  }

  /**
   * Gera e salva o PDF assinado no bucket 'assinados', retornando o path
   */
  async saveSignedPdfToStorage(options: SignedPdfOptions): Promise<{ filePath: string; sha256: string; integritySha256: string | null; pageCount: number }> {
    const { bytes: pdfBytes, integritySha256, pageCount } = await this.generateSignedPdf(options);
    const sha256 = await this.sha256Hex(pdfBytes);

    // No per_document o nome inclui a chave do documento para não colidir entre os
    // vários arquivos do MESMO signatário gerados no mesmo instante.
    const keyPart = options.perDocument ? `${options.perDocument.documentKey}_` : '';
    const fileName = `signed_${keyPart}${options.signer.id}_${Date.now()}.pdf`;
    const filePath = `${options.request.id}/${fileName}`;

    await this.persistSignedPdf(filePath, pdfBytes, 'PDF assinado');
    if (options.perDocument) {
      console.log('[PER-DOC] PDF individual salvo:', filePath, 'sha256:', sha256, 'páginas:', pageCount);
    }
    return { filePath, sha256, integritySha256, pageCount };
  }
  /**
   * Gera e salva PDF completo para documentos DOCX
   * Captura o wrapper DOCX inteiro e divide em páginas A4
   */
  async saveSignedDocxAsPdf(options: {
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string } | null;
    docxContainer: HTMLElement;
    attachmentDocxItems?: { documentId: string; container: HTMLElement }[];
    attachmentPdfItems?: { documentId: string; url: string }[];
    fieldsOverride?: SignatureField[];
    /** Modelo per_document: gera o PDF de UM arquivo (o docxContainer) com verificação própria. */
    perDocument?: PerDocumentScope;
  }): Promise<{ filePath: string; sha256: string; integritySha256: string | null; pageCount: number }> {
    const { request, signer, creator, docxContainer, attachmentDocxItems, attachmentPdfItems, fieldsOverride, perDocument } = options;
    // No per_document a chave do documento em escopo é a do arquivo único (o docxContainer),
    // usada para casar signature_fields.document_id e detectar placeholders desse arquivo.
    const scopeDocumentId = perDocument?.documentKey ?? 'main';
    if (perDocument) {
      console.log('[PER-DOC] saveSignedDocxAsPdf documento único:', scopeDocumentId, 'código:', perDocument.verificationCode);
    }

    console.log('[PDF] Convertendo DOCX para PDF...');
    
    const pdfDoc = await PDFDocument.create();
    const pdfPageWidth = 595.28; 
    const pdfPageHeight = 841.89;
    const A4_WIDTH_PX = 794; // A4 @ 96 DPI
    const A4_HEIGHT_PX = 1123; // A4 @ 96 DPI — mesma grade de página virtual usada no designer
    const FOOTER_RESERVED_H = 64; // strip height=52 + 4pt margem — conteúdo escala ~6% p/ rodapé limpo
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
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
    const brandWordmark = await this.getBrandWordmarkImage(pdfDoc);

    const integrityChunks: Uint8Array[] = [];

    const integrityPromises: Promise<Uint8Array | null>[] = [];
    if (perDocument) {
      // Integridade individual: apenas o arquivo original deste documento em escopo.
      for (const src of (perDocument.integritySources ?? [])) {
        if (src) integrityPromises.push(this.fetchBytesFromPathOrUrl(src));
      }
    } else {
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
    }

    const integrityResults = await Promise.all(integrityPromises);
    for (const b of integrityResults) {
      if (b) integrityChunks.push(b);
    }
    if (integrityChunks.length === 0) {
      integrityChunks.push(new TextEncoder().encode(`${request.id}:${signer.id}:${request.document_name || ''}`));
    }
    const integritySha256 = await this.sha256Hex(this.concatBytes(integrityChunks));

    // per_document → identidade própria do documento; consolidado → hash do signatário.
    const verificationUrl = perDocument
      ? perDocument.verificationUrl
      : (signer.verification_hash
        ? `${window.location.origin}/#/verificar/${signer.verification_hash}`
        : null);

    let qrImageForFooter: EmbeddedImage | null = null;
    if (verificationUrl) {
      try {
        qrImageForFooter = await this.buildQrPng(pdfDoc, verificationUrl);
      } catch (e) {
        console.warn('Erro QR footer', e);
      }
    }

    // Fluxo PÚBLICO: via RPC token-scoped; INTERNO: leitura direta.
    let signedRequestSignersDataForDocx: Signer[] | null = null;
    if (this.publicReportData?.signers) {
      signedRequestSignersDataForDocx = await this.publicReportData.signers(request.id);
    }
    if (!signedRequestSignersDataForDocx) {
      const { data } = await supabase
        .from('signature_signers')
        .select('*')
        .eq('signature_request_id', request.id)
        .order('order', { ascending: true });
      signedRequestSignersDataForDocx = (data as Signer[] | null) ?? [];
    }
    const docxSignedRequestSigners = (signedRequestSignersDataForDocx ?? []).filter((item) => item.status === 'signed');
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

      // ── Traduzir campos MANUAIS: grade fixa do designer → sections reais ──────
      // O SignaturePositionDesigner numera as páginas numa grade FIXA de
      // A4_HEIGHT_PX (1123px) sobre o empilhamento contínuo do docx-preview
      // (breakPages:true) e guarda page_number + y_percent relativos a essa grade.
      // O docx-preview, porém, gera uma <section> por página REAL (altura variável,
      // quebras explícitas de página/seção). Logo, "page_number === índice-da-section"
      // NÃO vale quando há quebras ou páginas com altura ≠ 1123px — o campo era
      // descartado (assinatura sumia) ou caía na página/altura errada e o fluxo
      // recorria ao fallback do rodapé. Aqui medimos a geometria real empilhada — o
      // MESMO layout que o designer exibiu — e mapeamos cada campo manual para a
      // section correta + y% interno. Placeholders automáticos ([[ASSINATURA]]) NÃO
      // entram aqui: continuam detectados/posicionados relativos à própria section.
      const manualFieldPlacement = new Map<any, { sectionIdx: number; yPct: number; hPct: number }>();
      const docManualFields = fields.filter((f: any) =>
        f.field_type === 'signature' &&
        (f.document_id || 'main') === documentId &&
        !(typeof f.id === 'string' && f.id.startsWith('auto-'))
      );
      const hasManualFieldForDoc = docManualFields.length > 0;
      if (hasManualFieldForDoc && pages.length > 0) {
        const wrapperTop = (docxWrapper as HTMLElement).getBoundingClientRect().top;
        const geom = pages.map((sec) => {
          const r = sec.getBoundingClientRect();
          return { top: r.top - wrapperTop, height: Math.max(1, r.height) };
        });
        const stackEnd = geom[geom.length - 1].top + geom[geom.length - 1].height;
        for (const f of docManualFields as any[]) {
          const page = Math.max(1, f.page_number ?? 1);
          const absYTop = (page - 1 + (f.y_percent || 0) / 100) * A4_HEIGHT_PX;
          const absH = ((f.h_percent || 0) / 100) * A4_HEIGHT_PX;
          let s = geom.findIndex((g) => absYTop >= g.top && absYTop < g.top + g.height);
          if (s === -1) {
            if (absYTop < 0) s = 0;
            else if (absYTop >= stackEnd) s = geom.length - 1;
            else {
              // topo caiu num gap entre páginas → section cujo início é mais próximo
              s = 0;
              let best = Infinity;
              geom.forEach((g, i) => { const d = Math.abs(absYTop - g.top); if (d < best) { best = d; s = i; } });
            }
          }
          const g = geom[s];
          const localY = absYTop - g.top;
          const yPct = Math.max(0, Math.min(100, (localY / g.height) * 100));
          const hPct = Math.max(1, Math.min(100, (absH / g.height) * 100));
          manualFieldPlacement.set(f, { sectionIdx: s, yPct, hPct });
          console.log(`[PDF] Campo manual mapeado (${documentId}): page_designer=${page} → section=${s + 1}/${geom.length}, yPct=${yPct.toFixed(1)}`);
        }
      }

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
          // Detectar placeholders ANTES do html2canvas (e ocultar o texto).
          // Regra: se o documento tem QUALQUER campo manual, os campos manuais têm
          // precedência e o placeholder automático ([[ASSINATURA]]) é ignorado para
          // este documento (evita assinatura duplicada). Se não há campo manual, o
          // comportamento por placeholder segue intacto.
          if (!hasManualFieldForDoc) {
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
            // 2.5x (~240 DPI) — texto nítido no PDF. 1.5x deixava o conteúdo
            // "comprimido"/borrado. Embutido como PNG (lossless), sem recompressão.
            scale: 2.5,
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
              courier,
              courierBold,
              brandWordmark,
              docHash: '',
              integritySha256,
              variant: 'strip',
              opaqueStrip: true, // espaço reservado → fundo branco puro
              verificationCode: perDocument?.verificationCode,
              protocol: request.id,
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
                const isAuto = typeof field.id === 'string' && field.id.startsWith('auto-');

                // Coordenadas Y do campo relativas à ALTURA REAL desta section.
                // - MANUAL: já traduzido da grade fixa do designer para (section + y%
                //   interno) em manualFieldPlacement — corrige o descasamento de
                //   numeração de páginas designer×docx-preview.
                // - AUTO (placeholder): detectado relativo a esta section.
                let yPercentInSection: number;
                let hPercentInSection: number;
                if (isAuto) {
                  // Placeholder pertence à section em que foi detectado (page_number
                  // = índice da section). Em section única não há o que descartar.
                  if (!isSingleSection && Math.max(1, (field.page_number ?? 1)) !== pageNumberForFields) continue;
                  yPercentInSection = field.y_percent;
                  hPercentInSection = field.h_percent;
                } else {
                  const placement = manualFieldPlacement.get(field);
                  if (!placement || placement.sectionIdx !== sectionIdx) continue;
                  yPercentInSection = placement.yPct;
                  hPercentInSection = placement.hPct;
                }

                // Altura de referência da section: no modo fatiado é a altura total
                // escalada da section; no modo página-única é a própria fatia (drawHPt).
                const refHeightPt = typeof fullScaledHeightPt === 'number' ? fullScaledHeightPt : drawHPt;
                const fieldYTopFull = (yPercentInSection / 100) * refHeightPt;
                const fieldHFull = (hPercentInSection / 100) * refHeightPt;

                // Recorte por fatia (páginas A4 de uma section alta). No modo
                // página-única, sliceStartPt indefinido ⇒ 0 e a fatia é a página toda.
                const effectiveSliceStartPt = typeof sliceStartPt === 'number' ? sliceStartPt : 0;
                const sliceEndPt = effectiveSliceStartPt + drawHPt;
                if (fieldYTopFull + fieldHFull < effectiveSliceStartPt || fieldYTopFull > sliceEndPt) continue;

                const yInSlice = fieldYTopFull - effectiveSliceStartPt;
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
              }
            }
          };

          // Se a section cabe em 1 página A4 (área útil), desenhar como antes.
          if (scaledHeightPt <= contentHeightPt) {
            const fullCanvas = canvas;
            await drawOnePage(fullCanvas, sectionIdx + 1);
            continue;
          }

          // Caso contrário: fatiar verticalmente em páginas A4.
          // PROBLEMA: cortar em pixels fixos parte uma linha de texto ao meio na
          // borda — a metade superior fica colada no rodapé da página N e a
          // metade inferior reaparece no topo da página N+1 (efeito "duplicado").
          // SOLUÇÃO: ajustar o corte para a linha de pixels EM BRANCO mais próxima
          // acima do limite ideal, de modo que cada linha de texto fique inteira
          // em uma única página.
          const sliceHeightPx = Math.floor(contentHeightPt / scalePtPerPx);

          // Janela de busca por espaço em branco acima do limite ideal (~12% da
          // página, suficiente para 1-2 linhas de texto).
          const WHITESPACE_SEARCH_PX = Math.max(40, Math.round(sliceHeightPx * 0.12));
          const sliceCtx = canvas.getContext('2d');

          // Retorna o y (px) onde cortar: a linha branca mais baixa dentro da
          // janela [idealEnd - janela, idealEnd]. Se não achar, corta no ideal.
          const findWhitespaceCut = (idealEndPx: number): number => {
            if (idealEndPx >= canvas.height || !sliceCtx) return Math.min(idealEndPx, canvas.height);
            const searchTop = Math.max(0, idealEndPx - WHITESPACE_SEARCH_PX);
            const bandH = idealEndPx - searchTop;
            if (bandH <= 1) return idealEndPx;
            let data: Uint8ClampedArray;
            try {
              data = sliceCtx.getImageData(0, searchTop, canvas.width, bandH).data;
            } catch {
              return idealEndPx; // canvas tainted → fallback
            }
            const w = canvas.width;
            for (let row = bandH - 1; row >= 0; row--) {
              let white = true;
              const base = row * w * 4;
              for (let col = 0; col < w; col++) {
                const i = base + col * 4;
                if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) { white = false; break; }
              }
              if (white) return searchTop + row + 1;
            }
            return idealEndPx; // sem linha totalmente branca → corta no ideal
          };

          let cursorPx = 0;
          let pageNo = 0;
          while (cursorPx < canvas.height) {
            pageNo++;
            const idealEndPx = Math.min(canvas.height, cursorPx + sliceHeightPx);
            const endPx = findWhitespaceCut(idealEndPx);
            const hPx = Math.max(1, endPx - cursorPx);
            if (hPx <= 0) break;

            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = hPx;
            const ctx = sliceCanvas.getContext('2d');
            if (!ctx) { cursorPx = endPx; continue; }
            ctx.drawImage(canvas, 0, cursorPx, canvas.width, hPx, 0, 0, canvas.width, hPx);

            const pageNumberForFields = isSingleSection ? pageNo : (sectionIdx + 1);
            const sliceStartPt = cursorPx * scalePtPerPx;
            await drawOnePage(sliceCanvas, pageNumberForFields, sliceStartPt, scaledHeightPt);

            cursorPx = endPx;
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
    // No consolidado o container principal é 'main'; no per_document é o arquivo em escopo
    // (principal OU um anexo), para que campos manuais e placeholders casem por document_id.
    await convertDocxContainer({ container: docxContainer, documentId: scopeDocumentId });

    // Fallback: só adicionar assinatura automática se realmente não houver campos para
    // o documento em escopo (nem manual, nem placeholder aplicável).
    const hasMainSignatureField = fields.some((f: any) =>
      f.field_type === 'signature' &&
      (f.signer_id == null || f.signer_id === signer.id) &&
      ((f.document_id || 'main') === scopeDocumentId)
    );

    if (signatureImage && !hasMainSignatureField && !placeholderDetectedByDocument[scopeDocumentId]) {
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
        
        // Adicionar linha de assinatura
        lastPage.drawLine({
          start: { x: sigX - 20, y: sigY - 5 },
          end: { x: sigX + sigW + 20, y: sigY - 5 },
          thickness: 1,
          color: rgb(0.3, 0.3, 0.3),
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
      integritySha256,
      documentName: perDocument?.documentName,
    });

    const allPages = pdfDoc.getPages();
    for (let i = 0; i < allPages.length; i++) {
      if (pagesWithFooterCard.has(i)) continue;
      const p = allPages[i];
      const { width: w, height: h } = p.getSize();
      if (i < pagesWithFooterCard.size) {
        this.drawElectronicWatermark({
          page: p,
          pageWidth: w,
          pageHeight: h,
          font: helveticaBold,
        });
      }
      this.drawFooterStamp({
        page: p,
        pageWidth: w,
        pageHeight: h,
        signer,
        verificationUrl,
        qrImage: qrImageForFooter,
        helvetica,
        helveticaBold,
        courier,
        courierBold,
        brandWordmark,
        docHash: '',
        integritySha256,
        variant: 'strip',
        verificationCode: perDocument?.verificationCode,
        protocol: request.id,
      });
    }

    const pdfBytes = await pdfDoc.save();
    const sha256 = await this.sha256Hex(pdfBytes);

    const keyPart = perDocument ? `${perDocument.documentKey}_` : '';
    const fileName = `signed_${keyPart}${signer.id}_${Date.now()}.pdf`;
    const filePath = `${request.id}/${fileName}`;

    await this.persistSignedPdf(filePath, pdfBytes, 'PDF do DOCX');
    // Nº de páginas de CONTEÚDO deste documento (exclui as páginas do relatório).
    const pageCount = pagesWithFooterCard.size;
    if (perDocument) {
      console.log('[PER-DOC] DOCX individual salvo:', filePath, 'sha256:', sha256, 'páginas:', pageCount);
    }
    return { filePath, sha256, integritySha256, pageCount };
  }

  /**
   * Gera e salva apenas o relatÃ³rio de assinatura (fallback quando nÃ£o conseguimos capturar o DOCX)
   */
  async saveSignatureReportToStorage(options: {
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string } | null;
  }): Promise<{ filePath: string; sha256: string; integritySha256: string | null }> {
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

    const fileName = `report_${signer.id}_${Date.now()}.pdf`;
    const filePath = `${request.id}/${fileName}`;

    await this.persistSignedPdf(filePath, pdfBytes, 'relatório de assinatura');
    return { filePath, sha256, integritySha256: null };
  }

  /**
   * ObtÃ©m URL assinada do PDF assinado do bucket 'assinados'
   */
  async getSignedPdfUrl(signedDocumentPath: string): Promise<string | null> {
    if (!signedDocumentPath) return null;

    // Fluxo PÚBLICO: resolve via edge token-scoped (não lê `assinados` como anon).
    const publicUrl = await this.resolvePublicUrl(signedDocumentPath);
    if (publicUrl) return publicUrl;

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
