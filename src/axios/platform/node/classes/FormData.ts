'use strict';

// In-package port of the form-data package (4.0.x) for the parts axios touches:
// a readable multipart/form-data stream with getHeaders, getLength and friends.

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Stream } from 'node:stream';
import CombinedStream from './CombinedStream';

const hasOwn = (obj: any, key: string): boolean =>
  obj != null && Object.prototype.hasOwnProperty.call(obj, key);

const MIME_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bin: 'application/octet-stream',
  bmp: 'image/bmp',
  css: 'text/css',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif: 'image/gif',
  gz: 'application/gzip',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/vnd.microsoft.icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript',
  json: 'application/json',
  md: 'text/markdown',
  mjs: 'text/javascript',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  tar: 'application/x-tar',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  wasm: 'application/wasm',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  zip: 'application/zip',
};

// Same lookup rule as mime-types: extension of the path, or false when unknown.
const mimeLookup = (filePath: any): string | false => {
  if (!filePath || typeof filePath !== 'string') return false;
  const extension = path.extname('x.' + filePath).toLowerCase().substr(1);
  if (!extension) return false;
  return MIME_TYPES[extension] || false;
};

// populates missing values
const populate = (dst: any, src: any): any => {
  Object.keys(src).forEach(function (prop) {
    dst[prop] = dst[prop] || src[prop];
  });
  return dst;
};

// Escape CR, LF and `"` in a multipart name/filename parameter, matching the
// WHATWG HTML multipart/form-data encoding.
function escapeHeaderParam(str: any): string {
  return String(str).replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22');
}

// Minimal asynckit.parallel: results keep the input order, first error wins.
function parallel(
  list: any[],
  iterator: (item: any, cb: (err: any, value?: any) => void) => void,
  callback: (err: any, values?: any[]) => void
): void {
  const results: any[] = new Array(list.length);
  let pending = list.length;
  let failed = false;

  list.forEach((item, index) => {
    iterator(item, (err, value) => {
      setImmediate(() => {
        if (failed) return;
        if (err) {
          failed = true;
          callback(err);
          return;
        }
        results[index] = value;
        if (!--pending) {
          callback(null, results);
        }
      });
    });
  });
}

class FormData extends CombinedStream {
  static LINE_BREAK = '\r\n';
  static DEFAULT_CONTENT_TYPE = 'application/octet-stream';

  declare _overheadLength: number;
  declare _valueLength: number;
  declare _valuesToMeasure: any[];
  declare _boundary: string | undefined;
  declare error: any;

  constructor(options?: any) {
    super();
    this._overheadLength = 0;
    this._valueLength = 0;
    this._valuesToMeasure = [];

    options = options || {};
    for (const option in options) {
      (this as any)[option] = options[option];
    }
  }

  append(field: any, value?: any, options?: any): void {
    options = options || {};

    // allow filename as single option
    if (typeof options === 'string') {
      options = { filename: options };
    }

    const append = CombinedStream.prototype.append.bind(this);

    // all that streamy business can't handle numbers
    if (typeof value === 'number' || value == null) {
      value = String(value);
    }

    // https://github.com/felixge/node-form-data/issues/38
    if (Array.isArray(value)) {
      // Please convert your array into string the way web server expects it
      this._error(new Error('Arrays are not supported.'));
      return;
    }

    const header = this._multiPartHeader(field, value, options);
    const footer = this._multiPartFooter();

    append(header);
    append(value);
    append(footer);

    // pass along options.knownLength
    this._trackLength(header, value, options);
  }

  _trackLength(header: string, value: any, options: any): void {
    let valueLength = 0;

    // used w/ getLengthSync(), when length is known. e.g. for streaming directly
    // from a remote server with a known file size.
    if (options.knownLength != null) {
      valueLength += Number(options.knownLength);
    } else if (Buffer.isBuffer(value)) {
      valueLength = value.length;
    } else if (typeof value === 'string') {
      valueLength = Buffer.byteLength(value);
    }

    this._valueLength += valueLength;

    this._overheadLength += Buffer.byteLength(header) + FormData.LINE_BREAK.length;

    // empty or either doesn't have path or not an http response or not a stream
    if (
      !value ||
      (!value.path && !(value.readable && hasOwn(value, 'httpVersion')) && !(value instanceof Stream))
    ) {
      return;
    }

    // no need to bother with the length
    if (!options.knownLength) {
      this._valuesToMeasure.push(value);
    }
  }

  _lengthRetriever(value: any, callback: (err: any, length?: number) => void): void {
    if (hasOwn(value, 'fd')) {
      // take read range into account; `end` = Infinity means read file till the end
      if (value.end != undefined && value.end != Infinity && value.start != undefined) {
        // when end specified no need to calculate range; inclusive, starts with 0
        callback(null, value.end + 1 - (value.start ? value.start : 0));
      } else {
        // still need to fetch file size from fs
        fs.stat(value.path, function (err, stat) {
          if (err) {
            callback(err);
            return;
          }

          // update final size based on the range options
          const fileSize = stat.size - (value.start ? value.start : 0);
          callback(null, fileSize);
        });
      }

      // or http response
    } else if (hasOwn(value, 'httpVersion')) {
      callback(null, Number(value.headers['content-length']));

      // or request stream http://github.com/mikeal/request
    } else if (hasOwn(value, 'httpModule')) {
      // wait till response come back
      value.on('response', function (response: any) {
        value.pause();
        callback(null, Number(response.headers['content-length']));
      });
      value.resume();

      // something else
    } else {
      callback('Unknown stream');
    }
  }

  _multiPartHeader(field: any, value: any, options: any): string {
    // a custom header string becomes responsible for the boundary
    // (e.g. to handle extra CRLFs on .NET servers)
    if (typeof options.header === 'string') {
      return options.header;
    }

    const contentDisposition = this._getContentDisposition(value, options);
    const contentType = this._getContentType(value, options);

    let contents = '';
    const headers: Record<string, any> = {
      // add custom disposition as third element or keep it two elements if not
      'Content-Disposition': ['form-data', 'name="' + escapeHeaderParam(field) + '"'].concat(
        contentDisposition || []
      ),
      // if no content type. allow it to be empty array
      'Content-Type': ([] as any[]).concat(contentType || []),
    };

    // allow custom headers.
    if (typeof options.header === 'object') {
      populate(headers, options.header);
    }

    let header: any;
    for (const prop in headers) {
      if (hasOwn(headers, prop)) {
        header = headers[prop];

        // skip nullish headers.
        if (header == null) {
          continue;
        }

        // convert all headers to arrays.
        if (!Array.isArray(header)) {
          header = [header];
        }

        // add non-empty headers.
        if (header.length) {
          contents += prop + ': ' + header.join('; ') + FormData.LINE_BREAK;
        }
      }
    }

    return '--' + this.getBoundary() + FormData.LINE_BREAK + contents + FormData.LINE_BREAK;
  }

  _getContentDisposition(value: any, options: any): string | undefined {
    let filename: string | undefined;

    if (typeof options.filepath === 'string') {
      // custom filepath for relative paths
      filename = path.normalize(options.filepath).replace(/\\/g, '/');
    } else if (options.filename || (value && (value.name || value.path))) {
      // custom filename take precedence; formidable and the browser add a name
      // property; fs- and request- streams have path property
      filename = path.basename(options.filename || (value && (value.name || value.path)));
    } else if (value && value.readable && hasOwn(value, 'httpVersion')) {
      // or try http response
      filename = path.basename(value.client._httpMessage.path || '');
    }

    if (filename) {
      return 'filename="' + escapeHeaderParam(filename) + '"';
    }
    return undefined;
  }

  _getContentType(value: any, options: any): any {
    // use custom content-type above all
    let contentType = options.contentType;

    // or try `name` from formidable, browser
    if (!contentType && value && value.name) {
      contentType = mimeLookup(value.name);
    }

    // or try `path` from fs-, request- streams
    if (!contentType && value && value.path) {
      contentType = mimeLookup(value.path);
    }

    // or if it's http-reponse
    if (!contentType && value && value.readable && hasOwn(value, 'httpVersion')) {
      contentType = value.headers['content-type'];
    }

    // or guess it from the filepath or filename
    if (!contentType && (options.filepath || options.filename)) {
      contentType = mimeLookup(options.filepath || options.filename);
    }

    // fallback to the default content type if `value` is not simple value
    if (!contentType && value && typeof value === 'object') {
      contentType = FormData.DEFAULT_CONTENT_TYPE;
    }

    return contentType;
  }

  _multiPartFooter(): (next: (footer: string) => void) => void {
    return (next: (footer: string) => void) => {
      let footer = FormData.LINE_BREAK;

      const lastPart = this._streams.length === 0;
      if (lastPart) {
        footer += this._lastBoundary();
      }

      next(footer);
    };
  }

  _lastBoundary(): string {
    return '--' + this.getBoundary() + '--' + FormData.LINE_BREAK;
  }

  getHeaders(userHeaders?: any): Record<string, any> {
    let header: string;
    const formHeaders: Record<string, any> = {
      'content-type': 'multipart/form-data; boundary=' + this.getBoundary(),
    };

    for (header in userHeaders) {
      if (hasOwn(userHeaders, header)) {
        formHeaders[header.toLowerCase()] = userHeaders[header];
      }
    }

    return formHeaders;
  }

  setBoundary(boundary: any): void {
    if (typeof boundary !== 'string') {
      throw new TypeError('FormData boundary must be a string');
    }
    this._boundary = boundary;
  }

  getBoundary(): string {
    if (!this._boundary) {
      this._generateBoundary();
    }

    return this._boundary as string;
  }

  getBuffer(): Buffer {
    let dataBuffer = Buffer.alloc(0);
    const boundary = this.getBoundary();

    // Create the form content. Add Line breaks to the end of data.
    for (let i = 0, len = this._streams.length; i < len; i++) {
      if (typeof this._streams[i] !== 'function') {
        // Add content to the buffer.
        if (Buffer.isBuffer(this._streams[i])) {
          dataBuffer = Buffer.concat([dataBuffer, this._streams[i]]);
        } else {
          dataBuffer = Buffer.concat([dataBuffer, Buffer.from(this._streams[i])]);
        }

        // Add break after content.
        if (
          typeof this._streams[i] !== 'string' ||
          this._streams[i].substring(2, boundary.length + 2) !== boundary
        ) {
          dataBuffer = Buffer.concat([dataBuffer, Buffer.from(FormData.LINE_BREAK)]);
        }
      }
    }

    // Add the footer and return the Buffer object.
    return Buffer.concat([dataBuffer, Buffer.from(this._lastBoundary())]);
  }

  _generateBoundary(): void {
    // This generates a 50 character boundary similar to those used by Firefox.
    this._boundary = '--------------------------' + crypto.randomBytes(12).toString('hex');
  }

  // Note: getLengthSync DOESN'T calculate streams length; pass knownLength instead.
  getLengthSync(): number {
    let knownLength = this._overheadLength + this._valueLength;

    // there are 3 internal streams per keyval pair, so this checks whether any value was added
    if (this._streams.length) {
      knownLength += this._lastBoundary().length;
    }

    // https://github.com/form-data/form-data/issues/40
    if (!this.hasKnownLength()) {
      // Some async length retrievers are present, so a sync length is false.
      this._error(new Error('Cannot calculate proper length in synchronous way.'));
    }

    return knownLength;
  }

  // Public API to check if length of added values is known
  hasKnownLength(): boolean {
    let hasKnownLength = true;

    if (this._valuesToMeasure.length) {
      hasKnownLength = false;
    }

    return hasKnownLength;
  }

  getLength(cb: (err: any, length?: number) => void): void {
    let knownLength = this._overheadLength + this._valueLength;

    if (this._streams.length) {
      knownLength += this._lastBoundary().length;
    }

    if (!this._valuesToMeasure.length) {
      process.nextTick(cb.bind(this, null, knownLength));
      return;
    }

    parallel(this._valuesToMeasure, this._lengthRetriever, function (err, values) {
      if (err) {
        cb(err);
        return;
      }

      (values as number[]).forEach(function (length) {
        knownLength += length;
      });

      cb(null, knownLength);
    });
  }

  _error(err: any): void {
    if (!this.error) {
      this.error = err;
      this.pause();
      this.emit('error', err);
    }
  }

  toString(): string {
    return '[object FormData]';
  }
}

export default FormData;
