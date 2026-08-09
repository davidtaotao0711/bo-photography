import { get, put } from "@vercel/blob";

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

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers({ "cache-control": "no-store", "content-type": "application/json", vary: "Origin" });
  if (origin && allowedOrigins.has(origin)) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, PUT, OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return headers;
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
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
  return { data: JSON.parse(await new Response(result.stream).text()) as StoredSync, etag: result.blob.etag };
}

export default async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(request) });
  const key = new URL(request.url, "https://bophotography.work").searchParams.get("key");
  if (!validKey(key)) return json(request, { error: "invalid_sync_key" }, 400);

  try {
    const current = await readStored(key!);
    if (request.method === "GET") return current ? json(request, current.data) : json(request, { error: "not_found" }, 404);
    if (request.method !== "PUT") return json(request, { error: "method_not_allowed" }, 405);

    const body = await request.json() as { expectedRevision?: string; updatedAt?: string; payload?: unknown };
    if (!body.payload || typeof body.updatedAt !== "string" || Number.isNaN(Date.parse(body.updatedAt))) return json(request, { error: "invalid_payload" }, 400);
    if ((current?.data.revision ?? undefined) !== (body.expectedRevision ?? undefined)) return json(request, current?.data ?? { error: "not_found" }, 409);

    const stored: StoredSync = { revision: crypto.randomUUID(), updatedAt: body.updatedAt, payload: body.payload };
    await put(syncPath(key!), JSON.stringify(stored), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: Boolean(current),
      ...(current ? { ifMatch: current.etag } : {}),
    });
    return json(request, stored);
  } catch (error) {
    console.error("fitness-sync", error);
    return json(request, { error: "sync_unavailable" }, 503);
  }
}
