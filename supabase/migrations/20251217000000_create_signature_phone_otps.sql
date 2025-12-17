create extension if not exists pgcrypto;

create table if not exists public.signature_phone_otps (
  id uuid primary key default gen_random_uuid(),
  signer_id uuid not null references public.signature_signers(id) on delete cascade,
  phone text not null,
  otp_hash text not null,
  smsdev_message_id text null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz null
);

create index if not exists signature_phone_otps_signer_created_at_idx
  on public.signature_phone_otps (signer_id, created_at desc);

create index if not exists signature_phone_otps_expires_at_idx
  on public.signature_phone_otps (expires_at);

alter table public.signature_phone_otps enable row level security;
