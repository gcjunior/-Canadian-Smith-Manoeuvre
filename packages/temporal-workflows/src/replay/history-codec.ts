import { readFileSync, writeFileSync } from 'node:fs';

import type { History } from '@temporalio/worker';
import proto from '@temporalio/proto';

/**
 * Store Event History as protobuf binary so enums, bytes, Longs and Timestamps
 * survive disk round-trips. Prefer this over ad-hoc JSON conversion.
 */
export function writeHistoryFixture(path: string, history: History): void {
  const bytes = proto.temporal.api.history.v1.History.encode(
    proto.temporal.api.history.v1.History.fromObject(history as object),
  ).finish();
  writeFileSync(path, Buffer.from(bytes));
}

export function readHistoryFixture(path: string): History {
  const bytes = readFileSync(path);
  return proto.temporal.api.history.v1.History.decode(bytes) as History;
}
