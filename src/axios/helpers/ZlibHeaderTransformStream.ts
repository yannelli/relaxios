'use strict';

import stream from 'node:stream';

class ZlibHeaderTransformStream extends stream.Transform {
  __transform(chunk: any, encoding: BufferEncoding, callback: () => void): void {
    this.push(chunk);
    callback();
  }

  _transform(chunk: any, encoding: BufferEncoding, callback: () => void): void {
    if (chunk.length !== 0) {
      this._transform = this.__transform;

      // Add Default Compression headers if no zlib headers are present
      if (chunk[0] !== 120) {
        // Hex: 78
        const header = Buffer.alloc(2);
        header[0] = 120; // Hex: 78
        header[1] = 156; // Hex: 9C
        this.push(header, encoding);
      }
    }

    this.__transform(chunk, encoding, callback);
  }
}

export default ZlibHeaderTransformStream;
