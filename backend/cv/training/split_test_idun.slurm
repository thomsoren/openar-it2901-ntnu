#!/bin/sh
#SBATCH --account=ie-idi
#SBATCH --job-name="split-test"
#SBATCH --time=00:05:00
#SBATCH --partition=CPUQ
#SBATCH --mem=4GB
#SBATCH --nodes=1
#SBATCH --cpus-per-task=1
#SBATCH --output=logs/split_%j.out
#SBATCH --error=logs/split_%j.err

WORKDIR=${SLURM_SUBMIT_DIR}
cd ${WORKDIR}
mkdir -p logs

ENV_PATH="/cluster/work/ludvigho/rtdetr-env"

module purge
module load Anaconda3/2024.02-1

if [ ! -d "${ENV_PATH}" ]; then
    conda create -y --prefix ${ENV_PATH} python=3.11
fi

source activate ${ENV_PATH}

DATA_DIR="/cluster/home/ludvigho/openar-it2901-ntnu/backend/data/maritime_collision_avoidance"

echo "Before split:"
echo "  Val images: $(ls ${DATA_DIR}/images/val/ | wc -l)"

python split_test_set.py "$DATA_DIR" --ratio 0.5 --seed 42

echo "After split:"
echo "  Val images: $(ls ${DATA_DIR}/images/val/ | wc -l)"
echo "  Test images: $(ls ${DATA_DIR}/images/test/ | wc -l)"

conda deactivate
