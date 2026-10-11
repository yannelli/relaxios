'use strict';

import http from 'node:http';
import https from 'node:https';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import shouldBypassProxy from '../../helpers/shouldBypassProxy';
import { getProxyForUrl } from './proxyFromEnv';
import HttpsProxyAgent, { isHttpsProxyAgent } from './HttpsProxyAgent';
import { isHttps, kAxiosInstalledTunnel } from './shared';

// Cache of CONNECT-tunneling agents keyed by proxy config so repeat requests
// through the same proxy reuse a single agent (and its socket pool). The
// keyspace is bounded by the set of distinct proxy configs the process uses.
const tunnelingAgentCache = new Map<string, any>();
const tunnelingAgentCacheUser = new WeakMap<any, Map<string, any>>();
// Minimum minor versions where Node's HTTP Agent supports native proxyEnv
// handling. Checking the selected agent below also covers startup modes such
// as NODE_OPTIONS=--use-env-proxy and --no-use-env-proxy precedence.
const NODE_NATIVE_ENV_PROXY_SUPPORT: Record<number, number> = {
  22: 21,
  24: 5,
};

function isNodeNativeEnvProxySupported(
  nodeVersion: any = process.versions && process.versions.node
): boolean {
  if (!nodeVersion) {
    return false;
  }

  const [major, minor] = nodeVersion.split('.').map((part: string) => Number(part));

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return false;
  }

  if (major > 24) {
    return true;
  }

  return (
    NODE_NATIVE_ENV_PROXY_SUPPORT[major] != null && minor >= NODE_NATIVE_ENV_PROXY_SUPPORT[major]
  );
}

export function isNodeEnvProxyEnabled(
  agent: any,
  nodeVersion: any = process.versions && process.versions.node
): boolean {
  if (!isNodeNativeEnvProxySupported(nodeVersion)) {
    return false;
  }

  const agentOptions = agent && agent.options;

  return Boolean(
    agentOptions && utils.hasOwnProp(agentOptions, 'proxyEnv') && agentOptions.proxyEnv != null
  );
}

function getProxyEnvAgent(options: any, configHttpAgent: any, configHttpsAgent: any): any {
  return isHttps.test(options.protocol)
    ? configHttpsAgent || https.globalAgent
    : configHttpAgent || http.globalAgent;
}

function getTunnelingAgent(agentOptions: any, userHttpsAgent: any): any {
  const key =
    agentOptions.protocol +
    '//' +
    agentOptions.hostname +
    ':' +
    (agentOptions.port || '') +
    '#' +
    (agentOptions.auth || '');
  const cache = userHttpsAgent
    ? tunnelingAgentCacheUser.get(userHttpsAgent) ||
      (tunnelingAgentCacheUser.set(userHttpsAgent, new Map()).get(userHttpsAgent) as Map<
        string,
        any
      >)
    : tunnelingAgentCache;
  let agent = cache.get(key);
  if (agent) return agent;
  // Forward the user's TLS options (custom CA, rejectUnauthorized, client cert,
  // etc.) into the tunneling agent so they apply to the origin TLS upgrade
  // done after CONNECT. Our proxy fields take precedence on conflict.
  const merged =
    userHttpsAgent && userHttpsAgent.options
      ? { ...userHttpsAgent.options, ...agentOptions }
      : agentOptions;
  agent = new HttpsProxyAgent(merged);
  if (userHttpsAgent && userHttpsAgent.options) {
    const originTLSOptions = { ...userHttpsAgent.options };
    const callback = agent.callback;
    agent.callback = function axiosTunnelingAgentCallback(this: any, req: any, opts: any) {
      // HttpsProxyAgent v5 reads callback opts for the post-CONNECT origin TLS upgrade.
      return callback.call(this, req, { ...originTLSOptions, ...opts });
    };
  }
  agent[kAxiosInstalledTunnel] = true;
  cache.set(key, agent);
  return agent;
}

// Applies config or environment proxy settings to the request options and
// returns whether a proxy applies to the selected transport.
export function setProxy(
  options: any,
  configProxy: any,
  location: string,
  isRedirect?: boolean,
  configHttpsAgent?: any,
  configHttpAgent?: any,
  allowEnvProxy: boolean = true
): boolean {
  let proxy: any = configProxy;
  const proxyEnvAgent = getProxyEnvAgent(options, configHttpAgent, configHttpsAgent);
  if (!proxy && proxy !== false && allowEnvProxy && !isNodeEnvProxyEnabled(proxyEnvAgent)) {
    const proxyUrl = getProxyForUrl(location);
    if (proxyUrl) {
      if (!shouldBypassProxy(location)) {
        proxy = new URL(proxyUrl);
      }
    }
  }
  // On redirect re-invocation, strip any stale Proxy-Authorization header carried
  // over from the earlier request. Skip on the first request so user-supplied
  // headers are preserved. Header names are case-insensitive, so remove every case variant.
  if (isRedirect && options.headers) {
    for (const name of Object.keys(options.headers)) {
      if (name.toLowerCase() === 'proxy-authorization') {
        delete options.headers[name];
      }
    }
  }
  // Strip any tunneling agent we installed for the earlier hop so a redirect
  // that drops the proxy or crosses an HTTPS/HTTP boundary doesn't reuse a
  // stale one. The Symbol marker leaves a user-supplied HttpsProxyAgent alone.
  if (isRedirect && options.agent && options.agent[kAxiosInstalledTunnel]) {
    options.agent = undefined;
  }
  if (proxy) {
    // Read proxy fields without traversing the prototype chain. URL instances
    // expose fields via prototype getters, but plain object proxies and the
    // `auth` field must be guarded against a polluted Object.prototype.
    const isProxyURL = proxy instanceof URL;
    const readProxyField = (key: string) =>
      isProxyURL || utils.hasOwnProp(proxy, key) ? proxy[key] : undefined;

    const proxyUsername = readProxyField('username');
    const proxyPassword = readProxyField('password');
    let proxyAuth: any = utils.hasOwnProp(proxy, 'auth') ? proxy.auth : undefined;

    // Basic proxy authorization
    if (proxyUsername) {
      proxyAuth = (proxyUsername || '') + ':' + (proxyPassword || '');
    }

    if (proxyAuth) {
      // Support proxy auth object form. Read sub-fields via own-prop checks so a
      // plain object inheriting from polluted Object.prototype cannot leak creds.
      const authIsObject = typeof proxyAuth === 'object';
      const authUsername =
        authIsObject && utils.hasOwnProp(proxyAuth, 'username') ? proxyAuth.username : undefined;
      const authPassword =
        authIsObject && utils.hasOwnProp(proxyAuth, 'password') ? proxyAuth.password : undefined;
      const validProxyAuth = Boolean(authUsername || authPassword);

      if (validProxyAuth) {
        proxyAuth = (authUsername || '') + ':' + (authPassword || '');
      } else if (authIsObject) {
        throw new AxiosError('Invalid proxy authorization', AxiosError.ERR_BAD_OPTION, { proxy });
      }
    }

    const targetIsHttps = isHttps.test(options.protocol);

    if (targetIsHttps) {
      // CONNECT-tunneling path for HTTPS targets keeps end-to-end TLS to the
      // origin. HttpsProxyAgent sends Proxy-Authorization on the CONNECT only.
      // A user-supplied HttpsProxyAgent owns tunneling end-to-end and is left alone.
      if (!isHttpsProxyAgent(configHttpsAgent)) {
        const proxyHost = readProxyField('hostname') || readProxyField('host');
        const proxyPort = readProxyField('port');
        const rawProxyProtocol = readProxyField('protocol');
        const normalizedProtocol = rawProxyProtocol
          ? rawProxyProtocol.includes(':')
            ? rawProxyProtocol
            : `${rawProxyProtocol}:`
          : 'http:';
        // Bracket IPv6 literals for URL parsing; URL.hostname strips the
        // brackets again on read so the agent receives the raw form.
        const proxyHostForURL =
          proxyHost && proxyHost.includes(':') && !proxyHost.startsWith('[')
            ? `[${proxyHost}]`
            : proxyHost;
        const proxyURL = new URL(
          `${normalizedProtocol}//${proxyHostForURL}${proxyPort ? ':' + proxyPort : ''}`
        );
        const agentOptions: any = {
          protocol: proxyURL.protocol,
          hostname: proxyURL.hostname.replace(/^\[|\]$/g, ''),
          port: proxyURL.port,
          auth: proxyAuth && typeof proxyAuth === 'string' ? proxyAuth : undefined,
        };
        if (proxyURL.protocol === 'https:') {
          agentOptions.ALPNProtocols = ['http/1.1'];
        }
        const tunnelingAgent = getTunnelingAgent(agentOptions, configHttpsAgent);
        // `options.agent` is consumed by the native https.request path
        // (maxRedirects === 0); `options.agents.https` by follow-redirects,
        // which ignores `options.agent` when `options.agents` is present.
        options.agent = tunnelingAgent;
        if (options.agents) {
          options.agents.https = tunnelingAgent;
        }
      }
    } else {
      // Forward-proxy mode for plaintext HTTP targets: the request line carries
      // the absolute URL and the proxy sees everything.
      if (proxyAuth) {
        const base64 = Buffer.from(proxyAuth, 'utf8').toString('base64');
        options.headers['Proxy-Authorization'] = 'Basic ' + base64;
      }

      // Preserve a user-supplied Host header (case-insensitive) so callers can override
      // the value forwarded to the proxy; otherwise default to the request URL's host.
      let hasUserHostHeader = false;
      for (const name of Object.keys(options.headers)) {
        if (name.toLowerCase() === 'host') {
          hasUserHostHeader = true;
          break;
        }
      }
      if (!hasUserHostHeader) {
        options.headers.host = options.hostname + (options.port ? ':' + options.port : '');
      }
      const proxyHost = readProxyField('hostname') || readProxyField('host');
      options.hostname = proxyHost;
      // Replace 'host' since options is not a URL object
      options.host = proxyHost;
      options.port = readProxyField('port');
      options.path = location;
      const proxyProtocol = readProxyField('protocol');
      if (proxyProtocol) {
        options.protocol = proxyProtocol.includes(':') ? proxyProtocol : `${proxyProtocol}:`;
      }
    }
  }

  options.beforeRedirects.proxy = function beforeRedirect(redirectOptions: any) {
    // Configure proxy for redirected request, passing the original config proxy to apply
    // the exact same logic as if the redirected request was sent by axios directly.
    setProxy(
      redirectOptions,
      configProxy,
      redirectOptions.href,
      true,
      configHttpsAgent,
      configHttpAgent,
      allowEnvProxy
    );
  };

  return Boolean(
    proxy || (configProxy !== false && allowEnvProxy && isNodeEnvProxyEnabled(proxyEnvAgent))
  );
}
