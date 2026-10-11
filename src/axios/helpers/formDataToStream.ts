import util from 'node:util';
import { Readable } from 'node:stream';
import utils from '../utils';
import readBlob from './readBlob';
import platform from '../platform/index';

const BOUNDARY_ALPHABET = platform.ALPHABET.ALPHA_DIGIT + '-_';

const textEncoder = typeof TextEncoder === 'function' ? new TextEncoder() : new util.TextEncoder();

const CRLF = '\r\n';
const CRLF_BYTES = textEncoder.encode(CRLF);
const CRLF_BYTES_COUNT = 2;

class FormDataPart {
  headers: Uint8Array;
  contentLength: number;
  size: number;
  name: string;
  value: any;

  constructor(name: string, value: any) {
    const { escapeName } = this.constructor as typeof FormDataPart;
    const isStringValue = utils.isString(value);

    let headers = `Content-Disposition: form-data; name="${escapeName(name)}"${
      !isStringValue && value.name ? `; filename="${escapeName(value.name)}"` : ''
    }${CRLF}`;

    if (isStringValue) {
      value = textEncoder.encode(String(value).replace(/\r?\n|\r\n?/g, CRLF));
    } else {
      const safeType = String(value.type || 'application/octet-stream').replace(/[\r\n]/g, '');
      headers += `Content-Type: ${safeType}${CRLF}`;
    }

    this.headers = textEncoder.encode(headers + CRLF);

    this.contentLength = isStringValue ? value.byteLength : value.size;

    this.size = this.headers.byteLength + this.contentLength + CRLF_BYTES_COUNT;

    this.name = name;
    this.value = value;
  }

  async *encode(): AsyncGenerator<any> {
    yield this.headers;

    const { value } = this;

    if (utils.isTypedArray(value)) {
      yield value;
    } else {
      yield* readBlob(value);
    }

    yield CRLF_BYTES;
  }

  static escapeName(name: any): string {
    return String(name).replace(
      /[\r\n"]/g,
      (match) =>
        (
          {
            '\r': '%0D',
            '\n': '%0A',
            '"': '%22',
          } as Record<string, string>
        )[match]
    );
  }
}

const formDataToStream = (
  form: any,
  headersHandler?: (headers: Record<string, any>) => void,
  options?: { tag?: string; size?: number; boundary?: string }
): Readable => {
  const {
    tag = 'form-data-boundary',
    size = 25,
    boundary = tag + '-' + platform.generateString(size, BOUNDARY_ALPHABET),
  } = options || {};

  if (!utils.isFormData(form)) {
    throw new TypeError('FormData instance required');
  }

  if (boundary.length < 1 || boundary.length > 70) {
    throw new Error('boundary must be 1-70 characters long');
  }

  const boundaryBytes = textEncoder.encode('--' + boundary + CRLF);
  const footerBytes = textEncoder.encode('--' + boundary + '--' + CRLF);
  let contentLength: any = footerBytes.byteLength;

  const parts: FormDataPart[] = Array.from(form.entries() as Iterable<[string, any]>).map(
    ([name, value]) => {
      const part = new FormDataPart(name, value);
      contentLength += part.size;
      return part;
    }
  );

  contentLength += boundaryBytes.byteLength * parts.length;

  contentLength = utils.toFiniteNumber(contentLength);

  const computedHeaders: Record<string, any> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  };

  if (Number.isFinite(contentLength)) {
    computedHeaders['Content-Length'] = contentLength;
  }

  headersHandler && headersHandler(computedHeaders);

  return Readable.from(
    (async function* () {
      for (const part of parts) {
        yield boundaryBytes;
        yield* part.encode();
      }

      yield footerBytes;
    })()
  );
};

export default formDataToStream;
