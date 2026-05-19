FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend files
COPY . .

# Expose Hugging Face default port
EXPOSE 7860

# Run the app
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "7860"]