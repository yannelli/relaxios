import { cases, skipReason, type Env } from './cases';
import { observe, type Outcome } from './observe';

export type Observations = Record<string, unknown>;
export type Results = Record<string, Observations>;

export interface RunHooks {
  /** Runs before every case and adapter, for example to reset socket pools. */
  beforeCase?: (name: string, adapter: string | undefined) => void | Promise<void>;
}

const CASE_TIMEOUT = 20_000;

// Statics the cases use that live on the axios object but not on instances.
const STATICS = ['isCancel', 'isAxiosError', 'AxiosError', 'CanceledError', 'Cancel', 'CancelToken', 'AxiosHeaders', 'HttpStatusCode', 'VERSION', 'Axios', 'toFormData', 'formToJSON', 'mergeConfig', 'getAdapter', 'all', 'spread'];

export const adapterLabel = (adapter: string | undefined) => adapter ?? 'default';

/** The client for an adapter column: `ax` itself, or `ax.create({ adapter })` with the statics copied over. */
export function clientFor(ax: any, adapter: string | undefined): any {
  if (adapter === undefined) return ax;
  const instance = ax.create({ adapter });
  for (const key of STATICS) if (!(key in instance) && key in ax) instance[key] = ax[key];
  return instance;
}

async function outcomeOf(client: any, env: Env, name: string): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ value: { __custom: { hung: true, after: CASE_TIMEOUT } } }), CASE_TIMEOUT);
  });
  try {
    const run = Promise.resolve().then(() => cases[name](client, env));
    return await Promise.race([run.then((value) => ({ value }) as Outcome, (error) => ({ error }) as Outcome), hung]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs one case for every adapter label. */
export async function runCase(ax: any, env: Env, name: string, adapters: Array<string | undefined>, hooks: RunHooks = {}): Promise<Observations> {
  const out: Observations = {};
  for (const adapter of adapters) {
    const label = adapterLabel(adapter);
    const reason = skipReason(name, env.runtime);
    if (reason) {
      out[label] = { kind: 'skipped', reason };
      continue;
    }
    await hooks.beforeCase?.(name, adapter);
    const client = clientFor(ax, adapter);
    out[label] = await observe(ax, await outcomeOf(client, env, name), env);
  }
  return out;
}

/** Runs every case sequentially: `{ [caseName]: { [adapterLabel]: observation } }`. */
export async function runAll(ax: any, env: Env, adapters: Array<string | undefined>, hooks: RunHooks = {}): Promise<Results> {
  const results: Results = {};
  for (const name of Object.keys(cases)) results[name] = await runCase(ax, env, name, adapters, hooks);
  return results;
}

export const caseNames = () => Object.keys(cases);
