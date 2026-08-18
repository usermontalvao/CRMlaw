import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desembrulharMensagem,
  lerConteudoNativo,
  lerVcard,
  lerVcards,
  linkDeMapa,
  textoDeContatos,
  textoDeEnquete,
  textoDeLocalizacao,
  textoDeReacao,
} from './wa-native-content.ts';

const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Silva;Joao;;;',
  'FN:Joao Silva',
  'TEL;type=CELL;type=VOICE;waid=5565999998888:+55 65 99999-8888',
  'END:VCARD',
].join('\n');

test('vcard entrega nome e telefone do WhatsApp', () => {
  assert.deepEqual(lerVcard(VCARD), {
    nome: 'Joao Silva',
    // O waid e o numero limpo, pronto para abrir conversa.
    telefones: ['+5565999998888'],
  });
});

test('vcard sem FN cai no nome em partes', () => {
  const semFn = ['BEGIN:VCARD', 'N:Silva;Joao;;;', 'TEL:+55 65 3333-2222', 'END:VCARD'].join('\n');
  assert.deepEqual(lerVcard(semFn), { nome: 'Joao Silva', telefones: ['+55 65 3333-2222'] });
});

test('vcard sem nome nenhum nao devolve string vazia', () => {
  assert.equal(lerVcard('BEGIN:VCARD\nEND:VCARD').nome, 'Contato sem nome');
});

test('vcard com linha continuada nao perde o telefone', () => {
  // RFC 2425: a linha seguinte comecando com espaco e continuacao da anterior.
  const dobrado = 'BEGIN:VCARD\nFN:Perito Judicial\nTEL;waid=556588\n 887766:+55 65 88887-766\nEND:VCARD';
  assert.deepEqual(lerVcard(dobrado).telefones, ['+556588887766']);
});

test('cartao com varios contatos vira um bloco por pessoa', () => {
  const contatos = lerVcards([VCARD, 'BEGIN:VCARD\nFN:Maria\nTEL;waid=5565911112222:x\nEND:VCARD', null, '']);
  assert.equal(contatos.length, 2);
  assert.equal(
    textoDeContatos(contatos),
    'Joao Silva\n+5565999998888\n\nMaria\n+5565911112222',
  );
});

test('contato vazio ainda diz o que era', () => {
  assert.equal(textoDeContatos([]), 'Contato compartilhado');
});

test('localizacao traz rotulo, coordenada e link de mapa', () => {
  const texto = textoDeLocalizacao({
    degreesLatitude: -15.601411,
    degreesLongitude: -56.097892,
    name: 'Forum de Cuiaba',
    address: 'Av. Historiador Rubens de Mendonca',
  });
  assert.equal(texto, [
    'Forum de Cuiaba — Av. Historiador Rubens de Mendonca',
    '-15.601411, -56.097892',
    linkDeMapa(-15.601411, -56.097892),
  ].join('\n'));
});

test('localizacao sem coordenada nao inventa link', () => {
  assert.equal(textoDeLocalizacao({ name: 'Escritorio' }), 'Escritorio');
  assert.equal(textoDeLocalizacao({}), 'Localizacao'.replace('Localizacao', 'Localização'));
});

test('localizacao ao vivo se anuncia como tal', () => {
  const texto = textoDeLocalizacao({ degreesLatitude: 1, degreesLongitude: 2, name: 'ignorado' }, true);
  assert.equal(texto.split('\n')[0], 'Localização em tempo real');
});

test('enquete sai com pergunta e opcoes', () => {
  assert.equal(
    textoDeEnquete({ name: 'Qual horario?', options: [{ optionName: '9h' }, { optionName: '14h' }, null] }),
    'Qual horario?\n• 9h\n• 14h',
  );
});

test('reacao mostra o emoji, e a retirada tambem se explica', () => {
  assert.equal(textoDeReacao('👍'), 'Reagiu com 👍');
  assert.equal(textoDeReacao(''), 'Removeu a reação');
});

// ── Formas REAIS colhidas do acervo do escritorio ───────────────────────────
// Cada uma destas estava gravada como bolha branca. Os payloads abaixo sao os
// que estavam no `raw` das mensagens, reduzidos ao que importa.

test('botoes: a pergunta sem as opcoes e meia pergunta', () => {
  const lido = lerConteudoNativo({
    buttonsMessage: {
      headerType: 1,
      contentText: 'Você recebeu nossa mensagem?',
      buttons: [
        { type: 1, buttonId: '1', buttonText: { displayText: 'Sim' } },
        { type: 1, buttonId: '2', buttonText: { displayText: 'Não' } },
      ],
    },
  });
  assert.deepEqual(lido, {
    type: 'interactive',
    content: 'Você recebeu nossa mensagem?\n• Sim\n• Não',
  });
});

test('template hidratado: corpo, botoes com URL e rodape', () => {
  const lido = lerConteudoNativo({
    templateMessage: {
      hydratedTemplate: {
        hydratedTitleText: '',
        hydratedContentText: '"Olá! Sua solicitação foi aprovada."',
        hydratedFooterText: '[Esta é uma mensagem automática]',
        hydratedButtons: [
          { index: 0, urlButton: { url: 'https://w.meta.me/s/abc', displayText: 'Acompanhe sua solicitação' } },
          { index: 1, quickReplyButton: { displayText: 'Falar com atendente' } },
        ],
      },
    },
  });
  assert.equal(lido?.type, 'interactive');
  assert.equal(lido?.content, [
    // As aspas que o remetente pos em volta do corpo saem.
    'Olá! Sua solicitação foi aprovada.',
    '• Acompanhe sua solicitação — https://w.meta.me/s/abc',
    '• Falar com atendente',
    '[Esta é uma mensagem automática]',
  ].join('\n'));
});

test('fluxo interativo: o JSON escapado dentro do botao vira link', () => {
  const lido = lerConteudoNativo({
    interactiveMessage: {
      body: { text: 'Seu produto está em preparo.' },
      nativeFlowMessage: {
        buttons: [{
          name: 'cta_url',
          buttonParamsJson: '{"display_text":"Rastreio do produto","url":"https://exemplo.com/rastreio?pedido=71958081"}',
        }],
      },
    },
  });
  assert.equal(
    lido?.content,
    'Seu produto está em preparo.\n• Rastreio do produto — https://exemplo.com/rastreio?pedido=71958081',
  );
});

test('fluxo interativo com JSON quebrado perde o botao, nao a mensagem', () => {
  const lido = lerConteudoNativo({
    interactiveMessage: {
      body: { text: 'Confira seu pedido.' },
      nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: '{quebrado' }] },
    },
  });
  assert.equal(lido?.content, 'Confira seu pedido.\n• cta_url');
});

test('menu de lista traz o convite e o cardapio', () => {
  const lido = lerConteudoNativo({
    listMessage: {
      buttonText: 'Escolher',
      description: 'Como podemos te ajudar hoje?',
      sections: [{
        rows: [
          { rowId: '1', title: '🛒 Quero comprar', description: 'Quero comprar um produto' },
          { rowId: '3', title: '📦 Acompanhar', description: 'Acompanhar pedido' },
        ],
      }],
    },
  });
  assert.equal(lido?.content, [
    'Como podemos te ajudar hoje?',
    '• 🛒 Quero comprar — Quero comprar um produto',
    '• 📦 Acompanhar — Acompanhar pedido',
  ].join('\n'));
});

test('a escolha da pessoa vira fala dela, nao cartao de sistema', () => {
  assert.deepEqual(
    lerConteudoNativo({ listResponseMessage: { title: '📦 Acompanhar', listType: 1 } }),
    { type: 'text', content: '📦 Acompanhar' },
  );
  assert.deepEqual(
    lerConteudoNativo({ buttonsResponseMessage: { selectedDisplayText: 'Sim' } }),
    { type: 'text', content: 'Sim' },
  );
});

test('cabecalho de album diz quantas midias vem atras', () => {
  assert.deepEqual(
    lerConteudoNativo({ albumMessage: { expectedImageCount: 5, expectedVideoCount: 0 } }),
    { type: 'album', content: 'Álbum com 5 fotos' },
  );
  assert.equal(
    lerConteudoNativo({ albumMessage: { expectedImageCount: 2, expectedVideoCount: 10 } })?.content,
    'Álbum com 2 fotos e 10 vídeos',
  );
});

test('filho de album e figurinha Lottie sao desembrulhados ate a midia', () => {
  // Sem isto o video do album e a figurinha animada nao tinham `videoMessage`
  // /`stickerMessage` no primeiro nivel e caiam como bolha branca.
  const video = desembrulharMensagem({ associatedChildMessage: { message: { videoMessage: { mimetype: 'video/mp4' } } } });
  assert.ok(video.videoMessage, 'o videoMessage tem que aparecer no topo');
  const fig = desembrulharMensagem({ lottieStickerMessage: { message: { stickerMessage: { isLottie: true } } } });
  assert.ok(fig.stickerMessage, 'a stickerMessage tem que aparecer no topo');
  // E como sao MIDIA, o leitor de tipos-sem-arquivo devolve null de proposito:
  // quem chama segue para o caminho de download.
  assert.equal(lerConteudoNativo({ associatedChildMessage: { message: { videoMessage: {} } } }), null);
});

test('ver uma vez aninhado em temporaria chega na foto', () => {
  const m = desembrulharMensagem({
    ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } } },
  });
  assert.ok(m.imageMessage);
});

test('criptografada por outro caminho se registra em vez de sumir', () => {
  assert.deepEqual(
    lerConteudoNativo({ secretEncryptedMessage: { encIv: {}, encPayload: {} } }),
    { type: 'unsupported', content: 'Mensagem não suportada' },
  );
});

test('texto e midia comuns nao sao assunto deste leitor', () => {
  assert.equal(lerConteudoNativo({ conversation: 'oi' }), null);
  assert.equal(lerConteudoNativo({ imageMessage: {} }), null);
  assert.equal(lerConteudoNativo(null), null);
});

test('template que por dentro e fluxo interativo nao vira rotulo generico', () => {
  const lido = lerConteudoNativo({
    templateMessage: {
      templateId: '1402390711749938',
      interactiveMessageTemplate: {
        body: { text: '*O 8.8 começou!* Aproveite até *60% OFF*.' },
        footer: { text: 'Cupom não acumulativo.' },
        header: { title: '' },
        nativeFlowMessage: {
          buttons: [{ name: 'cta_url', buttonParamsJson: '{"display_text":"Comprar agora!","url":"https://exemplo.com/8-8"}' }],
        },
      },
    },
  });
  assert.equal(lido?.type, 'interactive');
  assert.equal(lido?.content, [
    '*O 8.8 começou!* Aproveite até *60% OFF*.',
    '• Comprar agora! — https://exemplo.com/8-8',
    'Cupom não acumulativo.',
  ].join('\n'));
});

test('telefone em propriedade agrupada (item1.TEL) NÃO se perde — o cartão do iPhone', () => {
  const cartao = [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Eletricista;André;;;', 'FN:André Eletricista',
    'item1.TEL:+556581121124', 'item1.X-ABLabel:Celular',
    'item2.TEL;waid=556581121124:+55 65 8112-1124', 'item2.X-ABLabel:Celular',
    'END:VCARD',
  ].join('\n');
  const lido = lerVcard(cartao);
  assert.equal(lido.nome, 'André Eletricista');
  assert.equal(lido.telefones.length, 1, 'os dois TEL são o MESMO número');
  assert.equal(lido.telefones[0].replace(/\D/g, ''), '556581121124');
});

test('nome também sobrevive quando vem agrupado', () => {
  const cartao = 'BEGIN:VCARD\nitem1.FN:Maria\nitem1.TEL:+5565988887777\nEND:VCARD';
  assert.deepEqual(lerVcard(cartao), { nome: 'Maria', telefones: ['+5565988887777'] });
});

test('TODAS as formas do TEL do vCard dão o MESMO telefone', () => {
  // As quatro formas que o WhatsApp e as agendas de celular realmente usam.
  // A comparação é por dígito porque o valor guardado é o que veio escrito no
  // cartão (com ou sem máscara) — o que não pode variar é o NÚMERO.
  const formas = [
    'TEL:+5565999999999',
    'item1.TEL:+5565999999999',
    'item2.TEL;waid=5565999999999:+55 65 99999-9999',
    'TEL;TYPE=CELL:+5565999999999',
    'TEL;TYPE=CELL;waid=5565999999999:+55 65 99999-9999',
    'item3.TEL;type=CELL;type=VOICE;type=pref:+55 65 99999-9999',
  ];
  for (const linha of formas) {
    const lido = lerVcard(`BEGIN:VCARD\nVERSION:3.0\nFN:Fulano\n${linha}\nEND:VCARD`);
    assert.equal(lido.telefones.length, 1, `nenhum telefone lido em "${linha}"`);
    assert.equal(
      lido.telefones[0].replace(/\D/g, ''), '5565999999999',
      `telefone errado em "${linha}"`,
    );
  }
});

test('o nome vem de FN, e de N só quando FN não veio', () => {
  const comFn = lerVcard('BEGIN:VCARD\nN:Eletricista;André;;;\nFN:André Eletricista\nEND:VCARD');
  assert.equal(comFn.nome, 'André Eletricista');
  // `N` é sobrenome;nome;… — a leitura remonta na ordem que se lê em português.
  const soN = lerVcard('BEGIN:VCARD\nN:Eletricista;André;;;\nEND:VCARD');
  assert.equal(soN.nome, 'André Eletricista');
  const soSobrenome = lerVcard('BEGIN:VCARD\nN:Silva;;;;\nEND:VCARD');
  assert.equal(soSobrenome.nome, 'Silva');
  assert.equal(lerVcard('BEGIN:VCARD\nEND:VCARD').nome, 'Contato sem nome');
});

test('a continuação de linha do vCard não parte o número ao meio', () => {
  // RFC 2425: a linha seguinte começando com espaço é continuação da anterior.
  const cartao = 'BEGIN:VCARD\nFN:Fulano\nitem1.TEL:+55659999\n 99999\nEND:VCARD';
  assert.equal(lerVcard(cartao).telefones[0].replace(/\D/g, ''), '5565999999999');
});

test('vários TEL diferentes no mesmo cartão saem todos', () => {
  const cartao = [
    'BEGIN:VCARD', 'FN:Escritório',
    'item1.TEL;waid=5565988887777:+55 65 98888-7777',
    'item2.TEL;waid=556533334444:+55 65 3333-4444',
    'END:VCARD',
  ].join('\n');
  const lido = lerVcard(cartao);
  assert.deepEqual(lido.telefones.map(t => t.replace(/\D/g, '')), ['5565988887777', '556533334444']);
});
