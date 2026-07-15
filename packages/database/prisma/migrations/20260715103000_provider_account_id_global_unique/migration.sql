-- Global uniqueness for webhook tenant resolution (simulator + real provider UUIDs).
CREATE UNIQUE INDEX "financial_accounts_provider_account_id_key" ON "financial_accounts"("provider_account_id");
