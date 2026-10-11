// Node worker_threads entry for the audio engine — every role (see worker-core.ts, engine-node.ts).
import { parentPort } from 'node:worker_threads';
import { handle, type WorkerRequest } from './worker-core.ts';

const port = parentPort!;
const post = (m: unknown, t: Transferable[] = []) => port.postMessage(m, t as never);
port.on('message', (m: WorkerRequest) => handle(m, post));
