import type { ColouriseRequest, DecodeRequest, WorkerResponse } from "./decode.worker";

type Pending = { resolve: (r: WorkerResponse & { ok: true }) => void; reject: (e: Error) => void };

class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private cursor = 0;

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./decode.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data);
        else p.reject(new Error(e.data.error));
      };
      this.workers.push(w);
    }
  }

  private send<T extends DecodeRequest | ColouriseRequest>(
    req: Omit<T, "id">,
    transfer: Transferable[],
  ): Promise<WorkerResponse & { ok: true }> {
    const id = this.nextId++;
    const worker = this.workers[this.cursor++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id }, transfer);
    });
  }

  async decode(bytes: ArrayBuffer, scale: number, offset: number): Promise<Float32Array> {
    const res = await this.send<DecodeRequest>({ op: "decode", bytes, scale, offset }, [bytes]);
    return res.values!;
  }

  async colourise(
    values: Float32Array,
    size: number,
    lut: Uint8ClampedArray,
    min: number,
    max: number,
    shade: number,
  ): Promise<ImageBitmap> {
    // Send a copy: the cached original stays on the main thread for click queries.
    const copy = values.slice();
    const res = await this.send<ColouriseRequest>(
      { op: "colourise", values: copy, size, lut, min, max, shade },
      [copy.buffer],
    );
    return res.bitmap!;
  }
}

let pool: WorkerPool | null = null;

export function workerPool(): WorkerPool {
  if (!pool) {
    const cores = navigator.hardwareConcurrency || 4;
    pool = new WorkerPool(Math.max(1, Math.min(4, cores - 1)));
  }
  return pool;
}
