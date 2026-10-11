'use strict';

// In-package port of combined-stream 1.0.8 and delayed-stream 1.0.0, the
// legacy Stream base that the form-data package builds on.

import { Stream } from 'node:stream';

export class DelayedStream extends Stream {
  declare source: any;
  declare dataSize: number;
  declare maxDataSize: number;
  declare pauseStream: boolean;
  declare _maxDataSizeExceeded: boolean;
  declare _released: boolean;
  declare _bufferedEvents: any[];

  constructor() {
    super();
    this.source = null;
    this.dataSize = 0;
    this.maxDataSize = 1024 * 1024;
    this.pauseStream = true;

    this._maxDataSizeExceeded = false;
    this._released = false;
    this._bufferedEvents = [];
  }

  static create(source: any, options?: any): DelayedStream {
    const delayedStream = new this();

    options = options || {};
    for (const option in options) {
      (delayedStream as any)[option] = options[option];
    }

    delayedStream.source = source;

    const realEmit = source.emit;
    source.emit = function () {
      delayedStream._handleEmit(arguments);
      return realEmit.apply(source, arguments);
    };

    source.on('error', function () {});
    if (delayedStream.pauseStream) {
      source.pause();
    }

    return delayedStream;
  }

  get readable(): boolean {
    return this.source.readable;
  }

  setEncoding(...args: any[]): any {
    return this.source.setEncoding.apply(this.source, args);
  }

  resume(): void {
    if (!this._released) {
      this.release();
    }

    this.source.resume();
  }

  pause(): void {
    this.source.pause();
  }

  release(): void {
    this._released = true;

    this._bufferedEvents.forEach((args: any) => {
      this.emit.apply(this, args);
    });
    this._bufferedEvents = [];
  }

  pipe(...args: any[]): any {
    const r = (Stream.prototype.pipe as any).apply(this, args);
    this.resume();
    return r;
  }

  _handleEmit(args: IArguments): void {
    if (this._released) {
      this.emit.apply(this, args as any);
      return;
    }

    if (args[0] === 'data') {
      this.dataSize += args[1].length;
      this._checkIfMaxDataSizeExceeded();
    }

    this._bufferedEvents.push(args);
  }

  _checkIfMaxDataSizeExceeded(): void {
    if (this._maxDataSizeExceeded) {
      return;
    }

    if (this.dataSize <= this.maxDataSize) {
      return;
    }

    this._maxDataSizeExceeded = true;
    const message = 'DelayedStream#maxDataSize of ' + this.maxDataSize + ' bytes exceeded.';
    this.emit('error', new Error(message));
  }
}

class CombinedStream extends Stream {
  declare writable: boolean;
  declare readable: boolean;
  declare dataSize: number;
  declare maxDataSize: number;
  declare pauseStreams: boolean;
  declare _released: boolean;
  declare _streams: any[];
  declare _currentStream: any;
  declare _insideLoop: boolean;
  declare _pendingNext: boolean;

  constructor() {
    super();
    this.writable = false;
    this.readable = true;
    this.dataSize = 0;
    this.maxDataSize = 2 * 1024 * 1024;
    this.pauseStreams = true;

    this._released = false;
    this._streams = [];
    this._currentStream = null;
    this._insideLoop = false;
    this._pendingNext = false;
  }

  static create(options?: any): CombinedStream {
    const combinedStream = new this();

    options = options || {};
    for (const option in options) {
      (combinedStream as any)[option] = options[option];
    }

    return combinedStream;
  }

  static isStreamLike(stream: any): boolean {
    return (
      typeof stream !== 'function' &&
      typeof stream !== 'string' &&
      typeof stream !== 'boolean' &&
      typeof stream !== 'number' &&
      !Buffer.isBuffer(stream)
    );
  }

  append(stream: any): any {
    const isStreamLike = CombinedStream.isStreamLike(stream);

    if (isStreamLike) {
      if (!(stream instanceof DelayedStream)) {
        const newStream = DelayedStream.create(stream, {
          maxDataSize: Infinity,
          pauseStream: this.pauseStreams,
        });
        stream.on('data', this._checkDataSize.bind(this));
        stream = newStream;
      }

      this._handleErrors(stream);

      if (this.pauseStreams) {
        stream.pause();
      }
    }

    this._streams.push(stream);
    return this;
  }

  pipe(dest: any, options?: any): any {
    (Stream.prototype.pipe as any).call(this, dest, options);
    this.resume();
    return dest;
  }

  _getNext(): void {
    this._currentStream = null;

    if (this._insideLoop) {
      this._pendingNext = true;
      return; // defer call
    }

    this._insideLoop = true;
    try {
      do {
        this._pendingNext = false;
        this._realGetNext();
      } while (this._pendingNext);
    } finally {
      this._insideLoop = false;
    }
  }

  _realGetNext(): void {
    const stream = this._streams.shift();

    if (typeof stream == 'undefined') {
      this.end();
      return;
    }

    if (typeof stream !== 'function') {
      this._pipeNext(stream);
      return;
    }

    const getStream = stream;
    getStream((stream: any) => {
      const isStreamLike = CombinedStream.isStreamLike(stream);
      if (isStreamLike) {
        stream.on('data', this._checkDataSize.bind(this));
        this._handleErrors(stream);
      }

      this._pipeNext(stream);
    });
  }

  _pipeNext(stream: any): void {
    this._currentStream = stream;

    const isStreamLike = CombinedStream.isStreamLike(stream);
    if (isStreamLike) {
      stream.on('end', this._getNext.bind(this));
      stream.pipe(this, { end: false });
      return;
    }

    const value = stream;
    this.write(value);
    this._getNext();
  }

  _handleErrors(stream: any): void {
    const self = this;
    stream.on('error', function (err: any) {
      self._emitError(err);
    });
  }

  write(data: any): void {
    this.emit('data', data);
  }

  pause(): void {
    if (!this.pauseStreams) {
      return;
    }

    if (this.pauseStreams && this._currentStream && typeof this._currentStream.pause == 'function')
      this._currentStream.pause();
    this.emit('pause');
  }

  resume(): void {
    if (!this._released) {
      this._released = true;
      this.writable = true;
      this._getNext();
    }

    if (
      this.pauseStreams &&
      this._currentStream &&
      typeof this._currentStream.resume == 'function'
    )
      this._currentStream.resume();
    this.emit('resume');
  }

  end(): void {
    this._reset();
    this.emit('end');
  }

  destroy(): void {
    this._reset();
    this.emit('close');
  }

  _reset(): void {
    this.writable = false;
    this._streams = [];
    this._currentStream = null;
  }

  _checkDataSize(): void {
    this._updateDataSize();
    if (this.dataSize <= this.maxDataSize) {
      return;
    }

    const message = 'DelayedStream#maxDataSize of ' + this.maxDataSize + ' bytes exceeded.';
    this._emitError(new Error(message));
  }

  _updateDataSize(): void {
    this.dataSize = 0;

    const self = this;
    this._streams.forEach(function (stream: any) {
      if (!stream.dataSize) {
        return;
      }

      self.dataSize += stream.dataSize;
    });

    if (this._currentStream && this._currentStream.dataSize) {
      this.dataSize += this._currentStream.dataSize;
    }
  }

  _emitError(err: any): void {
    this._reset();
    this.emit('error', err);
  }
}

export default CombinedStream;
