# 💔 Closure as a Service

> Endings are hard. The message doesn't have to be.

An AI-powered breakup message generator. Answer a short questionnaire about the relationship, the reason and the tone you want, and get **three distinct messages streamed in real time**, ready to copy, open in your SMS app, or tweak.

This project is also a **full-stack and cloud-native showcase**: a Next.js frontend and a Fastify streaming API that share one Zod schema, with Redis for distributed rate limiting and caching. Everything is containerized with multi-stage Docker builds and deployed to Kubernetes with probes, autoscaling and path-based Ingress routing.

---

## ✨ Features

- **Many kinds of endings**: a relationship, a situationship, a friendship, apologising for ghosting someone, or replying to a breakup, each with its own questions and goals
- **Multi-step wizard**: ending → duration → reason → tone → medium → optional details, validated end to end with Zod
- **Real-time AI streaming**: three variations streamed token by token from Claude (Haiku 4.5 by default, Opus 5.5 configurable)
- **Actionable result cards**: one-click copy, `sms:`/`mailto:` deep links, and quick tone-tweak regeneration
- **Refine one message**: edit it by hand or have Claude rewrite it (shorter, softer, more direct, warmer, without the reason), with undo
- **"What if they reply?"**: likely responses to the chosen message, each with a calm answer that holds the decision
- **Practice conversation**: rehearse with Claude playing the other person, with a coaching tip after each reply (up to 8 replies)
- **Read aloud**: hear a message spoken (browser speech, on-device) to rehearse an in-person conversation
- **Logistics message**: a practical follow-up about belongings, money, a shared home, pets or accounts
- **After you send it**: a short aftercare checklist, tailored to the kind of ending
- **👍/👎 feedback**: votes stored by answer category only (never text), summarised with `scripts/feedback-report.sh`
- **Safety check**: if the details suggest the user may be at risk, messages become short and final, and the page shows safety guidance and helplines
- **Privacy by default**: answers that include a name or personal details are never cached or stored; practice conversations aren't stored
- **Redis-backed rate limiting**: per-IP limits shared across every API replica
- **Prompt result caching**: identical answers without personal text are served from Redis
- **Production Kubernetes setup**: Deployments, Services, ConfigMap/Secret, Ingress and HPA

## 🏗️ Architecture

```mermaid
flowchart LR
    U[Browser] -->|HTTPS| I[Ingress]
    I -->|/| W[web<br/>Next.js]
    I -->|/api| A[api<br/>Fastify]
    A -->|rate limit + cache| R[(Redis)]
    A -->|stream| O[Claude API]
    subgraph K8s cluster
      I
      W
      A
      R
    end
```

| Layer | Tech |
| --- | --- |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS v4, shadcn/ui, Motion (Framer Motion), React Hook Form |
| Backend | Node.js 22, Fastify 5, Anthropic TypeScript SDK (Claude) |
| Shared | Zod schema + inferred types (`@caas/shared`) |
| Data | Redis (rate limiting and response cache) |
| Infra | Docker (multi-stage), docker-compose, Kubernetes (Minikube / k3d / Kind) |

## 📁 Project structure

```
.
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/                # App Router: layout, pages, /healthz probe
│   │   ├── components/ui/      # shadcn/ui primitives
│   │   ├── lib/                # utils, client helpers
│   │   └── Dockerfile
│   └── api/                    # Fastify streaming API
│       ├── src/
│       │   ├── config.ts       # Zod-validated env (fail fast on boot)
│       │   ├── server.ts       # Fastify app: CORS, Redis rate limit, routes
│       │   ├── routes/         # /healthz, /readyz, /api/generate
│       │   └── lib/            # redis client, prompt builder, cache
│       └── Dockerfile
├── packages/
│   └── shared/                 # Zod schema + TS types used by web AND api
├── k8s/                        # Kubernetes manifests
├── docker-compose.yml          # One-command local stack
└── .env.example
```

## 🚀 Getting started

### Prerequisites

- Node.js 22+ (`nvm use`)
- Docker (for Redis locally and for container builds)
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### Local development

```bash
cp .env.example .env            # then add your ANTHROPIC_API_KEY
npm install
docker run -d --name caas-redis -p 6379:6379 redis:7-alpine
npm run dev                     # web → http://localhost:3000, api → http://localhost:4000
```

The Next.js dev server proxies `/api/*` to the Fastify API, so the browser always talks to a single origin, just as it does behind the Ingress in Kubernetes.

### Tests

```bash
npm test                        # unit + HTTP tests (Vitest, Fastify inject, fake generator — no Redis or API key needed)
REDIS_TEST_URL=redis://localhost:6379 npm test   # also run the cross-replica rate-limit test
npm run lint                    # ESLint (type-aware TS rules + Next.js rules for apps/web)
npm run typecheck
npm run k8s:render              # render the Kustomize manifests
```

### Docker Compose

```bash
docker compose up --build
```

### Kubernetes

```bash
brew install k3d                # plus a Docker runtime (Docker Desktop, OrbStack, Colima)
cp .env.example .env            # add ANTHROPIC_API_KEY; it becomes the caas-secrets Secret
./scripts/k8s-local.sh up       # cluster + images + deploy  →  http://localhost:8080
```

On an existing cluster, use the images CI publishes; see [`k8s/README.md`](k8s/README.md#deploy-the-published-images).

### CI

[GitHub Actions](.github/workflows/ci.yml) runs on every pull request and push to `main`: lint, typecheck, tests,
Kubernetes manifest validation and Docker image builds. When all of that passes on `main`, both images are pushed to
GitHub Container Registry as `ghcr.io/ayooo1/caas-{api,web}`, tagged `sha-<commit>` and `latest`.

See [`k8s/README.md`](k8s/README.md) for Minikube / k3d / Kind specifics.

## 🔌 API

`POST /api/generate` (rate limited per client IP, shared across replicas via Redis)

```json
{ "duration": "1-3-years", "reason": "different-goals", "tone": "warm", "medium": "text",
  "name": "Sam", "details": "optional context, up to 500 chars" }
```

Valid values for each field live in [`packages/shared/src/validations.ts`](packages/shared/src/validations.ts).
The response is `text/plain`: the JSON object `{ "safetyConcern": false, "variations": [{ "angle", "message" }, …] }`,
streamed token by token. `x-cache` is `hit` (sent whole from Redis), `miss`, or `skip` (the answers include a name or
details, so they're never cached).

`ending` is optional and defaults to `relationship`; each ending accepts its own set of reasons.

Follow-ups on one chosen message (rate limited the same way, never cached):

| Endpoint | Body | Streams |
| --- | --- | --- |
| `POST /api/refine` | `{ questionnaire, message, refinement }` where `refinement` is `shorter`, `softer`, `more-direct`, `warmer` or `without-reason` | `{ "message" }` |
| `POST /api/replies` | `{ questionnaire, message }` | `{ "replies": [{ "theySay", "youCanSay" }, …] }` |
| `POST /api/practice` | `{ questionnaire, message, turns: [{ role: "them" \| "you", text }] }`, alternating and ending on `you` (empty to start), at most 8 replies | `{ "theySay", "coachTip", "conversationOver" }` |
| `POST /api/logistics` | `{ questionnaire, topics: ["belongings" \| "money" \| "home" \| "pets" \| "accounts"], notes?, safetyConcern? }` | `{ "message" }` |

`POST /api/feedback` takes `{ vote: "up" | "down", ending, duration, reason, tone, medium, changed, safetyConcern }`
and returns 204. It records counts per day in Redis and never any text; see `scripts/feedback-report.sh`.

| Status | Meaning |
| --- | --- |
| 200 | Generation (streamed or cached) |
| 400 | Invalid questionnaire; `issues` lists the offending fields |
| 413 | Body too large (4 KB for `/generate`, 40 KB for `/practice`, 8 KB for other follow-ups) |
| 429 | Rate limit exceeded |
| 502 | The model provider failed before producing output |

### Choosing the model

| `AI_MODEL` | Use it for |
| --- | --- |
| `claude-haiku-4-5` (default) | Fast, low-cost generations (~2.5s to first token, ~6s total) |
| `claude-opus-5-5` | The most thoughtful writing (~2-3s to first token, ~8s total, ~4x the cost). Gets server-side refusal fallbacks automatically; set `AI_EFFORT` to tune depth |

Set it in [`k8s/configmap.yaml`](k8s/configmap.yaml) (or `.env` locally). The response cache is keyed per model, so switching never serves the other model's output.

## 🩺 Health endpoints

| Service | Endpoint | Purpose |
| --- | --- | --- |
| api | `GET /healthz` | Liveness: the process is responsive |
| api | `GET /readyz` | Readiness: Redis is reachable |
| web | `GET /healthz` | Liveness and readiness |

## 📄 License

[MIT](LICENSE) © 2026 Ayo Osonowo
