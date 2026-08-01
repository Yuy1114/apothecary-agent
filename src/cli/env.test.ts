import { describe, expect, it } from "vitest";
import { selectCredentials } from "./env.js";

describe("selectCredentials", () => {
  it("adopts credential keys that are not already set", () => {
    const selected = selectCredentials(
      { DEEPSEEK_API_KEY: "from-file", APOTHECARY_EMBEDDING_MODEL: "m" },
      {},
    );
    expect(selected).toEqual({ DEEPSEEK_API_KEY: "from-file", APOTHECARY_EMBEDDING_MODEL: "m" });
  });

  it("never overrides a variable the caller set explicitly", () => {
    const selected = selectCredentials({ DEEPSEEK_API_KEY: "from-file" }, {
      DEEPSEEK_API_KEY: "from-caller",
    });
    expect(selected).toEqual({});
  });

  it("ignores the vault path so a stale .env cannot override the app's choice", () => {
    // Which vault is current is the desktop app's live decision; `.env` here is
    // only a credential source.
    const selected = selectCredentials({ APOTHECARY_VAULT_PATH: "/somewhere/else" }, {});
    expect(selected).toEqual({});
  });

  it("ignores anything that is not a known credential key", () => {
    expect(selectCredentials({ PATH: "/evil", HOME: "/evil" }, {})).toEqual({});
  });
});
