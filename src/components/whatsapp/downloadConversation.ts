/**
 * "Baixar tudo da conversa": um .zip com TODOS os anexos (áudio, imagem, vídeo,
 * figurinha, PDF e demais documentos) mais o histórico em texto.
 *
 * POR QUE UM PACOTE, E NÃO UM BOTÃO POR ARQUIVO. Cada mídia da conversa vive
 * atrás de uma URL assinada e de curta validade; baixar uma a uma era abrir a
 * bolha, clicar, esperar, rolar, repetir — e no fim ninguém sabia quais tinham
 * vindo. Um atendimento que vira processo precisa do acervo inteiro de uma vez,
 * com nome de arquivo que diga QUANDO e DE QUEM veio.
 *
 * A NUMERAÇÃO NO NOME é o que segura a ordem. Dentro de um .zip a ordem é a do
 * gerenciador de arquivos, não a da conversa; sem o prefixo sequencial, doze
 * áudios chamados "audio.ogg" viravam uma pilha sem cronologia. O prefixo é a
 * posição na conversa, então a ordem alfabética É a ordem em que aconteceu.
 *
 * O `conversa.txt` que vai junto amarra as duas metades: cada linha de mídia cita
 * o nome do arquivo correspondente dentro do pacote.
 */
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { WhatsAppMessage } from '../../types/whatsapp.types';

export interface ProgressoDownload {
  /** Anexos já baixados (com sucesso ou não). */
  feitos: number;
  /** Total de anexos do pacote. */
  total: number;
  /** Etapa atual, para a interface dizer o que está acontecendo. */
  etapa: 'baixando' | 'compactando';
}

export interface ResultadoDownload {
  arquivos: number;
  /** Anexos que não vieram (link expirado, arquivo removido do storage). */
  falhas: number;
}

/** Uma pasta por natureza do anexo — é assim que alguém procura depois. */
const PASTA_POR_TIPO: Record<string, string> = {
  audio: 'audios',
  image: 'imagens',
  video: 'videos',
  sticker: 'figurinhas',
  document: 'documentos',
};

const EXTENSAO_POR_MIME: Record<string, string> = {
  'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/wav': '.wav', 'audio/webm': '.webm',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'application/pdf': '.pdf', 'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
};

/** Quantos anexos buscar ao mesmo tempo. Alto demais derruba conexão fraca. */
const SIMULTANEOS = 4;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Tira do nome o que quebra em Windows/macOS e corta o comprimento. */
function nomeSeguro(bruto: string): string {
  const limpo = bruto
    .replace(/[\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.slice(0, 60) || 'arquivo';
}

function extensaoDe(m: WhatsAppMessage): string {
  const doNome = (m.file_name || '').match(/\.[A-Za-z0-9]{1,8}$/);
  if (doNome) return doNome[0].toLowerCase();
  const doCaminho = (m.storage_path || '').match(/\.[A-Za-z0-9]{1,8}$/);
  if (doCaminho) return doCaminho[0].toLowerCase();
  const mime = (m.media_mime || '').split(';')[0].trim().toLowerCase();
  return EXTENSAO_POR_MIME[mime] || '';
}

function nomeDoAnexo(m: WhatsAppMessage, posicao: number): string {
  const quando = new Date(m.wa_timestamp || m.created_at);
  const carimbo = Number.isNaN(quando.getTime())
    ? 'sem-data'
    : `${quando.getFullYear()}-${doisDigitos(quando.getMonth() + 1)}-${doisDigitos(quando.getDate())}_${doisDigitos(quando.getHours())}h${doisDigitos(quando.getMinutes())}`;
  const origem = m.direction === 'out' ? 'equipe' : 'contato';
  const semExtensao = (m.file_name || '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const miolo = semExtensao ? nomeSeguro(semExtensao) : (PASTA_POR_TIPO[m.type] || 'arquivo').replace(/s$/, '');
  return `${String(posicao).padStart(3, '0')}_${carimbo}_${origem}_${miolo}${extensaoDe(m)}`;
}

/** Linha do histórico em texto. Mídia cita o arquivo que foi para o pacote. */
function linhaDoHistorico(m: WhatsAppMessage, quemContato: string, anexo: string | null): string {
  const quando = new Date(m.wa_timestamp || m.created_at);
  const carimbo = Number.isNaN(quando.getTime()) ? '—' : quando.toLocaleString('pt-BR');
  const quem = m.direction === 'out' ? 'Equipe' : quemContato;
  if (m.deleted_at) return `[${carimbo}] ${quem}: (mensagem apagada)`;
  const partes: string[] = [];
  if (anexo) partes.push(`[anexo: ${anexo}]`);
  else if (m.type !== 'text') partes.push(`[${m.type}]`);
  if (m.content) partes.push(m.content);
  if (m.transcription_text) partes.push(`(transcrição: ${m.transcription_text})`);
  return `[${carimbo}] ${quem}: ${partes.join(' ') || '—'}`;
}

/**
 * Monta e entrega o .zip da conversa.
 *
 * Recebe as mensagens JÁ com as URLs assinadas (quem chama busca o histórico
 * completo pelo serviço). Anexo que não vier não interrompe o pacote: um link
 * vencido não pode custar os outros trinta arquivos — ele é contado em `falhas`
 * e anotado no `conversa.txt`.
 */
export async function baixarConversaCompleta(opts: {
  messages: WhatsAppMessage[];
  contactName: string;
  onProgress?: (p: ProgressoDownload) => void;
}): Promise<ResultadoDownload> {
  const { messages, contactName, onProgress } = opts;
  const zip = new JSZip();

  const anexos = messages.filter(m => !!m.media_url && !m.deleted_at);
  const total = anexos.length;
  const nomePorMensagem = new Map<string, string>();
  anexos.forEach((m, i) => nomePorMensagem.set(m.id, nomeDoAnexo(m, i + 1)));

  const falhados = new Set<string>();
  let feitos = 0;
  onProgress?.({ feitos, total, etapa: 'baixando' });

  // Fila com várias linhas de trabalho: os índices são consumidos por N
  // trabalhadores, então um arquivo grande não trava os pequenos atrás dele.
  let proximo = 0;
  const trabalhar = async () => {
    for (;;) {
      const i = proximo;
      proximo += 1;
      if (i >= anexos.length) return;
      const m = anexos[i];
      const nome = nomePorMensagem.get(m.id)!;
      try {
        const resposta = await fetch(m.media_url as string);
        if (!resposta.ok) throw new Error(String(resposta.status));
        const blob = await resposta.blob();
        zip.folder(PASTA_POR_TIPO[m.type] || 'outros')!.file(nome, blob);
      } catch {
        falhados.add(m.id);
      } finally {
        feitos += 1;
        onProgress?.({ feitos, total, etapa: 'baixando' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEOS, anexos.length) }, trabalhar));

  const cabecalho = [
    `Conversa WhatsApp — ${contactName}`,
    `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
    `Mensagens: ${messages.length} · Anexos no pacote: ${total - falhados.size}${falhados.size ? ` (${falhados.size} indisponíveis)` : ''}`,
    '─'.repeat(60),
  ].join('\n');

  const corpo = messages
    .map(m => {
      const nome = nomePorMensagem.get(m.id);
      return linhaDoHistorico(m, contactName, falhados.has(m.id) ? `${nome} — INDISPONÍVEL` : nome ?? null);
    })
    .join('\n');

  zip.file('conversa.txt', `${cabecalho}\n\n${corpo}\n`);

  onProgress?.({ feitos: total, total, etapa: 'compactando' });
  const pacote = await zip.generateAsync({ type: 'blob' });
  const dia = new Date().toISOString().slice(0, 10);
  saveAs(pacote, `conversa-${nomeSeguro(contactName).replace(/\s+/g, '_')}-${dia}.zip`);

  return { arquivos: total - falhados.size, falhas: falhados.size };
}
