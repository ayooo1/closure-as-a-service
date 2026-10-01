# Kubernetes manifests

| File | What it defines |
| --- | --- |
| `namespace.yaml` | `caas` namespace |
| `configmap.yaml` | Non-secret env for the API |
| `secret.example.yaml` | Template for `caas-secrets` (`OPENAI_API_KEY`); the real one is created from `.env` |
| `redis.yaml` | Redis Deployment + Service (rate limiting & cache) |
| `deployment.yaml` | `api` and `web` Deployments with startup/liveness/readiness probes |
| `service.yaml` | ClusterIP Services for `api` and `web` |
| `ingress.yaml` | `/api` → api, `/` → web |
| `hpa.yaml` | CPU-based autoscaling for api (2–6) and web (1–4) |
| `kustomization.yaml` | Ties it together: `kubectl apply -k k8s/` |
| `k3d-cluster.yaml` | Local k3d cluster, exposes the Ingress on `localhost:8080` |

## Run locally (k3d)

```bash
./scripts/k8s-local.sh up      # create cluster, build + import images, deploy
open http://localhost:8080
./scripts/k8s-local.sh status  # pods, services, ingress, HPAs
./scripts/k8s-local.sh down    # delete the cluster
```

Images are built locally as `caas-web:local` / `caas-api:local` and imported into the
cluster with `k3d image import`, so no registry is needed.
