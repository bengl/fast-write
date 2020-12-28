#include "v8.h"
#include <bits/stdint-uintn.h>
#include <node.h>
#include <node_buffer.h>
#include <uv.h>
#include <iostream>
#include "liburing/src/include/liburing.h"

using namespace v8;

namespace writev_addon {

  #pragma pack(1)
  struct js_submission {
    uint32_t fd;
    uint32_t cbId;
    uint32_t count;
  };

  uint64_t * uvBufsBuffer;
  uint32_t * submissionsBuffer;
  uint32_t * pendingSubs;
  struct js_submission * subs;
  uint32_t * resultBuffer;

  Eternal<Function> * callback;
  uv_loop_t * loop;
  Isolate * isolate;

  static io_uring ring;
  static uv_poll_t poller;
  static uv_prepare_t preparer;
  static unsigned pending = 0;


  // (callback, uvBufsBuffer, uvBufLensBuffer, submissionsBuffer, resultBuffer): void
  void setup(const FunctionCallbackInfo<Value>& args) {
    Local<Context> context = isolate->GetCurrentContext();
    Local<Function> localCallback = Local<Function>::Cast(args[0]);
    callback = new Eternal<Function>(isolate, localCallback);
    uvBufsBuffer = (uint64_t *)node::Buffer::Data(args[1]->ToObject(context).ToLocalChecked());
    pendingSubs = (uint32_t *)node::Buffer::Data(args[2]->ToObject(context).ToLocalChecked());
    subs = (struct js_submission *)(pendingSubs + 1);
    resultBuffer = (uint32_t *)node::Buffer::Data(args[3]->ToObject(context).ToLocalChecked());
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

      uint32_t cbId = (uint64_t)io_uring_cqe_get_data(cqe) & 0xFFFFFFFF;

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
    iovec * iovs = (iovec *)&uvBufsBuffer[bufferOffset];

    io_uring_sqe* sqe = io_uring_get_sqe(&ring);
    io_uring_prep_writev(sqe, fd, iovs, nbufs, 0);
    uint64_t cbIdPtr = cbId;
    io_uring_sqe_set_data(sqe, (void *)cbIdPtr);

    pending++;
  }

  void checkForSubmissions(uv_prepare_t* handle) {

    int bufferOffset = 0;
    if (*pendingSubs > 0) {
      for (int i = 0; i < *pendingSubs; i++) {
        struct js_submission * sub = subs + i;
        doWrite(sub->fd, sub->cbId, sub->count, bufferOffset);
        bufferOffset += sub->count * 2;
      }
      int ret = io_uring_submit(&ring);
      if (ret < 0) {
        fprintf(stderr, "io_uring_submit: %s\n", strerror(-ret));
      }
      *pendingSubs = 0;
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
