const binding = require('./build/Release/writev.node');

const MICRO_OPT_LEN = 32;

const writeBufferArena = Buffer.alloc(10 * 4096);
const bufferPtrs = Buffer.alloc(1024);
const bufPtrs64 = new BigUint64Array(bufferPtrs.buffer, bufferPtrs.byteOffset);
const bufLens = Buffer.alloc(1024);
const bufLens32 = new Uint32Array(bufLens.buffer, bufLens.byteOffset);

const cbMap = new Map();
let idPool = 0;

function mainCallback(cbId, result) {
  const cb = cbMap.get(cbId);
  cbMap.delete(cbId);
  cb(result);
}

let arenaOffset = binding.setup(writeBufferArena, mainCallback, bufferPtrs, bufLens);

let arenaIndex;
let bufMap;
function reset() {
  arenaIndex = 0;
  bufMap = new WeakMap();
}
reset();

function writeBuf(buf, offset) {
  const srcLen = buf.length;
  if (srcLen > MICRO_OPT_LEN) {
    writeBufferArena.set(buf, offset)
  } else {
    for (let i = 0; i < srcLen; i++) {
      writeBufferArena[offset + i] = buf[i];
    }
  }
}

// note: this writes over the whole arena every time.
function writev(fd, bufs, cb) {
  const id = idPool++;
  cbMap.set(id, cb);
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    const location = bufMap.get(buf);
    if (location) {
      bufPtrs64[i] = location[0];
      bufLens32[i] = location[1];
    } else {
      bufPtrs64[i] = arenaOffset + BigInt(arenaIndex);
      bufLens32[i] = buf.length;
      if (arenaIndex + bufLens32[i] > writeBufferArena.length) {
        reset();
        return writev(fd, bufs, cb);
      }
      writeBuf(buf, arenaIndex);
      arenaIndex += buf.length;
      bufMap.set(buf, [bufPtrs64[i], bufLens32[i]]);
    }
  }
  binding.writev(fd, id, bufs.length);
}

module.exports = writev;
