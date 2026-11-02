# Culprit: FastAPI app + static frontend in one container.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static
COPY tests ./tests

# Fail the build if the analysis tests fail.
RUN python -m unittest discover -s tests -t .

# Run as a non-root user; data/ holds the SQLite db and photos (mount a volume there).
RUN useradd --create-home culprit \
    && mkdir -p data/photos \
    && chown -R culprit:culprit /app/data
USER culprit

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
