#!/bin/sh
#SBATCH --account=ie-idi
#SBATCH --job-name="augment-maritime"
#SBATCH --time=00:30:00
#SBATCH --partition=CPUQ
#SBATCH --mem=16GB
#SBATCH --nodes=1
#SBATCH --cpus-per-task=1
#SBATCH --output=logs/augment_%j.out
#SBATCH --error=logs/augment_%j.err
#SBATCH --mail-user=ludvigho@ntnu.no
#SBATCH --mail-type=ALL

WORKDIR=${SLURM_SUBMIT_DIR}
cd ${WORKDIR}
mkdir -p logs

DATA_DIR="/cluster/home/ludvigho/openar-it2901-ntnu/backend/data/maritime_collision_avoidance"

echo "=========================================="
echo "Job ID: $SLURM_JOB_ID"
echo "Started: $(date)"
echo "Train images: $(ls ${DATA_DIR}/images/train/ | wc -l)"
echo "Train labels: $(ls ${DATA_DIR}/labels/train/ | wc -l)"
echo "=========================================="

ENV_PATH="/cluster/work/ludvigho/rtdetr-env"

module purge
module load Anaconda3/2024.02-1

if [ ! -d "${ENV_PATH}" ]; then
    conda create -y --prefix ${ENV_PATH} python=3.11
fi

source activate ${ENV_PATH}

python -c "import albumentations" 2>/dev/null || {
    pip install albumentations opencv-python-headless
}

IMG_DIR="${DATA_DIR}/images/train" \
LABEL_DIR="${DATA_DIR}/labels/train" \
python augmentation.py

echo "=========================================="
echo "After augmentation:"
echo "  Train images: $(ls ${DATA_DIR}/images/train/ | wc -l)"
echo "  Train labels: $(ls ${DATA_DIR}/labels/train/ | wc -l)"
echo "Finished: $(date)"
echo "=========================================="

conda deactivate
