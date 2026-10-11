import platform from '../platform/index';

const isURLSameOrigin: (url: any) => boolean = platform.hasStandardBrowserEnv
  ? ((origin: URL, isMSIE: any) => (url: any) => {
      const parsed = new URL(url, platform.origin);

      return (
        origin.protocol === parsed.protocol &&
        origin.host === parsed.host &&
        (isMSIE || origin.port === parsed.port)
      );
    })(
      new URL(platform.origin),
      platform.navigator && /(msie|trident)/i.test(platform.navigator.userAgent)
    )
  : () => true;

export default isURLSameOrigin;
