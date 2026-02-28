import os
import cv2
import albumentations as A

IMG_DIR = os.environ.get("IMG_DIR", "data/images/train")
LABEL_DIR = os.environ.get("LABEL_DIR", "data/labels/train")
AUG_IMG_DIR = os.environ.get("AUG_IMG_DIR", IMG_DIR)
AUG_LABEL_DIR = os.environ.get("AUG_LABEL_DIR", LABEL_DIR)

os.makedirs(AUG_IMG_DIR, exist_ok=True)
os.makedirs(AUG_LABEL_DIR, exist_ok=True)

augmentor = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.3),
    A.Affine(translate_percent=(-0.05, 0.05), scale=(0.7, 1.3), rotate=(-15, 15), p=0.5),
    A.MotionBlur(blur_limit=7, p=0.2),
    A.RandomFog(fog_coef_range=(0.1, 0.3), p=0.2),
    A.RandomGamma(gamma_limit=(80, 120), p=0.3),
    A.CLAHE(clip_limit=2.0, p=0.2),
    A.HueSaturationValue(hue_shift_limit=10, sat_shift_limit=20, val_shift_limit=15, p=0.3),
],
    bbox_params=A.BboxParams(
        format='yolo',
        label_fields=['class_labels'],
        min_area=100,
        min_visibility=0.3,
    )
)


def _clamp_bbox(x_c, y_c, w, h):
    """Clamp YOLO bbox so the derived corners stay within [0, 1]."""
    x_c = max(0.0, min(1.0, x_c))
    y_c = max(0.0, min(1.0, y_c))
    w = max(0.0, min(w, 2.0 * x_c, 2.0 * (1.0 - x_c)))
    h = max(0.0, min(h, 2.0 * y_c, 2.0 * (1.0 - y_c)))
    return [x_c, y_c, w, h]


def read_detr_labels(label_path):
    bboxes = []
    class_labels = []
    with open(label_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            class_id, x_c, y_c, w, h = line.split()
            bbox = _clamp_bbox(float(x_c), float(y_c), float(w), float(h))
            if bbox[2] > 0 and bbox[3] > 0:
                class_labels.append(int(class_id))
                bboxes.append(bbox)
    return bboxes, class_labels


def save_detr_labels(save_path, bboxes, class_labels):
    with open(save_path, 'w') as f:
        for cls, bbox in zip(class_labels, bboxes):
            x_c, y_c, w, h = bbox
            f.write(f"{cls} {x_c:.6f} {y_c:.6f} {w:.6f} {h:.6f}\n")


def augment_dataset(num_aug=5):
    all_images = [
        f for f in os.listdir(IMG_DIR)
        if f.lower().endswith(('.jpg', '.jpeg', '.png'))
    ]

    for img_file in all_images:
        img_path = os.path.join(IMG_DIR, img_file)
        label_name = os.path.splitext(img_file)[0] + ".txt"
        label_path = os.path.join(LABEL_DIR, label_name)

        if not os.path.exists(label_path):
            print(f"No label found for {img_file}, skipping.")
            continue

        image = cv2.imread(img_path)
        if image is None:
            print(f"Failed to read {img_file}, skipping.")
            continue

        bboxes, class_labels = read_detr_labels(label_path)

        for aug_i in range(num_aug):
            transformed = augmentor(
                image=image,
                bboxes=bboxes,
                class_labels=class_labels
            )
            aug_image = transformed['image']
            aug_bboxes = transformed['bboxes']
            aug_class_labels = transformed['class_labels']

            base_name = os.path.splitext(img_file)[0]
            aug_img_filename = f"{base_name}_aug_{aug_i}.jpg"
            aug_label_filename = f"{base_name}_aug_{aug_i}.txt"

            cv2.imwrite(os.path.join(AUG_IMG_DIR, aug_img_filename), aug_image)
            save_detr_labels(os.path.join(AUG_LABEL_DIR, aug_label_filename), aug_bboxes, aug_class_labels)

            print(f"Saved {aug_img_filename} & {aug_label_filename}")


if __name__ == "__main__":
    augment_dataset(num_aug=3)