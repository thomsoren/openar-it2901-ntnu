#!/bin/bash
#SBATCH --job-name=rtdetr-seaships
#SBATCH --account=ie-idi          # Your IDUN project account
#SBATCH --partition=GPUQ
#SBATCH --gres=gpu:1              # Request 1 GPU (use gpu:2 for multi-GPU)
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=12:00:00           # Max walltime (adjust based on epochs)
#SBATCH --output=logs/slurm-%j.out
#SBATCH --error=logs/slurm-%j.err
#SBATCH --mail-type=END,FAIL
#SBATCH --mail-user=your.email@ntnu.no  # Change this!

# ============================================================================
# RT-DETR Training on IDUN
# ============================================================================
# Usage:
#   1. Copy dataset to IDUN: scp -r SeaShips/ idun:/cluster/work/your_username/
#   2. Update DATA_DIR below
#   3. Submit: sbatch train_idun.slurm
#
# Monitor:
#   squeue -u $USER              # Check job status
#   tail -f logs/slurm-<jobid>.out  # Watch output
#   scancel <jobid>              # Cancel job
# ============================================================================

set -e  # Exit on error

# Configuration - UPDATE THESE
DATA_DIR="/cluster/work/$USER/SeaShips"
EPOCHS=100
BATCH_SIZE=16
MODEL="rtdetr-l.pt"
IMGSZ=640

# Create logs directory
mkdir -p logs

echo "=========================================="
echo "Job ID: $SLURM_JOB_ID"
echo "Node: $SLURM_NODELIST"
echo "Start time: $(date)"
echo "=========================================="

# Load modules
module purge
module load Python/3.11.5-GCCcore-13.2.0
module load CUDA/12.1.1

# Create/activate virtual environment
VENV_DIR="$HOME/.venvs/rtdetr"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment at $VENV_DIR"
    python -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

# Install dependencies (only if needed)
pip install --quiet --upgrade pip
pip install --quiet ultralytics torch torchvision --index-url https://download.pytorch.org/whl/cu121

# Print environment info
echo ""
echo "Python: $(which python)"
echo "PyTorch: $(python -c 'import torch; print(torch.__version__)')"
echo "CUDA available: $(python -c 'import torch; print(torch.cuda.is_available())')"
echo "GPU: $(python -c 'import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A")')"
echo ""

# Navigate to training directory
cd "$(dirname "$0")"

# Run training
echo "Starting RT-DETR training..."
echo "Data: $DATA_DIR"
echo "Epochs: $EPOCHS"
echo "Batch size: $BATCH_SIZE"
echo ""

python train.py \
    --data-dir "$DATA_DIR" \
    --model "$MODEL" \
    --epochs "$EPOCHS" \
    --batch "$BATCH_SIZE" \
    --imgsz "$IMGSZ" \
    --device 0 \
    --project "runs/train" \
    --name "seaships-$(date +%Y%m%d-%H%M%S)"

echo ""
echo "=========================================="
echo "Job completed at $(date)"
echo "=========================================="
