"""Verify an orange basketball using its outline, surface colour and dark seams."""
from ast import literal_eval

import cv2
import numpy as np

_grid = np.linspace(-1, 1, 41)
_x, _y = np.meshgrid(_grid, _grid)
_inside = _x * _x + _y * _y < 0.77 ** 2
_angles = np.linspace(0, 2*np.pi, 96, endpoint=False)
_ring_x, _ring_y = np.cos(_angles), np.sin(_angles)


class BasketballDetector:
    """Run a fixed-size Ultralytics detection export with a small CPU thread pool."""

    def __init__(self, path, threads):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = min(3, threads)
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        self.session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
        input_info = self.session.get_inputs()[0]
        self.input_name = input_info.name
        self.height, self.width = input_info.shape[-2:]
        names = literal_eval(self.session.get_modelmeta().custom_metadata_map["names"])
        self.class_index = next(index for index, name in names.items() if name.lower() == "basketball")
        self.classes = len(names)
        self.detect(np.zeros((448, 800, 3), dtype=np.uint8))

    def detect(self, frame):
        height, width = frame.shape[:2]
        scale = min(self.width/width, self.height/height)
        resized_width, resized_height = round(width*scale), round(height*scale)
        left, top = (self.width-resized_width)//2, (self.height-resized_height)//2
        blob = np.full((self.height, self.width, 3), 114, dtype=np.uint8)
        blob[top:top+resized_height, left:left+resized_width] = cv2.resize(
            frame, (resized_width, resized_height),
        )
        tensor = np.ascontiguousarray(blob[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32)
        tensor /= 255
        result = self.session.run(None, {self.input_name: tensor})[0][0]
        if result.shape[0] != 4+self.classes:
            raise ValueError("Expected an Ultralytics detection export without embedded NMS")
        scores = result[4+self.class_index]
        keep = (scores >= .25) & (np.argmax(result[4:], axis=0) == self.class_index)
        center_x, center_y, box_w, box_h = result[:4, keep]
        x1 = ((center_x-box_w/2-left)/scale).clip(0, width)
        y1 = ((center_y-box_h/2-top)/scale).clip(0, height)
        x2 = ((center_x+box_w/2-left)/scale).clip(0, width)
        y2 = ((center_y+box_h/2-top)/scale).clip(0, height)
        boxes = np.stack((x1,y1,x2-x1,y2-y1), axis=1).tolist()
        confidence = scores[keep].tolist()
        indices = cv2.dnn.NMSBoxes(boxes, confidence, .25, .45)
        return [(boxes[index], confidence[index]) for index in np.asarray(indices, dtype=int).flat][:8]


def find_basketball(frame):
    height, width = frame.shape[:2]
    analysis_size = 576 if max(height, width) <= 800 else 640
    scale = min(1.0, analysis_size / max(height, width))
    sample = cv2.resize(frame, (round(width*scale), round(height*scale)), interpolation=cv2.INTER_AREA)
    short_side = min(sample.shape[:2])
    if short_side < 40:
        return None
    gray = cv2.GaussianBlur(cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    circles = cv2.HoughCircles(
        gray, cv2.HOUGH_GRADIENT_ALT, 1.5, 24, param1=160, param2=.79,
        minRadius=9, maxRadius=int(short_side * .46),
    )
    if circles is None:
        return None

    hsv = cv2.cvtColor(sample, cv2.COLOR_BGR2HSV)
    edges = cv2.Canny(gray, 25, 65)
    edge_distance = cv2.distanceTransform(255-edges, cv2.DIST_L2, 3)
    best = None
    for cx, cy, radius in circles[0][:20]:
        left, top = max(0, round(cx-radius)), max(0, round(cy-radius))
        right, bottom = min(sample.shape[1], round(cx+radius)), min(sample.shape[0], round(cy+radius))
        if min(right-left, bottom-top) < 1.65 * radius:
            continue
        x = np.rint(cx + radius * _x[_inside]).astype(int).clip(left, right-1)
        y = np.rint(cy + radius * _y[_inside]).astype(int).clip(top, bottom-1)
        pixels = hsv[y, x]
        orange = ((pixels[:, 0] >= 3) & (pixels[:, 0] <= 24) & (pixels[:, 1] >= 75)).mean()
        if orange < .72:
            continue
        ring_x = np.rint(cx + radius * _ring_x).astype(int).clip(0, sample.shape[1]-1)
        ring_y = np.rint(cy + radius * _ring_y).astype(int).clip(0, sample.shape[0]-1)
        outline = (edge_distance[ring_y, ring_x] < max(2, .035*radius)).mean()
        if outline < .55:
            continue

        # Dark seams contrast with their surrounding surface even as exposure changes.
        value = hsv[top:bottom, left:right, 2]
        seam_width = max(3, int(radius * .13) // 2 * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (seam_width, seam_width))
        dark = cv2.morphologyEx(value, cv2.MORPH_BLACKHAT, kernel)
        seam = (dark[y-top, x-left] > max(5, .12 * np.median(pixels[:, 2]))).mean()
        if seam < .12:
            continue
        score = float(.4 * orange + .45 * outline + .15 * seam)
        if best is None or score > best[1]:
            best = ([left/scale, top/scale, (right-left)/scale, (bottom-top)/scale], score)
    return best


class BallTrack:
    """Follow one visually confirmed ball through brief detection gaps."""

    max_gap_seconds = .55
    motion_gap_seconds = .30

    def __init__(self):
        self.previous = None
        self.velocity = np.zeros(2)

    def predicted_box(self, timestamp, frame):
        if self.previous is None or timestamp - self.previous[3] > self.max_gap_seconds:
            return None
        height, width = frame.shape[:2]
        scale = min(1.0, 640 / max(height, width))
        if self.previous[0].shape != (round(height*scale),round(width*scale)):
            return None
        predicted = self.previous[1].copy()
        predicted[:2] += self.velocity * min(.15, timestamp-self.previous[4])
        return (predicted/scale).tolist()

    def matches(self, rect, predicted):
        if predicted is None:
            return False
        x, y, w, h = rect
        px, py, pw, ph = predicted
        distance = np.hypot(x+w/2-px-pw/2, y+h/2-py-ph/2)
        ratio = (w*h) / max(1, pw*ph)
        return .25 <= ratio <= 3.0 and distance <= max(32, 2.5*max(pw, ph))

    def moving_ball(self, sample, gray, timestamp, predicted):
        """Look for ball-coloured motion around the predicted centre of a confirmed track."""
        previous_gray, _, _, confirmed_at, seen_at = self.previous
        if timestamp-confirmed_at > self.motion_gap_seconds or timestamp-seen_at > .20:
            return None
        x, y, w, h = predicted
        center = np.array([x+w/2, y+h/2])
        radius = max(28, 2.4*max(w, h))
        left, top = np.maximum(0, np.floor(center-radius)).astype(int)
        right, bottom = np.minimum([gray.shape[1], gray.shape[0]], np.ceil(center+radius)).astype(int)
        if right <= left or bottom <= top:
            return None
        roi = np.s_[top:bottom, left:right]
        hsv = cv2.cvtColor(sample[roi], cv2.COLOR_BGR2HSV)
        colour = cv2.inRange(hsv, (2, 70, 35), (26, 255, 255))
        changed = cv2.absdiff(gray[roi], previous_gray[roi])
        moving = cv2.bitwise_and(colour, cv2.inRange(changed, 13, 255))
        kernel = np.ones((3, 3), dtype=np.uint8)
        moving = cv2.morphologyEx(moving, cv2.MORPH_CLOSE, kernel)
        count, _, regions, centres = cv2.connectedComponentsWithStats(moving)
        best = None
        for (sx, sy, sw, sh, area), local in zip(regions[1:count], centres[1:count]):
            if not max(10, .19*w*h) <= area <= 1.8*w*h:
                continue
            if min(sw, sh) < .32*min(w, h) or max(sw, sh) > 2.6*max(w, h):
                continue
            if area < .39*sw*sh or np.mean(colour[sy:sy+sh, sx:sx+sw]) < 120:
                continue
            current = local + (left, top)
            dx = np.linalg.norm(current-center)
            if dx > radius:
                continue
            quality = dx/radius + .24*abs(np.log(area/(.6*w*h)))
            bound = np.minimum(np.maximum([w, h], [sw, sh]), 1.5*np.array([w, h]))
            start = np.maximum(current-bound/2, 0)
            end = np.minimum(current+bound/2, [gray.shape[1], gray.shape[0]])
            if best is None or quality < best[0]:
                best = (quality, np.concatenate((start, end-start)))
        return best[1] if best is not None else None

    def remember(self, gray, box, score, confirmed_at, timestamp):
        if self.previous is not None:
            _, old, _, _, seen_at = self.previous
            elapsed = timestamp - seen_at
            if 0 < elapsed <= .20:
                delta = (box[:2] + box[2:]/2) - (old[:2] + old[2:]/2)
                measured = np.clip(delta/elapsed, -1800, 1800)
                self.velocity = .7*measured + .3*self.velocity
            else:
                self.velocity.fill(0)
        self.previous = (gray, box, score, confirmed_at, timestamp)

    def predicted_result(self, gray, box, score, confirmed_at, timestamp, scale):
        self.remember(gray, box, score, confirmed_at, timestamp)
        confidence = min(.65, score) * (1 - .5*(timestamp-confirmed_at)/self.max_gap_seconds)
        return (box/scale).tolist(), confidence

    def update(self, frame, timestamp, observed=None):
        height, width = frame.shape[:2]
        if observed is None and (self.previous is None or timestamp - self.previous[3] > self.max_gap_seconds):
            self.previous = None
            self.velocity.fill(0)
            return None
        scale = min(1.0, 640 / max(height, width))
        sample = cv2.resize(frame, (round(width*scale), round(height*scale)), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY)
        if observed is not None:
            rect, score = observed
            box = np.asarray(rect, dtype=np.float32) * scale
            if not self.matches(rect, self.predicted_box(timestamp, frame)):
                self.previous = None
                self.velocity.fill(0)
            self.remember(gray, box, score, timestamp, timestamp)
            return None

        previous_gray, box, score, confirmed_at, _ = self.previous
        if previous_gray.shape != gray.shape:
            self.previous = None
            self.velocity.fill(0)
            return None
        predicted = np.array(self.predicted_box(timestamp, frame)) * scale
        tracked = self.moving_ball(sample, gray, timestamp, predicted)
        if tracked is not None:
            return self.predicted_result(gray, tracked, score, confirmed_at, timestamp, scale)
        x, y, w, h = box
        if min(w, h) < 14:
            return None
        mask = np.zeros_like(previous_gray)
        cv2.ellipse(mask, (round(x+w/2), round(y+h/2)), (round(w*.43), round(h*.43)),
                    0, 0, 360, 255, -1)
        points = cv2.goodFeaturesToTrack(previous_gray, 48, .02, 4, mask=mask)
        if points is None or len(points) < 6:
            return None
        moved, status, error = cv2.calcOpticalFlowPyrLK(previous_gray, gray, points, None)
        if moved is None:
            return None
        returned, back_status, _ = cv2.calcOpticalFlowPyrLK(gray, previous_gray, moved, None)
        if returned is None:
            return None
        consistent = ((status.ravel() == 1) & (back_status.ravel() == 1) & (error.ravel() < 18)
                      & (np.linalg.norm(points[:, 0] - returned[:, 0], axis=1) < 1.5))
        if consistent.sum() < 6 or consistent.mean() < .35:
            return None
        transform, inliers = cv2.estimateAffinePartial2D(
            points[consistent], moved[consistent], ransacReprojThreshold=2,
        )
        if transform is None or inliers is None or inliers.sum() < 6 or inliers.mean() < .7:
            return None
        growth = np.linalg.norm(transform[:, 0])
        if not .8 < growth < 1.25:
            return None
        center = transform[:, :2] @ np.array([x+w/2, y+h/2]) + transform[:, 2]
        bound = np.array([w, h]) * growth
        start = np.maximum(center - bound/2, 0)
        end = np.minimum(center + bound/2, [gray.shape[1], gray.shape[0]])
        if np.any(end-start < bound*.75):
            return None
        tracked = np.concatenate((start, end-start))
        return self.predicted_result(gray, tracked, score, confirmed_at, timestamp, scale)
