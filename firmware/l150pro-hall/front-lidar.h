#ifndef SENTINEL_FRONT_LIDAR_H
#define SENTINEL_FRONT_LIDAR_H

#include <stdbool.h>
#include <stdint.h>

enum {
    FRONT_LIDAR_MAX_TARGETS = 6,
    FRONT_LIDAR_MIN_MM = 100,
    FRONT_LIDAR_MAX_MM = 25000,
    FRONT_LIDAR_HALF_SECTOR_CDEG = 2000,
    FRONT_LIDAR_NEIGHBOR_CDEG = 120,
    FRONT_LIDAR_SURFACE_STEP_MM = 50,
    FRONT_LIDAR_DUPLICATE_MM = 15,
    FRONT_LIDAR_DUPLICATE_CDEG = 15,
    FRONT_LIDAR_FRAGMENT_GAP_MM = 20,
    FRONT_LIDAR_FRAGMENT_DEPTH_MM = 20,
    FRONT_LIDAR_FRAGMENT_SPAN_MM = 45,
    FRONT_LIDAR_CLOSE_SPAN_MM = 80,
    FRONT_LIDAR_CLOSE_RANGE_MM = 150,
};

typedef struct {
    uint16_t distance_mm;
    int16_t bearing_cdeg;
} FrontLidarEcho;

typedef struct {
    FrontLidarEcho targets[FRONT_LIDAR_MAX_TARGETS];
    uint8_t count;
} FrontLidarScan;

typedef struct {
    FrontLidarEcho first;
    FrontLidarEcho last;
    FrontLidarEcho closest;
    FrontLidarEcho separate[2];
    uint8_t count;
} FrontLidarFragments;

typedef struct {
    FrontLidarScan scan;
    FrontLidarEcho cluster;
    FrontLidarEcho first_in_cluster;
    FrontLidarEcho last_in_cluster;
    FrontLidarFragments fragments;
    int16_t previous;
    bool has_previous;
    bool collecting;
} FrontLidarSweep;

/* Approximate range * cos(bearing) in Q16. The front sector is only ±20°. */
static inline int32_t FrontLidar_ForwardScore(FrontLidarEcho echo)
{
    int32_t angle = echo.bearing_cdeg;
    return (int32_t)echo.distance_mm * (65536 - angle * angle / 1002);
}

static inline bool FrontLidar_Duplicate(FrontLidarEcho a, FrontLidarEcho b)
{
    int32_t depth = (int32_t)a.distance_mm - b.distance_mm;
    int32_t angle = (int32_t)a.bearing_cdeg - b.bearing_cdeg;
    return depth >= -FRONT_LIDAR_DUPLICATE_MM && depth <= FRONT_LIDAR_DUPLICATE_MM &&
           angle >= -FRONT_LIDAR_DUPLICATE_CDEG && angle <= FRONT_LIDAR_DUPLICATE_CDEG;
}

static inline void FrontLidar_InsertTarget(FrontLidarScan *scan, FrontLidarEcho cluster)
{
    /* Packet overlap can create practically identical points across a split. */
    for (uint8_t i = 0; i < scan->count; ++i) {
        if (!FrontLidar_Duplicate(cluster, scan->targets[i])) continue;
        if (FrontLidar_ForwardScore(cluster) >= FrontLidar_ForwardScore(scan->targets[i])) return;
        --scan->count;
        for (uint8_t next = i; next < scan->count; ++next)
            scan->targets[next] = scan->targets[next + 1];
        break;
    }
    uint8_t index = 0;
    while (index < scan->count && scan->targets[index].distance_mm <= cluster.distance_mm)
        ++index;
    if (index < FRONT_LIDAR_MAX_TARGETS) {
        if (scan->count < FRONT_LIDAR_MAX_TARGETS) ++scan->count;
        for (uint8_t i = scan->count - 1; i > index; --i)
            scan->targets[i] = scan->targets[i - 1];
        scan->targets[index] = cluster;
    }
}

static inline bool FrontLidar_FragmentWithin(FrontLidarEcho a, FrontLidarEcho b, int32_t limit_mm)
{
    int32_t depth = (int32_t)a.distance_mm - b.distance_mm;
    if (depth < -FRONT_LIDAR_FRAGMENT_DEPTH_MM || depth > FRONT_LIDAR_FRAGMENT_DEPTH_MM) return false;
    int32_t arc = ((int32_t)a.distance_mm + b.distance_mm) *
                  ((int32_t)a.bearing_cdeg - b.bearing_cdeg) / 11459;
    return depth * depth + arc * arc <= limit_mm * limit_mm;
}

static inline void FrontLidar_FinishFragments(FrontLidarSweep *sweep)
{
    FrontLidarFragments *group = &sweep->fragments;
    if (group->count >= 3) {
        /* Estimate the center direction while retaining the shortest forward distance. */
        FrontLidarEcho point = {1U, ((int32_t)group->first.bearing_cdeg + group->last.bearing_cdeg) / 2};
        int32_t range = FrontLidar_ForwardScore(group->closest) / FrontLidar_ForwardScore(point);
        point.distance_mm = range < FRONT_LIDAR_MIN_MM ? FRONT_LIDAR_MIN_MM : (uint16_t)range;
        FrontLidar_InsertTarget(&sweep->scan, point);
    } else {
        for (uint8_t i = 0; i < group->count; ++i) FrontLidar_InsertTarget(&sweep->scan, group->separate[i]);
    }
    group->count = 0;
}

static inline void FrontLidar_FinishCluster(FrontLidarSweep *sweep)
{
    FrontLidarEcho cluster = sweep->cluster;
    if (!cluster.distance_mm) return;
    sweep->cluster.distance_mm = 0;
    FrontLidarFragments *group = &sweep->fragments;
    FrontLidarEcho first = sweep->first_in_cluster;
    FrontLidarEcho last = sweep->last_in_cluster;
    int32_t span = last.distance_mm <= FRONT_LIDAR_CLOSE_RANGE_MM && group->first.distance_mm <= FRONT_LIDAR_CLOSE_RANGE_MM
        ? FRONT_LIDAR_CLOSE_SPAN_MM : FRONT_LIDAR_FRAGMENT_SPAN_MM;
    if (group->count && (!FrontLidar_FragmentWithin(group->last, first, FRONT_LIDAR_FRAGMENT_GAP_MM) ||
                         !FrontLidar_FragmentWithin(group->first, last, span))) FrontLidar_FinishFragments(sweep);
    if (!group->count) {
        group->first = first;
        group->closest = cluster;
    } else if (FrontLidar_ForwardScore(cluster) < FrontLidar_ForwardScore(group->closest)) group->closest = cluster;
    group->last = last;
    if (group->count < 2) group->separate[group->count] = cluster;
    if (group->count < 3) ++group->count;
}

/* Publish only after sweeping across the whole front sector. A dropped
 * packet must not leave a partial sweep looking like a clear corridor. */
static inline bool FrontLidar_Push(FrontLidarSweep *sweep, uint16_t angle_cdeg,
                                   uint16_t distance_mm, FrontLidarScan *result)
{
    const int16_t half_sector = FRONT_LIDAR_HALF_SECTOR_CDEG;
    if (angle_cdeg > 36000U) {
        sweep->has_previous = false;
        sweep->collecting = false;
        return false;
    }
    int16_t bearing = angle_cdeg >= 18000U ? (int32_t)angle_cdeg - 36000 : angle_cdeg;
    int32_t step = (int32_t)bearing - sweep->previous;
    if (step < -18000) step += 36000;
    if (step > 18000) step -= 36000;
    bool contiguous = sweep->has_previous && step >= -FRONT_LIDAR_DUPLICATE_CDEG && step <= 400;
    if (!contiguous) sweep->collecting = false;
    if (contiguous && sweep->previous < -half_sector && bearing >= -half_sector && bearing <= half_sector) {
        sweep->scan.count = 0;
        sweep->cluster.distance_mm = 0;
        sweep->fragments.count = 0;
        sweep->collecting = true;
    }
    if (!contiguous || step >= 0) sweep->previous = bearing;
    sweep->has_previous = true;
    if (!sweep->collecting) return false;
    if (bearing > half_sector) {
        sweep->collecting = false;
        FrontLidar_FinishCluster(sweep);
        FrontLidar_FinishFragments(sweep);
        *result = sweep->scan;
        return true;
    }
    if (distance_mm < FRONT_LIDAR_MIN_MM || distance_mm > FRONT_LIDAR_MAX_MM) {
        FrontLidar_FinishCluster(sweep);
    } else {
        FrontLidarEcho point = {distance_mm, bearing};
        int change_mm = (int)distance_mm - sweep->last_in_cluster.distance_mm;
        /* Use adjacent beams and a depth discontinuity to delimit surfaces. */
        if (step > FRONT_LIDAR_NEIGHBOR_CDEG || change_mm < -FRONT_LIDAR_SURFACE_STEP_MM ||
            change_mm > FRONT_LIDAR_SURFACE_STEP_MM) FrontLidar_FinishCluster(sweep);
        if (!sweep->cluster.distance_mm) sweep->first_in_cluster = point;
        if (!sweep->cluster.distance_mm || FrontLidar_ForwardScore(point) < FrontLidar_ForwardScore(sweep->cluster)) sweep->cluster = point;
        sweep->last_in_cluster = point;
    }
    return false;
}

#endif
