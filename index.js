const binding = require('./build/Release/writev.node');

const PTR = Symbol('pointer');

const uvBufs = Buffer.alloc(1024);
const uvBufs64 = new BigUint64Array(uvBufs.buffer, uvBufs.offset);
const uvBufLens = Buffer.alloc(1024);
const uvBufLens32 = new Uint32Array(uvBufLens.buffer, uvBufLens.offset);
const cbMap = {};
let idPool = 0;

function mainCallback(cbId, result) {
  const cb = cbMap[cbId];
  delete cbMap[cbId];
  cb(result);
}

binding.setup(mainCallback, uvBufs, uvBufLens);


function getPointer(buf, offset = 0) {
  if (buf.buffer) {
    return getPointer(buf.buffer, buf.offset)
  }
  if (buf[PTR]) {
    return buf[PTR] + BigInt(offset);
  }
  const pointer = binding.getPtr(buf);
  buf[PTR] = pointer;
  return pointer + BigInt(offset);
}

function setIovecs(offset, ptr, bufLen) {
  uvBufs64[offset] = ptr;
  uvBufLens32[offset] = bufLen;
}

// note: this writes over the whole arena every time.
function writev(fd, bufs, cb) {
  const id = idPool++;
  cbMap[id] = cb;
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    const bufLen = buf.length
    setIovecs(i, getPointer(buf), bufLen);
  }
  binding.writev(fd, id, bufs.length);
}

module.exports = writev;
