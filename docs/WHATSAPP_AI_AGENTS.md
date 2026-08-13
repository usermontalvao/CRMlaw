# Manual dos agentes de IA do WhatsApp

Este manual é para quem configura o atendimento, sem precisar conhecer o código.

## O que a tela separa

- **JSON estruturado:** regras gerais da campanha, continuidade e comportamento.
- **Configuração abaixo do JSON:** pessoas, setores e modelos reais do CRM.
- **Informações que o agente vai coletar:** campos, perguntas, ordem e condições.
- **Regras automáticas:** cortes calculados pelo sistema, não pelo modelo de IA.
- **Limites:** o que o agente não pode afirmar ou prometer.
- **Ações:** o que ele pode executar no CRM.
- **Acompanhamentos:** quando e como retomar uma pergunta pendente.

Nomes de pessoas, setores, IDs e templates devem ser escolhidos nos menus. Não os
escreva diretamente no JSON.

## Como criar um agente

1. Abra **Configurações → WhatsApp → Agentes de IA** e clique em **Novo agente**.
2. Dê um nome claro, por exemplo `Triagem — trabalho sem registro`.
3. Deixe em **Teste** até concluir todos os cenários deste manual.
4. Em **O que este agente deve fazer**, escolha um dos modelos visuais ou cole o
   JSON da campanha.
5. Confirme se a tela mostrou `JSON estruturado ativo` e a quantidade de campos.
6. Logo abaixo, selecione cada pessoa, setor ou modelo solicitado.
7. Confira a lista **Informações que o agente vai coletar** e as **Regras automáticas**.
8. Escreva os limites jurídicos e comerciais em linguagem direta.
9. Configure os acompanhamentos somente para perguntas da triagem. Documentos e
   assinaturas já possuem cobrança própria.
10. Use **Testar agente**. Só depois dos testes, altere para **Automático** e salve.

## Campanha “Trabalhou sem registro na carteira”

O sistema identifica os 17 campos automaticamente:

- nome, empregador e tipo de empregador;
- início, situação atual e saída, quando aplicável;
- função, necessidade de ser a própria pessoa, pagamento, valor/forma de pagamento,
  regularidade, rotina e direção/cobrança;
- existência e descrição de provas, testemunha e outros trabalhos sem carteira.

Os cortes automáticos são:

- órgão público;
- saída fora da janela de dois anos, usando a data real e o fuso do escritório;
- possibilidade de outra pessoa substituir livremente;
- ausência de pagamento;
- trabalho apenas esporádico;
- ausência de direção ou cobrança;
- ausência simultânea de prova e testemunha.

Uma resposta confusa não gera corte. O agente deve reformular a pergunta. Exemplos:
`não entendi`, `não sei`, `não lembro`, `talvez` e `mais ou menos`.

## O que acontece quando a triagem termina

Se houver um corte, o sistema encerra as perguntas e segue a orientação configurada.
O agente não pode dizer que a pessoa “não tem direito”; ele informa apenas que o caso
não se enquadrou nos critérios de atendimento do escritório.

Se todos os critérios forem confirmados, o backend faz o fechamento mesmo que o
modelo esqueça as ações:

1. solicita documento de identificação, CTPS Digital e apenas as provas que a pessoa
   informou possuir;
2. vincula a conversa a um cadastro único pelo telefone ou cria um pré-cadastro;
3. encaminha para a pessoa ou setor selecionado em **Triagem concluída e qualificada**;
4. cancela o acompanhamento genérico da triagem, pois documentos têm acompanhamento
   próprio.

Se o telefone corresponder a mais de um cliente, o sistema não escolhe no chute: passa
o caso para conferência humana.

## Roteiro mínimo de testes

Converse do início ao fim em cada cenário:

1. **Qualificado:** respostas completas, prova ou testemunha e período dentro da janela.
2. **Órgão público:** `era da prefeitura`.
3. **Prescrição:** data antiga, inclusive mês escrito errado, como `marcço de 2023`.
4. **Substituição:** `meu irmão podia ir por mim`.
5. **Sem pagamento:** `era voluntário`.
6. **Esporádico:** `era um bico, só quando chamava`.
7. **Sem direção:** `ninguém mandava, eu fazia meu horário`.
8. **Sem prova e testemunha:** `não tenho nada` e depois `ninguém`.
9. **Confuso:** `não entendi` — deve explicar de outra forma, sem cortar.
10. **Informação antecipada:** responda várias coisas de uma vez — não deve repeti-las.
11. **Mensagens curtas:** divida uma resposta em várias mensagens seguidas.
12. **Pedido de humano ou irritação:** deve colher contexto mínimo e encaminhar.

Em todos os testes confirme:

- uma pergunta por vez;
- nenhuma pergunta já respondida;
- campo certo salvo no painel;
- corte certo e sem opinião jurídica;
- data calculada pelo sistema;
- documento registrado e destino correto no final qualificado;
- nenhum acompanhamento genérico depois de corte ou transferência.

## Campanha “Bloqueio ou encerramento de conta”

Na tela, clique em **Conta bloqueada ou encerrada**. O sistema monta 14 campos,
5 etapas e 5 cortes. Depois selecione:

- **KIT CONSUMIDOR:** o modelo de documento que o cliente preencherá e assinará;
- **Preparar declaração de residência:** o setor que atende a rota sem comprovante
  aceito e sem contrato de aluguel;
- **KIT CONSUMIDOR assinado:** o setor que recebe o caso após a assinatura confirmada.

O roteiro coleta nome, banco réu, bloqueio ou encerramento, data, aviso prévio,
print, saldo retido e valor quando houver, rota do comprovante de residência e
aceite dos honorários de 40%.

As rotas de residência são:

- comprovante em nome próprio;
- comprovante em nome de esposa, esposo, pai ou mãe, registrando nome e parentesco;
- imóvel alugado com contrato, solicitando o contrato;
- imóvel de terceiro sem contrato: coleta nome, endereço e documento do declarante,
  informa que a declaração pode ser manuscrita, assinada e fotografada, e transfere
  ao operador que prepara a declaração.

O fechamento normal é obrigatório e nesta ordem:

1. solicitar identificação do cliente, print do problema e documento da rota de
   residência;
2. esperar todos os documentos obrigatórios ficarem aprovados;
3. enviar o **KIT CONSUMIDOR** e orientar: no campo **Réu**, escrever o nome do banco;
4. acompanhar o preenchimento e a assinatura;
5. confirmar a assinatura no sistema;
6. somente então avisar e transferir ao destino pós-assinatura.

O sistema impede atalhos: não envia o KIT com documentos pendentes, não transfere
porque o cliente apenas escreveu “assinei” e não trata KIT recusado como assinado.

### Follow-ups desta campanha

Existem três acompanhamentos, sem duplicação:

- **triagem:** configurado no agente; retoma apenas a primeira pergunta ainda sem
  resposta e para quando o cliente responde, ocorre corte ou transferência;
- **documentos:** automático, cobrando somente itens faltantes em 1, 3, 7, 14 e
  30 dias;
- **KIT/assinatura:** automático em 4 horas, 1, 3, 7 e 14 dias, apenas em horário
  comercial. O link vale 30 dias.

Ao concluir os documentos, o KIT é enviado automaticamente. Ao assinar, os
follow-ups especializados são interrompidos e o atendimento é transferido
automaticamente.

### Testes obrigatórios da campanha de conta

Converse até o fim nestes cenários:

1. bloqueio recente, sem aviso, com print, sem saldo e comprovante próprio;
2. encerramento recente, saldo retido e comprovante no nome da mãe;
3. aluguel com contrato;
4. casa de favor sem contrato, com documento do declarante;
5. resposta confusa (`não entendi`) e reformulação, sem corte;
6. data com erro de escrita (`feverero de 2024`) e corte calculado pelo sistema;
7. banco avisou previamente;
8. sem print;
9. declarante sem documento;
10. honorários de 40% não aceitos;
11. silêncio durante a triagem, conferindo o follow-up da pergunta pendente;
12. documentos completos, conferindo envio do KIT; assinatura pendente, conferindo
    que não transfere; assinatura concluída, conferindo que transfere.

## Alterar ou apagar o JSON

- Ao editar o JSON, a configuração abaixo é reconstruída a partir dele.
- Ao apagar o JSON, campos, regras e vínculos derivados também desaparecem da tela.
- **Restaurar JSON desta campanha** recupera o roteiro padrão.
- Um agente antigo desta campanha é atualizado para os campos e cortes atuais quando
  a configuração é aberta e salva; os destinos já escolhidos são preservados.

## Criar uma campanha diferente

Não copie apenas o texto de outra campanha. Defina, nesta ordem:

1. quais informações precisam ser salvas;
2. a pergunta simples de cada informação;
3. a ordem das etapas;
4. quando um campo só se aplica em determinada resposta;
5. os cortes objetivos e sua orientação segura;
6. o que ocorre no fechamento;
7. os destinos e templates que serão selecionados na tela;
8. a matriz de testes com respostas normais, erradas, ambíguas e populares.

Se a tela não mostrar os campos e cortes esperados, não coloque o agente em automático.
