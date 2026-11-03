/**
 * Server entry — wraps every request in the Incorta auth gate.
 *
 * NOTE: on appkit this file is a LOCKED platform file. When the app is created
 * on Incorta (`create.sh --existing`), replace it with the template's copy
 * unchanged. This stand-in mirrors that contract so the app runs locally.
 */
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { auth } from "./server/auth";

export default createServerEntry({
  async fetch(request) {
    if (auth) {
      const gated = await auth.gate(request);
      if (gated) return gated;
    }
    return handler.fetch(request);
  },
});
