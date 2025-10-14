# Kubernetes Manifests

These manifests provide a minimal deployment for the Arena web and referee services.

Files:
- `namespace.yaml` — Namespace `arena`
- `referee-deployment.yaml` — API Deployment, Service, PVC
- `web-deployment.yaml` — Web Deployment and Service
- `ingress.yaml` — Ingress routing `arena.local` to web and `/api` to referee

Quick start (with an NGINX ingress controller installed):

1. Apply manifests:
   - `kubectl apply -f deploy/k8s/namespace.yaml`
   - `kubectl apply -f deploy/k8s/referee-deployment.yaml`
   - `kubectl apply -f deploy/k8s/web-deployment.yaml`
   - `kubectl apply -f deploy/k8s/ingress.yaml`
2. Set DNS or hosts entry for `arena.local` to your ingress IP.
3. Ensure `NEXT_PUBLIC_REFEREE_URL` matches how the web app reaches the API (for the provided manifests, set to `http://arena.local/api`). Alternatively, keep it as an internal cluster URL and configure web to proxy API routes.

Notes:
- Replace `ghcr.io/OWNER/REPO/...:latest` with your built image names.
- The referee uses a PVC for SQLite persistence. For HA/multi-replica API, use an external database.

