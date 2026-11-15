-- =====================================================================
--  BEMO Operations OS (CRM) – Supabase setup
--  Paste this whole file into Supabase > SQL Editor > New query > Run.
--  Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The main table. Every CRM record (client, quote, invoice, task,
--    reminder, user, setting ...) is one row.
-- ---------------------------------------------------------------------
create table if not exists public.records (
  collection  text        not null,               -- e.g. 'clients', 'invoices', '_settings'
  key         text        not null,               -- the record id, e.g. 'C-1001'
  ord         double precision not null default 0, -- keeps lists in the same order for everyone
  data        jsonb       not null,               -- the record itself
  updated_at  timestamptz not null default now(),
  updated_by  uuid        default auth.uid(),
  client_id   text,                               -- which open browser tab made the change
  primary key (collection, key)
);

create index if not exists records_users_email_idx
  on public.records (lower(data->>'email'))
  where collection = 'users';

-- Deletes keep the old row for full replication events
alter table public.records replica identity full;

-- ---------------------------------------------------------------------
-- 2. Recycle bin: anything deleted in the CRM is copied here first
--    and kept for 90 days, so nothing is ever lost by accident.
-- ---------------------------------------------------------------------
create table if not exists public.records_trash (
  id          bigserial primary key,
  collection  text not null,
  key         text not null,
  data        jsonb not null,
  deleted_at  timestamptz not null default now(),
  deleted_by  uuid default auth.uid()
);

create or replace function public.records_to_trash()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.records_trash (collection, key, data, deleted_by)
  values (old.collection, old.key, old.data, auth.uid());
  return old;
end $$;

drop trigger if exists records_trash_trg on public.records;
create trigger records_trash_trg
  before delete on public.records
  for each row execute function public.records_to_trash();

-- Stamp who changed what, and when
create or replace function public.records_stamp()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists records_stamp_trg on public.records;
create trigger records_stamp_trg
  before insert or update on public.records
  for each row execute function public.records_stamp();

-- ---------------------------------------------------------------------
-- 3. Who may use the CRM: anyone signed in whose email is on the
--    CRM's Team members list. (While the CRM is still empty, the
--    first person to sign in may set it up.)
-- ---------------------------------------------------------------------
create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    not exists (select 1 from public.records where collection = 'users')
    or exists (
      select 1 from public.records
      where collection = 'users'
        and lower(data->>'email') = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );
$$;

alter table public.records       enable row level security;
alter table public.records_trash enable row level security;

drop policy if exists "team can read"   on public.records;
drop policy if exists "team can add"    on public.records;
drop policy if exists "team can change" on public.records;
drop policy if exists "team can delete" on public.records;

create policy "team can read"   on public.records for select to authenticated using ((select public.is_team_member()));
create policy "team can add"    on public.records for insert to authenticated with check ((select public.is_team_member()));
create policy "team can change" on public.records for update to authenticated using ((select public.is_team_member())) with check ((select public.is_team_member()));
create policy "team can delete" on public.records for delete to authenticated using ((select public.is_team_member()));
-- records_trash has no policies on purpose: only you (in the Supabase dashboard) can see it.

revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- ---------------------------------------------------------------------
-- 4. Live updates: when one person saves, everyone else sees it.
-- ---------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 5. "Engine" lease: reminders, escalations, reminder emails and the
--    website-lead sync run in ONE open browser at a time, so nobody
--    gets duplicate notifications or emails.
-- ---------------------------------------------------------------------
create table if not exists public.engine_lease (
  id      int primary key default 1 check (id = 1),
  holder  text,
  until   timestamptz not null default 'epoch'
);
insert into public.engine_lease (id) values (1) on conflict do nothing;
alter table public.engine_lease enable row level security;

create or replace function public.claim_engine(p_holder text)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if not public.is_team_member() then return false; end if;
  update public.engine_lease
     set holder = p_holder, until = now() + interval '3 minutes'
   where id = 1 and (holder = p_holder or until < now())
  returning true into ok;
  return coalesce(ok, false);
end $$;

revoke all on function public.claim_engine(text) from public, anon;
grant execute on function public.claim_engine(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Keep-alive: free Supabase projects are paused after 7 days with
--    no activity. A scheduled GitHub job (and the CRM itself) calls
--    this every day so the project never goes to sleep.
-- ---------------------------------------------------------------------
create table if not exists public.keepalive (
  id        bigserial primary key,
  pinged_at timestamptz not null default now(),
  source    text
);
alter table public.keepalive enable row level security;

create or replace function public.keepalive(p_source text default 'unknown')
returns text language plpgsql security definer set search_path = public as $$
begin
  insert into public.keepalive (source) values (left(coalesce(p_source, 'unknown'), 40));
  delete from public.keepalive where pinged_at < now() - interval '30 days';
  delete from public.records_trash where deleted_at < now() - interval '90 days';
  return 'ok ' || to_char(now(), 'YYYY-MM-DD HH24:MI');
end $$;

revoke all on function public.keepalive(text) from public;
grant execute on function public.keepalive(text) to anon, authenticated;

-- Done. You should see "Success. No rows returned".
