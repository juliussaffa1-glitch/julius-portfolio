create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.contact_messages (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(btrim(full_name)) between 2 and 100),
    email text not null check (
        char_length(email) <= 254
        and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    ),
    subject text not null check (char_length(btrim(subject)) between 3 and 120),
    message text not null check (char_length(btrim(message)) between 10 and 5000),
    status text not null default 'new' check (status in ('new', 'read', 'replied', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists contact_messages_status_created_at_idx
    on public.contact_messages (status, created_at desc);

create or replace function public.set_contact_message_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists contact_messages_set_updated_at on public.contact_messages;
create trigger contact_messages_set_updated_at
before update on public.contact_messages
for each row execute function public.set_contact_message_updated_at();

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public, anon, authenticated;
grant insert (full_name, email, subject, message) on public.contact_messages to anon;
grant select, update (status), delete on public.contact_messages to authenticated;

drop policy if exists "Anonymous visitors can submit validated messages" on public.contact_messages;
create policy "Anonymous visitors can submit validated messages"
    on public.contact_messages
    for insert
    to anon
    with check (
        status = 'new'
        and auth.jwt() ->> 'portfolio_contact' = 'submit'
    );

create table if not exists public.portfolio_admins (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from public, anon, authenticated;

create or replace function public.is_portfolio_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.portfolio_admins
        where user_id = auth.uid()
    );
$$;

revoke all on function public.is_portfolio_admin() from public, anon;
grant execute on function public.is_portfolio_admin() to authenticated, service_role;

drop policy if exists "Administrators can read messages" on public.contact_messages;
create policy "Administrators can read messages"
    on public.contact_messages
    for select
    to authenticated
    using ((select public.is_portfolio_admin()));

drop policy if exists "Administrators can update message status" on public.contact_messages;
create policy "Administrators can update message status"
    on public.contact_messages
    for update
    to authenticated
    using ((select public.is_portfolio_admin()))
    with check ((select public.is_portfolio_admin()));

drop policy if exists "Administrators can delete messages" on public.contact_messages;
create policy "Administrators can delete messages"
    on public.contact_messages
    for delete
    to authenticated
    using ((select public.is_portfolio_admin()));

create table if not exists private.contact_submission_limits (
    ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
    window_started_at timestamptz not null,
    submission_count integer not null check (submission_count > 0)
);

create or replace function public.consume_contact_submission(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_count integer;
    current_time timestamptz := clock_timestamp();
begin
    if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
        return false;
    end if;

    insert into private.contact_submission_limits as limits (ip_hash, window_started_at, submission_count)
    values (p_ip_hash, current_time, 1)
    on conflict (ip_hash) do update
    set window_started_at = case
            when limits.window_started_at <= current_time - interval '15 minutes'
                then current_time
            else limits.window_started_at
        end,
        submission_count = case
            when limits.window_started_at <= current_time - interval '15 minutes'
                then 1
            else limits.submission_count + 1
        end
    returning submission_count into current_count;

    delete from private.contact_submission_limits
    where window_started_at < current_time - interval '1 day';

    return current_count <= 5;
end;
$$;

revoke all on function public.consume_contact_submission(text) from public, anon, authenticated;
grant execute on function public.consume_contact_submission(text) to service_role;
