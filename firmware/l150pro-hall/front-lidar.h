#ifndef SENTINEL_FRONT_LIDAR_H
#define SENTINEL_FRONT_LIDAR_H

#include <stdbool.h>
#include <stdint.h>

enum { FRONT_LIDAR_MAX_TARGETS = 6, FRONT_LIDAR_MERGE_MM = 50 };

typedef struct {
    uint16_t distance_mm;
    int16_t bearing_cdeg;
} FrontLidarEcho;

typedef struct {
    FrontLidarEcho targets[FRONT_LIDAR_MAX_TARGETS];
    uint8_t count;
} FrontLidarScan;

typedef struct {
    FrontLidarScan scan;
    FrontLidarEcho cluster;
    uint16_t last_distance_mm;
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

static inline bool FrontLidar_Near(FrontLidarEcho a, FrontLidarEcho b)
{
    int32_t depth = (int32_t)a.distance_mm - b.distance_mm;
    if (depth < -FRONT_LIDAR_MERGE_MM || depth > FRONT_LIDAR_MERGE_MM) return false;
    /* Arc length at the average range, with bearings in hundredths of a degree. */
    int32_t arc = ((int32_t)a.distance_mm + b.distance_mm) *
                  ((int32_t)a.bearing_cdeg - b.bearing_cdeg) / 11459;
    return depth * depth + arc * arc <= FRONT_LIDAR_MERGE_MM * FRONT_LIDAR_MERGE_MM;
}

static inline void FrontLidar_FinishCluster(FrontLidarSweep *sweep)
{
    FrontLidarEcho cluster = sweep->cluster;
    if (!cluster.distance_mm) return;
    sweep->cluster.distance_mm = 0;
    FrontLidarScan *scan = &sweep->scan;
    /* A missing return can split one surface. Merge before applying the report cap. */
    for (uint8_t i = 0; i < scan->count; ++i) {
        if (!FrontLidar_Near(cluster, scan->targets[i])) continue;
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

/* Publish only after sweeping across the whole front sector. A dropped
 * packet must not leave a partial sweep looking like a clear corridor. */
static inline bool FrontLidar_Push(FrontLidarSweep *sweep, uint16_t angle_cdeg,
                                   uint16_t distance_mm, FrontLidarScan *result)
{
    const int16_t half_sector = 2000;
    if (angle_cdeg > 36000U) {
        sweep->has_previous = false;
        sweep->collecting = false;
        return false;
    }
    int16_t bearing = angle_cdeg >= 18000U ? (int32_t)angle_cdeg - 36000 : angle_cdeg;
    int32_t step = (int32_t)bearing - sweep->previous;
    if (step < 0) step += 36000;
    bool contiguous = sweep->has_previous && step <= 400;
    if (!contiguous) sweep->collecting = false;
    if (contiguous && sweep->previous < -half_sector && bearing >= -half_sector && bearing <= half_sector) {
        sweep->scan.count = 0;
        sweep->cluster.distance_mm = 0;
        sweep->collecting = true;
    }
    sweep->previous = bearing;
    sweep->has_previous = true;
    if (!sweep->collecting) return false;
    if (bearing > half_sector) {
        sweep->collecting = false;
        FrontLidar_FinishCluster(sweep);
        *result = sweep->scan;
        return true;
    }
    if (distance_mm < 100U || distance_mm > 2000U) {
        FrontLidar_FinishCluster(sweep);
    } else {
        FrontLidarEcho point = {distance_mm, bearing};
        int change_mm = (int)distance_mm - sweep->last_distance_mm;
        if (change_mm < -100 || change_mm > 100) FrontLidar_FinishCluster(sweep);
        if (!sweep->cluster.distance_mm || FrontLidar_ForwardScore(point) < FrontLidar_ForwardScore(sweep->cluster))
            sweep->cluster = point;
        sweep->last_distance_mm = distance_mm;
    }
    return false;
}

#endif
