import { describe, expect, it } from 'vitest';

import {
  FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE,
  FINITE_WORKFLOW_TYPES,
  REPLAY_BREAKING_CHANGE_CLASSES,
  REPLAY_SAFE_CHANGE_CLASSES,
  WORKFLOW_BUNDLE_VERSION,
  WORKFLOW_CHANGE_IDS,
  assertCompactContinueAsNewState,
  classifyHistoryPressure,
  shouldContinueAsNew,
  summarizeHistoryPressure,
} from '../versioning/index.js';

describe('workflow versioning metadata', () => {
  it('exports a semver bundle version and finite workflow catalogue', () => {
    expect(WORKFLOW_BUNDLE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(FINITE_WORKFLOW_TYPES).toContain('monthlyConversionWorkflow');
    expect(FINITE_WORKFLOW_TYPES).toContain('helocInterestPaymentWorkflow');
    expect(WORKFLOW_CHANGE_IDS.EXAMPLE_RESERVED).toContain('csm.');
  });

  it('documents why finite period Workflows skip Continue-As-New', () => {
    expect(FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE.length).toBeGreaterThanOrEqual(4);
    expect(FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE.join(' ')).toMatch(/ADR-0007/);
  });
});

describe('history pressure monitoring', () => {
  it('classifies warn and critical thresholds', () => {
    expect(
      classifyHistoryPressure({
        historyLength: 100,
        historySize: 1_000,
        continueAsNewSuggested: false,
      }),
    ).toBe('ok');
    expect(
      classifyHistoryPressure({
        historyLength: 8_500,
        historySize: 1_000,
        continueAsNewSuggested: false,
      }),
    ).toBe('warn');
    expect(
      classifyHistoryPressure({
        historyLength: 100,
        historySize: 1_000,
        continueAsNewSuggested: true,
      }),
    ).toBe('critical');
    const summary = summarizeHistoryPressure({
      historyLength: 12_000,
      historySize: 1_000,
      continueAsNewSuggested: false,
    });
    expect(summary.shouldContinueAsNew).toBe(true);
    expect(summary.level).toBe('critical');
  });
});

describe('Continue-As-New policy', () => {
  it('requires handler drain and child settlement before proceeding', () => {
    const snap = {
      historyLength: 12_000,
      historySize: 1_000,
      continueAsNewSuggested: true,
    };
    expect(
      shouldContinueAsNew(snap, {
        historySuggestsContinueAsNew: true,
        signalAndUpdateHandlersIdle: false,
        childrenSettledOrAbandoned: true,
      }).proceed,
    ).toBe(false);
    expect(
      shouldContinueAsNew(snap, {
        historySuggestsContinueAsNew: true,
        signalAndUpdateHandlersIdle: true,
        childrenSettledOrAbandoned: false,
      }).reason,
    ).toBe('children_inflight');
    expect(
      shouldContinueAsNew(snap, {
        historySuggestsContinueAsNew: true,
        signalAndUpdateHandlersIdle: true,
        childrenSettledOrAbandoned: true,
      }),
    ).toEqual({ proceed: true, reason: 'safe_to_continue_as_new' });
  });

  it('rejects non-compact Continue-As-New checkpoints', () => {
    expect(() =>
      assertCompactContinueAsNewState({
        workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
        checkpoint: { webhookPayload: '{}' },
      }),
    ).toThrow(/forbidden/);
    expect(() =>
      assertCompactContinueAsNewState({
        workflowBundleVersion: WORKFLOW_BUNDLE_VERSION,
        checkpoint: { tenantId: 't1', cursor: 3 },
      }),
    ).not.toThrow();
  });
});

describe('replay-breaking change catalogue', () => {
  it('lists the four mandated break classes', () => {
    const ids = REPLAY_BREAKING_CHANGE_CLASSES.map((c) => c.id);
    expect(ids).toContain('add_or_remove_activity_call');
    expect(ids).toContain('change_timer_ordering');
    expect(ids).toContain('change_conditional_command_paths');
    expect(ids).toContain('reorder_awaited_temporal_operations');
    expect(REPLAY_SAFE_CHANGE_CLASSES.some((c) => c.id === 'activity_implementation_only')).toBe(
      true,
    );
  });
});
