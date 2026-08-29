/**
 * ETAPA 1 · "Confirme que é você."
 *
 * A tela tinha, nesta ordem: rótulo "Verificação", régua laranja, título em
 * serifa itálica de duas linhas, parágrafo de apoio, cartão branco repetindo o
 * nome do documento, divisória "Mais rápido", widget do Google, picote "ou",
 * três cartões de 54 px com coluna de ícone e chevron, e um link de ajuda. Onze
 * blocos para uma pergunta de uma linha — e isso somado ao cabeçalho escuro e à
 * régua de seis segmentos logo acima.
 *
 * Sobraram três coisas: que documento é, por onde mandar o código, e ajuda. O
 * nome do documento saiu do cartão e virou parte da própria frase, que é onde
 * ele já estava sendo lido.
 *
 * O GESTO também mudou. Antes, tocar em "WhatsApp" abria uma tela para conferir
 * um telefone que a linha de cima acabara de exibir. Agora, com o contato na
 * ficha, o toque MANDA o código e vai direto para a tela de digitar; a tela de
 * conferência continua existindo para quem não tem contato cadastrado — e é
 * também onde o erro aparece quando o envio falha.
 *
 * Mora em arquivo próprio para caber na bancada (`?assinaturapreview=1`): sem
 * isso, conferir um ajuste desta etapa exige um token válido e um documento
 * carregado.
 */
import React from 'react';
import { ChevronRight, Mail } from 'lucide-react';
import {
  AcaoPrimaria,
  Roda,
  TINTA,
  TINTA_2,
  TINTA_3,
  Tarja,
  sobe,
} from './ui';

export type MetodoDeCodigo = 'whatsapp' | 'sms' | 'email';

export interface MetodosDisponiveis {
  google: boolean;
  whatsapp: boolean;
  email: boolean;
  phone: boolean;
}

/**
 * Um método na lista.
 *
 * O cartão antigo tinha coluna de ícone com borda própria, título, subtítulo e
 * chevron. Aqui o CONTATO é o que importa — é ele que faz a pessoa reconhecer
 * "sim, sou eu" —, então fica logo abaixo do nome do método, e o resto sai.
 *
 * Enquanto o código está saindo, o chevron vira roda: é o único sinal de que o
 * toque fez alguma coisa antes de a tela trocar.
 */
export const MetodoDeIdentidade: React.FC<{
  nome: string;
  /** Já mascarado. `null` quando não há contato na ficha. */
  contato: string | null;
  icone: React.ReactNode;
  enviando?: boolean;
  ordem?: number;
  onClick: () => void;
}> = ({ nome, contato, icone, enviando, ordem = 0, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-3 text-left transition-colors hover:bg-slate-50"
    style={{ borderColor: '#e7e5e4', minHeight: 58, ...sobe(ordem) }}
  >
    <span className="flex flex-none items-center justify-center">{icone}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-[13.5px] font-semibold tracking-[-0.008em]" style={{ color: TINTA }}>
        {nome}
      </span>
      <span className="mt-0.5 block truncate text-[11px]" style={{ color: TINTA_3 }}>
        {contato || 'Recebe um código de 6 dígitos'}
      </span>
    </span>
    {enviando
      ? <Roda tamanho={16} />
      : <ChevronRight className="h-[15px] w-[15px] flex-none" style={{ color: '#cbd5e1' }} />}
  </button>
);

const ICONE_WHATSAPP = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="#25D366" aria-hidden>
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
  </svg>
);

const ICONE_SMS = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#4F5A69" strokeWidth="1.7" aria-hidden>
    <rect x="6" y="2.5" width="12" height="19" rx="2" />
    <line x1="10" y1="18.5" x2="14" y2="18.5" strokeLinecap="round" />
  </svg>
);

const EtapaDeIdentidade: React.FC<{
  metodos: MetodosDisponiveis;
  nomeDoDocumento?: string | null;
  /** Telefone e e-mail JÁ MASCARADOS. `null` quando não há na ficha. */
  telefoneMascarado: string | null;
  emailMascarado: string | null;
  /** Qual método está mandando o código agora. */
  enviando?: MetodoDeCodigo | null;
  onEscolher: (metodo: MetodoDeCodigo) => void;

  /** Bloco do Google — o widget é montado pelo pai neste nó. */
  refBotaoGoogle?: React.Ref<HTMLDivElement>;
  googleCarregando?: boolean;
  googleErro?: string | null;
  googleNome?: string | null;
  googleEmail?: string | null;
  onContinuarComGoogle?: () => void;

  /** Link de ajuda pelo WhatsApp do escritório. */
  urlDeAjuda?: string | null;

  /** O cabeçalho grande — o pai desenha, porque ele é o mesmo das seis etapas. */
  cabecalho: React.ReactNode;
}> = ({
  metodos, nomeDoDocumento, telefoneMascarado, emailMascarado, enviando, onEscolher,
  refBotaoGoogle, googleCarregando, googleErro, googleNome, googleEmail,
  onContinuarComGoogle, urlDeAjuda, cabecalho,
}) => {
  void nomeDoDocumento; // o nome já vive dentro do cabeçalho

  if (googleNome || googleEmail) {
    return (
      <div>
        {cabecalho}
        <div style={{ marginTop: 18, ...sobe(1) }}>
          <Tarja tom="pronto">
            {googleNome ? `${googleNome} · ` : ''}{googleEmail}
          </Tarja>
        </div>
        <div style={{ marginTop: 16, ...sobe(2) }}>
          <AcaoPrimaria onClick={onContinuarComGoogle}>Continuar</AcaoPrimaria>
        </div>
      </div>
    );
  }

  return (
    <div>
      {cabecalho}

      {googleErro && (
        <div style={{ marginTop: 16, ...sobe(1) }}>
          <Tarja tom="atencao">{googleErro}</Tarja>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {googleCarregando && (
          <div className="flex items-center justify-center gap-2 py-3" style={{ color: TINTA_3 }}>
            <Roda tamanho={16} />
            <span className="text-[12.5px]">Carregando…</span>
          </div>
        )}

        <div className={googleCarregando ? 'pointer-events-none opacity-70' : ''}>
          {/* O widget do Google é o único elemento da tela que não aceita CSS.
              Fica isolado no topo e SEM rótulo próprio ("Mais rápido", picote
              "ou"): ele já se anuncia sozinho, e as duas divisórias antigas
              existiam só para explicar a diferença de aparência. */}
          {metodos.google && (
            <div ref={refBotaoGoogle} className="flex justify-center pb-1" style={sobe(1)} />
          )}

          <div className="flex flex-col gap-2" style={{ marginTop: metodos.google ? 14 : 0 }}>
            {metodos.whatsapp && (
              <MetodoDeIdentidade
                ordem={2}
                nome="WhatsApp"
                contato={telefoneMascarado}
                enviando={enviando === 'whatsapp'}
                icone={ICONE_WHATSAPP}
                onClick={() => onEscolher('whatsapp')}
              />
            )}

            {metodos.email && (
              <MetodoDeIdentidade
                ordem={3}
                nome="E-mail"
                contato={emailMascarado}
                enviando={enviando === 'email'}
                icone={<Mail width={19} height={19} color="#4F5A69" strokeWidth={1.7} />}
                onClick={() => onEscolher('email')}
              />
            )}

            {metodos.phone && (
              <MetodoDeIdentidade
                ordem={4}
                nome="SMS"
                contato={telefoneMascarado}
                enviando={enviando === 'sms'}
                icone={ICONE_SMS}
                onClick={() => onEscolher('sms')}
              />
            )}
          </div>

          {urlDeAjuda && (
            <div className="pt-5 text-center" style={sobe(6)}>
              <button
                type="button"
                onClick={() => window.open(urlDeAjuda, '_blank', 'noopener,noreferrer')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: TINTA_2,
                }}
              >
                Precisa de ajuda? Falar com o escritório
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EtapaDeIdentidade;
