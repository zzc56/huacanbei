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
    for (int bearing = -1950; bearing <= 2000; bearing += 50) {
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
        assert(!point(&sweep, bearing, bearing < 0 ? 99 : 25001, &result));
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
    for (int bearing = -2000; bearing <= 2000; bearing += 100) {
        /* Packet overlap produces fragments within 1 cm and 0.1 degree. */
        if (bearing == -1300) {
            for (int i = 0; i < 6; ++i) {
                assert(!point(&sweep, bearing + i * 2, 160 + i % 2 * 10, &result));
                assert(!point(&sweep, bearing + i * 2 + 1, 0, &result));
            }
            continue;
        }
        unsigned distance = bearing == 1000 ? 25000 : 0;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2125, 0, &result));
    assert(result.count == 2);
    assert(result.targets[0].distance_mm >= 159 && result.targets[0].distance_mm <= 160 && result.targets[1].distance_mm == 25000);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2200, 0, &result));
    for (int bearing = -2000; bearing <= 2000; bearing += 50) {
        /* A clear beam separates two objects within the old 5 cm merge radius. */
        unsigned distance = bearing == -50 ? 401 : bearing == 50 ? 402 : 0;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2200, 0, &result));
    assert(result.count == 2);
    assert(result.targets[0].bearing_cdeg == -50 && result.targets[1].bearing_cdeg == 50);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2050, 0, &result));
    for (int bearing = -2000; bearing <= 2000; bearing += 50) {
        assert(!point(&sweep, bearing, bearing == 0 ? 400 : 0, &result));
        if (bearing == 0) assert(!point(&sweep, -10, 410, &result));
    }
    assert(point(&sweep, 2050, 0, &result));
    assert(result.count == 1 && result.targets[0].distance_mm == 400);

    sweep = (FrontLidarSweep){0};
    assert(!point(&sweep, -2100, 0, &result));
    for (int bearing = -2000; bearing <= 2000; bearing += 50) {
        /* Eight close fragments previously exhausted the six report slots. */
        unsigned distance = bearing >= -1850 && bearing <= 950 && (bearing + 1850) % 400 == 0 ? 112 : 0;
        if (bearing == 1450) distance = 540;
        if (bearing == 1900) distance = 850;
        assert(!point(&sweep, bearing, distance, &result));
    }
    assert(point(&sweep, 2050, 0, &result));
    assert(result.count == 3);
    assert(result.targets[0].distance_mm >= 100 && result.targets[0].distance_mm <= 112);
    assert(result.targets[0].bearing_cdeg == -450);
    assert(result.targets[1].distance_mm == 540 && result.targets[2].distance_mm == 850);
}
