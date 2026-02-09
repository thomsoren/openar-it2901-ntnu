#!/bin/bash
#SBATCH --job-name=rtdetr-ships
#SBATCH --account=ie-idi
#SBATCH --partition=GPUQ
#SBATCH --gres=gpu:1
#SBATCH --time=12:00:00
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --output=logs/train_%j.out
#SBATCH --error=logs/train_%j.err

echo "=========================================="
echo "Job ID: $SLURM_JOB_ID"
echo "Node: $SLURM_NODELIST"
echo "Started: $(date)"
echo "=========================================="

# Load modules
module purge
module load Python/3.11.5-GCCcore-13.2.0
module load CUDA/12.1.1

# Setup
cd $SLURM_SUBMIT_DIR
mkdir -p logs

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python -m venv venv
fi

source venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install ultralytics pyyaml

# Run training
echo "Starting training..."
python train.py

echo "=========================================="
echo "Finished: $(date)"
echo "=========================================="
