-- =====================================================================
--  Client questionnaire: database + file storage + security rules
--
--  HOW TO USE
--  1. In Supabase, open  SQL Editor  ->  New query.
--  2. Replace you@yourcompany.com below with the email address(es) of
--     the staff who should be allowed to see client data.
--  3. Paste this whole file and click Run. It is safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Staff allow-list
--    Only emails in this table can read, edit or delete client data,
--    even if someone else manages to create a login.
-- ---------------------------------------------------------------------
create table if not exists public.staff (
  email text primary key
);
alter table public.staff enable row level security;
-- No policies on purpose: nobody can read this table through the API.

insert into public.staff (email) values
  ('you@yourcompany.com')
on conflict do nothing;
-- To add more staff later:  insert into public.staff (email) values ('name@yourcompany.com');

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Submissions table (one row per client questionnaire)
-- ---------------------------------------------------------------------
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  status       text not null default 'new'
               check (status in ('new','in_review','in_progress','completed','archived')),
  source       text not null default 'client' check (source in ('client','staff')),
  company_name text,
  contact_name text,
  answers      jsonb not null default '{}'::jsonb,
  files        jsonb not null default '[]'::jsonb,
  staff_notes  text,
  constraint answers_size check (octet_length(answers::text) < 300000),
  constraint files_limit  check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 60)
);

create index if not exists submissions_created_idx on public.submissions (created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists submissions_touch on public.submissions;
create trigger submissions_touch
  before update on public.submissions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 3. Security rules for the table
--    Visitors (anon)  : can ONLY add a new submission. They cannot read,
--                       change or delete anything.
--    Staff            : full access (create, read, update, delete).
-- ---------------------------------------------------------------------
alter table public.submissions enable row level security;

grant insert on public.submissions to anon;
grant select, insert, update, delete on public.submissions to authenticated;

drop policy if exists "clients can submit" on public.submissions;
create policy "clients can submit"
  on public.submissions
  for insert
  to anon
  with check (status = 'new' and source = 'client' and staff_notes is null);

drop policy if exists "staff full access" on public.submissions;
create policy "staff full access"
  on public.submissions
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------
-- 4. Private file storage (logos, images, brochures, etc.)
--    The bucket is private. Visitors can upload but never list or open
--    files. Only staff can view, download and delete them.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('client-files', 'client-files', false, 26214400)   -- 25 MB per file
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

drop policy if exists "clients can upload files" on storage.objects;
create policy "clients can upload files"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'client-files');

drop policy if exists "staff manage files" on storage.objects;
create policy "staff manage files"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'client-files' and public.is_staff())
  with check (bucket_id = 'client-files' and public.is_staff());


-- ---------------------------------------------------------------------
-- 5. Payment records + proof of payment
--    Financial records are separate from discovery answers.
--    Staff must explicitly confirm extracted payment details before save.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  receipt_number    text not null unique default ('RC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
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
  extraction_source text not null default 'manual' check (extraction_source in ('manual','ocr','pdf_text')),
  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  constraint payments_amount_finite check (amount < 1000000000),
  constraint payments_extracted_size check (octet_length(extracted_data::text) < 20000)
);

create index if not exists payments_submission_idx on public.payments (submission_id, payment_date desc);
create index if not exists payments_reference_idx on public.payments (reference);

create or replace function public.touch_payment_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch
  before update on public.payments
  for each row execute function public.touch_payment_updated_at();

alter table public.payments enable row level security;
grant select, insert, update, delete on public.payments to authenticated;

drop policy if exists "staff manage payments" on public.payments;
create policy "staff manage payments"
  on public.payments
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Payment proof lives in the same private bucket as other client files.
-- Staff access is already covered by the existing "staff manage files" policy.
