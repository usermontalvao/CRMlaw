const fs = require('node:fs');

const RELEASE_TYPES = new Set(['patch', 'minor', 'major']);

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Vers?o inv?lida: ${version}. Use o formato MAJOR.MINOR.PATCH.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(currentVersion, releaseType) {
  const parsed = parseSemver(currentVersion);
  if (releaseType === 'major') {
    return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  }
  if (releaseType === 'minor') {
    return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }
  return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
}

function updatePackageJson(nextVersion) {
  const pkgPath = 'package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function main() {
  const releaseType = process.argv[2] || 'patch';
  if (!RELEASE_TYPES.has(releaseType)) {
    console.error('Uso: node scripts/bump-version.cjs [patch|minor|major]');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const currentVersion = pkg.version;
  const nextVersion = bumpVersion(currentVersion, releaseType);
  updatePackageJson(nextVersion);
  process.stdout.write(nextVersion);
}

main();
