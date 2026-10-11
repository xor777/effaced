// Ambient types for the libopenmpt emscripten build shipped in npm `chiptune3` (MIT wrapper,
// libopenmpt is BSD-3). The file is an ES module whose default export is the async emscripten
// factory; it runs in Node, workers, the main thread and AudioWorklets.
declare module 'chiptune3/libopenmpt.worklet.js' {
  const factory: (moduleArg?: Record<string, unknown>) => Promise<unknown>;
  export default factory;
}
