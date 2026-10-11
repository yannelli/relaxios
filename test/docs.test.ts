import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_DIFFERENCES } from './diff/known-differences';

describe('docs/migration.md', () => {
  const guide = readFileSync(new URL('../docs/migration.md', import.meta.url), 'utf8');

  it('lists every known difference from the differential suite', () => {
    for (const name of Object.keys(KNOWN_DIFFERENCES)) expect(guide, name).toContain(`| \`${name}\` |`);
  });

  it('lists no case that is not a known difference', () => {
    const table = guide.split('## Known differences')[1].split('###')[0];
    const listed = [...table.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual(Object.keys(KNOWN_DIFFERENCES).sort());
  });
});
