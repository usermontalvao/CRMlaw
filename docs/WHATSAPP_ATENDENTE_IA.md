# Atendente de IA do WhatsApp

> Documento vivo. É o estado do projeto — quem retomar em outra sessão lê daqui.
> Marque `[x]` ao concluir cada passo. Nada aqui descreve intenção: ou está feito, ou está por fazer.

## O que é

Um atendente de IA que trabalha **dentro** do módulo de WhatsApp que já existe. Ele não é um
módulo novo, não tem caixa de entrada própria e não guarda conversa em lugar separado. Ele é um
usuário-robô: faz pela API as mesmas coisas que um atendente humano faz pela tela.

O que ele precisa dar conta, em ordem de valor:

1. Atender leads que chegam num canal (campanha, anúncio, orgânico — para ele é igual)
2. Qualificar
3. Apresentar a proposta que o escritório escreveu
4. Coletar documentos
5. Coletar assinatura
6. Transferir para uma pessoa específica

## Decisões que não se renegociam sem ler o histórico

Esta é a **quarta** tentativa. As três anteriores estão documentadas em §Histórico. As decisões
abaixo existem porque as anteriores morreram por não tê-las.

| Decisão | Por quê |
|---|---|
| A IA decide, o motor executa | Separar "propor" de "fazer" é o que torna o sistema auditável e desligável |
| Catálogo fechado de gatilhos | Motor de regras genérico foi construído 2× e descartado 2× — configuração demais antes da primeira conversa |
| Modo sombra primeiro | Nenhuma tentativa anterior chegou a conversar com cliente. Sombra tira o risco e ainda assim gera prova |
| Envio só via `evolution-send` | `fetch` direto na Evolution marca "enviado" e **não entrega**. Já causou bug em produção |
| Prompt em português, não JSON | O escritório calibra sozinho, sem desenvolvedor no caminho |
| Assinatura sempre com aprovação | Único erro que não dá para desfazer |
| Tabelas novas, nenhuma alterada | Remoção é `drop table`, sem tocar no núcleo |

## Como funciona

```
Cliente → evolution-webhook → grava e mostra no inbox        (JÁ EXISTE, não muda)
                    ↓ waitUntil + try/catch
              agrupa mensagens picadas (15 s)                 ┐
                    ↓                                          │
              monta contexto: prompt do agente + histórico     │  NOVO
                    ↓                                          │  pode sumir inteiro
              modelo de IA → propõe resposta + gatilhos        │  sem afetar a linha
                    ↓                                          │  de cima
              ╔═ CERCA ═╗ valida cada gatilho                  │
                    ↓                                          │
        sombra · aprovação · automático                        ┘
```

**A cerca**, para cada gatilho pedido: existe no catálogo? → está implementado? → está liberado
para este agente? → é risco alto? Qualquer "não" nas três primeiras **barra**, registra e devolve
erro à IA, que segue a conversa sem ele. Risco alto exige aprovação humana mesmo em modo automático.

Se a edge function inteira cair, o webhook engole o erro e a mensagem chega no inbox normalmente.

## Múltiplos agentes

Cada agente é uma função, não uma etapa. Um canal tem **um agente primário** (quem atende o
primeiro contato) e os demais entram por passagem explícita.

```
AG1 Triagem ──@PassarPara──▶ AG2 Qualificação ──@PassarPara──▶ AG3 Documentos
     │                              │                                │
     └──────────@TransferirHumano───┴────────────────────────────────┘
```

Cada agente tem prompt próprio, gatilhos próprios e modo próprio. **O que ele não pode fazer não
é pedido no prompt — simplesmente não está na lista dele.** AG1 não tem `enviar_link_assinatura`;
não é que ele foi instruído a não usar, é que ele não sabe que existe.

**Sobreposição de prompt (regra obrigatória):** ao passar para outro agente, a primeira pergunta
do próximo vai junto, na mesma mensagem. Nunca "vou te transferir" seguido de silêncio — isso faz
o cliente responder duas vezes e escancara a troca.

## Criação de funil por prompt

O escritório descreve em português o atendimento que quer, e a IA gera:

- as etapas do funil do canal (`whatsapp_channel_funnel_stages`)
- um agente por função, com prompt inicial e gatilhos sugeridos
- as passagens entre eles

Tudo nasce **desativado e em modo sombra**. O gerador propõe; ninguém entra no ar sem revisão.
Matéria-prima disponível para ele aprender o jeito da casa: as conversas reais já no banco, com o
desfecho do funil colado nelas.

## Catálogo de gatilhos

Fonte única: [`supabase/functions/_shared/wa-agent-tools.ts`](../supabase/functions/_shared/wa-agent-tools.ts).
Lido pelo motor, pela tela de configuração e pelo gerador de funil. Alterar lá altera nos três.

| Gatilho | Risco | Executa |
|---|---|---|
| `registrar_dados` | baixo | ✅ |
| `salvar_nome` | baixo | ✅ |
| `transferir_humano` | baixo | ✅ |
| `resumir_atendimento` | baixo | ✅ |
| `parar_ia` | baixo | ✅ |
| `qualificar` | médio | ✅ |
| `mover_etapa` | médio | ✅ |
| `pedir_documentos` | médio | ✅ |
| `enviar_template` | médio | ✅ |
| `agendar_followup` | médio | ✅ |
| `passar_para_agente` | médio | ✅ |
| `gerar_contrato` | **alto** | ⬜ |
| `enviar_link_assinatura` | **alto** | ⬜ |
| `marcar_reuniao` | **alto** | ⬜ |
| `consultar_processo` | baixo | ⬜ |

`enviar_template` é como a **proposta** é apresentada: o texto é do escritório, revisado; a IA
decide apenas o momento. A IA nunca redige proposta nem cláusula.

## Passos

### Fase 1 — Decidir sem agir

- [x] Catálogo de gatilhos + porteiro — `_shared/wa-agent-tools.ts`
- [x] Migration: 4 tabelas novas + roteiro de remoção escrito junto
- [x] Executor dos gatilhos — `_shared/wa-agent-executor.ts`
- [x] Motor: contexto, tool calling, cerca, log de decisão — `whatsapp-agent/index.ts`
- [x] Agrupamento de mensagens picadas (dentro do motor)

- [x] **Migration aplicada** em produção (09/08)
- [x] **Edge function `whatsapp-agent` publicada** — verify_jwt=false, auth própria (WA_AI_TOKEN ou service key)
- [x] **Plug feito sem tocar no webhook** — `whatsapp-ai-flow` virou encaminhador para `whatsapp-agent`. Reapontar o webhook exigiria redeployar a função de ingestão de TODA mensagem; não compensa o risco
- [x] Primeiro agente cadastrado — `triagem-pedro`, canal Pedro, modo sombra
- [x] Encaminhador com porta própria (v16) — verificado: 401 sem credencial, 405 no GET

### Telas — `src/components/whatsapp/agent/`

Todas fora do `WhatsAppModule.tsx`, exceto uma linha de montagem.

- [x] **Decisões** (`AgentWorkbench`, aba 1) — o log do modo sombra, com os números no topo.
      `Mensagens enviadas` fica verde em zero: é a prova de que ele não falou com ninguém
- [x] **Agentes** (`AgentWorkbench`, aba 2) — modo, agrupamento, gatilhos com selo de risco,
      interruptor de ativo. Em Configurações → Módulos → WhatsApp → painel "Atendente de IA"
- [x] **Editor de prompt** (`PromptEditor`) — menções validadas em três níveis: vermelho não
      existe no catálogo e **trava o salvamento**; âmbar existe mas não está liberado para o
      agente; normal é válida. Paleta insere no cursor, e há prévia com as menções pintadas
- [x] **Faixa na conversa** (`AgentConversationBanner`) — dentro do inbox, mostra o que o agente
      faria agora, os gatilhos e o que já coletou. Some sozinha se ele nunca atuou ali

### Para ligar (o agente está cadastrado e DESATIVADO)

- [ ] Confirmar que `WA_AI_TOKEN` está nos secrets das Edge Functions. Se não estiver, o
      webhook chama sem credencial, o encaminhador nega e o atendente não roda — falha
      fechada, sem estrago, mas silenciosa. O log do encaminhador diz isso explicitamente
- [ ] Reativar: `is_active = true` no agente e `ai_enabled = true` no canal
- [ ] Ler uma semana de decisões antes de pensar em sair do modo sombra

**Fim da fase 1:** conversa real sendo lida, zero mensagem enviada, zero alteração no CRM.
É aqui que se decide se vale continuar.

### Fase 2 — Agir no que é seguro

- [ ] Executor dos gatilhos de risco baixo e médio
- [ ] Modo aprovação: a resposta espera um clique
- [ ] Múltiplos agentes + `passar_para_agente` com sobreposição
- [ ] Tela do agente: prompt, gatilhos liberados, modo, versão

### Fase 3 — Proposta e assinatura

- [ ] `gerar_contrato` a partir do modelo do escritório
- [ ] `enviar_link_assinatura` via `send-signature-link` (**nunca** por INSERT direto — a trilha auditável existe por razão jurídica)
- [ ] Trava permanente de aprovação nos dois

### Fase 4 — Criação por prompt

- [ ] Gerador de funil + agentes a partir de descrição em português
- [ ] Aprender das conversas reais com desfecho

## Como sair

| Degrau | Comando | Efeito |
|---|---|---|
| Desligar | `update whatsapp_ai_channel_config set ai_enabled = false` | Para na hora, sem deploy |
| Apagar dados | `drop table whatsapp_ai_agents, ...` | Some config e log; conversas intactas |
| Tirar do código | `git revert` | Uma edge function e uma chamada a menos |

Em modo sombra não há o que desligar: nada é executado.

## Histórico — as três tentativas anteriores

Registrado para que a quarta não repita o padrão. As três morreram pelo mesmo motivo:
**começaram pela configuração e nenhuma chegou a conversar com um cliente.**

**1ª — 14/06/2026 · playbooks (`whatsapp-ai-flow`)**
Foi para produção e nunca foi ligada. Até hoje zero canais com `ai_enabled`. Era questionário
sequencial: mandava a pergunta N e gravava a resposta crua no campo N−1; o `system_prompt` do
playbook nunca foi usado. Continua no repositório, dormente. **O motor novo o substitui.**

**2ª — 16/06/2026 · fundação de workflows**
Schema de agentes/workflows/regras no repositório, sem motor. Sobraram constantes `WF_*` em
`shared.ts` apontando para tabelas inexistentes — removidas nesta limpeza.

**3ª — 18/06/2026 · motor completo**
Chegou a rodar em produção: controle de concorrência, etapa de assinatura, instruções por etapa.
Apagado à mão no mesmo dia, "descarte definitivo a pedido do Pedro". O roteiro de remoção
registrava que não tocava em nada do núcleo — e o sistema seguiu funcionando. **É a prova de que
a saída funciona.**

**4ª proposta — 02/07/2026 · builder visual tipo Typebot**
Nunca saiu do papel. Propunha motor de regras com ~20 condições e ~17 ações configuráveis em
canvas. Descartada aqui por ser a mesma abordagem que já falhou duas vezes.

**O que se aproveitou dela**, porque foi aprendido caro e vale para qualquer motor: lock por
conversa, idempotência por evento, no máximo uma transição por ciclo, só o motor escreve estado,
aprovação humana ligada por padrão, estado de exceção que não derruba a inbox, e log de auditoria.

**O que se rejeitou:** a regra de que a IA não pode escolher o próximo passo. É justamente o que
se pede aqui, é o que a referência do mercado faz, e é a alternativa à configuração que matou as
duas primeiras.
