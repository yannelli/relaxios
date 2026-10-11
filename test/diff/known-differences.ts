// Cases where fetchwire/axios differs from axios 1.20.0 on Node (http adapter), with the reason.
// Each key must appear in docs/migration.md (checked by test/docs.test.ts).
export const KNOWN_DIFFERENCES: Record<string, string> = {
  'arraybuffer response': 'Returns an ArrayBuffer (as browser axios does), not a Node Buffer.',
  'stream response': 'Returns a web ReadableStream, not a Node stream.Readable.',
  'blob response': 'Returns a Blob. axios on Node returns a string for responseType blob.',
  'get with data in config': 'GET and HEAD bodies are dropped, as XMLHttpRequest does. The Node http adapter sends them.',
  'postForm with Blob': 'Blob values work in postForm and toFormData. axios on Node rejects them.',
  'connection refused': 'Network failures use code ERR_NETWORK and message "Network Error" (browser axios behavior), not ECONNREFUSED.',
  'relative url without baseURL': 'Relative URLs fail with ERR_NETWORK on servers. axios throws a TypeError with code ERR_INVALID_URL.',
  'upload progress outside browsers': 'onUploadProgress fires only where XMLHttpRequest exists (browsers, webviews).',
  'decompress false': 'Ignored: fetch always decodes Content-Encoding.',
  'maxContentLength exceeded': 'Ignored: no response size limit.',
  'maxBodyLength exceeded': 'Ignored: no request size limit.',
};
