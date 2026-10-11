# relaxios/vue

A composable around [`upload()`](upload.md) for Vue 3. `vue` is an optional peer dependency, and
nothing else in relaxios depends on it.

```vue
<script setup lang="ts">
import { ietf } from 'relaxios/upload';
import { useUpload } from 'relaxios/vue';

const { start, progress, result, error, pause, resume, abort } = useUpload({
  protocol: ietf({ endpoint: '/uploads' }),
  chunkSize: 1 << 20,
});

const onFile = (e: Event) => start((e.target as HTMLInputElement).files![0]);
</script>

<template>
  <input type="file" @change="onFile" />
  <progress v-if="progress" :value="progress.confirmed" :max="progress.total" />
  <button @click="pause">Pause</button>
  <button @click="resume">Resume</button>
  <button @click="abort()">Cancel</button>
  <p v-if="error">{{ error }}</p>
</template>
```

## `useUpload(defaults?)`

`defaults` are `UploadOptions` without a file. `start(file, options?)` merges `options` over them
and returns the `UploadJob`, and starting a new upload aborts the running one.

| Member | Type | Notes |
| --- | --- | --- |
| `progress` | `Readonly<Ref<UploadProgress \| undefined>>` | The latest value from `job.progress`. Reset when a new upload starts. |
| `job` | `Readonly<Ref<UploadJob \| undefined>>` | The running job, for `job.signal` or `await job`. |
| `result` | `Readonly<Ref<R \| undefined>>` | The protocol result once the job is done. |
| `error` | `Readonly<Ref<unknown>>` | The rejection reason when the job fails or is aborted. |
| `start(file, options?)` | `UploadJob<R>` | |
| `pause()`, `resume()` | | Forwarded to the running job. |
| `abort(reason?)` | `Promise<void>` | Forwarded to the running job. Resolves when the server-side cancellation is done. |

The running job is aborted when the component's effect scope is disposed, so leaving a page
cancels its upload on the server too. Call `useUpload` inside `setup` (or any effect scope) for
that to happen.

The refs are shallow, so `progress.value` is replaced on each event and a watcher sees every
update.
