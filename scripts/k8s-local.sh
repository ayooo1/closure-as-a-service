#!/usr/bin/env bash
# Local Kubernetes workflow on k3d.  Usage: scripts/k8s-local.sh {up|deploy|monitoring|grafana|status|down}
set -euo pipefail

CLUSTER=caas
NS=caas
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() { command -v "$1" >/dev/null || { echo "✗ '$1' not found. Install it first (see README)." >&2; exit 1; }; }

create_cluster() {
  if k3d cluster list -o json | grep -q "\"name\":\"$CLUSTER\""; then
    echo "• Cluster '$CLUSTER' already exists"
  else
    echo "• Creating k3d cluster '$CLUSTER'"
    k3d cluster create --config k8s/k3d-cluster.yaml --wait
  fi
  kubectl config use-context "k3d-$CLUSTER" >/dev/null
}

build_images() {
  [[ -f package-lock.json ]] || { echo "• Generating package-lock.json"; npm install --package-lock-only --no-audit --no-fund; }
  echo "• Building images (in parallel)"
  docker build -q -t caas-api:local -f apps/api/Dockerfile . & local api=$!
  docker build -q -t caas-web:local -f apps/web/Dockerfile . & local web=$!
  wait "$api" && wait "$web"
  echo "• Importing images into the cluster"
  k3d image import caas-api:local caas-web:local -c "$CLUSTER"
}

apply_secret() {
  local key
  key="$(grep -E '^ANTHROPIC_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || true)"
  if [[ -z "$key" || "$key" == "sk-ant-..." ]]; then
    echo "✗ Set ANTHROPIC_API_KEY in .env (cp .env.example .env)" >&2
    exit 1
  fi
  # Declaratively, so the later `kubectl apply -k` owns the namespace without warnings.
  kubectl apply -f k8s/namespace.yaml >/dev/null
  kubectl -n "$NS" create secret generic caas-secrets \
    --from-literal=ANTHROPIC_API_KEY="$key" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "• Secret caas-secrets applied"
}

deploy() {
  apply_secret
  local existed
  existed="$(kubectl -n "$NS" get deployment api web -o name 2>/dev/null || true)"
  echo "• Applying manifests"
  kubectl apply -k k8s/
  # Pick up freshly imported images even though the tag (:local) didn't change.
  # Skipped on first deploy: the pods were just created from the new images.
  [[ -n "$existed" ]] && kubectl -n "$NS" rollout restart deployment/api deployment/web >/dev/null
  for d in redis api web; do
    kubectl -n "$NS" rollout status "deployment/$d" --timeout=180s
  done
  echo
  echo "✓ Ready: http://localhost:8080"
}

# Prometheus + Grafana in the "monitoring" namespace (k8s/monitoring), then opens Grafana.
monitoring() {
  kubectl apply -f k8s/monitoring/namespace.yaml >/dev/null
  if ! kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1; then
    kubectl -n monitoring create secret generic grafana-admin \
      --from-literal=password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)" >/dev/null
    echo "• Created the Grafana admin password (kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.password}' | base64 -d)"
  fi
  echo "• Applying monitoring manifests"
  kubectl apply -k k8s/monitoring/
  for d in prometheus grafana; do
    kubectl -n monitoring rollout status "deployment/$d" --timeout=180s
  done
  grafana
}

grafana() {
  local port
  for port in 3001 9090; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "✗ Port $port is already in use (another port-forward still running?). Find it with: lsof -nP -iTCP:$port -sTCP:LISTEN" >&2
      exit 1
    fi
  done
  echo
  echo "✓ Grafana: http://localhost:3001  ·  Prometheus: http://localhost:9090  (Ctrl-C to stop)"
  kubectl -n monitoring port-forward svc/grafana 3001:3000 >/dev/null &
  local grafana_pid=$!
  trap 'kill "$grafana_pid" 2>/dev/null' EXIT
  kubectl -n monitoring port-forward svc/prometheus 9090:9090 >/dev/null
}

case "${1:-up}" in
  up)     need docker; need k3d; need kubectl; need npm; create_cluster; build_images; deploy ;;
  deploy) need docker; need k3d; need kubectl; build_images; deploy ;;
  monitoring) need kubectl; monitoring ;;
  grafana)    need kubectl; grafana ;;
  status) kubectl -n "$NS" get pods,svc,ingress,hpa -o wide ;;
  down)   k3d cluster delete "$CLUSTER" ;;
  *)      echo "Usage: $0 {up|deploy|monitoring|grafana|status|down}" >&2; exit 1 ;;
esac
