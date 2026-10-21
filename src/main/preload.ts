// Узкий мост: renderer может только вызвать разрешённый метод API и подписаться на события.
// Node, файловая система и ключи renderer недоступны.
import { contextBridge, ipcRenderer } from "electron";

const EVENTS = new Set(["run-progress", "run-finished", "data-changed", "notification", "navigate"]);

contextBridge.exposeInMainWorld("jsd", {
  call: (method: string, args?: unknown) => ipcRenderer.invoke("api", { method, args }),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
