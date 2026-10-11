import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('docs/migration.md', () => {
  const guide = readFileSync(new URL('../docs/migration.md', import.meta.url), 'utf8');

  it('lists no known differences, because the differential suite requires none', () => {
    expect(guide).toMatch(/^## Known differences\n\nNone\./m);
    expect(guide).toMatch(/0 differences/);
  });
});
