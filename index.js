const binding = require('./build/Debug/writev.node');
const private = require('./lib/private');

const PTR = private('pointer');
const { getPtr } = binding;
delete binding.getPtr;

const uvErrMap = process.binding('uv').getErrorMap();

const submissions = Buffer.alloc(4); // [len]
const submissions32 = new Uint32Array(submissions.buffer, submissions.offset);
const resultBuffer = Buffer.alloc(4096);
const resultBuffer32 = new Int32Array(resultBuffer.buffer, resultBuffer.offset);
const cbMap = new Map();
let idPool = 0;

function mainCallback() {
  const resultCount = resultBuffer32[0];
  for (let i = 0; i < resultCount; i++) {
    const cbId = resultBuffer32[1 + (i * 2)];
    const result = resultBuffer32[2 + (i * 2)];
    const cb = cbMap.get(cbId);
    cbMap.delete(cbId);
    if (result < 0) {
      const [code, uvmsg] = uvErrMap.get(result);
      const err = new Error(`${code}: ${uvmsg}`);
      cb(err);

    }
    cb(null, result);
  }
}

const [sqRingBuf, sqBuf, sqes, sizeOfSqe] = binding.setup(mainCallback, submissions, resultBuffer);

/*
struct io_uring_sq {
  unsigned *khead; // [0]
  unsigned *ktail; // [1]
  unsigned *kring_mask; // [2]
  unsigned *kring_entries; // [3]
  unsigned *kflags; // [4]
  unsigned *kdropped; // [5]
  unsigned *array; // [6]
  struct io_uring_sqe *sqes; [7]

  unsigned sqe_head; // [8]
  unsigned sqe_tail; // [8.5]

  size_t ring_sz; // [9]
  void *ring_ptr; // [10]

  unsigned pad[4]; 
};

static inline struct io_uring_sqe *
__io_uring_get_sqe(struct io_uring_sq *sq, unsigned int __head)
{
  unsigned int __next = (sq)->sqe_tail + 1;
  struct io_uring_sqe *__sqe = NULL;

  if (__next - __head <= *(sq)->kring_entries) {
    __sqe = &(sq)->sqes[(sq)->sqe_tail & *(sq)->kring_mask];
    (sq)->sqe_tail = __next;
  }
  return __sqe;
}

struct io_uring_sqe *io_uring_get_sqe(struct io_uring *ring)
{
  struct io_uring_sq *sq = &ring->sq;

  return __io_uring_get_sqe(sq, io_uring_smp_load_acquire(sq->khead));
}


*/

class Sq {
  constructor (sqRingBuf, sqBuf, sqes) {
    this.sqRingBuf = sqRingBuf;
    this.sqRingBuf32 = new Uint32Array(sqRingBuf.buffer, sqRingBuf.offset, sqRingBuf.length/4);
    this.sqRingBufView = new DataView(sqRingBuf.buffer, sqRingBuf.offset, sqRingBuf.length);
    this.sqRingBufPtr = getPointer(sqRingBuf);
    this.sqBuf64 = new BigUint64Array(sqBuf.buffer, sqBuf.offset, sqBuf.length/8);
    this.sqBuf32 = new Uint32Array(sqBuf.buffer, sqBuf.offset, sqBuf.length/4);
    this.sqBufView = new DataView(sqBuf.buffer, sqBuf.offset, sqBuf.length);
    this.sqes = sqes;
  }

  _deref(i, getter, val) {
    return this.sqRingBufView[getter](Number(this._getPtr(i)), val);
  }

  _getAtomicUint32(i) {
    return Atomics.load(this.sqRingBuf32, Number(this._getPtr(i))/4);
  }

  _getPtr(i) {
    return this.sqBuf64[i] - this.sqRingBufPtr;
  }

  get head() {
    return this._deref(0, 'getUint32');
  }

  get atomicHead() {
    return Atomics.load(this.sqRingBuf32, Number(this.sqBuf64[0] - this.sqRingBufPtr));
  }

  get tail() {
    return this._deref(1 , 'getUint32');
  }

  set tail(n) {
    return this._deref(1, 'setUint32', n);
  }

  get entries() {
    return this._deref(3, 'getUint32');
  }

  get mask() {
    return this._deref(2, 'getUint32');
  }

  get sqeHead() {
    return this.sqBuf32[16];
  }

  get sqeTail() {
    return this.sqBuf32[17];
  }

  set sqeTail(n) {
    return this.sqBuf32[17] = n;
  }

  // io_uring_get_sqe
  getSqe() {
    const headPtr = this.atomicHead;
    const next = this.sqeTail + 1;
    let sqe;
    if (next - headPtr <= this.entries) {
      sqe = this.sqeTail & this.mask;
      this.sqeTail = next;
    }
    return typeof sqe !== 'undefined' ? new Sqe(this, sqe) : sqe;
  }
}

/*
struct io_uring_sqe {
  __u8  opcode;    // type of operation for this sqe [0]
  __u8  flags;    // IOSQE_ flags [1]
  __u16  ioprio;    // ioprio for the request [2]
  __s32  fd;    // file descriptor to do IO on [4] 32[1]
  union {
    __u64  off;  // offset into file [8] 64[1]
    __u64  addr2;
  };
  union {
    __u64  addr;  // pointer to buffer or iovecs [16] 64[2]
    __u64  splice_off_in;
  };
  __u32  len;    // buffer size or number of iovecs [24] 32[6]
  union {
    __kernel_rwf_t  rw_flags; // [28] 32[7]
    __u32    fsync_flags;
    __u16    poll_events;  // compatibility
    __u32    poll32_events;  // word-reversed for BE
    __u32    sync_range_flags;
    __u32    msg_flags;
    __u32    timeout_flags;
    __u32    accept_flags;
    __u32    cancel_flags;
    __u32    open_flags;
    __u32    statx_flags;
    __u32    fadvise_advice;
    __u32    splice_flags;
    __u32    rename_flags;
    __u32    unlink_flags;
  };
  __u64  user_data;  // data to be passed back at completion time [32] 64[4]
  union {
    struct {
      // pack this to avoid bogus arm OABI complaints
      union {
        // index into fixed buffers, if used
        __u16  buf_index;
        // for grouped buffer selection
        __u16  buf_group;
      } __attribute__((packed));
      // personality to use, if used
      __u16  personality;
      __s32  splice_fd_in;
    };
    __u64  __pad2[3]; [40-end] 64[5,6,7]
  };
};
*/

class Sqe {
  constructor(sq, sqeId) {
    this.sq = sq;
    this.pointer = sqeId * sizeOfSqe + this.sq.sqes.offset;
    this.sqeInt32 = new Int32Array(sq.sqes.buffer, this.pointer, sizeOfSqe/4);
    this.sqeUint32 = new Uint32Array(sq.sqes.buffer, this.pointer, sizeOfSqe/4);
    this.sqeUint64 = new BigUint64Array(sq.sqes.buffer, this.pointer, sizeOfSqe/8);
  }

  prepWritev(fd, iovs, count, offset, cbId) {
    const IORING_OP_WRITEV = 5; // TODO double check this
//sqe->opcode = IORING_OP_WRITE;
    this.sq.sqes[this.pointer + 0] = IORING_OP_WRITEV;
    this.sq.sqes[this.pointer + 1] = 0;
    this.sq.sqes[this.pointer + 2] = 0;
    this.sq.sqes[this.pointer + 3] = 0;

//sqe->fd = fd;
    this.sqeInt32[4] = fd;
//sqe->off = offset;
    this.sqeUint64[1] = BigInt(offset);
//sqe->addr = (unsigned long) iovs;
    this.sqeUint64[2] = iovs;
//sqe->len = count;
    this.sqeUint32[6] = count;
//sqe->rw_flags = 0;
    this.sqeUint32[7] = 0;
//sqe->user_data = 0;  // to be populated with cbid
    this.sqeUint64[4] = BigInt(cbId);
//sqe->__pad2[0] = sqe->__pad2[1] = sqe->__pad2[2] = 0;
    this.sqeUint64[5] = 0n;
    this.sqeUint64[6] = 0n;
    this.sqeUint64[7] = 0n;
  }
}

const sq = new Sq(sqRingBuf, sqBuf, sqes);

function getPointer(buf, offset = 0) {
  if (buf.buffer) {
    return getPointer(buf.buffer, buf.offset)
  }
  let pointer = buf[PTR];
  if (!pointer) {
    pointer = getPtr(buf);
    buf[PTR] = pointer;
  }
  return offset ? pointer + BigInt(offset) : pointer;
}

function makeIovs(bufs) {
  const iovs = Buffer.allocUnsafe(bufs.length * 16);
  const iovs64 = new BigUint64Array(iovs.buffer, iovs.offset, iovs.length);
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i];
    iovs64[i * 2] = getPointer(buf);
    iovs64[i * 2 + 1] = BigInt(buf.length);
  }
  return getPointer(iovs);
}

function _writev(fd, bufs, offset, cb) {
  let len = submissions32[0];
  if (len > 900) {
    setImmediate(() => writev(fd, bufs, cb));
    return;
  }
  const id = idPool++;
  cbMap.set(id, cb);
  const iovs = makeIovs(bufs);
  const sqe = sq.getSqe();
  sqe.prepWritev(fd, iovs, bufs.length, offset, id);

  submissions32[0] = len + 1;
}

function writev (fd, bufs, offset, cb) {
  if (typeof offset === 'function') {
    cb = offset;
    offset = -1;
  }
  _writev(fd, bufs, offset, cb);
}

writev.prepareStop = binding.prepareStop;

module.exports = writev;
