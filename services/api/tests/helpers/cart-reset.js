export async function resetTestCartState(supabase, cartId) {
  const { error } = await supabase
    .from("carts")
    .update({
      status: "submitted",
      validation_status: "not_requested",
      validation_requested_at: null,
      validation_completed_at: null,
      validation_error: null,
      execution_status: "not_requested",
      execution_requested_at: null,
      execution_completed_at: null,
      execution_error: null,
      placed_at: null,
      external_order_ref: null,
      execution_notes: null,
      receipt_snapshot: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cartId);

  if (error) throw error;
}
