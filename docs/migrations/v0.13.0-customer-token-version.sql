-- v0.13.0 — Customer token version + OTP support (approved DDL)
-- Run BEFORE deploying the API build that references `token_version`.
--
-- Adds a per-customer version counter used to invalidate previously issued JWTs
-- when the customer resets/activates their password (Princess Skin WhatsApp OTP
-- flow). The JWT carries `ver`; CustomerContextGuard rejects tokens whose `ver`
-- does not match the stored counter.

ALTER TABLE public.tec_customers
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- Guard: re-runnable.