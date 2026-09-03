create or replace function public.mpl_register_user(
  p_email text,
  p_password_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(id uuid, email text, role text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created public.mpl_users%rowtype;
begin
  insert into public.mpl_users(email, password_hash)
  values (p_email, p_password_hash)
  returning * into created;

  insert into public.mpl_sessions(token_hash, user_id, expires_at)
  values (p_token_hash, created.id, p_expires_at);

  return query select created.id, created.email, created.role;
end;
$$;

revoke all on function public.mpl_register_user(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mpl_register_user(text, text, text, timestamptz) to service_role;
