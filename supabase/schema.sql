-- BAND MANAGER — Supabase schema
-- SQL Editor에 붙여넣고 실행한 뒤 js/config.js 에 URL과 anon key를 입력하세요.

create table if not exists public.app_state (
  id          text primary key,              -- WORKSPACE_ID
  data        jsonb not null,                -- 밴드/멤버/곡/세트리스트/합주/공연/페스티벌 전체
  updated_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- 데모용 공개 정책입니다. 실제 서비스에서는 auth.uid() 기반 정책으로 바꾸세요.
create policy "public read"   on public.app_state for select using (true);
create policy "public insert" on public.app_state for insert with check (true);
create policy "public update" on public.app_state for update using (true);
