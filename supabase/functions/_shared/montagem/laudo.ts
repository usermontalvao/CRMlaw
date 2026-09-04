/**
 * O LAUDO INTEIRO — capa, uma página por signatário, e a trilha de auditoria.
 *
 * Cada peça já existe e tem teste próprio; o que faltava era quem as põe na
 * ordem, cria as páginas e reaproveita o mesmo cabeçalho em todas. É o
 * equivalente de `addReportPages` (`pdfSignature.service.ts`, ~1.065 linhas)
 * reconstruído a partir dos módulos compartilhados.
 *
 * A diferença de FORMA em relação ao cliente: aqui não há busca no banco. Todo
 * dado chega pronto — signatários, trilha, imagens já embutidas — e este módulo
 * só desenha. É o que permite exercitá-lo na bancada, com pdf-lib de verdade,
 * sem Supabase e sem navegador.
 *
 * A única divergência de CONTEÚDO deliberada em relação ao cliente é o QR, que
 * passou de imagem PNG a retângulos vetoriais (ver `qr-em-retangulos.ts`):
 * nítido em qualquer zoom, mais leve, e conferido pixel a pixel contra o PNG da
 * própria biblioteca.
 */
import {
  FOLHA_DO_LAUDO,
  desenharCabecalhoDoLaudo,
  type FontesDoLaudo,
  type IdentidadeDoLaudo,
} from './laudoCabecalho.ts';
import { desenharCapaDoLaudo, type SignatarioNaCapa } from './laudoCapa.ts';
import { desenharPaginaDoSignatario } from './laudoSignatario.ts';
import { desenharTrilha } from './laudoTrilha.ts';
import { fichaDaLinha, provasDoSignatario, type LinhaDeSignatarioNoLaudo } from './dossieDoSignatario.ts';
import { formatarDataHoraDoEscritorio } from './dadosDoSignatario.ts';
import type { EventoDaTrilha } from './linhaDoTempo.ts';
import type { FerramentasDeForma, PaginaPdf, PaletaDoLaudo } from './laudoDesign.ts';
import type { MatrizDoQr } from './rodape.ts';

/** Os títulos das três seções, em um lugar só. */
export const TITULOS_DO_LAUDO = {
  capa: 'CERTIFICADO DE ASSINATURA',
  signatario: 'BIOMETRIA & VERIFICAÇÃO',
  trilha: 'TRILHA DE AUDITORIA',
} as const;

export type SignatarioNoLaudo = {
  /** A linha crua de `signature_signers`. */
  linha: LinhaDeSignatarioNoLaudo;
  /** A rubrica já embutida no documento. Ausente ⇒ caixa de assinatura vazia. */
  rubrica?: unknown | null;
  /** A selfie já embutida, com as dimensões naturais (para o "contain"). */
  foto?: { imagem: unknown; largura: number; altura: number } | null;
  /** A matriz do QR — vetorial, não imagem. */
  qr?: MatrizDoQr | null;
  /** A URL que o QR aponta, escrita por extenso no bloco do certificado. */
  urlDeVerificacao: string | null;
};

export type EntradaDoLaudo = {
  /** Só o que este módulo precisa de um `PDFDocument`. */
  documento: { addPage: (tamanho: [number, number]) => PaginaPdf };
  fontes: FontesDoLaudo;
  cores: PaletaDoLaudo;
  ferramentas: FerramentasDeForma & { degrees: (graus: number) => unknown };
  identidade: IdentidadeDoLaudo;
  signatarios: readonly SignatarioNoLaudo[];
  /** A trilha, JÁ ordenada por `montarTrilhaDeEventos`. */
  eventos: readonly EventoDaTrilha[];
  /** SHA-256 do documento de ORIGEM, antes de assinar. */
  sha256DoOriginal: string;
  wordmark?: { imagem: unknown; ratio: number } | null;
  logo?: unknown | null;
};

/** Quantas páginas o laudo produziu, por seção. */
export type ResumoDoLaudo = {
  capa: number;
  signatarios: number;
  trilha: number;
  total: number;
};

/**
 * Desenha o laudo completo, acrescentando páginas ao documento recebido.
 *
 * As páginas do laudo NÃO passam pela reserva de faixa do rodapé: elas já
 * nascem com o layout próprio, com espaço embaixo. Quem monta o artefato final
 * abre a faixa só nas folhas de conteúdo, ANTES de chamar isto.
 */
export function desenharLaudo(entrada: EntradaDoLaudo): ResumoDoLaudo {
  const {
    documento, fontes, cores, ferramentas, identidade, signatarios, eventos,
    sha256DoOriginal, wordmark, logo,
  } = entrada;

  const folha: [number, number] = [FOLHA_DO_LAUDO.largura, FOLHA_DO_LAUDO.altura];

  /** Página nova já com o papel timbrado — as três seções usam o MESMO. */
  const novaPagina = (titulo: string, subtitulo?: string | null): PaginaPdf => {
    const pagina = documento.addPage(folha);
    desenharCabecalhoDoLaudo({
      pagina, fontes, cores, identidade, titulo, subtitulo, logo, wordmark,
    });
    return pagina;
  };

  // ── 1. A capa ──────────────────────────────────────────────────────────
  const naCapa: SignatarioNaCapa[] = signatarios.map(({ linha, rubrica }) => ({
    nome: linha.name,
    papel: linha.role ?? null,
    assinadoEm: formatarDataHoraDoEscritorio(linha.signed_at, { comSegundos: true }),
    provas: provasDoSignatario(linha),
    rubrica: rubrica ?? null,
  }));

  desenharCapaDoLaudo({
    pagina: novaPagina(TITULOS_DO_LAUDO.capa),
    fontes, cores, ferramentas,
    signatarios: naCapa,
    emitidoEm: identidade.emitidoEm,
  });

  // ── 2. Uma página por signatário ───────────────────────────────────────
  //
  // UMA POR SIGNATÁRIO, sempre — inclusive quando o cartão dele não coube na
  // capa. A capa é resumo e pode transbordar; esta seção é o dossiê, e um
  // signatário sem página seria um ato sem prova no documento.
  for (const s of signatarios) {
    const pagina = novaPagina(TITULOS_DO_LAUDO.signatario, `Signatário: ${s.linha.name}`);
    desenharPaginaDoSignatario({
      pagina, fontes, cores,
      ferramentas: { rgb: ferramentas.rgb, degrees: ferramentas.degrees },
      wordmark,
      conteudo: {
        nome: s.linha.name,
        ficha: fichaDaLinha(
          s.linha,
          formatarDataHoraDoEscritorio(s.linha.signed_at, { comSegundos: true }),
        ),
        foto: s.foto ?? null,
        qr: s.qr ?? null,
        codigoDoDocumento: identidade.codigo,
        protocolo: identidade.protocolo,
        sha256DoOriginal,
        urlDeVerificacao: s.urlDeVerificacao,
      },
    });
  }

  // ── 3. A trilha ────────────────────────────────────────────────────────
  const { paginasUsadas } = desenharTrilha({
    paginaInicial: novaPagina(TITULOS_DO_LAUDO.trilha),
    novaPagina: () => novaPagina(TITULOS_DO_LAUDO.trilha),
    fontes, cores, rgb: ferramentas.rgb,
    eventos,
    protocolo: identidade.protocolo,
  });

  return {
    capa: 1,
    signatarios: signatarios.length,
    trilha: paginasUsadas,
    total: 1 + signatarios.length + paginasUsadas,
  };
}
