import os
import xml.etree.ElementTree as ET
from PIL import Image

# Relevant data paths
IMG_DIR = "../../data/SeaShips/JPEGImages"
ANN_DIR = "../../data/SeaShips/Annotations"
YOLO_LABEL_DIR = "../../data/SeaShips/labels"

os.makedirs(YOLO_LABEL_DIR, exist_ok=True)

# Class mapping for the different vessel types
CLASS_MAP = {
    "ore carrier": 0,
    "bulk cargo carrier": 1,
    "container ship": 2,
    "general cargo ship": 3,
    "fishing boat": 4,
    "passenger ship": 5,
    "mixed type": 6
}

def convert(xml_file, img_file, out_file):
    tree = ET.parse(xml_file)
    root = tree.getroot()
    img = Image.open(img_file)
    w, h = img.size

    for obj in root.findall('object'):
        class_name = obj.find('name').text.strip().lower()
        class_id = CLASS_MAP.get(class_name, None)
        if class_id is None:
            print(f"Unknown class '{class_name}' in {xml_file}, skipping.")
            continue
        bbox = obj.find('bndbox')
        x1 = float(bbox.find('xmin').text)
        y1 = float(bbox.find('ymin').text)
        x2 = float(bbox.find('xmax').text)
        y2 = float(bbox.find('ymax').text)
        x_center = ((x1 + x2) / 2) / w
        y_center = ((y1 + y2) / 2) / h
        width = (x2 - x1) / w
        height = (y2 - y1) / h
        with open(out_file, 'a') as f:
            f.write(f"{class_id} {x_center} {y_center} {width} {height}\n")

def main():
    for xml_name in os.listdir(ANN_DIR):
        if not xml_name.endswith('.xml'):
            continue
        img_name = xml_name.replace('.xml', '.png')
        img_path = os.path.join(IMG_DIR, img_name)
        if not os.path.exists(img_path):
            img_name = xml_name.replace('.xml', '.jpg')
            img_path = os.path.join(IMG_DIR, img_name)
            if not os.path.exists(img_path):
                print(f"Image not found for {xml_name}, skipping.")
                continue
        xml_path = os.path.join(ANN_DIR, xml_name)
        out_path = os.path.join(YOLO_LABEL_DIR, xml_name.replace('.xml', '.txt'))
        convert(xml_path, img_path, out_path)

if __name__ == "__main__":
    main()