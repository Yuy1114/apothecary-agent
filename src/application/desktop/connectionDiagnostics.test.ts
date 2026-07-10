import { describe, expect, it, vi } from "vitest";
import { runConnectionDiagnostics } from "./connectionDiagnostics.js";

describe("desktop connection diagnostics", () => {
  it("does not call the network when keys are missing", async () => {
    const fetchImpl = vi.fn();
    const result = await runConnectionDiagnostics({}, fetchImpl as typeof fetch);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.model.status).toBe("missing_key");
    expect(result.embedding.status).toBe("missing_key");
  });

  it("reports successful service authentication without exposing keys", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const result = await runConnectionDiagnostics(
      { DEEPSEEK_API_KEY: "model-secret", APOTHECARY_EMBEDDING_API_KEY: "embed-secret" },
      fetchImpl as typeof fetch,
    );

    expect(result.model.status).toBe("connected");
    expect(result.embedding.status).toBe("connected");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("probes the embedding service via POST /embeddings, not the non-authenticating /models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await runConnectionDiagnostics(
      {
        DEEPSEEK_API_KEY: "a",
        APOTHECARY_EMBEDDING_API_KEY: "b",
        APOTHECARY_EMBEDDING_BASE_URL: "https://embed.example.com/v1",
        APOTHECARY_EMBEDDING_MODEL: "text-embedding-test",
      },
      fetchImpl as typeof fetch,
    );

    const embeddingCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("embed.example.com"));
    expect(embeddingCall).toBeDefined();
    const [url, init] = embeddingCall as [string, RequestInit];
    expect(url).toBe("https://embed.example.com/v1/embeddings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("text-embedding-test");
    expect(String(body.input).length).toBeLessThanOrEqual(8);

    const modelCall = fetchImpl.mock.calls.find(([u]) => String(u).includes("api.deepseek.com"));
    expect(String((modelCall as [string, RequestInit])[0])).toBe("https://api.deepseek.com/models");
  });

  it("distinguishes authentication failures from service failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const result = await runConnectionDiagnostics(
      { DEEPSEEK_API_KEY: "a", APOTHECARY_EMBEDDING_API_KEY: "b" },
      fetchImpl as typeof fetch,
    );

    expect(result.model.status).toBe("auth_error");
    expect(result.embedding.status).toBe("service_error");
  });
});
