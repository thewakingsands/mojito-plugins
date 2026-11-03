// Mojito adapter: only an explicitly bound audited query can leave this Worker.
import type { IOverlayHandler } from '../types/event';
let query: ((request: Record<string, unknown>) => Promise<unknown>) | undefined;
export const bindOverlayQuery = (handler?: typeof query): void => { query = handler; };
export const callOverlayHandler: IOverlayHandler = ((request: Record<string, unknown>) => {
  if (!query) return Promise.reject(new Error('Raidboss query service is unavailable'));
  return query(request);
}) as IOverlayHandler;
