/**
 * A REDE DE SEGURANÇA das páginas públicas de assinatura.
 *
 * ┌── O que ela conserta ───────────────────────────────────────────────────┐
 * │ A página abria, ficava carregando, dizia que estava demorando mais que  │
 * │ o normal — e virava uma TELA BRANCA. Sem mensagem, sem botão, sem       │
 * │ caminho de volta. Quem estava do outro lado tinha que adivinhar que o   │
 * │ conserto era recarregar; a maioria só fecha e desiste de assinar.       │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A causa é estrutural e valia para TODAS as rotas públicas: não existia
 * fronteira de erro em lugar nenhum do aplicativo. No React 18, um erro
 * durante a renderização que não encontra fronteira desmonta a árvore INTEIRA
 * — e o que sobra é literalmente um `<body>` vazio. Branco.
 *
 * As duas causas mais prováveis aqui, e as duas terminam em branco:
 *
 *  1. O PEDAÇO DE CÓDIGO QUE NÃO CHEGA. A página de assinatura é carregada sob
 *     demanda (`React.lazy`). Numa rede de celular instável — ou quando um
 *     deploy troca os arquivos com a aba já aberta — esse download falha, o
 *     `import()` rejeita, e a rejeição sobe como erro de renderização.
 *  2. Um erro dentro do leitor durante a montagem do documento.
 *
 * ── A POSTURA ───────────────────────────────────────────────────────────────
 *
 * Primeiro TENTA SOZINHA. Falha de download se resolve recarregando em
 * praticamente todos os casos, e ninguém deveria precisar aprender isso: a
 * rede recarrega a página UMA vez, sozinha, sem perguntar. O limite de uma vez
 * é o que impede a página de entrar em laço quando o problema é permanente —
 * a marca vive no `sessionStorage` e é presa ao token, então cada link tem
 * direito à sua tentativa, e fechar a aba zera tudo.
 *
 * Só depois da segunda queda ela FALA — e fala com o que a pessoa precisa:
 * um botão para tentar de novo, o código do atendimento para copiar e o
 * caminho para o escritório.
 *
 * ── POR QUE ESTE ARQUIVO NÃO IMPORTA NADA ───────────────────────────────────
 *
 * Nem o `ui.tsx` das telas públicas, nem ícones, nem Tailwind. Uma rede de
 * segurança que depende do que acabou de quebrar não é rede de segurança: se o
 * pedaço de código que falhou for justamente o do leitor, qualquer import dele
 * aqui derruba a tela de socorro junto. Tudo aqui é estilo em linha, e o
 * arquivo é pequeno de propósito.
 */
import React from 'react';

/** Uma recarga automática por token, por aba. É o que impede o laço. */
const CHAVE_RECARGA = 'jurius:assinatura:recarga-automatica';

/**
 * Falha de CARREGAMENTO de código (não de lógica). São as que a recarga
 * conserta quase sempre, e o navegador as anuncia com nomes diferentes em
 * cada motor — daí a lista.
 */
export function pareceFalhaDeCarregamento(erro: unknown): boolean {
  const e = erro as { name?: string; message?: string } | null;
  const texto = `${e?.name || ''} ${e?.message || ''}`.toLowerCase();
  return (
    texto.includes('dynamically imported module') ||
    texto.includes('importing a module script failed') ||
    texto.includes('loading chunk') ||
    texto.includes('chunkloaderror') ||
    texto.includes('failed to fetch') ||
    texto.includes('networkerror') ||
    texto.includes('load failed')
  );
}

interface Props {
  /** Vai para a tela de socorro como código de atendimento. */
  token?: string;
  /** Nome da tela, só para o registro no console. */
  onde?: string;
  children: React.ReactNode;
}

interface Estado {
  caiu: boolean;
  mensagem: string;
  copiado: boolean;
}

export class RedeDeSeguranca extends React.Component<Props, Estado> {
  state: Estado = { caiu: false, mensagem: '', copiado: false };

  static getDerivedStateFromError(erro: unknown): Partial<Estado> {
    const e = erro as { message?: string } | null;
    return { caiu: true, mensagem: e?.message || '' };
  }

  componentDidCatch(erro: unknown) {
    // O registro é para quem for investigar depois; a pessoa não vê nada disto.
    console.error(`[assinatura] a tela "${this.props.onde || 'pública'}" caiu:`, erro);

    const marca = `${this.props.token || 'sem-token'}`;
    let jaTentou = true;
    try {
      jaTentou = sessionStorage.getItem(CHAVE_RECARGA) === marca;
      if (!jaTentou) sessionStorage.setItem(CHAVE_RECARGA, marca);
    } catch {
      /* Aba anônima com armazenamento bloqueado: sem marca, sem recarga
         automática. Melhor não tentar do que arriscar o laço. */
    }

    if (!jaTentou) {
      window.setTimeout(() => window.location.reload(), 120);
    }
  }

  private tentarDeNovo = () => {
    // A tentativa manual tem direito a uma automática de novo depois dela.
    try { sessionStorage.removeItem(CHAVE_RECARGA); } catch { /* sem armazenamento */ }
    window.location.reload();
  };

  private copiarCodigo = async () => {
    const codigo = this.props.token;
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      this.setState({ copiado: true });
      window.setTimeout(() => this.setState({ copiado: false }), 2200);
    } catch {
      /* Sem permissão de área de transferência: o código continua na tela para
         ser lido em voz alta. */
    }
  };

  render() {
    if (!this.state.caiu) return this.props.children as React.ReactElement;

    const { token } = this.props;
    const tinta = '#0f172a';
    const tinta2 = '#64748b';
    const tinta3 = '#94a3b8';

    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#f8fafc', padding: '28px 22px',
          fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{
            height: 3, width: 46, borderRadius: 99, marginBottom: 22,
            background: 'linear-gradient(90deg,#c2410c,#ea580c 60%,#f97316)',
          }} />

          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '.18em',
            textTransform: 'uppercase', color: '#ea580c',
          }}>
            Não foi desta vez
          </div>

          <h1 style={{
            margin: '11px 0 0', fontSize: 27, lineHeight: 1.1, fontWeight: 750,
            letterSpacing: '-.85px', color: tinta,
          }}>
            Precisamos abrir esta página de novo.
          </h1>

          <p style={{ margin: '13px 0 0', fontSize: 14, lineHeight: 1.5, color: tinta2, fontWeight: 500 }}>
            Alguma coisa travou no meio do carregamento — já tentamos recarregar
            sozinhos e não deu certo. Seu link continua valendo, e nada do que
            você fez foi perdido.
          </p>

          <button
            onClick={this.tentarDeNovo}
            style={{
              marginTop: 22, width: '100%', minHeight: 52, border: 0, borderRadius: 999,
              cursor: 'pointer', color: '#fff', fontSize: 15, fontWeight: 700,
              background: 'linear-gradient(180deg,#fb7c3f 0%,#ea580c 54%,#d94d06 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.30), 0 2px 5px rgba(124,45,18,.30), 0 12px 26px -10px rgba(234,88,12,.62)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Tentar de novo
          </button>

          <p style={{ margin: '16px 0 0', fontSize: 12.5, lineHeight: 1.5, color: tinta2, fontWeight: 500 }}>
            Se acontecer outra vez, fale com quem lhe enviou o link e informe o
            código abaixo — com ele o escritório encontra a sua assinatura na
            hora.
          </p>

          {token && (
            <button
              onClick={this.copiarCodigo}
              title="Copiar código"
              style={{
                marginTop: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff',
                padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 10,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{
                minWidth: 0, flex: 1, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 12, color: tinta, wordBreak: 'break-all', lineHeight: 1.35,
              }}>
                {token}
              </span>
              <span style={{
                flex: 'none', fontSize: 11, fontWeight: 700,
                color: this.state.copiado ? '#047857' : '#ea580c',
              }}>
                {this.state.copiado ? 'Copiado' : 'Copiar'}
              </span>
            </button>
          )}

          <p style={{ margin: '22px 0 0', fontSize: 10.5, color: tinta3, lineHeight: 1.4 }}>
            Conexão segura · Jurius
          </p>
        </div>
      </div>
    );
  }
}

export default RedeDeSeguranca;
