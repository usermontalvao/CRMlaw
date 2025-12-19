const { execSync } = require('node:child_process');

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}

function safeRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function getStagedFiles() {
  const out = safeRun('git diff --cached --name-only');
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function getJsonFromGit(ref, path) {
  const spec = ref === ':' ? `:${path}` : `${ref}:${path}`;
  const raw = run(`git show ${spec}`);
  return JSON.parse(raw);
}

function getTextFromGit(ref, path) {
  const spec = ref === ':' ? `:${path}` : `${ref}:${path}`;
  return run(`git show ${spec}`);
}

function main() {
  const inRepo = safeRun('git rev-parse --is-inside-work-tree');
  if (!inRepo) process.exit(0);

  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) process.exit(0);

  const requiredFiles = ['package.json', 'src/components/DocsChangesPage.tsx'];
  const onlyRequired = stagedFiles.every((f) => requiredFiles.includes(f));

  if (!onlyRequired) {
    const missing = requiredFiles.filter((f) => !stagedFiles.includes(f));
    if (missing.length > 0) {
      console.error('\n[pre-commit] Commit bloqueado: toda alteração deve atualizar versão e changelog.');
      console.error('[pre-commit] Arquivos obrigatórios não staged:');
      missing.forEach((m) => console.error(`- ${m}`));
      console.error('\n[pre-commit] Ação necessária:');
      console.error('- Atualize o "version" no package.json');
      console.error('- Atualize o changelog em src/components/DocsChangesPage.tsx');
      console.error('- Adicione ambos ao stage e tente novamente.\n');
      process.exit(1);
    }
  }

  // Validar bump de versão
  let headPkg;
  try {
    headPkg = getJsonFromGit('HEAD', 'package.json');
  } catch {
    headPkg = null;
  }

  const stagedPkg = getJsonFromGit(':', 'package.json');
  const headVersion = headPkg?.version || null;
  const stagedVersion = stagedPkg?.version || null;

  if (!stagedVersion) {
    console.error('\n[pre-commit] Commit bloqueado: package.json sem campo "version".\n');
    process.exit(1);
  }

  if (headVersion && headVersion === stagedVersion) {
    console.error(`\n[pre-commit] Commit bloqueado: versão não foi incrementada (continua ${stagedVersion}).`);
    console.error('[pre-commit] Atualize o campo "version" no package.json e tente novamente.\n');
    process.exit(1);
  }

  // Validar changelog menciona a versão
  const stagedChangelog = getTextFromGit(':', 'src/components/DocsChangesPage.tsx');
  const versionRegex = new RegExp(`version\\s*:\\s*['\"]${stagedVersion.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['\"]`);

  if (!versionRegex.test(stagedChangelog)) {
    console.error(`\n[pre-commit] Commit bloqueado: changelog não contém entrada para versão ${stagedVersion}.`);
    console.error('[pre-commit] Adicione um item em releases com a nova versão e tente novamente.\n');
    process.exit(1);
  }
}

main();
