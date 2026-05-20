# AWS deployment guide

This project is split into:

- `frontend/`: Vite + React static site
- `backend/`: FastAPI + SQLite + PyTorch + Transformers model

## Reality check on "free"

For this codebase, AWS is only partly free.

- The frontend can fit well on AWS Amplify Hosting free tier / trial credits.
- The backend API can run on EC2.
- The model backend is not a good fit for Lambda.
- A `t2.micro` or `t3.micro` free-tier EC2 instance is likely too small for this backend because the repo includes:
  - `backend/ticket_model_best.pt` at about 265 MB
  - `torch`
  - `transformers`
  - DistilBERT runtime memory overhead

If your AWS account was created on or after July 15, 2025, AWS now uses a credits-based free plan for many services instead of the older 12-month pattern. Check your exact account type before deploying.

## Recommended AWS setup

Use this split:

1. Frontend on AWS Amplify Hosting
2. Backend + model on one EC2 Ubuntu instance
3. Optional custom domain later

This is the simplest path for your current code.

## Architecture

- Amplify serves the React app
- The React app calls the FastAPI backend using `VITE_API_BASE_URL`
- EC2 runs the backend container
- SQLite stays on the EC2 instance filesystem

## 1. Deploy the frontend to Amplify

This repo already includes `amplify.yml`.

In Amplify:

1. Open AWS Amplify
2. Choose `New app`
3. Choose `Host web app`
4. Connect your GitHub repository
5. Select the repository and branch
6. Keep the build file detected from `amplify.yml`
7. Add environment variable:
   - `VITE_API_BASE_URL=http://YOUR_EC2_PUBLIC_IP:8000`
8. Deploy

Notes:

- `frontend/vite.config.js` now uses `VITE_BASE_PATH`, so Amplify can build at `/`.
- If you later host under a subpath, set `VITE_BASE_PATH` accordingly.

## 2. Deploy the backend to EC2

### Instance choice

For this backend, prefer at least:

- `t3.small` if you have credits
- `t3.medium` if `t3.small` is unstable during model load

Do not assume a micro instance will be reliable for PyTorch + Transformers.

### Launch steps

1. Open EC2 in AWS Console
2. Launch an Ubuntu instance
3. Allow inbound:
   - `22` from your IP only
   - `8000` from anywhere for testing
4. SSH into the instance

### Install Docker on Ubuntu

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

Log out and back in once after adding yourself to the `docker` group.

### Copy the backend to the server

You can use `git clone` on the EC2 instance, or upload the repo.

### Build and run

From the project `backend/` directory on the EC2 machine:

```bash
docker build -t supportai-backend .
docker run -d \
  --name supportai-api \
  -p 8000:8000 \
  -e PORT=8000 \
  -e MODEL_PATH=/app/ticket_model_best.pt \
  -e DB_PATH=/app/data/supportai.db \
  -v $(pwd)/data:/app/data \
  supportai-backend
```

Then test:

```bash
curl http://YOUR_EC2_PUBLIC_IP:8000/health
```

### Important note about first startup

`transformers` may download the DistilBERT base model on first run if it is not already cached in the image or filesystem. That can take time and bandwidth.

## 3. Connect frontend to backend

After the EC2 backend is reachable:

1. Go to Amplify app settings
2. Set `VITE_API_BASE_URL` to:

```text
http://YOUR_EC2_PUBLIC_IP:8000
```

3. Redeploy the frontend

## 4. Production improvements

Before using this publicly, fix these:

- Restrict CORS in `backend/api.py`
- Put Nginx in front of the backend
- Use HTTPS with a domain
- Move away from SQLite if you expect real multi-user traffic
- Change default admin credentials via env vars:
  - `ADMIN_USER`
  - `ADMIN_PASS`

## Cheapest realistic path

If your goal is the lowest possible cost:

- Put only the frontend on Amplify
- Keep the backend off until demo time
- Or run the backend on EC2 only while presenting/testing

That is cheaper than keeping a model server running 24/7.
