-- Run once in a new Supabase project using the SQL editor or `supabase db push`.
-- All data access goes through the server; browser sessions never receive these grants.
create table public.entries (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  payload jsonb not null,
  status text not null default 'Draft' check (status in ('Draft', 'Published')),
  version integer not null default 1 check (version > 0),
  deleted boolean not null default false,
  updated_at timestamptz not null,
  constraint entries_payload_matches_row check (
    jsonb_typeof(payload) = 'object'
    and payload ?& array['id', 'status', 'version', 'relations', 'images']
    and payload->>'id' = id
    and payload->>'status' = status
    and (payload->>'version')::integer = version
    and jsonb_typeof(payload->'relations') = 'array'
    and jsonb_typeof(payload->'images') = 'array'
  )
);

create index entries_visible_updated_at_idx
  on public.entries (status, updated_at desc, id) where not deleted;
create index entries_payload_idx
  on public.entries using gin (payload jsonb_path_ops) where not deleted;

alter table public.entries enable row level security;
revoke all on table public.entries from public, anon, authenticated;
grant select, insert, update, delete on table public.entries to service_role;

-- The table lock serializes saves and deletes, including separate records in a
-- relationship graph. Graph checks and optimistic version checks consequently
-- observe the same state as their write; concurrent saves cannot introduce a cycle.
-- SECURITY INVOKER and explicit grants keep both functions service-role-only.
create function public.save_archive_entry(p_entry jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entry_id text;
  expected_version integer;
  existing public.entries%rowtype;
  saved_at timestamptz;
  saved_payload jsonb;
  creates_cycle boolean;
begin
  if jsonb_typeof(p_entry) is distinct from 'object'
    or jsonb_typeof(p_entry->'id') is distinct from 'string'
    or (p_entry->>'id') !~ '^[a-zA-Z0-9_-]{1,100}$'
    or jsonb_typeof(p_entry->'version') is distinct from 'number'
    or (p_entry->>'version') !~ '^[0-9]+$'
    or jsonb_typeof(p_entry->'relations') is distinct from 'array'
    or jsonb_typeof(p_entry->'images') is distinct from 'array'
    or coalesce(p_entry->>'status', '') not in ('Draft', 'Published') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if (p_entry->>'version')::numeric > 2147483646 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  entry_id := p_entry->>'id';
  expected_version := (p_entry->>'version')::integer;
  lock table public.entries in share row exclusive mode;
  select * into existing from public.entries where id = entry_id;

  if expected_version = 0 then
    if found then
      return jsonb_build_object('ok', false, 'error', 'exists');
    end if;
  elsif not found or existing.deleted or existing.version <> expected_version then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entry->'relations') as relation
    where relation->>'parentId' is null
      or not exists (
        select 1 from public.entries parent
        where parent.id = relation->>'parentId' and not parent.deleted
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'missing_parent');
  end if;

  -- UNION deduplicates visited IDs so corrupt imported data cannot recurse forever.
  with recursive ancestors(id) as (
    select relation->>'parentId'
    from jsonb_array_elements(p_entry->'relations') as relation
    union
    select relation->>'parentId'
    from ancestors
    join public.entries parent on parent.id = ancestors.id and not parent.deleted
    cross join lateral jsonb_array_elements(parent.payload->'relations') as relation
  )
  select exists(select 1 from ancestors where id = entry_id) into creates_cycle;

  if creates_cycle then
    return jsonb_build_object('ok', false, 'error', 'cycle');
  end if;

  saved_at := date_trunc('milliseconds', clock_timestamp());
  saved_payload := p_entry || jsonb_build_object(
    'version', expected_version + 1,
    'updatedAt', to_char(saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  if expected_version = 0 then
    insert into public.entries (id, payload, status, version, updated_at)
    values (entry_id, saved_payload, saved_payload->>'status', 1, saved_at);
  else
    update public.entries
    set payload = saved_payload,
        status = saved_payload->>'status',
        version = expected_version + 1,
        updated_at = saved_at
    where id = entry_id;
  end if;
  return jsonb_build_object('ok', true, 'entry', saved_payload);
end;
$$;

create function public.delete_archive_entry(p_id text, p_version integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.entries%rowtype;
  linked_names jsonb;
begin
  if p_id is null or p_id !~ '^[a-zA-Z0-9_-]{1,100}$'
    or p_version is null or p_version < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  lock table public.entries in share row exclusive mode;
  select * into existing from public.entries where id = p_id;
  if not found or existing.deleted or existing.version <> p_version then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;

  select jsonb_agg(linked.payload->>'name' order by linked.payload->>'name')
  into linked_names
  from public.entries linked
  where not linked.deleted and linked.id <> p_id
    and exists (
      select 1 from jsonb_array_elements(linked.payload->'relations') as relation
      where relation->>'parentId' = p_id
    );
  if linked_names is not null then
    return jsonb_build_object('ok', false, 'error', 'linked', 'linkedNames', linked_names);
  end if;

  update public.entries set deleted = true where id = p_id;
  return jsonb_build_object('ok', true, 'deleted', p_id);
end;
$$;

revoke all on function public.save_archive_entry(jsonb) from public, anon, authenticated;
revoke all on function public.delete_archive_entry(text, integer) from public, anon, authenticated;
grant execute on function public.save_archive_entry(jsonb) to service_role;
grant execute on function public.delete_archive_entry(text, integer) to service_role;

-- Private bucket: do not add public/authenticated storage policies. The API checks
-- owner access or attachment to a currently published record before proxying bytes.
-- If SUPABASE_STORAGE_BUCKET is customized, change this bucket ID and name too.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'archive-images',
  'archive-images',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
