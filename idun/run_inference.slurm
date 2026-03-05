#!/bin/bash
#SBATCH --account=ie-idi
#SBATCH --job-name=openar-inference
#SBATCH --partition=GPUQ
#SBATCH --gres=gpu:1
#SBATCH --time=08:00:00
#SBATCH --mem=16G
#SBATCH --nodes=1
#SBATCH --cpus-per-task=4
#SBATCH --output=logs/inference_%j.out
#SBATCH --error=logs/inference_%j.err
#SBATCH --signal=B:SIGTERM@120

mkdir -p logs

WORK_DIR="/cluster/home/ludvigho/openar-it2901-ntnu/idun"
ENV_DIR="/cluster/work/ludvigho/openar-inference-env"

cd "${WORK_DIR}"

module purge
module load Python/3.11.5-GCCcore-13.2.0
module load PyTorch/2.1.2-foss-2023b-CUDA-12.1.1

if [ ! -d "${ENV_DIR}" ]; then
    echo "Creating virtual environment at ${ENV_DIR}"
    python -m venv --system-site-packages "${ENV_DIR}"
fi
source "${ENV_DIR}/bin/activate"

pip install -q -r requirements.txt

if [ -z "${COOLIFY_WS_URL}" ]; then
    echo "Error: COOLIFY_WS_URL is not set. Export it before calling sbatch." >&2
    exit 1
fi
if [ -z "${IDUN_API_KEY}" ]; then
    echo "Error: IDUN_API_KEY is not set. Export it before calling sbatch." >&2
    exit 1
fi

echo "Starting inference worker at $(date)"
echo "COOLIFY_WS_URL=${COOLIFY_WS_URL}"
echo "Model: 1000_german_images.pt"

python inference_worker.py --model 1000_german_images.pt
