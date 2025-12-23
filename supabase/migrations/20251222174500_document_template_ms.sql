DO $$
DECLARE
  v_template_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'document_templates'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.document_templates (name, description, content, enable_defendant)
  SELECT
    'Modelo - Mandado de Segurança (INSS)',
    'Modelo de MS para demora na análise de requerimento administrativo (INSS), com campos para protocolo/cidade/tempo em análise e dados do cliente.',
    $$AO JUÍZO FEDERAL DA SUBSEÇÃO JUDICIÁRIA DE [[SUBSECAO_JUDICIARIA]], ESTADO DO(A) [[UF_SUBSECAO]]



A teor do Inciso IV do art. 425, do CPC, DECLARO para os devidos fins de direito, sob minha responsabilidade, que as cópias que compõe a inicial são autênticas.



[[NOME COMPLETO]], [[nacionalidade]], [[estado civil]], [[profissão]], [[RG]], nascido(a) em [[DATA_NASCIMENTO]], inscrito(a) no CPF nº. [[CPF]], residente e domiciliado(a) em [[ENDERECO_COMPLETO]], através de sua bastante procuradora ao final assinada, mandado anexo (DOC 1 – Procuração e outros), vem, com o devido respeito, perante Vossa Excelência, impetrar o presente

MANDADO DE SEGURANÇA COM PEDIDO LIMINAR, visando proteger direito líquido e certo seu, indicando como coator o

SR. GERENTE-EXECUTIVO DA AGÊNCIA DA PREVIDÊNCIA SOCIAL DE [[CIDADE_REFERENCIA_INSS]]/[[UF_REFERENCIA_INSS]], a ser encontrado em [[ENDERECO_APS]], pelos seguintes fundamentos fáticos e jurídicos que passa a expor:

______________________________

1. Da Gratuidade de Justiça

O Impetrante é lavrador e não dispõe de recursos financeiros para arcar com as despesas processuais e os honorários advocatícios sem comprometer o seu próprio sustento e o de sua família, vez que sua renda mensal não supera o valor de 1 (um) salário mínimo, motivos que o levam a pugnar pelos benefícios da gratuidade de justiça.

Nesse sentido, destaque-se, que o CPC/2015 estabelece em seus arts. 98 e 99, §§2º, 3º e 4º que a pessoa natural, com insuficiência de recursos para pagar as custas, as despesas processuais e os honorários advocatícios tem o direito à gratuidade da justiça, não importando que esteja assistida por advogado particular, a qual só poderá ser indeferida se houver nos autos elementos que evidenciem a falta dos pressupostos legais para a concessão da gratuidade, presumindo-se, portanto, como verdadeira a alegação de insuficiência deduzida por pessoa natural. Vejamos:

“Art. 98. A pessoa natural ou jurídica, brasileira ou estrangeira, com insuficiência de recursos para pagar as custas, as despesas processuais e os honorários advocatícios tem direito à gratuidade da justiça, na forma da lei.

Art. 99. O pedido de gratuidade da justiça pode ser formulado na petição inicial, na contestação, na petição para ingresso de terceiro no processo ou em recurso.

§ 2º O juiz somente poderá indeferir o pedido se houver nos autos elementos que evidenciem a falta dos pressupostos legais para a concessão de gratuidade, devendo, antes de indeferir o pedido, determinar à parte a comprovação do preenchimento dos referidos pressupostos.

§ 3º Presume-se verdadeira a alegação de insuficiência deduzida exclusivamente por pessoa natural.

§ 4º A assistência do requerente por advogado particular não impede a concessão de gratuidade da justiça”.

Por tais razões, com fulcro no artigo 5º, LXXIV da Constituição Federal e artigo 98 do CPC/2015, requer seja deferida os beneplácitos da gratuidade de justiça ao Impetrante.

______________________________

2. Dos fatos

O Impetrante em 27 de Junho de 2018 requereu administrativamente a concessão de aposentadoria por idade rural, considerando ter preenchido os requisitos exigidos pela legislação atinente à matéria (DOC 2 – Requerimento administrativo).

Protocolo administrativo: [[PROTOCOLO]]
Tipo/benefício: [[BENEFICIO]]
Tempo em análise (dias): [[TEMPO_EM_ANALISE_DIAS]]

Ocorre que até a presente data o pedido sequer fora analisado pela Autarquia Previdenciária, conforme faz prova o andamento processual anexo (DOC 3 – Andamento processo administrativo), tendo sido extrapolado (e muito) o prazo previsto na Lei nº. 9.784/99 (Lei do Processo Administrativo).

Por esse motivo o Demandante impetra o presente Mandado de Segurança, buscando o amparo do seu direito líquido e certo à análise e manifestação acerca do seu pedido administrativo.

______________________________

2. Do direito

2.1. Do cabimento do mandado de segurança

Conforme o Artigo 5º LXIX, da Constituição da República Federativa do Brasil, conceder-se-á mandado de segurança para proteger direito líquido e certo, não amparado por “habeas-corpus” ou “habeas-data”, quando o responsável pela ilegalidade ou abuso de poder for autoridade pública ou agente de pessoa jurídica no exercício de atribuições do Poder Público.

Nesse mesmo sentido é a redação do artigo 1º da Lei 12.016 de 2009 ao assegurar que conceder-se-á mandado de segurança para proteger direito líquido e certo, não amparado por habeas corpus ou habeas data, sempre que, ilegalmente ou com abuso de poder, qualquer pessoa física ou jurídica sofrer violação ou houver justo receio de sofrê-la por parte de autoridade, seja de que categoria for e sejam quais forem as funções que exerça.

No caso em tela, o direito liquido e certo está sendo violado por ato ilegal do INSS – na figura do Gerente da Agencia da Previdência Social de Balsas/MA, eis que até o presente momento o seu pedido de concessão de aposentadoria por idade rural sequer fora analisado, estando o direito do segurado à razoável duração do processo e à celeridade de sua tramitação sendo ferido de morte.

2.2. Interesse de agir

No presente caso o interesse processual do Impetrante assenta-se na omissão do Gerente da Agência da Previdência Social que até o momento não se manifestou acerca do pedido administrativo formulado pelo Impetrante, tendo sido ultrapassado o prazo previsto na Lei nº. 9.784/99 sem que tenha sido proferida decisão.

Nessa esteira, considerando a decisão do Gerente do INSS, evidente a presença do trinômio necessidade-utilidade-adequação que caracteriza o interesse de agir, na medida em que o ato ilegal emanado pelo Administrador somente poderá ser reparado pela atuação do Poder Judiciário, por meio do processo, instrumento útil e adequado para persecução deste fim.

Pelo exposto, denota-se que a omissão e a inércia administrativa, implica em grave prejuízo ao seu direito, e assim configura o interesse de agir.

______________________________

3. Do mérito

No que se refere ao mérito da presente ação, é desnecessário grandes debates acerca do tema, na medida em que a Lei nº. 9.784/99, que regula o processo administrativo, é muito clara ao estabelecer o prazo de 30 (trinta) dias, prorrogáveis mediante justificação, por mais 30 (trinta) dias:

“Art. 49. Concluída a instrução de processo administrativo, a Administração tem o prazo de até trinta dias para decidir, salvo prorrogação por igual período expressamente motivada”. (grifado)

Nesse sentido, caminha o entendimento do Tribunal Regional Federal da 4ª Região:

PREVIDENCIÁRIO E PROCESSUAL CIVIL. MANDADO DE SEGURANÇA. PROCESSO ADMINISTRATIVO DE CONCESSÃO DE BENEFÍCIO. DEMORA EXCESSIVA. ILEGALIDADE. 1. O prazo para análise e manifestação acerca de pedido administrativo de concessão de benefício previdenciário submete-se ao direito fundamental à razoável duração do processo e à celeridade de sua tramitação, nos termos do art. 5º, LXXVII, da CF/88. 2. A demora no processamento e conclusão de pedido administrativo equipara-se a seu próprio indeferimento, tendo em vista os prejuízos causados ao administrado, decorrentes do próprio decurso de tempo. 3. Hipótese em que restou ultrapassado prazo razoável para a Administração decidir acerca do requerimento administrativo formulado pela parte. (TRF4 5057346-16.2017.4.04.7100, QUINTA TURMA, Relator ALTAIR ANTONIO GREGÓRIO, juntado aos autos em 06/06/2018 – Grifos nossos

PREVIDENCIÁRIO. MANDADO DE SEGURANÇA. APELAÇÃO. DEMORA NA APRECIAÇÃO ADMINISTRATIVA. ART. 49 DA LEI Nº 9.784/99. ILEGALIDADE POR OMISSÃO. CIÊNCIA. PESSOA JURÍDICA DE DIREITO PÚBLICO. AUSÊNCIA DE PREJUÍZO. NULIDADE. NÃO OCORRÊNCIA. 1. Ultrapassado em muito o prazo do art. 49 da Lei nº 9.784/1999, resta configurada ilegalidade por omissão, passível de ser coibida por mandado de segurança. 2. A falta de ciência à pessoa jurídica de Direito Público, prevista no art. 7º, inciso II, da Lei nº 12.016/2009, quando devidamente notificada a autoridade impetrante para prestar as informações e não demonstrado eventual prejuízo, não configura nulidade. (TRF4 5019052-60.2015.4.04.7100, SEXTA TURMA, Relator ARTUR CÉSAR DE SOUZA, juntado aos autos em 17/10/2017 – Grifos nossos.

Assim, requer desde já que seja determinada a apreciação do pedido administrativo formulado pelo Impetrante, tendo em vista que até o presente momento não fora proferida decisão, violando o prazo estipulado no art. 49 da Lei nº 9.784/99.

______________________________

4. Da tutela de urgência

O novo Código de Processo Civil estabelece em seu art. 300 que “A tutela de urgência será concedida quando houver elementos que evidenciem a probabilidade do direito e o perigo de dano ou o risco ao resultado útil do processo”.

No presente caso, o direito está manifestamente comprovado, uma vez que fora ultrapassado e muito o prazo de 30 (trinta) dias, prorrogáveis por mais 30 (trinta), previsto no art. 49 da Lei do Processo Administrativo.

O periculum in mora, de outra banda, se dá pelo caráter alimentar do benefício, sobretudo no presente caso, em que o segurado já se afastou do trabalho e requereu sua aposentadoria visando finalmente obter o descanso após longa vida laboral.

Portanto, imperioso seja determinada, liminarmente, a imediata análise do pedido administrativo de concessão de aposentadoria por idade rural formulado pelo Impetrante.

______________________________

5. Dos pedidos

ISSO POSTO, requer:

a) o recebimento e o deferimento da presente peça inaugural;

b) o deferimento do benefício da Gratuidade da Justiça, por ser o Impetrante pobre na acepção legal do termo;

c) a concessão liminar de tutela de urgência para determinar a imediata análise do pedido administrativo de concessão de aposentadoria por idade rural formulado pelo Impetrante;

d) a notificação da autoridade coatora, Sr. Gerente-Executivo da Agência da Previdência Social de [[CIDADE_REFERENCIA_INSS]]/[[UF_REFERENCIA_INSS]], a ser encontrado em [[ENDERECO_APS]];

e) a CONCESSÃO DA SEGURANÇA a fim de confirmar a tutela de urgência, sendo analisado o pedido administrativo de concessão de aposentadoria por idade rural formulado pelo Impetrante.

Nestes termos,

Pede e espera deferimento.

Dá à causa o valor de 1 (um) salário mínimo.

Cuiabá-MT, [[DATA_ATUAL_EXTENSO]].


PEDRO RODRIGUES MONTALVAO NETO
OAB-MT 30.021$$,
    false
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.document_templates
    WHERE name = 'Modelo - Mandado de Segurança (INSS)'
  );

  SELECT id INTO v_template_id
  FROM public.document_templates
  WHERE name = 'Modelo - Mandado de Segurança (INSS)'
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'template_custom_fields'
  ) THEN
    DELETE FROM public.template_custom_fields
    WHERE template_id = v_template_id;

    INSERT INTO public.template_custom_fields (
      template_id,
      name,
      placeholder,
      field_type,
      enabled,
      required,
      default_value,
      options,
      description,
      "order"
    ) VALUES
      (v_template_id, 'Subseção Judiciária', 'SUBSECAO_JUDICIARIA', 'text', true, true, 'BALSAS', null, null, 0),
      (v_template_id, 'UF da Subseção', 'UF_SUBSECAO', 'text', true, true, 'MA', null, null, 1),
      (v_template_id, 'Protocolo administrativo', 'PROTOCOLO', 'text', true, false, null, null, null, 2),
      (v_template_id, 'Tipo/Benefício', 'BENEFICIO', 'text', true, false, null, null, null, 3),
      (v_template_id, 'Cidade de referência (INSS)', 'CIDADE_REFERENCIA_INSS', 'text', true, true, 'CUIABÁ', null, null, 4),
      (v_template_id, 'UF de referência (INSS)', 'UF_REFERENCIA_INSS', 'text', true, true, 'MT', null, null, 5),
      (v_template_id, 'Endereço da APS', 'ENDERECO_APS', 'textarea', true, true, null, null, null, 6),
      (v_template_id, 'Tempo em análise (dias)', 'TEMPO_EM_ANALISE_DIAS', 'number', true, false, null, null, null, 7);
  END IF;
END $$;
