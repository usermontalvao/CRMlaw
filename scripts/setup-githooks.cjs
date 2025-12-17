const { execSync } = require('node:child_process');

function safeExec(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  // Só tenta se estiver dentro de um repositório git
  if (!safeExec('git rev-parse --is-inside-work-tree')) return;

  // Configura hooksPath para .githooks
  safeExec('git config core.hooksPath .githooks');
}

main();
