"""Suppress duplicate camera candidates before assigning track IDs."""

_VEHICLE_CLASSES = {"car", "bus", "truck"}
_TWO_WHEEL_CLASSES = {"bicycle", "motorcycle"}


def intersection_area(a, b):
    width = max(0, min(a[0]+a[2], b[0]+b[2])-max(a[0], b[0]))
    height = max(0, min(a[1]+a[3], b[1]+b[3])-max(a[1], b[1]))
    return width * height


def iou(a, b):
    shared = intersection_area(a,b)
    return shared / max(1, a[2]*a[3]+b[2]*b[3]-shared)


def person_fragment(small, large):
    sw, sh = small[2:]
    lw, lh = large[2:]
    if sh > .7*lh or sw > .7*lw:
        return False
    center_gap = abs((small[0]+sw/2)-(large[0]+lw/2))
    centered = center_gap <= .21*lw
    clipped_body = abs((small[1]+sh)-(large[1]+lh)) <= .09*lh
    return (centered or clipped_body) and intersection_area(small,large) >= .9*sw*sh


def same_ball(a, b):
    aw, ah = a[2:]
    bw, bh = b[2:]
    smaller = min(aw*ah,bw*bh)
    if smaller <= 0 or intersection_area(a,b) < .58*smaller:
        return False
    dx = (a[0]+aw/2)-(b[0]+bw/2)
    dy = (a[1]+ah/2)-(b[1]+bh/2)
    return (dx/max(aw,bw))**2+(dy/max(ah,bh))**2 <= .30**2


def unique_objects(objects):
    # A person fragment may score higher than a full body. Remove it before NMS.
    people = [(box,score) for box,score,label,_ in objects if label == "person"]
    kept = []
    for obj in sorted(objects, key=lambda obj: (obj[3], -obj[1])):
        box,score,label,_ = obj
        if label == "person" and any(
            full_score >= max(.3,.7*score) and person_fragment(box,full)
            for full,full_score in people
        ):
            continue
        groups = (_VEHICLE_CLASSES, _TWO_WHEEL_CLASSES)
        duplicate = any(
            (same_label == label and iou(box,other) >= .65)
            or (same_label == label == "sports ball" and same_ball(box,other))
            or (same_label != label and any({label,same_label} <= group for group in groups)
                and iou(box,other) >= .75)
            for other,_,same_label,_ in kept
        )
        if not duplicate:
            kept.append(obj)
    return kept
