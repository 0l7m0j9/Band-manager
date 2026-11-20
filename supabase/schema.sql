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
-- 저장할 때마다 1씩 올라가는 버전. 앱은 "내가 아는 버전일 때만" 저장하고, 다르면 최신본과 합친 뒤 다시 저장함
alter table public.app_state add column if not exists rev bigint not null default 0;

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
         set data = public.merge_state(data, src_data), updated_at = now(), client_id = null, rev = rev + 1
       where id = dst;
    elsif src_data is not null then
      insert into public.app_state (id, data, rev) values (dst, src_data, 1);
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
  insert into public.app_state (id, data, rev)
  select new_ws, data, 1 from public.app_state where id = old_ws;
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

-- 내부용 함수는 RPC 로 직접 부르지 못하게 (로그인 없이 아이디 존재 여부를 알아내는 것 방지)
revoke execute on function public.free_username(text, uuid)   from public, anon, authenticated;
revoke execute on function public.merge_state(jsonb, jsonb)   from public, anon, authenticated;
revoke execute on function public.handle_new_user()           from public, anon, authenticated;
revoke execute on function public.my_workspace()              from public, anon;
grant  execute on function public.my_workspace()              to authenticated;

-- ---------- AI 포스터 사용량 (회원당 하루 횟수 제한, Edge Function 'poster-ai' 가 호출) ----------
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null default current_date,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- 오늘 사용 횟수를 1 올리고, 한도 안이면 true
create or replace function public.use_ai_quota(daily_limit int default 20)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if auth.uid() is null then return false; end if;
  insert into public.ai_usage (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into n;
  return n <= least(greatest(daily_limit, 1), 50);
end $$;
revoke execute on function public.use_ai_quota(int) from public, anon;
grant  execute on function public.use_ai_quota(int) to authenticated;

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


-- #########################################################################
-- v2 — 그룹 · 계급(관리자 > 단장 > 부원) · 밴드 · 일정 · 연습실 · 게시판
--
-- 위의 v1(친구 공유, app_state)은 지우지 않고 그대로 둡니다. 예전 데이터는
-- 앱의 "예전 데이터 가져오기"로 필요할 때 새 구조로 옮겨 쓸 수 있습니다.
--
-- 계급
--   관리자 : group_members.role = 'admin'  → 그룹의 모든 권한 (밴드 단장 권한 포함)
--   단장   : band_members.role = 'leader'  → 자기 밴드의 모든 정보 수정 + 가입 승인
--   부원   : 그 외 → 자기 밴드 내용 보기, 개인 일정만 수정
--
-- 최초 관리자 지정 (SQL Editor 에서 한 번, 가입한 아이디로):
--   select public.bootstrap_admin('아이디');
-- #########################################################################

-- ---------- tables ----------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);
insert into public.groups (name) values ('김포 고등학교') on conflict (name) do nothing;

alter table public.profiles add column if not exists full_name   text;
alter table public.profiles add column if not exists instruments text[] not null default '{}';

-- 전화번호는 본인과 관리자만 볼 수 있게 별도 표
create table if not exists public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone   text
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 밴드 목록(이름·장르 등)은 그룹 전원이 보고, 내용(band_docs)은 밴드원·관리자만
create table if not exists public.bands (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  name       text not null,
  genre      text not null default '',
  color      text not null default '#111111',
  logo       text not null default '',
  bio        text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 밴드 내용: { band:{founded,log}, songs, setlists, rehearsals, tasks, gigs } (JSON 한 덩어리, rev 로 충돌 감지)
create table if not exists public.band_docs (
  band_id    uuid primary key references public.bands(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  rev        bigint not null default 0,
  updated_at timestamptz not null default now(),
  client_id  text
);

create table if not exists public.band_members (
  band_id      uuid not null references public.bands(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('leader', 'member')),
  status       text not null default 'pending' check (status in ('pending', 'approved')),
  part         text not null default '',   -- 이 밴드에서 맡은 파트
  position     text not null default '',   -- 리더/총무 등
  requested_at timestamptz not null default now(),
  primary key (band_id, user_id)
);

-- 페스티벌: 관리자만 직접 읽고 씀. 부원은 published_festivals() 로 공개된 부분만
create table if not exists public.festivals (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  published  jsonb not null default '{}'::jsonb,  -- { info, lineup, timetable, poster, stage, setlists : true/false }
  rev        bigint not null default 0,
  updated_at timestamptz not null default now(),
  client_id  text
);

-- 그룹 일정(관리자) · 개인 일정(본인). 밴드 일정은 밴드 내용(합주·공연)과 연습실 예약에서
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  scope      text not null check (scope in ('group', 'personal')),
  owner      uuid references public.profiles(id) on delete cascade,
  title      text not null,
  date       date not null,
  start_time text,            -- 'HH:MM', null 이면 하루 종일
  end_time   text,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name     text not null,
  sort     int not null default 0
);
insert into public.rooms (group_id, name)
select g.id, '음악실' from public.groups g
where g.name = '김포 고등학교' and not exists (select 1 from public.rooms r where r.group_id = g.id);

create table if not exists public.reservations (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  room_id      uuid not null references public.rooms(id) on delete cascade,
  band_id      uuid not null references public.bands(id) on delete cascade,
  date         date not null,
  start_time   text not null,
  end_time     text not null,
  note         text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  author     uuid references public.profiles(id) on delete set null,
  title      text not null,
  body       text not null default '',
  images     jsonb not null default '[]'::jsonb,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists band_members_user_idx on public.band_members (user_id);
create index if not exists group_members_user_idx on public.group_members (user_id);
create index if not exists reservations_room_date_idx on public.reservations (room_id, date);
create index if not exists events_group_date_idx on public.events (group_id, date);

-- ---------- 권한 확인 함수 (RLS 에서 사용) ----------
create or replace function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid())
$$;
create or replace function public.is_group_admin(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid() and role = 'admin')
$$;
create or replace function public.band_group(b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from public.bands where id = b
$$;
create or replace function public.is_band_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.band_members where band_id = b and user_id = auth.uid() and status = 'approved')
$$;
create or replace function public.is_band_leader(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.band_members where band_id = b and user_id = auth.uid() and status = 'approved' and role = 'leader')
$$;
create or replace function public.can_edit_band(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_band_leader(b) or public.is_group_admin(public.band_group(b))
$$;
create or replace function public.can_read_band(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_band_member(b) or public.is_group_admin(public.band_group(b))
$$;
-- 나와 같은 그룹에 있는 회원인지
create or replace function public.shares_group(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
                 where a.user_id = auth.uid() and b.user_id = u)
$$;
-- 내가 그 회원이 속한 그룹의 관리자인지 (전화번호 열람용)
create or replace function public.admin_of_user(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
                 where a.user_id = auth.uid() and a.role = 'admin' and b.user_id = u)
$$;

-- ---------- RLS ----------
alter table public.groups          enable row level security;
alter table public.profile_private enable row level security;
alter table public.group_members   enable row level security;
alter table public.bands           enable row level security;
alter table public.band_docs       enable row level security;
alter table public.band_members    enable row level security;
alter table public.festivals       enable row level security;
alter table public.events          enable row level security;
alter table public.rooms           enable row level security;
alter table public.reservations    enable row level security;
alter table public.posts           enable row level security;

revoke all on public.profile_private, public.group_members, public.bands, public.band_docs,
              public.band_members, public.festivals, public.events, public.rooms, public.reservations, public.posts from anon;

-- 그룹 이름은 회원가입 화면(로그인 전)에서도 고를 수 있게 공개
drop policy if exists "groups read" on public.groups;
create policy "groups read" on public.groups for select to anon, authenticated using (true);
revoke insert, update, delete on public.groups from anon, authenticated;
grant select on public.groups to anon, authenticated;

drop policy if exists "profiles read group" on public.profiles;
create policy "profiles read group" on public.profiles for select to authenticated using (public.shares_group(id));

drop policy if exists "private read" on public.profile_private;
create policy "private read" on public.profile_private for select to authenticated using (user_id = auth.uid() or public.admin_of_user(user_id));
revoke insert, update, delete on public.profile_private from authenticated;

drop policy if exists "gm read" on public.group_members;
create policy "gm read" on public.group_members for select to authenticated using (public.is_group_member(group_id));
revoke insert, update, delete on public.group_members from authenticated;

drop policy if exists "bands read"   on public.bands;
drop policy if exists "bands update" on public.bands;
drop policy if exists "bands delete" on public.bands;
create policy "bands read"   on public.bands for select to authenticated using (public.is_group_member(group_id));
create policy "bands update" on public.bands for update to authenticated using (public.can_edit_band(id)) with check (public.can_edit_band(id));
create policy "bands delete" on public.bands for delete to authenticated using (public.is_group_admin(group_id));
revoke insert, update on public.bands from authenticated;
grant update (name, genre, color, logo, bio) on public.bands to authenticated;

drop policy if exists "docs read"   on public.band_docs;
drop policy if exists "docs update" on public.band_docs;
create policy "docs read"   on public.band_docs for select to authenticated using (public.can_read_band(band_id));
create policy "docs update" on public.band_docs for update to authenticated using (public.can_edit_band(band_id)) with check (public.can_edit_band(band_id));
revoke insert, update, delete on public.band_docs from authenticated;
grant update (data, rev, updated_at, client_id) on public.band_docs to authenticated;

-- 승인된 밴드원 명단은 그룹 전원이, 대기 중 신청은 본인·단장·관리자만
drop policy if exists "bm read" on public.band_members;
create policy "bm read" on public.band_members for select to authenticated using (
  (status = 'approved' and public.is_group_member(public.band_group(band_id)))
  or user_id = auth.uid() or public.can_edit_band(band_id));
revoke insert, update, delete on public.band_members from authenticated;

drop policy if exists "fest admin read"   on public.festivals;
drop policy if exists "fest admin insert" on public.festivals;
drop policy if exists "fest admin update" on public.festivals;
drop policy if exists "fest admin delete" on public.festivals;
create policy "fest admin read"   on public.festivals for select to authenticated using (public.is_group_admin(group_id));
create policy "fest admin insert" on public.festivals for insert to authenticated with check (public.is_group_admin(group_id));
create policy "fest admin update" on public.festivals for update to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));
create policy "fest admin delete" on public.festivals for delete to authenticated using (public.is_group_admin(group_id));

drop policy if exists "events read"  on public.events;
drop policy if exists "events write" on public.events;
drop policy if exists "events edit"  on public.events;
drop policy if exists "events del"   on public.events;
create policy "events read" on public.events for select to authenticated using (
  (scope = 'group' and public.is_group_member(group_id)) or (scope = 'personal' and owner = auth.uid()));
create policy "events write" on public.events for insert to authenticated with check (
  (scope = 'personal' and owner = auth.uid() and public.is_group_member(group_id))
  or (scope = 'group' and public.is_group_admin(group_id)));
create policy "events edit" on public.events for update to authenticated
  using ((scope = 'personal' and owner = auth.uid()) or (scope = 'group' and public.is_group_admin(group_id)))
  with check ((scope = 'personal' and owner = auth.uid()) or (scope = 'group' and public.is_group_admin(group_id)));
create policy "events del" on public.events for delete to authenticated using (
  (scope = 'personal' and owner = auth.uid()) or (scope = 'group' and public.is_group_admin(group_id)));

drop policy if exists "rooms read"  on public.rooms;
drop policy if exists "rooms admin" on public.rooms;
create policy "rooms read"  on public.rooms for select to authenticated using (public.is_group_member(group_id));
create policy "rooms admin" on public.rooms for all to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

-- 예약: 그룹 전원이 일정 확인 / 단장은 '대기' 상태로 신청·취소 / 관리자는 전부
drop policy if exists "resv read"   on public.reservations;
drop policy if exists "resv insert" on public.reservations;
drop policy if exists "resv update" on public.reservations;
drop policy if exists "resv delete" on public.reservations;
create policy "resv read" on public.reservations for select to authenticated using (public.is_group_member(group_id));
create policy "resv insert" on public.reservations for insert to authenticated with check (
  public.band_group(band_id) = group_id and (
    public.is_group_admin(group_id)
    or (public.is_band_leader(band_id) and status = 'pending' and requested_by = auth.uid())));
create policy "resv update" on public.reservations for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id) and public.band_group(band_id) = group_id);
create policy "resv delete" on public.reservations for delete to authenticated using (
  public.is_group_admin(group_id) or (requested_by = auth.uid() and status = 'pending'));

drop policy if exists "posts read"  on public.posts;
drop policy if exists "posts admin" on public.posts;
create policy "posts read"  on public.posts for select to authenticated using (public.is_group_member(group_id));
create policy "posts admin" on public.posts for all to authenticated using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

-- ---------- 예약 검사: 같은 연습실·같은 시간에 승인된 예약이 겹치지 않게 ----------
create or replace function public.check_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.start_time !~ '^\d{2}:\d{2}$' or new.end_time !~ '^\d{2}:\d{2}$' or new.end_time <= new.start_time then
    raise exception '예약 시간이 올바르지 않습니다';
  end if;
  if not exists (select 1 from public.rooms where id = new.room_id and group_id = new.group_id) then
    raise exception '이 그룹의 연습실이 아닙니다';
  end if;
  if new.status = 'approved' and exists (
    select 1 from public.reservations r
    where r.room_id = new.room_id and r.date = new.date and r.status = 'approved' and r.id <> new.id
      and r.start_time < new.end_time and new.start_time < r.end_time) then
    raise exception '같은 시간에 이미 승인된 예약이 있습니다';
  end if;
  return new;
end $$;
drop trigger if exists reservations_check on public.reservations;
create trigger reservations_check before insert or update on public.reservations
  for each row execute function public.check_reservation();

-- ---------- RPC ----------

-- 가입 정보 입력 + 그룹 가입 (회원가입 직후, 또는 기존 회원이 처음 들어올 때)
create or replace function public.complete_profile(p_name text, p_instruments text[], p_phone text, p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  nm text := left(trim(coalesce(p_name, '')), 30);
  ins text[];
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if length(nm) < 1 then raise exception '이름을 입력하세요'; end if;
  select coalesce(array_agg(left(trim(x), 20)), '{}') into ins
    from unnest(coalesce(p_instruments, '{}')) as x where trim(x) <> '';
  if coalesce(array_length(ins, 1), 0) > 10 then raise exception '악기는 10개까지 입력할 수 있습니다'; end if;
  if p_phone is not null and trim(p_phone) <> '' and trim(p_phone) !~ '^[0-9+\- ]{7,20}$' then
    raise exception '전화번호 형식이 올바르지 않습니다';
  end if;
  update public.profiles set full_name = nm, nickname = nm, instruments = ins where id = auth.uid();
  insert into public.profile_private (user_id, phone) values (auth.uid(), nullif(trim(coalesce(p_phone, '')), ''))
    on conflict (user_id) do update set phone = excluded.phone;
  if p_group is not null then
    if not exists (select 1 from public.groups where id = p_group) then raise exception '그룹을 찾을 수 없습니다'; end if;
    insert into public.group_members (group_id, user_id) values (p_group, auth.uid()) on conflict do nothing;
  end if;
end $$;

create or replace function public.join_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not exists (select 1 from public.groups where id = p_group) then raise exception '그룹을 찾을 수 없습니다'; end if;
  insert into public.group_members (group_id, user_id) values (p_group, auth.uid()) on conflict do nothing;
end $$;

-- 그룹 회원 명단 (전화번호는 관리자와 본인에게만)
create or replace function public.group_roster(p_group uuid)
returns table (user_id uuid, username text, name text, instruments text[], role text, phone text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.username, coalesce(nullif(p.full_name, ''), p.nickname, p.username), p.instruments, m.role,
         case when public.is_group_admin(p_group) or m.user_id = auth.uid() then pp.phone end,
         m.joined_at
  from public.group_members m
  join public.profiles p on p.id = m.user_id
  left join public.profile_private pp on pp.user_id = m.user_id
  where m.group_id = p_group and public.is_group_member(p_group)
  order by m.role, coalesce(nullif(p.full_name, ''), p.nickname, p.username)
$$;

-- 공동 관리자 추가/해제 (관리자만, 마지막 관리자는 해제 불가)
create or replace function public.set_group_admin(p_group uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) then raise exception '관리자만 할 수 있습니다'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user) then
    raise exception '그룹 회원이 아닙니다';
  end if;
  if not p_admin and (select count(*) from public.group_members where group_id = p_group and role = 'admin') <= 1
     and exists (select 1 from public.group_members where group_id = p_group and user_id = p_user and role = 'admin') then
    raise exception '마지막 관리자는 해제할 수 없습니다';
  end if;
  update public.group_members set role = case when p_admin then 'admin' else 'member' end
   where group_id = p_group and user_id = p_user;
end $$;

-- 관리자: 회원의 악기 정보 수정 (잘못·장난으로 고른 악기 바로잡기). 이름·아이디·비밀번호·전화번호는 못 바꿈
create or replace function public.admin_set_instruments(p_group uuid, p_user uuid, p_instruments text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  ins text[];
begin
  if not public.is_group_admin(p_group) then raise exception '관리자만 할 수 있습니다'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = p_user) then
    raise exception '그룹 회원이 아닙니다';
  end if;
  select coalesce(array_agg(distinct left(trim(x), 20)), '{}') into ins
    from unnest(coalesce(p_instruments, '{}')) as x where trim(x) <> '';
  if coalesce(array_length(ins, 1), 0) > 10 then raise exception '악기는 10개까지 입력할 수 있습니다'; end if;
  update public.profiles set instruments = ins where id = p_user;
end $$;

-- 밴드 만들기: 만든 사람이 단장
create or replace function public.create_band(p_group uuid, p_name text, p_genre text, p_color text, p_bio text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  bid uuid;
begin
  if not public.is_group_member(p_group) then raise exception '그룹 회원만 밴드를 만들 수 있습니다'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 then raise exception '밴드 이름을 입력하세요'; end if;
  insert into public.bands (group_id, name, genre, color, bio, created_by)
  values (p_group, left(trim(p_name), 40), left(coalesce(p_genre, ''), 40),
          case when p_color ~ '^#[0-9a-fA-F]{6}$' then p_color else '#111111' end, left(coalesce(p_bio, ''), 400), auth.uid())
  returning id into bid;
  insert into public.band_docs (band_id, data) values (bid, '{}'::jsonb);
  insert into public.band_members (band_id, user_id, role, status) values (bid, auth.uid(), 'leader', 'approved');
  return bid;
end $$;

-- 밴드 가입 신청 / 취소
create or replace function public.request_band_join(p_band uuid, p_part text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_member(public.band_group(p_band)) then raise exception '그룹 회원만 신청할 수 있습니다'; end if;
  if exists (select 1 from public.band_members where band_id = p_band and user_id = auth.uid()) then
    raise exception '이미 신청했거나 참여 중인 밴드입니다';
  end if;
  insert into public.band_members (band_id, user_id, role, status, part)
  values (p_band, auth.uid(), 'member', 'pending', left(coalesce(p_part, ''), 30));
end $$;

create or replace function public.cancel_band_request(p_band uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.band_members where band_id = p_band and user_id = auth.uid() and status = 'pending'
$$;

-- 가입 승인/거절 (단장·관리자)
create or replace function public.respond_band_join(p_band uuid, p_user uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_band(p_band) then raise exception '단장만 승인할 수 있습니다'; end if;
  if p_accept then
    update public.band_members set status = 'approved' where band_id = p_band and user_id = p_user and status = 'pending';
  else
    delete from public.band_members where band_id = p_band and user_id = p_user and status = 'pending';
  end if;
end $$;

-- 밴드원 역할·파트·포지션 변경 (단장·관리자). 마지막 단장은 내릴 수 없음
create or replace function public.set_band_member(p_band uuid, p_user uuid, p_role text, p_part text, p_position text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_band(p_band) then raise exception '단장만 바꿀 수 있습니다'; end if;
  if p_role not in ('leader', 'member') then raise exception '잘못된 역할입니다'; end if;
  if p_role = 'member' and exists (select 1 from public.band_members where band_id = p_band and user_id = p_user and role = 'leader')
     and (select count(*) from public.band_members where band_id = p_band and role = 'leader' and status = 'approved') <= 1 then
    raise exception '단장이 최소 한 명 있어야 합니다';
  end if;
  update public.band_members
     set role = p_role, part = left(coalesce(p_part, ''), 30), position = left(coalesce(p_position, ''), 30)
   where band_id = p_band and user_id = p_user and status = 'approved';
end $$;

-- 밴드원 내보내기 (단장·관리자) 또는 스스로 탈퇴
create or replace function public.remove_band_member(p_band uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit_band(p_band) or p_user = auth.uid()) then raise exception '권한이 없습니다'; end if;
  if exists (select 1 from public.band_members where band_id = p_band and user_id = p_user and role = 'leader')
     and (select count(*) from public.band_members where band_id = p_band and role = 'leader' and status = 'approved') <= 1
     and not public.is_group_admin(public.band_group(p_band)) then
    raise exception '다른 단장을 먼저 지정하세요';
  end if;
  delete from public.band_members where band_id = p_band and user_id = p_user;
end $$;

-- 관리자: 회원을 그룹에서 내보내기 (그 그룹 밴드 소속·개인 일정도 함께 정리)
create or replace function public.remove_group_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group) then raise exception '관리자만 할 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신은 내보낼 수 없습니다'; end if;
  delete from public.band_members where user_id = p_user and band_id in (select id from public.bands where group_id = p_group);
  delete from public.events where owner = p_user and group_id = p_group and scope = 'personal';
  delete from public.group_members where group_id = p_group and user_id = p_user;
end $$;

-- 관리자: 회원을 밴드에 바로 넣기 (신청·승인 없이) / 역할 바꾸기
create or replace function public.admin_set_band_member(p_band uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g uuid := public.band_group(p_band);
begin
  if g is null or not public.is_group_admin(g) then raise exception '관리자만 할 수 있습니다'; end if;
  if p_role not in ('leader', 'member') then raise exception '잘못된 역할입니다'; end if;
  if not exists (select 1 from public.group_members where group_id = g and user_id = p_user) then
    raise exception '이 그룹 회원이 아닙니다';
  end if;
  insert into public.band_members (band_id, user_id, role, status) values (p_band, p_user, p_role, 'approved')
  on conflict (band_id, user_id) do update set role = excluded.role, status = 'approved';
end $$;

-- 공개된 페스티벌 (부원용). 공개하지 않은 내용은 빼고 돌려줌
create or replace function public.published_festivals(p_group uuid)
returns table (id uuid, published jsonb, data jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  f record;
  d jsonb;
  p jsonb;
  show_acts boolean;
begin
  if not public.is_group_member(p_group) then return; end if;
  for f in select fe.* from public.festivals fe where fe.group_id = p_group order by (fe.data ->> 'startDate') loop
    p := f.published;
    if not (coalesce((p ->> 'info')::boolean, false) or coalesce((p ->> 'lineup')::boolean, false)
            or coalesce((p ->> 'timetable')::boolean, false) or coalesce((p ->> 'poster')::boolean, false)
            or coalesce((p ->> 'stage')::boolean, false) or coalesce((p ->> 'setlists')::boolean, false)) then
      continue;
    end if;
    d := f.data - 'favorites';
    show_acts := coalesce((p ->> 'lineup')::boolean, false) or coalesce((p ->> 'timetable')::boolean, false)
                 or coalesce((p ->> 'poster')::boolean, false) or coalesce((p ->> 'setlists')::boolean, false);
    if not show_acts then d := d - 'acts'; end if;
    if not (coalesce((p ->> 'timetable')::boolean, false) or coalesce((p ->> 'poster')::boolean, false)) then d := d - 'slots'; end if;
    if not coalesce((p ->> 'stage')::boolean, false) then d := d - 'layouts'; end if;
    if not coalesce((p ->> 'setlists')::boolean, false) then d := d - 'setlists'; end if;
    if not coalesce((p ->> 'poster')::boolean, false) then d := d - 'poster'; end if;
    id := f.id; published := p; data := d; updated_at := f.updated_at;
    return next;
  end loop;
end $$;

-- 최초 관리자 지정: SQL Editor 에서만 실행 (앱에서는 호출 불가)
create or replace function public.bootstrap_admin(p_username text, p_group_name text default '김포 고등학교') returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  gid uuid;
begin
  select id into uid from public.profiles where username = lower(trim(p_username));
  if uid is null then raise exception '아이디 % 를 찾을 수 없습니다 (먼저 앱에서 회원가입하세요)', p_username; end if;
  select id into gid from public.groups where name = p_group_name;
  if gid is null then raise exception '그룹 % 이 없습니다', p_group_name; end if;
  insert into public.group_members (group_id, user_id, role) values (gid, uid, 'admin')
    on conflict (group_id, user_id) do update set role = 'admin';
  return p_username || ' → ' || p_group_name || ' 관리자';
end $$;

-- 실행 권한: 앱(로그인 회원)이 부를 수 있는 것만
revoke execute on function public.bootstrap_admin(text, text) from public, anon, authenticated;
revoke execute on function public.check_reservation() from public, anon, authenticated;
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_group_member(uuid)', 'public.is_group_admin(uuid)', 'public.band_group(uuid)', 'public.is_band_member(uuid)',
    'public.is_band_leader(uuid)', 'public.can_edit_band(uuid)', 'public.can_read_band(uuid)', 'public.shares_group(uuid)',
    'public.admin_of_user(uuid)', 'public.complete_profile(text, text[], text, uuid)', 'public.join_group(uuid)',
    'public.group_roster(uuid)', 'public.set_group_admin(uuid, uuid, boolean)', 'public.create_band(uuid, text, text, text, text)',
    'public.request_band_join(uuid, text)', 'public.cancel_band_request(uuid)', 'public.respond_band_join(uuid, uuid, boolean)',
    'public.set_band_member(uuid, uuid, text, text, text)', 'public.remove_band_member(uuid, uuid)', 'public.published_festivals(uuid)',
    'public.remove_group_member(uuid, uuid)', 'public.admin_set_band_member(uuid, uuid, text)',
    'public.admin_set_instruments(uuid, uuid, text[])'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------- 실시간 반영 ----------
do $$
declare
  t text;
begin
  foreach t in array array['group_members', 'bands', 'band_docs', 'band_members', 'festivals', 'events', 'rooms', 'reservations', 'posts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
