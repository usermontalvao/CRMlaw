import React from 'react';
import { CheckCircle2, Clock3, ShieldCheck, X } from 'lucide-react';

type MockupProps = {
  open: boolean;
  onClose: () => void;
  documentName: string;
  signerName: string;
  signerEmail?: string;
  signerCpf?: string;
  authMethodLabel?: string;
  standalone?: boolean;
};

const pageShell: React.CSSProperties = {
  width: 680,
  minHeight: 960,
  background: '#ffffff',
  boxShadow: '0 14px 50px rgba(15,23,42,0.16)',
  border: '1px solid #e2e8f0',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const valueStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#0f172a',
};

const sectionTitle = (title: string) => (
  <div className="flex items-center gap-2">
    <div style={{ width: 4, height: 16, background: '#ea580c' }} />
    <span className="text-[13px] font-bold uppercase tracking-[0.04em] text-[#0f172a]">{title}</span>
    <div className="flex-1 h-px bg-slate-200" />
  </div>
);

const Header: React.FC<{ title: string; subtitle?: string; documentName: string }> = ({ title, subtitle, documentName }) => (
  <>
    <div style={{ height: 5, background: '#ea580c' }} />
    <div className="px-14 pt-8 pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[12px] font-bold" style={{ background: 'linear-gradient(152deg,#F6A356 0%,#EC6A1E 48%,#CB4A0A 100%)' }}>J</div>
          <span className="text-[12px] font-bold uppercase tracking-[0.02em] text-slate-400">{title}</span>
        </div>
        <div className="text-[11px] text-slate-300">04/07/2026, 16:13</div>
      </div>
      <div className="mt-4 h-px bg-slate-200" />
      <h2 className="mt-4 text-[19px] font-bold text-[#0f172a] leading-tight">{documentName}</h2>
      {subtitle && <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p>}
      <div className="mt-4 h-px bg-slate-200" />
    </div>
  </>
);

const MockSignature = () => (
  <svg viewBox="0 0 220 90" className="w-full h-[90px]">
    <path d="M96 68 C102 56,108 42,108 28 C108 17,115 8,126 8 C135 8,141 16,141 27 C141 45,128 59,113 72 C124 62,140 45,158 20 C155 39,146 55,135 66 C147 61,163 70,176 84" fill="none" stroke="#111827" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SelfiePlaceholder = () => (
  <div className="relative w-full h-full rounded-xl overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] border border-slate-200">
    <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(circle at 50% 20%, #ffffff 0%, transparent 60%)' }} />
    <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-[84px] h-[84px] rounded-full bg-slate-300" />
    <div className="absolute left-1/2 top-[38%] -translate-x-1/2 w-[170px] h-[190px] rounded-t-[90px] bg-slate-300" />
    <div className="absolute inset-x-5 top-6 bottom-6 border border-white/80 rounded-xl" />
    <div className="absolute inset-x-8 top-1/2 border-t border-dashed border-slate-300" />
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[28px] font-bold tracking-[0.22em] text-slate-400/60">CONFIDENTIAL</div>
  </div>
);

const DataLine: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-md px-3 py-2 bg-slate-50">
    <div style={labelStyle}>{label}</div>
    <div style={valueStyle}>{value}</div>
  </div>
);

const SignatureCertificateMockup: React.FC<MockupProps> = ({
  open,
  onClose,
  documentName,
  signerName,
  signerEmail,
  signerCpf,
  authMethodLabel = 'Google (mockup@jurius.com.br)',
  standalone = false,
}) => {
  if (!open) return null;

  const title = documentName || 'KIT CONSUMIDOR - PEDRO RODRIGUES MONTALVAO NETO';
  const signer = signerName || 'PEDRO RODRIGUES MONTALVAO NETO';
  const email = signerEmail || 'pedro@advcuiaba.com';
  const cpf = signerCpf || '045.748.031-93';

  return (
    <div
      className={standalone ? 'min-h-screen bg-[#1f2937]' : 'fixed inset-0 z-[210] bg-[rgba(15,23,42,0.65)]'}
      style={standalone ? { minWidth: 760 } : undefined}
    >
      <div className={`z-10 flex items-center justify-between px-5 py-3 ${standalone ? 'border-b border-slate-700 bg-[#111827]' : 'sticky top-0 border-b border-white/10 bg-[rgba(15,23,42,0.88)] backdrop-blur'}`}>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-300">Mockup do Certificado</div>
          <div className="text-sm text-slate-200">Prévia visual das páginas finais sem assinar o documento</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
        >
          <X className="w-4 h-4" />
          Fechar
        </button>
      </div>

      <div className={standalone ? 'px-6 py-8' : 'h-[calc(100vh-69px)] overflow-auto px-6 py-8'}>
        <div className="mx-auto flex w-fit flex-col gap-8">
          <div style={pageShell}>
            <Header title="CERTIFICADO DE ASSINATURA" subtitle="Protocolo e167434d-9a76-4242-b480-afc2e98325eb" documentName={title} />
            <div className="px-14 pb-14">
              <div className="flex items-center justify-between py-5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-[#0f172a]">DOCUMENTO ASSINADO</div>
                    <div className="text-[11px] text-slate-400">1 signatário · Emitido em 04/07/2026, 16:13</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[12px] font-bold text-emerald-700">
                  <div className="w-2 h-2 rounded-full bg-emerald-600" />
                  VÁLIDO
                </div>
              </div>

              {sectionTitle('ASSINATURAS')}

              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-4 py-1 text-[11px] font-bold text-white">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ASSINADO
                      </div>
                      <div>
                        <div className="text-[14px] font-bold text-[#0f172a]">{signer}</div>
                        <div className="text-[11px] text-slate-400">Signatário</div>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-[1fr] gap-2">
                      <div className="text-[11px] text-slate-400">Assinado em <span className="font-bold text-[#0f172a]">04/07/2026, 16:13:35</span></div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div style={labelStyle}>FATORES DE AUTENTICAÇÃO</div>
                      <ul className="mt-2 space-y-2 text-[11px] text-slate-500">
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Assinatura manuscrita digital</li>
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Autenticação via {authMethodLabel}</li>
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Endereço IP: 45.228.148.72</li>
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Geolocalização: -15.632343, -55.957481</li>
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Verificação facial (selfie)</li>
                        <li className="flex gap-2"><span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-emerald-600" />Dispositivo: Desktop - Google Chrome - Windows</li>
                      </ul>
                    </div>
                  </div>

                  <div className="w-[220px]">
                    <div style={labelStyle}>ASSINATURA MANUSCRITA</div>
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-5">
                      <MockSignature />
                      <div className="mt-3 h-px bg-slate-200" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={pageShell}>
            <Header title="BIOMETRIA & VERIFICAÇÃO" subtitle={`Signatário: ${signer}`} documentName={title} />
            <div className="px-14 pb-14">
              {sectionTitle('BIOMETRIA FACIAL')}

              <div className="mt-8 grid grid-cols-[250px_1fr] gap-6">
                <div>
                  <div className="mb-3 text-[10px] text-slate-400">Foto do rosto (selfie) de {signer}:</div>
                  <div className="h-[335px]">
                    <SelfiePlaceholder />
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <div style={{ width: 4, height: 16, background: '#ea580c' }} />
                    <span className="text-[13px] font-bold uppercase tracking-[0.04em] text-[#0f172a]">DADOS DO SIGNATÁRIO</span>
                  </div>
                  <div className="mt-4 grid gap-2">
                    <DataLine label="Nome" value={signer} />
                    <DataLine label="Papel" value="Signatário" />
                    <DataLine label="Contato" value={email} />
                    <DataLine label="CPF" value={cpf} />
                    <DataLine label="Endereço IP" value="45.228.148.72" />
                    <DataLine label="Localização" value="-15.632343, -55.957481" />
                    <DataLine label="Dispositivo" value="Google Chrome · Windows · Desktop" />
                    <DataLine label="Autenticação" value={authMethodLabel} />
                    <DataLine label="Termos de Uso" value="Aceitos · versão v1" />
                    <DataLine label="Assinado em" value="04/07/2026, 16:13:35" />
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-[1fr_120px] gap-5 items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[12px] font-bold" style={{ background: 'linear-gradient(152deg,#F6A356 0%,#EC6A1E 48%,#CB4A0A 100%)' }}>J</div>
                      <div className="text-[11px] text-slate-400">Certificado de Assinatura Eletrônica</div>
                    </div>
                    <div className="mt-3 h-px bg-slate-200" />
                    <div className="mt-3 space-y-2 text-[10px] text-slate-400">
                      <div><strong className="text-slate-500">CÓDIGO:</strong> <span className="ml-4 text-[12px] font-bold text-[#334155]">38147903F928CCDC</span></div>
                      <div><strong className="text-slate-500">PROTOCOLO:</strong> <span className="ml-4 text-[#475569]">e167434d-9a76-4242-b480-afc2e98325eb</span></div>
                      <div><strong className="text-slate-500">SHA-256:</strong> <span className="ml-4 text-[9px] text-[#475569]">46BDF34D18BFB02F8F301D53B6EFDBEA8AC94BFE7AD6E049A91C53AB3A886</span></div>
                    </div>
                    <div className="mt-3 h-px bg-slate-200" />
                    <div className="mt-3 text-[9px] text-slate-400">http://localhost:3000/#/verificar/38147903F928CCDC</div>
                    <div className="mt-1 text-[9px] text-slate-400">Signatário: {signer}</div>
                  </div>
                  <div className="justify-self-end rounded-md border border-slate-200 bg-[repeating-linear-gradient(45deg,#0f172a_0,#0f172a_3px,#fff_3px,#fff_6px)] h-[110px] w-[110px] relative overflow-hidden">
                    <div className="absolute inset-[12px] bg-white flex items-center justify-center text-[26px] font-bold text-orange-600">J</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={pageShell}>
            <Header title="TRILHA DE AUDITORIA" subtitle="Protocolo e167434d-9a76-4242-b480-afc2e98325eb" documentName={title} />
            <div className="px-14 pb-14">
              {sectionTitle('REGISTRO DE EVENTOS')}

              <div className="relative mt-8 pl-11">
                <div className="absolute left-[22px] top-0 bottom-0 w-px bg-slate-200" />

                {[
                  { color: '#ea580c', badge: 'CRIADO', when: '04/07/2026, 16:08', text: `Documento emitido por ${signer}.` },
                  { color: '#64748b', badge: 'VISUALIZADO', when: '04/07/2026, 16:12', text: `${signer} (Email: ${email}, CPF: ${cpf}) abriu o documento` },
                  { color: '#8b5cf6', badge: 'TERMOS', when: '04/07/2026, 16:13', text: `${signer} declarou ter lido e aceitado os Termos de Uso (versão v1) por meio do IP 45.228.148.72.` },
                  { color: '#16a34a', badge: 'ASSINADO', when: '04/07/2026, 16:13', text: `${signer} assinou este documento por meio do IP 45.228.148.72 localizado em -15.632343, -55.957481. Autenticação via ${authMethodLabel}.` },
                ].map((item, index) => (
                  <div key={index} className="relative mb-5">
                    <div className="absolute -left-[41px] top-[6px] w-4 h-4 rounded-full border-[4px] border-white" style={{ background: item.color, boxShadow: '0 0 0 1px rgba(148,163,184,0.25)' }} />
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" style={{ borderLeft: `4px solid ${item.color}` }}>
                      <div className="flex items-center gap-3">
                        <div className="rounded-full px-3 py-1 text-[10px] font-bold text-white" style={{ background: item.color }}>{item.badge}</div>
                        <div className="text-[11px] text-slate-400">{item.when}</div>
                      </div>
                      <div className="mt-3 text-[12px] leading-6 text-[#0f172a]">{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 border-t border-slate-200 pt-4 text-[10px] text-slate-400">
                Este registro de auditoria é parte integrante do certificado de assinatura. Datas em horário de Manaus (UTC-04:00).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignatureCertificateMockup;
