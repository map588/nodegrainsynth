cmake_minimum_required(VERSION 3.13)
project(NodeGrainDSP CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(SOURCES
    src/grain_engine.cpp
    src/bindings.cpp
)

add_executable(grain_engine ${SOURCES})

# Emscripten linker flags
target_link_options(grain_engine PRIVATE
    # Core WASM settings
    -sWASM=1
    -sENVIRONMENT=worker
    -sEXPORT_ES6=0
    -sMODULARIZE=1
    -sEXPORT_NAME=createGrainEngine

    # Memory settings (fixed for performance)
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=16777216    # 16MB
    -sMAXIMUM_MEMORY=67108864    # 64MB

    # Optimization
    -sNO_EXIT_RUNTIME=1
    -sNO_FILESYSTEM=1

    # Embind
    --bind

    # Allow raw pointers (needed for audio buffer access)
    -sALLOW_TABLE_GROWTH=1
)

# Compiler flags
target_compile_options(grain_engine PRIVATE
    -O3
    -flto
)

# Link-time optimization
target_link_options(grain_engine PRIVATE
    -O3
    -flto
)

# Output as .js (the .wasm is generated alongside)
set_target_properties(grain_engine PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)

# Optional SIMD build variant
option(USE_SIMD "Enable WebAssembly SIMD" OFF)
if(USE_SIMD)
    target_compile_options(grain_engine PRIVATE -msimd128)
    target_link_options(grain_engine PRIVATE -msimd128)
endif()
