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
    signer: Signer;
    verificationUrl?: string | null;
    qrImage?: EmbeddedImage | null;
    helvetica: any;
    helveticaBold: any;
    docHash: string;
  }) {
    const { page, pageWidth, signer, verificationUrl, qrImage, helvetica, helveticaBold, docHash } = params;

    // Usar largura total da pÃ¡gina com margens mÃ­nimas
    const boxH = 82;
    const boxX = 5; // Reduzido de 18 para 5
    const boxY = 10;
    const boxW = pageWidth - 10; // Reduzido de 36 para 10

    // Banner azul no topo
    page.drawRectangle({
      x: boxX,
      y: boxY + boxH - 18,
      width: boxW,
      height: 18,
      color: rgb(0.15, 0.4, 0.85),
    });
    
    // Fundo principal
    page.drawRectangle({
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH - 3,
      color: rgb(0.98, 0.98, 1),
      borderColor: rgb(0.15, 0.4, 0.85),
      borderWidth: 1,
    });

    // Banner com texto centralizado
    page.drawText('DOCUMENTO ASSINADO DIGITALMENTE - Valido conforme MP 2.200-2/2001 e Lei 14.063/2020', {
      x: boxX + (boxW/2) - 160, // Centralizado
      y: boxY + boxH - 14,
      size: 8,
      font: helveticaBold,
      color: rgb(1, 1, 1), // Na verdade, rgb(1,1,1) Ã© branco
    });

    const signedAt = signer.signed_at ? new Date(signer.signed_at) : new Date();
    const dateStr = signedAt.toLocaleString('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    page.drawText(`Assinante: ${signer.name}`, { x: boxX + 10, y: boxY + boxH - 28, size: 7, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
    page.drawText(`E-mail confirmado: ${signer.email || 'N/A'}`, { x: boxX + 10, y: boxY + boxH - 40, size: 6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    page.drawText(`Data/hora: ${dateStr}`, { x: boxX + 10, y: boxY + boxH - 51, size: 6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });

    if (signer.signer_ip) {
      page.drawText(`IP: ${signer.signer_ip}`, { x: boxX + 200, y: boxY + boxH - 40, size: 6, font: helvetica, color: rgb(0.35, 0.35, 0.35) });
    }

    // Hash de verificaÃ§Ã£o em TODAS as pÃ¡ginas
    page.drawText(`Hash SHA256: ${docHash.slice(0, 32)}...`, { x: boxX + 10, y: boxY + boxH - 62, size: 5, font: helvetica, color: rgb(0.4, 0.4, 0.4) });

    if (verificationUrl) {
      page.drawText(`Verificar: ${verificationUrl}`, { x: boxX + 10, y: boxY + 6, size: 5, font: helvetica, color: rgb(0.2, 0.35, 0.7) });
    }

    if (qrImage) {
      const s = 52;
      page.drawImage(qrImage, { x: boxX + boxW - s - 8, y: boxY + 10, width: s, height: s });
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
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const now = new Date();
    const nowStr = now.toLocaleString('pt-BR', {
      timeZone: 'America/Manaus',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // ==================== PÃGINA 1 - RelatÃ³rio de Assinaturas ====================
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

    // SeÃ§Ã£o Assinaturas
    page1.drawText('Assinaturas', { x: lm, y: height - 175, size: 16, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });

    // Card do signatÃ¡rio com Ã­cone verde
    let cardY = height - 210;
    
    // Ãcone de check verde (cÃ­rculo)
    page1.drawCircle({ x: lm + 12, y: cardY + 5, size: 10, color: rgb(0.2, 0.7, 0.3) });
    page1.drawText('v', { x: lm + 8, y: cardY + 1, size: 10, font: helveticaBold, color: rgb(1, 1, 1) });
    
    // Nome e status
    page1.drawText(signer.name.toUpperCase(), { x: lm + 30, y: cardY + 8, size: 11, font: helveticaBold, color: rgb(0.2, 0.7, 0.3) });
    page1.drawText('Assinou', { x: lm + 30, y: cardY - 6, size: 9, font: helvetica, color: rgb(0.2, 0.7, 0.3) });

    // Coluna esquerda - InformaÃ§Ãµes
    let infoY = cardY - 35;
    const infoX = lm;
    
    // Pontos de autenticaÃ§Ã£o
    page1.drawText('Pontos de autenticacao:', { x: infoX, y: infoY, size: 8, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    infoY -= 14;
    
    // Lista de pontos de autenticaÃ§Ã£o com bullets
    const authPoints: string[] = ['Assinatura manuscrita digital'];
    
    // MÃ©todo de autenticaÃ§Ã£o
    if (signer.auth_provider === 'google') {
      authPoints.push(`Autenticacao via Google (${signer.auth_email || 'nao informado'})`);
      if (signer.auth_google_sub) authPoints.push(`Google ID: ${signer.auth_google_sub.slice(0, 8)}...`);
    } else if (signer.auth_provider === 'email_link') {
      authPoints.push(`Autenticacao via Link por E-mail (${signer.auth_email || 'nao informado'})`);
    } else if (signer.auth_provider === 'phone') {
      authPoints.push(`Autenticacao via Telefone (${signer.phone || 'verificado'})`);
    }
    
    if (signer.signer_ip) authPoints.push(`Endereco IP: ${signer.signer_ip}`);
    if (geo.coordinates) authPoints.push(`Geolocalizacao: ${geo.coordinates}`);
    if (signer.facial_image_path) authPoints.push('Verificacao facial (selfie)');
    if (ua.device) authPoints.push(`Dispositivo: ${ua.device} - ${ua.browser || 'Navegador'} - ${ua.os || 'Sistema'}`);
    
    for (const point of authPoints) {
      page1.drawText(`â€¢ ${point}`, { x: infoX + 5, y: infoY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
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
      const maskedToken = `${signer.public_token.slice(0, 8)}****,****,****-${signer.public_token.slice(-12)}`;
      page1.drawText(`Token: ${maskedToken}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
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

    // ==================== PÃGINA 2 - Foto Selfie Grande ====================
    const page2 = pdfDoc.addPage([595.28, 841.89]);

    // TÃ­tulo da foto
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
      
      // Marca d'Ã¡gua CONFIDENTIAL com data (cinza e mais transparente)
      const wmY = photoY + photoH / 2;
      page2.drawText('- - - - - - - - - - - - - - - - - - - - - - - -', { x: photoX + 40, y: wmY + 30, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      page2.drawText('C O N F I D E N T I A L', { x: photoX + 80, y: wmY + 10, size: 14, font: helveticaBold, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      const dateWm = signedAt.toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      page2.drawText(dateWm, { x: photoX + 110, y: wmY - 10, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      page2.drawText('- - - - - - - - - - - - - - - - - - - - - - - -', { x: photoX + 40, y: wmY - 30, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
    } else {
      page2.drawText('Selfie nao coletada', { x: photoX + 100, y: photoY + photoH / 2, size: 14, font: helveticaBold, color: rgb(0.6, 0.6, 0.6) });
    }

    // SeÃ§Ã£o FundamentaÃ§Ã£o Legal e Validade
    let legalY = photoY - 30;
    
    // TÃ­tulo da seÃ§Ã£o
    page2.drawText('FUNDAMENTACAO LEGAL E VALIDADE', { x: lm, y: legalY, size: 11, font: helveticaBold, color: rgb(0.15, 0.4, 0.85) });
    legalY -= 20;
    
    // Texto legal
    page2.drawText('Este documento foi assinado eletronicamente e possui validade juridica conforme:', { x: lm, y: legalY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 14;
    page2.drawText('- Medida Provisoria 2.200-2/2001 - Institui a Infraestrutura de Chaves Publicas Brasileira', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('- Lei 14.063/2020 - Dispoe sobre o uso de assinaturas eletronicas em interacoes com entes publicos', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('- Codigo Civil Brasileiro, Art. 219 - As declaracoes constantes de documentos assinados presumem-se verdadeiras', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    legalY -= 11;
    page2.drawText('- Codigo de Processo Civil, Art. 411 - Considera-se autentico o documento quando a autoria estiver identificada', { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    
    legalY -= 25;
    page2.drawLine({ start: { x: lm, y: legalY }, end: { x: width - lm, y: legalY }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    legalY -= 20;
    
    // Hash de verificaÃ§Ã£o
    page2.drawText('HASH DE VERIFICACAO (SHA256):', { x: lm, y: legalY, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    legalY -= 14;
    const docHash = this.generateHash(request.id, signer.id);
    page2.drawText(docHash, { x: lm, y: legalY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    
    legalY -= 25;
    page2.drawText('VERIFICADOR DE AUTENTICIDADE:', { x: lm, y: legalY, size: 9, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
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
  }

  async generateSignedPdf(options: SignedPdfOptions): Promise<Uint8Array> {
    const { request, signer, originalPdfUrl, creator, attachmentPdfItems } = options;

    console.log('[PDF] Gerando PDF assinado para:', signer.name);
    console.log('[PDF] signature_image_path:', signer.signature_image_path);
    console.log('[PDF] facial_image_path:', signer.facial_image_path);
    console.log('[PDF] Anexos para compilar:', attachmentPdfItems?.length || 0);

    const originalPdfBytes = await fetch(originalPdfUrl).then((res) => res.arrayBuffer());
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

        // Aumentar assinatura 2x, mas ancorando no mesmo ponto do campo.
        // Centralizar pode dar a sensaÃ§Ã£o de "fora do ponto".
        const scale = 2;
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
  async saveSignedPdfToStorage(options: SignedPdfOptions): Promise<string> {
    const pdfBytes = await this.generateSignedPdf(options);
    
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
    return filePath;
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
  }): Promise<string> {
    const { request, signer, creator, docxContainer, attachmentDocxItems, attachmentPdfItems, fieldsOverride } = options;
    
    console.log('[PDF] Convertendo DOCX para PDF...');
    
    const pdfDoc = await PDFDocument.create();
    const pdfPageWidth = 595.28; 
    const pdfPageHeight = 841.89;
    const A4_WIDTH_PX = 794; // A4 @ 96 DPI
    const FOOTER_RESERVED_H = 100; // em pontos (pt) - deve ser >= boxY(10) + boxH(82)
    const contentHeightPt = pdfPageHeight - FOOTER_RESERVED_H;
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
    const docHash = this.generateHash(request.id, signer.id);
    
    const verificationUrl = `${window.location.origin}/#/verificar/${signer.verification_hash || signer.id}`;
    let qrImageForFooter: EmbeddedImage | null = null;
    try {
      qrImageForFooter = await this.buildQrPng(pdfDoc, verificationUrl);
    } catch (e) { console.warn('Erro QR footer', e); }

    const drawSignature2x = (params: {
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
      const { pdfPage, pageW, pageH, x, y, w, h, minY, maxY, signatureImage } = params;
      const scale = 2;
      const desiredW = w * scale;
      const desiredH = h * scale;
      // Ancorar no mesmo ponto do campo (x,y). Centralizar muda o ponto de referÃªncia.
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
        await new Promise((r) => setTimeout(r, 50));

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
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            imageTimeout: 0,
          });

          // Regra: sempre encaixar pela LARGURA.
          // Se a altura ficar maior que a área de conteúdo, fatiar em múltiplas páginas.
          const scalePtPerPx = pdfPageWidth / canvas.width;
          const scaledHeightPt = canvas.height * scalePtPerPx;
          const drawWPt = pdfPageWidth;

          const isSingleSection = pages.length === 1;

          const drawOnePage = async (sliceCanvas: HTMLCanvasElement, pageNumberForFields: number, sliceStartPt?: number, fullScaledHeightPt?: number) => {
            const sliceHeightPt = sliceCanvas.height * scalePtPerPx;
            const drawHPt = sliceHeightPt;
            const drawX = 0;
            const drawY = FOOTER_RESERVED_H + (contentHeightPt - drawHPt);

            const imgData = sliceCanvas.toDataURL('image/png');
            const imgBytes = Uint8Array.from(atob(imgData.split(',')[1]), (c) => c.charCodeAt(0));
            const image = await pdfDoc.embedPng(imgBytes);
            const pdfPage = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
            pdfPage.drawImage(image, { x: drawX, y: drawY, width: drawWPt, height: drawHPt });

            this.drawFooterStamp({
              page: pdfPage,
              pageWidth: pdfPageWidth,
              signer,
              verificationUrl,
              qrImage: qrImageForFooter,
              helvetica,
              helveticaBold,
              docHash,
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

                drawSignature2x({
                  pdfPage,
                  pageW: pdfPageWidth,
                  pageH: pdfPageHeight,
                  x: fieldX,
                  y,
                  w: fieldW,
                  h: fieldHFull,
                  minY: FOOTER_RESERVED_H,
                  maxY: FOOTER_RESERVED_H + contentHeightPt,
                  signatureImage,
                });
              } else {
                // Caso normal: page_number é a section
                if (Math.max(1, (field.page_number ?? 1)) !== pageNumberForFields) continue;
                const fieldYTop = (field.y_percent / 100) * drawHPt;
                const fieldH = (field.h_percent / 100) * drawHPt;
                const isAuto = typeof field.id === 'string' && field.id.startsWith('auto-');
                const y = drawY + (drawHPt - fieldYTop - fieldH) + (isAuto ? PLACEHOLDER_Y_OFFSET_PT : 0);

                drawSignature2x({
                  pdfPage,
                  pageW: pdfPageWidth,
                  pageH: pdfPageHeight,
                  x: fieldX,
                  y,
                  w: fieldW,
                  h: fieldH,
                  minY: FOOTER_RESERVED_H,
                  maxY: FOOTER_RESERVED_H + contentHeightPt,
                  signatureImage,
                });
              }
            }
          };

          // Se a section cabe em 1 página A4 (área útil), desenhar como antes.
          if (scaledHeightPt <= contentHeightPt) {
            const fullCanvas = canvas;
            await drawOnePage(fullCanvas, sectionIdx + 1);
            return;
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
          drawSignature2x({
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
    if (!qrImage) {
        try {
          const qrDataUrl = await QRCode.toDataURL(verificationUrl, { width: 150, margin: 1 });
          const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), c => c.charCodeAt(0));
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
    
    const pdfBytes = await pdfDoc.save();
    
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
    return filePath;
  }

  /**
   * Gera e salva apenas o relatÃ³rio de assinatura (fallback quando nÃ£o conseguimos capturar o DOCX)
   */
  async saveSignatureReportToStorage(options: {
    request: SignatureRequest;
    signer: Signer;
    creator?: { name: string; email: string } | null;
  }): Promise<string> {
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
    const verificationUrl = `${window.location.origin}/#/verificar/${signer.verification_hash || signer.id}`;
    let qrImage: EmbeddedImage | null = null;
    try {
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, { width: 150, margin: 1 });
      const qrBytes = Uint8Array.from(atob(qrDataUrl.split(',')[1]), c => c.charCodeAt(0));
      qrImage = await pdfDoc.embedPng(qrBytes);
    } catch (e) {
      console.warn('[PDF] Erro ao gerar QR code:', e);
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
    return filePath;
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
