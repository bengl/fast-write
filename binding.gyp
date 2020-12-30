{
  "targets": [
    {
      "target_name": "writev",
      "sources": [
        "src/writev.cc"
      ],
      "include_dirs": [
        "deps",
        "deps/liburing/src/include"
      ],
      "libraries": [
        "<(module_root_dir)/deps/liburing/src/liburing.a"
      ]
    }
  ]
}
