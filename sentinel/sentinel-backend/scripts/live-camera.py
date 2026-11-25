"""External RTSP capture + local YOLO. Each JSON line pairs one JPEG with its exact boxes.

性能设计（CPU 环境）：
- 采集、检测、输出三段解耦。采集线程只保留最新帧；检测线程持续推理并保存
  最近一次结果及其原图。主线程编码同一次采集的画面和检测框。
- 推理尺寸与线程数可通过环境变量调整：CAMERA_IMGSZ（默认 416）、
  CAMERA_CPU_THREADS（默认 4）。降低 imgsz 可进一步提高检测刷新率。
"""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
import threading
import time

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
os.environ.setdefault("OPENCV_FFMPEG_THREADS", "1")
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
import cv2
import numpy as np
from basketball import BallTrack, BasketballDetector, find_basketball
from detection_boxes import iou, same_ball, unique_objects

cv2.setNumThreads(1)

url = os.environ.get("CAMERA_RTSP_URL", "")
usb_index = os.environ.get("CAMERA_DEVICE_INDEX", "")
if not usb_index.isdigit() and not url.startswith(("rtsp://", "rtsps://")):
    raise ValueError("CAMERA_RTSP_URL must be an RTSP address")
fps = min(15, max(1, float(os.environ.get("CAMERA_FPS", "15"))))
cpu_threads = min(8, max(1, int(os.environ.get("CAMERA_CPU_THREADS", "4"))))
imgsz = min(640, max(320, int(os.environ.get("CAMERA_IMGSZ", "416"))))
jpeg_quality = min(95, max(60, int(os.environ.get("CAMERA_JPEG_QUALITY", "83"))))
basketball_preview = os.environ.get("SOURCE_MODE") == "vehicle"

latest = None                 # (captured_at, frame) 采集线程写入
lock = threading.Lock()
stop = threading.Event()

det_lock = threading.Lock()   # 检测线程写入、输出线程读取
det_state = {"captured": 0.0, "frame": None, "detections": [], "active": False, "inference_ms": 0.0}

# 保存真实 stdout 句柄：contextlib.redirect_stdout 是全局替换 sys.stdout，
# 检测线程推理时若主线程用 print 输出，JSON 会被重定向到 stderr 导致数据丢失。
STDOUT = sys.stdout


def emit(value):
    STDOUT.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n")
    STDOUT.flush()


def capture():
    global latest
    while not stop.is_set():
        params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000]
        # Frame-thread decoding buffered 15 frames (~600 ms at 25 Hz) on this camera.
        # The environment fallback also supports older OpenCV builds.
        if hasattr(cv2, "CAP_PROP_N_THREADS"):
            params += [cv2.CAP_PROP_N_THREADS, 1]
        video = cv2.VideoCapture(int(usb_index)) if usb_index.isdigit() else cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
        warm_until = time.monotonic() + (0 if usb_index.isdigit() else 2)
        try:
            while video.isOpened() and not stop.is_set():
                ok, frame = video.read()
                if not ok:
                    break
                if time.monotonic() >= warm_until:
                    with lock:
                        latest = (time.time(), frame)
        finally:
            video.release()
            with lock:
                latest = None
        stop.wait(1)


threading.Thread(target=capture, daemon=True).start()


def parent_lifetime():
    # Closing the backend also closes this pipe on Windows. Do not leave a camera
    # process running when the parent is force-terminated while the camera is offline.
    sys.stdin.read()
    stop.set()


threading.Thread(target=parent_lifetime, daemon=True).start()
emit({"type": "camera_status", "state": "connecting", "message": "正在连接网络视频并加载本机检测模型"})

model = None
device = "cpu"
predict_size = imgsz
detector_name = "YOLOv8 · 本机推理"
model_paths = (os.environ.get("CAMERA_ONNX_PATH", ""), os.environ.get("CAMERA_MODEL_PATH", ""))
for model_path in model_paths:
    if not model_path or not Path(model_path).is_file():
        continue
    try:
        # Third-party status text must not corrupt the JSON stdout transport.
        with contextlib.redirect_stdout(sys.stderr):
            from ultralytics import YOLO
            import torch
            torch.set_num_threads(cpu_threads)
            onnx = Path(model_path).suffix.lower() == ".onnx"
            runtime_device = 0 if not onnx and torch.cuda.is_available() else "cpu"
            candidate = YOLO(model_path, task="detect")
            # Ultralytics resets CPU threads during predictor setup. Set the
            # measured low-latency thread count after setup, before live inference.
            candidate.predict(np.zeros((448, 800, 3), dtype=np.uint8), imgsz=imgsz,
                              conf=0.3, max_det=100, device=runtime_device, verbose=False)
            if runtime_device == "cpu":
                torch.set_num_threads(cpu_threads)
            if onnx:
                predict_size = tuple(candidate.predictor.imgsz)
                detector_name = "YOLOv8 · ONNX 加速"
            model, device = candidate, runtime_device
            break
    except Exception:
        continue
if model is None and any(model_paths):
    emit({"type": "camera_status", "state": "connecting", "message": "检测模型未就绪，先显示实时视频"})

basketball_model = None
basketball_path = os.environ.get("CAMERA_BASKETBALL_ONNX_PATH", "")
if basketball_preview and model is not None and basketball_path:
    try:
        basketball_model = BasketballDetector(basketball_path, cpu_threads)
    except Exception as error:
        print(f"Basketball model unavailable: {error}", file=sys.stderr)


def detect():
    """持续对最新帧做推理，结果写入 det_state。"""
    global model, basketball_model
    tracks = {}
    ball_track = BallTrack() if basketball_preview else None
    ball_track_id = None
    next_track = 0
    last_stamp = 0
    while not stop.is_set():
        with lock:
            item = latest
        if item is None or item[0] == last_stamp or time.time() - item[0] > 1:
            stop.wait(0.02)
            continue
        captured, frame = item
        last_stamp = captured
        detections = []
        inference_start = time.perf_counter()
        if model is not None:
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    result = model.predict(frame, imgsz=predict_size, conf=0.3,
                                           max_det=100, device=device, verbose=False)[0]
                objects = []
                primary_ball = None
                predicted_ball = None
                for x1,y1,x2,y2,score,cls in result.boxes.data.cpu().tolist():
                    objects.append(([x1,y1,x2-x1,y2-y1],score,result.names[int(cls)],False))
                if ball_track is not None:
                    try:
                        if basketball_model is not None:
                            try:
                                dedicated_balls = basketball_model.detect(frame)
                                objects = [
                                    item for item in objects
                                    if item[2] != "sports ball"
                                    or not any(same_ball(item[0], rect) for rect,_ in dedicated_balls)
                                ]
                                objects.extend((rect,score,"sports ball",True) for rect,score in dedicated_balls)
                            except Exception as error:
                                print(f"Basketball model stopped: {error}", file=sys.stderr)
                                basketball_model = None
                        direct_balls = [(rect, score) for rect,score,label,_ in objects if label == "sports ball"]
                        predicted_ball = ball_track.predicted_box(captured, frame)
                        matching = [item for item in direct_balls if ball_track.matches(item[0], predicted_ball)]
                        direct_ball = max(matching or direct_balls, key=lambda item: item[1], default=None)
                        if basketball_model is None and (direct_ball is None or direct_ball[1] < .6):
                            feature_ball = find_basketball(frame)
                            if feature_ball and not any(same_ball(feature_ball[0],rect) for rect,_ in direct_balls):
                                rect, score = feature_ball
                                objects.insert(0, (rect,score,"sports ball",True))
                            if feature_ball and direct_ball is None:
                                direct_ball = feature_ball
                        tracked_ball = ball_track.update(frame, captured, direct_ball)
                        if tracked_ball:
                            rect, score = tracked_ball
                            objects.insert(0, (rect,score,"sports ball",True))
                        primary_ball = tracked_ball or direct_ball
                    except cv2.error:
                        ball_track = BallTrack()
                        ball_track_id = None
                used = set()
                stale = [k for k, v in tracks.items() if captured - v["time"] >= 0.75]
                for key in stale:
                    del tracks[key]
                for rect,score,label,preview_only in unique_objects(objects):
                    candidates = [(iou(rect,v["box"]),k) for k,v in tracks.items()
                                  if k not in used and v["label"] == label]
                    best = max(candidates, default=(0,None))
                    is_primary_ball = label == "sports ball" and primary_ball and rect is primary_ball[0]
                    if (is_primary_ball and ball_track_id in tracks and ball_track_id not in used
                            and ball_track.matches(rect, predicted_ball)):
                        track = ball_track_id
                    elif best[0] >= 0.3:
                        track = best[1]
                    else:
                        next_track += 1
                        track = f"V{next_track:05d}"
                    if is_primary_ball:
                        ball_track_id = track
                    used.add(track)
                    tracks[track] = {"box":rect,"label":label,"time":captured}
                    detection = dict(zip(("x","y","width","height"),rect),
                                     score=score,label=label,track_id=track)
                    if preview_only:
                        detection["previewOnly"] = True
                    detections.append(detection)
            except Exception:
                model = None
                detections = []
        inference_ms = (time.perf_counter() - inference_start) * 1000
        # Keep one latest input; never replay an inference backlog.
        with det_lock:
            det_state["captured"] = captured
            det_state["frame"] = frame
            det_state["detections"] = detections
            det_state["active"] = model is not None
            det_state["inference_ms"] = inference_ms


if model is not None:
    names = model.names
    labels = list(names.values()) if isinstance(names, dict) else list(names)
    if basketball_preview and "sports ball" not in labels:
        labels.append("sports ball")
    emit({"type": "camera_classes", "labels": labels})
    threading.Thread(target=detect, daemon=True).start()

sequence = 0
last_sent = 0.0
try:
    while not stop.is_set():
        tick = time.monotonic()
        with lock:
            item = latest
        if item is None or time.time() - item[0] > 1:
            stop.wait(0.02)
            continue
        captured, frame = item
        with det_lock:
            det_captured = det_state["captured"]
            det_frame = det_state["frame"]
            detections = det_state["detections"]
            active = det_state["active"]
            inference_ms = det_state["inference_ms"]
        paired = active and det_frame is not None and time.time() - det_captured <= 1
        if paired:
            captured, frame = det_captured, det_frame
        if captured <= last_sent:
            stop.wait(0.01)
            continue
        encode_start = time.perf_counter()
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        encode_ms = (time.perf_counter() - encode_start) * 1000
        if ok:
            last_sent = captured
            sequence += 1
            emit({"type":"camera_frame","sequence":sequence,"capturedAt":round(captured*1000),
                  "width":frame.shape[1],"height":frame.shape[0],
                  "detections":detections if paired else [],
                  "detector":(detector_name + (" + 篮球专用" if basketball_model else "")
                              if paired else "本帧无检测结果"),
                  "timing":{"inferenceMs":round(inference_ms,1),"encodeMs":round(encode_ms,1),
                            "processingMs":round((time.time()-captured)*1000,1),
                            "decodeThreads":1,"inferenceThreads":cpu_threads if device == "cpu" else 0},
                  "jpeg":base64.b64encode(jpeg).decode("ascii")})
        stop.wait(max(0, 1/fps-(time.monotonic()-tick)))
finally:
    stop.set()
