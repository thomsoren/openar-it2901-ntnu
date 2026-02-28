#!/bin/sh
#SBATCH --account=ie-idi
#SBATCH --job-name="rtdetr-maritime"
#SBATCH --time=24:00:00
#SBATCH --partition=GPUQ
#SBATCH --gres=gpu:1
#SBATCH --mem=32GB
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --output=logs/train_%j.out
#SBATCH --error=logs/train_%j.err
#SBATCH --mail-user=ludvigho@ntnu.no
#SBATCH --mail-type=ALL

CONFIG=${1:-config_maritime_collision.yaml}

WORKDIR=${SLURM_SUBMIT_DIR}
cd ${WORKDIR}
mkdir -p logs

echo "=========================================="
echo "Running from: $SLURM_SUBMIT_DIR"
echo "Config: $CONFIG"
echo "Job ID: $SLURM_JOB_ID"
echo "Nodes: $SLURM_JOB_NODELIST"
echo "Started: $(date)"
echo "=========================================="

ENV_PATH="/cluster/work/ludvigho/rtdetr-env"

module purge
module load Anaconda3/2024.02-1

if [ ! -d "${ENV_PATH}" ]; then
    echo "Creating new conda environment..."
    conda create -y --prefix ${ENV_PATH} python=3.11
fi

source activate ${ENV_PATH}

# Only install if ultralytics is missing
python -c "import ultralytics" 2>/dev/null || {
    echo "Installing dependencies..."
    pip install --upgrade pip
    pip install ultralytics==8.3.* pyyaml
}

# Install optuna if missing
python -c "import optuna" 2>/dev/null || {
    echo "Installing optuna..."
    pip install optuna
}

echo "=========================================="
echo "GPU Information:"
nvidia-smi
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, Device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}, VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB' if torch.cuda.is_available() else 'No CUDA')"
echo "=========================================="

echo "Starting RT-DETR training..."
python train.py "$CONFIG"
EXIT_CODE=$?

conda deactivate

echo "=========================================="
echo "Exit code: $EXIT_CODE"
echo "Finished: $(date)"
echo "=========================================="
