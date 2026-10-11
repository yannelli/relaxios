import platform from './node/index';
import * as utils from './common/utils';

export interface Platform {
  isNode?: boolean;
  isBrowser?: boolean;
  classes: { URLSearchParams: any; FormData: any; Blob: any };
  ALPHABET: { DIGIT: string; ALPHA: string; ALPHA_DIGIT: string };
  generateString: (size?: number, alphabet?: string) => string;
  protocols: string[];
  hasBrowserEnv: boolean;
  hasStandardBrowserWebWorkerEnv: boolean;
  hasStandardBrowserEnv: boolean;
  navigator: Navigator | undefined;
  origin: string;
}

const merged: Platform = {
  ...utils,
  ...platform,
};

export default merged;
