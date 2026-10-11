import realAxios from 'axios';
import compat from 'fetchwire/axios';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from '../helpers/server';
import { cases } from './cases';
import { KNOWN_DIFFERENCES } from './known-differences';
import { startDiffServer } from './server';

let server: TestServer;
beforeAll(async () => void (server = await startDiffServer()));
afterAll(async () => {
  await server.close();
  if (process.env.DIFF_REPORT) writeFileSync(process.env.DIFF_REPORT, JSON.stringify(results, null, 2));
});

const RESPONSE_HEADERS = ['content-type', 'x-custom', 'cache-control', 'set-cookie', 'location'];

async function normalizeData(data: any): Promise<unknown> {
  if (data == null || typeof data != 'object') return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return { type: data.constructor.name, bytes: [...new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer)] };
  }
  if (typeof data.pipe == 'function' || data instanceof ReadableStream) return { type: data.constructor.name };
  return data;
}

async function normalize(ax: any, value: any): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map((v) => normalize(ax, v)));
  if (value && '__custom' in value) return value.__custom;
  if (typeof value == 'string') return value;
  const headers = Object.fromEntries(RESPONSE_HEADERS.map((k) => [k, value.headers[k]]).filter(([, v]) => v !== undefined));
  return { status: value.status, statusText: value.statusText, data: await normalizeData(value.data), headers };
}

function normalizeError(ax: any, e: any) {
  return {
    error: {
      name: e.name,
      code: e.code,
      message: e.message,
      status: e.status,
      isAxiosError: e.isAxiosError,
      isCancel: ax.isCancel(e),
      instanceOfAxiosError: e instanceof ax.AxiosError,
      instanceOfCanceledError: e instanceof ax.CanceledError,
      hasRequest: !!e.request,
      response: e.response && { status: e.response.status, data: e.response.data, type: e.response.headers?.['content-type'] },
    },
  };
}

async function run(ax: any, name: string) {
  try {
    return await normalize(ax, await cases[name](ax, server.url));
  } catch (e) {
    return normalizeError(ax, e);
  }
}

export const results: Record<string, { axios: unknown; compat: unknown; same: boolean }> = {};

describe('differential: axios 1.20.0 (Node default adapter) vs fetchwire/axios', () => {
  for (const name of Object.keys(cases)) {
    it(name, async () => {
      const [a, c] = [await run(realAxios, name), await run(compat, name)];
      const same = isDeepStrictEqual(a, c);
      results[name] = { axios: a, compat: c, same };
      if (name in KNOWN_DIFFERENCES) {
        // A listed difference that no longer exists should be removed from the list and the guide.
        expect(same, `"${name}" now matches axios; remove it from KNOWN_DIFFERENCES`).toBe(false);
      } else {
        expect(c).toEqual(a);
      }
    });
  }

  it('every known difference refers to an existing case', () => {
    for (const name of Object.keys(KNOWN_DIFFERENCES)) expect(cases).toHaveProperty([name]);
  });
});
