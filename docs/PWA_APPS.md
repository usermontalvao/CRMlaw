# Apps instaláveis separados (PWA)

O site serve **mais de um app instalável** na mesma origem. Hoje:

| App | Caminho | Manifest | Entrada |
|---|---|---|---|
| CRM (geral) | `/` | `public/manifest.webmanifest` | `index.html` → `src/main.tsx` |
| Atendimento (WhatsApp) | `/atendimento` | `public/atendimento.webmanifest` | `atendimento.html` → `src/atendimento.tsx` |
| Editor de Petições | `/editor` | `public/editor.webmanifest` | `editor.html` → `src/editor.tsx` |

## A regra que faz um app ser SEPARADO

O navegador decide qual app está sendo instalado pela tag `rel="manifest"` que
encontra **ao analisar o HTML servido**. Trocar o `href` depois, por JavaScript,
não muda essa decisão: o Chrome já avaliou a página como o app geral e "Instalar"
oferece o CRM inteiro — com o nome e o ícone do CRM.

Por isso cada app separado precisa da **sua própria página HTML**.

O `main.tsx` ainda tem blocos que trocam o manifest por script para `/editor` e
`/atendimento`. Eles NÃO são o mecanismo de instalação: cobrem o hash legado
`#/editor` (de quem instalou o app antes da migração para caminho) e o caso de a
reescrita do servidor falhar, quando o `index.html` acaba atendendo o caminho.

Um efeito colateral bem-vindo do HTML próprio: o **favicon da aba** também passa a
ser o do app. Com o HTML compartilhado, a aba mostrava o "J" do Jurius.

## Receita para criar o próximo app

Suponha o app `financeiro`:

1. **Ícones** — copie `scripts/render-atendimento-icon.mjs` para
   `scripts/render-financeiro-icon.mjs`, troque a arte do SVG e rode-o.
   Saída: `public/financeiro-icon-192.png` e `-512.png` (tile full-bleed, o
   símbolo dentro dos ~64% centrais, para sobreviver ao recorte "maskable").
2. **Manifest** — `public/financeiro.webmanifest`, espelhando o do Atendimento.
   O `id`, o `start_url` e o `scope` são `/financeiro`; `name`, `theme_color` e
   os ícones são os do app.
3. **Página** — `financeiro.html` na raiz, copiando `atendimento.html`: manifest,
   favicon, `apple-touch-icon`, `theme-color`, `<title>` e o `<script>` da
   entrada própria.
4. **Entrada** — `src/financeiro.tsx`, copiando `src/atendimento.tsx`: monta
   direto a casca do app (nada de roteamento do CRM).
5. **Casca** — `src/FinanceiroApp.tsx`, no molde de `src/WhatsAppApp.tsx`: só os
   providers de que o módulo precisa, redirecionando ao login em `/` quando não
   houver sessão.
6. **Build** — acrescente `'financeiro'` a `PWA_APPS` em `vite.config.ts`.
7. **Servidor** — regra de reescrita `/financeiro → /financeiro.html 200`
   **antes** do catch-all, em `netlify.toml` e em `public/_redirects`. Sem isso o
   catch-all entrega o `index.html` do CRM e o app desaparece.
8. **Cache** — em `public/_headers`, `financeiro.html` com `no-store` (como o
   `index.html`); em `public/sw.js`, manifest e ícones no `PRECACHE_URLS`.

Em desenvolvimento o Vite já reescreve `/financeiro` para `/financeiro.html`
sozinho — a regra do item 7 é só para produção.

## O que NÃO funciona em desenvolvimento

`registerVersionedServiceWorker` devolve `null` fora de produção, e sem service
worker o navegador **não oferece instalar**. Em `localhost` o app abre e funciona,
mas só dá para instalar de verdade a partir do site publicado.

## Caminhos reservados

Os caminhos dos apps (`/editor`, `/atendimento`, …) **não podem** virar caminho de
módulo do CRM em `src/utils/moduleRoutes.ts` — o módulo abriria o app instalado no
lugar do CRM. O inverso também vale: `/whatsapp` é o módulo dentro do CRM e por
isso o app do WhatsApp mora em `/atendimento`.
