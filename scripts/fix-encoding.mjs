import { readFileSync, writeFileSync } from 'fs';

const ACCENT_ASCII = {
  'á':'a','à':'a','â':'a','ã':'a','é':'e','è':'e','ê':'e',
  'í':'i','î':'i','ó':'o','ô':'o','õ':'o','ú':'u','û':'u','ç':'c',
  'Á':'A','À':'A','Â':'A','Ã':'A','É':'E','È':'E','Ê':'E',
  'Í':'I','Ó':'O','Ô':'O','Õ':'O','Ú':'U','Ç':'C',
};
const HTML_MAP = {
  'á':'&aacute;','à':'&agrave;','â':'&acirc;','ã':'&atilde;',
  'é':'&eacute;','è':'&egrave;','ê':'&ecirc;',
  'í':'&iacute;','î':'&icirc;',
  'ó':'&oacute;','ô':'&ocirc;','õ':'&otilde;',
  'ú':'&uacute;','û':'&ucirc;','ç':'&ccedil;',
  'Á':'&Aacute;','À':'&Agrave;','Â':'&Acirc;','Ã':'&Atilde;',
  'É':'&Eacute;','È':'&Egrave;','Ê':'&Ecirc;',
  'Í':'&Iacute;','Ó':'&Oacute;','Ô':'&Ocirc;','Õ':'&Otilde;',
  'Ú':'&Uacute;','Ç':'&Ccedil;',
};
const UNICODE_MAP = {};
for (const [ch] of Object.entries(ACCENT_ASCII)) {
  const hex = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  UNICODE_MAP[ch] = String.fromCharCode(92) + 'u' + hex; // \uXXXX
}

const ACCENTED = /[áàâãéèêíîóôõúûçÁÀÂÃÉÈÊÍÓÔÕÚÇ]/g;

function repl(str, mode) {
  if (mode === 'comment')   return str.replace(ACCENTED, c => ACCENT_ASCII[c] || c);
  if (mode === 'js_string') return str.replace(ACCENTED, c => UNICODE_MAP[c] || c);
  if (mode === 'jsx')       return str.replace(ACCENTED, c => HTML_MAP[c] || c);
  return str;
}

function transform(content) {
  const out = [];
  let i = 0;
  const N = content.length;

  while (i < N) {
    const c = content[i];
    const c2 = content[i + 1];

    // Single-line comment
    if (c === '/' && c2 === '/') {
      let end = content.indexOf('\n', i);
      if (end < 0) end = N;
      out.push(repl(content.slice(i, end), 'comment'));
      i = end;
      continue;
    }
    // Block comment
    if (c === '/' && c2 === '*') {
      let end = content.indexOf('*/', i + 2);
      const e = end < 0 ? N : end + 2;
      out.push(repl(content.slice(i, e), 'comment'));
      i = e;
      continue;
    }
    // Template literal
    if (c === '`') {
      let j = i + 1, depth = 0;
      while (j < N) {
        if (content[j] === '\\') { j += 2; continue; }
        if (content[j] === '$' && content[j + 1] === '{') { depth++; j += 2; continue; }
        if (content[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (content[j] === '`' && depth === 0) { j++; break; }
        j++;
      }
      out.push(repl(content.slice(i, j), 'js_string'));
      i = j;
      continue;
    }
    // Single-quoted string
    if (c === "'") {
      let j = i + 1;
      while (j < N && content[j] !== "'" && content[j] !== '\n') {
        if (content[j] === '\\') j++;
        j++;
      }
      if (content[j] === "'") j++;
      out.push(repl(content.slice(i, j), 'js_string'));
      i = j;
      continue;
    }
    // Double-quoted string: JSX attribute if = precedes the quote
    if (c === '"') {
      const soFar = out.join('');
      const lineStart = soFar.lastIndexOf('\n') + 1;
      const lineUntilHere = soFar.slice(lineStart);
      const isJSXAttr = /=\s*$/.test(lineUntilHere);
      let j = i + 1;
      while (j < N && content[j] !== '"' && content[j] !== '\n') {
        if (content[j] === '\\') j++;
        j++;
      }
      if (content[j] === '"') j++;
      out.push(repl(content.slice(i, j), isJSXAttr ? 'jsx' : 'js_string'));
      i = j;
      continue;
    }

    out.push(c);
    i++;
  }

  // Second pass: JSX text between tags
  let result = out.join('');
  result = result.replace(/>([^<{}"'`\n]+)</g, (_m, text) => {
    return '>' + repl(text, 'jsx') + '<';
  });
  return result;
}

const files = [
  'src/portal/pages/PortalCasos.tsx',
  'src/portal/pages/PortalProcessDetails.tsx',
  'src/portal/pages/PortalRequirementDetails.tsx',
];

for (const f of files) {
  const original = readFileSync(f, 'utf8');
  const fixed = transform(original);
  const remaining = [...fixed].filter(ch => ch.charCodeAt(0) > 127);
  const unique = [...new Set(remaining)];
  writeFileSync(f, fixed, 'utf8');
  const name = f.split('/').pop();
  if (unique.length) {
    console.log('WARN ' + name + ': ' + remaining.length + ' non-ASCII left: [' + unique.join('') + ']');
  } else {
    console.log('CLEAN: ' + name);
  }
}
