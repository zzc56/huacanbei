#include "front-lidar.h"
#include <assert.h>

static bool point(FrontLidarSweep *sweep, int bearing, unsigned distance, FrontLidarEcho *result)
{
    return FrontLidar_Push(sweep, bearing < 0 ? bearing + 36000 : bearing, distance, result);
}

int main(void)
{
    FrontLidarSweep sweep = {0};
    FrontLidarEcho result;
    assert(!point(&sweep, -2200, 200, &result));
    for (int bearing = -1950; bearing <= 1800; bearing += 250) {
        unsigned distance = bearing == -200 ? 490 : 1450;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2050, 120, &result));
    assert(result.distance_mm == 490 && result.bearing_cdeg == -200);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2100, 0, &result));
    assert(!point(&sweep, -1900, 480, &result));
    assert(!point(&sweep, 200, 0, &result));
    for (int bearing = 450; bearing <= 2200; bearing += 250)
        assert(!point(&sweep, bearing, 0, &result));

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2200, 130, &result));
    for (int bearing = -1950; bearing <= 1800; bearing += 250)
        assert(!point(&sweep, bearing, bearing < 0 ? 25 : 2300, &result));
    assert(point(&sweep, 2050, 0, &result));
    assert(result.distance_mm == 0);
}
