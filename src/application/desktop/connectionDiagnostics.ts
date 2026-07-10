export type ConnectionStatus =
  | "connected"
  | "missing_key"
  | "auth_error"
  | "service_error"
  | "unreachable";

export type ServiceDiagnostic = {
  name: string;
  model: string;
  host: string;
  keyConfigured: boolean;
  status: ConnectionStatus;
  detail: string;
};

type FetchLike = typeof fetch;

type ProbeRequest = { url: string; method: "GET" | "POST"; body?: string };

function joinPath(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/$/, "")}${path}`;
}

function modelsProbe(baseURL: string): ProbeRequest {
  return { url: joinPath(baseURL, "/models"), method: "GET" };
}

// aihubmix 的 GET /models 对任意 key 都返回 200，只有 /embeddings 真正鉴权，
// 所以 embedding 检测必须花一次单 token 的真实调用。
function embeddingsProbe(baseURL: string, model: string): ProbeRequest {
  return {
    url: joinPath(baseURL, "/embeddings"),
    method: "POST",
    body: JSON.stringify({ model, input: "ping" }),
  };
}

function safeHost(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return "invalid-url";
  }
}

async function diagnoseService(input: {
  name: string;
  model: string;
  baseURL: string;
  apiKey?: string;
  probe: ProbeRequest;
  fetchImpl: FetchLike;
}): Promise<ServiceDiagnostic> {
  const base = {
    name: input.name,
    model: input.model,
    host: safeHost(input.baseURL),
    keyConfigured: Boolean(input.apiKey),
  };
  if (!input.apiKey) {
    return { ...base, status: "missing_key", detail: "缺少 API Key" };
  }

  try {
    const response = await input.fetchImpl(input.probe.url, {
      method: input.probe.method,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.probe.body ? { "content-type": "application/json" } : {}),
      },
      body: input.probe.body,
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) return { ...base, status: "connected", detail: "连接和鉴权正常" };
    if (response.status === 401 || response.status === 403) {
      return { ...base, status: "auth_error", detail: `鉴权失败（HTTP ${response.status}）` };
    }
    return { ...base, status: "service_error", detail: `服务返回 HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ...base, status: "unreachable", detail: `无法连接：${message}` };
  }
}

export async function runConnectionDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<{ checkedAt: string; model: ServiceDiagnostic; embedding: ServiceDiagnostic }> {
  const modelBaseURL = env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const embeddingBaseURL = env.APOTHECARY_EMBEDDING_BASE_URL ?? "https://api.aihubmix.com/v1";
  const embeddingModel = env.APOTHECARY_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const [model, embedding] = await Promise.all([
    diagnoseService({
      name: "DeepSeek",
      model: "deepseek-v4-flash",
      baseURL: modelBaseURL,
      apiKey: env.DEEPSEEK_API_KEY,
      probe: modelsProbe(modelBaseURL),
      fetchImpl,
    }),
    diagnoseService({
      name: "Embedding",
      model: embeddingModel,
      baseURL: embeddingBaseURL,
      apiKey: env.APOTHECARY_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY,
      probe: embeddingsProbe(embeddingBaseURL, embeddingModel),
      fetchImpl,
    }),
  ]);
  return { checkedAt: new Date().toISOString(), model, embedding };
}
