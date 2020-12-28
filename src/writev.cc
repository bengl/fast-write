#include "v8.h"
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <iostream>
#include "liburing/src/include/liburing.h"

using namespace v8;

namespace writev_addon {

  typedef Persistent<Function, CopyablePersistentTraits<Function>> CPersistent;

  uint64_t * uvBufsBuffer;
  uint32_t * uvBufLensBuffer;
  uint32_t * submissionsBuffer;
  uint32_t * resultBuffer;

  //CPersistent callback;
  Eternal<Function> * callback;
  uv_loop_t * loop;
  Isolate * isolate;

  static io_uring ring;
  static uv_poll_t poller;
  static uv_prepare_t preparer;
  static unsigned pending = 0;

  typedef struct io_data {
    iovec * iovs;
    uint32_t cbId;
  } io_data;

  inline io_data * init_io_data(uint32_t cbId, uint32_t nbufs, uint32_t bufferOffset) {
    iovec * iovs = (iovec *)malloc(sizeof(iovec) * nbufs);
    for (uint32_t i = 0; i < nbufs; i++) {
      iovs[i].iov_base = (void *)uvBufsBuffer[bufferOffset + i];
      iovs[i].iov_len = uvBufLensBuffer[bufferOffset + i];
    }

    io_data * data = (io_data *)malloc(sizeof(io_data));
    data->iovs = iovs;
    data->cbId = cbId;
    return data;
  }

  void free_io_data(io_data * data) {
    free(data->iovs);
    free(data);
  }

  // (callback, uvBufsBuffer, uvBufLensBuffer, submissionsBuffer, resultBuffer): void
  void setup(const FunctionCallbackInfo<Value>& args) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Function> localCallback = Local<Function>::Cast(args[0]);
    callback = new Eternal<Function>(isolate, localCallback);
    uvBufsBuffer = (uint64_t *)node::Buffer::Data(args[1]->ToObject(context).ToLocalChecked());
    uvBufLensBuffer = (uint32_t *)node::Buffer::Data(args[2]->ToObject(context).ToLocalChecked());
    submissionsBuffer = (uint32_t *)node::Buffer::Data(args[3]->ToObject(context).ToLocalChecked());
    resultBuffer = (uint32_t *)node::Buffer::Data(args[4]->ToObject(context).ToLocalChecked());
  }

  void getPtr(const FunctionCallbackInfo<Value>& args) {
    void * buffer = args[0].As<ArrayBuffer>()->GetBackingStore()->Data();
    args.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(isolate, (uint64_t)buffer));
  }

  void onSignal(uv_poll_t* handle, int status, int events) {
    int id = 0;
    io_uring_cqe* cqe;
    while (id == 0 || cqe) { // Drain the SQ
      // Per source, this cannot return an error. (That's good because we have no
      // particular callback to invoke with an error.)
      io_uring_peek_cqe(&ring, &cqe);

      if (!cqe) break;

      io_uring_cqe_seen(&ring, cqe);

      pending--;
      if (!pending)
        uv_poll_stop(&poller);

      io_data * data = (io_data *)io_uring_cqe_get_data(cqe);

      uint32_t cbId = data->cbId;
      free_io_data(data);

      resultBuffer[1 + (id * 2)] = (double)cbId;
      resultBuffer[2 + (id * 2)] = (double)cqe->res;
      id += 1;
    }
    if (!id) {
      return;
    }
    resultBuffer[0] = (double)id;
    HandleScope scope(isolate);
    Local<Function> cb = callback->Get(isolate);
    cb->Call(cb->CreationContext(), Undefined(isolate), 0, NULL);

  }

  inline void doWrite(uint32_t fd, uint32_t cbId, uint32_t nbufs, uint32_t bufferOffset) {
    io_data * data = init_io_data(cbId, nbufs, bufferOffset);

    io_uring_sqe* sqe = io_uring_get_sqe(&ring);
    io_uring_prep_writev(sqe, fd, data->iovs, nbufs, 0);
    io_uring_sqe_set_data(sqe, data);

    pending++;
  }

  void checkForSubmissions(uv_prepare_t* handle) {
    int pendingSubs = submissionsBuffer[0];
    int bufferOffset = 0;
    if (pendingSubs > 0) {
      for (int i = 0; i < pendingSubs; i++) {
        int fd = submissionsBuffer[1 + (i * 3)];
        int cbId = submissionsBuffer[2 + (i * 3)];
        int nbufs = submissionsBuffer[3 + (i * 3)];
        doWrite(fd, cbId, nbufs, bufferOffset);
        bufferOffset += nbufs;
      }
      int ret = io_uring_submit(&ring);
      if (ret < 0) {
        fprintf(stderr, "io_uring_submit: %s\n", strerror(-ret));
      }
      submissionsBuffer[0] = 0;
      if (!uv_is_active((uv_handle_t*)&poller))
        uv_poll_start(&poller, UV_READABLE, onSignal);
    }
  }

  void prepareStop(const FunctionCallbackInfo<Value>& args) {
    uv_prepare_stop(&preparer);
  }

  void Init(Local<Object> exports) {
    isolate = exports->GetIsolate();
    NODE_SET_METHOD(exports, "setup", &setup);
    
    loop = node::GetCurrentEventLoop(isolate);
    // TODO fixed limit here
    int ret = io_uring_queue_init(1024, &ring, 0);
    if (ret < 0) {
      fprintf(stderr, "queue_init: %s\n", strerror(-ret));
    }
    uv_poll_init(loop, &poller, ring.ring_fd);
    uv_prepare_init(loop, &preparer);
    uv_prepare_start(&preparer, checkForSubmissions);

    NODE_SET_METHOD(exports, "getPtr", &getPtr);
    NODE_SET_METHOD(exports, "prepareStop", &prepareStop);
  }

  NODE_MODULE(NODE_GYP_MODULE_NAME, Init)
}
