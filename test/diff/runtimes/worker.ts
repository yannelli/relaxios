// Worker entry bundled for workerd (miniflare): each fetch runs one case on both clients.
// The request URL carries `env` as JSON and `case` as the case name.
import realAxios from 'axios';
import compat from 'relaxios/axios';
import type { Env } from '../cases';
import { caseNames, runCase } from '../run';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const env: Env = { ...JSON.parse(url.searchParams.get('env') || '{}'), runtime: 'workerd' };
    const name = url.searchParams.get('case');
    const adapters: Array<string | undefined> = JSON.parse(url.searchParams.get('adapters') || '[null,"fetch"]').map((a: string | null) => a ?? undefined);
    if (name === null) return Response.json({ cases: caseNames() });
    try {
      const axios = await runCase(realAxios, env, name, adapters);
      const compatOut = await runCase(url.searchParams.get('self') ? realAxios : compat, env, name, adapters);
      return Response.json({ axios, compat: compatOut });
    } catch (e: any) {
      return Response.json({ failed: String(e?.stack || e) }, { status: 500 });
    }
  },
};
