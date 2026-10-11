'use strict';

export default {
  isBufferAvailable(): boolean {
    return typeof Buffer !== 'undefined';
  },

  from(value: any): Buffer {
    return Buffer.from(value);
  },
};
