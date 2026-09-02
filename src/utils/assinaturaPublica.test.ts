import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canalDoRegistro,
  classificarCodigo,
  normalizarCodigo,
  fatoresDeAutenticacao,
  hashDoPdfAssinadoConsultado,
  rotuloDoCodigo,
  descreverAparelho,
  documentoSemOSignatario,
  faseDaAbertura,
  faseDaConferencia,
  explicacaoDaEspera,
  formatarCoordenadas,
  mascararCpf,
  nomeDoCanal,
  primeiroNome,
  progresso,
  rotularCanal,
  saudacao,
  situacaoDoSignatario,
  rotuloDaSituacao,
  contagemDeAssinaturas,
  rotuloDoEvento,
  detalheDoEvento,
  nomeDoDocumentoDoKit,
  emailInternoDeSistema,
  emailPublicoDoSignatario,
  enderecoDoSignatario,
  telefoneQueAutenticou,
  localizacaoDaAssinatura,
  provaDeIdentidade,
  codigoDoArquivoParaPrevia,
} from './assinaturaPublica.ts';

const emHora = (h: number) => new Date(2026, 7, 29, h, 30, 0);

test('a saudação vira pelo relógio de quem lê', () => {
  assert.equal(saudacao(emHora(0)), 'Bom dia');
  assert.equal(saudacao(emHora(11)), 'Bom dia');
  assert.equal(saudacao(emHora(12)), 'Boa tarde');
  assert.equal(saudacao(emHora(17)), 'Boa tarde');
  assert.equal(saudacao(emHora(18)), 'Boa noite');
  assert.equal(saudacao(emHora(23)), 'Boa noite');
});

test('preposição não é primeiro nome', () => {
  assert.equal(primeiroNome('Maria Silva Ribeiro'), 'Maria');
  assert.equal(primeiroNome('  Ana   Paula  '), 'Ana');
  assert.equal(primeiroNome('Di Fiori Bianchi'), 'Di Fiori');
  assert.equal(primeiroNome('Jô'), 'Jô');
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(null), '');
});

test('o CPF sai mascarado — a tela pública é fotografada', () => {
  assert.equal(mascararCpf('123.456.789-09'), '•••.456.789-••');
  assert.equal(mascararCpf('12345678909'), '•••.456.789-••');
  // Sem 11 dígitos não há máscara possível: melhor não mostrar nada.
  assert.equal(mascararCpf('1234'), '');
  assert.equal(mascararCpf(null), '');
});

test('o aparelho é reconhecível pela própria pessoa', () => {
  assert.equal(
    descreverAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'),
    'iPhone · Safari',
  );
  assert.equal(
    descreverAparelho('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'),
    'Android · Chrome',
  );
  assert.equal(
    descreverAparelho('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'),
    'Mac · Edge',
  );
  assert.equal(descreverAparelho(''), '');
});

test('no iPhone, o Chrome não pode ser lido como Safari', () => {
  // O UA do Chrome no iOS carrega CriOS E Safari; a ordem do teste é o conserto.
  assert.equal(
    descreverAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1'),
    'iPhone · Chrome',
  );
});

test('as coordenadas saem cruas — não existe consulta reversa neste fluxo', () => {
  assert.equal(formatarCoordenadas({ lat: -15.598912, lng: -56.094878 }), '−15.5989, −56.0949');
  assert.equal(formatarCoordenadas({ lat: 1.5, lng: 2 }), '1.5000, 2.0000');
  assert.equal(formatarCoordenadas(null), '');
  assert.equal(formatarCoordenadas({ lat: Number.NaN, lng: 0 }), '');
});

test('o canal da identidade vira rótulo', () => {
  assert.equal(rotularCanal('whatsapp'), 'Identidade · WhatsApp');
  assert.equal(rotularCanal('email'), 'Identidade · E-mail');
  assert.equal(rotularCanal('google'), 'Identidade · Google');
  assert.equal(rotularCanal(null), 'Identidade confirmada');
});

test('no comprovante a chave já diz "Identidade" — o valor é só o canal', () => {
  assert.equal(nomeDoCanal('whatsapp'), 'WhatsApp');
  assert.equal(nomeDoCanal('email'), 'E-mail');
  assert.equal(nomeDoCanal('google'), 'Google');
  assert.equal(nomeDoCanal(null), 'Confirmada');
});

test('SMS não é WhatsApp — nem no rótulo, nem na leitura do registro', () => {
  assert.equal(nomeDoCanal('sms'), 'SMS');
  assert.equal(rotularCanal('sms'), 'Identidade · SMS');
  assert.equal(canalDoRegistro({ auth_verified_channel: 'sms' }), 'sms');
});

test('quem volta ao link depois lê o canal do registro', () => {
  assert.equal(canalDoRegistro({ auth_verified_channel: 'whatsapp' }), 'whatsapp');
  assert.equal(canalDoRegistro({ auth_verified_channel: 'google' }), 'google');
  // Registro antigo, gravado antes de `auth_verified_channel` existir.
  assert.equal(canalDoRegistro({ auth_provider: 'email_link' }), 'email');
  assert.equal(canalDoRegistro({ auth_provider: 'google' }), 'google');
  // `phone` não diz se foi WhatsApp ou SMS: melhor "Confirmada" do que um chute.
  assert.equal(canalDoRegistro({ auth_provider: 'phone' }), null);
  assert.equal(canalDoRegistro(null), null);
});

test('o título do documento não repete o nome de quem assinou', () => {
  assert.equal(
    documentoSemOSignatario('KIT CONSUMIDOR - JENIFFER APARECIDA ALVES RODRIGUES', 'Jeniffer Aparecida Alves Rodrigues'),
    'KIT CONSUMIDOR',
  );
  // Acento e caixa não podem impedir o corte.
  assert.equal(
    documentoSemOSignatario('Procuração — José Antônio da Silva', 'JOSE ANTONIO DA SILVA'),
    'Procuração',
  );
});

test('o corte é conservador: na dúvida, o título passa inteiro', () => {
  // Nome no MEIO do título não é o padrão que estamos apagando.
  assert.equal(
    documentoSemOSignatario('Contrato de Maria Silva assinado', 'Maria Silva'),
    'Contrato de Maria Silva assinado',
  );
  // Sobraria pouco demais para ainda ser nome de documento.
  assert.equal(documentoSemOSignatario('De Maria Silva', 'Maria Silva'), 'De Maria Silva');
  // Título que É só o nome continua sendo o título.
  assert.equal(documentoSemOSignatario('Maria Silva', 'Maria Silva'), 'Maria Silva');
  // Nome curto demais para servir de sufixo confiável.
  assert.equal(documentoSemOSignatario('Recibo Ana', 'Ana'), 'Recibo Ana');
  assert.equal(documentoSemOSignatario('Procuração', ''), 'Procuração');
  assert.equal(documentoSemOSignatario(null, 'Maria Silva'), '');
});

test('a validação reconhece QUAL código foi consultado', () => {
  const refs = {
    envelope: ['5f2a1c3e-0000-4aaa-bbbb-cccccccccccc', 'CA6B14B457214F73'],
    documentos: ['a3f05e0698287546', '3afff1e8b617ef7a'],
    signatario: '74B4E5EA2DA6E247',
  };
  assert.equal(classificarCodigo('CA6B14B457214F73', refs), 'envelope');
  assert.equal(classificarCodigo('a3f05e0698287546', refs), 'documento');
  assert.equal(classificarCodigo('74B4E5EA2DA6E247', refs), 'signatario');
  assert.equal(classificarCodigo('ZZZZ0000', refs), 'desconhecido');
  assert.equal(classificarCodigo('', refs), 'desconhecido');
});

test('o código do rodapé vem com hífen e a URL não — os dois têm de casar', () => {
  const refs = { documentos: ['a3f05e0698287546'] };
  assert.equal(classificarCodigo('A3F0-5E06-9828-7546', refs), 'documento');
  assert.equal(normalizarCodigo('a3f0-5e06 9828.7546'), 'A3F05E0698287546');
});

test('o recibo usa os dois identificadores públicos canônicos', () => {
  assert.equal(rotuloDoCodigo('envelope'), 'Protocolo do envelope');
  assert.equal(rotuloDoCodigo('documento'), 'Código de verificação do documento');
  assert.equal(rotuloDoCodigo('signatario'), 'Código de verificação');
  assert.equal(rotuloDoCodigo('desconhecido'), 'Código de verificação');
});

test('a consulta pelo código do documento mostra o SHA-256 daquele PDF assinado', () => {
  const documentos = [
    { verification_code: 'A8162AF5EEAB20D8', signed_pdf_sha256: 'HASH-ASSINADO-PRINCIPAL' },
    { verification_code: '05FBDC3C94D10F99', signed_pdf_sha256: 'HASH-ASSINADO-ANEXO' },
  ];
  assert.equal(
    hashDoPdfAssinadoConsultado('a816-2af5-eeab-20d8', documentos, 'HASH-LEGADO'),
    'HASH-ASSINADO-PRINCIPAL',
  );
  assert.equal(
    hashDoPdfAssinadoConsultado('05fbdc3c94d10f99', documentos, 'HASH-LEGADO'),
    'HASH-ASSINADO-ANEXO',
  );
  assert.equal(hashDoPdfAssinadoConsultado('', documentos, 'HASH-LEGADO'), 'HASH-LEGADO');
});

test('a autenticação lista o que foi USADO, não o que estava configurado', () => {
  // Caso real do acervo: auth_method dizia "signature_only", mas houve selfie
  // e confirmação por e-mail. Mostrar só o método escondia duas provas.
  assert.equal(
    fatoresDeAutenticacao({ assinatura: true, selfie: true, canal: 'email' }),
    'Assinatura, selfie e código por E-mail',
  );
  assert.equal(fatoresDeAutenticacao({ assinatura: true }), 'Assinatura');
  assert.equal(
    fatoresDeAutenticacao({ assinatura: true, selfie: true, documento: true, canal: 'whatsapp' }),
    'Assinatura, selfie, documento de identidade e código por WhatsApp',
  );
  assert.equal(fatoresDeAutenticacao({ canal: 'google' }), 'Conta Google');
});

test('sem nada registrado, a linha da autenticação some', () => {
  assert.equal(fatoresDeAutenticacao({}), '');
  assert.equal(fatoresDeAutenticacao({ assinatura: false, selfie: false, canal: null }), '');
});

test('nenhuma das duas esperas promete conclusão', () => {
  // Quem decide que terminou é a resposta do servidor, não o relógio.
  for (const s of [0, 3, 6, 9, 13, 30, 120]) {
    assert.ok(!/pronto|conclu(í|i)d/i.test(faseDaConferencia(s)), `conferência aos ${s}s`);
    assert.ok(!/pronto|conclu(í|i)d/i.test(faseDaAbertura(s)), `abertura aos ${s}s`);
  }
});

test('a espera longa nunca diz que está TENTANDO de novo', () => {
  // "Continuamos tentando" sugere que algo falhou e está sendo repetido. Não
  // está: há uma única execução em curso. Assustar quem está no meio de um ato
  // que não pode ser interrompido é o pior momento possível para essa palavra.
  for (const s of [20, 35, 60, 120]) {
    assert.equal(/tentando|tentativa/i.test(faseDaConferencia(s)), false,
      `"${faseDaConferencia(s)}" sugere repetição`);
    assert.equal(/tentando|tentativa/i.test(faseDaAbertura(s)), false,
      `"${faseDaAbertura(s)}" sugere repetição`);
  }
});

test('a espera do ENVIO não culpa a conexão — o trabalho é no aparelho', () => {
  // O PDF assinado é montado no dispositivo de quem assina. Dizer "a conexão
  // está lenta" mandava a pessoa conferir o wi-fi atrás de um problema que não
  // existe. Já a ABERTURA baixa o documento: ali a rede é suspeita legítima.
  for (const s of [20, 40, 90]) {
    assert.equal(/conex[ãa]o/i.test(faseDaConferencia(s)), false,
      `"${faseDaConferencia(s)}" culpa a conexão por trabalho local`);
  }
  assert.match(explicacaoDaEspera(40), /aparelho|anexos/i);
});

test('a explicação da espera só entra quando a espera fica longa', () => {
  // Explicar já na largada sugere que algo vai dar errado.
  assert.equal(explicacaoDaEspera(3), '');
  assert.equal(explicacaoDaEspera(12), '');
  assert.ok(explicacaoDaEspera(25).length > 0);
  assert.ok(explicacaoDaEspera(90).length > 0);
});

test('o título da espera cabe na caixa estreita da tela', () => {
  // A caixa tem 240px em corpo 15.5 bold: acima de ~34 caracteres passa de
  // duas linhas e empurra o layout. O texto que tranquiliza mora na segunda
  // linha, não no título.
  for (const s of [0, 3, 8, 15, 25, 60, 200]) {
    assert.ok(faseDaConferencia(s).length <= 34,
      `"${faseDaConferencia(s)}" tem ${faseDaConferencia(s).length} caracteres`);
  }
});

test('nenhuma etapa da espera promete que terminou', () => {
  for (const s of [0, 3, 8, 15, 25, 40, 120]) {
    assert.equal(/pronto|conclu[ií]d|finalizado com|sucesso/i.test(faseDaConferencia(s)), false);
  }
});

test('o progresso sobe, desacelera e nunca fecha a conta', () => {
  assert.equal(progresso(0), 0);
  assert.equal(progresso(-1), 0);
  assert.ok(progresso(1) > 0 && progresso(1) < progresso(3));
  assert.ok(progresso(3) < progresso(8));
  assert.ok(progresso(600) <= 99, 'nunca chega a 100 — quem fecha é o servidor');
});


// ── O dossiê público ─────────────────────────────────────────────────────────

test('quem assinou continua tendo assinado, mesmo com o status parado em pending', () => {
  // Envelopes antigos carimbavam a data só na solicitação; ler o `status`
  // escreveria "Aguardando" embaixo de uma assinatura que existe.
  assert.equal(situacaoDoSignatario({ status: 'pending', signed_at: '2026-03-07T15:22:53Z' }), 'assinou');
  assert.equal(situacaoDoSignatario({ status: 'signed' }), 'assinou');
  assert.equal(situacaoDoSignatario({ status: 'pending', viewed_at: '2026-03-07T15:22:23Z' }), 'visualizou');
  assert.equal(situacaoDoSignatario({ status: 'pending' }), 'aguardando');
  assert.equal(situacaoDoSignatario(null), 'aguardando');
});

test('recusa vence assinatura na leitura da situação', () => {
  // Um signatário que assinou e depois recusou não pode aparecer como "Assinou".
  assert.equal(situacaoDoSignatario({ signed_at: '2026-03-07T15:00:00Z', refused_at: '2026-03-07T16:00:00Z' }), 'recusou');
  assert.equal(rotuloDaSituacao('recusou'), 'Recusou');
  assert.equal(rotuloDaSituacao('aguardando'), 'Aguardando');
});

test('a contagem do cabeçalho concorda o plural com o total', () => {
  assert.equal(contagemDeAssinaturas([{ signed_at: 'x' }]).texto, 'Assinado por 1 de 1 signatário');
  assert.equal(contagemDeAssinaturas([{ signed_at: 'x' }, { status: 'pending' }]).texto, 'Assinado por 1 de 2 signatários');
  assert.equal(contagemDeAssinaturas([{ signed_at: 'x' }, { signed_at: 'y' }]).completo, true);
  assert.equal(contagemDeAssinaturas([{ signed_at: 'x' }, { status: 'pending' }]).completo, false);
  assert.equal(contagemDeAssinaturas([]).texto, 'Sem signatários registrados');
  assert.equal(contagemDeAssinaturas(null).total, 0);
});

test('cada ação da auditoria tem nome de gente', () => {
  assert.equal(rotuloDoEvento('created'), 'Documento criado');
  assert.equal(rotuloDoEvento('integrity_verified'), 'Integridade conferida');
  assert.equal(rotuloDoEvento('finalization_failed'), 'Falha ao finalizar');
  assert.equal(rotuloDoEvento('acao_que_ainda_nao_existe'), 'Registro de auditoria');
  assert.equal(rotuloDoEvento(null), 'Registro de auditoria');
});

test('o protocolo do envelope não abre arquivo — a prévia cai no documento principal', () => {
  const documentos = [
    { verification_code: 'AAA1', document_type: 'attachment' },
    { verification_code: 'BBB2', document_type: 'main' },
  ];
  assert.equal(
    codigoDoArquivoParaPrevia({ tipo: 'envelope', codigoConsultado: '3C5AF699', documentos }),
    'BBB2',
  );
  // Código de documento individual abre a si mesmo.
  assert.equal(
    codigoDoArquivoParaPrevia({ tipo: 'documento', codigoConsultado: 'aaa1', documentos }),
    'AAA1',
  );
  // Envelope sem nenhum código de documento cai no do signatário.
  assert.equal(
    codigoDoArquivoParaPrevia({ tipo: 'envelope', codigoConsultado: 'ZZZ9', documentos: [], codigoDoSignatario: 'S1' }),
    'S1',
  );
  // Validação por arquivo (sem código digitado) também precisa de algo para abrir.
  assert.equal(
    codigoDoArquivoParaPrevia({ tipo: 'desconhecido', codigoConsultado: '', documentos }),
    'BBB2',
  );
});

test('detalhe que repete o título do evento não vira linha', () => {
  assert.equal(detalheDoEvento('viewed', 'Documento visualizado'), '');
  assert.equal(detalheDoEvento('created', 'Solicitação de assinatura criada'), 'Solicitação de assinatura criada');
  // O IP já aparece na linha de cima; repetir dentro da frase é ruído.
  assert.equal(
    detalheDoEvento('viewed', 'FULANO abriu o documento para leitura (IP: 201.71.165.203)'),
    'FULANO abriu o documento para leitura',
  );
  assert.equal(detalheDoEvento('signed', ''), '');
  assert.equal(detalheDoEvento('signed', null), '');
});

test('o endereço interno do pré-cadastro não é e-mail de ninguém', () => {
  assert.equal(emailInternoDeSistema('public+affc1d26-261d-4815-bc34-08cccc1038ed@crm.local'), true);
  assert.equal(emailInternoDeSistema('PUBLIC+ABC@CRM.LOCAL'), true);
  assert.equal(emailInternoDeSistema('jeniffer@gmail.com'), false);
  assert.equal(emailInternoDeSistema(''), false);
  assert.equal(emailInternoDeSistema(null), false);
});

test('com o placeholder no lugar do e-mail, vale o endereço que recebeu o código', () => {
  assert.equal(
    emailPublicoDoSignatario({ email: 'public+abc@crm.local', auth_verified_identifier: 'jeniffer@gmail.com' }),
    'jeniffer@gmail.com',
  );
  // Registro anterior ao `auth_verified_identifier`: sobra o `auth_email`.
  assert.equal(
    emailPublicoDoSignatario({ email: 'public+abc@crm.local', auth_email: 'alvesjeniffer820@gmail.com' }),
    'alvesjeniffer820@gmail.com',
  );
  // O conferido pelo servidor vence o declarado no login.
  assert.equal(
    emailPublicoDoSignatario({
      email: 'public+abc@crm.local',
      auth_verified_identifier: 'conferido@gmail.com',
      auth_email: 'declarado@gmail.com',
    }),
    'conferido@gmail.com',
  );
  // Sem nada real, some — melhor vazio do que um endereço que não existe.
  assert.equal(emailPublicoDoSignatario({ email: 'public+abc@crm.local' }), '');
  // Telefone verificado não vira e-mail.
  assert.equal(
    emailPublicoDoSignatario({ email: 'public+abc@crm.local', auth_verified_identifier: '5565999248258' }),
    '',
  );
  assert.equal(emailPublicoDoSignatario({ email: 'real@escritorio.com' }), 'real@escritorio.com');
  assert.equal(emailPublicoDoSignatario(null), '');
});

test('uuid no lugar do nome vira "Anexo N", não uma linha de hexadecimal', () => {
  assert.equal(nomeDoDocumentoDoKit('b3398785-c617-487d-aefe-45830b80c00e', 'attachment', 1), 'Anexo 1');
  assert.equal(nomeDoDocumentoDoKit('4e6c63cd-fcd4-4409-bfb9-84206e00da50', 'main', 0), 'Documento principal');
  assert.equal(nomeDoDocumentoDoKit('', 'attachment', 2), 'Anexo 2');
  // Nome de verdade passa intacto, sem a extensão.
  assert.equal(nomeDoDocumentoDoKit('Procuração.pdf', 'attachment', 1), 'Procuração');
  assert.equal(nomeDoDocumentoDoKit('KIT CONSUMIDOR - FULANO', 'main', 0), 'KIT CONSUMIDOR - FULANO');
});

test('a conta que autenticou não se disfarça de e-mail do signatário', () => {
  // Envelope assinado pela conta Google do escritório: o mesmo endereço apareceria
  // embaixo do nome de todo cliente, como se fosse dele.
  assert.deepEqual(
    enderecoDoSignatario({ email: '', auth_email: 'pedro@advcuiaba.com' }),
    { endereco: 'pedro@advcuiaba.com', origem: 'autenticacao' },
  );
  assert.deepEqual(
    enderecoDoSignatario({ email: 'cliente@gmail.com', auth_email: 'pedro@advcuiaba.com' }),
    { endereco: 'cliente@gmail.com', origem: 'cadastro' },
  );
  assert.deepEqual(enderecoDoSignatario({}), { endereco: '', origem: 'nenhum' });
});

test('telefone que não participou da assinatura não entra no dossiê', () => {
  // Autenticação por código no e-mail: o celular do cadastro não teve papel
  // nenhum, e ao lado de "código por E-mail" ele lê como um segundo canal.
  assert.equal(
    telefoneQueAutenticou({ phone: '(65) 99924-8258', auth_provider: 'email_link' }),
    '',
  );
  assert.equal(telefoneQueAutenticou({ phone: '(65) 99924-8258', auth_provider: 'google' }), '');
  // Recebeu o código: aparece.
  assert.equal(
    telefoneQueAutenticou({ phone: '(65) 99924-8258', auth_verified_channel: 'whatsapp' }),
    '(65) 99924-8258',
  );
  // `phone` não distingue WhatsApp de SMS, mas prova que foi por telefone.
  assert.equal(telefoneQueAutenticou({ phone: '(65) 99924-8258', auth_provider: 'phone' }), '(65) 99924-8258');
  // O número que recebeu o código vence o do cadastro.
  assert.equal(
    telefoneQueAutenticou({
      phone: '(65) 99924-8258',
      auth_verified_channel: 'sms',
      auth_verified_identifier: '5565988887777',
    }),
    '5565988887777',
  );
  assert.equal(telefoneQueAutenticou(null), '');
});

test('a coordenada da assinatura vira texto curto e link de mapa', () => {
  const local = localizacaoDaAssinatura('-15.620415200527303, -55.99076480213347');
  assert.equal(local.texto, '−15.6204, −55.9908');
  assert.equal(local.mapa, 'https://www.google.com/maps?q=-15.620415200527303,-55.99076480213347');
  // Lixo não vira mapa nenhum.
  assert.deepEqual(localizacaoDaAssinatura('sem coordenada'), { texto: '', mapa: '' });
  assert.deepEqual(localizacaoDaAssinatura(''), { texto: '', mapa: '' });
  assert.deepEqual(localizacaoDaAssinatura(null), { texto: '', mapa: '' });
});

test('a prova de identidade é uma linha só, com o nome do que provou', () => {
  // O caso real: código por e-mail. O celular do cadastro fica fora.
  assert.deepEqual(
    provaDeIdentidade({
      auth_provider: 'email_link',
      auth_email: 'alvesjeniffer820@gmail.com',
      email: 'public+abc@crm.local',
      phone: '(65) 99924-8258',
    }),
    { rotulo: 'Código por e-mail', valor: 'alvesjeniffer820@gmail.com' },
  );
  assert.deepEqual(
    provaDeIdentidade({ auth_provider: 'google', email: 'pedro@advcuiaba.com' }),
    { rotulo: 'Conta Google', valor: 'pedro@advcuiaba.com' },
  );
  assert.deepEqual(
    provaDeIdentidade({ auth_verified_channel: 'whatsapp', phone: '(65) 99924-8258' }),
    { rotulo: 'Código por WhatsApp', valor: '(65) 99924-8258' },
  );
  assert.deepEqual(
    provaDeIdentidade({ auth_verified_channel: 'sms', phone: '(65) 99924-8258' }),
    { rotulo: 'Código por SMS', valor: '(65) 99924-8258' },
  );
  // `phone` não diz se foi SMS ou WhatsApp — e o rótulo não chuta.
  assert.deepEqual(
    provaDeIdentidade({ auth_provider: 'phone', phone: '(65) 99924-8258' }),
    { rotulo: 'Código por telefone', valor: '(65) 99924-8258' },
  );
  // Sem canal nenhum: o e-mail identifica, mas não promete ter provado.
  assert.deepEqual(
    provaDeIdentidade({ email: 'cliente@gmail.com' }),
    { rotulo: 'E-mail', valor: 'cliente@gmail.com' },
  );
  assert.deepEqual(provaDeIdentidade({}), { rotulo: '', valor: '' });
});
