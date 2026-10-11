const { asyncIterator } = Symbol;

const readBlob = async function* (blob: any): AsyncGenerator<any> {
  if (blob.stream) {
    yield* blob.stream();
  } else if (blob.arrayBuffer) {
    yield await blob.arrayBuffer();
  } else if (blob[asyncIterator]) {
    yield* blob[asyncIterator]();
  } else {
    yield blob;
  }
};

export default readBlob;
