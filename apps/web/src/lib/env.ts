import { parseWebEnv } from '@csm/contracts';

export function getWebEnv() {
  return parseWebEnv(process.env);
}
