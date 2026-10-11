import type {
  AxiosHeaders,
  AxiosRequestHeaders,
  AxiosResponseHeaders,
  MethodsHeaders,
  RawAxiosRequestHeaders,
  RawAxiosResponseHeaders,
} from './headers';
import type { HttpStatusCode } from './status';
import type { CancelToken } from './cancel';

export type StringLiteralsOrString<Literals extends string> = Literals | (string & {});

export interface AxiosRequestTransformer {
  (this: InternalAxiosRequestConfig, data: any, headers: AxiosRequestHeaders): any;
}

export interface AxiosResponseTransformer {
  (this: InternalAxiosRequestConfig, data: any, headers: AxiosResponseHeaders, status?: number): any;
}

export interface AxiosAdapter {
  (config: InternalAxiosRequestConfig): AxiosPromise;
}

export interface AxiosBasicCredentials {
  username: string;
  password: string;
}

export interface AxiosProxyConfig {
  host: string;
  port: number;
  auth?: AxiosBasicCredentials;
  protocol?: string;
}

export type UppercaseMethod =
  | 'GET'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'PURGE'
  | 'LINK'
  | 'UNLINK'
  | 'QUERY';

export type Method = (UppercaseMethod | Lowercase<UppercaseMethod>) & {};

export type ResponseType = 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream' | 'formdata';

export type UppercaseResponseEncoding =
  | 'ASCII'
  | 'ANSI'
  | 'BINARY'
  | 'BASE64'
  | 'BASE64URL'
  | 'HEX'
  | 'LATIN1'
  | 'UCS-2'
  | 'UCS2'
  | 'UTF-8'
  | 'UTF8'
  | 'UTF16LE';

export type responseEncoding = (UppercaseResponseEncoding | Lowercase<UppercaseResponseEncoding>) & {};

export interface TransitionalOptions {
  silentJSONParsing?: boolean;
  forcedJSONParsing?: boolean;
  clarifyTimeoutError?: boolean;
  legacyInterceptorReqResOrdering?: boolean;
  advertiseZstdAcceptEncoding?: boolean;
  validateStatusUndefinedResolves?: boolean;
}

export interface GenericAbortSignal {
  readonly aborted: boolean;
  onabort?: ((...args: any) => any) | null;
  addEventListener?: (...args: any) => any;
  removeEventListener?: (...args: any) => any;
}

export interface FormDataVisitorHelpers {
  defaultVisitor: SerializerVisitor;
  convertValue: (value: any) => any;
  isVisitable: (value: any) => boolean;
}

export interface SerializerVisitor {
  (
    this: GenericFormData,
    value: any,
    key: string | number,
    path: null | Array<string | number>,
    helpers: FormDataVisitorHelpers
  ): boolean;
}

export interface SerializerOptions {
  visitor?: SerializerVisitor;
  dots?: boolean;
  metaTokens?: boolean;
  indexes?: boolean | null;
  maxDepth?: number;
  Blob?: { new (...args: any[]): any };
}

// tslint:disable-next-line
export interface FormSerializerOptions extends SerializerOptions {}

export interface ParamEncoder {
  (value: any, defaultEncoder: (value: any) => any): any;
}

export interface CustomParamsSerializer<P = Record<string, any>> {
  (params: P, options?: ParamsSerializerOptions<P>): string;
}

export interface ParamsSerializerOptions<P = Record<string, any>> extends SerializerOptions {
  encode?: ParamEncoder;
  serialize?: CustomParamsSerializer<P>;
}

export type MaxUploadRate = number;

export type MaxDownloadRate = number;

export type BrowserProgressEvent = any;

export interface AxiosProgressEvent {
  loaded: number;
  total?: number;
  progress?: number;
  bytes: number;
  rate?: number;
  estimated?: number;
  upload?: boolean;
  download?: boolean;
  event?: BrowserProgressEvent;
  lengthComputable: boolean;
}

export type Milliseconds = number;

export type AxiosAdapterName = StringLiteralsOrString<'xhr' | 'http' | 'fetch'>;

export type AxiosAdapterConfig = AxiosAdapter | AxiosAdapterName;

export type AddressFamily = 4 | 6 | undefined;

export interface LookupAddressEntry {
  address: string;
  family?: AddressFamily;
}

export type LookupAddress = string | LookupAddressEntry;

export type HttpVersion = 1 | 2;

export interface AxiosRequestConfig<D = any, P = any> {
  url?: string;
  method?: StringLiteralsOrString<Method>;
  baseURL?: string;
  allowAbsoluteUrls?: boolean;
  transformRequest?: AxiosRequestTransformer | AxiosRequestTransformer[];
  transformResponse?: AxiosResponseTransformer | AxiosResponseTransformer[];
  headers?: (RawAxiosRequestHeaders & MethodsHeaders) | AxiosHeaders;
  params?: P;
  paramsSerializer?:
    | ParamsSerializerOptions<unknown extends P ? Record<string, any> : P>
    | CustomParamsSerializer<unknown extends P ? Record<string, any> : P>;
  data?: D;
  timeout?: Milliseconds;
  timeoutErrorMessage?: string;
  withCredentials?: boolean;
  adapter?: AxiosAdapterConfig | AxiosAdapterConfig[];
  auth?: AxiosBasicCredentials;
  responseType?: ResponseType;
  responseEncoding?: StringLiteralsOrString<responseEncoding>;
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void;
  maxContentLength?: number;
  validateStatus?: ((status: number) => boolean) | null;
  maxBodyLength?: number;
  maxRedirects?: number;
  maxRate?: number | [MaxUploadRate, MaxDownloadRate];
  beforeRedirect?: (
    options: Record<string, any>,
    responseDetails: {
      headers: Record<string, string>;
      statusCode: HttpStatusCode;
    },
    requestDetails: {
      headers: Record<string, string>;
      url: string;
      method: string;
    }
  ) => void;
  socketPath?: string | null;
  allowedSocketPaths?: string | string[] | null;
  transport?: any;
  httpAgent?: any;
  httpsAgent?: any;
  proxy?: AxiosProxyConfig | false;
  cancelToken?: CancelToken | undefined;
  decompress?: boolean;
  transitional?: TransitionalOptions;
  signal?: GenericAbortSignal;
  insecureHTTPParser?: boolean;
  env?: {
    FormData?: new (...args: any[]) => object;
    fetch?: (input: URL | Request | string, init?: RequestInit) => Promise<Response>;
    Request?: new (input: URL | Request | string, init?: RequestInit) => Request;
    Response?: new (
      body?: ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams | string | null,
      init?: ResponseInit
    ) => Response;
  };
  formSerializer?: FormSerializerOptions;
  family?: AddressFamily;
  lookup?:
    | ((
        hostname: string,
        options: object,
        cb: (err: Error | null, address: LookupAddress | LookupAddress[], family?: AddressFamily) => void
      ) => void)
    | ((
        hostname: string,
        options: object
      ) => Promise<[address: LookupAddressEntry | LookupAddressEntry[], family?: AddressFamily] | LookupAddress>);
  withXSRFToken?: boolean | ((config: InternalAxiosRequestConfig<D, P>) => boolean | undefined);
  parseReviver?: (this: any, key: string, value: any, context?: { source?: string }) => any;
  fetchOptions?: Omit<RequestInit, 'body' | 'headers' | 'method' | 'signal'> | Record<string, any>;
  httpVersion?: HttpVersion;
  http2Options?: Record<string, any> & {
    sessionTimeout?: number;
  };
  formDataHeaderPolicy?: 'legacy' | 'content-only';
  redact?: string[];
  sensitiveHeaders?: string[];
}

// Alias
export type RawAxiosRequestConfig<D = any, P = any> = AxiosRequestConfig<D, P>;

export interface InternalAxiosRequestConfig<D = any, P = any> extends AxiosRequestConfig<D, P> {
  headers: AxiosRequestHeaders;
}

export interface HeadersDefaults {
  common: RawAxiosRequestHeaders;
  delete: RawAxiosRequestHeaders;
  get: RawAxiosRequestHeaders;
  head: RawAxiosRequestHeaders;
  post: RawAxiosRequestHeaders;
  put: RawAxiosRequestHeaders;
  patch: RawAxiosRequestHeaders;
  options?: RawAxiosRequestHeaders;
  purge?: RawAxiosRequestHeaders;
  link?: RawAxiosRequestHeaders;
  unlink?: RawAxiosRequestHeaders;
  query?: RawAxiosRequestHeaders;
}

export interface AxiosDefaults<D = any, P = any> extends Omit<AxiosRequestConfig<D, P>, 'headers'> {
  headers: HeadersDefaults;
}

export interface CreateAxiosDefaults<D = any, P = any> extends Omit<AxiosRequestConfig<D, P>, 'headers'> {
  headers?: RawAxiosRequestHeaders | AxiosHeaders | Partial<HeadersDefaults>;
}

export interface AxiosResponse<T = any, D = any, H = {}, P = any> {
  data: T;
  status: number;
  statusText: string;
  headers: (H & RawAxiosResponseHeaders) | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig<D, P>;
  request?: any;
}

export type AxiosPromise<T = any, D = any, P = any> = Promise<AxiosResponse<T, D, {}, P>>;

export interface GenericFormData {
  append(name: string, value: any, options?: any): any;
}

export interface GenericHTMLFormElement {
  name: string;
  method: string;
  submit(): void;
}
