# Rollback da série `20260822*_whatsapp_*`

## Por que esta pasta não tem um arquivo pronto

Um rollback é um retrato do estado anterior. Guardar o retrato no repositório
parece prudente e é armadilha: qualquer migration que toque nas mesmas funções
entre o dia em que o retrato foi tirado e o dia do deploy o deixa desatualizado
— e aplicar um rollback desatualizado não devolve o estado anterior. Ele
instala um estado que nunca existiu, o que é pior do que não ter rollback,
porque a equipe acredita que voltou.

Então o retrato é tirado **no momento do deploy**, do banco vivo.

## Antes de aplicar

```bash
psql "$DATABASE_URL" -At -f scripts/wa-gerar-rollback.sql \
  > supabase/rollback/whatsapp_permissoes_$(date +%Y%m%d%H%M).sql
```

Confira que o arquivo saiu com conteúdo (algumas dezenas de KB) e que ele
contém `create or replace function public.is_office_staff` — se estiver vazio,
a conexão não tinha permissão de ler `pg_get_functiondef` e o rollback **não
existe**. Não aplique as migrations nesse caso.

Guarde o arquivo fora do repositório também (ele é operacional, não código).

## Para voltar

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/<o-arquivo-gerado>.sql
```

E, do lado do front-end, volte o build anterior. A ordem não é crítica: o
front-end desta série foi escrito para funcionar com o banco antigo (ele
pergunta pelas colunas novas e cai nas antigas quando o banco responde 42703 /
PGRST202). Um front novo sobre um banco revertido continua atendendo — sem a
etiqueta de intervenção, sem o Modo supervisão com escopo e com a agenda
carregando a primeira página inteira.

## O que o rollback NÃO desfaz, e por quê

Colunas e tabelas criadas pela série são **aditivas**:

| objeto | por que fica |
| --- | --- |
| `whatsapp_transfers.status` / `expires_at` / `resolved_*` | depois de a operação rodar, é o estado real das transferências — apagar é perder auditoria |
| `whatsapp_messages.sender_role` | registra quem interveio em qual mensagem |
| `whatsapp_channel_members.role` / `whatsapp_department_members.role` | quem foi promovido a supervisor; o código antigo simplesmente ignora a coluna |
| `whatsapp_conversation_collaborators` | histórico de empréstimos concedidos |
| `whatsapp_call_logs.instance_id` | canal da ligação, derivado da conversa |

O código antigo não lê nenhuma delas, então mantê-las não muda comportamento.
Removê-las é uma decisão separada, e depois de a operação já ter usado esses
campos ela custa auditoria — não faça junto com o rollback, no susto.

## O que o rollback desliga explicitamente

- o gatilho `wa_offboard_ao_desativar` (desligamento automático);
- o gatilho `wa_transfer_revoga_colaboradores`;
- a policy do broadcast por canal em `realtime.messages`;
- a assinatura `whatsapp_contact_book(text, integer)`.

As funções novas (`wa_can_manage_conv`, `wa_offboard_user`, …) **ficam**. Elas
não são chamadas por nada depois do rollback, e removê-las quebraria o rollback
pela metade se alguma policy antiga já tivesse sido recriada apontando para
elas. Função parada não faz mal; função removida no meio de uma dependência faz.

## Verificação depois de voltar

```sql
-- Espera-se `false`: is_office_staff voltou a não exigir is_active.
select prosrc ilike '%is_active%' as ainda_exige_ativo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'is_office_staff';

-- Espera-se `true`: whatsapp_transfers voltou a aceitar escrita direta.
select exists (
  select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
   where c.relname = 'whatsapp_transfers' and pol.polcmd = 'a'
     and pg_get_expr(pol.polwithcheck, pol.polrelid) ilike '%is_office_staff%'
) as insert_direto_de_volta;
```

Se as duas responderem o esperado, o comportamento anterior está de volta —
inclusive os furos que a série corrigia. É esse o ponto de um rollback, e é por
isso que ele é o último recurso, não o primeiro.
