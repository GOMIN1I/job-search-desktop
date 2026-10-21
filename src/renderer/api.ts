// Клиент API renderer → main. Ошибки приходят как двуязычные сообщения.
import type { Msg } from "../shared/types";

declare global {
  interface Window {
    jsd: {
      call: (method: string, args?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: Msg; code: string }>;
      on: (event: string, cb: (payload: any) => void) => () => void;
    };
  }
}

export class ApiFailure extends Error {
  constructor(public readonly msgObj: Msg, public readonly code: string) {
    super(msgObj.en);
  }
}

export async function call<T = any>(method: string, args?: unknown): Promise<T> {
  const r = await window.jsd.call(method, args);
  if (!r.ok) throw new ApiFailure(r.error, r.code);
  return r.data as T;
}

export const on = (event: string, cb: (payload: any) => void) => window.jsd.on(event, cb);
