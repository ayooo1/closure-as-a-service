// Liveness/readiness probe target for the web pod (kept off /api, which the Ingress sends to the API).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
