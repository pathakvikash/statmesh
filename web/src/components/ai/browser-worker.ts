// Web Worker entry: runs the WebLLM engine off the main thread. Loaded only after the visitor opts in.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (m: MessageEvent) => handler.onmessage(m);
