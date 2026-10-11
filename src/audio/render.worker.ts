// Browser module worker for the audio engine — one file for every role (see worker-core.ts).
import { handle, type WorkerRequest } from './worker-core.ts';

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
self.onmessage = (e: MessageEvent<WorkerRequest>) => handle(e.data, post);
