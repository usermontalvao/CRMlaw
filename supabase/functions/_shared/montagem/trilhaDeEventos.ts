/**
 * De onde saem os EVENTOS da trilha de auditoria.
 *
 * `linhaDoTempo.ts` responde "em que ordem"; este módulo responde "quais, e o
 * que cada um diz". São as frases que o laudo afirma sobre o que aconteceu —
 * quem abriu, quando se autenticou, por onde, com qual aparelho — e cada uma
 * pode ser lida em juízo.
 *
 * Porte do trecho de montagem do `history` em `addReportPages`
 * (`pdfSignature.service.ts`).
 *
 * Puro de propósito: entra linha de tabela, sai lista de eventos. Sem Supabase,
 * sem pdf-lib, sem relógio próprio — a hora vem formatada por quem chama, com o
 * fuso do escritório.
 */
import {
  formatarDataHoraDoEscritorio,
  interpretarGeolocalizacao,
  ehEmailInternoDePlaceholder,
  paraData,
} from './dadosDoSignatario.ts';
import {
  autenticacaoOtpSemCanal,
  formatarTelefoneConfirmado,
  fraseIdentidadeConfirmada,
  lerIdentidadeConfirmada,
} from './identidadeConfirmada.ts';
import { PRIORIDADE, instanteDosTermos, ordenarTrilha, type EventoDaTrilha } from './linhaDoTempo.ts';

/** Como o emissor é chamado quando o envelope não guarda quem o criou. */
export const EMISSOR_DO_SISTEMA = 'Jurius CRM';

/**
 * A linha de `signature_signers` como a trilha a lê.
 *
 * Nomes em snake_case, iguais aos das colunas: a Edge Function recebe a linha
 * crua do banco, e renomear no meio do caminho é onde um campo se perde.
 */
export type LinhaDeSignatario = {
  id: string;
  name: string;
  cpf?: string | null;
  email?: string | null;
  phone?: string | null;
  auth_provider?: string | null;
  auth_email?: string | null;
  auth_google_sub?: string | null;
  auth_at?: string | null;
  auth_verified_channel?: string | null;
  auth_verified_identifier?: string | null;
  auth_verified_at?: string | null;
  signer_ip?: string | null;
  signer_geolocation?: string | null;
  signer_user_agent?: string | null;
  geolocation_captured_at?: string | null;
  facial_image_path?: string | null;
  facial_captured_at?: string | null;
  viewed_at?: string | null;
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  signed_at?: string | null;
};

/** A linha de `signature_audit_log` que interessa à trilha. */
export type LinhaDeAuditoria = {
  signer_id?: string | null;
  action: string;
  ip_address?: string | null;
  created_at: string;
};

/**
 * A frase de autenticação usada NA TRILHA.
 *
 * Diferente da lista de fatores da capa: aqui ela entra no meio de uma oração
 * corrida, e sem o canal confirmado pelo servidor não se afirma canal nenhum —
 * a mesma regra de `provasDeAutenticacao`, escrita uma vez para os dois lados
 * do laudo nunca divergirem.
 */
export function resumoDeAutenticacaoDaTrilha(signatario: LinhaDeSignatario): string {
  const confirmada = lerIdentidadeConfirmada(signatario);
  if (confirmada) {
    const frase = fraseIdentidadeConfirmada(confirmada);
    return confirmada.canal === 'google' && signatario.auth_google_sub
      ? `${frase}. Google ID: ${signatario.auth_google_sub}`
      : frase;
  }
  const base =
    signatario.auth_provider === 'phone'
      ? autenticacaoOtpSemCanal(signatario.phone)
      : signatario.auth_provider === 'email_link'
        ? 'Autenticação via Link por E-mail'
        : signatario.auth_provider === 'google'
          ? 'Autenticação via Google'
          : 'Autenticação no fluxo de assinatura';
  return signatario.auth_provider === 'google' && signatario.auth_google_sub
    ? `${base}. Google ID: ${signatario.auth_google_sub}`
    : base;
}

/**
 * O trecho "(Número verificado: +55 …)" que abre algumas frases.
 *
 * Some quando a identidade foi confirmada: a frase de autenticação já diz o
 * número, e repeti-lo entre parênteses deixa o evento com cara de formulário
 * preenchido duas vezes.
 */
export function sufixoDeContatoDoSignatario(signatario: LinhaDeSignatario): string {
  const confirmada = lerIdentidadeConfirmada(signatario);
  const authEmail = String(signatario.auth_email || '').trim();
  const telefone = String(signatario.phone || '').trim();
  const emailCru = String(signatario.email || '').trim();

  const contato =
    confirmada?.identificador
    || authEmail
    || (signatario.auth_provider === 'phone' ? formatarTelefoneConfirmado(telefone) : '')
    || (!ehEmailInternoDePlaceholder(emailCru) ? emailCru : '');

  // Identidade confirmada ⇒ o parêntese some INTEIRO, rótulo incluído. Por isso
  // `rotuloIdentificadorConfirmado` não aparece aqui: quando ele seria o certo,
  // não há parêntese nenhum para rotular.
  if (!contato || confirmada) return '';

  const rotulo = authEmail
    ? 'Email'
    : signatario.auth_provider === 'phone' ? 'Telefone informado' : 'Email';
  return ` (${rotulo}: ${contato})`;
}

export type EntradaDaTrilha = {
  /** `signature_requests.created_at`. */
  criadoEm: string | Date | null | undefined;
  /** Quem emitiu. Sem nome, o laudo credita o sistema em vez de deixar em branco. */
  nomeDoEmissor?: string | null;
  /** Só quem JÁ assinou — quem não assinou não tem trilha para contar. */
  signatarios: readonly LinhaDeSignatario[];
  /** A trilha bruta do envelope. Só os `viewed` são usados aqui. */
  auditoria: readonly LinhaDeAuditoria[];
  /** Endereço da página pública dos Termos, já versionada. */
  urlDosTermos: (versao: string) => string;
};

/**
 * Monta a trilha inteira, já ordenada.
 *
 * O que vale a pena saber ao ler:
 *
 * · **cada visita é um cartão.** O `viewed` sai da trilha de auditoria, que
 *   guarda TODAS as aberturas. O `viewed_at` do signatário guarda só a última,
 *   e é usado apenas como reserva para registros antigos;
 * · **os instantes reais têm preferência.** `auth_at`, `facial_captured_at` e
 *   `geolocation_captured_at` são carimbados pelo servidor. Registro antigo não
 *   os tem, e aí a âncora é a primeira visualização — que é aproximação, não
 *   invenção: o ato aconteceu depois de abrir;
 * · **o agente de usuário vai INTEIRO.** O resumo ("Google Chrome") descarta
 *   justamente o que identifica o cliente de verdade. Num documento que serve
 *   de prova, a cadeia crua é o dado; o resumo é cortesia.
 */
export function montarTrilhaDeEventos(entrada: EntradaDaTrilha): EventoDaTrilha[] {
  const { signatarios, auditoria, urlDosTermos } = entrada;
  const eventos: EventoDaTrilha[] = [];

  const quando = (v: string | Date | null | undefined) =>
    formatarDataHoraDoEscritorio(v, { comSegundos: true });
  const instante = (v: string | Date | null | undefined) => paraData(v)?.getTime() ?? 0;

  const criadoEm = paraData(entrada.criadoEm) ?? new Date();
  const emissor = String(entrada.nomeDoEmissor || '').trim() || EMISSOR_DO_SISTEMA;
  eventos.push({
    rotulo: 'Criado',
    quando: quando(criadoEm),
    detalhe: `Documento emitido por ${emissor}.`,
    instante: criadoEm.getTime(),
    prioridade: PRIORIDADE.criado,
  });

  for (const s of signatarios) {
    const geo = interpretarGeolocalizacao(s.signer_geolocation);
    const sufixoContato = sufixoDeContatoDoSignatario(s);
    const sufixoCpf = s.cpf ? `, CPF: ${s.cpf}` : '';
    const ondeEsta = geo.coordenadas
      ? ` localizado em ${geo.coordenadas}${geo.endereco ? ` - ${geo.endereco}` : ''}`
      : '';
    const resumoAuth = resumoDeAutenticacaoDaTrilha(s);

    const uaCru = String(s.signer_user_agent || '').trim();
    const sufixoUa = uaCru ? ` Dispositivo: ${uaCru}` : '';

    // ── Visualizações ──
    const visitas = auditoria.filter((e) => e.action === 'viewed' && e.signer_id === s.id);
    const ancora = visitas[0]?.created_at ?? s.viewed_at ?? s.signed_at ?? null;

    if (visitas.length > 0) {
      for (const v of visitas) {
        const ip = v.ip_address ? ` por meio do IP ${v.ip_address}` : '';
        eventos.push({
          rotulo: 'Visualizado',
          quando: quando(v.created_at),
          detalhe: `${s.name}${sufixoCpf} abriu o documento${ip}`,
          instante: instante(v.created_at),
          prioridade: PRIORIDADE.visualizado,
        });
      }
    } else if (s.viewed_at) {
      eventos.push({
        rotulo: 'Visualizado',
        quando: quando(s.viewed_at),
        detalhe: `${s.name}${sufixoCpf} visualizou este documento`
          + `${s.signer_ip ? ` por meio do IP ${s.signer_ip}` : ''}${ondeEsta}.${sufixoUa}`,
        instante: instante(s.viewed_at),
        prioridade: PRIORIDADE.visualizado,
      });
    }

    // ── Autenticação e localização ──
    if (ancora || s.auth_at) {
      const authEm = s.auth_at ?? ancora;
      const ipDoSignatario = s.signer_ip ? ` por meio do IP ${s.signer_ip}` : '';
      eventos.push({
        rotulo: 'Autenticação',
        quando: quando(authEm),
        detalhe: `${s.name}${sufixoCpf}. ${resumoAuth}${ipDoSignatario ? `${ipDoSignatario}.` : '.'}${sufixoUa}`,
        instante: instante(authEm),
        prioridade: PRIORIDADE.autenticacao,
      });

      if (geo.coordenadas) {
        const geoEm = s.geolocation_captured_at ?? ancora;
        eventos.push({
          rotulo: 'Localização',
          quando: quando(geoEm),
          detalhe: `${s.name}${sufixoContato}${sufixoCpf} ativou a localização com coordenadas `
            + `${geo.coordenadas}${geo.endereco ? ` (${geo.endereco})` : ''}.`,
          instante: instante(geoEm),
          prioridade: PRIORIDADE.localizacao,
        });
      }
    }

    // ── Biometria ──
    if (s.facial_image_path) {
      const facialEm = s.facial_captured_at ?? ancora;
      eventos.push({
        rotulo: 'Biometria facial',
        quando: quando(facialEm),
        detalhe: `${s.name}${sufixoContato}${sufixoCpf} concedeu acesso à câmera e teve a selfie `
          + 'capturada para verificação facial.',
        instante: instante(facialEm),
        prioridade: PRIORIDADE.biometria,
      });
    }

    const assinadoEm = s.signed_at ? instante(s.signed_at) : 0;

    // ── Termos ──
    if (s.terms_accepted_at) {
      const versao = String(s.terms_version || 'v1');
      eventos.push({
        rotulo: 'Termos',
        quando: quando(s.terms_accepted_at),
        detalhe: `${s.name}${sufixoContato}${sufixoCpf} declarou ter lido e aceitado os Termos de `
          + `Uso (versão ${versao})${s.signer_ip ? ` por meio do IP ${s.signer_ip}` : ''}. `
          + `Consulte em ${urlDosTermos(versao)}`,
        // A trava: o aceite é pré-requisito do ato e NUNCA aparece depois dele.
        instante: instanteDosTermos(instante(s.terms_accepted_at), assinadoEm),
        prioridade: PRIORIDADE.termos,
      });
    }

    // ── Assinatura ──
    if (s.signed_at) {
      eventos.push({
        rotulo: 'Assinado',
        quando: quando(s.signed_at),
        detalhe: `${s.name}${sufixoContato}${sufixoCpf} assinou este documento`
          + `${s.signer_ip ? ` por meio do IP ${s.signer_ip}` : ''}${ondeEsta}. ${resumoAuth}${sufixoUa}`,
        instante: assinadoEm,
        prioridade: PRIORIDADE.assinado,
      });
    }
  }

  return ordenarTrilha(eventos);
}
