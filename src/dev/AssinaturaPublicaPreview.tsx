/**
 * Bancada das telas públicas de assinatura (`?assinaturapreview=1`).
 *
 * As três telas do redesenho só aparecem em produção com um token válido, um
 * documento carregado e uma assinatura realmente enviada — e a conferência dura
 * cinco segundos. Sem uma bancada, conferir um ajuste de espaçamento significa
 * assinar um documento de verdade.
 *
 * Aqui elas rodam com dados de mentira, em tela cheia (é o tamanho que importa:
 * quem assina está no celular), e com os interruptores que mudam o que existe
 * em mãos — porque metade das armadilhas está justamente no que FALTA: sem
 * selfie (documento de "só assinatura"), sem localização (permissão negada),
 * sem nome (o servidor ainda não respondeu).
 *
 * A selfie de exemplo é um contorno cinza de propósito: rosto de gente não se
 * inventa.
 *
 * Na etapa de identidade os interruptores mudam de assunto: `selfie` liga o
 * e-mail cadastrado e `local` liga o telefone — é o que separa "toque e o código
 * já sai" de "toque e a tela pergunta o contato".
 */
import React, { useState } from 'react';
import TelaDeAbertura from '../components/publicSigning/TelaDeAbertura';
import TelaDeConferencia from '../components/publicSigning/TelaDeConferencia';
import TelaDeComprovante from '../components/publicSigning/TelaDeComprovante';
import EtapaDeIdentidade from '../components/publicSigning/EtapaDeIdentidade';
import { DemoDoDedo, Fio, TINTA, TINTA_2, TINTA_3, sobe } from '../components/publicSigning/ui';

const svg = (conteudo: string, w: number, h: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${conteudo}</svg>`,
  )}`;

const SELFIE_FALSA = svg(
  `<rect width="120" height="160" fill="#dbe1e8"/>
   <circle cx="60" cy="58" r="27" fill="#9aa6b4"/>
   <path d="M8 160c0-30 23-48 52-48s52 18 52 48z" fill="#9aa6b4"/>`,
  120, 160,
);

const ASSINATURA_FALSA = svg(
  `<path fill="none" stroke="#0f172a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
     d="M18 104C48 20 76 16 82 76c6 57-21 63-9 15C82 40 112 28 124 88c9 45 39 33 57-9 15-39 36-27 48 9 12 39 45 21 69-18 18-30 42-21 51 9 9 24 30 27 51 6"/>`,
  360, 130,
);

const DOCS = [
  { documentKey: 'main', displayName: 'Procuração ad judicia.pdf', verificationCode: 'A7K2-9QF4-3XLM', url: '#' },
  { documentKey: 'anexo-1', displayName: 'Contrato de honorários.pdf', verificationCode: 'B3M8-1TR6-7WQD', url: '#' },
];

type Tela = 'abertura' | 'conferencia' | 'comprovante' | 'identidade' | 'assinatura';

/**
 * `?assinaturapreview=conferencia` já abre naquela tela — é o que permite tirar
 * um PNG de cada uma pelo Chrome headless, sem clique nenhum.
 */
const telaInicial = (): Tela => {
  const valor = new URLSearchParams(window.location.search).get('assinaturapreview');
  const validas: Tela[] = ['conferencia', 'comprovante', 'identidade', 'assinatura'];
  return validas.includes(valor as Tela) ? (valor as Tela) : 'abertura';
};

const AssinaturaPublicaPreview: React.FC = () => {
  const [tela, setTela] = useState<Tela>(telaInicial);
  const [comSelfie, setComSelfie] = useState(true);
  const [comLocal, setComLocal] = useState(true);
  const [comNome, setComNome] = useState(true);
  const [comAnexos, setComAnexos] = useState(true);
  // `&pronto=1` na URL abre já no estado verde — serve para o print.
  const [pronto, setPronto] = useState(() => new URLSearchParams(window.location.search).has('pronto'));

  const local = comLocal ? { lat: -15.598912, lng: -56.094878 } : null;
  const nome = comNome ? 'Maria Silva Ribeiro' : '';

  return (
    <>
      {tela === 'abertura' && (
        <TelaDeAbertura
          docName="Procuração ad judicia"
          signerName={nome || undefined}
          pronto={pronto}
          allDocNames={comAnexos
            ? ['Procuração ad judicia', 'Contrato de honorários', 'Declaração de hipossuficiência']
            : ['Procuração ad judicia']}
        />
      )}

      {tela === 'conferencia' && (
        <TelaDeConferencia
          nome={nome || 'Signatário'}
          cpf="123.456.789-09"
          canal="whatsapp"
          selfie={comSelfie ? SELFIE_FALSA : null}
          assinatura={ASSINATURA_FALSA}
          local={local}
        />
      )}

      {tela === 'identidade' && (
        <div style={{
          minHeight: '100dvh', background: '#f8fafc', display: 'flex', flexDirection: 'column',
          // O modal ocupa a tela inteira no celular; 430 px é o tamanho do
          // aparelho, não uma caixa dentro dele.
          width: '100%', maxWidth: 430, margin: '0 auto',
        }}>
          {/* Casca do modal: cabeçalho claro + régua das seis etapas. */}
          <div
            className="flex flex-none items-center justify-between border-b bg-white px-4 pb-2.5 pt-3 sm:px-5"
            style={{ borderColor: '#e7e5e4' }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: '#1A1613' }}>
              jurius<span style={{ color: '#E45C12' }}>.</span>
              <span style={{ fontWeight: 400, color: '#a8a29e' }}>com.br</span>
            </span>
            <span style={{ color: TINTA_3, fontSize: 18 }}>×</span>
          </div>
          <div className="flex-none">
            <Fio tom="trabalhando" progresso={(1 / 6) * 100} brilho={false} />
            <div className="px-4 pb-1 pt-2.5 sm:px-5">
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', color: TINTA_3 }}>
                Etapa <span style={{ color: '#ea580c' }}>1</span> de 6 · Identidade
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-5 sm:pt-5" style={{ paddingBottom: 90 }}>
            <EtapaDeIdentidade
              metodos={{ google: true, whatsapp: true, email: true, phone: false }}
              telefoneMascarado={comLocal ? '··· 9 8404-6375' : null}
              emailMascarado={comSelfie ? 'c···b@dvqlb.com' : null}
              enviando={null}
              urlDeAjuda="#"
              /*
                O widget real do Google é injetado pelo script da Google, que não
                roda aqui. Sem este fac-símile a bancada mentia: parecia que o
                canal do Google havia sumido do redesenho.
              */
              refBotaoGoogle={(el) => {
                if (!el || el.childElementCount) return;
                el.innerHTML = `
                  <div style="display:inline-flex;align-items:center;gap:10px;height:40px;padding:0 16px;
                              border:1px solid #dadce0;border-radius:4px;background:#fff;
                              font:500 14px Roboto,system-ui,sans-serif;color:#3c4043">
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.8 6.6-9.5 6.6-17z"/>
                      <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 010-9.4l-7.8-6.1a24 24 0 000 21.6l7.8-6.1z"/>
                      <path fill="#34A853" d="M24 48c6.2 0 11.5-2.1 15.3-5.6l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.3 0-11.7-3.7-13.6-9.4l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
                    </svg>
                    Fazer login com o Google
                  </div>`;
              }}
              onEscolher={() => {}}
              cabecalho={
                <div className="min-w-0" style={sobe(0, 0.45)}>
                  <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.85px', lineHeight: 1.08, color: TINTA }}>
                    {comNome
                      ? <>Confirme que é você, <span style={{ color: '#ea580c' }}>Maria</span>.</>
                      : <>Confirme que é <span style={{ color: '#ea580c' }}>você</span>.</>}
                  </h2>
                  <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.55, color: TINTA_2, maxWidth: 320 }}>
                    Escolha por onde receber o código de 6 dígitos.
                  </p>
                </div>
              }
            />
          </div>
        </div>
      )}

      {tela === 'assinatura' && (
        <div style={{
          minHeight: '100dvh', background: '#f8fafc', display: 'flex', flexDirection: 'column',
          width: '100%', maxWidth: 430, margin: '0 auto',
        }}>
          <div className="flex flex-none items-center justify-between border-b bg-white px-4 pb-2.5 pt-3 sm:px-5" style={{ borderColor: '#e7e5e4' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#1A1613' }}>
              jurius<span style={{ color: '#E45C12' }}>.</span>
              <span style={{ fontWeight: 400, color: '#a8a29e' }}>com.br</span>
            </span>
            <span style={{ color: TINTA_3, fontSize: 18 }}>×</span>
          </div>
          <div className="flex-none">
            <Fio tom="trabalhando" progresso={(3 / 6) * 100} brilho={false} />
            <div className="px-4 pb-1 pt-2.5 sm:px-5">
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', color: TINTA_3 }}>
                Etapa <span style={{ color: '#ea580c' }}>3</span> de 6 · Assinatura
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 px-4 pt-4 sm:px-5 sm:pt-5">
            <div style={sobe(0, 0.45)}>
              <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.85px', lineHeight: 1.08, color: TINTA }}>
                Assine com o <span style={{ color: '#ea580c' }}>dedo</span>.
              </h2>
              <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.55, color: TINTA_2, maxWidth: 320 }}>
                Desenhe no quadro abaixo. Dá para refazer quantas vezes quiser.
              </p>
            </div>

            <div className="relative mt-4 h-[218px] border bg-white" style={{ borderColor: '#E0DAD1' }}>
              <div aria-hidden className="pointer-events-none absolute inset-x-[22px] bottom-[44px] h-px" style={{ background: '#E8E2DA' }} />
              <div aria-hidden className="pointer-events-none absolute bottom-[24px] left-[22px] text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: '#B4ACA3' }}>
                Maria Silva Ribeiro
              </div>
              <div className="pointer-events-none absolute inset-x-[18px] bottom-[52px] top-[14px]">
                <DemoDoDedo />
              </div>
            </div>
          </div>
        </div>
      )}

      {tela === 'comprovante' && (
        <TelaDeComprovante
          nome={nome || 'Signatário'}
          cpf="123.456.789-09"
          canal="whatsapp"
          selfie={comSelfie ? SELFIE_FALSA : null}
          assinatura={ASSINATURA_FALSA}
          local={local}
          documento="Procuração ad judicia"
          assinadoEm="29/08/2026 14:32"
          protocolo="A7K2-9QF4-3XLM"
          documentosAssinados={comAnexos ? DOCS : []}
          temArquivoAssinado
          urlDeVerificacao="#"
          urlDosTermos="#"
          aoAbrir={() => {}}
          aoCompartilhar={() => {}}
          aoCopiarProtocolo={() => {}}
          aoAbrirDocumento={() => {}}
        />
      )}

      {/* ── Controles da bancada ── */}
      <div
        style={{
          position: 'fixed', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 99999,
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'center',
          padding: '8px 10px', borderRadius: 14, maxWidth: 'calc(100vw - 20px)',
          background: 'rgba(15,23,42,.92)', backdropFilter: 'blur(8px)',
          boxShadow: '0 18px 40px -18px rgba(0,0,0,.7)',
          font: '500 11px ui-monospace, SFMono-Regular, Menlo, monospace', color: '#cbd5e1',
        }}
      >
        {(['abertura', 'identidade', 'assinatura', 'conferencia', 'comprovante'] as Tela[]).map((t) => (
          <Botao key={t} ativo={tela === t} onClick={() => setTela(t)}>{t}</Botao>
        ))}
        <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,.15)', margin: '0 3px' }} />
        <Botao ativo={comNome} onClick={() => setComNome((v) => !v)}>nome</Botao>
        <Botao ativo={comSelfie} onClick={() => setComSelfie((v) => !v)}>selfie</Botao>
        <Botao ativo={comLocal} onClick={() => setComLocal((v) => !v)}>local</Botao>
        <Botao ativo={comAnexos} onClick={() => setComAnexos((v) => !v)}>anexos</Botao>
        <Botao ativo={pronto} onClick={() => setPronto((v) => !v)}>pronto</Botao>
      </div>
    </>
  );
};

const Botao: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({
  ativo, onClick, children,
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '5px 10px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
      border: `1px solid ${ativo ? '#f97316' : 'rgba(255,255,255,.15)'}`,
      background: ativo ? 'rgba(249,115,22,.18)' : 'transparent',
      color: ativo ? '#fdba74' : '#94a3b8',
    }}
  >
    {children}
  </button>
);

export default AssinaturaPublicaPreview;
