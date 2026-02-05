from ultralytics import YOLO

def main():
    model = YOLO('yolo26s.pt')

    # Train the model with relevant inputs
    model.train(
        data='configs/data.yaml',  
        epochs=1,                                     
        imgsz=640,                                     
        project='backend/cv/training/logs'
    )

    # Validate the model
    model.val(data='backend/cv/training/configs/data.yaml')

if __name__ == "__main__":
    main()