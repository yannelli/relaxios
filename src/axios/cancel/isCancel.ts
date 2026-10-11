'use strict';

export default function isCancel(value: any): boolean {
  return !!(value && value.__CANCEL__);
}
