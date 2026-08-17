// DEV-ONLY: bancada do preview de anexos com anotação (lápis / marca-texto).
// Gera uma imagem sintética parecida com um print de tela para exercitar o
// desenho, o achatamento e o tamanho da janela sem precisar de conversa real.
import React, { useEffect, useRef, useState } from 'react';
import { AttachmentPreviewModal } from '../components/whatsapp/attachmentPreviewModal';

/** Print falso: cabeçalho, linhas de texto e um bloco destacável. */
function fakeScreenshot(width = 1280, height = 800): Promise<File> {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f6f5f2'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1f6f5c'; ctx.fillRect(0, 0, width, 72);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Extrato do benefício — INSS', 32, 46);
  ctx.fillStyle = '#7c7c7c'; ctx.font = '20px sans-serif';
  for (let i = 0; i < 14; i++) {
    ctx.fillRect(32, 120 + i * 42, 380 + ((i * 97) % 520), 14);
  }
  ctx.fillStyle = '#e8f0ff'; ctx.fillRect(700, 300, 520, 160);
  ctx.fillStyle = '#26418f'; ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Valor: R$ 2.847,19', 730, 360);
  ctx.fillText('Competência: 07/2026', 730, 410);
  return new Promise(resolve => c.toBlob(b => resolve(new File([b!], 'image.png', { type: 'image/png' })), 'image/png'));
}

const WhatsAppAttachmentPreview: React.FC = () => {
  const [files, setFiles] = useState<File[] | null>(null);
  const [enviado, setEnviado] = useState<{ nome: string; bytes: number; legenda: string; url: string } | null>(null);
  // Espelha o compositor da conversa: o texto escrito aqui acompanha o anexo
  // como legenda e volta para cá se o preview for fechado sem enviar.
  const [composer, setComposer] = useState('Segue o extrato do benefício, doutor.');
  // Texto do compositor no instante do anexo — é ele que entra como legenda.
  const composerAoAnexar = useRef('');

  const abrir = (texto: string) => {
    setEnviado(null);
    void fakeScreenshot().then(f => {
      composerAoAnexar.current = texto;
      setFiles([f]);
      setComposer(''); // o texto saiu do compositor e virou legenda
    });
  };

  // Abre já na montagem, com o texto de exemplo fazendo o papel do compositor.
  useEffect(() => { abrir('Segue o extrato do benefício, doutor.'); }, []);

  const reabrir = () => abrir(composer);

  return (
    <div style={{ minHeight: '100vh', background: '#0b141a', color: '#e9edef', fontFamily: 'system-ui', padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 8 }}>Bancada — preview de anexo com anotação</h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
        Escolha lápis ou marca-texto, rabisque sobre a imagem e clique em enviar.
        O resultado achatado aparece abaixo.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input value={composer} onChange={e => setComposer(e.target.value)}
          data-testid="compositor" placeholder="Digite uma mensagem…"
          style={{ flex: 1, maxWidth: 420, padding: '9px 12px', borderRadius: 8, border: '1px solid #2a3942', background: '#111b21', color: '#e9edef' }} />
        <button onClick={reabrir} style={{ padding: '9px 14px', borderRadius: 8, background: '#00a884', color: '#fff', border: 0, cursor: 'pointer' }}>
          Anexar (abre o preview)
        </button>
      </div>

      {enviado && (
        <div style={{ marginTop: 24 }} data-testid="resultado-envio">
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Enviado: <strong>{enviado.nome}</strong> · {enviado.bytes} bytes · legenda: "{enviado.legenda}"
          </p>
          <img src={enviado.url} alt="achatado" style={{ maxWidth: 640, border: '1px solid #2a3942', borderRadius: 8 }} />
        </div>
      )}

      {files && (
        <AttachmentPreviewModal
          files={files}
          initialCaption={composerAoAnexar.current}
          onClose={caption => { setFiles(null); setComposer(caption); }}
          onConfirm={(caption, finais) => {
            const f = finais[0];
            setEnviado({ nome: f.name, bytes: f.size, legenda: caption, url: URL.createObjectURL(f) });
            setFiles(null);
          }}
        />
      )}
    </div>
  );
};

export default WhatsAppAttachmentPreview;
