import os
import shutil

BASE_DIR = "../../data/SeaShips"
IMG_DIR = os.path.join(BASE_DIR, "JPEGImages")
LABEL_DIR = os.path.join(BASE_DIR, "labels")
IMAGESETS_DIR = os.path.join(BASE_DIR, "ImageSets/Main")

OUT_IMG_DIR = os.path.join(BASE_DIR, "images")
OUT_LABEL_DIR = os.path.join(BASE_DIR, "labels")

splits = ["train", "val", "test"]

for split in splits:
    split_img_dir = os.path.join(OUT_IMG_DIR, split)
    split_label_dir = os.path.join(OUT_LABEL_DIR, split)
    os.makedirs(split_img_dir, exist_ok=True)
    os.makedirs(split_label_dir, exist_ok=True)

    split_file = os.path.join(IMAGESETS_DIR, f"{split}.txt")
    if not os.path.exists(split_file):
        print(f"Split file {split_file} not found, skipping {split}.")
        continue

    with open(split_file, "r") as f:
        image_ids = [line.strip() for line in f.readlines()]

    for img_id in image_ids:
        # Copy image
        found_img = False
        for ext in [".jpg", ".png", ".jpeg"]:
            img_path = os.path.join(IMG_DIR, f"{img_id}{ext}")
            if os.path.exists(img_path):
                shutil.copy(img_path, os.path.join(split_img_dir, f"{img_id}{ext}"))
                found_img = True
                break
        if not found_img:
            print(f"Image for {img_id} not found, skipping.")
            continue

        # Copy label
        label_path = os.path.join(LABEL_DIR, f"{img_id}.txt")
        if os.path.exists(label_path):
            shutil.copy(label_path, os.path.join(split_label_dir, f"{img_id}.txt"))
        else:
            print(f"Label for {img_id} not found, skipping.")

print("Splitting complete!")