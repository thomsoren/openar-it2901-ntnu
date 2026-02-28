import json
import logging
import shutil
import sys
from pathlib import Path

import yaml
from ultralytics import RTDETR

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

DEFAULT_CONFIG = Path(__file__).parent / "config_maritime_collision.yaml"

# Keys passed directly from config YAML to model.train()
TRAIN_KEYS = [
    "epochs", "imgsz", "batch", "device", "project", "name", "workers",
    "cache", "amp", "patience", "save_period",
    "lr0", "lrf", "cos_lr", "warmup_epochs", "warmup_momentum",
    "weight_decay", "label_smoothing", "dropout",
    "mosaic", "close_mosaic", "mixup", "degrees", "translate", "scale",
    "fliplr", "flipud", "hsv_h", "hsv_s", "hsv_v",
]


def resolve_data_yaml(config, config_path):
    if "data_yaml" in config:
        data_yaml = Path(config["data_yaml"])
    else:
        data_dir = config_path.parent / config["data_dir"]
        data_yaml = data_dir / "data.yaml"
    if not data_yaml.exists():
        raise FileNotFoundError(f"data.yaml not found: {data_yaml}")
    return data_yaml


def build_train_kwargs(config, data_yaml, **overrides):
    kwargs = {"data": str(data_yaml)}
    for key in TRAIN_KEYS:
        if key in config:
            kwargs[key] = config[key]
    kwargs.update(overrides)
    return kwargs


def run_optuna_search(config, data_yaml):
    import optuna

    optuna_cfg = config["optuna"]
    search_space = optuna_cfg["search_space"]
    n_trials = optuna_cfg.get("n_trials", 25)
    trial_epochs = optuna_cfg.get("trial_epochs", 40)
    trial_patience = optuna_cfg.get("trial_patience", 8)
    trial_fraction = optuna_cfg.get("trial_fraction", 1.0)

    study = optuna.create_study(
        direction="maximize",
        study_name="rtdetr_hpo",
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=10),
    )

    def objective(trial):
        params = {}
        for param_name, space in search_space.items():
            if "choices" in space:
                params[param_name] = trial.suggest_categorical(param_name, space["choices"])
            elif "log" in space and space["log"]:
                params[param_name] = trial.suggest_float(param_name, space["low"], space["high"], log=True)
            elif isinstance(space.get("low"), int) and isinstance(space.get("high"), int) and "log" not in space:
                params[param_name] = trial.suggest_int(param_name, space["low"], space["high"])
            else:
                params[param_name] = trial.suggest_float(param_name, space["low"], space["high"])

        trial_name = f"optuna_trial_{trial.number}"
        kwargs = build_train_kwargs(
            config, data_yaml,
            epochs=trial_epochs,
            patience=trial_patience,
            fraction=trial_fraction,
            name=trial_name,
            save_period=0,
            **params,
        )

        logger.info("Trial %d params: %s", trial.number, params)

        model = RTDETR(config["model"])
        results = model.train(**kwargs)
        if results is None:
            logger.warning("Trial %d returned no results", trial.number)
            return 0.0

        map50_95 = results.results_dict.get("metrics/mAP50-95(B)", 0.0)
        logger.info("Trial %d finished — mAP50-95: %.4f", trial.number, map50_95)

        # Clean up trial weights to save disk space
        trial_dir = Path(config["project"]) / trial_name / "weights"
        if trial_dir.exists():
            shutil.rmtree(trial_dir)

        return map50_95

    logger.info("Starting Optuna HPO: %d trials, %d epochs each", n_trials, trial_epochs)
    study.optimize(objective, n_trials=n_trials)

    best = study.best_trial
    logger.info("Best trial #%d — mAP50-95: %.4f", best.number, best.value)
    logger.info("Best params: %s", best.params)

    results_path = Path(config["project"]) / "optuna_results.json"
    results_path.parent.mkdir(parents=True, exist_ok=True)
    results_path.write_text(json.dumps({
        "best_trial": best.number,
        "best_value": best.value,
        "best_params": best.params,
        "all_trials": [
            {"number": t.number, "value": t.value, "params": t.params, "state": str(t.state)}
            for t in study.trials
        ],
    }, indent=2))
    logger.info("Optuna results saved to %s", results_path)

    return best.params


def run_final_training(config, data_yaml, best_params=None):
    overrides = best_params or {}
    kwargs = build_train_kwargs(config, data_yaml, **overrides)

    logger.info("=" * 60)
    logger.info("Final training — RT-DETR")
    logger.info("  Model: %s", config["model"])
    logger.info("  Data: %s", data_yaml)
    logger.info("  Epochs: %s", kwargs.get("epochs"))
    logger.info("  Batch: %s", kwargs.get("batch"))
    if best_params:
        logger.info("  Optuna best params applied: %s", best_params)
    logger.info("=" * 60)

    model = RTDETR(config["model"])
    results = model.train(**kwargs)
    return model, results


def evaluate_on_test(model, data_yaml, config):
    logger.info("=" * 60)
    logger.info("Evaluating best model on TEST split")
    logger.info("=" * 60)

    best_weights = Path(config["project"]) / config["name"] / "weights" / "best.pt"
    if best_weights.exists():
        model = RTDETR(str(best_weights))

    metrics = model.val(data=str(data_yaml), split="test", device=config["device"])

    logger.info("TEST results:")
    logger.info("  mAP50-95: %.4f", metrics.box.map)
    logger.info("  mAP50:    %.4f", metrics.box.map50)
    logger.info("  mAP75:    %.4f", metrics.box.map75)

    per_class = metrics.box.maps
    with open(data_yaml) as f:
        class_names = yaml.safe_load(f).get("names", {})
    for i, m in enumerate(per_class):
        name = class_names.get(i, f"class_{i}")
        logger.info("  %s: %.4f", name, m)

    test_results_path = Path(config["project"]) / config["name"] / "test_results.json"
    test_results_path.write_text(json.dumps({
        "mAP50-95": metrics.box.map,
        "mAP50": metrics.box.map50,
        "mAP75": metrics.box.map75,
        "per_class": {class_names.get(i, f"class_{i}"): m for i, m in enumerate(per_class)},
    }, indent=2))
    logger.info("Test results saved to %s", test_results_path)

    return metrics


def main():
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CONFIG
    with open(config_path) as f:
        config = yaml.safe_load(f)

    data_yaml = resolve_data_yaml(config, config_path)

    # Handle resume
    resume_path = config.get("resume", False)
    if resume_path and resume_path is not False and Path(resume_path).exists():
        logger.info("Resuming RT-DETR training from: %s", resume_path)
        model = RTDETR(resume_path)
        model.train(resume=True)
        evaluate_on_test(model, data_yaml, config)
        return

    # Phase 1: Optuna HPO (if enabled)
    best_params = None
    optuna_cfg = config.get("optuna", {})
    if optuna_cfg.get("enabled", False):
        best_params = run_optuna_search(config, data_yaml)

    # Phase 2: Final training with best params
    model, _ = run_final_training(config, data_yaml, best_params)

    # Phase 3: Evaluate on test set
    evaluate_on_test(model, data_yaml, config)


if __name__ == "__main__":
    main()
