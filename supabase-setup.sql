-- =====================================================================
-- BDT Client Discovery Portal
-- Supabase database + storage + security rules
--
-- This file is the reproducible baseline for the production architecture.
-- Apply it to a fresh Supabase project, then add the real staff emails.
-- =====================================================================

-- 1. Staff allow-list
create table if not exists public.staff (
  email text primary key
);

alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$$
  select exists (
    select 1
    from public.staff s
    where lower(s.email) = lower(
      coalesce(auth.jwt() ->> 'email', '')
    )
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Add real staff emails separately:
-- insert into public.staff (email) values ('you@yourcompany.com')
-- on conflict do nothing;

-- 2. Submissions
create table if not exists public.submissions (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  status                text not null default 'new'
                        check (status in ('new','in_review','in_progress','completed','archived')),
  source                text not null default 'client'
                        check (source in ('client','staff')),
  company_name          text,
  contact_name          text,
  answers               jsonb not null default '{}'::jsonb,
  files                 jsonb not null default '[]'::jsonb,
  staff_notes           text,
  client_finalize_token uuid not null default gen_random_uuid(),
  constraint answers_size
    check (octet_length(answers::text) < 300000),
  constraint files_limit
    check (
      jsonb_typeof(files) = 'array'
      and jsonb_array_length(files) <= 60
    )
);

alter table public.submissions
  add column if not exists client_finalize_token uuid;

update public.submissions
set client_finalize_token = gen_random_uuid()
where client_finalize_token is null;

alter table public.submissions
  alter column client_finalize_token set default gen_random_uuid();

alter table public.submissions
  alter column client_finalize_token set not null;

create unique index if not exists submissions_finalize_token_idx
  on public.submissions (client_finalize_token);

create index if not exists submissions_created_idx
  on public.submissions (created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists submissions_touch on public.submissions;

create trigger submissions_touch
before update on public.submissions
for each row
execute function public.touch_updated_at();

create or replace function public.enforce_submission_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'new'
     and new.status in ('in_review', 'archived') then
    return new;
  end if;

  if old.status = 'in_review'
     and new.status in ('in_progress', 'archived') then
    return new;
  end if;

  if old.status = 'in_progress'
     and new.status in ('completed', 'archived') then
    return new;
  end if;

  if old.status = 'completed'
     and new.status = 'archived' then
    return new;
  end if;

  raise exception 'Invalid submission status transition: % -> %',
    old.status, new.status
    using errcode = 'P0001';
end;
$$;

drop trigger if exists submissions_status_transition on public.submissions;

create trigger submissions_status_transition
before update of status on public.submissions
for each row
execute function public.enforce_submission_status_transition();

-- 3. Hardened anonymous submission lifecycle
create or replace function public.create_client_submission(
  p_company_name text,
  p_contact_name text,
  p_answers jsonb
)
returns table (
  submission_id uuid,
  finalize_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  new_token uuid;
begin
  if length(trim(coalesce(p_company_name, ''))) = 0
     or length(trim(coalesce(p_contact_name, ''))) = 0 then
    raise exception 'Company and contact names are required';
  end if;

  if p_answers is null
     or jsonb_typeof(p_answers) <> 'object'
     or octet_length(p_answers::text) >= 300000 then
    raise exception 'Invalid submission answers';
  end if;

  new_id := gen_random_uuid();
  new_token := gen_random_uuid();

  insert into public.submissions (
    id, status, source, company_name, contact_name,
    answers, files, client_finalize_token
  )
  values (
    new_id, 'new', 'client', trim(p_company_name),
    trim(p_contact_name), p_answers, '[]'::jsonb, new_token
  );

  return query select new_id, new_token;
end;
$$;

revoke all on function public.create_client_submission(text, text, jsonb)
from public, authenticated;

grant execute on function public.create_client_submission(text, text, jsonb)
to anon;

create or replace function public.finalize_client_submission(
  p_submission_id uuid,
  p_finalize_token uuid,
  p_files jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_files is null
     or jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) > 60 then
    raise exception 'Invalid file metadata';
  end if;

  update public.submissions
  set
    files = p_files,
    client_finalize_token = gen_random_uuid()
  where id = p_submission_id
    and client_finalize_token = p_finalize_token
    and source = 'client'
    and status = 'new';

  if not found then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_client_submission(uuid, uuid, jsonb)
from public, authenticated;

grant execute on function public.finalize_client_submission(uuid, uuid, jsonb)
to anon;

-- 4. Database grants + RLS
alter table public.submissions enable row level security;

-- Payments is created in section 6 below, so its privileges are
-- configured after the table exists. Do not reference it here.
revoke all
on table public.staff, public.submissions
from anon, authenticated;

grant insert on public.submissions to anon;

grant select, insert, update, delete
on public.submissions
to authenticated;

drop policy if exists "clients can submit" on public.submissions;

create policy "clients can submit"
on public.submissions
for insert
to anon
with check (
  status = 'new'
  and source = 'client'
  and staff_notes is null
);

drop policy if exists "staff full access" on public.submissions;

create policy "staff full access"
on public.submissions
for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- 5. Private client file storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('client-files', 'client-files', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400;

create or replace function public.is_valid_client_upload_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parts text[];
begin
  if object_name is null or length(object_name) = 0 then
    return false;
  end if;

  parts := string_to_array(object_name, '/');

  if array_length(parts, 1) <> 3 then
    return false;
  end if;

  if parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  if length(trim(parts[2])) = 0
     or length(trim(parts[3])) = 0 then
    return false;
  end if;

  return exists (
    select 1
    from public.submissions s
    where s.id = parts[1]::uuid
      and s.source = 'client'
  );
end;
$$;

revoke all on function public.is_valid_client_upload_path(text)
from public, authenticated;

grant execute on function public.is_valid_client_upload_path(text)
to anon;

drop policy if exists "clients can upload files" on storage.objects;

create policy "clients can upload files"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'client-files'
  and public.is_valid_client_upload_path(name)
);

drop policy if exists "staff manage files" on storage.objects;

create policy "staff manage files"
on storage.objects
for all
to authenticated
using (bucket_id = 'client-files' and public.is_staff())
with check (bucket_id = 'client-files' and public.is_staff());

-- 6. Payments + proof of payment
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  receipt_number    text not null unique default (
    'RC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  amount            numeric(12,2) not null check (amount >= 0),
  currency          text not null default 'ZAR',
  payment_date     date not null,
  reference         text,
  payer_name        text,
  bank_name         text,
  description       text,
  proof_path        text not null,
  proof_name        text not null,
  extracted_data    jsonb not null default '{}'::jsonb,
  extraction_source text not null default 'manual'
                    check (extraction_source in ('manual','ocr','pdf_text')),
  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  constraint payments_amount_finite check (amount < 1000000000),
  constraint payments_extracted_size check (octet_length(extracted_data::text) < 20000)
);

create index if not exists payments_submission_idx
on public.payments (submission_id, payment_date desc);

create index if not exists payments_reference_idx
on public.payments (reference);

create or replace function public.touch_payment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_touch on public.payments;

create trigger payments_touch
before update on public.payments
for each row
execute function public.touch_payment_updated_at();

alter table public.payments enable row level security;

grant select, insert, update, delete
on public.payments
to authenticated;

drop policy if exists "staff manage payments" on public.payments;

create policy "staff manage payments"
on public.payments
for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

-- Payment proofs use the same private client-files bucket.
-- Anonymous clients cannot use the payment namespace because their
-- storage policy requires exactly <submission>/<field>/<filename>.
