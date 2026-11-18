-- =========================================================
-- BAND MANAGER — Supabase schema (회원 · 친구 공유)
-- SQL Editor에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 구조
--   profiles        : 회원 1명 = 1행. workspace_id 가 "내가 보는 데이터 묶음"
--   app_state       : workspace 1개 = 1행. 밴드/곡/세트리스트/합주/페스티벌 전체(JSON)
--   friend_requests : 친구 요청. 수락하면 두 사람(과 각자의 기존 친구들)이
--                     하나의 workspace 를 함께 쓰게 됨 → 하나의 계정처럼 모든 데이터 공유
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.app_state (
  id          text primary key,              -- workspace id
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_state add column if not exists client_id text;  -- 마지막으로 저장한 브라우저(실시간 반영 시 자기 변경 무시용)

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text not null unique,        -- 로그인 아이디 (친구 추가에도 사용)
  nickname     text,
  workspace_id text not null,
  created_at   timestamptz not null default now()
);
-- 겹치지 않는 아이디 만들기: 이미 쓰는 아이디면 뒤에 _xxxx(회원 id 앞 4자리)를 붙임
create or replace function public.free_username(base text, uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  b text := left(regexp_replace(lower(coalesce(base, '')), '[^a-z0-9_]', '', 'g'), 15);
  cand text;
begin
  if length(b) < 3 then b := 'user'; end if;
  cand := b;
  if exists (select 1 from public.profiles where username = cand and id <> uid) then
    cand := b || '_' || left(replace(uid::text, '-', ''), 4);
  end if;
  return cand;
end $$;

-- 예전(이메일 버전) 스키마에서 옮겨오기
alter table public.profiles add column if not exists username text;
do $$
declare
  rec record;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'email') then
    -- 한 명씩 처리해서 이메일 앞부분이 같은 회원끼리 아이디가 겹치지 않게 함 (먼저 가입한 회원이 원래 아이디)
    for rec in execute 'select id, email from public.profiles where username is null order by created_at' loop
      update public.profiles set username = public.free_username(split_part(rec.email, '@', 1), rec.id) where id = rec.id;
    end loop;
    execute 'alter table public.profiles drop column email';
  end if;
end $$;
alter table public.profiles alter column username set not null;
create unique index if not exists profiles_username_key on public.profiles (username);

create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.profiles(id) on delete cascade,
  to_user    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);

-- ---------- helper ----------
create or replace function public.my_workspace() returns text
language sql stable security definer set search_path = public as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

-- 두 데이터(JSON)를 합칩니다. 배열(bands, songs …)은 id 기준으로 합치고 중복 id는 a 쪽을 남깁니다.
create or replace function public.merge_state(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare
  k   text;
  res jsonb := coalesce(a, '{}'::jsonb);
begin
  if b is null then return res; end if;
  for k in select jsonb_object_keys(b) loop
    if jsonb_typeof(res -> k) = 'array' and jsonb_typeof(b -> k) = 'array' then
      res := jsonb_set(res, array[k], (
        select coalesce(jsonb_agg(d.e order by d.ord), '[]'::jsonb)
        from (
          select distinct on (coalesce(u.e ->> 'id', u.e::text)) u.e, u.ord
          from (
            select t.e, t.ord from jsonb_array_elements(res -> k) with ordinality as t(e, ord)
            union all
            select t.e, t.ord + 1000000 from jsonb_array_elements(b -> k) with ordinality as t(e, ord)
          ) u
          order by coalesce(u.e ->> 'id', u.e::text), u.ord
        ) d
      ));
    elsif not (res ? k) then
      res := res || jsonb_build_object(k, b -> k);
    end if;
  end loop;
  return res;
end $$;

-- ---------- 회원가입 시 profile 자동 생성 ----------
-- 앱은 아이디만 받고, Supabase Auth 에는 "아이디@가짜도메인" 형태로 넘깁니다(메일은 보내지 않음).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text := public.free_username(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), split_part(new.email, '@', 1)), new.id);
begin
  insert into public.profiles (id, username, nickname, workspace_id)
  values (
    new.id,
    uname,
    coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), uname),
    gen_random_uuid()::text
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 스키마 적용 전에 가입한 회원이 있으면 profile 채우기
do $$
declare
  u record;
begin
  for u in select a.id, a.email from auth.users a
           where a.email is not null and not exists (select 1 from public.profiles p where p.id = a.id)
           order by a.created_at loop
    insert into public.profiles (id, username, nickname, workspace_id)
    values (u.id, public.free_username(split_part(u.email, '@', 1), u.id), split_part(u.email, '@', 1), gen_random_uuid()::text);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.app_state       enable row level security;
alter table public.profiles        enable row level security;
alter table public.friend_requests enable row level security;

-- 예전 데모용 공개 정책 제거
drop policy if exists "public read"   on public.app_state;
drop policy if exists "public insert" on public.app_state;
drop policy if exists "public update" on public.app_state;
delete from public.app_state where id = 'default';

drop policy if exists "workspace read"   on public.app_state;
drop policy if exists "workspace insert" on public.app_state;
drop policy if exists "workspace update" on public.app_state;
create policy "workspace read"   on public.app_state for select to authenticated using (id = public.my_workspace());
create policy "workspace insert" on public.app_state for insert to authenticated with check (id = public.my_workspace());
create policy "workspace update" on public.app_state for update to authenticated using (id = public.my_workspace()) with check (id = public.my_workspace());

-- 나와 같은 workspace(=친구)의 프로필만 보임. 닉네임만 본인이 수정 가능
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (id = auth.uid() or workspace_id = public.my_workspace());
create policy "profiles update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (nickname) on public.profiles to authenticated;

-- 친구 요청은 보낸 사람·받은 사람만 볼 수 있음. 생성/수락은 아래 함수로만
drop policy if exists "requests read" on public.friend_requests;
create policy "requests read" on public.friend_requests for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());
revoke insert, update, delete on public.friend_requests from anon, authenticated;

-- ---------- 친구 기능 (RPC) ----------

-- 예전(이메일 버전) 함수 제거 — 반환 형식·인자 이름이 바뀌어 다시 만들어야 함
drop function if exists public.list_friend_requests();
drop function if exists public.send_friend_request(text);

-- 받은/보낸 대기 중 요청 목록
create or replace function public.list_friend_requests()
returns table (id uuid, direction text, username text, nickname text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id,
         case when r.to_user = auth.uid() then 'in' else 'out' end,
         p.username, p.nickname, r.created_at
  from public.friend_requests r
  join public.profiles p on p.id = case when r.to_user = auth.uid() then r.from_user else r.to_user end
  where r.status = 'pending' and (r.to_user = auth.uid() or r.from_user = auth.uid())
  order by r.created_at desc
$$;

-- 수락: 받은 사람(과 그 친구들)이 보낸 사람의 workspace 로 합류하고 데이터를 합침
create or replace function public.respond_friend_request(req_id uuid, accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r       public.friend_requests;
  src     text;
  dst     text;
  src_data jsonb;
begin
  select * into r from public.friend_requests where id = req_id for update;
  if r.id is null or r.to_user <> auth.uid() or r.status <> 'pending' then
    raise exception '처리할 수 없는 요청입니다';
  end if;

  if not accept then
    update public.friend_requests set status = 'declined' where id = req_id;
    return 'declined';
  end if;

  select workspace_id into src from public.profiles where id = r.to_user;
  select workspace_id into dst from public.profiles where id = r.from_user;

  if src <> dst then
    select data into src_data from public.app_state where id = src;
    if exists (select 1 from public.app_state where id = dst) then
      update public.app_state
         set data = public.merge_state(data, src_data), updated_at = now(), client_id = null
       where id = dst;
    elsif src_data is not null then
      insert into public.app_state (id, data) values (dst, src_data);
    end if;
    update public.profiles set workspace_id = dst where workspace_id = src;
    delete from public.app_state where id = src;
  end if;

  update public.friend_requests set status = 'accepted' where id = req_id;
  return 'accepted';
end $$;

-- 아이디로 친구 요청 보내기 (상대가 이미 나에게 요청했다면 바로 수락)
create or replace function public.send_friend_request(target_username text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  me      public.profiles;
  target  public.profiles;
  rev_id  uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception '로그인이 필요합니다'; end if;

  select * into target from public.profiles where username = lower(trim(target_username));
  if target.id is null then raise exception '해당 아이디의 회원이 없습니다'; end if;
  if target.id = me.id then raise exception '나 자신은 추가할 수 없습니다'; end if;
  if target.workspace_id = me.workspace_id then raise exception '이미 친구입니다'; end if;

  select id into rev_id from public.friend_requests
   where from_user = target.id and to_user = me.id and status = 'pending';
  if rev_id is not null then
    perform public.respond_friend_request(rev_id, true);
    return 'accepted';
  end if;

  insert into public.friend_requests (from_user, to_user, status, created_at)
  values (me.id, target.id, 'pending', now())
  on conflict (from_user, to_user) do update set status = 'pending', created_at = now();
  return 'sent';
end $$;

-- 보낸 요청 취소
create or replace function public.cancel_friend_request(req_id uuid)
returns void
language sql security definer set search_path = public as $$
  delete from public.friend_requests where id = req_id and from_user = auth.uid() and status = 'pending'
$$;

-- 공유 그만두기: 지금 데이터를 복사해 나만의 새 workspace 로 분리
create or replace function public.leave_shared_workspace()
returns text
language plpgsql security definer set search_path = public as $$
declare
  old_ws text;
  new_ws text := gen_random_uuid()::text;
begin
  select workspace_id into old_ws from public.profiles where id = auth.uid();
  if old_ws is null then raise exception '로그인이 필요합니다'; end if;
  if not exists (select 1 from public.profiles where workspace_id = old_ws and id <> auth.uid()) then
    raise exception '공유 중인 친구가 없습니다';
  end if;
  insert into public.app_state (id, data)
  select new_ws, data from public.app_state where id = old_ws;
  update public.profiles set workspace_id = new_ws where id = auth.uid();
  return new_ws;
end $$;

revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.send_friend_request(text)             from public, anon;
revoke execute on function public.cancel_friend_request(uuid)           from public, anon;
revoke execute on function public.leave_shared_workspace()              from public, anon;
revoke execute on function public.list_friend_requests()                from public, anon;
grant  execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant  execute on function public.send_friend_request(text)             to authenticated;
grant  execute on function public.cancel_friend_request(uuid)           to authenticated;
grant  execute on function public.leave_shared_workspace()              to authenticated;
grant  execute on function public.list_friend_requests()                to authenticated;

-- ---------- 실시간 반영 (친구가 바꾼 내용이 바로 보이도록) ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_state') then
    alter publication supabase_realtime add table public.app_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_requests') then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
