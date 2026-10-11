// XHR-style response decoding: MIME parsing, BOM/charset text decoding and document parsing.

export interface MimeInfo {
  essence: string;
  charset: string | undefined;
}

// XHR's "get a response MIME type" falls back to text/xml when the header is missing or invalid.
export const parseMime = (contentType: string | null | undefined): MimeInfo => {
  const parts = String(contentType == null ? '' : contentType).split(';');
  const essence = parts[0].trim().toLowerCase();
  let charset: string | undefined;

  if (!/^[^\s/]+\/[^\s;]+$/.test(essence)) {
    return { essence: 'text/xml', charset: undefined };
  }

  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    const name = parts[i].slice(0, eq).trim().toLowerCase();
    if (name !== 'charset' || charset !== undefined) continue;
    let value = parts[i].slice(eq + 1).trim();
    if (value.startsWith('"')) {
      value = value.slice(1, value.endsWith('"') && value.length > 1 ? -1 : undefined);
    }
    value && (charset = value);
  }

  return { essence, charset };
};

export const isXMLMime = (essence: string) =>
  essence === 'text/xml' || essence === 'application/xml' || essence.endsWith('+xml');

export const isHTMLMime = (essence: string) => essence === 'text/html';

const sniffBOM = (bytes: Uint8Array): string | undefined => {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  if (bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  }
  return undefined;
};

const latin1Head = (bytes: Uint8Array) => {
  let head = '';
  const len = Math.min(bytes.length, 1024);
  for (let i = 0; i < len; i++) {
    head += String.fromCharCode(bytes[i]);
  }
  return head;
};

const xmlDeclaredEncoding = (bytes: Uint8Array) => {
  const match = /^<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(latin1Head(bytes));
  return match ? match[1] : undefined;
};

const htmlPrescanEncoding = (bytes: Uint8Array) => {
  const match = /<meta[^>]*charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)/i.exec(latin1Head(bytes));
  return match ? match[1] : undefined;
};

const decoderFor = (label: string): TextDecoder | undefined => {
  try {
    return new TextDecoder(label);
  } catch (e) {
    return undefined;
  }
};

// Mirrors XHR's "get a text response" encoding choice: BOM, then the charset parameter,
// then XML or HTML sniffing where the spec allows it, then UTF-8.
export const resolveDecoder = (bytes: Uint8Array, mime: MimeInfo, responseType: string) => {
  let label = sniffBOM(bytes) || mime.charset;

  if (!label && responseType === '' && isXMLMime(mime.essence)) {
    label = xmlDeclaredEncoding(bytes);
  }

  if (!label && responseType === 'document') {
    label = isHTMLMime(mime.essence) ? htmlPrescanEncoding(bytes) : xmlDeclaredEncoding(bytes);
  }

  return (label && decoderFor(label)) || new TextDecoder('utf-8');
};

export const decodeText = (bytes: Uint8Array, mime: MimeInfo, responseType: string): string =>
  resolveDecoder(bytes, mime, responseType).decode(bytes);

const ENCODING_NAMES: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
  'iso-2022-jp': 'ISO-2022-JP',
  'euc-jp': 'EUC-JP',
  'euc-kr': 'EUC-KR',
  shift_jis: 'Shift_JIS',
  big5: 'Big5',
  gbk: 'GBK',
  ibm866: 'IBM866',
  'koi8-r': 'KOI8-R',
  'koi8-u': 'KOI8-U',
};

// Document.characterSet uses the Encoding Standard's names; TextDecoder lowercases them.
export const encodingName = (decoder: TextDecoder) =>
  ENCODING_NAMES[decoder.encoding] || decoder.encoding.replace(/^iso-/, 'ISO-');

const DOM_PARSER_XML_TYPES = ['text/xml', 'application/xml', 'application/xhtml+xml', 'image/svg+xml'];

// Mirrors XHR's "document response": HTML only for responseType 'document', XML for both,
// null for every other type or when the XML is not well-formed.
export const parseDocument = (
  text: string,
  mime: MimeInfo,
  responseType: string,
  encoding?: string
): any => {
  if (typeof DOMParser === 'undefined') {
    return null;
  }

  let type: any;

  if (isHTMLMime(mime.essence)) {
    if (responseType !== 'document') return null;
    type = 'text/html';
  } else if (isXMLMime(mime.essence)) {
    type = DOM_PARSER_XML_TYPES.includes(mime.essence) ? mime.essence : 'application/xml';
  } else {
    return null;
  }

  let doc: any;
  try {
    doc = new DOMParser().parseFromString(text, type);
  } catch (e) {
    return null;
  }

  if (type !== 'text/html' && doc.getElementsByTagName('parsererror').length) {
    return null;
  }

  // A real XHR document carries the response MIME type and the decoded charset
  // (Chrome reports UTF-8 for XML); DOMParser can take neither.
  if (type !== mime.essence) {
    Object.defineProperty(doc, 'contentType', { value: mime.essence, configurable: true });
  }
  if (encoding && doc.characterSet !== encoding) {
    ['characterSet', 'charset', 'inputEncoding'].forEach((name) => {
      Object.defineProperty(doc, name, { value: encoding, configurable: true });
    });
  }

  return doc;
};
