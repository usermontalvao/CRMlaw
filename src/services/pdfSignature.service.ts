import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { supabase } from '../config/supabase';
import { signatureFieldsService } from './signatureFields.service';
import type { Signer, SignatureRequest, SignatureField } from '../types/signature.types';

interface SignedPdfOptions {
  request: SignatureRequest;
  signer: Signer;
  originalPdfUrl: string;
  creator?: { name: string; email: string } | null;
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
    try {
      // Usar URL pública já que o bucket é público
      const { data } = supabase.storage.from('signatures').getPublicUrl(path);
      if (!data?.publicUrl) {
        console.log('[PDF] URL pública não retornada');
        return null;
      }
      console.log('[PDF] URL pública obtida:', data.publicUrl);
      const response = await fetch(data.publicUrl);
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
          console.error('[PDF] Falha ao embedar imagem, tentando original sem remoção de fundo...');
          // Fallback: tentar com imagem original se a remoção de fundo corrompeu
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
          // Se o pixel é branco ou quase branco (threshold 240)
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

    // Usar largura total da página com margens mínimas
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
      color: rgb(1, 1, 1), // Na verdade, rgb(1,1,1) é branco
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

    // Hash de verificação em TODAS as páginas
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
    page1.drawText('Pontos de autenticacao:', { x: infoX, y: infoY, size: 8, font: helveticaBold, color: rgb(0.2, 0.2, 0.2) });
    infoY -= 14;
    
    // Lista de pontos de autenticação com bullets
    const authPoints: string[] = ['Assinatura manuscrita digital'];
    
    // Método de autenticação
    if (signer.auth_provider === 'google') {
      authPoints.push(`Autenticacao via Google (${signer.auth_email || signer.email || 'verificado'})`);
      if (signer.auth_google_sub) authPoints.push(`Google ID: ${signer.auth_google_sub.slice(0, 8)}...`);
    } else if (signer.auth_provider === 'email_link') {
      authPoints.push(`Autenticacao via Link por E-mail (${signer.auth_email || signer.email || 'verificado'})`);
    } else if (signer.auth_provider === 'phone') {
      authPoints.push(`Autenticacao via Telefone (${signer.phone || 'verificado'})`);
    } else if (signer.email) {
      authPoints.push(`E-mail confirmado: ${signer.email}`);
    }
    
    if (signer.signer_ip) authPoints.push(`Endereco IP: ${signer.signer_ip}`);
    if (geo.coordinates) authPoints.push(`Geolocalizacao: ${geo.coordinates}`);
    if (signer.facial_image_path) authPoints.push('Verificacao facial (selfie)');
    if (ua.device) authPoints.push(`Dispositivo: ${ua.device} - ${ua.browser || 'Navegador'} - ${ua.os || 'Sistema'}`);
    
    for (const point of authPoints) {
      page1.drawText(`• ${point}`, { x: infoX + 5, y: infoY, size: 7, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
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
    
    if (signer.email) {
      page1.drawText(`E-mail confirmado: ${signer.email}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
      infoY -= 10;
    }
    
    if (signer.phone) {
      page1.drawText(`Telefone: ${signer.phone}`, { x: infoX, y: infoY, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
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
      page2.drawText('- - - - - - - - - - - - - - - - - - - - - - - -', { x: photoX + 40, y: wmY + 30, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      page2.drawText('C O N F I D E N T I A L', { x: photoX + 80, y: wmY + 10, size: 14, font: helveticaBold, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      const dateWm = signedAt.toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      page2.drawText(dateWm, { x: photoX + 110, y: wmY - 10, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
      page2.drawText('- - - - - - - - - - - - - - - - - - - - - - - -', { x: photoX + 40, y: wmY - 30, size: 10, font: helvetica, color: rgb(0.45, 0.45, 0.45), opacity: 0.22 });
    } else {
      page2.drawText('Selfie nao coletada', { x: photoX + 100, y: photoY + photoH / 2, size: 14, font: helveticaBold, color: rgb(0.6, 0.6, 0.6) });
    }

    // Seção Fundamentação Legal e Validade
    let legalY = photoY - 30;
    
    // Título da seção
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
    
    // Hash de verificação
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

    // Banner no rodapé em vez de logo
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
    const { request, signer, originalPdfUrl, creator } = options;

    console.log('[PDF] Gerando PDF assinado para:', signer.name);
    console.log('[PDF] signature_image_path:', signer.signature_image_path);
    console.log('[PDF] facial_image_path:', signer.facial_image_path);

    const originalPdfBytes = await fetch(originalPdfUrl).then((res) => res.arrayBuffer());
    const pdfDoc = await PDFDocument.load(originalPdfBytes);

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
        const pageIndex = Math.max(0, (f.page_number ?? 1) - 1);
        const page = pages[pageIndex];
        if (!page) continue;
        const { width, height } = page.getSize();
        const { x, y, w, h } = this.percentToPdfRect(width, height, f);
        console.log('[PDF] Desenhando assinatura na página', pageIndex + 1, '- Posição:', { x, y, w, h }, '- Página:', { width, height });
        console.log('[PDF] Campo original:', { x_percent: f.x_percent, y_percent: f.y_percent, w_percent: f.w_percent, h_percent: f.h_percent });
        page.drawImage(signatureImage, { x, y, width: w, height: h });
      }
    } else if (signatureImage) {
      // Fallback: se não houver campos marcados, colocar assinatura na última página
      console.log('[PDF] Nenhum campo marcado - usando posição padrão na última página');
      const lastPage = pages[pages.length - 1];
      if (lastPage) {
        const { width, height } = lastPage.getSize();
        // Posição padrão: canto inferior direito, acima do rodapé
        const sigWidth = 150;
        const sigHeight = 60;
        const x = width - sigWidth - 80; // 80px da borda direita
        const y = 120; // 120px da borda inferior (acima do footer stamp)
        console.log('[PDF] Desenhando assinatura na posição padrão:', { x, y, sigWidth, sigHeight });
        lastPage.drawImage(signatureImage, { x, y, width: sigWidth, height: sigHeight });
      }
    } else {
      console.log('[PDF] Imagem de assinatura não disponível');
    }

    // Gerar hash do documento
    const docHash = this.generateHash(request.id, signer.id);

    // Always add footer stamp on each page (does not replace the marked fields)
    for (const page of pages) {
      const { width } = page.getSize();
      this.drawFooterStamp({
        page,
        pageWidth: width,
        signer,
        verificationUrl,
        qrImage,
        helvetica,
        helveticaBold,
        docHash,
      });
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
    });

    return await pdfDoc.save();
  }

  async downloadSignedPdf(options: SignedPdfOptions): Promise<void> {
    const pdfBytes = await this.generateSignedPdf(options);

    // @ts-ignore - Uint8Array é aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    
    // Abrir o documento em uma nova aba para visualização
    window.open(url, '_blank');
    
    // Também oferecer opção de download
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${options.request.document_name.replace(/\.pdf$/i, '')}_assinado.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Liberar o URL após um tempo para garantir que o download e a visualização funcionem
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000); // Manter o URL válido por 1 minuto
    }, 1000); // Pequeno delay para garantir que a visualização abra primeiro
  }

  /**
   * Gera e salva o PDF assinado no storage, retornando o path
   */
  async saveSignedPdfToStorage(options: SignedPdfOptions): Promise<string> {
    const pdfBytes = await this.generateSignedPdf(options);
    
    // @ts-ignore - Uint8Array é aceito em runtime
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName = `signed_${options.signer.id}_${Date.now()}.pdf`;
    const filePath = `signed-documents/${options.request.id}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('signatures')
      .upload(filePath, blob, {
        contentType: 'application/pdf',
        upsert: true,
      });
    
    if (error) {
      console.error('[PDF] Erro ao salvar PDF assinado:', error);
      throw new Error(`Erro ao salvar PDF assinado: ${error.message}`);
    }
    
    console.log('[PDF] PDF assinado salvo em:', filePath);
    return filePath;
  }

  /**
   * Obtém URL pública do PDF assinado
   */
  async getSignedPdfUrl(signedDocumentPath: string): Promise<string | null> {
    if (!signedDocumentPath) return null;
    
    const { data, error } = await supabase.storage
      .from('signatures')
      .createSignedUrl(signedDocumentPath, 3600); // 1 hora
    
    if (error || !data?.signedUrl) {
      console.warn('[PDF] Erro ao obter URL do PDF assinado:', error?.message);
      return null;
    }
    
    return data.signedUrl;
  }
}

export const pdfSignatureService = new PdfSignatureService();
