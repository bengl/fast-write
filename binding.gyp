{
  "targets": [
    {
      "target_name": "writev",
      "sources": [ "src/writev.cc" ],
      "include_dirs": [
        "deps"
      ],
      "libraries": [
        "<(module_root_dir)/deps/liburing/src/liburing.a"
      ],
      "cflags":[
        "-Wno-cast-function-type"
      ]
    }
  ]
}
