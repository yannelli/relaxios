'use strict';

// Node-only: relies on the built-in `http2` module. Browser builds replace
// `adapters/http.ts` (the sole importer) with `helpers/null.ts`.

import http2 from 'node:http2';
import util from 'node:util';

class Http2Sessions {
  sessions: Record<string, Array<[any, any]>>;

  constructor() {
    this.sessions = Object.create(null);
  }

  getSession(authority: string, options?: any): any {
    options = Object.assign(
      Object.create(null),
      {
        sessionTimeout: 1000,
      },
      options
    );

    let authoritySessions = this.sessions[authority];

    if (authoritySessions) {
      let len = authoritySessions.length;

      for (let i = 0; i < len; i++) {
        const [sessionHandle, sessionOptions] = authoritySessions[i];
        if (
          !sessionHandle.destroyed &&
          !sessionHandle.closed &&
          util.isDeepStrictEqual(sessionOptions, options)
        ) {
          return sessionHandle;
        }
      }
    }

    const session: any = http2.connect(authority, options);

    let removed: boolean | undefined;
    let timer: any;

    const removeSession = () => {
      if (removed) {
        return;
      }

      removed = true;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      let entries = authoritySessions,
        len = entries.length,
        i = len;

      while (i--) {
        if (entries[i][0] === session) {
          if (len === 1) {
            delete this.sessions[authority];
          } else {
            entries.splice(i, 1);
          }
          if (!session.closed) {
            session.close();
          }
          return;
        }
      }
    };

    const originalRequestFn = session.request;

    const { sessionTimeout } = options;

    if (sessionTimeout != null) {
      let streamsCount = 0;

      session.request = function (this: any) {
        const stream = originalRequestFn.apply(this, arguments);

        streamsCount++;

        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        stream.once('close', () => {
          if (!--streamsCount) {
            timer = setTimeout(() => {
              timer = null;
              removeSession();
            }, sessionTimeout);
          }
        });

        return stream;
      };
    }

    session.once('close', removeSession);
    session.once('error', removeSession);

    let entry: [any, any] = [session, options];

    authoritySessions
      ? authoritySessions.push(entry)
      : (authoritySessions = this.sessions[authority] = [entry]);

    return session;
  }
}

export default Http2Sessions;
