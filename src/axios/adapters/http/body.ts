'use strict';

import stream from 'node:stream';
import util from 'node:util';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import setFormDataHeaders from '../../core/setFormDataHeaders';
import { VERSION } from '../../env/data';
import AxiosTransformStream from '../../helpers/AxiosTransformStream';
import formDataToStream from '../../helpers/formDataToStream';
import readBlob from '../../helpers/readBlob';
import {
  progressEventReducer,
  progressEventDecorator,
  asyncDecorator,
} from '../../helpers/progressEventReducer';
import { flushOnFinish, scheduleProgress } from './shared';
import type { HttpContext } from './context';

// Normalizes config.data into a Buffer or stream, sets the content headers and
// wires upload progress and rate limiting. Returns false once rejected.
export async function prepareRequestBody(ctx: HttpContext): Promise<boolean> {
  const { config, own, reject, headers, maxBodyLength, onUploadProgress } = ctx;
  const maxRate = ctx.maxRate;
  let data = ctx.data;
  let maxUploadRate: any = undefined;
  let maxDownloadRate: any = undefined;

  // support for spec compliant FormData objects
  if (utils.isSpecCompliantForm(data)) {
    const userBoundary = headers.getContentType(/boundary=([-_\w\d]{10,70})/i);

    data = formDataToStream(
      data,
      (formHeaders: any) => {
        headers.set(formHeaders);
      },
      {
        tag: `axios-${VERSION}-boundary`,
        boundary: (userBoundary && userBoundary[1]) || undefined,
      }
    );
    // support for https://www.npmjs.com/package/form-data api
  } else if (
    utils.isFormData(data) &&
    utils.isFunction(data.getHeaders) &&
    data.getHeaders !== (Object.prototype as any).getHeaders
  ) {
    setFormDataHeaders(headers, data.getHeaders(), own('formDataHeaderPolicy'));

    if (!headers.hasContentLength()) {
      try {
        const knownLength = await util.promisify(data.getLength).call(data);
        Number.isFinite(knownLength) && knownLength >= 0 && headers.setContentLength(knownLength);
      } catch (e) {}
    }
  } else if (utils.isBlob(data) || utils.isFile(data)) {
    data.size && headers.setContentType(data.type || 'application/octet-stream');
    headers.setContentLength(data.size || 0);
    data = stream.Readable.from(readBlob(data));
  } else if (data && !utils.isStream(data)) {
    if (Buffer.isBuffer(data)) {
      // Nothing to do...
    } else if (utils.isArrayBuffer(data)) {
      data = Buffer.from(new Uint8Array(data));
    } else if (utils.isString(data)) {
      data = Buffer.from(data, 'utf-8');
    } else {
      reject(
        new AxiosError(
          'Data after transformation must be a string, an ArrayBuffer, a Buffer, or a Stream',
          AxiosError.ERR_BAD_REQUEST,
          config
        )
      );
      return false;
    }

    // Add Content-Length header if data exists
    headers.setContentLength(data.length, false);

    if (maxBodyLength > -1 && data.length > maxBodyLength) {
      reject(
        new AxiosError(
          'Request body larger than maxBodyLength limit',
          AxiosError.ERR_BAD_REQUEST,
          config
        )
      );
      return false;
    }
  }

  const contentLength = utils.toFiniteNumber(headers.getContentLength());

  if (utils.isArray(maxRate)) {
    maxUploadRate = maxRate[0];
    maxDownloadRate = maxRate[1];
  } else {
    maxUploadRate = maxDownloadRate = maxRate;
  }

  if (data && (onUploadProgress || maxUploadRate)) {
    if (!utils.isStream(data)) {
      data = stream.Readable.from(data, { objectMode: false });
    }

    data = stream.pipeline(
      [
        data,
        new AxiosTransformStream({
          maxRate: utils.toFiniteNumber(maxUploadRate),
        }),
      ] as any,
      utils.noop as any
    );

    onUploadProgress &&
      data.on(
        'progress',
        flushOnFinish(
          data,
          progressEventDecorator(
            contentLength,
            progressEventReducer(asyncDecorator(onUploadProgress, scheduleProgress), false, 3)
          ) as any
        )
      );
  }

  ctx.data = data;
  ctx.maxUploadRate = maxUploadRate;
  ctx.maxDownloadRate = maxDownloadRate;
  return true;
}
