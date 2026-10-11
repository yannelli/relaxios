import { bodyCases } from './cases/bodies';
import { coreCases } from './cases/core';
import { optionCases } from './cases/options';
import { responseCases } from './cases/responses';
import type { Case, Runtime } from './cases/shared';
import { transportCases } from './cases/transport';

export { custom } from './cases/shared';
export type { Case, Env, Runtime } from './cases/shared';

/** Every differential case. Each runs unchanged against real axios and against fetchwire/axios. */
export const cases: Record<string, Case> = { ...coreCases, ...responseCases, ...bodyCases, ...optionCases, ...transportCases };

// Cases that cannot even be expressed in a runtime, with the reason. Everything else runs everywhere.
export const SKIPS: Record<string, { runtimes: Runtime[]; reason: string }> = {};

export function skipReason(name: string, runtime: Runtime): string | undefined {
  const skip = SKIPS[name];
  return skip && skip.runtimes.includes(runtime) ? skip.reason : undefined;
}
