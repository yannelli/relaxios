import utils from '../utils';

const callbackify = (fn: any, reducer?: (value: any) => any[]): any => {
  return utils.isAsyncFn(fn)
    ? function (this: any, ...args: any[]) {
        const cb = args.pop();
        fn.apply(this, args).then((value: any) => {
          try {
            reducer ? cb(null, ...reducer(value)) : cb(null, value);
          } catch (err) {
            cb(err);
          }
        }, cb);
      }
    : fn;
};

export default callbackify;
