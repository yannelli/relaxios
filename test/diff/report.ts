import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Results } from './run';

// Vitest independent reporter: with DIFF_REPORT=<path>, each harness writes `<path minus .json>.<runtime>.json`
// holding every observation of both clients so differences can be inspected.
export function reportPath(runtime: string, pattern = process.env.DIFF_REPORT): string | undefined {
  if (!pattern) return undefined;
  return pattern.includes('{runtime}') ? pattern.replace('{runtime}', runtime) : pattern.replace(/(\.json)?$/, `.${runtime}.json`);
}

export interface Report {
  runtime: string;
  adapters: string[];
  differences: number;
  cases: Record<string, Record<string, { same: boolean; axios: unknown; compat: unknown }>>;
}

export function buildReport(runtime: string, adapters: Array<string | undefined>, axios: Results, compat: Results): Report {
  const report: Report = { runtime, adapters: adapters.map((a) => a ?? 'default'), differences: 0, cases: {} };
  for (const name of Object.keys(axios)) {
    report.cases[name] = {};
    for (const label of Object.keys(axios[name])) {
      const a = axios[name][label];
      const c = compat[name]?.[label];
      const same = JSON.stringify(a) === JSON.stringify(c);
      if (!same) report.differences++;
      report.cases[name][label] = { same, axios: a, compat: c };
    }
  }
  return report;
}

/** Writes the report when DIFF_REPORT is set; returns the path written. `merge` keeps cases already in the file. */
export function writeReport(runtime: string, adapters: Array<string | undefined>, axios: Results, compat: Results, merge = false): string | undefined {
  const path = reportPath(runtime);
  if (!path) return undefined;
  mkdirSync(dirname(path), { recursive: true });
  const report = buildReport(runtime, adapters, axios, compat);
  if (merge && existsSync(path)) {
    try {
      const previous: Report = JSON.parse(readFileSync(path, 'utf8'));
      report.cases = { ...previous.cases, ...report.cases };
      report.differences = Object.values(report.cases).flatMap((c) => Object.values(c)).filter((o) => !o.same).length;
    } catch {}
  }
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}
