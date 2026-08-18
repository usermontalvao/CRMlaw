/**
 * Leitura dos tipos NATIVOS do WhatsApp que não são texto nem arquivo: cartão de
 * contato (vCard), localização, enquete e reação.
 *
 * POR QUE ISTO EXISTE. O webhook reconhecia texto, imagem, áudio, vídeo,
 * documento e figurinha; tudo o mais caía num `else` que gravava
 * `type='text', content=null`. Na conversa isso vira uma bolha BRANCA — sem
 * texto, sem ícone, sem pista. Um cliente que manda o contato do perito, ou a
 * localização do fórum, aparecia para o escritório como uma bolha vazia, e a
 * informação só existia no celular de quem recebeu.
 *
 * A saída é transformar cada um num texto legível e guardá-lo em `content`. Com
 * isso o dado aparece na bolha, na prévia da lista, no aviso de mensagem nova, na
 * exportação e no contexto que vai para a IA — tudo de uma vez, sem coluna nova.
 * A bolha usa o `type` só para pôr o ícone e o rótulo certos em volta.
 *
 * SEM IMPORTS de propósito: assim o `npm test` consegue carregar este módulo
 * direto, sem arrastar a cadeia do Deno atrás.
 */

export interface ContatoVcard {
  nome: string;
  telefones: string[];
}

/**
 * Tira os INVÓLUCROS e devolve a mensagem de verdade lá dentro.
 *
 * "Ver uma vez", mensagem temporária, edição, filho de álbum e figurinha
 * animada embrulham o conteúdo real numa casca. Quem lê só o primeiro nível não
 * acha `videoMessage` nenhum e cai no ramo de "nada reconhecido" — foi assim que
 * um vídeo de álbum e uma figurinha Lottie viraram bolha branca, mesmo com o
 * arquivo inteiro descrito no payload.
 *
 * Teto no laço porque as cascas vêm aninhadas e nada garante que o payload não
 * venha em ciclo.
 */
export function desembrulharMensagem(msg: any): any {
  let atual = msg || {};
  for (let volta = 0; volta < 6; volta += 1) {
    const dentro = atual?.viewOnceMessage?.message
      ?? atual?.viewOnceMessageV2?.message
      ?? atual?.viewOnceMessageV2Extension?.message
      ?? atual?.ephemeralMessage?.message
      ?? atual?.editedMessage?.message
      ?? atual?.deviceSentMessage?.message
      ?? atual?.documentWithCaptionMessage?.message
      // Filho de álbum: o vídeo/foto de verdade mora aqui dentro.
      ?? atual?.associatedChildMessage?.message
      // Figurinha animada (Lottie): é uma stickerMessage embrulhada.
      ?? atual?.lottieStickerMessage?.message;
    if (!dentro) return atual;
    atual = dentro;
  }
  return atual;
}

export interface LeituraNativa {
  /** Tipo a gravar em `whatsapp_messages.type`. */
  type: string;
  /** Texto legível para `content` — nunca vazio quando o tipo é reconhecido. */
  content: string | null;
}

/**
 * Lê os tipos SEM ARQUIVO e devolve tipo + texto. Devolve `null` quando a
 * mensagem não é um deles (aí quem chama segue para os ramos de mídia).
 *
 * Existe como função única porque DOIS caminhos precisam da mesma resposta: o
 * webhook, para o que chega agora, e o backfill, para as bolhas em branco que já
 * estão no banco. Duas cópias dessa decisão divergiriam no primeiro ajuste.
 */
export function lerConteudoNativo(msgBruta: any): LeituraNativa | null {
  const msg = desembrulharMensagem(msgBruta);
  if (!msg || typeof msg !== 'object') return null;

  if (msg.contactMessage) {
    return { type: 'contact', content: textoDeContatos([lerVcard(msg.contactMessage.vcard || '')]) };
  }
  if (msg.contactsArrayMessage) {
    return {
      type: 'contact',
      content: textoDeContatos(lerVcards((msg.contactsArrayMessage.contacts || []).map((c: any) => c?.vcard))),
    };
  }
  if (msg.locationMessage) return { type: 'location', content: textoDeLocalizacao(msg.locationMessage) };
  if (msg.liveLocationMessage) return { type: 'location', content: textoDeLocalizacao(msg.liveLocationMessage, true) };

  const enquete = msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3;
  if (enquete) return { type: 'poll', content: textoDeEnquete(enquete) };

  if (msg.reactionMessage) return { type: 'reaction', content: textoDeReacao(msg.reactionMessage.text) };
  if (msg.albumMessage) return { type: 'album', content: textoDeAlbum(msg.albumMessage) };

  // Mensagens de empresa. A RESPOSTA da pessoa (o que ela escolheu) vira texto
  // comum de propósito: é exatamente o que ela teria digitado, e no meio da
  // conversa tem de se ler como fala dela, não como um cartão de sistema.
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return { type: 'text', content: limpar(msg.buttonsResponseMessage.selectedDisplayText) };
  }
  if (msg.templateButtonReplyMessage?.selectedDisplayText) {
    return { type: 'text', content: limpar(msg.templateButtonReplyMessage.selectedDisplayText) };
  }
  if (msg.listResponseMessage) return { type: 'text', content: textoDeRespostaDeLista(msg.listResponseMessage) };

  if (msg.buttonsMessage) return { type: 'interactive', content: textoDeBotoes(msg.buttonsMessage) };
  if (msg.templateMessage) return { type: 'interactive', content: textoDeTemplate(msg.templateMessage) };
  if (msg.interactiveMessage) return { type: 'interactive', content: textoDeInterativa(msg.interactiveMessage) };
  if (msg.listMessage) return { type: 'interactive', content: textoDeLista(msg.listMessage) };
  if (msg.interactiveResponseMessage) {
    return { type: 'text', content: limpar(msg.interactiveResponseMessage?.body?.text) || 'Resposta enviada' };
  }

  // Criptografada de ponta a ponta por outro caminho: não há o que ler, nem
  // aqui nem nunca. Vale registrar que chegou.
  if (msg.secretEncryptedMessage) return { type: 'unsupported', content: 'Mensagem não suportada' };

  return null;
}

/** Desdobra as continuações de linha do vCard (RFC 2425: linha seguinte começa com espaço/tab). */
function juntarLinhas(texto: string): string[] {
  const linhas: string[] = [];
  for (const bruta of texto.replace(/\r\n/g, '\n').split('\n')) {
    if (/^[ \t]/.test(bruta) && linhas.length > 0) linhas[linhas.length - 1] += bruta.slice(1);
    else linhas.push(bruta);
  }
  return linhas;
}

/**
 * Nome e telefones de um vCard.
 *
 * O número que interessa é o `waid=` — é o do WhatsApp, sem máscara, pronto para
 * abrir conversa. Quando ele não vem, sobra o valor escrito depois dos dois
 * pontos, que é como a pessoa digitou na agenda dela.
 */
export function lerVcard(texto: string): ContatoVcard {
  let nome = '';
  const telefones: string[] = [];
  for (const linha of juntarLinhas(texto || '')) {
    const sep = linha.indexOf(':');
    if (sep < 0) continue;
    const cabeca = linha.slice(0, sep);
    const valor = linha.slice(sep + 1).trim();
    // Propriedade AGRUPADA (`item1.TEL`, `item2.EMAIL`): o pedaço antes do ponto
    // é o grupo do vCard, não o nome da propriedade. iPhone e a maioria dos
    // Androids escrevem o telefone assim — e, comparando o nome inteiro com
    // 'TEL', o número era descartado calado. Medido em 17/08/2026: os 3 cartões
    // que existiam no banco chegaram só com o nome, nenhum com telefone.
    const propriedade = cabeca.split(';')[0].trim().toUpperCase().replace(/^.*\./, '');

    if (propriedade === 'FN' && valor) { nome = valor; continue; }
    // `N:` é o nome em partes (sobrenome;nome;...). Só serve de reserva quando
    // não veio `FN`, e as partes vazias precisam sair antes de virar nome.
    if (propriedade === 'N' && !nome) {
      const partes = valor.split(';').map(p => p.trim()).filter(Boolean);
      if (partes.length > 0) nome = [partes[1], partes[0]].filter(Boolean).join(' ') || partes.join(' ');
      continue;
    }
    if (propriedade === 'TEL') {
      const waid = cabeca.match(/waid=(\d+)/i);
      const numero = waid ? `+${waid[1]}` : valor;
      const digitos = numero.replace(/\D/g, '');
      if (!digitos) continue;
      // O mesmo número aparece duas vezes no cartão do WhatsApp — uma crua e
      // outra com `waid=` e máscara. Comparar por dígito evita mostrar dois.
      if (telefones.some(t => t.replace(/\D/g, '') === digitos)) continue;
      telefones.push(numero);
    }
  }
  return { nome: nome || 'Contato sem nome', telefones };
}

/** O mesmo, para o cartão com vários contatos de uma vez. */
export function lerVcards(textos: (string | null | undefined)[]): ContatoVcard[] {
  return textos
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(lerVcard);
}

/**
 * Texto do cartão de contato. Primeira linha é o nome — é assim que a bolha o
 * destaca, e é o que a prévia da lista mostra quando corta.
 */
export function textoDeContatos(contatos: ContatoVcard[]): string {
  if (contatos.length === 0) return 'Contato compartilhado';
  return contatos
    .map(c => [c.nome, ...c.telefones].join('\n'))
    .join('\n\n');
}

/** Link de mapa que abre em qualquer aparelho (o app nativo intercepta). */
export function linkDeMapa(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export interface LocalizacaoWa {
  degreesLatitude?: number | null;
  degreesLongitude?: number | null;
  name?: string | null;
  address?: string | null;
}

/**
 * Texto da localização: o que a pessoa escolheu (nome/endereço) e, embaixo, o
 * link do mapa. O link entra como texto de propósito — a bolha já transforma
 * endereço em link clicável, então ele chega pronto para abrir sem código extra.
 */
export function textoDeLocalizacao(loc: LocalizacaoWa, aoVivo = false): string {
  const lat = Number(loc?.degreesLatitude);
  const lon = Number(loc?.degreesLongitude);
  const rotulos = [loc?.name, loc?.address]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  const cabecalho = aoVivo ? 'Localização em tempo real' : (rotulos.join(' — ') || 'Localização');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return cabecalho;
  const coordenadas = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  return [cabecalho, coordenadas, linkDeMapa(lat, lon)].join('\n');
}

export interface EnqueteWa {
  name?: string | null;
  options?: ({ optionName?: string | null } | null)[] | null;
}

/** Texto da enquete: pergunta na primeira linha, opções marcadas embaixo. */
export function textoDeEnquete(enquete: EnqueteWa): string {
  const pergunta = (enquete?.name || '').trim() || 'Enquete';
  const opcoes = (enquete?.options || [])
    .map(o => (o?.optionName || '').trim())
    .filter(Boolean)
    .map(o => `• ${o}`);
  return [pergunta, ...opcoes].join('\n');
}

/** Texto da reação. Sem o emoji, a reação é uma bolha vazia com outro nome. */
export function textoDeReacao(emoji: string | null | undefined): string {
  const limpo = (emoji || '').trim();
  return limpo ? `Reagiu com ${limpo}` : 'Removeu a reação';
}

// ── Mensagens de empresa: botões, listas, templates e fluxos ─────────────────
//
// Estas são, de longe, as que mais apareciam em branco na caixa do escritório —
// e não são exóticas: é o WhatsApp Business do outro lado. Loja, banco,
// transportadora e o próprio INSS falam por menu de botões e template aprovado,
// não por texto solto. O texto que interessa está sempre lá dentro; o que
// faltava era abrir a estrutura.
//
// As opções entram no texto porque elas SÃO a mensagem: "Você recebeu nossa
// mensagem?" sem o "Sim / Não" embaixo é meia pergunta. E as URLs de botão
// entram inteiras — a bolha já as transforma em link clicável, então o link de
// rastreio que a empresa mandou fica a um clique do atendente.

const limpar = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Junta as partes não vazias, sem linhas em branco duplicadas. */
function montar(partes: (string | null | undefined)[]): string {
  return partes.map(p => (p || '').trim()).filter(Boolean).join('\n');
}

/** `• Rótulo — https://…` para cada opção oferecida. */
function linhaDeOpcao(rotulo: string, destino?: string): string | null {
  const texto = limpar(rotulo);
  if (!texto) return null;
  const alvo = limpar(destino);
  return alvo ? `• ${texto} — ${alvo}` : `• ${texto}`;
}

export function textoDeBotoes(m: any): string {
  const opcoes = (m?.buttons || [])
    .map((b: any) => linhaDeOpcao(b?.buttonText?.displayText))
    .filter(Boolean);
  return montar([
    limpar(m?.contentText) || limpar(m?.headerText),
    ...opcoes,
    limpar(m?.footerText),
  ]) || 'Mensagem com botões';
}

/**
 * Template aprovado pela Meta. O conteúdo real vem "hidratado" (com as variáveis
 * já substituídas) — e às vezes envolto em aspas pelo próprio remetente, que
 * saem aqui para a bolha não mostrar aspas sobrando.
 */
export function textoDeTemplate(m: any): string {
  // Terceira forma do template, e não é rara: por dentro ele é um fluxo
  // interativo (corpo + botões nativos), sem nenhum campo `hydrated*`. Lendo só
  // os hidratados, essas mensagens saíam com o rótulo genérico "Mensagem de
  // modelo" — texto de oferta inteiro perdido, com o link do botão junto.
  if (m?.interactiveMessageTemplate) return textoDeInterativa(m.interactiveMessageTemplate);

  const t = m?.hydratedTemplate || m?.hydratedFourRowTemplate || m?.fourRowTemplate || m || {};
  const corpo = limpar(t?.hydratedContentText) || limpar(t?.content?.text);
  const semAspas = corpo.replace(/^"([\s\S]*)"$/, '$1').trim();
  const opcoes = (t?.hydratedButtons || [])
    .map((b: any) => linhaDeOpcao(
      b?.urlButton?.displayText || b?.quickReplyButton?.displayText || b?.callButton?.displayText,
      b?.urlButton?.url || b?.callButton?.phoneNumber,
    ))
    .filter(Boolean);
  return montar([
    limpar(t?.hydratedTitleText),
    semAspas,
    ...opcoes,
    limpar(t?.hydratedFooterText),
  ]) || 'Mensagem de modelo';
}

/**
 * Fluxo interativo (nativeFlow). Os botões trazem os parâmetros num JSON
 * ESCAPADO dentro do JSON — daí o parse extra. Quando ele vem quebrado, o botão
 * é ignorado em silêncio: perder um rótulo é melhor do que perder a mensagem.
 */
export function textoDeInterativa(m: any): string {
  const opcoes: string[] = [];
  for (const b of m?.nativeFlowMessage?.buttons || []) {
    let params: any = {};
    try { params = JSON.parse(b?.buttonParamsJson || '{}'); } catch { params = {}; }
    const linha = linhaDeOpcao(params?.display_text || params?.title || b?.name, params?.url);
    if (linha) opcoes.push(linha);
  }
  return montar([
    limpar(m?.header?.title),
    limpar(m?.header?.subtitle),
    limpar(m?.body?.text),
    ...opcoes,
    limpar(m?.footer?.text),
  ]) || 'Mensagem interativa';
}

/** Menu de lista: o convite e cada opção do cardápio. */
export function textoDeLista(m: any): string {
  const linhas: string[] = [];
  for (const secao of m?.sections || []) {
    const titulo = limpar(secao?.title);
    if (titulo) linhas.push(titulo);
    for (const linha of secao?.rows || []) {
      const rotulo = limpar(linha?.title);
      const detalhe = limpar(linha?.description);
      const opcao = linhaDeOpcao(detalhe && detalhe !== rotulo ? `${rotulo} — ${detalhe}` : rotulo);
      if (opcao) linhas.push(opcao);
    }
  }
  return montar([
    limpar(m?.title),
    limpar(m?.description),
    ...linhas,
    limpar(m?.footerText),
  ]) || 'Menu de opções';
}

/** O que a pessoa escolheu num menu de lista. */
export function textoDeRespostaDeLista(m: any): string {
  return montar([
    limpar(m?.title),
    limpar(m?.description),
  ]) || 'Opção escolhida';
}

/**
 * Cabeçalho de álbum. Não traz foto nenhuma: anuncia quantas vêm logo atrás,
 * cada uma como sua própria mensagem. Foi conferido no acervo — em todos os
 * álbuns as mídias estão lá. Ele fica porque diz QUANTAS eram: se uma não
 * baixar, é a única pista de que faltou alguma.
 */
export function textoDeAlbum(m: any): string {
  const fotos = Number(m?.expectedImageCount) || 0;
  const videos = Number(m?.expectedVideoCount) || 0;
  const partes: string[] = [];
  if (fotos > 0) partes.push(`${fotos} ${fotos === 1 ? 'foto' : 'fotos'}`);
  if (videos > 0) partes.push(`${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`);
  return partes.length > 0 ? `Álbum com ${partes.join(' e ')}` : 'Álbum';
}
