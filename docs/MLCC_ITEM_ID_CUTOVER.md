# MLCC Item ID Cutover Criteria

`cart_items.mlcc_item_id` is the authoritative identity key for cart safety.

## Current rollout state

- New writes are expected to set `mlcc_item_id`.
- Compatibility fallback remains in `bottle-identity.service.js` for environments
  that have not completed migration rollout.
- Legacy rows may still have `mlcc_item_id IS NULL`.

## Required checks before making `mlcc_item_id` mandatory

1. **Schema rollout complete**
   - `public.cart_items.mlcc_item_id` exists in every environment.
   - FK to `public.mlcc_items(id)` is present and valid.

2. **Backfill complete**
   - Run `npm run audit:lk:cart-identity:apply`.
   - Confirm report shows `null_mlcc_item_id = 0`, or all remaining nulls are
     documented as intentionally unresolved edge cases.

3. **Unresolved and ambiguous rows reviewed**
   - Review `unresolved_examples` and `ambiguous_examples` from report output.
   - Resolve data defects or explicitly accept exceptions with ticketed follow-up.

4. **No ongoing null identity writes**
   - Monitor diagnostics kind `identity_write_missing_mlcc_item_id`.
   - Require zero new events over a stable period (recommended: 14 days).

5. **Test safety**
   - Full API tests pass (`services/api`).
   - Execution/cart flows behave unchanged from current expected behavior.

## Cutover action sequence (when criteria are met)

1. Remove temporary compatibility fallback branch in
   `services/api/src/services/bottle-identity.service.js`.
2. Enforce database requirement (`ALTER TABLE ... SET NOT NULL`) after validating
   there are no remaining null rows.
3. Keep diagnostics in place for post-cutover drift detection.
