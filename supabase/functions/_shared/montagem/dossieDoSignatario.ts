/**
 * Da LINHA do banco para o que o laudo escreve sobre o signatário.
 *
 * Duas leituras, e elas não são a mesma: a **capa** lista fatores de
 * autenticação (frases curtas, uma por linha, na ordem do mais forte ao mais
 * circunstancial), e a **página do signatário** traz uma ficha rotulada. O
 * cliente montava as duas em pontos distantes do mesmo método, com regras
 * parecidas mas NÃO iguais — e as diferenças são de propósito.
 *
 * As duas diferenças que mais surpreendem, e que estão preservadas aqui:
 *
 * 1. o **aparelho** aparece como `iPhone - Safari - iOS` na capa e como
 *    `Safari · iOS · iPhone` na ficha. Ordem e separador diferentes;
 * 2. o **telefone** vai formatado na trilha (`+55 (65) 98404-6375`) e CRU na
 *    ficha, quando não houve confirmação do servidor.
 *
 * Nenhuma das duas é bonita. Arrumar durante o porte faria a bancada acusar
 * divergência entre o documento antigo e o novo, e a diferença seria minha —
 * mudança de conteúdo do laudo entra depois, sozinha, aprovada no olho.
 *
 * Porte de `buildAuthPoints` e do bloco `dataFieldsP2` (`pdfSignature.service.ts`).
 */
import {
  ehEmailInternoDePlaceholder,
  interpretarAgenteDeUsuario,
  interpretarGeolocalizacao,
} from './dadosDoSignatario.ts';
import {
  autenticacaoOtpSemCanal,
  fraseIdentidadeConfirmada,
  lerIdentidadeConfirmada,
  resumoIdentidadeConfirmada,
} from './identidadeConfirmada.ts';
import { provasDeAutenticacao, resumoDoDispositivo } from './provasDeAutenticacao.ts';
import { fichaDoSignatario, type DadoDoSignatario } from './laudoSignatario.ts';
import type { LinhaDeSignatario } from './trilhaDeEventos.ts';

/** A linha de `signature_signers` com os campos que só o laudo usa. */
export type LinhaDeSignatarioNoLaudo = LinhaDeSignatario & {
  role?: string | null;
  signature_image_path?: string | null;
  verification_hash?: string | null;
};

/**
 * A frase de identidade da CAPA, e o Google ID que a acompanha.
 *
 * Sem confirmação do servidor não se afirma canal nenhum — mas ainda se
 * descreve o MÉTODO declarado ("Autenticação via Google (fulano@…)"), que é
 * outra coisa: descrever o caminho não é afirmar que ele foi verificado.
 */
export function identidadeParaACapa(s: LinhaDeSignatarioNoLaudo): {
  frase: string | null;
  googleId: string | null;
} {
  const confirmada = lerIdentidadeConfirmada(s);
  if (confirmada) {
    return {
      frase: fraseIdentidadeConfirmada(confirmada),
      googleId: confirmada.canal === 'google' && s.auth_google_sub ? s.auth_google_sub : null,
    };
  }
  if (s.auth_provider === 'google') {
    return {
      frase: `Autenticação via Google (${s.auth_email || 'não informado'})`,
      googleId: s.auth_google_sub || null,
    };
  }
  if (s.auth_provider === 'email_link') {
    return {
      frase: `Autenticação via Link por E-mail (${s.auth_email || 'não informado'})`,
      googleId: null,
    };
  }
  if (s.auth_provider === 'phone') {
    return { frase: autenticacaoOtpSemCanal(s.phone), googleId: null };
  }
  return { frase: null, googleId: null };
}

/** Os fatores de autenticação do cartão da capa. */
export function provasDoSignatario(s: LinhaDeSignatarioNoLaudo): string[] {
  const geo = interpretarGeolocalizacao(s.signer_geolocation);
  const ua = interpretarAgenteDeUsuario(s.signer_user_agent);
  const identidade = identidadeParaACapa(s);

  return provasDeAutenticacao({
    fraseDeIdentidade: identidade.frase,
    googleId: identidade.googleId,
    ip: s.signer_ip,
    coordenadas: geo.coordenadas,
    temSelfie: !!s.facial_image_path,
    // Capa: aparelho, navegador, sistema — separados por hífen.
    dispositivo: resumoDoDispositivo([ua.aparelho, ua.navegador, ua.sistema]),
  });
}

/**
 * O contato que a FICHA mostra.
 *
 * Preferência: o identificador confirmado pelo servidor, que é o único que o
 * documento pode apresentar como verificado. Depois o e-mail de autenticação,
 * depois o telefone declarado, depois o e-mail cadastrado — nunca o e-mail
 * interno inventado pelo fluxo público, que não é endereço de ninguém.
 */
export function contatoDaFicha(s: LinhaDeSignatarioNoLaudo): string {
  const confirmada = lerIdentidadeConfirmada(s);
  if (confirmada) return confirmada.identificador;
  const authEmail = String(s.auth_email || '').trim();
  const telefone = String(s.phone || '').trim();
  const emailCru = String(s.email || '').trim();
  return authEmail
    || (s.auth_provider === 'phone' ? telefone : '')
    || (!ehEmailInternoDePlaceholder(emailCru) ? emailCru : '')
    || '—';
}

/** A descrição curta da autenticação, para a linha "Autenticação" da ficha. */
export function autenticacaoDaFicha(s: LinhaDeSignatarioNoLaudo): string {
  const confirmada = lerIdentidadeConfirmada(s);
  if (confirmada) return resumoIdentidadeConfirmada(confirmada);
  if (s.auth_provider === 'google') return `Google (${s.auth_email || ''})`;
  if (s.auth_provider === 'email_link') return `E-mail (${s.auth_email || ''})`;
  if (s.auth_provider === 'phone') return autenticacaoOtpSemCanal(s.phone);
  return 'Assinatura direta';
}

/** A ficha inteira, pronta para desenho. */
export function fichaDaLinha(
  s: LinhaDeSignatarioNoLaudo,
  assinadoEm: string,
): DadoDoSignatario[] {
  const geo = interpretarGeolocalizacao(s.signer_geolocation);
  const ua = interpretarAgenteDeUsuario(s.signer_user_agent);
  // Ficha: navegador, sistema, aparelho — separados por ponto médio. Ordem e
  // separador diferentes dos da capa, de propósito (ver o cabeçalho do módulo).
  const aparelho = [ua.navegador, ua.sistema, ua.aparelho].filter(Boolean).join(' · ') || '—';

  return fichaDoSignatario({
    nome: s.name,
    papel: s.role,
    contato: contatoDaFicha(s),
    cpf: s.cpf,
    ip: s.signer_ip,
    localizacao: geo.coordenadas,
    dispositivo: aparelho,
    autenticacao: autenticacaoDaFicha(s),
    termos: s.terms_accepted_at ? `Aceitos · versão ${String(s.terms_version || 'v1')}` : '—',
    assinadoEm,
  });
}
