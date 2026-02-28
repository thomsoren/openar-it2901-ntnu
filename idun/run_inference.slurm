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

mkdir -p logs

WORK_DIR="/cluster/home/ludvigho/openar-it2901-ntnu/idun"
ENV_DIR="/cluster/work/ludvigho/openar-inference-env"

cd "${WORK_DIR}"

module purge
module load Python/3.11.5-GCCcore-13.2.0

if [ ! -d "${ENV_DIR}" ]; then
    echo "Creating virtual environment at ${ENV_DIR}"
    python -m venv "${ENV_DIR}"
fi
source "${ENV_DIR}/bin/activate"

pip install -q -r requirements.txt

export COOLIFY_WS_URL="wss://api.demo.bridgable.ai/api/idun/ws"
export IDUN_API_KEY="${IDUN_API_KEY}"

echo "Starting inference worker at $(date)"
echo "COOLIFY_WS_URL=${COOLIFY_WS_URL}"
echo "Model: best.pt"

python inference_worker.py --model best.pt
