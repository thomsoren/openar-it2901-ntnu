import logging
from pathlib import Path

import yaml
from ultralytics import RTDETR

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent / "config.yaml"


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    data_dir = CONFIG_PATH.parent / config["data_dir"]
    data_yaml = data_dir / "data.yaml"

    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found in {data_dir}")

    logger.info(
        "Training RT-DETR | Model: %s | Data: %s | Epochs: %s | Batch: %s | Device: %s",
        config["model"], data_yaml, config["epochs"], config["batch"], config["device"],
    )

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
