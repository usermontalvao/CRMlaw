/**
 * A conferência — o que a pessoa vê depois de tocar em assinar, enquanto sobem
 * a selfie, o traço e a localização, o servidor confere a identidade e a
 * assinatura entra no documento.
 *
 * É a tela mais perigosa do fluxo: fechar a aba aqui deixa a assinatura pela
 * metade. E era justamente aqui que o aviso NÃO aparecia — o texto "não feche
 * esta janela" só era renderizado quando o documento não tinha nome, ou seja,
 * quase nunca. Quem precisava do recado não recebia.
 *
 * Duas mudanças, e as duas vêm daí:
 *
 *   1. A tarja âmbar é incondicional. Não disputa espaço com etiqueta nenhuma.
 *   2. A tela mostra a PRÓPRIA PROVA sendo conferida — a selfie, o traço do
 *      dedo dela, onde estava, em que aparelho — com uma varredura passando por
 *      cima. Esperar deixa de ser abstrato: dá para ver o que está em análise.
 *
 * Nada no cartão é inventado. Cada campo sai de um estado que a página já tem
 * em mãos no instante em que esta tela sobe (ver `PublicSigningPage`).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  type CanalDeIdentidade,
  descreverAparelho,
  faseDaConferencia,
  explicacaoDaEspera,
  progresso as curvaDeProgresso,
} from '../../utils/assinaturaPublica';
import {
  CartaoDeProva,
  MolduraPublica,
  Rotulo,
  RodapeDeConfianca,
  TINTA,
  TINTA_2,
  TINTA_3,
  Tarja,
  TopoDaMarca,
  sobe,
} from './ui';

/** Carimbo do instante, no relógio de quem assina — é o dele que vale na prova. */
const carimbo = (momento: Date): string =>
  `${momento.toLocaleDateString('pt-BR')} · ${momento.toLocaleTimeString('pt-BR', { hour12: false })}`;

const TelaDeConferencia: React.FC<{
  nome: string;
  cpf?: string | null;
  canal?: CanalDeIdentidade;
  selfie?: string | null;
  assinatura?: string | null;
  local?: { lat: number; lng: number } | null;
}> = ({ nome, cpf, canal = null, selfie, assinatura, local }) => {
  const [decorrido, setDecorrido] = useState(0);
  const montadoEm = useRef(Date.now());
  /** Congelado na montagem: é o instante da assinatura, não o do último tique. */
  const instante = useRef(carimbo(new Date()));
  const aparelho = useRef(descreverAparelho(typeof navigator !== 'undefined' ? navigator.userAgent : ''));

  useEffect(() => {
    const id = window.setInterval(() => {
      setDecorrido((Date.now() - montadoEm.current) / 1000);
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  const pct = curvaDeProgresso(decorrido, 3.2);
  const raio = 36;
  const circunferencia = 2 * Math.PI * raio;
  const restante = circunferencia * (1 - pct / 100);

  return (
    <MolduraPublica
      tom="trabalhando"
      progresso={pct}
      largura={468}
      topo={<TopoDaMarca etiqueta="Envio protegido" />}
      rodape={<RodapeDeConfianca itens={['Conexão segura', 'Dados criptografados', 'Registro auditável']} />}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label="Conferindo e registrando sua assinatura"
        style={{
          position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 14, textAlign: 'center', width: '100%',
        }}
      >
        {/* Uma aura muito leve separa a cerimônia do fundo sem transformar a
            tela em mais um cartão. No celular ela fica contida no centro. */}
        <div
          aria-hidden
          style={{
            position: 'absolute', width: 330, height: 330, top: -86, left: '50%',
            transform: 'translateX(-50%)', borderRadius: 999, pointerEvents: 'none',
            background: 'radial-gradient(circle,rgba(249,115,22,.095) 0%,rgba(249,115,22,.025) 48%,transparent 72%)',
          }}
        />

        <Rotulo style={sobe(0)}>Assinatura em processamento</Rotulo>

        {/* Progresso circular: não promete 100% antes da confirmação real do
            servidor, mas deixa claro que a página continua trabalhando. */}
        <div style={{ position: 'relative', width: 92, height: 92, ...sobe(1, 0.5) }}>
          <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="46" cy="46" r={raio} fill="#fff" stroke="#f1f5f9" strokeWidth="5" />
            <circle
              cx="46"
              cy="46"
              r={raio}
              fill="none"
              stroke="url(#ap-progresso-envio)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circunferencia}
              strokeDashoffset={restante}
              style={{ transition: 'stroke-dashoffset 180ms linear' }}
            />
            <defs>
              <linearGradient id="ap-progresso-envio" x1="0" y1="0" x2="92" y2="92" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fb923c" />
                <stop offset="1" stopColor="#ea580c" />
              </linearGradient>
            </defs>
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ea580c" strokeWidth="2.25"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="5" y="10" width="14" height="11" rx="2.5" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            <span style={{ marginTop: 3, color: TINTA, fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(pct)}%
            </span>
          </div>
        </div>

        <div style={{ position: 'relative', ...sobe(2) }}>
          <h1 style={{
            margin: 0, color: TINTA, fontSize: 24, lineHeight: 1.12, fontWeight: 750,
            letterSpacing: '-.72px', textWrap: 'balance',
          }}>
            Estamos registrando sua assinatura
          </h1>
          <p style={{
            margin: '7px auto 0', minHeight: 20, maxWidth: 300, color: TINTA_2,
            fontSize: 13, fontWeight: 550, lineHeight: 1.45,
          }}>
            {faseDaConferencia(decorrido)}
          </p>
        </div>

        <CartaoDeProva
          nome={nome}
          cpf={cpf}
          canal={canal}
          selfie={selfie}
          assinatura={assinatura}
          local={local}
          aparelho={aparelho.current}
          instante={instante.current}
          conferindo
          style={{ ...sobe(3, 0.5), maxWidth: 370 }}
        />

        {/* Só aparece quando a espera passa do que parece normal. Antes disso,
            explicar já sugeriria que algo vai dar errado. */}
        {explicacaoDaEspera(decorrido) ? (
          <p style={{
            margin: '-4px 0 0', fontSize: 12.5, fontWeight: 500, color: '#6B7280',
            maxWidth: 310, lineHeight: 1.45, ...sobe(4),
          }}>
            {explicacaoDaEspera(decorrido)}
          </p>
        ) : null}

        {/*
          Incondicional. Este é o recado que a tela existe para dar, e ele não
          pode depender de o documento ter nome nem de nada mais.
        */}
        <Tarja tom="atencao" style={{ ...sobe(5), maxWidth: 370 }}>
          <span style={{ display: 'block' }}>
            <strong style={{ display: 'block', color: '#78350f', fontSize: 11.8 }}>
              Mantenha esta página aberta
            </strong>
            <span style={{ color: '#a16207', fontSize: 10.8 }}>
              Se você tentar fechar ou recarregar, o navegador pedirá sua confirmação.
            </span>
          </span>
        </Tarja>

        <p style={{ margin: '-3px 0 0', color: TINTA_3, fontSize: 9.5, lineHeight: 1.35, ...sobe(6) }}>
          Esta tela fechará automaticamente assim que o registro for confirmado.
        </p>
      </div>
    </MolduraPublica>
  );
};

export default TelaDeConferencia;
