import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const wikiComponentSource = readFileSync(new URL('./WikiModule.tsx', import.meta.url), 'utf8');
const wikiServiceSource = readFileSync(new URL('../services/wiki.service.ts', import.meta.url), 'utf8');
const migrationSource = readFileSync(
  new URL('../../supabase/migrations/20260831120000_wiki_central_ajuda.sql', import.meta.url),
  'utf8',
);
const singleFlowMigrationSource = readFileSync(
  new URL('../../supabase/migrations/20260831183000_wiki_fluxo_unico_instalacao.sql', import.meta.url),
  'utf8',
);

test('Central de ajuda fica no menu da foto, imediatamente antes de sair', () => {
  const helpPosition = appSource.indexOf('Central de ajuda', appSource.indexOf('setProfileMenuOpen(false)'));
  const logoutPosition = appSource.indexOf('Sair da conta', helpPosition);

  assert.ok(helpPosition >= 0, 'o menu da foto deve exibir Central de ajuda');
  assert.ok(logoutPosition > helpPosition, 'Central de ajuda deve vir antes de Sair da conta');
  assert.doesNotMatch(appSource, /SidebarModuleBtn\s+moduleKey="wiki"/);
});

test('manuais são lidos do Supabase, sem conteúdo fixo no componente', () => {
  assert.match(wikiServiceSource, /\.from\('wiki_categories'\)/);
  assert.match(wikiServiceSource, /\.from\('wiki_articles'\)/);
  assert.match(wikiServiceSource, /\.eq\('is_published', true\)/);
});

test('instalação é um fluxo principal único e os demais artigos são consulta', () => {
  assert.match(wikiComponentSource, /PRIMARY_GUIDE_SLUG = 'comece-aqui-token-remoto'/);
  assert.match(wikiComponentSource, /Iniciar instalação/);
  assert.match(wikiComponentSource, /Conteúdos de consulta/);
  assert.match(wikiComponentSource, /item\.slug !== PRIMARY_GUIDE_SLUG/);

  const bodyMatch = singleFlowMigrationSource.match(/\$json\$([\s\S]*?)\$json\$/);
  assert.ok(bodyMatch, 'a migração deve conter o corpo do fluxo completo');
  const body = JSON.parse(bodyMatch[1]) as { sections: Array<{ title: string }> };
  assert.equal(body.sections.length, 9);
  assert.deepEqual(body.sections.slice(0, 7).map((section) => section.title), [
    'Instale o Cloudflare One Client (WARP)',
    'Confirme que o servidor do token está acessível',
    'Instale e configure o VirtualHere Client',
    'Conecte o token neste computador',
    'Instale o SafeSign e confira o certificado',
    'Instale e abra o PJeOffice Pro',
    'Faça o primeiro teste no PJe',
  ]);
});

test('migração protege a Wiki e inclui o guia leigo do WARP', () => {
  assert.match(migrationSource, /enable row level security/i);
  assert.match(migrationSource, /grant select on table public\.wiki_categories to authenticated/i);
  assert.match(migrationSource, /grant select on table public\.wiki_articles to authenticated/i);
  assert.match(migrationSource, /https:\/\/one\.dash\.cloudflare\.com\//);
  assert.match(migrationSource, /equipe-jurius/);
  assert.match(migrationSource, /pedro@advcuiaba\.com/);
  assert.match(migrationSource, /Windows/i);
  assert.match(migrationSource, /macOS/i);
});
