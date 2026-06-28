// Avatar do contato com fallback para iniciais. Átomo apresentacional
// compartilhado entre a lista de conversas e o quadro do funil.
import React, { useState, useEffect } from 'react';
import { initials } from './format';

// Avatar real do contato com fallback para iniciais (foto ausente ou URL expirada).
export const Avatar: React.FC<{ url: string | null; name: string | null; phone: string; size: number; onClick?: () => void }> = ({ url, name, phone, size, onClick }) => {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  const show = !!url && !broken;
  const clickable = show && !!onClick;
  return (
    <div onClick={clickable ? onClick : undefined} title={clickable ? 'Ver foto' : undefined}
      className={`rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold overflow-hidden${clickable ? ' cursor-pointer hover:ring-2 hover:ring-amber-300 transition' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {show
        ? <img src={url!} alt={name || phone} onError={() => setBroken(true)} className="w-full h-full object-cover" />
        : initials(name, phone)}
    </div>
  );
};
