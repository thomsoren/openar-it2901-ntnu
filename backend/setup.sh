#!/bin/bash
# Setup script for boat detection backend

echo "🚢 Setting up OpenAR Boat Detection Backend"
echo ""

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "❌ uv is not installed. Please install it first:"
    echo "   curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

echo "✅ uv is installed"

# Sync dependencies
echo ""
echo "📦 Installing dependencies with uv..."
uv sync

echo ""
echo "✅ Dependencies installed"

# Check if .env exists
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env and add your Roboflow API key"
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo ""
    echo "⚠️  Docker is not running. The Inference server requires Docker."
    echo "   Please start Docker Desktop and try again."
    exit 1
fi

echo ""
echo "✅ Docker is running"

# Check if inference server is already running
if curl -s http://localhost:9001/ &> /dev/null; then
    echo ""
    echo "✅ Inference server is already running on port 9001"
else
    echo ""
    echo "🐳 Starting Roboflow Inference server..."
    echo "   (This will pull Docker image on first run)"
    inference server start &

    echo ""
    echo "⏳ Waiting for server to start..."
    sleep 10

    if curl -s http://localhost:9001/ &> /dev/null; then
        echo "✅ Inference server started successfully"
    else
        echo "⚠️  Server may still be starting. Check with: curl http://localhost:9001/"
    fi
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your Roboflow API key"
echo "  2. Run detection: uv run detect_boats.py"
echo ""
