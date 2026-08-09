import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

const allowedOrigins = new Set([
  "https://bophotography.work",
  "https://www.bophotography.work",
  "https://daily-training-tracker-20260725.idoadoreuo.chatgpt.site",
]);

type StoredSync = {
  revision: string;
  updatedAt: string;
  payload: unknown;
};

type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  end(): void;
  json(value: unknown): void;
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
};

function setResponseHeaders(request: ApiRequest, response: ApiResponse) {
  const originHeader = request.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json");
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, PUT, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");

  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
  }
}

function json(request: ApiRequest, response: ApiResponse, body: unknown, status = 200) {
  setResponseHeaders(request, response);
  response.status(status).json(body);
}

function syncPath(key: string) {
  return `fitness-sync/${key}.json`;
}

function validKey(key: string | null) {
  return Boolean(key && /^[a-f0-9]{64}$/.test(key));
}

async function readStored(key: string) {
  const result = await get(syncPath(key), { access: "private", useCache: false });
  if (!result || !result.stream || result.statusCode !== 200) return null;

  return {
    data: JSON.parse(await new Response(result.stream).text()) as StoredSync,
    etag: result.blob.etag,
  };
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method === "OPTIONS") {
    setResponseHeaders(request, response);
    response.status(204).end();
    return;
  }

  const key = new URL(request.url ?? "/", "https://bophotography.work").searchParams.get("key");
  if (!validKey(key)) {
    json(request, response, { error: "invalid_sync_key" }, 400);
    return;
  }

  try {
    const current = await readStored(key);

    if (request.method === "GET") {
      json(request, response, current?.data ?? { error: "not_found" }, current ? 200 : 404);
      return;
    }

    if (request.method !== "PUT") {
      json(request, response, { error: "method_not_allowed" }, 405);
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      json(request, response, { error: "invalid_payload" }, 400);
      return;
    }

    const body = parsedBody as {
      expectedRevision?: string;
      updatedAt?: string;
      payload?: unknown;
    };

    if (!body?.payload || typeof body.updatedAt !== "string" || Number.isNaN(Date.parse(body.updatedAt))) {
      json(request, response, { error: "invalid_payload" }, 400);
      return;
    }

    if ((current?.data.revision ?? undefined) !== (body.expectedRevision ?? undefined)) {
      json(request, response, current?.data ?? { error: "not_found" }, 409);
      return;
    }

    const stored: StoredSync = {
      revision: crypto.randomUUID(),
      updatedAt: body.updatedAt,
      payload: body.payload,
    };

    try {
      await put(syncPath(key), JSON.stringify(stored), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: Boolean(current),
        ...(current ? { ifMatch: current.etag } : {}),
      });
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError)) throw error;
      const latest = await readStored(key);
      json(request, response, latest?.data ?? { error: "not_found" }, 409);
      return;
    }

    json(request, response, stored);
  } catch (error) {
    console.error("fitness-sync", error);
    json(request, response, { error: "sync_unavailable" }, 503);
  }
}
