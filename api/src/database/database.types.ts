// Narrow projections of the confirmed live columns used by V1; verify against the
// exact Supabase project schema before deployment. Do not generate from legacy DDL.
type Table<Row extends Record<string, unknown>> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      tec_users: Table<{
        id: number; tenant_id: string | null; username: string | null; email: string | null;
        first_name: string | null; last_name: string | null; group_id: number | null;
        store_id: number | null; active: number | null; password: string | null;
      }>;
      tec_groups: Table<{ id: number; tenant_id: string | null; name: string | null }>;
      tec_customers: Table<{
        id: number; tenant_id: string | null; name: string | null; email: string | null;
        phone: string | null; cf1: string | null; cf2: string | null; store_id: number | null;
        password: string | null; points_balance: number | null;
      }>;
      tec_stores: Table<{ id: number; tenant_id: string; name: string; code: string | null }>;
      tec_products: Table<{
        id: number; tenant_id: string | null; code: string | null; name: string | null;
        category_id: number | null; price: number | null; cost: number | null; tax: number | null;
        type: string | null; reward_points: number | null; image: string | null;
        image_2: string | null; image_3: string | null; details: string | null;
        quantity: number | null; points_cost: number | null;
      }>;
      tec_sales: Table<{
        id: number; tenant_id: string | null; customer_id: number | null; customer_name: string | null;
        total: number | null; grand_total: number | null; paid: number | null; total_items: number | null;
        total_quantity: number | null; status: string | null; created_at: string | null;
        created_by: number | null; store_id: number | null; total_reward_points: number | null;
        status_delivery: string | null; user_id: string | null; payment_method: string | null;
        product_discount: number | null; order_discount_id: string | null; order_discount: number | null;
        total_discount: number | null; product_tax: number | null; order_tax_id: string | null;
        order_tax: number | null; total_tax: number | null; rounding: number | null;
      }>;
      tec_sale_items: Table<{
        id: number; tenant_id: string | null; sale_id: number | null; product_id: number | null;
        quantity: number | null; unit_price: number | null; subtotal: number | null; reward_points: number | null;
      }>;
      tec_payments: Table<{
        id: number; tenant_id: string | null; sale_id: number | null; amount: number | null;
        paid_by: string | null; created_at: string | null;
      }>;
      tec_expenses: Table<{
        id: number; tenant_id: string | null; date: string | null; reference: string | null;
        amount: number | null; note: string | null; created_by: number | null;
      }>;
      tec_suppliers: Table<{
        id: number; tenant_id: string | null; name: string | null; cf1: string | null;
        cf2: string | null; phone: string | null; email: string | null;
      }>;
      tec_purchases: Table<{
        id: number; tenant_id: string | null; reference_no: string | null; date: string | null;
        note: string | null; total: number | null; attachment: string | null; supplier_id: number | null;
        created_by: number | null;
      }>;
      tec_purchase_items: Table<{
        id: number; tenant_id: string | null; purchase_id: number | null; product_id: number | null;
        quantity: number | null; cost: number | null; subtotal: number | null;
      }>;
      tec_registers: Table<{
        id: number; tenant_id: string | null; date: string | null; user_id: number | null;
        cash_in_hand: number | null; status: string | null; total_cash: number | null;
        total_cheques: number | null; total_cc_slips: number | null;
        total_cash_submitted: number | null; total_cheques_submitted: number | null;
        total_cc_slips_submitted: number | null; note: string | null; closed_at: string | null;
        transfer_opened_bills: string | null; closed_by: number | null; store_id: number | null;
      }>;
      tec_login_attempts: Table<{
        id: number; tenant_id: string | null; ip_address: string | null; login: string | null; time: number | null;
      }>;
      tec_sessions: Table<{
        id: string; tenant_id: string | null; ip_address: string | null; timestamp: number | null; data: string | null;
      }>;
      tec_settings: Table<{
        setting_id: number; site_name: string; currency_prefix: string; default_customer: number | null;
      }>;
      tec_tenants: Table<{
        id: string; name: string; host: string | null; status: string; created_at: string | null;
      }>;
      tec_tenant_payment_settings: Table<{
        tenant_id: string; bold_enabled: boolean | null; bold_api_key: string | null; bold_webhook_secret: string | null;
        addi_enabled: boolean | null; addi_api_key: string | null; addi_webhook_secret: string | null;
        sistecredito_enabled: boolean | null; sistecredito_api_key: string | null; sistecredito_webhook_secret: string | null;
        sistecredito_vendor_id: string | null; sistecredito_store_id: string | null;
        return_url: string | null; created_at: string | null; updated_at: string | null;
      }>;
      product_reviews: Table<{
        id: number; product_id: number; customer_id: number | null; rating: number;
        comment: string | null; created_at: string | null; updated_at: string | null;
      }>;
      customer_addresses: Table<{
        id: number; customer_id: number | null; label: string; street_address: string;
        neighborhood: string | null; city: string | null; phone: string | null;
        additional_notes: string | null; is_default: boolean | null;
        created_at: string | null; updated_at: string | null;
      }>;
      tec_combos: Table<{
        id: number; tenant_id: string | null; name: string; description: string | null;
        combo_price: number | null; original_price: number | null; is_active: boolean | null;
        created_at: string | null;
      }>;
      tec_customer_combo_items: Table<{
        id: number; combo_id: number | null; product_id: number | null; quantity: number | null;
      }>;
      tec_marketplace_settings: Table<{
        tenant_id: string; enabled: boolean; markup_percent: number | null;
        store_display_name: string | null; created_at: string | null; updated_at: string | null;
      }>;
      tec_marketplace_customers: Table<{
        id: number; name: string; email: string; phone: string | null; password: string;
        created_at: string | null; updated_at: string | null;
      }>;
      tec_marketplace_addresses: Table<{
        id: number; customer_id: number; recipient_name: string; label: string;
        street_address: string; neighborhood: string | null; city: string | null;
        phone: string | null; additional_notes: string | null; is_default: boolean | null;
        created_at: string | null; updated_at: string | null;
      }>;
      tec_marketplace_orders: Table<{
        id: number; order_number: string; customer_id: number; customer_name: string;
        customer_email: string | null; customer_phone: string | null;
        shipping_recipient: string; shipping_phone: string; shipping_address: string;
        shipping_neighborhood: string | null; shipping_city: string; shipping_notes: string | null;
        products_total: number | null; shipping_total: number | null; grand_total: number | null;
        commission_total: number | null; tenant_total: number | null;
        status: string; payment_method: string; payment_status: string;
        bold_payment_id: string | null; checkout_url: string | null; paid_at: string | null;
        created_at: string | null; updated_at: string | null;
      }>;
      tec_marketplace_suborders: Table<{
        id: number; order_id: number; tenant_id: string; sale_id: number | null;
        suborder_number: string; status: string; products_total: number | null;
        shipping_total: number | null; tenant_total: number | null; commission: number | null;
        tracking_note: string | null; shipped_at: string | null; delivered_at: string | null;
        payout_status: string; paid_out_at: string | null;
        created_at: string | null; updated_at: string | null;
      }>;
      tec_marketplace_order_items: Table<{
        id: number; order_id: number; suborder_id: number; tenant_id: string;
        product_id: number; product_code: string | null; product_name: string;
        product_image: string | null; quantity: number;
        base_unit_price: number | null; unit_price: number | null; commission_unit: number | null;
        line_base: number | null; line_tax: number | null; line_subtotal: number | null;
        line_total: number | null; commission_total: number | null;
        created_at: string | null;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type TableRow<Name extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][Name]['Row'];
