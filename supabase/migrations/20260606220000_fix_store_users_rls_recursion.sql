-- Fix infinite recursion in store_users RLS policy (task #80 follow-up,
-- caught by services/api/scripts/rls-verification.mjs on 2026-06-06).
--
-- The original store_users policies (in 20260410180000) had USING
-- clauses that did `EXISTS (SELECT 1 FROM store_users su ...)` to
-- support "see your teammates at the same store." But Postgres
-- evaluates RLS on the inner SELECT too, which re-fires the same
-- policy, which has the same EXISTS, which re-fires the policy,
-- which … → "infinite recursion detected in policy for relation
-- store_users", query aborts.
--
-- This breaks every query that joins through store_users — including
-- the scanner's "load my store's data" path. In prod we'd been masking
-- it by having the API call Supabase with the service_role key, which
-- bypasses RLS entirely. As soon as we exposed direct PostgREST calls
-- (e.g. the analytics dashboard fetching client-side), the recursion
-- would have surfaced as broken pages.
--
-- Fix: drop the recursive policies and replace with own-row-only
-- policies. For V1 SaaS launch (single-owner stores) this is correct.
-- Multi-staff store_users management can be added later via a
-- SECURITY DEFINER membership helper function.

-- Drop the recursive policies.
DROP POLICY IF EXISTS store_users_select_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_insert_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_update_by_store_membership ON public.store_users;
DROP POLICY IF EXISTS store_users_delete_by_store_membership ON public.store_users;

-- Recreate: own-row-only. User can read, update, delete their own
-- store_users link. INSERT is service-role only (covered by the
-- service_role bypass; new sign-ups go through /auth/signup which
-- uses the admin client to write store_users rows).
CREATE POLICY store_users_select_own
  ON public.store_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY store_users_update_own
  ON public.store_users
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY store_users_delete_own
  ON public.store_users
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- NOTE: no INSERT policy — only service_role can create store_users
-- rows (which happens during /auth/signup and operator provisioning).
-- Authenticated users cannot self-promote into another store.

COMMENT ON POLICY store_users_select_own ON public.store_users IS
  '2026-06-06: own-row-only. Replaces the recursive store_users_select_by_store_membership that was causing infinite-recursion in RLS evaluation. Multi-staff teammate visibility requires a SECURITY DEFINER helper, deferred to post-V1.';
