import { decodeText, encodingName, parseDocument, parseMime, resolveDecoder } from './decode';
import type { MimeInfo } from './decode';

const XHR_RESPONSE_TYPES = ['', 'arraybuffer', 'blob', 'document', 'text'];

// XHR ignores responseType values outside its enum, and axios never sets 'json' on it.
export const toXHRResponseType = (responseType: any): string =>
  typeof responseType === 'string' &&
  responseType !== 'json' &&
  XHR_RESPONSE_TYPES.includes(responseType)
    ? responseType
    : '';

const invalidState = (message: string) => new DOMException(message, 'InvalidStateError');

const define = (target: any, name: string, value: any) =>
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });

const defineGetter = (target: any, name: string, get: () => any) =>
  Object.defineProperty(target, name, { get, enumerable: false, configurable: true });

// Own EventTarget-style functions: the inherited native ones reject a non-native receiver.
const makeEventTarget = (target: any) => {
  const listeners = new Map<string, Set<any>>();

  define(target, 'addEventListener', (type: string, listener: any) => {
    if (!listener) return;
    let set = listeners.get(type);
    set || listeners.set(type, (set = new Set()));
    set.add(listener);
  });

  define(target, 'removeEventListener', (type: string, listener: any) => {
    const set = listeners.get(type);
    set && set.delete(listener);
  });

  define(target, 'dispatchEvent', (event: any) => {
    const handler = target['on' + event.type];
    typeof handler === 'function' && handler.call(target, event);
    const set = listeners.get(event.type);
    set &&
      Array.from(set).forEach((listener) =>
        typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event)
      );
    return !event.defaultPrevented;
  });
};

const EVENT_SLOTS = [
  'onloadstart',
  'onprogress',
  'onabort',
  'onerror',
  'onload',
  'ontimeout',
  'onloadend',
];

const createUpload = (source?: any) => {
  const proto =
    typeof XMLHttpRequestUpload !== 'undefined' ? XMLHttpRequestUpload.prototype : null;
  const upload = Object.create(proto);
  EVENT_SLOTS.forEach((slot) => define(upload, slot, null));
  makeEventTarget(upload);
  copyEngineGetters(upload, source);
  return upload;
};

export interface StandinInit {
  responseType: any;
  timeout: number;
  withCredentials: boolean;
  probe?: any;
  onAbort: () => void;
}

// Engine-specific getters (Firefox's mozAnon, for example) get their value from an unsent
// real XMLHttpRequest, so nothing on the prototype chain is ever reached through the stand-in.
const copyEngineGetters = (target: any, source: any) => {
  if (!source) return;
  const stop = typeof EventTarget !== 'undefined' ? EventTarget.prototype : null;
  for (let proto = Object.getPrototypeOf(target); proto && proto !== stop; proto = Object.getPrototypeOf(proto)) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (!descriptor.get || Object.prototype.hasOwnProperty.call(target, name)) continue;
      let value;
      try {
        value = source[name];
      } catch (e) {
        continue;
      }
      define(target, name, value);
    }
  }
};

export interface StandinBody {
  buffer?: ArrayBuffer | null;
  blob?: any;
  nullBody?: boolean;
}

export interface StandinHandle {
  request: any;
  start(): void;
  receive(response: any, responseURL?: string): void;
  loading(): void;
  load(body: StandinBody): void;
  fail(): void;
}

const RESPONSE_TEXT_ERROR = (type: string) =>
  `Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text' (was '${type}').`;

const RESPONSE_XML_ERROR = (type: string) =>
  `Failed to read the 'responseXML' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'document' (was '${type}').`;

// Builds an XMLHttpRequest-shaped object (instanceof XMLHttpRequest) whose readable members
// are own properties, so no native prototype getter ever runs against it.
export const createXHRStandin = (init: StandinInit): StandinHandle => {
  const proto = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype : null;
  const request = Object.create(proto);
  const responseType = toXHRResponseType(init.responseType);
  const isText = responseType === '' || responseType === 'text';
  let sent = false;

  const st = {
    readyState: 1,
    status: 0,
    statusText: '',
    responseURL: '',
    headers: [] as [string, string][],
    mime: parseMime(null) as MimeInfo,
    bytes: null as Uint8Array | null,
    buffer: null as ArrayBuffer | null,
    blob: null as any,
    nullBody: true,
    text: '',
    doc: undefined as any,
  };

  const reset = (readyState: number) => {
    st.readyState = readyState;
    st.status = 0;
    st.statusText = '';
    st.responseURL = '';
    st.headers = [];
    st.mime = parseMime(null);
    st.bytes = null;
    st.buffer = null;
    st.blob = null;
    st.nullBody = true;
    st.text = '';
    st.doc = undefined;
  };

  const document = () => {
    if (st.doc === undefined) {
      if (st.nullBody || !st.bytes) {
        st.doc = null;
      } else {
        const decoder = resolveDecoder(st.bytes, st.mime, responseType);
        const text = isText ? st.text : decoder.decode(st.bytes);
        st.doc = parseDocument(text, st.mime, responseType, encodingName(decoder));
      }
    }
    return st.doc;
  };

  defineGetter(request, 'readyState', () => st.readyState);
  defineGetter(request, 'status', () => st.status);
  defineGetter(request, 'statusText', () => st.statusText);
  defineGetter(request, 'responseURL', () => st.responseURL);

  defineGetter(request, 'response', () => {
    if (isText) return st.text;
    if (st.readyState !== 4) return null;
    if (responseType === 'arraybuffer') return st.buffer;
    if (responseType === 'blob') return st.blob;
    return document();
  });

  defineGetter(request, 'responseText', () => {
    if (!isText) throw invalidState(RESPONSE_TEXT_ERROR(responseType));
    return st.text;
  });

  defineGetter(request, 'responseXML', () => {
    if (responseType !== '' && responseType !== 'document') {
      throw invalidState(RESPONSE_XML_ERROR(responseType));
    }
    return st.readyState === 4 ? document() : null;
  });

  define(request, 'responseType', responseType);
  define(request, 'timeout', init.timeout);
  define(request, 'withCredentials', init.withCredentials);
  define(request, 'upload', createUpload(init.probe && init.probe.upload));
  ['onreadystatechange'].concat(EVENT_SLOTS).forEach((slot) => define(request, slot, null));

  define(request, 'getAllResponseHeaders', () =>
    st.headers.map(([name, value]) => name + ': ' + value + '\r\n').join('')
  );

  define(request, 'getResponseHeader', (name: any) => {
    const lower = String(name).toLowerCase();
    const found = st.headers.find(([header]) => header === lower);
    return found ? found[1] : null;
  });

  // abort() before send() leaves a real XHR OPENED; afterwards it ends UNSENT.
  define(request, 'abort', () => {
    sent && reset(0);
    init.onAbort();
  });

  define(request, 'open', () => {});
  define(request, 'setRequestHeader', () => {});

  define(request, 'send', () => {
    if (st.readyState !== 1) {
      throw invalidState(
        "Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED."
      );
    }
  });

  define(request, 'overrideMimeType', () => {
    if (st.readyState === 3 || st.readyState === 4) {
      throw invalidState(
        "Failed to execute 'overrideMimeType' on 'XMLHttpRequest': MimeType cannot be overridden when the state is LOADING or DONE."
      );
    }
  });

  makeEventTarget(request);
  copyEngineGetters(request, init.probe);

  return {
    request,

    start() {
      sent = true;
    },

    receive(response: any, responseURL?: string) {
      st.readyState = 2;
      st.status = response.status;
      st.statusText = response.statusText;
      st.responseURL = responseURL !== undefined ? responseURL : response.url || '';
      st.headers = [];
      response.headers.forEach((value: string, name: string) => {
        st.headers.push([name, value]);
      });
      st.mime = parseMime(response.headers.get('content-type'));
    },

    loading() {
      st.readyState === 2 && (st.readyState = 3);
    },

    load(body: StandinBody) {
      st.readyState = 4;
      st.buffer = body.buffer || null;
      st.bytes = st.buffer ? new Uint8Array(st.buffer) : null;
      st.blob = body.blob || null;
      st.nullBody = !!body.nullBody;
      st.doc = undefined;
      st.text = isText && st.bytes ? decodeText(st.bytes, st.mime, responseType) : '';
    },

    fail() {
      reset(4);
    },
  };
};
