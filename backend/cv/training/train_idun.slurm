#!/bin/sh
#SBATCH --account=ie-idi
#SBATCH --job-name="rtdetr-ships"
#SBATCH --time=12:00:00
#SBATCH --partition=GPUQ
#SBATCH --gres=gpu:1
#SBATCH --mem=32GB
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --output=logs/train_%j.out
#SBATCH --error=logs/train_%j.err
#SBATCH --mail-user=ludvigho@ntnu.no
#SBATCH --mail-type=ALL

WORKDIR=${SLURM_SUBMIT_DIR}
cd ${WORKDIR}
mkdir -p logs

echo "=========================================="
echo "Running from: $SLURM_SUBMIT_DIR"
echo "Job name: $SLURM_JOB_NAME"
echo "Job ID: $SLURM_JOB_ID"
echo "Nodes: $SLURM_JOB_NODELIST"
echo "Started: $(date)"
echo "=========================================="

ENV_PATH="/cluster/work/ludvigho/rtdetr-env"

# Load modules
module purge
module load Anaconda3/2024.02-1

# Create conda environment if it doesn't exist
if [ ! -d "${ENV_PATH}" ]; then
    echo "Creating new conda environment..."
    conda create -y --prefix ${ENV_PATH} python=3.11
else
    echo "Conda environment exists, skipping creation."
fi

# Activate environment
source activate ${ENV_PATH}

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install ultralytics pyyaml

# GPU check
echo "=========================================="
echo "GPU Information:"
nvidia-smi
echo ""
python -c "import torch; print(f'CUDA Available: {torch.cuda.is_available()}'); print(f'Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"
echo "=========================================="

# Run training
echo "Starting RT-DETR training..."
python train.py

# Cleanup
conda deactivate

echo "=========================================="
echo "Finished: $(date)"
echo "=========================================="
