# Projeto MCP

Documentacao criada em 04/06/2026 para preparar o CRM Jurius para:

- exposicao futura via MCP (Model Context Protocol);
- definicao de niveis de autorizacao por funcao;
- evolucao do produto para arquitetura SaaS;
- implementacao futura de agentes/IA capazes de operar fluxos reais do sistema.

## Objetivos desta pasta

1. mapear o sistema real hoje, sem simplificacoes;
2. listar modulos, servicos, funcoes, rotas e integracoes existentes;
3. identificar o que ja pode virar ferramenta MCP;
4. separar o que exige autorizacao de cliente, equipe, admin ou sistema;
5. planejar a ordem correta de implementacao para evitar retrabalho quando o produto virar SaaS.

## Arquivos

- `01_Arquitetura_Atual.md` - visao tecnica do sistema hoje.
- `02_Inventario_Completo.md` - inventario detalhado de modulos, servicos, tipos, funcoes e migracoes.
- `03_Catalogo_MCP_e_Autorizacao.md` - desenho inicial do MCP, ferramentas, recursos, prompts e niveis de acesso.
- `04_Planejamento_SaaS.md` - plano para transformar o produto em SaaS multi-tenant.
- `05_Roadmap_MCP_SaaS.md` - ordem recomendada de execucao para MCP + SaaS + IA conectada.

## Conclusao executiva

O sistema ja possui base funcional suficiente para um MCP robusto:

- cadastro e busca de clientes;
- processos, requerimentos, prazos e agenda;
- financeiro com acordos e parcelas;
- documentos, templates e geracao;
- assinatura digital com links publicos;
- cloud/share publico;
- chat interno e chat portal;
- portal do cliente com autenticacao propria;
- Edge Functions e RPCs no Supabase;
- controle de permissoes por cargo e override individual.

Ao mesmo tempo, a analise indica que o sistema ainda esta estruturado como produto de escritorio unico, nao como SaaS multi-tenant nativo. Por isso, a recomendacao e:

1. consolidar o catalogo de capacidades;
2. padronizar autorizacao por escopo;
3. introduzir tenancy de forma transversal;
4. so depois abrir MCP write tools mais amplas;
5. por fim, plugar agentes de IA conectados ao sistema.
