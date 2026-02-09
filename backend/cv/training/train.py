from pathlib import Path

import yaml
from ultralytics import RTDETR

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def main():
    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    data_dir = CONFIG_PATH.parent / config["data_dir"]
    data_yaml = data_dir / "data.yaml"

    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found in {data_dir}")

    print(f"\n{'='*60}")
    print("Training RT-DETR")
    print(f"  Model: {config['model']}")
    print(f"  Data: {data_yaml}")
    print(f"  Epochs: {config['epochs']}")
    print(f"  Batch size: {config['batch']}")
    print(f"  Device: {config['device']}")
    print(f"{'='*60}\n")

    model = RTDETR(config["model"])

    model.train(
        data=str(data_yaml),
        epochs=config["epochs"],
        imgsz=config["imgsz"],
        batch=config["batch"],
        device=config["device"],
        project=config["project"],
        name=config["name"],
        workers=config["workers"],
        cache=config["cache"],
        amp=config["amp"],
        patience=config["patience"],
        save_period=config["save_period"],
    )


if __name__ == "__main__":
    main()
