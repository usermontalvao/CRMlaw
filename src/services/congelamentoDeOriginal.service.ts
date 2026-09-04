import { docxToPdf, type MarcadorDetectado } from '../utils/docxToPdf';
import { signatureService } from './signature.service';
import {
  planoDeCongelamento,
  frasePreparandoDocumento,
  type ArquivoDeEntrada,
} from '../utils/congelamentoDoOriginal';

/**
 * CONGELAR O ORIGINAL, na criação do envelope.
 *
 * Este módulo é o encanamento de uma decisão: **o `.docx` vira PDF aqui, uma
 * vez, e não no aparelho de quem assina**.
 *
 * Até hoje o Word ia inteiro para o envelope e era o navegador do SIGNATÁRIO
 * que o desenhava, na hora de assinar, para então montar o PDF assinado e
 * mandar tudo pronto — inclusive o hash. Era por isso que a montagem não podia
 * sair do navegador: desenhar Word exige DOM, e nem Deno nem Node têm.
 *
 * Movendo a conversão para cá, três coisas mudam de dono:
 *
 *  1. quem converte é quem CRIA o envelope — pessoa logada, do escritório, e
 *     não a parte adversa do modelo de ameaça;
 *  2. quem assina passa a receber exatamente o arquivo congelado;
 *  3. a partir daqui o envelope é sempre PDF, e a montagem pode ser do
 *     servidor (etapa 2).
 *
 * A conversão continua no navegador porque não há para onde levá-la: o servidor
 * Syncfusion não converte para PDF (o `Export` devolve `application/msword` —
 * não tem `DocIORenderer`), e isso foi medido, não suposto.
 *
 * Vive separado de `signature.service.ts` de propósito: o `docxToPdf` arrasta
 * o `docx-preview` e o Syncfusion junto, e a página PÚBLICA de assinatura
 * importa o service. Misturar os dois colocaria um motor de Word inteiro no
 * pacote de quem só vai assinar.
 *
 * Ver `docs/assinatura-montagem-no-servidor.md`.
 */

/** Um arquivo escolhido para o envelope: recém-enviado (File) ou já no Storage. */
export interface EntradaDoEnvelope {
  nome: string;
  /** Upload manual — o arquivo ainda está na máquina de quem criou. */
  arquivo?: File | null;
  /** Documento gerado/selecionado — já está no Storage. */
  caminho?: string | null;
}

/**
 * De onde o arquivo veio, e como foi convertido.
 *
 * Isto é PROVENIÊNCIA, não prova: explica o histórico a quem for auditar. A
 * impressão digital do arquivo quem calcula é o servidor, relendo o Storage —
 * nada daqui é usado para atestar integridade.
 */
export interface ProvenienciaDeclarada {
  display_name?: string | null;
  original_path?: string | null;
  original_name?: string | null;
  converted_from?: 'docx' | 'doc' | null;
  conversion_engine?: string | null;
  conversion_searchable?: boolean | null;
}

export interface EnvelopeCongelado {
  caminhoPrincipal: string;
  nomePrincipal: string;
  caminhosDosAnexos: string[];
  /** Por chave de documento (`main`, `attachment-0`, …). */
  proveniencia: Record<string, ProvenienciaDeclarada>;
  /** Quantos arquivos precisaram de conversão. */
  convertidos: number;
  /**
   * Os `[[ASSINATURA]]` achados durante a conversão, por chave de documento.
   *
   * POR QUE ISTO SOBE ATÉ AQUI: congelado o original em PDF, o marcador deixa
   * de existir como texto procurável na hora de assinar — ele foi ocultado
   * exatamente para não ser impresso. Se a posição não for guardada agora, ela
   * se perde, e a rubrica cai no rodapé por fallback. Este é o campo que leva a
   * âncora do momento da conversão para o envelope.
   *
   * Vazio quando o documento não tem marcador (o caminho normal do assistente,
   * em que os campos são marcados a mão na tela).
   */
  marcadores: Record<string, MarcadorDetectado[]>;
}

export interface OpcoesDeCongelamento {
  /** Pasta do envelope no Storage. */
  documentId: string;
  /** Recebe a frase para a tela ("Convertendo … (2 de 3)"). */
  onProgress?: (frase: string) => void;
}

const extensaoWord = (nome: string): 'docx' | 'doc' =>
  nome.trim().toLowerCase().endsWith('.doc') ? 'doc' : 'docx';

/** Baixa um arquivo que já está no Storage, pela URL assinada. */
async function baixarDoStorage(caminho: string): Promise<Blob> {
  const url = await signatureService.getDocumentPreviewUrl(caminho);
  if (!url) throw new Error(`Não foi possível abrir o documento "${caminho}".`);
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`Não foi possível baixar o documento "${caminho}".`);
  return await resposta.blob();
}

/**
 * O limite do bucket é de 10 MB, e um `.docx` longo convertido em imagem passa
 * disso com facilidade. Quem criou o envelope não escolheu esse tamanho — o
 * nosso conversor escolheu —, então a mensagem não pode mandar a pessoa
 * "reduzir o arquivo" como se a culpa fosse dela.
 */
function erroDeUpload(erro: unknown, nome: string, convertido: boolean): Error {
  const mensagem = erro instanceof Error ? erro.message : String(erro);
  if (convertido && /10\s?MB|exceed/i.test(mensagem)) {
    return new Error(
      `O PDF gerado a partir de "${nome}" ficou acima de 10 MB. `
      + 'Documentos muito longos ou com muitas imagens ainda não cabem — divida o arquivo ou envie um PDF já pronto.',
    );
  }
  return new Error(mensagem);
}

/**
 * Converte o que precisa, envia tudo para o Storage e devolve os caminhos
 * definitivos do envelope — na ordem: principal primeiro, anexos depois.
 *
 * Não escreve no banco. Quem cria a solicitação é o módulo; quem confere os
 * bytes é a Edge Function `signature-freeze-source`, logo depois.
 */
export async function congelarOriginais(
  entradas: EntradaDoEnvelope[],
  opcoes: OpcoesDeCongelamento,
): Promise<EnvelopeCongelado> {
  const lista = (entradas ?? []).filter((e) => e && (e.arquivo || e.caminho));
  if (lista.length === 0) throw new Error('Nenhum documento selecionado.');

  const plano = planoDeCongelamento(
    lista.map((e): ArquivoDeEntrada => ({ nome: e.nome, caminho: e.caminho ?? null })),
  );

  const desconhecido = plano.find((p) => p.formatoDesconhecido);
  if (desconhecido) {
    throw new Error(
      `"${desconhecido.nomeOriginal}" não é PDF nem Word. Envie o documento em um desses dois formatos.`,
    );
  }

  const totalAConverter = plano.filter((p) => p.converter).length;
  const caminhos: string[] = [];
  const proveniencia: Record<string, ProvenienciaDeclarada> = {};
  const marcadores: Record<string, MarcadorDetectado[]> = {};
  let convertidosAteAqui = 0;

  for (let i = 0; i < plano.length; i++) {
    const passo = plano[i];
    const entrada = lista[i];

    // ── Já é PDF: segue como está ──
    // Reconverter degradaria o arquivo por nada.
    if (!passo.converter) {
      if (entrada.arquivo) {
        try {
          caminhos.push(await signatureService.uploadSignatureDocumentPdf(entrada.arquivo, opcoes.documentId));
        } catch (e) {
          throw erroDeUpload(e, passo.nomeOriginal, false);
        }
      } else {
        caminhos.push(String(entrada.caminho));
      }
      proveniencia[passo.chave] = { display_name: passo.nomeFinal };
      continue;
    }

    // ── Word: converte, envia o PDF e guarda de onde ele veio ──
    convertidosAteAqui += 1;
    opcoes.onProgress?.(frasePreparandoDocumento(convertidosAteAqui, totalAConverter, passo.nomeOriginal));

    const origem = entrada.arquivo ?? (await baixarDoStorage(String(entrada.caminho)));

    // ── POR QUE O MOTOR É FIXO EM `preview`, e não o Syncfusion (que é melhor) ─
    // Os campos de assinatura são marcados na tela SOBRE o Word renderizado
    // pelo `docx-preview`, e ficam guardados como página + porcentagem. O PDF
    // assinado de hoje nasce desse mesmo desenho, então página e geometria
    // batem por construção.
    //
    // O Syncfusion pagina por conta própria: uma quebra em lugar diferente move
    // o campo da página 3 para a 4, e a assinatura sai no lugar errado de um
    // documento jurídico — defeito que só aparece depois de assinado.
    //
    // O `preview` é o MESMO renderizador que a tela de posicionamento usa, e a
    // camada de texto invisível (PDF pesquisável) sai igual nos dois motores.
    // Trocar para o Syncfusion fica para quando a conversão subir para o
    // momento da SELEÇÃO do documento — aí os campos passam a ser marcados
    // sobre o PDF final, e a fidelidade maior deixa de custar geometria.
    // Ver `docs/assinatura-montagem-no-servidor.md`.
    const { blob, engine, searchable, marcadores: achados } = await docxToPdf(
      origem,
      { engine: 'preview', detectarMarcadores: true },
    );

    const arquivoPdf = new File([blob], passo.nomeFinal, { type: 'application/pdf' });
    let caminho: string;
    try {
      caminho = await signatureService.uploadSignatureDocumentPdf(arquivoPdf, opcoes.documentId);
    } catch (e) {
      throw erroDeUpload(e, passo.nomeOriginal, true);
    }

    caminhos.push(caminho);
    proveniencia[passo.chave] = {
      display_name: passo.nomeFinal,
      original_path: passo.caminhoOriginal,
      original_name: passo.nomeOriginal,
      converted_from: extensaoWord(passo.nomeOriginal),
      conversion_engine: engine,
      conversion_searchable: searchable,
    };
    if (achados.length > 0) {
      marcadores[passo.chave] = achados;
    }
  }

  return {
    caminhoPrincipal: caminhos[0],
    nomePrincipal: plano[0].nomeFinal,
    caminhosDosAnexos: caminhos.slice(1),
    proveniencia,
    convertidos: totalAConverter,
    marcadores,
  };
}
