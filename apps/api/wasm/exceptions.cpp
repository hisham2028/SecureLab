// The WebAssembly C++ library is built without exception support, so a program that throws
// (vector::at out of range, stoi on bad input, new running out of memory, an explicit throw)
// would not even link. These stand-ins let it link; a throw then ends the program, like an
// uncaught exception does with g++. A catch block never runs.
#include <cstdio>
#include <cstdlib>
#include <typeinfo>

extern "C" char* __cxa_demangle(const char* name, char* buf, std::size_t* n, int* status);

extern "C" void* __cxa_allocate_exception(std::size_t size) noexcept {
  return std::malloc(size);
}

extern "C" void __cxa_free_exception(void* p) noexcept { std::free(p); }

extern "C" [[noreturn]] void __cxa_throw(void*, std::type_info* type, void* (*)(void*)) {
  int status = 0;
  char* name = __cxa_demangle(type->name(), nullptr, nullptr, &status);
  std::fprintf(stderr, "terminate called after throwing an instance of '%s'\n",
               status == 0 && name ? name : type->name());
  std::abort();
}
