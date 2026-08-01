import type { ImageDescriptionDraft } from "../../domain/imageDescription.js";

/**
 * Reads an image with a vision model so the organizer can file it on what it
 * shows rather than on what its filename happens to be.
 *
 * Unlike every other port here, this one is **allowed to be absent**: a vision
 * model is separately configured and separately paid for, and the app has to
 * work without one. So `available()` is part of the contract and callers must
 * branch on it rather than catching a throw — 快速归位 in particular decides
 * whether to escalate a hash-named image based on whether anything can actually
 * look at it. Installed unconditionally at the composition root; `available()`
 * re-reads configuration on each call, so setting a key and relaunching is
 * enough to turn it on.
 */
export type ImageDescriber = {
  available: () => boolean;
  describe: (input: { absolutePath: string; fileName: string }) => Promise<ImageDescriptionDraft>;
};

const UNAVAILABLE: ImageDescriber = {
  available: () => false,
  describe: async () => {
    throw new Error("image_describer_not_configured");
  },
};

let installed: ImageDescriber = UNAVAILABLE;

export function setImageDescriber(next: ImageDescriber): void {
  installed = next;
}

export function imageDescriber(): ImageDescriber {
  return installed;
}

/** Restore the "no vision model" default — for tests and for teardown. */
export function clearImageDescriber(): void {
  installed = UNAVAILABLE;
}
