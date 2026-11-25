#ifndef SENTINEL_FRONT_LIDAR_H
#define SENTINEL_FRONT_LIDAR_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    uint16_t distance_mm;
    int16_t bearing_cdeg;
} FrontLidarEcho;

typedef struct {
    FrontLidarEcho nearest;
    int16_t previous;
    bool has_previous;
    bool collecting;
} FrontLidarSweep;

/* Publish only after sweeping across the whole front sector. A dropped
 * packet must not leave a partial sweep looking like a clear corridor. */
static inline bool FrontLidar_Push(FrontLidarSweep *sweep, uint16_t angle_cdeg,
                                   uint16_t distance_mm, FrontLidarEcho *result)
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
        sweep->nearest = (FrontLidarEcho){0, 0};
        sweep->collecting = true;
    }
    sweep->previous = bearing;
    sweep->has_previous = true;
    if (!sweep->collecting) return false;
    if (bearing > half_sector) {
        sweep->collecting = false;
        *result = sweep->nearest;
        return true;
    }
    if (distance_mm >= 100U && distance_mm <= 2000U &&
        (sweep->nearest.distance_mm == 0 || distance_mm < sweep->nearest.distance_mm)) {
        sweep->nearest = (FrontLidarEcho){distance_mm, bearing};
    }
    return false;
}

#endif
