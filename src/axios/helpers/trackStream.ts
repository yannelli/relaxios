export const streamChunk = function* (chunk: any, chunkSize?: number) {
  const len = chunk.byteLength;

  if (!chunkSize || len < chunkSize) {
    yield chunk;
    return;
  }

  let pos = 0;
  let end;

  while (pos < len) {
    end = pos + chunkSize;
    yield chunk.slice(pos, end);
    pos = end;
  }
};

export const readBytes = async function* (iterable: any, chunkSize?: number) {
  for await (const chunk of readStream(iterable)) {
    yield* streamChunk(chunk, chunkSize);
  }
};

const readStream = async function* (stream: any) {
  if (stream[Symbol.asyncIterator]) {
    yield* stream;
    return;
  }

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      yield value;
    }
  } finally {
    await reader.cancel();
  }
};

export const trackStream = (
  stream: any,
  chunkSize: number | undefined,
  onProgress?: ((loaded: number) => void) | false | null,
  onFinish?: ((reason?: any) => void) | false | null
) => {
  const iterator = readBytes(stream, chunkSize);

  let bytes = 0;
  let done: boolean | undefined;
  const _onFinish = (e?: any) => {
    if (!done) {
      done = true;
      onFinish && onFinish(e);
    }
  };

  return new ReadableStream(
    {
      async pull(controller) {
        try {
          const { done, value } = await iterator.next();

          if (done) {
            _onFinish();
            controller.close();
            return;
          }

          const len = value.byteLength;
          if (onProgress) {
            const loadedBytes = (bytes += len);
            onProgress(loadedBytes);
          }
          controller.enqueue(new Uint8Array(value));
        } catch (err) {
          _onFinish(err);
          throw err;
        }
      },
      cancel(reason) {
        _onFinish(reason);
        return iterator.return() as any;
      },
    },
    {
      highWaterMark: 2,
    }
  );
};
