import { helocInterestScheduleKickoff } from './heloc-interest/schedule-kickoff.js';
import { helocInterestPaymentWorkflow } from './heloc-interest/workflow.js';
import { monthlyConversionScheduleKickoff } from './monthly-conversion/schedule-kickoff.js';
import { monthlyConversionWorkflow } from './monthly-conversion/workflow.js';
import { pingWorkflow } from './ping.js';

export const WORKFLOWS = {
  pingWorkflow,
  monthlyConversionWorkflow,
  monthlyConversionScheduleKickoff,
  helocInterestPaymentWorkflow,
  HelocInterest: helocInterestPaymentWorkflow,
  helocInterestScheduleKickoff,
};
