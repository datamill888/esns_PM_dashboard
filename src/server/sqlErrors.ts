/**
 * Turn SQL Interface failures that users can do nothing about into plain
 * messages. The big one: Penta_Projects.Job_Cost_Stacked_1A (~568M rows) must
 * be loaded column-by-column into the engine's memory; on a cache miss while
 * memory is short the engine refuses with "too large to load". Retrying a
 * little later usually succeeds once the columns are cached.
 */
export class FriendlySqlError extends Error {}

export function friendlySqlError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/too large to load|max_process_memory/i.test(msg)) {
    return new FriendlySqlError(
      "Incorta is busy loading the job-cost table into memory and couldn't answer this time. Try again in a minute — it is usually quick once loaded.",
    );
  }
  if (/statement timeout|canceling statement/i.test(msg)) {
    return new FriendlySqlError("Incorta took longer than 30 seconds to answer. Try again — the next attempt is usually faster.");
  }
  return e instanceof Error ? e : new Error(msg);
}
