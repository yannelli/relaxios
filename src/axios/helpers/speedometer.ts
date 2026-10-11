'use strict';

function speedometer(samplesCount?: number, min?: number) {
  samplesCount = samplesCount || 10;
  const bytes = new Array<number>(samplesCount);
  const timestamps = new Array<number>(samplesCount);
  let head = 0;
  let tail = 0;
  let firstSampleTS: number | undefined;

  min = min !== undefined ? min : 1000;

  return function push(chunkLength: number): number | undefined {
    const now = Date.now();

    const startedAt = timestamps[tail];

    if (!firstSampleTS) {
      firstSampleTS = now;
    }

    bytes[head] = chunkLength;
    timestamps[head] = now;

    let i = tail;
    let bytesCount = 0;

    while (i !== head) {
      bytesCount += bytes[i++];
      i = i % samplesCount!;
    }

    head = (head + 1) % samplesCount!;

    if (head === tail) {
      tail = (tail + 1) % samplesCount!;
    }

    if (now - firstSampleTS < min!) {
      return;
    }

    const passed = startedAt && now - startedAt;

    return passed ? Math.round((bytesCount * 1000) / passed) : undefined;
  };
}

export default speedometer;
