declare module "inferencejs" {
  export class InferenceEngine {
    constructor(url?: string);
    startWorker(
      modelName: string,
      modelVersion: string | number,
      publishableKey: string,
      options?: unknown
    ): Promise<string>;
    stopWorker(workerId: string): Promise<boolean>;
    infer(workerId: string, img: unknown, options?: unknown): Promise<unknown>;
  }
}
