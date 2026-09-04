import React from 'react';
import type { Signer, SignerAuthMethod } from '../types/signature.types';

/**
 * ATÉ ONDE O CLIENTE CHEGOU.
 *
 * A barra de progresso de antes só sabia dizer 0% ou 100% — e 0% é a mesma
 * coisa para quem nunca abriu o link, para quem abriu e desistiu na primeira
 * tela e para quem tirou a selfie e travou no último passo. São três problemas
 * diferentes, com três conversas diferentes, e a tela chamava todos de zero.
 *
 * Esta escada mostra o caminho real da página pública de assinatura, degrau a
 * degrau, com a hora de cada um.
 *
 * A REGRA DA HONESTIDADE: quem assinou passou por todos os degraus, mesmo que
 * não haja carimbo de alguns — os carimbos por etapa são recentes, e as
 * assinaturas antigas simplesmente não os têm. Nesse caso o degrau aparece
 * cumprido, mas sem hora, em vez de aparecer como se o cliente tivesse pulado
 * uma etapa que ele obviamente cumpriu.
 */

export interface DegrauDaAssinatura {
  chave: string;
  rotulo: string;
  em: string | null;
  estado: 'cumprido' | 'aqui' | 'futuro';
  /** Cumprido pela assinatura, sem carimbo próprio (documento antigo). */
  semCarimbo?: boolean;
}

export function montarDegraus(
  signer: Signer | null | undefined,
  opts: { criadaEm: string; authMethod?: SignerAuthMethod | null },
): DegrauDaAssinatura[] {
  const s = signer ?? ({} as Signer);
  const metodo = opts.authMethod ?? 'signature_only';

  const brutos: { chave: string; rotulo: string; em: string | null }[] = [
    { chave: 'enviado', rotulo: 'Enviado', em: opts.criadaEm ?? null },
    { chave: 'abriu', rotulo: 'Abriu o documento', em: s.opened_at ?? s.viewed_at ?? null },
    { chave: 'termos', rotulo: 'Aceitou os termos', em: s.terms_accepted_at ?? null },
  ];

  if (metodo === 'signature_facial' || metodo === 'signature_facial_document') {
    brutos.push({ chave: 'selfie', rotulo: 'Tirou a selfie', em: s.facial_captured_at ?? null });
  }
  if (metodo === 'signature_facial_document') {
    brutos.push({ chave: 'documento', rotulo: 'Enviou o documento com foto', em: s.presented_at ?? null });
  }

  brutos.push({ chave: 'assinou', rotulo: 'Assinou', em: s.signed_at ?? null });

  const assinou = Boolean(s.signed_at);
  const recusou = Boolean(s.refused_at);
  let jaAchouOAtual = false;

  return brutos.map((d) => {
    if (d.em) return { ...d, estado: 'cumprido' as const };
    // A assinatura é a prova de que os degraus anteriores aconteceram.
    if (assinou) return { ...d, estado: 'cumprido' as const, semCarimbo: true };
    if (!jaAchouOAtual && !recusou) {
      jaAchouOAtual = true;
      return { ...d, estado: 'aqui' as const };
    }
    return { ...d, estado: 'futuro' as const };
  });
}

/** O degrau em que a pessoa parou, em uma frase. */
export function ondeParou(degraus: DegrauDaAssinatura[]): string {
  const atual = degraus.find((d) => d.estado === 'aqui');
  if (!atual) return 'Assinatura concluída';
  const anterior = degraus[degraus.indexOf(atual) - 1];
  if (!anterior) return 'Ainda não foi enviado';
  if (atual.chave === 'abriu') return 'Ainda não abriu o documento';
  return `Parou antes de: ${atual.rotulo.toLowerCase()}`;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Fita compacta — cabe numa linha de lista. */
export const FitaDeDegraus: React.FC<{ degraus: DegrauDaAssinatura[] }> = ({ degraus }) => (
  <div className="flex items-center" title={ondeParou(degraus)}>
    {degraus.map((d, i) => (
      <React.Fragment key={d.chave}>
        {i > 0 && (
          <span
            className="h-[2px] w-3 flex-none"
            style={{ background: d.estado === 'cumprido' ? '#16a34a' : '#e7e5df' }}
          />
        )}
        <span
          className="rounded-full flex-none"
          style={{
            width: 9,
            height: 9,
            background: d.estado === 'cumprido' ? '#16a34a' : d.estado === 'aqui' ? '#d97706' : '#ffffff',
            border: `1.5px solid ${d.estado === 'cumprido' ? '#16a34a' : d.estado === 'aqui' ? '#d97706' : '#e7e5df'}`,
            boxShadow: d.estado === 'aqui' ? '0 0 0 3px #fef3c7' : 'none',
          }}
        />
      </React.Fragment>
    ))}
  </div>
);

/** Escada completa, com rótulo e carimbo — para o painel do documento. */
export const EscadaDeAssinatura: React.FC<{ degraus: DegrauDaAssinatura[] }> = ({ degraus }) => (
  <div className="flex items-stretch gap-0 overflow-x-auto">
    {degraus.map((d, i) => {
      const cor = d.estado === 'cumprido' ? '#16a34a' : d.estado === 'aqui' ? '#d97706' : '#cbd5e1';
      return (
        <div key={d.chave} className="flex items-start gap-0 min-w-0 flex-1">
          {i > 0 && (
            <span
              className="mt-[5px] h-[2px] flex-1 min-w-[10px]"
              style={{ background: d.estado === 'cumprido' ? '#16a34a' : '#e7e5df' }}
            />
          )}
          <div className="flex flex-col items-center px-1.5 min-w-0">
            <span
              className="rounded-full flex-none"
              style={{
                width: 11,
                height: 11,
                background: d.estado === 'cumprido' ? '#16a34a' : d.estado === 'aqui' ? '#d97706' : '#ffffff',
                border: `1.5px solid ${cor}`,
                boxShadow: d.estado === 'aqui' ? '0 0 0 3px #fef3c7' : 'none',
              }}
            />
            <span
              className="mt-1.5 text-[10px] font-semibold leading-tight text-center whitespace-nowrap"
              style={{ color: d.estado === 'futuro' ? '#94a3b8' : '#334155' }}
            >
              {d.rotulo}
            </span>
            <span className="text-[9.5px] leading-tight text-center whitespace-nowrap" style={{ color: '#94a3b8' }}>
              {d.em ? hora(d.em) : d.semCarimbo ? 'sem registro da hora' : d.estado === 'aqui' ? 'não chegou aqui' : ''}
            </span>
          </div>
        </div>
      );
    })}
  </div>
);

export default EscadaDeAssinatura;
