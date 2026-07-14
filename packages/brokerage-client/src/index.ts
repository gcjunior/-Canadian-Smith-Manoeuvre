export {
  BrokerageClient,
  type BrokerageClientOptions,
  type DepositInitiateInput,
  type OrderSubmitInput,
} from './client.js';
export {
  ProviderClientError,
  isProviderClientError,
  classifyHttpStatus,
  type ProviderErrorKind,
} from './errors.js';
export { FakeBrokerageClient } from './fake.js';
export {
  providerOrderSchema,
  providerDepositSchema,
  type ProviderOrder,
  type ProviderDeposit,
} from './schemas.js';
export { IDEMPOTENCY_KEY_HEADER } from './http.js';
