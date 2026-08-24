// A página de opções não tem opção nenhuma de propósito: tudo que importa
// (quem é você, o que você pode) mora no CRM. O que ela faz é explicar, em
// português, o que a extensão guarda e o que ela nunca guarda.
document.querySelector('#versao').textContent = chrome.runtime.getManifest().version;
