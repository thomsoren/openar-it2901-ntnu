from ultralytics import YOLO

def main():
    model = YOLO('yolo26s.pt')

    # Train the model optimized for best mAP across all classes
    model.train(
        data='configs/data.yaml',
        
        # Core training parameters for best mAP
        epochs=150,                      # More epochs for better convergence
        imgsz=640,                       # Balanced size for speed/accuracy
        batch=16,                        # Stable batch size (increase if GPU allows)
        project='backend/cv/training/logs',
        name='boat_detection_best_map',
        
        # Optimizer settings for best mAP
        optimizer='AdamW',               # AdamW often achieves better mAP than SGD
        lr0=0.001,                       # Lower learning rate for fine-tuning
        lrf=0.01,                        # Final LR = lr0 * lrf
        weight_decay=0.0005,             # Regularization
        
        # Training strategy
        patience=100,                    # Higher patience to avoid early stopping
        save_period=25,                  # Save every 25 epochs
        device='',                       # Auto-detect GPU/CPU
        workers=8,
        pretrained=True,
        close_mosaic=10,                 # Disable mosaic last N epochs for better mAP
        
        # Augmentation tuned for detection mAP
        hsv_h=0.015,                     # Slight hue variation
        hsv_s=0.7,                       # Saturation augmentation
        hsv_v=0.4,                       # Value augmentation
        degrees=0.0,                     # No rotation (boats are usually upright)
        translate=0.1,                   # Slight translation
        scale=0.5,                       # Scale variation for different boat sizes
        fliplr=0.5,                      # Horizontal flip
        mosaic=1.0,                      # Mosaic for better generalization
        mixup=0.15,                      # Mixup for class diversity
        copy_paste=0.1,                  # Copy-paste augmentation
        
        # Validation settings for mAP calculation
        val=True,
        plots=True,
        iou=0.6,                         # IoU threshold for NMS (0.6 balances mAP50/mAP50-95)
        conf=0.001,                      # Low conf threshold for validation
        max_det=300,                     # Max detections per image
        
        # Loss tuning for better class balance
        box=7.5,                         # Box loss weight
        cls=0.5,                         # Classification loss (important for multi-class)
        dfl=1.5,                         # Distribution focal loss
    )

    # Validate the model
    model.val(data='backend/cv/training/configs/data.yaml')

if __name__ == "__main__":
    main()