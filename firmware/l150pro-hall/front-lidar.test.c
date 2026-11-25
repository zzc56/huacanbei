#include "front-lidar.h"
#include <assert.h>

static bool point(FrontLidarSweep *sweep, int bearing, unsigned distance, FrontLidarScan *result)
{
    return FrontLidar_Push(sweep, bearing < 0 ? bearing + 36000 : bearing, distance, result);
}

int main(void)
{
    FrontLidarSweep sweep = {0};
    FrontLidarScan result;
    assert(!point(&sweep, -2200, 200, &result));
    for (int bearing = -1950; bearing <= 1800; bearing += 250) {
        unsigned distance = bearing == -200 ? 490 : 1450;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2050, 120, &result));
    assert(result.count == 3);
    assert(result.targets[0].distance_mm == 490 && result.targets[0].bearing_cdeg == -200);
    assert(result.targets[1].distance_mm == 1450 && result.targets[2].distance_mm == 1450);

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
    assert(result.count == 0);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2125, 0, &result));
    for (int i = 0; i < 8; ++i) {
        int bearing = -1875 + i * 500;
        assert(!point(&sweep, bearing, 900 - i * 75, &result));
        assert(!point(&sweep, bearing + 250, 0, &result));
    }
    assert(point(&sweep, 2125, 0, &result));
    assert(result.count == FRONT_LIDAR_MAX_TARGETS);
    assert(result.targets[0].distance_mm == 375);
    assert(result.targets[result.count - 1].distance_mm == 750);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2125, 0, &result));
    for (int bearing = -2000; bearing <= 2000; bearing += 125) {
        /* Six fragments on a near surface and a second obstacle farther away. */
        unsigned distance = 0;
        if (bearing >= -1375 && bearing <= -125 && (bearing + 1375) % 250 == 0) distance = 160;
        if (bearing == 1000) distance = 760;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2125, 0, &result));
    assert(result.count == 2);
    assert(result.targets[0].distance_mm == 160 && result.targets[1].distance_mm == 760);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2200, 0, &result));
    for (int bearing = -2000; bearing <= 2000; bearing += 200) {
        unsigned distance = bearing == 0 ? 401 : bearing == 600 ? 402 : 0;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2200, 0, &result));
    assert(result.count == 1);
    assert(result.targets[0].distance_mm == 402 && result.targets[0].bearing_cdeg == 600);
}
