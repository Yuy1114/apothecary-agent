import { Memory } from "@mastra/memory";
import { EMBEDDING_MODEL } from "./tools/rag.js";

// Shared agent memory. Attaching this to an agent is what makes Studio persist
// conversations as threads and enables working/observational memory. Storage is
// injected by the Mastra instance the agents are registered with.
export const apothecaryMemory = new Memory({
  embedder: EMBEDDING_MODEL as any,
  options: {
    lastMessages: 20,
    // The background Observer defaults to google/gemini-2.5-flash; pin it to the
    // project's deepseek model so it uses our configured provider/key.
    observationalMemory: { model: "deepseek/deepseek-v4-flash" },
    workingMemory: { enabled: true },
  },
});
