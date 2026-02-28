"""Split a portion of the validation set into a held-out test set.

Usage:
    python split_test_set.py /path/to/dataset [--ratio 0.5] [--seed 42]

Expects the dataset directory to contain:
    images/val/   (image files)
    labels/val/   (matching .txt label files)

Creates:
    images/test/
    labels/test/

Files are MOVED (not copied) from val → test.
"""

import argparse
import random
import shutil
from pathlib import Path

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png"}


def main():
    parser = argparse.ArgumentParser(description="Split val into val + test")
    parser.add_argument("dataset_dir", type=Path, help="Root dataset directory")
    parser.add_argument("--ratio", type=float, default=0.5,
                        help="Fraction of val to move to test (default: 0.5)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    val_img_dir = args.dataset_dir / "images" / "val"
    val_lbl_dir = args.dataset_dir / "labels" / "val"
    test_img_dir = args.dataset_dir / "images" / "test"
    test_lbl_dir = args.dataset_dir / "labels" / "test"

    if not val_img_dir.exists():
        raise FileNotFoundError(f"Val image dir not found: {val_img_dir}")

    test_img_dir.mkdir(parents=True, exist_ok=True)
    test_lbl_dir.mkdir(parents=True, exist_ok=True)

    all_images = sorted(
        f for f in val_img_dir.iterdir()
        if f.suffix.lower() in IMG_EXTENSIONS
    )

    n_test = int(len(all_images) * args.ratio)
    if n_test == 0:
        print(f"Only {len(all_images)} val images — nothing to split.")
        return

    random.seed(args.seed)
    test_images = random.sample(all_images, n_test)

    moved = 0
    for img_path in test_images:
        label_path = val_lbl_dir / (img_path.stem + ".txt")

        shutil.move(str(img_path), str(test_img_dir / img_path.name))
        if label_path.exists():
            shutil.move(str(label_path), str(test_lbl_dir / label_path.name))

        moved += 1

    print(f"Moved {moved} images from val → test (ratio={args.ratio}, seed={args.seed})")
    print(f"  Val remaining: {len(all_images) - moved}")
    print(f"  Test: {moved}")


if __name__ == "__main__":
    main()
