# ApartmentFinder API — FastAPI + ADK agent pipeline, for Cloud Run.
#
# The frontend (Next.js) is NOT in this image; it deploys separately to Vercel and
# talks to this service over HTTPS. See CLAUDE.md → Deployment.
#
# python:3.10-slim matches the local .venv (Python 3.10) so a dependency that
# resolves locally resolves identically here.
FROM python:3.10-slim

# - PYTHONUNBUFFERED: the app's progress/guardrail prints (e.g. "📊 RentCast usage:
#   3/50") must reach Cloud Run Logging as they happen, not sit in a buffer.
# - PYTHONDONTWRITEBYTECODE: no .pyc in an immutable, throwaway container.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, in their own layer — application edits then rebuild in
# seconds instead of re-resolving the (heavy: adk + litellm + langfuse) tree.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Only what the server actually imports. No data/ (the ~195MB of retired CSVs),
# no frontend/, no tests, no .env — see .dockerignore.
COPY apartment_finder/ ./apartment_finder/
COPY api/ ./api/

# Cloud Run injects $PORT and requires listening on 0.0.0.0. `exec` so uvicorn is
# PID 1 and receives SIGTERM directly — otherwise the shell swallows it and Cloud
# Run kills the container after the grace period instead of shutting down cleanly.
ENV PORT=8080
CMD exec uvicorn api.server:app --host 0.0.0.0 --port ${PORT}
