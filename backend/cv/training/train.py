#!/usr/bin/env python3
"""
RT-DETR Training Script for SeaShips Dataset (COCO format)

Handles the full pipeline:
1. Convert COCO annotations to YOLO format
2. Train RT-DETR model
3. Validate and export

Usage:
    # Full pipeline
    python train.py --data-dir /path/to/SeaShips --epochs 100

    # Skip conversion if already done
    python train.py --data-dir /path/to/SeaShips --epochs 100 --skip-convert

    # Just convert (no training)
    python train.py --data-dir /path/to/SeaShips --prepare-only
"""

import argparse
import json
import random
import shutil
from pathlib import Path

VAL_SPLIT_RATIO = 0.15  # 15% of training data used for validation


def create_val_split_from_train(data_dir: Path, val_ratio: float = VAL_SPLIT_RATIO) -> None:
    """
    Create a validation split from training data if no val/valid folder exists.
    Splits the COCO annotations and moves images accordingly.
    """
    train_dir = data_dir / "train"
    val_dir = data_dir / "valid"

    if not train_dir.exists():
        return

    # Check if val already exists
    if val_dir.exists() or (data_dir / "val").exists():
        print("  Validation split already exists, skipping auto-split")
        return

    coco_file = train_dir / "_annotations.coco.json"
    if not coco_file.exists():
        return

    print(f"  Creating validation split ({val_ratio:.0%} of training data)...")

    with open(coco_file) as f:
        coco = json.load(f)

    # Get all image ids and shuffle
    image_ids = [img["id"] for img in coco["images"]]
    random.seed(42)  # Reproducible split
    random.shuffle(image_ids)

    # Split
    val_count = int(len(image_ids) * val_ratio)
    val_image_ids = set(image_ids[:val_count])
    train_image_ids = set(image_ids[val_count:])

    # Create val directory
    val_dir.mkdir(parents=True, exist_ok=True)

    # Split images
    train_images = []
    val_images = []
    for img in coco["images"]:
        if img["id"] in val_image_ids:
            val_images.append(img)
            # Move image file
            src = train_dir / img["file_name"]
            if src.exists():
                shutil.move(str(src), str(val_dir / img["file_name"]))
        else:
            train_images.append(img)

    # Split annotations
    train_annotations = []
    val_annotations = []
    for ann in coco["annotations"]:
        if ann["image_id"] in val_image_ids:
            val_annotations.append(ann)
        else:
            train_annotations.append(ann)

    # Write new COCO files
    train_coco = {
        "images": train_images,
        "annotations": train_annotations,
        "categories": coco["categories"],
    }
    val_coco = {
        "images": val_images,
        "annotations": val_annotations,
        "categories": coco["categories"],
    }

    with open(coco_file, "w") as f:
        json.dump(train_coco, f)

    with open(val_dir / "_annotations.coco.json", "w") as f:
        json.dump(val_coco, f)

    print(f"  Split complete: {len(train_images)} train, {len(val_images)} val images")


def convert_coco_to_yolo(data_dir: Path) -> dict:
    """
    Convert Roboflow COCO format to YOLO format.

    Expected input structure:
        data_dir/
        ├── train/
        │   ├── _annotations.coco.json
        │   └── *.jpg
        ├── valid/  (or val/)
        │   ├── _annotations.coco.json
        │   └── *.jpg
        └── test/
            ├── _annotations.coco.json
            └── *.jpg

    Output structure:
        data_dir/
        ├── images/
        │   ├── train/
        │   ├── val/
        │   └── test/
        └── labels/
            ├── train/
            ├── val/
            └── test/
    """
    print(f"Converting COCO to YOLO format in {data_dir}")

    # Map possible split names
    split_mapping = {
        "train": "train",
        "valid": "val",
        "val": "val",
        "test": "test",
    }

    class_names = None

    for src_split, dst_split in split_mapping.items():
        src_dir = data_dir / src_split
        if not src_dir.exists():
            continue

        coco_file = src_dir / "_annotations.coco.json"
        if not coco_file.exists():
            print(f"  Warning: No _annotations.coco.json in {src_dir}")
            continue

        # Create output directories
        img_out_dir = data_dir / "images" / dst_split
        label_out_dir = data_dir / "labels" / dst_split
        img_out_dir.mkdir(parents=True, exist_ok=True)
        label_out_dir.mkdir(parents=True, exist_ok=True)

        # Load COCO annotations
        with open(coco_file) as f:
            coco = json.load(f)

        # Extract class names (use first split's categories)
        if class_names is None:
            class_names = {cat["id"]: cat["name"] for cat in coco["categories"]}
            # Create id mapping (COCO ids may not be sequential)
            id_to_idx = {cat_id: idx for idx, cat_id in enumerate(sorted(class_names.keys()))}

        # Build image lookup
        images = {img["id"]: img for img in coco["images"]}

        # Group annotations by image
        img_annotations = {}
        for ann in coco["annotations"]:
            img_id = ann["image_id"]
            if img_id not in img_annotations:
                img_annotations[img_id] = []
            img_annotations[img_id].append(ann)

        # Process each image
        converted = 0
        for img_id, img_info in images.items():
            img_name = img_info["file_name"]
            img_w = img_info["width"]
            img_h = img_info["height"]

            # Copy image
            src_img = src_dir / img_name
            if src_img.exists():
                shutil.copy(src_img, img_out_dir / img_name)

            # Convert annotations
            label_file = label_out_dir / (Path(img_name).stem + ".txt")
            labels = []

            for ann in img_annotations.get(img_id, []):
                cat_id = ann["category_id"]
                class_idx = id_to_idx[cat_id]

                # COCO bbox is [x, y, width, height] (top-left corner)
                x, y, w, h = ann["bbox"]

                # Convert to YOLO format (center x, center y, width, height) normalized
                x_center = (x + w / 2) / img_w
                y_center = (y + h / 2) / img_h
                w_norm = w / img_w
                h_norm = h / img_h

                labels.append(f"{class_idx} {x_center:.6f} {y_center:.6f} {w_norm:.6f} {h_norm:.6f}")

            if labels:
                label_file.write_text("\n".join(labels) + "\n")
                converted += 1

        print(f"  {dst_split}: {converted} images with labels")

    # Return class info for data.yaml
    return {
        "names": {id_to_idx[cat_id]: name for cat_id, name in class_names.items()},
        "nc": len(class_names),
    }


def create_data_yaml(data_dir: Path, class_info: dict) -> Path:
    """Create YOLO data.yaml config file."""
    yaml_path = data_dir / "data.yaml"

    names_str = "\n".join(f"  {idx}: {name}" for idx, name in sorted(class_info["names"].items()))

    yaml_content = f"""# SeaShips Dataset Configuration
# Auto-generated by train.py

path: {data_dir.absolute()}
train: images/train
val: images/val
test: images/test

nc: {class_info["nc"]}
names:
{names_str}
"""
    yaml_path.write_text(yaml_content)
    print(f"Created data config: {yaml_path}")
    return yaml_path


def train_model(
    data_yaml: Path,
    model: str = "rtdetr-l.pt",
    epochs: int = 100,
    imgsz: int = 640,
    batch: int = 16,
    device: str = "0",
    project: str = "runs/train",
    name: str = "seaships",
    resume: bool = False,
):
    """Train RT-DETR model."""
    from ultralytics import RTDETR

    print(f"\n{'='*60}")
    print(f"Training RT-DETR")
    print(f"  Model: {model}")
    print(f"  Data: {data_yaml}")
    print(f"  Epochs: {epochs}")
    print(f"  Image size: {imgsz}")
    print(f"  Batch size: {batch}")
    print(f"  Device: {device}")
    print(f"{'='*60}\n")

    model_instance = RTDETR(model)

    results = model_instance.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        project=project,
        name=name,
        resume=resume,
        # Performance settings
        workers=8,
        cache=True,
        amp=True,
        patience=20,
        save_period=10,
    )

    print(f"\nTraining complete! Results saved to {project}/{name}")
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Train RT-DETR on SeaShips dataset",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    # Data arguments
    parser.add_argument(
        "--data-dir",
        type=Path,
        required=True,
        help="Path to SeaShips dataset directory",
    )
    parser.add_argument(
        "--skip-convert",
        action="store_true",
        help="Skip COCO to YOLO conversion (use if already done)",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Only prepare data (convert), don't train",
    )

    # Model arguments
    parser.add_argument(
        "--model",
        type=str,
        default="rtdetr-l.pt",
        choices=["rtdetr-l.pt", "rtdetr-x.pt"],
        help="RT-DETR model variant",
    )
    parser.add_argument("--epochs", type=int, default=100, help="Number of training epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image size")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--device", type=str, default="0", help="CUDA device(s) or 'cpu'")

    # Output arguments
    parser.add_argument("--project", type=str, default="runs/train", help="Project directory")
    parser.add_argument("--name", type=str, default="seaships", help="Experiment name")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")

    args = parser.parse_args()

    data_dir = args.data_dir.resolve()
    if not data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    # Step 1: Convert COCO to YOLO
    if not args.skip_convert:
        print("\n[1/2] Converting COCO to YOLO format...")
        class_info = convert_coco_to_yolo(data_dir)
    else:
        print("\n[1/2] Skipping conversion (--skip-convert)")
        # Load class info from existing data.yaml
        data_yaml = data_dir / "data.yaml"
        if data_yaml.exists():
            import yaml
            with open(data_yaml) as f:
                config = yaml.safe_load(f)
            class_info = {"names": config["names"], "nc": config["nc"]}
        else:
            raise FileNotFoundError(f"data.yaml not found. Run without --skip-convert first.")

    # Step 2: Create data.yaml
    data_yaml = create_data_yaml(data_dir, class_info)

    if args.prepare_only:
        print("\n[2/2] Skipping training (--prepare-only)")
        print(f"\nData prepared! To train, run:")
        print(f"  python train.py --data-dir {data_dir} --skip-convert --epochs {args.epochs}")
        return

    # Step 3: Train
    print("\n[2/2] Training RT-DETR...")
    train_model(
        data_yaml=data_yaml,
        model=args.model,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        resume=args.resume,
    )


if __name__ == "__main__":
    main()
