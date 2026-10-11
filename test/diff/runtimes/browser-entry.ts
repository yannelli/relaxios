import type { Env } from '../cases';
import { caseNames, runCase, type Observations } from '../run';

// Bundled with rolldown and injected into the e2e page, where window.axios and window.compat are loaded.
declare global {
  interface Window {
    axios: any;
    compat: any;
    __diff: {
      caseNames: () => string[];
      run: (name: string, env: Env, adapters: Array<string | undefined>) => Promise<{ axios: Observations; compat: Observations }>;
    };
  }
}

window.__diff = {
  caseNames,
  run: async (name, env, adapters) => ({
    axios: await runCase(window.axios, env, name, adapters),
    compat: await runCase(window.compat, env, name, adapters),
  }),
};
