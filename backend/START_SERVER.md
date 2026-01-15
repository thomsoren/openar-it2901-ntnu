# Starting the Roboflow Inference Server

## Quick Start

The inference server is running in the background. To start it manually:

### Option 1: Using uv (recommended)

```bash
cd /Users/nybruker/Documents/Skole/v26/Bachelor/openar/backend
uv run inference server start
```

### Option 2: Direct command (if inference is in PATH)

```bash
inference server start
```

## Check if Server is Running

```bash
curl http://localhost:9001/
```

If working, you should see a response like:
```
{"message":"Roboflow Inference Server"}
```

## First Time Setup

The first time you run `inference server start`, it will:
1. Pull the Docker image (this can take 5-10 minutes)
2. Start the container
3. Expose the server on port 9001

## Troubleshooting

### Server won't start
- **Check Docker is running**: `docker ps`
- **Check port 9001 is free**: `lsof -i :9001`
- **View Docker logs**: `docker logs roboflow-inference`

### "command not found: inference"
Run with uv: `uv run inference server start`

### Docker image pull is slow
This is normal on first run. The image is ~2-5GB depending on your architecture.

## Once Server is Running

Run the detection script:
```bash
uv run detect_boats.py
```

## Stop the Server

```bash
uv run inference server stop
```

Or stop the Docker container directly:
```bash
docker stop roboflow-inference
```
