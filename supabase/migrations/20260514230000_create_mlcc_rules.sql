-- MLCC Public Ordering Rules
--
-- Encodes the publicly-documented business rules MILO enforces during cart
-- validation, plus pricing and regulatory rules. Source of truth for
-- pre-validation in both the scanner and the RPA pipeline.
--
-- Triggered by: Stage 4 RPA hitting MILO_STAGE4_VALIDATE_BUTTON_DISABLED on a
-- 3L cart against real MILO. Decision: stop hitting MLCC gates blindly.
--
-- Research: docs/lk/mlcc-rules-research.md
-- Verified sources:
--   1. OLO FAQ PDF (verbatim) — michigan.gov/lara/.../olofaq.pdf
--   2. Retailer ordering info page (snippets, marked needs_verification)
--   3. MLCC Code & Rule Book PDF (failed direct extract, marked needs_verification)
--
-- 7-category enum (decided 2026-05-14 from research):
--   order_minimum | size_quantity | workflow | account | stock | return | pricing

CREATE TABLE IF NOT EXISTS public.mlcc_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One of the 7 rule categories
  rule_type text NOT NULL CHECK (rule_type IN (
    'order_minimum',
    'size_quantity',
    'workflow',
    'account',
    'stock',
    'return',
    'pricing'
  )),

  -- Short slug for programmatic lookup (e.g. 'min_9l_per_ada')
  code text NOT NULL UNIQUE,

  -- Human-readable short name
  name text NOT NULL,

  -- Longer-form description
  description text,

  -- Structured rule body. Examples:
  --   {min_volume_ml: 9000, scope: "per_ada", trigger: "validate_button"}
  --   {max_sub_users_per_license: 2, owner_role: "main"}
  --   {ordering_error_report_window_hours: 48}
  --   {needs_verification: true}  -- when source quote was second-hand
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Source attribution (auditable back to MLCC's own docs)
  source_url text,
  source_quote text,
  source_section text,

  -- Lifecycle
  effective_date date,                       -- NULL = unknown
  deprecated_at date,                        -- NULL = active

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Hot query path: "give me all active rules of type X"
CREATE INDEX IF NOT EXISTS mlcc_rules_type_active_idx
  ON public.mlcc_rules(rule_type)
  WHERE deprecated_at IS NULL;

COMMENT ON TABLE public.mlcc_rules IS
  'Public MLCC ordering rules. Source of truth: docs/lk/mlcc-rules-research.md. '
  'Used by pre-validation in scanner + RPA Stage 3 to surface specific blockers '
  '(e.g. "ADA 321 sub-order needs 6L more") before MILO blocks the Validate button.';

COMMENT ON COLUMN public.mlcc_rules.rule_type IS
  'Category: order_minimum | size_quantity | workflow | account | stock | return | pricing';

COMMENT ON COLUMN public.mlcc_rules.code IS
  'Short slug for programmatic lookup. Stable across schema versions. NEVER reuse.';

COMMENT ON COLUMN public.mlcc_rules.parameters IS
  'Structured rule body. Schema varies by rule_type. Always include needs_verification: true '
  'when sourced second-hand (e.g. via web search snippets, not directly verified PDF).';

-- RLS: public reference data, read-allowed for any authenticated user.
-- Writes are service-role only (bypasses RLS).
ALTER TABLE public.mlcc_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mlcc_rules_select_all"
  ON public.mlcc_rules
  FOR SELECT
  USING (true);

-- ============================================================================
-- SEED DATA
-- ============================================================================
-- Every rule extracted in the research pass. Confidence levels:
--   - Source 1 (OLO FAQ verbatim): high confidence
--   - Source 2 (retailer info page, snippets only): needs_verification: true
--   - Source 3 (Code & Rule Book PDF, second-hand via statute citations): needs_verification: true
--
-- Insert order: ordered by category for readability, not by importance.

-- ============================================================================
-- order_minimum
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('order_minimum',
 'min_9l_per_ada',
 '9-liter minimum per ADA sub-order',
 'MILO requires each ADA sub-order in the cart to total at least 9000mL (one standard case). If ANY ADA appearing in the cart is under 9L, the cart-level Validate button is disabled. This is the single most common gate hit by under-volume carts. The 9L counts split-case fractional volumes — you do not need to order whole cases of every line.',
 '{"min_volume_ml": 9000, "scope": "per_ada", "trigger": "validate_button_disabled_until_met", "counts_split_case": true, "free_delivery_benefit_at_threshold": true}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'Any cart errors will be displayed and must be corrected before checking out (9-liter minimum, invalid quantities, etc.).',
 'Submitting your Order / Additional Cart Information');

-- ============================================================================
-- size_quantity
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('size_quantity',
 'split_case_eligibility_per_product',
 'Split-case eligibility is flagged per product',
 'MLCC flags individual products as split-case-eligible. Non-flagged products must be ordered in full case quantities only. The OLO UI shows a split-case icon for eligible products and computes legal quantity increments via up/down arrows.',
 '{"per_product_flag": true, "fallback_when_unflagged": "full_case_only", "ui_indicator": "split_case_icon"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'Products that can be ordered with split cases are identified using the split case icon. The OLO system automatically calculates available split orders and pack sizes, which display in the Quantity box when using the up/down arrows.',
 'Adding an item to Liquor Order');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('size_quantity',
 'value_added_bonus_max_50ml',
 'Value-added bonus item maximum size',
 'When a product is sold as a value-added package (e.g. with a bonus spirit attached), the bonus item can be at most ONE 50mL bottle. Per Admin Order 2020-01.',
 '{"max_bonus_count": 1, "max_bonus_size_ml": 50, "needs_verification": true, "source_doc": "Admin Order 2020-01"}'::jsonb,
 'https://www.michigan.gov/lara/0,4601,7-154-89334_10570_12999-518602--m_2018_2,00.html',
 'If the bonus item for a value-added package is a spirit, it can now be no larger than one 50ml bottle.',
 'Admin Order 2020-01 (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('size_quantity',
 'one_multipack_per_brand_per_size',
 'One multipack per brand per size',
 'Brands may have at most one multipack offering per bottle size in the MLCC catalog. Per Admin Order 2020-02.',
 '{"uniqueness": "one_per_brand_per_size", "needs_verification": true, "source_doc": "Admin Order 2020-02"}'::jsonb,
 'https://www.michigan.gov/lara/0,4601,7-154-89334_10570_12999-518602--m_2018_2,00.html',
 'There can now only be one multipack per brand per size.',
 'Admin Order 2020-02 (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('size_quantity',
 'multipack_components_must_be_state_listed',
 'Multipack components must already be listed with the State',
 'All component products of a multipack must already exist as standalone state-listed items. Prevents brands from sneaking unlisted SKUs into the catalog via multipack bundles.',
 '{"prerequisite": "all_components_state_listed", "needs_verification": true, "source_doc": "Admin Order 2020-02"}'::jsonb,
 'https://www.michigan.gov/lara/0,4601,7-154-89334_10570_12999-518602--m_2018_2,00.html',
 'All multipack items must now already be listed with the State.',
 'Admin Order 2020-02 (via web search snippet)');

-- ============================================================================
-- workflow
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'validate_before_checkout',
 'Validate must succeed before Checkout',
 'The MILO Validate button must be clicked and pass before Checkout becomes available. Validation triggers a real-time ADA inventory check.',
 '{"sequence": ["validate", "checkout"], "validate_triggers": ["real_time_inventory_check", "oos_segregation", "9L_per_ada_check"]}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'When ready to complete the order, select the Validate button. At this point, the system accesses the ADA inventory in real time and returns out of stock inventory notices.',
 'Submitting your Order');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'revalidate_after_post_validate_edit',
 'Re-validate required after editing post-Validate',
 'Any quantity adjustment after the cart has been validated forces a re-validation before Checkout becomes available again.',
 '{"trigger_event": "post_validate_edit", "required_action": "force_revalidate"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'If a quantity is adjusted after validating the cart, user will be required to validate the cart again before checking out.',
 'Additional Cart Information');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'edit_until_cutoff',
 'Submitted orders are editable until cutoff date',
 'Orders submitted by the licensee AND confirmed by the ADA can still be edited until the ADA-defined cutoff date. After the cutoff, the order is locked.',
 '{"edit_window": "until_cutoff_date", "cutoff_per": "ada", "exact_cutoff_time": "unknown_open_question"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'Orders that have already been submitted by the licensee and confirmed by the ADA can be edited before the designated cutoff date.',
 'Editing an Order');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'remove_confirmed_line_via_qty_zero',
 'Removing a confirmed line = qty=0 + revalidate + checkout',
 'You cannot delete a confirmed line directly. To remove it, set its quantity to zero, re-validate the cart, and submit/checkout. The line goes to zero.',
 '{"sequence": ["set_qty_zero", "revalidate", "checkout"]}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'Removing an item that is confirmed can be done by changing the quantity to zero, validate the cart, and checkout. The quantity ordered will be updated to zero.',
 'Adding and Adjusting Items in Your existing Order');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'order_day_delivery_day_max_6_day_gap',
 'Order day / delivery day spec, max 6 days apart',
 'Each retailer has a specified order day and a specified delivery day on file with the ADA. Delivery days must be within 6 days of the corresponding order day.',
 '{"order_day": "fixed_per_license", "delivery_day": "fixed_per_license", "max_gap_days": 6, "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'A retailer must have a specified order day and a specified delivery day, with delivery days being no more than six days from the specified order day.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'emergency_orders_12_per_year',
 '12 emergency orders per year, 18hr SLA',
 'Retailers are entitled to 12 emergency orders annually, fulfilled within 18 hours. An ADA-delivered emergency order may carry up to a $20 fee; pickup is free.',
 '{"per_year_max": 12, "fulfillment_sla_hours": 18, "delivery_fee_max_usd": 20, "pickup_fee_usd": 0, "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'Retailers are entitled to twelve emergency orders per year to be made available within 18 hours, though they may have to pay up to $20.00 if the ADA delivers the emergency order, unless they are required to pick it up from the facility.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('workflow',
 'ordering_channels_allowlist',
 'Ordering channels: OLO, salesperson, ADA-direct',
 'There are three legal channels to place a spirits order: the OLO (MILO) web system, an ADA salesperson, or ADA-direct (phone/in-person). OLO order history only shows OLO-placed orders — other channels are not surfaced in MILO history.',
 '{"channels": ["olo", "salesperson", "ada_direct"], "olo_history_scope": "olo_only"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'This tab will NOT display orders placed directly through an ADA or salesperson. Order history will only display orders that were placed using the new OLO site.',
 'Viewing my Order History');

-- ============================================================================
-- account
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('account',
 'active_spirits_license_required',
 'Active Michigan spirits-authorized liquor license required',
 'Only retailers holding an active Michigan liquor license that authorizes the sale of spirits may use the OLO system. License status is checked at login.',
 '{"requirement": "active_michigan_spirits_license"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'In order to use this Internet site, you must have an active Michigan liquor license that authorizes the sale of spirits.',
 'INTRODUCTION');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('account',
 'email_required_per_user',
 'Every OLO user must have an email address',
 'Each OLO user account is tied to an email address — required for password reset, notifications, and order confirmations.',
 '{"requirement": "email_per_user"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'The new OLO system requires all users have an email address.',
 'New OLO FAQs');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('account',
 'max_2_sub_users_per_license',
 'Owner can create at most 2 sub-users per license',
 'The main OLO user (Owner role) may invite up to 2 additional sub-users per license number. Practical cap is 3 total users per store.',
 '{"max_sub_users_per_license": 2, "owner_role": "main", "total_users_per_license": 3}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'The Main OLO user (Owner) will have the ability to add two additional sub-users per license number.',
 'Additional Features – adding another user');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('account',
 'credit_hold_blocks_orders',
 'Unpaid balance blocks all future spirit orders',
 'If a licensee has not paid for their entire spirit order, the Commission may block them from placing additional orders. Credit hold gates the entire account, not just a single order.',
 '{"block_condition": "unpaid_balance", "block_scope": "all_future_orders", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'The Commission may not permit licensees to order additional spirits if they do not pay for their entire spirit order.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('account',
 'on_premises_sdd_cap_120l_per_year',
 'On-premises retailers: max 120L/year from SDDs (collective)',
 'On-premises retailer licensees (Class C, B-Hotel, Club, G-1, CCRC, Aircraft, Train, Watercraft) may purchase up to 120 liters of spirits per calendar year COLLECTIVELY from Specially Designated Distributor (SDD) licensees. Tracked via monthly reporting. Does NOT apply to typical SDD/SDM retail customers.',
 '{"max_liters_per_year": 120, "scope": "collective_across_sdds", "license_types": ["ClassC", "B-Hotel", "Club", "G-1", "CCRC", "Aircraft", "Train", "Watercraft"], "enforcement": "monthly_report", "effective": "2020-07-01", "needs_verification": true}'::jsonb,
 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-436-1205',
 'On-premises retailer licensees may purchase up to 120 liters of spirits, collectively, from Specially Designated Distributor (SDD) licensees in a calendar year.',
 'MCL 436.1205(10) (via web search snippet)');

-- ============================================================================
-- stock
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('stock',
 'oos_segregate_not_remove',
 'Out-of-stock items are segregated, not removed',
 'When MILO detects an OOS item at validation, it moves the item to a separate "Out of stock items" section in the cart rather than removing it. The customer must manually re-add OOS items when they restock — there is no auto-substitution and no backorder support.',
 '{"oos_behavior": "segregate", "manual_re_add_required": true, "auto_substitution": false, "backorder_support": false}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'If an Item is out of stock, it will be moved to the Out of stock items section. Items that are out of stock can be added back to the cart by selecting the action icon next to the product.',
 'Additional Cart Information / Editing an Order');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('stock',
 'oos_triggers_9l_recheck',
 'OOS triggers re-evaluation of the 9L-per-ADA threshold',
 'If an OOS notice during validation reduces an ADA sub-order below 9L, MILO surfaces an error and the cart blocks until the user adds more items from that ADA or removes everything from it.',
 '{"trigger": "oos_during_validate", "side_effect": "recompute_9l_per_ada", "blocks_until": "ada_sub_order_meets_threshold_or_empty"}'::jsonb,
 'https://www.michigan.gov/lara/-/media/Project/Websites/lara/lcc/MILO/olofaq.pdf',
 'If an out of stock notice reduces an order to less than the 9-liter minimum, messages display, and the User can edit the cart to correct the issue.',
 'Submitting your Order');

-- ============================================================================
-- return
-- ============================================================================

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('return',
 'returnable_categories',
 'Returnable to ADA for credit',
 'Items returnable to the ADA for credit: damaged bottles, deteriorated products, leaking containers, bottles with damaged labels, short-filled bottles, and ADA delivery errors.',
 '{"categories": ["damaged", "deteriorated", "leaking", "label_damage", "short_fill", "delivery_error"], "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'Unsaleable items may be returned to the ADA for credit, including damaged bottles, deteriorated products, leaking containers, bottles with damaged labels, short filled bottles, and delivery errors.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('return',
 'licensee_caused_damage_not_returnable',
 'Licensee-caused damage is not returnable',
 'Bottles damaged BY the licensee (after delivery acceptance) cannot be returned for credit.',
 '{"exclusion": "licensee_caused_damage", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'Bottles damaged by the licensee are not returnable.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('return',
 'ordering_error_48hr_report_window',
 '48-hour window to report licensee ordering errors',
 'If a licensee ordered the wrong product/quantity by mistake, the error must be reported to the ADA within 48 hours of delivery to qualify for return/credit. After 48 hours, the order is locked.',
 '{"report_window_hours": 48, "report_to": "ada", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'Licensee ordering errors are returnable if the error is reported to the ADA within 48 hours.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('return',
 'voluntary_full_inventory_return_refuses_unsaleable',
 'Voluntary full-inventory return: ADA refuses unsaleable',
 'When a licensee returns their ENTIRE inventory voluntarily (e.g. business closing), the standard return-for-credit policy does NOT apply — the ADA inspects at time of return and refuses any items they deem unsaleable.',
 '{"scenario": "full_inventory_return", "unsaleable_handling": "ada_refuses_at_return_time", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'this policy does not apply to the voluntary return of your entire inventory, in which case the Authorized Distribution Agent (ADA) will refuse to accept unsaleable items which they determine at time of return.',
 'General Spirit Ordering Information (via web search snippet)');

-- ============================================================================
-- pricing
-- ============================================================================
-- Pricing rules govern SHELF behavior, not cart submission. They do not gate
-- MILO Validate. Load-bearing for our future shelf-pricing features (price
-- compliance, suggested retail, etc.) but informational for the RPA path.

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'minimum_retail_65pct_markup',
 'Minimum retail = MLCC cost + 65% markup + specific taxes',
 'The minimum retail selling price MLCC publishes is computed from MLCC base cost, a 65% markup, and specific state taxes. Stores cannot sell below this floor (with limited disposal-order exceptions).',
 '{"markup_pct": 65, "components": ["mlcc_cost", "65pct_markup", "specific_taxes"], "purpose": "shelf_minimum", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/how-to-read-the-price-book',
 'The minimum retail selling price set by the MLCC is determined by the cost of the spirit product to the MLCC, a 65% mark-up, and a combination of specific taxes.',
 'How To Read The Price Book (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'licensee_discount_17pct',
 'Licensee discount: 17% off base price',
 'The price paid by licensees (Licensee Price column in the MLCC price book) includes a 17% discount plus specific taxes computed on the base price.',
 '{"licensee_discount_pct": 17, "specific_taxes_pct": [4, 4, 4], "applied_to": "base_price", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/how-to-read-the-price-book',
 'The Licensee Price amount represents the price paid by licensees and includes the 17% licensee discount and the specific taxes of 4% + 4% + 4%, computed on the base price.',
 'How To Read The Price Book (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'sdd_cannot_sell_below_minimum',
 'SDDs cannot sell below MLCC minimum retail',
 'Specially Designated Distributors (SDDs — the off-premises retail license) cannot sell spirits below the MLCC-set minimum retail price, except by specific Commission rule or order for inventory disposal.',
 '{"floor": "mlcc_minimum_retail", "exception": "commission_rule_or_order_for_inventory_disposal", "needs_verification": true, "source_statute": "MCL 436.1233 / 436.1229"}'::jsonb,
 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-436-1229',
 'If alcoholic liquor is sold by a specially designated distributor, it shall not be sold at less than the minimum retail selling price fixed by the commission, except that the commission may, by rule or order, allow a specially designated distributor to sell alcoholic liquor at less than the minimum retail selling price in order to dispose of inventory at a price and under conditions and procedures established through that rule or order.',
 'MCL 436.1229 (via web search synthesis)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'retailer_may_price_above_minimum',
 'Retailers may sell above the MLCC minimum (since 2004)',
 'Effective November 30, 2004, licensees may set retail prices ABOVE the MLCC-set minimum. There is no state-imposed ceiling — only a floor.',
 '{"floor": "mlcc_minimum", "ceiling": "none", "effective": "2004-11-30", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'as of November 30, 2004, licensees may charge a higher price than the State''s set minimum retail selling price.',
 'General Spirit Ordering Information (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'value_added_multi_item_discount_eliminated',
 'Value-added multi-item discount cap eliminated',
 'The previous rule allowing up to 33% discount on packages of two or more items was eliminated by Admin Order 2020-01. No more bundled discounting of that scale.',
 '{"multi_item_pack_discount_allowed": false, "previous_max_discount_pct": 33, "needs_verification": true, "source_doc": "Admin Order 2020-01"}'::jsonb,
 'https://www.michigan.gov/lara/0,4601,7-154-89334_10570_12999-518602--m_2018_2,00.html',
 'The discounting of up to 33% of two or more items in a package is eliminated.',
 'Admin Order 2020-01 (via web search snippet)');

INSERT INTO public.mlcc_rules (rule_type, code, name, description, parameters, source_url, source_quote, source_section) VALUES
('pricing',
 'cash_handling_fees_vary',
 'Cash handling fees vary by ADA and location',
 'Some ADAs and some locations charge cash handling fees. There is no statewide standard rate — it varies.',
 '{"fee": "varies_per_ada_and_location", "needs_verification": true}'::jsonb,
 'https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info/general-spirit-ordering-information-for-retailer-licensees',
 'There may be cash handling fees depending on your location and the ADA.',
 'General Spirit Ordering Information (via web search snippet)');
