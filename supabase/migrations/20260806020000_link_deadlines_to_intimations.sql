-- Guardião de Prazos: vincular retroativamente os prazos que já existiam.
--
-- `deadlines.intimation_id` só é gravado quando o prazo nasce pelo botão dentro
-- do card da intimação. Como quase todo prazo do escritório é cadastrado pelo
-- módulo de Prazos, o campo ficou nulo em 378 dos 413 prazos — e o Guardião,
-- que só sabia olhar para ele, passou a anunciar "nenhum prazo cadastrado" para
-- intimações que tinham prazo cadastrado na frente dele. O operador aprendeu a
-- clicar em "Marcar como lida sem prazo", que é o botão que o guardião existe
-- para evitar.
--
-- O código já foi corrigido para reconhecer o vínculo fraco (mesma âncora +
-- janela de vencimento — ver src/utils/deadlineIntimationMatch.ts, onde a regra
-- é documentada e testada). Esta migration aplica a MESMA regra ao passivo,
-- promovendo o vínculo fraco a forte onde ele é inequívoco.
--
-- ÂNCORA: processo quando os dois lados têm processo (aí processos diferentes
-- são "não" definitivo); senão, cliente. O cadastro do escritório é centrado no
-- cliente — 287 dos 413 prazos têm só client_id, e 163 das 837 intimações não
-- têm processo, às vezes porque o processo sequer existe em `processes`.
--
-- Idempotente: só preenche `intimation_id` nulo. Rodar de novo não muda nada.
--
-- Rastro e desfazimento: as linhas tocadas aqui ficam com intimation_id
-- preenchido, `origin` intacto (continua 'manual') e `confirmed_at` NULO —
-- confirmed_at só é gravado quando um humano confirma o vínculo na tela. Para
-- desfazer:
--
--   update public.deadlines set intimation_id = null
--    where origin = 'manual' and confirmed_at is null and intimation_id is not null;

-- Âncora emprestada: parte das intimações chega sem processo E sem cliente. Como
-- a mesma decisão costuma sair publicada mais de uma vez, uma irmã de mesmo
-- número de processo geralmente já está vinculada — e mesmo número é o mesmo
-- processo, por definição. `order by id` só para o resultado não depender da
-- ordem em que o banco devolveu as linhas.
with ancora_por_numero as (
  select numero_processo,
         (array_agg(process_id order by id) filter (where process_id is not null))[1] as process_id,
         (array_agg(client_id  order by id) filter (where client_id  is not null))[1] as client_id
    from public.djen_comunicacoes
   where numero_processo is not null
   group by numero_processo
),
intimacoes as (
  select c.id,
         c.data_disponibilizacao,
         coalesce(c.process_id, an.process_id) as process_id,
         coalesce(c.client_id,  an.client_id)  as client_id,
         a.deadline_due_date
    from public.djen_comunicacoes c
    join public.intimation_ai_analysis a
      on a.intimation_id = c.id
    left join ancora_por_numero an
      on an.numero_processo = c.numero_processo
   where a.deadline_due_date is not null
),
candidatos as (
  select distinct on (d.id)
         d.id as deadline_id,
         c.id as intimation_id
  from public.deadlines d
  join intimacoes c
    on (
         -- âncora forte: mesmo processo dos dois lados
         (d.process_id is not null and c.process_id is not null and d.process_id = c.process_id)
         -- âncora fraca: falta processo de um dos lados, sobra o cliente
      or (
           (d.process_id is null or c.process_id is null)
           and d.client_id is not null and c.client_id is not null
           and d.client_id = c.client_id
         )
       )
  where d.intimation_id is null
    and d.status <> 'cancelado'
    -- o prazo não pode vencer antes de a intimação existir
    and d.due_date >= c.data_disponibilizacao
    -- 21 dias de folga: a estimativa da IA erra para menos (conta dias corridos,
    -- e sobre a disponibilização em vez da publicação)
    and d.due_date <= c.deadline_due_date + interval '21 days'
  -- havendo mais de uma intimação possível: primeiro a ligada pelo processo, que
  -- é a âncora forte; depois a que a IA estimou mais perto do vencimento
  -- cadastrado; empate resolve pela mais recente e pelo id, para o resultado não
  -- depender da ordem em que o banco devolveu as linhas
  order by d.id,
           (d.process_id is not null and c.process_id is not null) desc,
           abs(extract(epoch from (d.due_date - c.deadline_due_date))),
           c.data_disponibilizacao desc,
           c.id
)
update public.deadlines d
   set intimation_id = candidatos.intimation_id,
       updated_at = now()
  from candidatos
 where d.id = candidatos.deadline_id
   and d.intimation_id is null;
