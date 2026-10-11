import { useUpload } from 'relaxios/vue';
import type { Protocol } from 'relaxios/upload';
import { effectScope, isReadonly, nextTick, watch } from 'vue';
import { describe, expect, it } from 'vitest';

/** A protocol that confirms the file in two steps without network access. */
const twoSteps: Protocol<string> = async (ctx) => {
  await ctx.task(async (t) => {
    t.send(ctx.size);
    await new Promise((r) => setTimeout(r, 10));
  });
  ctx.confirm(ctx.size / 2);
  await new Promise((r) => setTimeout(r, 10));
  return 'stored';
};

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('useUpload()', () => {
  it('exposes job progress as a readonly ref and sets the result', async () => {
    const scope = effectScope();
    const state = scope.run(() => useUpload<string>({ protocol: twoSteps, store: false }))!;
    expect(isReadonly(state.progress)).toBe(true);
    const seen: number[] = [];
    scope.run(() => watch(state.progress, (p) => p && seen.push(p.confirmed)));
    state.start(new File([new Uint8Array(100)], 'a'));
    await state.job.value;
    await waitFor(() => state.progress.value?.state === 'done');
    await nextTick();
    expect(state.result.value).toBe('stored');
    expect(state.progress.value).toMatchObject({ state: 'done', confirmed: 100, total: 100 });
    expect(seen).toContain(50);
    scope.stop();
  });

  it('aborts the running job when the scope is disposed', async () => {
    const scope = effectScope();
    const state = scope.run(() => useUpload<string>({ protocol: twoSteps, store: false }))!;
    const job = state.start(new File([new Uint8Array(10)], 'b'));
    scope.stop();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(job.state).toBe('aborted');
    await waitFor(() => state.error.value !== undefined);
    expect(state.error.value).toMatchObject({ name: 'AbortError' });
  });
});
