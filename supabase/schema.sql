--
-- PostgreSQL database dump
--

\restrict fZtM2TFlfOf4NLvweYAmyaE9A7gkoPnmgaJzCzea4Z7hwaBNUwb0dbqqEz3KVNr

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO supabase_admin;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql;


ALTER SCHEMA graphql OWNER TO supabase_admin;

--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql_public;


ALTER SCHEMA graphql_public OWNER TO supabase_admin;

--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: pgbouncer
--

CREATE SCHEMA pgbouncer;


ALTER SCHEMA pgbouncer OWNER TO pgbouncer;

--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA realtime;


ALTER SCHEMA realtime OWNER TO supabase_admin;

--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA storage;


ALTER SCHEMA storage OWNER TO supabase_admin;

--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA vault;


ALTER SCHEMA vault OWNER TO supabase_admin;

--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;


--
-- Name: EXTENSION pg_graphql; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE auth.aal_level OWNER TO supabase_auth_admin;

--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin;

--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE auth.factor_status OWNER TO supabase_auth_admin;

--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE auth.oauth_authorization_status OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE auth.oauth_client_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE auth.oauth_registration_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


ALTER TYPE auth.oauth_response_type OWNER TO supabase_auth_admin;

--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE auth.one_time_token_type OWNER TO supabase_auth_admin;

--
-- Name: action; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


ALTER TYPE realtime.action OWNER TO supabase_admin;

--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


ALTER TYPE realtime.equality_op OWNER TO supabase_admin;

--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


ALTER TYPE realtime.user_defined_filter OWNER TO supabase_admin;

--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


ALTER TYPE realtime.wal_column OWNER TO supabase_admin;

--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


ALTER TYPE realtime.wal_rls OWNER TO supabase_admin;

--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE storage.buckettype OWNER TO supabase_storage_admin;

--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_cron_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_net_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_ddl_watch() OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_drop_watch() OWNER TO supabase_admin;

--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION extensions.set_graphql_placeholder() OWNER TO supabase_admin;

--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: supabase_admin
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


ALTER FUNCTION pgbouncer.get_auth(p_usename text) OWNER TO supabase_admin;

--
-- Name: claim_next_mlcc_order(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_next_mlcc_order(p_worker_id text) RETURNS TABLE(order_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_order_id uuid;
begin
  -- Pick one queued order and atomically lock it
  with candidate as (
    select o.id
    from public.orders o
    where o.status = 'queued_for_mlcc'
      and o.rpa_status in ('idle','rpa_failed')
      and (o.rpa_locked_at is null or o.rpa_locked_at < now() - interval '30 minutes')
    order by o.created_at asc
    limit 1
    for update skip locked
  )
  update public.orders o
  set
    rpa_status = 'rpa_running',
    rpa_locked_at = now(),
    rpa_worker_id = p_worker_id,
    rpa_attempts = o.rpa_attempts + 1,
    rpa_last_error = null
  from candidate c
  where o.id = c.id
  returning o.id into v_order_id;

  if v_order_id is null then
    return;
  end if;

  order_id := v_order_id;
  return next;
end;
$$;


ALTER FUNCTION public.claim_next_mlcc_order(p_worker_id text) OWNER TO postgres;

--
-- Name: claim_next_rpa_job(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.claim_next_rpa_job(p_worker_id text) RETURNS TABLE(id uuid, order_id uuid, store_id uuid)
    LANGUAGE plpgsql
    AS $$
begin
  return query
  with claimed as (
    update public.rpa_jobs r
    set
      status = 'running',
      worker_id = p_worker_id
    where r.id = (
      select j.id
      from public.rpa_jobs j
      where j.status = 'pending'
        and (j.worker_id is null or j.worker_id = '')
      order by j.created_at asc
      for update skip locked
      limit 1
    )
    returning r.id, r.order_id, r.store_id
  )
  select claimed.id, claimed.order_id, claimed.store_id
  from claimed;
end;
$$;


ALTER FUNCTION public.claim_next_rpa_job(p_worker_id text) OWNER TO postgres;

--
-- Name: create_submission_intent(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_ok boolean;
  v_intent_id uuid;
begin
  if p_request_fingerprint_hash is null or length(p_request_fingerprint_hash) < 16 then
    raise exception 'invalid fingerprint hash';
  end if;

  v_ok := public.verify_order_pin(p_store_id, p_pin);
  if not v_ok then
    raise exception 'invalid pin or locked';
  end if;

  insert into public.submission_intents (store_id, order_id, request_fingerprint_hash)
  values (p_store_id, p_order_id, p_request_fingerprint_hash)
  returning id into v_intent_id;

  return v_intent_id;
end;
$$;


ALTER FUNCTION public.create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text) OWNER TO postgres;

--
-- Name: create_test_rpa_job(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_test_rpa_job() RETURNS TABLE(job_id uuid, order_id uuid, store_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_store_id uuid;
  v_order_id uuid;
  v_job_id uuid;
begin
  -- Pick the first store (must exist)
  select s.id
    into v_store_id
  from public.stores s
  order by s.created_at asc nulls last
  limit 1;

  if v_store_id is null then
    raise exception 'No rows in public.stores. Create a store first, then rerun.';
  end if;

  -- Create an order for that store
  insert into public.orders (store_id, status, submitted_to_mlcc, created_at)
  values (v_store_id, 'draft', false, now())
  returning id into v_order_id;

  -- Create the RPA job tied to that order
  insert into public.rpa_jobs (store_id, order_id, job_type, status)
  values (v_store_id, v_order_id, 'submit_order', 'pending')
  returning id into v_job_id;

  return query
  select v_job_id, v_order_id, v_store_id;
end;
$$;


ALTER FUNCTION public.create_test_rpa_job() OWNER TO postgres;

--
-- Name: ensure_store_security(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_store_security(p_store_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  insert into public.store_security (store_id)
  values (p_store_id)
  on conflict (store_id) do nothing;
end;
$$;


ALTER FUNCTION public.ensure_store_security(p_store_id uuid) OWNER TO postgres;

--
-- Name: get_mlcc_credentials(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) RETURNS TABLE(mlcc_email text, mlcc_password text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'Missing/weak encryption key';
  end if;

  return query
  select
    pgp_sym_decrypt(decode(c.mlcc_email_enc, 'base64'), p_key)::text,
    pgp_sym_decrypt(decode(c.mlcc_password_enc, 'base64'), p_key)::text
  from public.store_mlcc_credentials c
  where c.store_id = p_store_id;
end;
$$;


ALTER FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) OWNER TO postgres;

--
-- Name: is_store_user(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.is_store_user(p_store_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1
    from public.store_users su
    where su.store_id = p_store_id
      and su.user_id = auth.uid()
      and coalesce(su.is_active, true) = true
  );
$$;


ALTER FUNCTION public.is_store_user(p_store_id uuid) OWNER TO postgres;

--
-- Name: lk_attach_order_proof(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_intent_id uuid;
  v_store_id uuid;
  v_id uuid;
begin
  if p_run_id is null then
    raise exception 'run_id required';
  end if;

  if p_stage is null or length(trim(p_stage)) = 0 then
    raise exception 'stage required';
  end if;

  if p_proof_hash is null or length(trim(p_proof_hash)) = 0 then
    raise exception 'proof_hash required';
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select intent_id, store_id into v_intent_id, v_store_id
  from lk_order_runs
  where id = p_run_id;

  if v_intent_id is null then
    raise exception 'run not found';
  end if;

  insert into lk_order_proofs(run_id, intent_id, store_id, stage, proof_hash, proof_payload)
  values (p_run_id, v_intent_id, v_store_id, p_stage, p_proof_hash, coalesce(p_proof_payload,'{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION public.lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb) OWNER TO postgres;

--
-- Name: lk_create_order_intent(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_intent_id uuid;
begin
  if p_store_id is null then
    raise exception 'store_id required';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required';
  end if;

  if p_requested_items is null or jsonb_typeof(p_requested_items) <> 'array' then
    raise exception 'requested_items must be a JSON array';
  end if;

  -- enforce server-only usage: must be called with service role
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select id into v_intent_id
  from lk_order_intents
  where store_id = p_store_id and idempotency_key = p_idempotency_key;

  if v_intent_id is not null then
    return v_intent_id;
  end if;

  insert into lk_order_intents (store_id, created_by, idempotency_key, requested_items, status)
  values (p_store_id, auth.uid(), p_idempotency_key, p_requested_items, 'CREATED')
  returning id into v_intent_id;

  return v_intent_id;
end;
$$;


ALTER FUNCTION public.lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb) OWNER TO postgres;

--
-- Name: lk_get_bottle_context(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_get_bottle_context(bottle_uuid uuid) RETURNS json
    LANGUAGE sql
    AS $$
  select json_build_object(
    'name', b.name,
    'size_ml', b.size_ml,
    'mlcc_code', b.mlcc_code
  )
  from bottles b
  where b.id = bottle_uuid;
$$;


ALTER FUNCTION public.lk_get_bottle_context(bottle_uuid uuid) OWNER TO postgres;

--
-- Name: lk_get_bottle_context(uuid, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $_$
declare
  has_size_ml boolean;
  has_upc boolean;
  has_brand boolean;
  has_proof boolean;
  bottle_sql text;
  bottle_json jsonb;
  inventory_json jsonb;
begin
  -- Detect optional bottles columns safely
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bottles' and column_name='size_ml'
  ) into has_size_ml;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bottles' and column_name='upc'
  ) into has_upc;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bottles' and column_name='brand'
  ) into has_brand;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bottles' and column_name='proof'
  ) into has_proof;

  -- Build bottle JSON dynamically so missing columns never crash
  bottle_sql :=
    'select jsonb_build_object(
        ''id'', b.id,
        ''name'', b.name' ||
        case when has_brand then ', ''brand'', b.brand' else '' end ||
        case when has_size_ml then ', ''size_ml'', b.size_ml' else '' end ||
        case when has_proof then ', ''proof'', b.proof' else '' end ||
        case when has_upc then ', ''upc'', b.upc' else '' end ||
    ')
     from public.bottles b
     where b.id = $1
     limit 1';

  execute bottle_sql into bottle_json using p_bottle_id;

  -- Inventory JSON (your schema is known)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'store_id', i.store_id,
        'bottle_id', i.bottle_id,
        'quantity', i.quantity,
        'shelf_price', i.shelf_price,
        'cost', i.cost,
        'par_level', i.par_level,
        'low_stock_threshold', i.low_stock_threshold,
        'reorder_point', i.reorder_point,
        'reorder_quantity', i.reorder_quantity,
        'location', i.location,
        'location_note', i.location_note,
        'is_active', i.is_active,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'last_counted_at', i.last_counted_at
      )
      order by i.store_id
    ),
    '[]'::jsonb
  )
  into inventory_json
  from public.inventory i
  where i.bottle_id = p_bottle_id
    and (p_store_id is null or i.store_id = p_store_id);

  return jsonb_build_object(
    'bottle', bottle_json,
    'inventory', inventory_json
  );
end;
$_$;


ALTER FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid) OWNER TO postgres;

--
-- Name: lk_get_mlcc_context_by_code(text, date); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
declare
  rid record;
  item_json jsonb;
  snap_json jsonb;
begin
  -- resolve code -> mlcc_item_id (history-first)
  select * into rid
  from public.lk_resolve_mlcc_code(p_code, (p_on::timestamptz + interval '12 hours'))
  limit 1;

  if rid.mlcc_item_id is null then
    return jsonb_build_object('error','CODE_NOT_FOUND','code',trim(p_code));
  end if;

  -- item core
  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'mlcc_item_no', i.mlcc_item_no,
    'name', i.name,
    'size_ml', i.size_ml,
    'category', i.category,
    'subcategory', i.subcategory,
    'abv', i.abv,
    'state_min_price', i.state_min_price,
    'updated_at', i.updated_at
  )
  into item_json
  from public.mlcc_items i
  where i.id = rid.mlcc_item_id;

  -- latest snapshot <= date
  select jsonb_build_object(
    'effective_date', s.effective_date,
    'retail_price', s.retail_price,
    'state_min_price', s.state_min_price,
    'source', s.source,
    'updated_at', s.updated_at
  )
  into snap_json
  from public.mlcc_price_snapshots s
  where s.mlcc_item_id = rid.mlcc_item_id
    and s.effective_date <= p_on
  order by s.effective_date desc, s.updated_at desc
  limit 1;

  return jsonb_build_object(
    'code', trim(p_code),
    'resolved', jsonb_build_object(
      'mlcc_item_id', rid.mlcc_item_id,
      'valid_from', rid.valid_from,
      'valid_to', rid.valid_to
    ),
    'item', item_json,
    'latest_snapshot', coalesce(snap_json, jsonb_build_object('note','NO_SNAPSHOT_FOUND'))
  );
end;
$$;


ALTER FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date) OWNER TO postgres;

--
-- Name: lk_is_store_member(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_is_store_member(p_store_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.store_users su
    where su.store_id = p_store_id
      and su.user_id = auth.uid()
  );
$$;


ALTER FUNCTION public.lk_is_store_member(p_store_id uuid) OWNER TO postgres;

--
-- Name: lk_log_order_event(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_log_order_event(p_run_id uuid, p_event_type text, p_level text DEFAULT 'INFO'::text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_intent_id uuid;
  v_store_id uuid;
  v_id bigint;
begin
  if p_run_id is null then
    raise exception 'run_id required';
  end if;

  if p_event_type is null or length(trim(p_event_type)) = 0 then
    raise exception 'event_type required';
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select intent_id, store_id into v_intent_id, v_store_id
  from lk_order_runs
  where id = p_run_id;

  if v_intent_id is null then
    raise exception 'run not found';
  end if;

  insert into lk_order_events(run_id, intent_id, store_id, level, event_type, payload)
  values (p_run_id, v_intent_id, v_store_id, coalesce(p_level,'INFO'), p_event_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION public.lk_log_order_event(p_run_id uuid, p_event_type text, p_level text, p_payload jsonb) OWNER TO postgres;

--
-- Name: lk_mark_order_state(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_mark_order_state(p_run_id uuid, p_new_state text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_old text;
begin
  if p_run_id is null then
    raise exception 'run_id required';
  end if;

  if p_new_state is null or length(trim(p_new_state)) = 0 then
    raise exception 'new_state required';
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select state into v_old from lk_order_runs where id = p_run_id;
  if v_old is null then
    raise exception 'run not found';
  end if;

  -- Allowed transitions
  if not (
    (v_old = 'CREATED' and p_new_state = 'PLANNED') or
    (v_old = 'PLANNED' and p_new_state = 'CART_BUILT') or
    (v_old = 'CART_BUILT' and p_new_state = 'MLCC_VALIDATED') or
    (v_old = 'MLCC_VALIDATED' and p_new_state = 'PRE_SUBMIT_PROOFED') or
    (v_old = 'PRE_SUBMIT_PROOFED' and p_new_state = 'SUBMITTED') or
    (v_old = 'SUBMITTED' and p_new_state = 'RECEIPT_CAPTURED') or
    (v_old = 'RECEIPT_CAPTURED' and p_new_state = 'DONE') or
    (p_new_state = 'FAILED_SAFE')
  ) then
    raise exception 'invalid transition: % -> %', v_old, p_new_state;
  end if;

  update lk_order_runs set state = p_new_state where id = p_run_id;

  if p_new_state in ('DONE','FAILED_SAFE') then
    update lk_order_runs set finished_at = now() where id = p_run_id;

    update lk_order_intents
    set status = case when p_new_state='DONE' then 'DONE' else 'FAILED_SAFE' end
    where id = (select intent_id from lk_order_runs where id=p_run_id);
  end if;
end;
$$;


ALTER FUNCTION public.lk_mark_order_state(p_run_id uuid, p_new_state text) OWNER TO postgres;

--
-- Name: lk_resolve_bottle(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(bottle_id uuid, name text, size_ml integer, proof numeric, mlcc_code text, upc text, store_price numeric, shelf_location text, notes text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select *
  from (
    with q as (
      select trim(p_query) as qq
    ),
    alias_hits as (
      select
        b.id as bottle_id,
        b.name,
        b.size_ml,
        null::numeric as proof,
        max(case when ba.alias_type = 'mlcc_code' and ba.valid_to is null then ba.alias_value end) as mlcc_code,
        max(case when ba.alias_type = 'upc'       and ba.valid_to is null then ba.alias_value end) as upc
      from public.bottles b
      join public.bottle_aliases ba on ba.bottle_id = b.id
      join q on ba.alias_value = q.qq
      group by b.id, b.name, b.size_ml
    ),
    name_hits as (
      select
        b.id as bottle_id,
        b.name,
        b.size_ml,
        null::numeric as proof,
        (select ba.alias_value from public.bottle_aliases ba where ba.bottle_id=b.id and ba.alias_type='mlcc_code' and ba.valid_to is null limit 1) as mlcc_code,
        (select ba.alias_value from public.bottle_aliases ba where ba.bottle_id=b.id and ba.alias_type='upc'       and ba.valid_to is null limit 1) as upc,
        similarity(b.name, (select qq from q)) as sim
      from public.bottles b
      join q on true
      where b.name % (select qq from q) or b.name ilike ('%' || (select qq from q) || '%')
      order by sim desc, b.name asc
      limit greatest(p_limit, 10)
    ),
    merged as (
      select bottle_id, name, size_ml, proof, mlcc_code, upc from alias_hits
      union
      select bottle_id, name, size_ml, proof, mlcc_code, upc from name_hits
    )
    select
      m.bottle_id,
      m.name,
      m.size_ml,
      m.proof,
      m.mlcc_code,
      m.upc,
      sbn.store_price,
      sbn.shelf_location,
      sbn.notes
    from merged m
    left join public.store_bottle_notes sbn
      on sbn.store_id = p_store_id
     and sbn.bottle_id = m.bottle_id
    limit p_limit
  ) out
  where public.lk_is_store_member(p_store_id);
$$;


ALTER FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer) OWNER TO postgres;

--
-- Name: lk_resolve_bottle_by_code(text, uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid DEFAULT NULL::uuid) RETURNS TABLE(bottle_id uuid, alias_type text, alias_value text, source text, store_id uuid, created_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  select
    ba.bottle_id,
    ba.alias_type,
    ba.alias_value,
    ba.source,
    ba.store_id,
    ba.created_at
  from public.bottle_aliases ba
  where
    ba.alias_type = 'mlcc_code'
    and (
      trim(ba.alias_value) = trim(code_text)
      or trim(leading '0' from trim(ba.alias_value)) = trim(code_text)
    )
    and (p_store_id is null or ba.store_id = p_store_id)
  order by
    ba.created_at desc
  limit 5;
$$;


ALTER FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid) OWNER TO postgres;

--
-- Name: lk_resolve_mlcc_code(text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone DEFAULT now()) RETURNS TABLE(mlcc_item_id uuid, mlcc_code text, valid_from timestamp with time zone, valid_to timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
begin
  -- 1) Prefer history table (mlcc_item_codes)
  return query
  select
    c.mlcc_item_id,
    c.mlcc_code,
    c.valid_from,
    c.valid_to
  from public.mlcc_item_codes c
  where c.mlcc_code = trim(p_code)
    and c.valid_from <= p_at
    and (c.valid_to is null or c.valid_to > p_at)
  order by c.valid_from desc
  limit 1;

  -- If we found a row, stop.
  if found then
    return;
  end if;

  -- 2) Fallback to mlcc_items.code (until importer/history is fully mature)
  return query
  select
    i.id as mlcc_item_id,
    trim(i.code) as mlcc_code,
    coalesce(i.created_at, now()) as valid_from,
    null::timestamptz as valid_to
  from public.mlcc_items i
  where trim(i.code) = trim(p_code)
  limit 1;

  return;
end;
$$;


ALTER FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone) OWNER TO postgres;

--
-- Name: lk_resolve_mlcc_code_latest(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_resolve_mlcc_code_latest(p_code text) RETURNS TABLE(snapshot_id uuid, effective_date date, liquor_code text, brand_name text, proof numeric, size_ml integer, pack integer, ada_number text, mi_flag boolean, base_price numeric, licensee_price numeric, min_shelf_price numeric, new_chng text)
    LANGUAGE sql STABLE
    AS $$
  with latest as (
    select id, effective_date
    from public.mlcc_pricebook_snapshots
    where source_kind = 'price_book'
    order by effective_date desc, ingested_at desc
    limit 1
  )
  select
    l.id as snapshot_id,
    l.effective_date,
    r.liquor_code,
    r.brand_name,
    r.proof,
    r.size_ml,
    r.pack,
    r.ada_number,
    r.mi_flag,
    r.base_price,
    r.licensee_price,
    r.min_shelf_price,
    r.new_chng
  from latest l
  join public.mlcc_pricebook_rows r on r.snapshot_id = l.id
  where r.liquor_code = trim(p_code)
  limit 1;
$$;


ALTER FUNCTION public.lk_resolve_mlcc_code_latest(p_code text) OWNER TO postgres;

--
-- Name: lk_snap_qty(uuid, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) RETURNS TABLE(snapped integer, reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  ladder int[];
  i int;
  best int := null;
  best_diff int := null;
begin
  if p_requested is null or p_requested < 0 then
    snapped := 0;
    reason := 'invalid_requested_qty';
    return next;
    return;
  end if;

  select r.ladder into ladder
  from public.mlcc_qty_rules r
  where r.bottle_id = p_bottle_id;

  if ladder is null or array_length(ladder, 1) is null then
    snapped := p_requested;
    reason := 'no_rule_known';
    return next;
    return;
  end if;

  for i in 1..array_length(ladder, 1) loop
    if best is null then
      best := ladder[i];
      best_diff := abs(ladder[i] - p_requested);
    else
      if abs(ladder[i] - p_requested) < best_diff then
        best := ladder[i];
        best_diff := abs(ladder[i] - p_requested);
      end if;
    end if;
  end loop;

  snapped := best;
  reason := case when snapped = p_requested then 'already_valid' else 'snapped_to_nearest_ladder' end;
  return next;
end;
$$;


ALTER FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) OWNER TO postgres;

--
-- Name: lk_start_order_run(uuid, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_start_order_run(p_intent_id uuid, p_submit_armed boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_store_id uuid;
  v_run_id uuid;
  v_existing uuid;
begin
  if p_intent_id is null then
    raise exception 'intent_id required';
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  select store_id into v_store_id
  from lk_order_intents
  where id = p_intent_id;

  if v_store_id is null then
    raise exception 'intent not found';
  end if;

  -- Prevent double-runs: if there is a run not finished, return it
  select id into v_existing
  from lk_order_runs
  where intent_id = p_intent_id and finished_at is null
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into lk_order_runs (intent_id, store_id, state, is_submit_armed)
  values (p_intent_id, v_store_id, 'CREATED', coalesce(p_submit_armed, false))
  returning id into v_run_id;

  update lk_order_intents
  set status = 'RUNNING'
  where id = p_intent_id;

  return v_run_id;
end;
$$;


ALTER FUNCTION public.lk_start_order_run(p_intent_id uuid, p_submit_armed boolean) OWNER TO postgres;

--
-- Name: lk_touch_mlcc_qty_rules_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_touch_mlcc_qty_rules_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION public.lk_touch_mlcc_qty_rules_updated_at() OWNER TO postgres;

--
-- Name: lk_touch_store_bottle_notes_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.lk_touch_store_bottle_notes_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION public.lk_touch_store_bottle_notes_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: rpa_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rpa_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid NOT NULL,
    job_type text NOT NULL,
    status text NOT NULL,
    error_code text,
    error_message text,
    mlcc_confirmation_code text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    worker_id text,
    last_heartbeat_at timestamp with time zone,
    CONSTRAINT rpa_jobs_job_type_check CHECK ((job_type = 'submit_order'::text)),
    CONSTRAINT rpa_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.rpa_jobs OWNER TO postgres;

--
-- Name: rpa_claim_next_job(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rpa_claim_next_job(p_worker_id text) RETURNS public.rpa_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_job public.rpa_jobs;
begin
  select *
    into v_job
  from public.rpa_jobs
  where status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.rpa_jobs
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;


ALTER FUNCTION public.rpa_claim_next_job(p_worker_id text) OWNER TO postgres;

--
-- Name: set_order_pin(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_order_pin(p_store_id uuid, p_pin text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
begin
  -- Must be store member (RLS will also enforce via update/insert policy)
  if not exists (
    select 1 from public.store_users su
    where su.store_id = p_store_id and su.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;

  perform public.ensure_store_security(p_store_id);

  update public.store_security
  set order_pin_hash = crypt(p_pin, gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      pin_updated_at = now()
  where store_id = p_store_id;
end;
$_$;


ALTER FUNCTION public.set_order_pin(p_store_id uuid, p_pin text) OWNER TO postgres;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.set_updated_at() OWNER TO postgres;

--
-- Name: submit_order_to_mlcc(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.submit_order_to_mlcc(p_order_id uuid) RETURNS public.rpa_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
    v_store_id uuid;
    v_job rpa_jobs;
begin
    -- 1) Make sure the order exists and get its store_id
    select o.store_id
    into v_store_id
    from orders o
    where o.id = p_order_id;

    if v_store_id is null then
        raise exception 'Order not found';
    end if;

    -- 2) Ensure the current user is an owner/manager of this store
    if not exists (
        select 1
        from store_users su
        where su.store_id = v_store_id
          and su.user_id = auth.uid()
          and su.role in ('owner','manager')
    ) then
        raise exception 'Not authorized to submit this order to MLCC';
    end if;

    -- 3) Ensure MLCC credentials exist for this store
    if not exists (
        select 1
        from store_mlcc_credentials c
        where c.store_id = v_store_id
    ) then
        raise exception 'MLCC credentials are not configured for this store';
    end if;

    -- 4) Update the order status to queued
    update orders
    set mlcc_submission_status = 'queued'
    where id = p_order_id;

    -- 5) Create the RPA job in pending status
    insert into rpa_jobs (store_id, order_id, job_type, status)
    values (v_store_id, p_order_id, 'submit_order', 'pending')
    returning * into v_job;

    -- 6) Log initial event for this job
    insert into rpa_job_events (job_id, event_type, info)
    values (v_job.id, 'created', '{}'::jsonb);

    -- 7) Return the created job row
    return v_job;
end;
$$;


ALTER FUNCTION public.submit_order_to_mlcc(p_order_id uuid) OWNER TO postgres;

--
-- Name: tg_set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.tg_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION public.tg_set_updated_at() OWNER TO postgres;

--
-- Name: upsert_mlcc_credentials(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'Missing/weak encryption key';
  end if;

  insert into public.store_mlcc_credentials (store_id, mlcc_email_enc, mlcc_password_enc)
  values (
    p_store_id,
    encode(pgp_sym_encrypt(p_email, p_key, 'cipher-algo=aes256'), 'base64'),
    encode(pgp_sym_encrypt(p_password, p_key, 'cipher-algo=aes256'), 'base64')
  )
  on conflict (store_id) do update set
    mlcc_email_enc = excluded.mlcc_email_enc,
    mlcc_password_enc = excluded.mlcc_password_enc,
    updated_at = now();
end;
$$;


ALTER FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) OWNER TO postgres;

--
-- Name: verify_order_pin(uuid, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.verify_order_pin(p_store_id uuid, p_pin text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  v_hash text;
  v_failed int;
  v_locked timestamptz;
  v_ok boolean := false;
begin
  if not exists (
    select 1 from public.store_users su
    where su.store_id = p_store_id and su.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  perform public.ensure_store_security(p_store_id);

  select order_pin_hash, pin_failed_attempts, pin_locked_until
    into v_hash, v_failed, v_locked
  from public.store_security
  where store_id = p_store_id;

  if v_locked is not null and v_locked > now() then
    return false;
  end if;

  if v_hash is null then
    return false;
  end if;

  v_ok := (crypt(p_pin, v_hash) = v_hash);

  if v_ok then
    update public.store_security
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where store_id = p_store_id;
    return true;
  else
    v_failed := coalesce(v_failed, 0) + 1;

    if v_failed >= 5 then
      update public.store_security
      set pin_failed_attempts = v_failed,
          pin_locked_until = now() + interval '15 minutes'
      where store_id = p_store_id;
    else
      update public.store_security
      set pin_failed_attempts = v_failed
      where store_id = p_store_id;
    end if;

    return false;
  end if;
end;
$$;


ALTER FUNCTION public.verify_order_pin(p_store_id uuid, p_pin text) OWNER TO postgres;

--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


ALTER FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) OWNER TO supabase_admin;

--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


ALTER FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) OWNER TO supabase_admin;

--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


ALTER FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) OWNER TO supabase_admin;

--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
    declare
      res jsonb;
    begin
      execute format('select to_jsonb(%L::'|| type_::text || ')', val)  into res;
      return res;
    end
    $$;


ALTER FUNCTION realtime."cast"(val text, type_ regtype) OWNER TO supabase_admin;

--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


ALTER FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) OWNER TO supabase_admin;

--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


ALTER FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) OWNER TO supabase_admin;

--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS SETOF realtime.wal_rls
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
      with pub as (
        select
          concat_ws(
            ',',
            case when bool_or(pubinsert) then 'insert' else null end,
            case when bool_or(pubupdate) then 'update' else null end,
            case when bool_or(pubdelete) then 'delete' else null end
          ) as w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
            ''
          ) w2j_add_tables
        from
          pg_publication pp
          left join pg_publication_tables ppt
            on pp.pubname = ppt.pubname
        where
          pp.pubname = publication
        group by
          pp.pubname
        limit 1
      ),
      w2j as (
        select
          x.*, pub.w2j_add_tables
        from
          pub,
          pg_logical_slot_get_changes(
            slot_name, null, max_changes,
            'include-pk', 'true',
            'include-transaction', 'false',
            'include-timestamp', 'true',
            'include-type-oids', 'true',
            'format-version', '2',
            'actions', pub.w2j_actions,
            'add-tables', pub.w2j_add_tables
          ) x
      )
      select
        xyz.wal,
        xyz.is_rls_enabled,
        xyz.subscription_ids,
        xyz.errors
      from
        w2j,
        realtime.apply_rls(
          wal := w2j.data::jsonb,
          max_record_bytes := max_record_bytes
        ) xyz(wal, is_rls_enabled, subscription_ids, errors)
      where
        w2j.w2j_add_tables <> ''
        and xyz.subscription_ids[1] is not null
    $$;


ALTER FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) OWNER TO supabase_admin;

--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


ALTER FUNCTION realtime.quote_wal2json(entity regclass) OWNER TO supabase_admin;

--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) OWNER TO supabase_admin;

--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


ALTER FUNCTION realtime.subscription_check_filters() OWNER TO supabase_admin;

--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


ALTER FUNCTION realtime.to_regrole(role_name text) OWNER TO supabase_admin;

--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


ALTER FUNCTION realtime.topic() OWNER TO supabase_realtime_admin;

--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) OWNER TO supabase_storage_admin;

--
-- Name: delete_leaf_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$$;


ALTER FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) OWNER TO supabase_storage_admin;

--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO supabase_storage_admin;

--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION storage.extension(name text) OWNER TO supabase_storage_admin;

--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


ALTER FUNCTION storage.filename(name text) OWNER TO supabase_storage_admin;

--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION storage.foldername(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) OWNER TO supabase_storage_admin;

--
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


ALTER FUNCTION storage.get_level(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


ALTER FUNCTION storage.get_prefix(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


ALTER FUNCTION storage.get_prefixes(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION storage.get_size_by_bucket() OWNER TO supabase_storage_admin;

--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) OWNER TO supabase_storage_admin;

--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text) OWNER TO supabase_storage_admin;

--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;

--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;

--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO supabase_storage_admin;

--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


ALTER FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO supabase_storage_admin;

--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE auth.audit_log_entries OWNER TO supabase_auth_admin;

--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


ALTER TABLE auth.custom_oauth_providers OWNER TO supabase_auth_admin;

--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


ALTER TABLE auth.flow_state OWNER TO supabase_auth_admin;

--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE auth.identities OWNER TO supabase_auth_admin;

--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE auth.instances OWNER TO supabase_auth_admin;

--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE auth.mfa_amr_claims OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


ALTER TABLE auth.mfa_challenges OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


ALTER TABLE auth.mfa_factors OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


ALTER TABLE auth.oauth_authorizations OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE auth.oauth_client_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


ALTER TABLE auth.oauth_clients OWNER TO supabase_auth_admin;

--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


ALTER TABLE auth.oauth_consents OWNER TO supabase_auth_admin;

--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


ALTER TABLE auth.one_time_tokens OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


ALTER TABLE auth.refresh_tokens OWNER TO supabase_auth_admin;

--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: supabase_auth_admin
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: supabase_auth_admin
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


ALTER TABLE auth.saml_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


ALTER TABLE auth.saml_relay_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


ALTER TABLE auth.schema_migrations OWNER TO supabase_auth_admin;

--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


ALTER TABLE auth.sessions OWNER TO supabase_auth_admin;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


ALTER TABLE auth.sso_domains OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


ALTER TABLE auth.sso_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


ALTER TABLE auth.users OWNER TO supabase_auth_admin;

--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id uuid,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activity_logs OWNER TO postgres;

--
-- Name: ai_anomalies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_anomalies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    bottle_id uuid,
    entity_type text,
    entity_id uuid,
    anomaly_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    score numeric(5,4),
    description text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution_note text,
    metadata jsonb
);


ALTER TABLE public.ai_anomalies OWNER TO postgres;

--
-- Name: ai_chat_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    user_id uuid,
    title text,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_chat_sessions OWNER TO postgres;

--
-- Name: ai_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    store_id uuid,
    user_id uuid,
    role text NOT NULL,
    content text NOT NULL,
    metadata jsonb,
    tokens_input integer,
    tokens_output integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])))
);


ALTER TABLE public.ai_messages OWNER TO postgres;

--
-- Name: ai_predictions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text DEFAULT 'store'::text NOT NULL,
    store_id uuid,
    bottle_id uuid,
    target_type text NOT NULL,
    horizon_days integer NOT NULL,
    predicted_value numeric(20,6) NOT NULL,
    confidence numeric(5,4),
    run_id uuid,
    model_name text,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_predictions OWNER TO postgres;

--
-- Name: ai_recommendations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    bottle_id uuid,
    scope text DEFAULT 'store'::text NOT NULL,
    type text NOT NULL,
    title text,
    message text,
    action jsonb NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by_model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    acted_at timestamp with time zone,
    acted_by uuid,
    metadata jsonb
);


ALTER TABLE public.ai_recommendations OWNER TO postgres;

--
-- Name: ai_usage_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id uuid,
    session_id uuid,
    provider text DEFAULT 'openai'::text NOT NULL,
    model_name text,
    tokens_input integer,
    tokens_output integer,
    total_tokens integer,
    cost_usd numeric(10,4),
    latency_ms integer,
    success boolean DEFAULT true NOT NULL,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ai_usage_logs OWNER TO postgres;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: bottle_aliases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bottle_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bottle_id uuid NOT NULL,
    alias_type text NOT NULL,
    alias_value text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    store_id uuid,
    CONSTRAINT bottle_aliases_alias_type_check CHECK ((alias_type = ANY (ARRAY['mlcc_code'::text, 'upc'::text, 'sku'::text, 'plu'::text, 'other'::text])))
);


ALTER TABLE public.bottle_aliases OWNER TO postgres;

--
-- Name: bottles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bottles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    mlcc_code text NOT NULL,
    image_url text,
    size text,
    category text,
    state_min_price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    upc text,
    size_ml integer,
    subcategory text,
    abv numeric,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    mlcc_item_id uuid,
    store_id uuid,
    shelf_price numeric(10,2)
);


ALTER TABLE public.bottles OWNER TO postgres;

--
-- Name: device_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.device_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id uuid NOT NULL,
    device_id text NOT NULL,
    device_type text,
    platform text,
    app_version text,
    last_ip text,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked boolean DEFAULT false NOT NULL
);


ALTER TABLE public.device_sessions OWNER TO postgres;

--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id uuid,
    location text,
    message text NOT NULL,
    stack_trace text,
    severity text DEFAULT 'error'::text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.error_logs OWNER TO postgres;

--
-- Name: inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    bottle_id uuid,
    quantity integer DEFAULT 0,
    low_stock_threshold integer DEFAULT 5,
    updated_at timestamp with time zone DEFAULT now(),
    shelf_price numeric,
    cost numeric,
    par_level integer,
    location_note text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reorder_point integer,
    reorder_quantity integer,
    last_counted_at timestamp with time zone,
    location text
);


ALTER TABLE public.inventory OWNER TO postgres;

--
-- Name: lk_chat_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lk_chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])))
);


ALTER TABLE public.lk_chat_messages OWNER TO postgres;

--
-- Name: lk_chat_threads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_chat_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    created_by uuid NOT NULL,
    title text DEFAULT 'New chat'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_chat_threads OWNER TO postgres;

--
-- Name: lk_order_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_order_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    intent_id uuid NOT NULL,
    store_id uuid NOT NULL,
    level text DEFAULT 'INFO'::text NOT NULL,
    event_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_order_events OWNER TO postgres;

--
-- Name: lk_order_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_order_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.lk_order_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lk_order_intents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_order_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    created_by uuid NOT NULL,
    status text DEFAULT 'CREATED'::text NOT NULL,
    idempotency_key text NOT NULL,
    requested_items jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_order_intents OWNER TO postgres;

--
-- Name: lk_order_proofs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_order_proofs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    intent_id uuid NOT NULL,
    store_id uuid NOT NULL,
    stage text NOT NULL,
    proof_hash text NOT NULL,
    proof_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_order_proofs OWNER TO postgres;

--
-- Name: lk_order_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_order_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    intent_id uuid NOT NULL,
    store_id uuid NOT NULL,
    state text DEFAULT 'CREATED'::text NOT NULL,
    is_submit_armed boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


ALTER TABLE public.lk_order_runs OWNER TO postgres;

--
-- Name: lk_seed_mlcc_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_seed_mlcc_codes (
    store_id uuid NOT NULL,
    mlcc_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_seed_mlcc_codes OWNER TO postgres;

--
-- Name: lk_system_diagnostics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lk_system_diagnostics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    run_by_user_id uuid,
    source text DEFAULT 'lk_doctor'::text NOT NULL,
    app_version text,
    git_commit text,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lk_system_diagnostics OWNER TO postgres;

--
-- Name: login_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    store_id uuid,
    success boolean NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.login_events OWNER TO postgres;

--
-- Name: mlcc_change_rows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_change_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    liquor_code text,
    change_type text NOT NULL,
    raw jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.mlcc_change_rows OWNER TO postgres;

--
-- Name: mlcc_code_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_code_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    liquor_code text NOT NULL,
    bottle_id uuid,
    fingerprint text,
    valid_from date NOT NULL,
    valid_to date,
    source_snapshot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.mlcc_code_map OWNER TO postgres;

--
-- Name: mlcc_item_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_item_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mlcc_item_id uuid NOT NULL,
    mlcc_code text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mlcc_code_nonempty CHECK ((length(TRIM(BOTH FROM mlcc_code)) > 0))
);


ALTER TABLE public.mlcc_item_codes OWNER TO postgres;

--
-- Name: mlcc_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_items (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    size_ml integer,
    category text,
    subcategory text,
    abv numeric,
    state_min_price numeric,
    updated_at timestamp with time zone DEFAULT '2025-12-06 16:57:00.807485+00'::timestamp with time zone NOT NULL,
    mlcc_item_no text NOT NULL
);


ALTER TABLE public.mlcc_items OWNER TO postgres;

--
-- Name: mlcc_price_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_price_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mlcc_item_id uuid NOT NULL,
    state_min_price numeric NOT NULL,
    retail_price numeric,
    effective_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'mlcc'::text NOT NULL
);


ALTER TABLE public.mlcc_price_snapshots OWNER TO postgres;

--
-- Name: mlcc_pricebook_rows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_pricebook_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    liquor_code text NOT NULL,
    brand_name text,
    proof numeric,
    size_ml integer,
    pack integer,
    ada_number text,
    mi_flag boolean,
    base_price numeric,
    licensee_price numeric,
    min_shelf_price numeric,
    new_chng text,
    raw jsonb,
    row_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.mlcc_pricebook_rows OWNER TO postgres;

--
-- Name: mlcc_pricebook_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_pricebook_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    effective_date date NOT NULL,
    source_kind text NOT NULL,
    source_label text NOT NULL,
    source_url text,
    file_sha256 text,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mlcc_pricebook_snapshots_source_kind_check CHECK ((source_kind = ANY (ARRAY['price_book'::text, 'new_items'::text, 'ada_changes'::text, 'retail_price_changes'::text, 'mi_manufacturers'::text])))
);


ALTER TABLE public.mlcc_pricebook_snapshots OWNER TO postgres;

--
-- Name: mlcc_qty_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mlcc_qty_rules (
    bottle_id uuid NOT NULL,
    ladder integer[] NOT NULL,
    learned_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confidence real DEFAULT 0.70 NOT NULL,
    product_text text,
    name text,
    size_ml integer,
    source text DEFAULT 'rpa'::text NOT NULL
);


ALTER TABLE public.mlcc_qty_rules OWNER TO postgres;

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    store_id uuid,
    type text NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notification_preferences OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    user_id uuid,
    type text NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    bottle_id uuid,
    quantity integer NOT NULL,
    price numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: order_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    items_json jsonb NOT NULL,
    created_from_order_id uuid,
    last_used_at timestamp with time zone,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.order_templates OWNER TO postgres;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid,
    status text DEFAULT 'pending'::text,
    submitted_to_mlcc boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    created_by uuid,
    submitted_at timestamp with time zone,
    total_items integer,
    total_cost numeric(10,2),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mlcc_submission_status text DEFAULT 'not_submitted'::text,
    mlcc_confirmation_code text,
    mlcc_last_submitted_at timestamp with time zone,
    rpa_status text DEFAULT 'idle'::text NOT NULL,
    rpa_locked_at timestamp with time zone,
    rpa_worker_id text,
    rpa_attempts integer DEFAULT 0 NOT NULL,
    rpa_last_error text,
    mlcc_confirmation_no text,
    mlcc_submitted_at timestamp with time zone,
    CONSTRAINT orders_mlcc_submission_status_check CHECK ((mlcc_submission_status = ANY (ARRAY['not_submitted'::text, 'queued'::text, 'submitting'::text, 'submitted'::text, 'failed'::text])))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: price_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.price_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bottle_id uuid,
    old_price numeric,
    new_price numeric,
    changed_at timestamp without time zone DEFAULT now(),
    store_id uuid,
    mlcc_item_id uuid,
    change_type text,
    source text DEFAULT 'system'::text NOT NULL,
    created_by uuid
);


ALTER TABLE public.price_alerts OWNER TO postgres;

--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    store_id uuid,
    device_id text NOT NULL,
    endpoint text NOT NULL,
    platform text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked boolean DEFAULT false NOT NULL
);


ALTER TABLE public.push_subscriptions OWNER TO postgres;

--
-- Name: rpa_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rpa_events (
    id bigint NOT NULL,
    run_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    level text DEFAULT 'info'::text NOT NULL,
    step text NOT NULL,
    message text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.rpa_events OWNER TO postgres;

--
-- Name: rpa_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rpa_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rpa_events_id_seq OWNER TO postgres;

--
-- Name: rpa_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rpa_events_id_seq OWNED BY public.rpa_events.id;


--
-- Name: rpa_job_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rpa_job_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    event_type text NOT NULL,
    info jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rpa_job_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'picked_up'::text, 'login_started'::text, 'login_succeeded'::text, 'login_failed'::text, 'order_page_loaded'::text, 'line_item_entered'::text, 'submission_succeeded'::text, 'submission_failed'::text, 'retry_scheduled'::text, 'cancelled'::text])))
);


ALTER TABLE public.rpa_job_events OWNER TO postgres;

--
-- Name: rpa_job_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rpa_job_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    code text NOT NULL,
    qty integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rpa_job_items_qty_check CHECK ((qty > 0))
);


ALTER TABLE public.rpa_job_items OWNER TO postgres;

--
-- Name: rpa_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rpa_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    worker_id text,
    attempt integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    mlcc_confirmation_no text,
    mlcc_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_code text,
    error_message text
);


ALTER TABLE public.rpa_runs OWNER TO postgres;

--
-- Name: scan_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.scan_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    user_id uuid,
    bottle_id uuid,
    upc text NOT NULL,
    result text NOT NULL,
    source text DEFAULT 'mobile_app'::text NOT NULL,
    meta jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scan_logs OWNER TO postgres;

--
-- Name: scheduled_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.scheduled_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    schedule text NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scheduled_jobs OWNER TO postgres;

--
-- Name: store_bottle_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_bottle_notes (
    store_id uuid NOT NULL,
    bottle_id uuid NOT NULL,
    store_price numeric,
    shelf_location text,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_bottle_notes OWNER TO postgres;

--
-- Name: store_mlcc_credentials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_mlcc_credentials (
    store_id uuid NOT NULL,
    encrypted_username text NOT NULL,
    encrypted_password text NOT NULL,
    last_verified_at timestamp with time zone,
    last_failed_at timestamp with time zone,
    last_failed_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_mlcc_credentials OWNER TO postgres;

--
-- Name: store_security; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_security (
    store_id uuid NOT NULL,
    order_pin_hash text,
    pin_failed_attempts integer DEFAULT 0 NOT NULL,
    pin_locked_until timestamp with time zone,
    pin_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_security OWNER TO postgres;

--
-- Name: store_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    invited_at timestamp with time zone,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_users OWNER TO postgres;

--
-- Name: stores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_name text,
    liquor_license text,
    created_at timestamp with time zone DEFAULT '2025-12-06 05:04:09.576924+00'::timestamp with time zone NOT NULL,
    mlcc_store_number text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    postal_code text,
    timezone text,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT '2025-12-06 05:01:19.346576+00'::timestamp with time zone,
    mlcc_username text,
    mlcc_password_encrypted text
);


ALTER TABLE public.stores OWNER TO postgres;

--
-- Name: submission_intents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.submission_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid NOT NULL,
    request_fingerprint_hash text NOT NULL,
    created_by uuid DEFAULT auth.uid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:02:00'::interval) NOT NULL,
    used_at timestamp with time zone,
    used_by text,
    evidence_path text
);


ALTER TABLE public.submission_intents OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    store_id uuid,
    role text DEFAULT 'owner'::text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


ALTER TABLE realtime.messages OWNER TO supabase_realtime_admin;

--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


ALTER TABLE realtime.schema_migrations OWNER TO supabase_admin;

--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


ALTER TABLE realtime.subscription OWNER TO supabase_admin;

--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;

--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE storage.buckets_analytics OWNER TO supabase_storage_admin;

--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.buckets_vectors OWNER TO supabase_storage_admin;

--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE storage.migrations OWNER TO supabase_storage_admin;

--
-- Name: objects; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


ALTER TABLE storage.s3_multipart_uploads OWNER TO supabase_storage_admin;

--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.s3_multipart_uploads_parts OWNER TO supabase_storage_admin;

--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.vector_indexes OWNER TO supabase_storage_admin;

--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: rpa_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_events ALTER COLUMN id SET DEFAULT nextval('public.rpa_events_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_anomalies ai_anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_anomalies
    ADD CONSTRAINT ai_anomalies_pkey PRIMARY KEY (id);


--
-- Name: ai_chat_sessions ai_chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_chat_sessions
    ADD CONSTRAINT ai_chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: ai_messages ai_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_pkey PRIMARY KEY (id);


--
-- Name: ai_predictions ai_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_predictions
    ADD CONSTRAINT ai_predictions_pkey PRIMARY KEY (id);


--
-- Name: ai_recommendations ai_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_recommendations
    ADD CONSTRAINT ai_recommendations_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_logs ai_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: bottle_aliases bottle_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottle_aliases
    ADD CONSTRAINT bottle_aliases_pkey PRIMARY KEY (id);


--
-- Name: bottles bottles_mlcc_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_mlcc_code_key UNIQUE (mlcc_code);


--
-- Name: bottles bottles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_pkey PRIMARY KEY (id);


--
-- Name: bottles bottles_store_upc_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_store_upc_unique UNIQUE (store_id, upc);


--
-- Name: device_sessions device_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_pkey PRIMARY KEY (id);


--
-- Name: device_sessions device_sessions_user_device_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_user_device_unique UNIQUE (user_id, device_id);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_bottle_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_bottle_unique UNIQUE (bottle_id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: lk_chat_messages lk_chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_messages
    ADD CONSTRAINT lk_chat_messages_pkey PRIMARY KEY (id);


--
-- Name: lk_chat_threads lk_chat_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_threads
    ADD CONSTRAINT lk_chat_threads_pkey PRIMARY KEY (id);


--
-- Name: lk_order_events lk_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_events
    ADD CONSTRAINT lk_order_events_pkey PRIMARY KEY (id);


--
-- Name: lk_order_intents lk_order_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_intents
    ADD CONSTRAINT lk_order_intents_pkey PRIMARY KEY (id);


--
-- Name: lk_order_proofs lk_order_proofs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_proofs
    ADD CONSTRAINT lk_order_proofs_pkey PRIMARY KEY (id);


--
-- Name: lk_order_runs lk_order_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_runs
    ADD CONSTRAINT lk_order_runs_pkey PRIMARY KEY (id);


--
-- Name: lk_seed_mlcc_codes lk_seed_mlcc_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_seed_mlcc_codes
    ADD CONSTRAINT lk_seed_mlcc_codes_pkey PRIMARY KEY (store_id, mlcc_code);


--
-- Name: lk_system_diagnostics lk_system_diagnostics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_system_diagnostics
    ADD CONSTRAINT lk_system_diagnostics_pkey PRIMARY KEY (id);


--
-- Name: login_events login_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_pkey PRIMARY KEY (id);


--
-- Name: mlcc_change_rows mlcc_change_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_change_rows
    ADD CONSTRAINT mlcc_change_rows_pkey PRIMARY KEY (id);


--
-- Name: mlcc_code_map mlcc_code_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_code_map
    ADD CONSTRAINT mlcc_code_map_pkey PRIMARY KEY (id);


--
-- Name: mlcc_item_codes mlcc_item_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_item_codes
    ADD CONSTRAINT mlcc_item_codes_pkey PRIMARY KEY (id);


--
-- Name: mlcc_items mlcc_items_mlcc_item_no_uk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_items
    ADD CONSTRAINT mlcc_items_mlcc_item_no_uk UNIQUE (mlcc_item_no);


--
-- Name: mlcc_items mlcc_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_items
    ADD CONSTRAINT mlcc_items_pkey PRIMARY KEY (id);


--
-- Name: mlcc_price_snapshots mlcc_price_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_price_snapshots
    ADD CONSTRAINT mlcc_price_snapshots_pkey PRIMARY KEY (id);


--
-- Name: mlcc_price_snapshots mlcc_price_snapshots_unique_item_date_source; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_price_snapshots
    ADD CONSTRAINT mlcc_price_snapshots_unique_item_date_source UNIQUE (mlcc_item_id, effective_date, source);


--
-- Name: mlcc_pricebook_rows mlcc_pricebook_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_pricebook_rows
    ADD CONSTRAINT mlcc_pricebook_rows_pkey PRIMARY KEY (id);


--
-- Name: mlcc_pricebook_rows mlcc_pricebook_rows_snapshot_id_liquor_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_pricebook_rows
    ADD CONSTRAINT mlcc_pricebook_rows_snapshot_id_liquor_code_key UNIQUE (snapshot_id, liquor_code);


--
-- Name: mlcc_pricebook_snapshots mlcc_pricebook_snapshots_effective_date_source_kind_source__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_pricebook_snapshots
    ADD CONSTRAINT mlcc_pricebook_snapshots_effective_date_source_kind_source__key UNIQUE (effective_date, source_kind, source_label);


--
-- Name: mlcc_pricebook_snapshots mlcc_pricebook_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_pricebook_snapshots
    ADD CONSTRAINT mlcc_pricebook_snapshots_pkey PRIMARY KEY (id);


--
-- Name: mlcc_qty_rules mlcc_qty_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_qty_rules
    ADD CONSTRAINT mlcc_qty_rules_pkey PRIMARY KEY (bottle_id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_prefs_user_store_type_channel_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_prefs_user_store_type_channel_unique UNIQUE (user_id, store_id, type, channel);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_order_bottle_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_bottle_unique UNIQUE (order_id, bottle_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_templates order_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_templates
    ADD CONSTRAINT order_templates_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: price_alerts price_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_user_device_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_device_unique UNIQUE (user_id, device_id, endpoint);


--
-- Name: rpa_events rpa_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_events
    ADD CONSTRAINT rpa_events_pkey PRIMARY KEY (id);


--
-- Name: rpa_job_events rpa_job_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_job_events
    ADD CONSTRAINT rpa_job_events_pkey PRIMARY KEY (id);


--
-- Name: rpa_job_items rpa_job_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_job_items
    ADD CONSTRAINT rpa_job_items_pkey PRIMARY KEY (id);


--
-- Name: rpa_jobs rpa_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_jobs
    ADD CONSTRAINT rpa_jobs_pkey PRIMARY KEY (id);


--
-- Name: rpa_runs rpa_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_runs
    ADD CONSTRAINT rpa_runs_pkey PRIMARY KEY (id);


--
-- Name: scan_logs scan_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scan_logs
    ADD CONSTRAINT scan_logs_pkey PRIMARY KEY (id);


--
-- Name: scheduled_jobs scheduled_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scheduled_jobs
    ADD CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id);


--
-- Name: store_bottle_notes store_bottle_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bottle_notes
    ADD CONSTRAINT store_bottle_notes_pkey PRIMARY KEY (store_id, bottle_id);


--
-- Name: store_mlcc_credentials store_mlcc_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_mlcc_credentials
    ADD CONSTRAINT store_mlcc_credentials_pkey PRIMARY KEY (store_id);


--
-- Name: store_security store_security_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_security
    ADD CONSTRAINT store_security_pkey PRIMARY KEY (store_id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: submission_intents submission_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_intents
    ADD CONSTRAINT submission_intents_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: bottle_aliases_active_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX bottle_aliases_active_unique ON public.bottle_aliases USING btree (store_id, alias_value) WHERE ((valid_to IS NULL) AND (alias_value IS NOT NULL));


--
-- Name: bottle_aliases_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bottle_aliases_lookup ON public.bottle_aliases USING btree (alias_type, alias_value);


--
-- Name: bottle_aliases_one_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX bottle_aliases_one_active ON public.bottle_aliases USING btree (alias_type, alias_value) WHERE (valid_to IS NULL);


--
-- Name: bottles_mlcc_item_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bottles_mlcc_item_id_idx ON public.bottles USING btree (mlcc_item_id);


--
-- Name: bottles_name_trgm_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX bottles_name_trgm_idx ON public.bottles USING gin (name public.gin_trgm_ops);


--
-- Name: idx_activity_logs_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_logs_action ON public.activity_logs USING btree (action);


--
-- Name: idx_activity_logs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_logs_created_at ON public.activity_logs USING btree (created_at);


--
-- Name: idx_activity_logs_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_logs_store_id ON public.activity_logs USING btree (store_id);


--
-- Name: idx_activity_logs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activity_logs_user_id ON public.activity_logs USING btree (user_id);


--
-- Name: idx_ai_anomalies_anomaly_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_anomalies_anomaly_type ON public.ai_anomalies USING btree (anomaly_type);


--
-- Name: idx_ai_anomalies_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_anomalies_bottle_id ON public.ai_anomalies USING btree (bottle_id);


--
-- Name: idx_ai_anomalies_detected_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_anomalies_detected_at ON public.ai_anomalies USING btree (detected_at);


--
-- Name: idx_ai_anomalies_severity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_anomalies_severity ON public.ai_anomalies USING btree (severity);


--
-- Name: idx_ai_anomalies_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_anomalies_store_id ON public.ai_anomalies USING btree (store_id);


--
-- Name: idx_ai_chat_sessions_last_message_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_chat_sessions_last_message_at ON public.ai_chat_sessions USING btree (last_message_at);


--
-- Name: idx_ai_chat_sessions_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_chat_sessions_store_id ON public.ai_chat_sessions USING btree (store_id);


--
-- Name: idx_ai_chat_sessions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_chat_sessions_user_id ON public.ai_chat_sessions USING btree (user_id);


--
-- Name: idx_ai_messages_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_messages_created_at ON public.ai_messages USING btree (created_at);


--
-- Name: idx_ai_messages_session_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_messages_session_id ON public.ai_messages USING btree (session_id);


--
-- Name: idx_ai_messages_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_messages_store_id ON public.ai_messages USING btree (store_id);


--
-- Name: idx_ai_messages_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_messages_user_id ON public.ai_messages USING btree (user_id);


--
-- Name: idx_ai_predictions_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_predictions_bottle_id ON public.ai_predictions USING btree (bottle_id);


--
-- Name: idx_ai_predictions_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_predictions_created_at ON public.ai_predictions USING btree (created_at);


--
-- Name: idx_ai_predictions_scope; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_predictions_scope ON public.ai_predictions USING btree (scope);


--
-- Name: idx_ai_predictions_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_predictions_store_id ON public.ai_predictions USING btree (store_id);


--
-- Name: idx_ai_predictions_target_horizon; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_predictions_target_horizon ON public.ai_predictions USING btree (target_type, horizon_days);


--
-- Name: idx_ai_recommendations_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_recommendations_bottle_id ON public.ai_recommendations USING btree (bottle_id);


--
-- Name: idx_ai_recommendations_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_recommendations_created_at ON public.ai_recommendations USING btree (created_at);


--
-- Name: idx_ai_recommendations_priority; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_recommendations_priority ON public.ai_recommendations USING btree (priority);


--
-- Name: idx_ai_recommendations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_recommendations_status ON public.ai_recommendations USING btree (status);


--
-- Name: idx_ai_recommendations_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_recommendations_store_id ON public.ai_recommendations USING btree (store_id);


--
-- Name: idx_ai_usage_logs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_logs_created_at ON public.ai_usage_logs USING btree (created_at);


--
-- Name: idx_ai_usage_logs_model_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_logs_model_name ON public.ai_usage_logs USING btree (model_name);


--
-- Name: idx_ai_usage_logs_session_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_logs_session_id ON public.ai_usage_logs USING btree (session_id);


--
-- Name: idx_ai_usage_logs_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_logs_store_id ON public.ai_usage_logs USING btree (store_id);


--
-- Name: idx_ai_usage_logs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ai_usage_logs_user_id ON public.ai_usage_logs USING btree (user_id);


--
-- Name: idx_bottles_mlcc_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bottles_mlcc_item_id ON public.bottles USING btree (mlcc_item_id);


--
-- Name: idx_bottles_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bottles_store_id ON public.bottles USING btree (store_id);


--
-- Name: idx_device_sessions_last_active_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_sessions_last_active_at ON public.device_sessions USING btree (last_active_at);


--
-- Name: idx_device_sessions_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_sessions_store_id ON public.device_sessions USING btree (store_id);


--
-- Name: idx_device_sessions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_device_sessions_user_id ON public.device_sessions USING btree (user_id);


--
-- Name: idx_error_logs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_error_logs_created_at ON public.error_logs USING btree (created_at);


--
-- Name: idx_error_logs_severity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_error_logs_severity ON public.error_logs USING btree (severity);


--
-- Name: idx_error_logs_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_error_logs_store_id ON public.error_logs USING btree (store_id);


--
-- Name: idx_error_logs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_error_logs_user_id ON public.error_logs USING btree (user_id);


--
-- Name: idx_inventory_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_bottle_id ON public.inventory USING btree (bottle_id);


--
-- Name: idx_login_events_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_events_created_at ON public.login_events USING btree (created_at);


--
-- Name: idx_login_events_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_events_store_id ON public.login_events USING btree (store_id);


--
-- Name: idx_login_events_success; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_events_success ON public.login_events USING btree (success);


--
-- Name: idx_login_events_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_login_events_user_id ON public.login_events USING btree (user_id);


--
-- Name: idx_notification_prefs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notification_prefs_user_id ON public.notification_preferences USING btree (user_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at);


--
-- Name: idx_notifications_read_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_read_at ON public.notifications USING btree (read_at);


--
-- Name: idx_notifications_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_store_id ON public.notifications USING btree (store_id);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_order_items_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_bottle_id ON public.order_items USING btree (bottle_id);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_orders_created_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_created_by ON public.orders USING btree (created_by);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_store_id ON public.orders USING btree (store_id);


--
-- Name: idx_orders_submitted_to_mlcc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_submitted_to_mlcc ON public.orders USING btree (submitted_to_mlcc);


--
-- Name: idx_price_alerts_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_alerts_bottle_id ON public.price_alerts USING btree (bottle_id);


--
-- Name: idx_price_alerts_changed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_alerts_changed_at ON public.price_alerts USING btree (changed_at);


--
-- Name: idx_price_alerts_mlcc_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_alerts_mlcc_item_id ON public.price_alerts USING btree (mlcc_item_id);


--
-- Name: idx_price_alerts_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_price_alerts_store_id ON public.price_alerts USING btree (store_id);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_rpa_job_events_job_id_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rpa_job_events_job_id_created_at ON public.rpa_job_events USING btree (job_id, created_at);


--
-- Name: idx_rpa_jobs_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rpa_jobs_order_id ON public.rpa_jobs USING btree (order_id);


--
-- Name: idx_rpa_jobs_status_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rpa_jobs_status_created_at ON public.rpa_jobs USING btree (status, created_at);


--
-- Name: idx_rpa_jobs_store_id_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rpa_jobs_store_id_created_at ON public.rpa_jobs USING btree (store_id, created_at DESC);


--
-- Name: idx_scan_logs_bottle_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scan_logs_bottle_id ON public.scan_logs USING btree (bottle_id);


--
-- Name: idx_scan_logs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scan_logs_created_at ON public.scan_logs USING btree (created_at);


--
-- Name: idx_scan_logs_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scan_logs_store_id ON public.scan_logs USING btree (store_id);


--
-- Name: idx_scan_logs_upc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scan_logs_upc ON public.scan_logs USING btree (upc);


--
-- Name: idx_scan_logs_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scan_logs_user_id ON public.scan_logs USING btree (user_id);


--
-- Name: idx_scheduled_jobs_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scheduled_jobs_active ON public.scheduled_jobs USING btree (active);


--
-- Name: idx_scheduled_jobs_next_run_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_scheduled_jobs_next_run_at ON public.scheduled_jobs USING btree (next_run_at);


--
-- Name: idx_store_mlcc_credentials_store_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_store_mlcc_credentials_store_id ON public.store_mlcc_credentials USING btree (store_id);


--
-- Name: inventory_bottle_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_bottle_id_idx ON public.inventory USING btree (bottle_id);


--
-- Name: inventory_store_bottle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_store_bottle_idx ON public.inventory USING btree (store_id, bottle_id);


--
-- Name: inventory_store_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX inventory_store_id_idx ON public.inventory USING btree (store_id);


--
-- Name: lk_chat_messages_thread_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_chat_messages_thread_created_at ON public.lk_chat_messages USING btree (thread_id, created_at);


--
-- Name: lk_chat_threads_store_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_chat_threads_store_created_at ON public.lk_chat_threads USING btree (store_id, created_at DESC);


--
-- Name: lk_order_events_intent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_order_events_intent_idx ON public.lk_order_events USING btree (intent_id);


--
-- Name: lk_order_events_run_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_order_events_run_idx ON public.lk_order_events USING btree (run_id);


--
-- Name: lk_order_intents_store_idempotency_uidx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX lk_order_intents_store_idempotency_uidx ON public.lk_order_intents USING btree (store_id, idempotency_key);


--
-- Name: lk_order_proofs_run_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_order_proofs_run_idx ON public.lk_order_proofs USING btree (run_id);


--
-- Name: lk_order_runs_intent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX lk_order_runs_intent_idx ON public.lk_order_runs USING btree (intent_id);


--
-- Name: mlcc_change_rows_code_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_change_rows_code_idx ON public.mlcc_change_rows USING btree (liquor_code);


--
-- Name: mlcc_code_map_active_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mlcc_code_map_active_unique ON public.mlcc_code_map USING btree (liquor_code) WHERE (valid_to IS NULL);


--
-- Name: mlcc_item_codes_code_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_item_codes_code_idx ON public.mlcc_item_codes USING btree (mlcc_code);


--
-- Name: mlcc_item_codes_item_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_item_codes_item_idx ON public.mlcc_item_codes USING btree (mlcc_item_id);


--
-- Name: mlcc_item_codes_one_active_per_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mlcc_item_codes_one_active_per_code ON public.mlcc_item_codes USING btree (mlcc_code) WHERE (valid_to IS NULL);


--
-- Name: mlcc_items_code_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mlcc_items_code_unique ON public.mlcc_items USING btree (code);


--
-- Name: mlcc_price_snapshots_item_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_price_snapshots_item_date ON public.mlcc_price_snapshots USING btree (mlcc_item_id, effective_date DESC);


--
-- Name: mlcc_price_snapshots_item_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_price_snapshots_item_date_idx ON public.mlcc_price_snapshots USING btree (mlcc_item_id, effective_date DESC, created_at DESC);


--
-- Name: mlcc_price_snapshots_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX mlcc_price_snapshots_unique ON public.mlcc_price_snapshots USING btree (mlcc_item_id, effective_date);


--
-- Name: mlcc_pricebook_rows_liquor_code_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX mlcc_pricebook_rows_liquor_code_idx ON public.mlcc_pricebook_rows USING btree (liquor_code);


--
-- Name: order_items_order_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);


--
-- Name: order_templates_store_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX order_templates_store_idx ON public.order_templates USING btree (store_id);


--
-- Name: orders_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_created_at_idx ON public.orders USING btree (created_at DESC);


--
-- Name: orders_store_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX orders_store_id_idx ON public.orders USING btree (store_id);


--
-- Name: rpa_events_run_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_events_run_id_idx ON public.rpa_events USING btree (run_id, created_at);


--
-- Name: rpa_job_items_job_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_job_items_job_idx ON public.rpa_job_items USING btree (job_id);


--
-- Name: rpa_jobs_status_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_jobs_status_created_idx ON public.rpa_jobs USING btree (status, created_at);


--
-- Name: rpa_jobs_worker_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_jobs_worker_id_idx ON public.rpa_jobs USING btree (worker_id);


--
-- Name: rpa_runs_order_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_runs_order_id_idx ON public.rpa_runs USING btree (order_id);


--
-- Name: rpa_runs_started_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX rpa_runs_started_at_idx ON public.rpa_runs USING btree (started_at DESC);


--
-- Name: store_security_locked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX store_security_locked_idx ON public.store_security USING btree (pin_locked_until);


--
-- Name: store_users_store_user_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX store_users_store_user_unique ON public.store_users USING btree (store_id, user_id);


--
-- Name: submission_intents_expiry_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX submission_intents_expiry_idx ON public.submission_intents USING btree (expires_at);


--
-- Name: submission_intents_lookup_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX submission_intents_lookup_idx ON public.submission_intents USING btree (store_id, order_id);


--
-- Name: submission_intents_used_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX submission_intents_used_idx ON public.submission_intents USING btree (used_at);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: order_templates order_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER order_templates_set_updated_at BEFORE UPDATE ON public.order_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: store_security store_security_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER store_security_set_updated_at BEFORE UPDATE ON public.store_security FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


--
-- Name: store_mlcc_credentials trg_store_mlcc_credentials_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_store_mlcc_credentials_updated_at BEFORE UPDATE ON public.store_mlcc_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: mlcc_qty_rules trg_touch_mlcc_qty_rules; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_touch_mlcc_qty_rules BEFORE UPDATE ON public.mlcc_qty_rules FOR EACH ROW EXECUTE FUNCTION public.lk_touch_mlcc_qty_rules_updated_at();


--
-- Name: store_bottle_notes trg_touch_store_bottle_notes; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_touch_store_bottle_notes BEFORE UPDATE ON public.store_bottle_notes FOR EACH ROW EXECUTE FUNCTION public.lk_touch_store_bottle_notes_updated_at();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: supabase_admin
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: activity_logs activity_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_anomalies ai_anomalies_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_anomalies
    ADD CONSTRAINT ai_anomalies_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE SET NULL;


--
-- Name: ai_anomalies ai_anomalies_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_anomalies
    ADD CONSTRAINT ai_anomalies_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_anomalies ai_anomalies_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_anomalies
    ADD CONSTRAINT ai_anomalies_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_chat_sessions ai_chat_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_chat_sessions
    ADD CONSTRAINT ai_chat_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_chat_sessions ai_chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_chat_sessions
    ADD CONSTRAINT ai_chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_messages ai_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE;


--
-- Name: ai_messages ai_messages_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_messages ai_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_messages
    ADD CONSTRAINT ai_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_predictions ai_predictions_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_predictions
    ADD CONSTRAINT ai_predictions_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE CASCADE;


--
-- Name: ai_predictions ai_predictions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_predictions
    ADD CONSTRAINT ai_predictions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_recommendations ai_recommendations_acted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_recommendations
    ADD CONSTRAINT ai_recommendations_acted_by_fkey FOREIGN KEY (acted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_recommendations ai_recommendations_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_recommendations
    ADD CONSTRAINT ai_recommendations_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE CASCADE;


--
-- Name: ai_recommendations ai_recommendations_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_recommendations
    ADD CONSTRAINT ai_recommendations_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(id) ON DELETE SET NULL;


--
-- Name: ai_usage_logs ai_usage_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: bottle_aliases bottle_aliases_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottle_aliases
    ADD CONSTRAINT bottle_aliases_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE CASCADE;


--
-- Name: bottles bottles_mlcc_item_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_mlcc_item_fk FOREIGN KEY (mlcc_item_id) REFERENCES public.mlcc_items(id);


--
-- Name: bottles bottles_mlcc_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_mlcc_item_id_fkey FOREIGN KEY (mlcc_item_id) REFERENCES public.mlcc_items(id) ON DELETE SET NULL;


--
-- Name: bottles bottles_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bottles
    ADD CONSTRAINT bottles_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: device_sessions device_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: device_sessions device_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.device_sessions
    ADD CONSTRAINT device_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: error_logs error_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: error_logs error_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: inventory inventory_bottle_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_bottle_fk FOREIGN KEY (bottle_id) REFERENCES public.bottles(id);


--
-- Name: inventory inventory_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id);


--
-- Name: inventory inventory_store_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_store_fk FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: inventory inventory_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: lk_chat_messages lk_chat_messages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_messages
    ADD CONSTRAINT lk_chat_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: lk_chat_messages lk_chat_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_messages
    ADD CONSTRAINT lk_chat_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.lk_chat_threads(id) ON DELETE CASCADE;


--
-- Name: lk_chat_threads lk_chat_threads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_threads
    ADD CONSTRAINT lk_chat_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: lk_chat_threads lk_chat_threads_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_chat_threads
    ADD CONSTRAINT lk_chat_threads_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: lk_order_events lk_order_events_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_events
    ADD CONSTRAINT lk_order_events_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES public.lk_order_intents(id) ON DELETE CASCADE;


--
-- Name: lk_order_events lk_order_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_events
    ADD CONSTRAINT lk_order_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.lk_order_runs(id) ON DELETE CASCADE;


--
-- Name: lk_order_proofs lk_order_proofs_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_proofs
    ADD CONSTRAINT lk_order_proofs_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES public.lk_order_intents(id) ON DELETE CASCADE;


--
-- Name: lk_order_proofs lk_order_proofs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_proofs
    ADD CONSTRAINT lk_order_proofs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.lk_order_runs(id) ON DELETE CASCADE;


--
-- Name: lk_order_runs lk_order_runs_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_order_runs
    ADD CONSTRAINT lk_order_runs_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES public.lk_order_intents(id) ON DELETE CASCADE;


--
-- Name: lk_seed_mlcc_codes lk_seed_mlcc_codes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lk_seed_mlcc_codes
    ADD CONSTRAINT lk_seed_mlcc_codes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: login_events login_events_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL;


--
-- Name: login_events login_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_events
    ADD CONSTRAINT login_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: mlcc_change_rows mlcc_change_rows_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_change_rows
    ADD CONSTRAINT mlcc_change_rows_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.mlcc_pricebook_snapshots(id) ON DELETE CASCADE;


--
-- Name: mlcc_code_map mlcc_code_map_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_code_map
    ADD CONSTRAINT mlcc_code_map_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE SET NULL;


--
-- Name: mlcc_code_map mlcc_code_map_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_code_map
    ADD CONSTRAINT mlcc_code_map_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.mlcc_pricebook_snapshots(id) ON DELETE SET NULL;


--
-- Name: mlcc_item_codes mlcc_item_codes_mlcc_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_item_codes
    ADD CONSTRAINT mlcc_item_codes_mlcc_item_id_fkey FOREIGN KEY (mlcc_item_id) REFERENCES public.mlcc_items(id) ON DELETE CASCADE;


--
-- Name: mlcc_price_snapshots mlcc_price_snapshots_mlcc_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_price_snapshots
    ADD CONSTRAINT mlcc_price_snapshots_mlcc_item_id_fkey FOREIGN KEY (mlcc_item_id) REFERENCES public.mlcc_items(id) ON DELETE RESTRICT;


--
-- Name: mlcc_pricebook_rows mlcc_pricebook_rows_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_pricebook_rows
    ADD CONSTRAINT mlcc_pricebook_rows_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.mlcc_pricebook_snapshots(id) ON DELETE CASCADE;


--
-- Name: mlcc_qty_rules mlcc_qty_rules_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mlcc_qty_rules
    ADD CONSTRAINT mlcc_qty_rules_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_templates order_templates_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_templates
    ADD CONSTRAINT order_templates_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: orders orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: price_alerts price_alerts_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id);


--
-- Name: price_alerts price_alerts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: price_alerts price_alerts_mlcc_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_mlcc_item_id_fkey FOREIGN KEY (mlcc_item_id) REFERENCES public.mlcc_items(id) ON DELETE SET NULL;


--
-- Name: price_alerts price_alerts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.price_alerts
    ADD CONSTRAINT price_alerts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: rpa_events rpa_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_events
    ADD CONSTRAINT rpa_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.rpa_runs(id) ON DELETE CASCADE;


--
-- Name: rpa_job_events rpa_job_events_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_job_events
    ADD CONSTRAINT rpa_job_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.rpa_jobs(id) ON DELETE CASCADE;


--
-- Name: rpa_job_items rpa_job_items_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_job_items
    ADD CONSTRAINT rpa_job_items_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.rpa_jobs(id) ON DELETE CASCADE;


--
-- Name: rpa_jobs rpa_jobs_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_jobs
    ADD CONSTRAINT rpa_jobs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: rpa_jobs rpa_jobs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_jobs
    ADD CONSTRAINT rpa_jobs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: rpa_runs rpa_runs_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rpa_runs
    ADD CONSTRAINT rpa_runs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: scan_logs scan_logs_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scan_logs
    ADD CONSTRAINT scan_logs_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE SET NULL;


--
-- Name: scan_logs scan_logs_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scan_logs
    ADD CONSTRAINT scan_logs_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: scan_logs scan_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scan_logs
    ADD CONSTRAINT scan_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: store_bottle_notes store_bottle_notes_bottle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bottle_notes
    ADD CONSTRAINT store_bottle_notes_bottle_id_fkey FOREIGN KEY (bottle_id) REFERENCES public.bottles(id) ON DELETE CASCADE;


--
-- Name: store_bottle_notes store_bottle_notes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_bottle_notes
    ADD CONSTRAINT store_bottle_notes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_mlcc_credentials store_mlcc_credentials_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_mlcc_credentials
    ADD CONSTRAINT store_mlcc_credentials_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_security store_security_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_security
    ADD CONSTRAINT store_security_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: submission_intents submission_intents_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_intents
    ADD CONSTRAINT submission_intents_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: users users_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_anomalies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_anomalies ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_anomalies ai_anomalies_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_anomalies_select ON public.ai_anomalies FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_anomalies.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: ai_anomalies ai_anomalies_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_anomalies_update ON public.ai_anomalies FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_anomalies.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_anomalies.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: ai_chat_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_chat_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_chat_sessions ai_chat_sessions_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_chat_sessions_delete ON public.ai_chat_sessions FOR DELETE USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_chat_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: ai_chat_sessions ai_chat_sessions_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_chat_sessions_insert ON public.ai_chat_sessions FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_chat_sessions.store_id) AND (su.user_id = auth.uid()))))));


--
-- Name: ai_chat_sessions ai_chat_sessions_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_chat_sessions_select ON public.ai_chat_sessions FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_chat_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: ai_chat_sessions ai_chat_sessions_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_chat_sessions_update ON public.ai_chat_sessions FOR UPDATE USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_chat_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text)))))) WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_chat_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: ai_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_messages ai_messages_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_messages_insert ON public.ai_messages FOR INSERT WITH CHECK (((role = 'user'::text) AND (user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_messages.session_id) AND ((s.user_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.store_users su
          WHERE ((su.store_id = s.store_id) AND (su.user_id = auth.uid()))))))))));


--
-- Name: ai_messages ai_messages_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_messages_select ON public.ai_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_messages.session_id) AND ((s.user_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.store_users su
          WHERE ((su.store_id = s.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text)))))))));


--
-- Name: ai_predictions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_predictions ai_predictions_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_predictions_select ON public.ai_predictions FOR SELECT USING (((store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_predictions.store_id) AND (su.user_id = auth.uid()))))));


--
-- Name: ai_recommendations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_recommendations ai_recommendations_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_recommendations_select ON public.ai_recommendations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_recommendations.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: ai_recommendations ai_recommendations_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_recommendations_update ON public.ai_recommendations FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_recommendations.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_recommendations.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: ai_usage_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_logs ai_usage_logs_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_usage_logs_insert ON public.ai_usage_logs FOR INSERT WITH CHECK (((user_id = auth.uid()) AND ((store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_usage_logs.store_id) AND (su.user_id = auth.uid())))))));


--
-- Name: ai_usage_logs ai_usage_logs_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY ai_usage_logs_select ON public.ai_usage_logs FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = ai_usage_logs.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: bottle_aliases; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bottle_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: bottle_aliases bottle_aliases_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY bottle_aliases_read ON public.bottle_aliases FOR SELECT TO authenticated USING (true);


--
-- Name: bottles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bottles ENABLE ROW LEVEL SECURITY;

--
-- Name: bottles bottles_select_all_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY bottles_select_all_authenticated ON public.bottles FOR SELECT TO authenticated USING (true);


--
-- Name: rpa_job_items deny_all_items; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY deny_all_items ON public.rpa_job_items USING (false) WITH CHECK (false);


--
-- Name: rpa_jobs deny_all_jobs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY deny_all_jobs ON public.rpa_jobs USING (false) WITH CHECK (false);


--
-- Name: store_mlcc_credentials deny_all_modify; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY deny_all_modify ON public.store_mlcc_credentials USING (false) WITH CHECK (false);


--
-- Name: store_mlcc_credentials deny_all_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY deny_all_select ON public.store_mlcc_credentials FOR SELECT USING (false);


--
-- Name: device_sessions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: device_sessions device_sessions_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY device_sessions_insert ON public.device_sessions FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: device_sessions device_sessions_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY device_sessions_select ON public.device_sessions FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = device_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: device_sessions device_sessions_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY device_sessions_update ON public.device_sessions FOR UPDATE USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = device_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text)))))) WITH CHECK (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = device_sessions.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: error_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: error_logs error_logs_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY error_logs_insert ON public.error_logs FOR INSERT WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND ((store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = error_logs.store_id) AND (su.user_id = auth.uid())))))));


--
-- Name: error_logs error_logs_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY error_logs_select ON public.error_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = error_logs.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text)))));


--
-- Name: store_users insert_own_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY insert_own_membership ON public.store_users FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: inventory; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory inventory_delete_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inventory_delete_by_store_membership ON public.inventory FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = inventory.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: inventory inventory_insert_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inventory_insert_by_store_membership ON public.inventory FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = inventory.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: inventory inventory_select_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inventory_select_by_store_membership ON public.inventory FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = inventory.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: inventory inventory_update_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY inventory_update_by_store_membership ON public.inventory FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = inventory.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = inventory.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: lk_chat_messages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_chat_messages lk_chat_messages_rw; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_chat_messages_rw ON public.lk_chat_messages TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.lk_chat_threads t
  WHERE ((t.id = lk_chat_messages.thread_id) AND public.lk_is_store_member(t.store_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.lk_chat_threads t
  WHERE ((t.id = lk_chat_messages.thread_id) AND public.lk_is_store_member(t.store_id)))));


--
-- Name: lk_chat_threads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_chat_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_chat_threads lk_chat_threads_rw; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_chat_threads_rw ON public.lk_chat_threads TO authenticated USING (public.lk_is_store_member(store_id)) WITH CHECK (public.lk_is_store_member(store_id));


--
-- Name: lk_order_events lk_no_client_events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_no_client_events ON public.lk_order_events USING (false) WITH CHECK (false);


--
-- Name: lk_order_intents lk_no_client_intents; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_no_client_intents ON public.lk_order_intents USING (false) WITH CHECK (false);


--
-- Name: lk_order_proofs lk_no_client_proofs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_no_client_proofs ON public.lk_order_proofs USING (false) WITH CHECK (false);


--
-- Name: lk_order_runs lk_no_client_runs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY lk_no_client_runs ON public.lk_order_runs USING (false) WITH CHECK (false);


--
-- Name: lk_order_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_order_intents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_order_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_order_proofs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_order_proofs ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_order_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_order_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: lk_system_diagnostics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.lk_system_diagnostics ENABLE ROW LEVEL SECURITY;

--
-- Name: login_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

--
-- Name: login_events login_events_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY login_events_insert ON public.login_events FOR INSERT WITH CHECK (((user_id IS NULL) OR (user_id = auth.uid())));


--
-- Name: login_events login_events_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY login_events_select ON public.login_events FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = login_events.store_id) AND (su.user_id = auth.uid()) AND (su.role = 'owner'::text))))));


--
-- Name: mlcc_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mlcc_items ENABLE ROW LEVEL SECURITY;

--
-- Name: mlcc_items mlcc_items_select_all_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mlcc_items_select_all_authenticated ON public.mlcc_items FOR SELECT TO authenticated USING (true);


--
-- Name: mlcc_price_snapshots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mlcc_price_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: mlcc_price_snapshots mlcc_price_snapshots_select_all_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mlcc_price_snapshots_select_all_authenticated ON public.mlcc_price_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: mlcc_qty_rules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mlcc_qty_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: mlcc_qty_rules mlcc_qty_rules_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY mlcc_qty_rules_read ON public.mlcc_qty_rules FOR SELECT TO authenticated USING (true);


--
-- Name: lk_system_diagnostics no_client_access; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY no_client_access ON public.lk_system_diagnostics USING (false) WITH CHECK (false);


--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences notification_preferences_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notification_preferences_insert ON public.notification_preferences FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: notification_preferences notification_preferences_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notification_preferences_select ON public.notification_preferences FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: notification_preferences notification_preferences_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notification_preferences_update ON public.notification_preferences FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notifications_insert ON public.notifications FOR INSERT WITH CHECK ((((user_id = auth.uid()) OR (user_id IS NULL)) AND ((store_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = notifications.store_id) AND (su.user_id = auth.uid())))))));


--
-- Name: notifications notifications_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notifications_select ON public.notifications FOR SELECT USING ((((user_id IS NOT NULL) AND (user_id = auth.uid())) OR ((user_id IS NULL) AND (store_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = notifications.store_id) AND (su.user_id = auth.uid())))))));


--
-- Name: notifications notifications_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY notifications_update ON public.notifications FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items order_items_insert_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_items_insert_by_store_membership ON public.order_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.orders o
     JOIN public.store_users su ON ((su.store_id = o.store_id)))
  WHERE ((o.id = order_items.order_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_items order_items_select_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_items_select_by_store_membership ON public.order_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.orders o
     JOIN public.store_users su ON ((su.store_id = o.store_id)))
  WHERE ((o.id = order_items.order_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_items order_items_update_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_items_update_by_store_membership ON public.order_items FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.orders o
     JOIN public.store_users su ON ((su.store_id = o.store_id)))
  WHERE ((o.id = order_items.order_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.orders o
     JOIN public.store_users su ON ((su.store_id = o.store_id)))
  WHERE ((o.id = order_items.order_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.order_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: order_templates order_templates_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_templates_delete ON public.order_templates FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = order_templates.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_templates order_templates_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_templates_insert ON public.order_templates FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = order_templates.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_templates order_templates_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_templates_select ON public.order_templates FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = order_templates.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: order_templates order_templates_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY order_templates_update ON public.order_templates FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = order_templates.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = order_templates.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_insert_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY orders_insert_by_store_membership ON public.orders FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = orders.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: orders orders_select_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY orders_select_by_store_membership ON public.orders FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = orders.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: orders orders_update_by_store_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY orders_update_by_store_membership ON public.orders FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = orders.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = orders.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: rpa_job_events owners_managers_can_view_events_for_their_jobs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY owners_managers_can_view_events_for_their_jobs ON public.rpa_job_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.rpa_jobs j
     JOIN public.store_users su ON ((su.store_id = j.store_id)))
  WHERE ((j.id = rpa_job_events.job_id) AND (su.user_id = auth.uid()) AND (su.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));


--
-- Name: store_mlcc_credentials owners_managers_can_view_mlcc_credentials; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY owners_managers_can_view_mlcc_credentials ON public.store_mlcc_credentials FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = store_mlcc_credentials.store_id) AND (su.user_id = auth.uid()) AND (su.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));


--
-- Name: rpa_jobs owners_managers_can_view_rpa_jobs_for_their_store; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY owners_managers_can_view_rpa_jobs_for_their_store ON public.rpa_jobs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = rpa_jobs.store_id) AND (su.user_id = auth.uid()) AND (su.role = ANY (ARRAY['owner'::text, 'manager'::text]))))));


--
-- Name: price_alerts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: price_alerts price_alerts_select_all_authenticated; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY price_alerts_select_all_authenticated ON public.price_alerts FOR SELECT TO authenticated USING (true);


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY push_subscriptions_insert ON public.push_subscriptions FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY push_subscriptions_select ON public.push_subscriptions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_subscriptions_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY push_subscriptions_update ON public.push_subscriptions FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: rpa_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rpa_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rpa_events rpa_events_no_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rpa_events_no_write ON public.rpa_events TO authenticated USING (false) WITH CHECK (false);


--
-- Name: rpa_events rpa_events_select_auth; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rpa_events_select_auth ON public.rpa_events FOR SELECT TO authenticated USING (true);


--
-- Name: rpa_job_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rpa_job_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rpa_job_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rpa_job_items ENABLE ROW LEVEL SECURITY;

--
-- Name: rpa_jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rpa_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: rpa_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.rpa_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: rpa_runs rpa_runs_no_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rpa_runs_no_write ON public.rpa_runs TO authenticated USING (false) WITH CHECK (false);


--
-- Name: rpa_runs rpa_runs_select_auth; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY rpa_runs_select_auth ON public.rpa_runs FOR SELECT TO authenticated USING (true);


--
-- Name: store_users select_own_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY select_own_membership ON public.store_users FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: users select_own_profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY select_own_profile ON public.users FOR SELECT USING ((auth.uid() = id));


--
-- Name: store_bottle_notes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_bottle_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: store_bottle_notes store_bottle_notes_rw; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_bottle_notes_rw ON public.store_bottle_notes TO authenticated USING (public.lk_is_store_member(store_id)) WITH CHECK (public.lk_is_store_member(store_id));


--
-- Name: store_mlcc_credentials; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_mlcc_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: store_security; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_security ENABLE ROW LEVEL SECURITY;

--
-- Name: store_security store_security_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_security_insert ON public.store_security FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = store_security.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: store_security store_security_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_security_select ON public.store_security FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = store_security.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: store_security store_security_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY store_security_update ON public.store_security FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = store_security.store_id) AND (su.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = store_security.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: store_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

--
-- Name: stores; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

--
-- Name: stores stores_select_by_membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY stores_select_by_membership ON public.stores FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = stores.id) AND (su.user_id = auth.uid())))));


--
-- Name: submission_intents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.submission_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_intents submission_intents_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY submission_intents_insert ON public.submission_intents FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = submission_intents.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: submission_intents submission_intents_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY submission_intents_select ON public.submission_intents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.store_users su
  WHERE ((su.store_id = submission_intents.store_id) AND (su.user_id = auth.uid())))));


--
-- Name: users update_own_profile; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY update_own_profile ON public.users FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION supabase_realtime OWNER TO postgres;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA extensions; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT ALL ON SCHEMA extensions TO dashboard_user;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: SCHEMA realtime; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA realtime TO postgres;
GRANT USAGE ON SCHEMA realtime TO anon;
GRANT USAGE ON SCHEMA realtime TO authenticated;
GRANT USAGE ON SCHEMA realtime TO service_role;
GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;


--
-- Name: SCHEMA storage; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA storage TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA storage TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO dashboard_user;


--
-- Name: SCHEMA vault; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA vault TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA vault TO service_role;


--
-- Name: FUNCTION gtrgm_in(cstring); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO service_role;


--
-- Name: FUNCTION gtrgm_out(public.gtrgm); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO service_role;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;


--
-- Name: FUNCTION armor(bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.armor(bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.armor(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea) TO dashboard_user;


--
-- Name: FUNCTION armor(bytea, text[], text[]); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.armor(bytea, text[], text[]) FROM postgres;
GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO dashboard_user;


--
-- Name: FUNCTION crypt(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.crypt(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.crypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.crypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION dearmor(text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.dearmor(text) FROM postgres;
GRANT ALL ON FUNCTION extensions.dearmor(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.dearmor(text) TO dashboard_user;


--
-- Name: FUNCTION decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION decrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.digest(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.digest(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.digest(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(text, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION gen_random_bytes(integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_random_bytes(integer) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO dashboard_user;


--
-- Name: FUNCTION gen_random_uuid(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_random_uuid() FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_salt(text) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_salt(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text) TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text, integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_salt(text, integer) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO dashboard_user;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_cron_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO dashboard_user;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.grant_pg_graphql_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION grant_pg_net_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_net_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO dashboard_user;


--
-- Name: FUNCTION hmac(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.hmac(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION hmac(text, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.hmac(text, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO dashboard_user;


--
-- Name: FUNCTION pgp_armor_headers(text, OUT key text, OUT value text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO dashboard_user;


--
-- Name: FUNCTION pgp_key_id(bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_key_id(bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgrst_ddl_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_ddl_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION pgrst_drop_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_drop_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.set_graphql_placeholder() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION uuid_generate_v1(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v1() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v1mc(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v1mc() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v3(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v4(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v4() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v5(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_nil(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_nil() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_nil() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_nil() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_dns(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_dns() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_oid(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_oid() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_url(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_url() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_x500(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_x500() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO dashboard_user;


--
-- Name: FUNCTION graphql("operationName" text, query text, variables jsonb, extensions jsonb); Type: ACL; Schema: graphql_public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO postgres;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO anon;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO authenticated;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO service_role;


--
-- Name: FUNCTION pg_reload_conf(); Type: ACL; Schema: pg_catalog; Owner: supabase_admin
--

GRANT ALL ON FUNCTION pg_catalog.pg_reload_conf() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION get_auth(p_usename text); Type: ACL; Schema: pgbouncer; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION pgbouncer.get_auth(p_usename text) FROM PUBLIC;
GRANT ALL ON FUNCTION pgbouncer.get_auth(p_usename text) TO pgbouncer;


--
-- Name: FUNCTION claim_next_mlcc_order(p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.claim_next_mlcc_order(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_next_mlcc_order(p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.claim_next_mlcc_order(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_next_mlcc_order(p_worker_id text) TO service_role;


--
-- Name: FUNCTION claim_next_rpa_job(p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.claim_next_rpa_job(p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.claim_next_rpa_job(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_next_rpa_job(p_worker_id text) TO service_role;


--
-- Name: FUNCTION create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text) TO anon;
GRANT ALL ON FUNCTION public.create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text) TO authenticated;
GRANT ALL ON FUNCTION public.create_submission_intent(p_store_id uuid, p_order_id uuid, p_pin text, p_request_fingerprint_hash text) TO service_role;


--
-- Name: FUNCTION create_test_rpa_job(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.create_test_rpa_job() FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_test_rpa_job() TO anon;
GRANT ALL ON FUNCTION public.create_test_rpa_job() TO authenticated;
GRANT ALL ON FUNCTION public.create_test_rpa_job() TO service_role;


--
-- Name: FUNCTION ensure_store_security(p_store_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.ensure_store_security(p_store_id uuid) TO anon;
GRANT ALL ON FUNCTION public.ensure_store_security(p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_store_security(p_store_id uuid) TO service_role;


--
-- Name: FUNCTION get_mlcc_credentials(p_store_id uuid, p_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) TO anon;
GRANT ALL ON FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.get_mlcc_credentials(p_store_id uuid, p_key text) TO service_role;


--
-- Name: FUNCTION gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gin_extract_value_trgm(text, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO service_role;


--
-- Name: FUNCTION gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_compress(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_consistent(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_decompress(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_distance(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_options(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_penalty(internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_picksplit(internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_same(public.gtrgm, public.gtrgm, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_union(internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO service_role;


--
-- Name: FUNCTION is_store_user(p_store_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.is_store_user(p_store_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_store_user(p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_store_user(p_store_id uuid) TO service_role;


--
-- Name: FUNCTION lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb) TO anon;
GRANT ALL ON FUNCTION public.lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.lk_attach_order_proof(p_run_id uuid, p_stage text, p_proof_hash text, p_proof_payload jsonb) TO service_role;


--
-- Name: FUNCTION lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb) TO anon;
GRANT ALL ON FUNCTION public.lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.lk_create_order_intent(p_store_id uuid, p_idempotency_key text, p_requested_items jsonb) TO service_role;


--
-- Name: FUNCTION lk_get_bottle_context(bottle_uuid uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_get_bottle_context(bottle_uuid uuid) TO anon;
GRANT ALL ON FUNCTION public.lk_get_bottle_context(bottle_uuid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.lk_get_bottle_context(bottle_uuid uuid) TO service_role;


--
-- Name: FUNCTION lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid) TO anon;
GRANT ALL ON FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.lk_get_bottle_context(p_bottle_id uuid, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION lk_get_mlcc_context_by_code(p_code text, p_on date); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date) TO anon;
GRANT ALL ON FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date) TO authenticated;
GRANT ALL ON FUNCTION public.lk_get_mlcc_context_by_code(p_code text, p_on date) TO service_role;


--
-- Name: FUNCTION lk_is_store_member(p_store_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_is_store_member(p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_is_store_member(p_store_id uuid) TO anon;
GRANT ALL ON FUNCTION public.lk_is_store_member(p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.lk_is_store_member(p_store_id uuid) TO service_role;


--
-- Name: FUNCTION lk_log_order_event(p_run_id uuid, p_event_type text, p_level text, p_payload jsonb); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_log_order_event(p_run_id uuid, p_event_type text, p_level text, p_payload jsonb) TO anon;
GRANT ALL ON FUNCTION public.lk_log_order_event(p_run_id uuid, p_event_type text, p_level text, p_payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.lk_log_order_event(p_run_id uuid, p_event_type text, p_level text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION lk_mark_order_state(p_run_id uuid, p_new_state text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_mark_order_state(p_run_id uuid, p_new_state text) TO anon;
GRANT ALL ON FUNCTION public.lk_mark_order_state(p_run_id uuid, p_new_state text) TO authenticated;
GRANT ALL ON FUNCTION public.lk_mark_order_state(p_run_id uuid, p_new_state text) TO service_role;


--
-- Name: FUNCTION lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.lk_resolve_bottle(p_store_id uuid, p_query text, p_limit integer) TO service_role;


--
-- Name: FUNCTION lk_resolve_bottle_by_code(code_text text, p_store_id uuid); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid) TO anon;
GRANT ALL ON FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.lk_resolve_bottle_by_code(code_text text, p_store_id uuid) TO service_role;


--
-- Name: FUNCTION lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code(p_code text, p_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION lk_resolve_mlcc_code_latest(p_code text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code_latest(p_code text) TO anon;
GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code_latest(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.lk_resolve_mlcc_code_latest(p_code text) TO service_role;


--
-- Name: FUNCTION lk_snap_qty(p_bottle_id uuid, p_requested integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) TO anon;
GRANT ALL ON FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) TO authenticated;
GRANT ALL ON FUNCTION public.lk_snap_qty(p_bottle_id uuid, p_requested integer) TO service_role;


--
-- Name: FUNCTION lk_start_order_run(p_intent_id uuid, p_submit_armed boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_start_order_run(p_intent_id uuid, p_submit_armed boolean) TO anon;
GRANT ALL ON FUNCTION public.lk_start_order_run(p_intent_id uuid, p_submit_armed boolean) TO authenticated;
GRANT ALL ON FUNCTION public.lk_start_order_run(p_intent_id uuid, p_submit_armed boolean) TO service_role;


--
-- Name: FUNCTION lk_touch_mlcc_qty_rules_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_touch_mlcc_qty_rules_updated_at() TO anon;
GRANT ALL ON FUNCTION public.lk_touch_mlcc_qty_rules_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.lk_touch_mlcc_qty_rules_updated_at() TO service_role;


--
-- Name: FUNCTION lk_touch_store_bottle_notes_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.lk_touch_store_bottle_notes_updated_at() TO anon;
GRANT ALL ON FUNCTION public.lk_touch_store_bottle_notes_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.lk_touch_store_bottle_notes_updated_at() TO service_role;


--
-- Name: TABLE rpa_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rpa_jobs TO anon;
GRANT ALL ON TABLE public.rpa_jobs TO authenticated;
GRANT ALL ON TABLE public.rpa_jobs TO service_role;


--
-- Name: FUNCTION rpa_claim_next_job(p_worker_id text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.rpa_claim_next_job(p_worker_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rpa_claim_next_job(p_worker_id text) TO anon;
GRANT ALL ON FUNCTION public.rpa_claim_next_job(p_worker_id text) TO authenticated;
GRANT ALL ON FUNCTION public.rpa_claim_next_job(p_worker_id text) TO service_role;


--
-- Name: FUNCTION set_limit(real); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.set_limit(real) TO postgres;
GRANT ALL ON FUNCTION public.set_limit(real) TO anon;
GRANT ALL ON FUNCTION public.set_limit(real) TO authenticated;
GRANT ALL ON FUNCTION public.set_limit(real) TO service_role;


--
-- Name: FUNCTION set_order_pin(p_store_id uuid, p_pin text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_order_pin(p_store_id uuid, p_pin text) TO anon;
GRANT ALL ON FUNCTION public.set_order_pin(p_store_id uuid, p_pin text) TO authenticated;
GRANT ALL ON FUNCTION public.set_order_pin(p_store_id uuid, p_pin text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION show_limit(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.show_limit() TO postgres;
GRANT ALL ON FUNCTION public.show_limit() TO anon;
GRANT ALL ON FUNCTION public.show_limit() TO authenticated;
GRANT ALL ON FUNCTION public.show_limit() TO service_role;


--
-- Name: FUNCTION show_trgm(text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.show_trgm(text) TO postgres;
GRANT ALL ON FUNCTION public.show_trgm(text) TO anon;
GRANT ALL ON FUNCTION public.show_trgm(text) TO authenticated;
GRANT ALL ON FUNCTION public.show_trgm(text) TO service_role;


--
-- Name: FUNCTION similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity(text, text) TO service_role;


--
-- Name: FUNCTION similarity_dist(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO service_role;


--
-- Name: FUNCTION similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO service_role;


--
-- Name: FUNCTION submit_order_to_mlcc(p_order_id uuid); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.submit_order_to_mlcc(p_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.submit_order_to_mlcc(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.submit_order_to_mlcc(p_order_id uuid) TO service_role;


--
-- Name: FUNCTION tg_set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.tg_set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.tg_set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.tg_set_updated_at() TO service_role;


--
-- Name: FUNCTION upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) TO anon;
GRANT ALL ON FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_mlcc_credentials(p_store_id uuid, p_email text, p_password text, p_key text) TO service_role;


--
-- Name: FUNCTION verify_order_pin(p_store_id uuid, p_pin text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.verify_order_pin(p_store_id uuid, p_pin text) TO anon;
GRANT ALL ON FUNCTION public.verify_order_pin(p_store_id uuid, p_pin text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_order_pin(p_store_id uuid, p_pin text) TO service_role;


--
-- Name: FUNCTION word_similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO service_role;


--
-- Name: FUNCTION apply_rls(wal jsonb, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO service_role;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO supabase_realtime_admin;


--
-- Name: FUNCTION broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO postgres;
GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO dashboard_user;


--
-- Name: FUNCTION build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO postgres;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO anon;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO service_role;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION "cast"(val text, type_ regtype); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO postgres;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO dashboard_user;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO anon;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO authenticated;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO service_role;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO supabase_realtime_admin;


--
-- Name: FUNCTION check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO postgres;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO anon;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO authenticated;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO service_role;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO supabase_realtime_admin;


--
-- Name: FUNCTION is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO postgres;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO anon;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO service_role;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO service_role;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO supabase_realtime_admin;


--
-- Name: FUNCTION quote_wal2json(entity regclass); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO postgres;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO anon;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO authenticated;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO service_role;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO supabase_realtime_admin;


--
-- Name: FUNCTION send(payload jsonb, event text, topic text, private boolean); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO dashboard_user;


--
-- Name: FUNCTION subscription_check_filters(); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO postgres;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO dashboard_user;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO anon;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO authenticated;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO service_role;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO supabase_realtime_admin;


--
-- Name: FUNCTION to_regrole(role_name text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO postgres;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO anon;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO authenticated;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO service_role;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO supabase_realtime_admin;


--
-- Name: FUNCTION topic(); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.topic() TO postgres;
GRANT ALL ON FUNCTION realtime.topic() TO dashboard_user;


--
-- Name: FUNCTION _crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO service_role;


--
-- Name: FUNCTION create_secret(new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: FUNCTION update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE custom_oauth_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.custom_oauth_providers TO postgres;
GRANT ALL ON TABLE auth.custom_oauth_providers TO dashboard_user;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE pg_stat_statements; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE extensions.pg_stat_statements FROM postgres;
GRANT ALL ON TABLE extensions.pg_stat_statements TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements TO dashboard_user;


--
-- Name: TABLE pg_stat_statements_info; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE extensions.pg_stat_statements_info FROM postgres;
GRANT ALL ON TABLE extensions.pg_stat_statements_info TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements_info TO dashboard_user;


--
-- Name: TABLE activity_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.activity_logs TO anon;
GRANT ALL ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;


--
-- Name: TABLE ai_anomalies; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_anomalies TO anon;
GRANT ALL ON TABLE public.ai_anomalies TO authenticated;
GRANT ALL ON TABLE public.ai_anomalies TO service_role;


--
-- Name: TABLE ai_chat_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_chat_sessions TO anon;
GRANT ALL ON TABLE public.ai_chat_sessions TO authenticated;
GRANT ALL ON TABLE public.ai_chat_sessions TO service_role;


--
-- Name: TABLE ai_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_messages TO anon;
GRANT ALL ON TABLE public.ai_messages TO authenticated;
GRANT ALL ON TABLE public.ai_messages TO service_role;


--
-- Name: TABLE ai_predictions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_predictions TO anon;
GRANT ALL ON TABLE public.ai_predictions TO authenticated;
GRANT ALL ON TABLE public.ai_predictions TO service_role;


--
-- Name: TABLE ai_recommendations; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_recommendations TO anon;
GRANT ALL ON TABLE public.ai_recommendations TO authenticated;
GRANT ALL ON TABLE public.ai_recommendations TO service_role;


--
-- Name: TABLE ai_usage_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.ai_usage_logs TO anon;
GRANT ALL ON TABLE public.ai_usage_logs TO authenticated;
GRANT ALL ON TABLE public.ai_usage_logs TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE bottle_aliases; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bottle_aliases TO anon;
GRANT ALL ON TABLE public.bottle_aliases TO authenticated;
GRANT ALL ON TABLE public.bottle_aliases TO service_role;


--
-- Name: TABLE bottles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bottles TO anon;
GRANT ALL ON TABLE public.bottles TO authenticated;
GRANT ALL ON TABLE public.bottles TO service_role;


--
-- Name: TABLE device_sessions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.device_sessions TO anon;
GRANT ALL ON TABLE public.device_sessions TO authenticated;
GRANT ALL ON TABLE public.device_sessions TO service_role;


--
-- Name: TABLE error_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.error_logs TO anon;
GRANT ALL ON TABLE public.error_logs TO authenticated;
GRANT ALL ON TABLE public.error_logs TO service_role;


--
-- Name: TABLE inventory; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.inventory TO anon;
GRANT ALL ON TABLE public.inventory TO authenticated;
GRANT ALL ON TABLE public.inventory TO service_role;


--
-- Name: TABLE lk_chat_messages; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_chat_messages TO anon;
GRANT ALL ON TABLE public.lk_chat_messages TO authenticated;
GRANT ALL ON TABLE public.lk_chat_messages TO service_role;


--
-- Name: TABLE lk_chat_threads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_chat_threads TO anon;
GRANT ALL ON TABLE public.lk_chat_threads TO authenticated;
GRANT ALL ON TABLE public.lk_chat_threads TO service_role;


--
-- Name: TABLE lk_order_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_order_events TO anon;
GRANT ALL ON TABLE public.lk_order_events TO authenticated;
GRANT ALL ON TABLE public.lk_order_events TO service_role;


--
-- Name: SEQUENCE lk_order_events_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.lk_order_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.lk_order_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.lk_order_events_id_seq TO service_role;


--
-- Name: TABLE lk_order_intents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_order_intents TO anon;
GRANT ALL ON TABLE public.lk_order_intents TO authenticated;
GRANT ALL ON TABLE public.lk_order_intents TO service_role;


--
-- Name: TABLE lk_order_proofs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_order_proofs TO anon;
GRANT ALL ON TABLE public.lk_order_proofs TO authenticated;
GRANT ALL ON TABLE public.lk_order_proofs TO service_role;


--
-- Name: TABLE lk_order_runs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_order_runs TO anon;
GRANT ALL ON TABLE public.lk_order_runs TO authenticated;
GRANT ALL ON TABLE public.lk_order_runs TO service_role;


--
-- Name: TABLE lk_seed_mlcc_codes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_seed_mlcc_codes TO anon;
GRANT ALL ON TABLE public.lk_seed_mlcc_codes TO authenticated;
GRANT ALL ON TABLE public.lk_seed_mlcc_codes TO service_role;


--
-- Name: TABLE lk_system_diagnostics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.lk_system_diagnostics TO anon;
GRANT ALL ON TABLE public.lk_system_diagnostics TO authenticated;
GRANT ALL ON TABLE public.lk_system_diagnostics TO service_role;


--
-- Name: TABLE login_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.login_events TO anon;
GRANT ALL ON TABLE public.login_events TO authenticated;
GRANT ALL ON TABLE public.login_events TO service_role;


--
-- Name: TABLE mlcc_change_rows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_change_rows TO anon;
GRANT ALL ON TABLE public.mlcc_change_rows TO authenticated;
GRANT ALL ON TABLE public.mlcc_change_rows TO service_role;


--
-- Name: TABLE mlcc_code_map; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_code_map TO anon;
GRANT ALL ON TABLE public.mlcc_code_map TO authenticated;
GRANT ALL ON TABLE public.mlcc_code_map TO service_role;


--
-- Name: TABLE mlcc_item_codes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_item_codes TO anon;
GRANT ALL ON TABLE public.mlcc_item_codes TO authenticated;
GRANT ALL ON TABLE public.mlcc_item_codes TO service_role;


--
-- Name: TABLE mlcc_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_items TO anon;
GRANT ALL ON TABLE public.mlcc_items TO authenticated;
GRANT ALL ON TABLE public.mlcc_items TO service_role;


--
-- Name: TABLE mlcc_price_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_price_snapshots TO anon;
GRANT ALL ON TABLE public.mlcc_price_snapshots TO authenticated;
GRANT ALL ON TABLE public.mlcc_price_snapshots TO service_role;


--
-- Name: TABLE mlcc_pricebook_rows; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_pricebook_rows TO anon;
GRANT ALL ON TABLE public.mlcc_pricebook_rows TO authenticated;
GRANT ALL ON TABLE public.mlcc_pricebook_rows TO service_role;


--
-- Name: TABLE mlcc_pricebook_snapshots; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_pricebook_snapshots TO anon;
GRANT ALL ON TABLE public.mlcc_pricebook_snapshots TO authenticated;
GRANT ALL ON TABLE public.mlcc_pricebook_snapshots TO service_role;


--
-- Name: TABLE mlcc_qty_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mlcc_qty_rules TO anon;
GRANT ALL ON TABLE public.mlcc_qty_rules TO authenticated;
GRANT ALL ON TABLE public.mlcc_qty_rules TO service_role;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notification_preferences TO anon;
GRANT ALL ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;


--
-- Name: TABLE order_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.order_templates TO anon;
GRANT ALL ON TABLE public.order_templates TO authenticated;
GRANT ALL ON TABLE public.order_templates TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE price_alerts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.price_alerts TO anon;
GRANT ALL ON TABLE public.price_alerts TO authenticated;
GRANT ALL ON TABLE public.price_alerts TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE rpa_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rpa_events TO anon;
GRANT ALL ON TABLE public.rpa_events TO authenticated;
GRANT ALL ON TABLE public.rpa_events TO service_role;


--
-- Name: SEQUENCE rpa_events_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.rpa_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.rpa_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.rpa_events_id_seq TO service_role;


--
-- Name: TABLE rpa_job_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rpa_job_events TO anon;
GRANT ALL ON TABLE public.rpa_job_events TO authenticated;
GRANT ALL ON TABLE public.rpa_job_events TO service_role;


--
-- Name: TABLE rpa_job_items; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rpa_job_items TO anon;
GRANT ALL ON TABLE public.rpa_job_items TO authenticated;
GRANT ALL ON TABLE public.rpa_job_items TO service_role;


--
-- Name: TABLE rpa_runs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.rpa_runs TO anon;
GRANT ALL ON TABLE public.rpa_runs TO authenticated;
GRANT ALL ON TABLE public.rpa_runs TO service_role;


--
-- Name: TABLE scan_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.scan_logs TO anon;
GRANT ALL ON TABLE public.scan_logs TO authenticated;
GRANT ALL ON TABLE public.scan_logs TO service_role;


--
-- Name: TABLE scheduled_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.scheduled_jobs TO anon;
GRANT ALL ON TABLE public.scheduled_jobs TO authenticated;
GRANT ALL ON TABLE public.scheduled_jobs TO service_role;


--
-- Name: TABLE store_bottle_notes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_bottle_notes TO anon;
GRANT ALL ON TABLE public.store_bottle_notes TO authenticated;
GRANT ALL ON TABLE public.store_bottle_notes TO service_role;


--
-- Name: TABLE store_mlcc_credentials; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_mlcc_credentials TO anon;
GRANT ALL ON TABLE public.store_mlcc_credentials TO authenticated;
GRANT ALL ON TABLE public.store_mlcc_credentials TO service_role;


--
-- Name: TABLE store_security; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_security TO anon;
GRANT ALL ON TABLE public.store_security TO authenticated;
GRANT ALL ON TABLE public.store_security TO service_role;


--
-- Name: TABLE store_users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.store_users TO anon;
GRANT ALL ON TABLE public.store_users TO authenticated;
GRANT ALL ON TABLE public.store_users TO service_role;


--
-- Name: TABLE stores; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stores TO anon;
GRANT ALL ON TABLE public.stores TO authenticated;
GRANT ALL ON TABLE public.stores TO service_role;


--
-- Name: TABLE submission_intents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.submission_intents TO anon;
GRANT ALL ON TABLE public.submission_intents TO authenticated;
GRANT ALL ON TABLE public.submission_intents TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON TABLE realtime.messages TO postgres;
GRANT ALL ON TABLE realtime.messages TO dashboard_user;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO service_role;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.schema_migrations TO postgres;
GRANT ALL ON TABLE realtime.schema_migrations TO dashboard_user;
GRANT SELECT ON TABLE realtime.schema_migrations TO anon;
GRANT SELECT ON TABLE realtime.schema_migrations TO authenticated;
GRANT SELECT ON TABLE realtime.schema_migrations TO service_role;
GRANT ALL ON TABLE realtime.schema_migrations TO supabase_realtime_admin;


--
-- Name: TABLE subscription; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.subscription TO postgres;
GRANT ALL ON TABLE realtime.subscription TO dashboard_user;
GRANT SELECT ON TABLE realtime.subscription TO anon;
GRANT SELECT ON TABLE realtime.subscription TO authenticated;
GRANT SELECT ON TABLE realtime.subscription TO service_role;
GRANT ALL ON TABLE realtime.subscription TO supabase_realtime_admin;


--
-- Name: SEQUENCE subscription_id_seq; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO postgres;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO dashboard_user;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO anon;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO service_role;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO supabase_realtime_admin;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.buckets FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.buckets TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.buckets TO anon;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.objects FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.objects TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.objects TO anon;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: TABLE secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.secrets TO service_role;


--
-- Name: TABLE decrypted_secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.decrypted_secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.decrypted_secrets TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON SEQUENCES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON FUNCTIONS TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON TABLES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


ALTER EVENT TRIGGER issue_graphql_placeholder OWNER TO supabase_admin;

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


ALTER EVENT TRIGGER issue_pg_cron_access OWNER TO supabase_admin;

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


ALTER EVENT TRIGGER issue_pg_graphql_access OWNER TO supabase_admin;

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


ALTER EVENT TRIGGER issue_pg_net_access OWNER TO supabase_admin;

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


ALTER EVENT TRIGGER pgrst_ddl_watch OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


ALTER EVENT TRIGGER pgrst_drop_watch OWNER TO supabase_admin;

--
-- PostgreSQL database dump complete
--

\unrestrict fZtM2TFlfOf4NLvweYAmyaE9A7gkoPnmgaJzCzea4Z7hwaBNUwb0dbqqEz3KVNr

