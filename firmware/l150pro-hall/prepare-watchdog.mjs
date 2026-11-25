import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2] && resolve(process.argv[2]);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const radarPreview = process.argv[3] === '--radar-preview';
const outputName = radarPreview ? 'L150Pro-F407VET6-Radar-Preview' : 'L150Pro-F407VET6-APP-Watchdog';
const output = join(repo, 'sentinel', 'logs', 'L150Pro-Hall-AC6-Watchdog-F407VE' + (radarPreview ? '-Radar' : ''));
if (!source || !existsSync(join(source, 'USER', 'WHEELTEC.uvprojx'))) {
  throw new Error('Pass the path of the configured L150Pro-Hall-AC6 project.');
}
if (existsSync(output)) throw new Error('The watchdog build folder already exists: ' + output);

// Use a byte-preserving encoding for the vendor project's GBK comments.
const changes = new Map();
function edit(file, transform) {
  const original = changes.get(file) ?? readFileSync(join(source, file), 'latin1');
  const updated = transform(original.replaceAll('\r\n', '\n'));
  changes.set(file, original.includes('\r\n') ? updated.replaceAll('\n', '\r\n') : updated);
}
function patch(text, anchor, replacement) {
  const at = text.indexOf(anchor);
  if (at === -1 || text.indexOf(anchor, at + anchor.length) !== -1) {
    throw new Error('Unexpected Hall AC6 source around: ' + anchor);
  }
  return text.slice(0, at) + replacement + text.slice(at + anchor.length);
}

function useVET6FlashAlgorithm(text) {
  return text.replaceAll('STM32F407ZG', 'STM32F407VE')
    .replaceAll('STM32F4xx_1024', 'STM32F4xx_512')
    .replaceAll('-FL0100000', '-FL0080000');
}

edit('USER/WHEELTEC.uvprojx', text => {
  text = patch(text, 'IROM(0x08000000,0x100000)', 'IROM(0x08000000,0x80000)');
  for (const block of ['IROM', 'OCR_RVCT4']) {
    const memory = new RegExp(`(<${block}>[\\s\\S]*?<Size>)0x100000(</Size>[\\s\\S]*?</${block}>)`);
    if (!memory.test(text)) throw new Error('Unexpected Flash layout in ' + block);
    text = text.replace(memory, (_, start, end) => start + '0x80000' + end);
  }
  text = patch(text, '<OutputName>WHEELTEC</OutputName>', `<OutputName>${outputName}</OutputName>`);
  return useVET6FlashAlgorithm(text);
});
if (existsSync(join(source, 'USER', 'WHEELTEC.uvoptx'))) edit('USER/WHEELTEC.uvoptx', useVET6FlashAlgorithm);

edit('HARDWARE/usartx.h', text => patch(text, 'void uart2_init(u32 bound);', `void uart2_init(u32 bound);

typedef struct {
    u8 direction;
    u8 left;
    u8 right;
} AppMotionCommand;

AppMotionCommand AppMotion_Read(void);`));

edit('HARDWARE/usartx.c', text => {
  const anchor = 'static void USART2_Process_Byte(u8 data);';
  text = patch(text, anchor, `${anchor}

#define APP_MOTION_TIMEOUT_MS 300U
static volatile u32 app_motion_sequence;

/* Called only by the 100 Hz control task. High-priority UART/DMA ISRs
 * publish sequence numbers and never call the RTOS tick API. */
AppMotionCommand AppMotion_Read(void)
{
    static u32 seen_sequence;
    static TickType_t last_motion_tick;
    static u8 initialized;
    static u8 active;
    AppMotionCommand motion = {0U, 0U, 0U};
    TickType_t now = xTaskGetTickCount();
    u32 mask = __get_PRIMASK();

    __disable_irq();
    if (!initialized || Mode != APP_Control_Mode)
    {
        initialized = 1U;
        active = 0U;
        seen_sequence = app_motion_sequence;
    }
    else if (seen_sequence != app_motion_sequence)
    {
        seen_sequence = app_motion_sequence;
        last_motion_tick = now;
        active = 1U;
    }

    if (active && (TickType_t)(now - last_motion_tick) < pdMS_TO_TICKS(APP_MOTION_TIMEOUT_MS))
    {
        motion.direction = Flag_Direction;
        motion.left = Flag_Left;
        motion.right = Flag_Right;
        active = motion.direction || motion.left || motion.right;
    }
    else
    {
        active = 0U;
        Flag_Direction = Flag_Left = Flag_Right = 0U;
    }
    __set_PRIMASK(mask);
    return motion;
}`);
  text = patch(text, '\tif(Turn_Flag==0)\n\t{', '\tif(Turn_Flag==0)\n\t{\n\t\tFlag_Left = Flag_Right = 0U;');
  text = patch(text, '\tif(Usart_Receive==0x4B)', '\tif (Flag_PID == 0U)\n\t{\n\tif(Usart_Receive==0x4B)');
  const speedAnchor = '\tif(Usart_Receive==0x58)  RC_Velocity=RC_Velocity+100;';
  return patch(text, speedAnchor, `    if (Mode == APP_Control_Mode && (Flag_Direction || Flag_Left || Flag_Right))
        ++app_motion_sequence;
    }

${speedAnchor}`);
});

edit('BALANCE/balance.h', text => patch(text, 'void Get_RC(void);\n', ''));

edit('BALANCE/balance.c', text => {
  const includes = '#include "WiredPS2_gamepad.h"';
  text = patch(text, includes, includes + '\n\nstatic void Get_RC(AppMotionCommand motion);');
  text = patch(text, '\tu32 lastWakeTime = getSysTickCnt();', '\tu32 lastWakeTime = getSysTickCnt();\n\tAppMotionCommand app_motion;');
  text = patch(text, '\t\tif(Mode == APP_Control_Mode)          Get_RC();',
    '\t\tapp_motion = AppMotion_Read();\n\t\tif(Mode == APP_Control_Mode)          Get_RC(app_motion);');
  const start = text.indexOf('void Get_RC(void)');
  const end = text.indexOf('void PS2_Control(void)', start);
  if (start === -1 || end === -1) throw new Error('Unexpected APP control function');
  const control = text.slice(start, end).replace('void Get_RC(void)', 'static void Get_RC(AppMotionCommand motion)')
    .replaceAll('Flag_Direction', 'motion.direction').replaceAll('Flag_Left', 'motion.left').replaceAll('Flag_Right', 'motion.right');
  return text.slice(0, start) + control + text.slice(end);
});

if (radarPreview) {
  edit('HARDWARE/usartx.h', text => patch(text, 'void data_process(void);', `void data_process(void);
void LidarPreview_Poll(void);
void LidarPreview_Send(void);`));
  edit('HARDWARE/usartx.c', text => {
    text = patch(text, '#include "usartx.h"', `#include "usartx.h"
#include "front-lidar.h"

static FrontLidarSweep front_sweep;
static volatile FrontLidarEcho front_echo;
static volatile u32 front_sequence;
static struct {
    FrontLidarEcho echo;
    u32 sequence;
    u32 captured_tick;
    u8 seen;
} lidar_preview;

/* This runs in the 100 Hz task, never in the high-priority UART ISR. */
void LidarPreview_Poll(void)
{
    u32 now = getSysTickCnt();
    u32 mask = __get_PRIMASK();
    __disable_irq();
    if (front_sequence != lidar_preview.sequence) {
        lidar_preview.sequence = front_sequence;
        lidar_preview.echo = front_echo;
        lidar_preview.captured_tick = now;
        lidar_preview.seen = 1U;
    }
    __set_PRIMASK(mask);
}

/* Run from the same 10 Hz task as APP_Show, at 5 Hz on the 9600 bps link. */
void LidarPreview_Send(void)
{
    static u8 divider;
    if (++divider < 2U) return;
    divider = 0U;

    u32 now = getSysTickCnt();
    u32 mask = __get_PRIMASK();
    __disable_irq();
    u32 sequence = lidar_preview.sequence;
    u32 captured_tick = lidar_preview.captured_tick;
    FrontLidarEcho echo = lidar_preview.echo;
    u8 seen = lidar_preview.seen;
    __set_PRIMASK(mask);

    unsigned status = 0U;
    if (seen && (u32)(now - captured_tick) <= M2T(450U))
        status = echo.distance_mm ? 2U : 1U;
    any_printf(USART2, "{R%lu:%lu:%u:%u:%d}$", (unsigned long)sequence,
               (unsigned long)captured_tick, status, status == 2U ? (unsigned)echo.distance_mm : 0U,
               status == 2U ? (int)echo.bearing_cdeg : 0);
}`);
    const point = '\t\tDataprocess[data_cnt].angle=area_angle[m];';
    return patch(text, point, `        FrontLidarEcho observation;
        uint16_t angle_cdeg = area_angle[m] >= 0.0f && area_angle[m] <= 360.0f
            ? (uint16_t)(area_angle[m] * 100.0f + 0.5f) : 65535U;
        if (FrontLidar_Push(&front_sweep, angle_cdeg, (uint16_t)distance_sum[m], &observation)) {
            front_echo = observation;
            ++front_sequence;
        }

${point}`);
  });
  edit('BALANCE/balance.c', text => patch(text, '\t\tapp_motion = AppMotion_Read();',
    '\t\tLidarPreview_Poll();\n\t\tapp_motion = AppMotion_Read();'));
  edit('BALANCE/show.c', text => patch(text, '\t\toled_show();',
    '\t\tLidarPreview_Send();\n\t\toled_show();'));
  changes.set('HARDWARE/front-lidar.h', readFileSync(new URL('./front-lidar.h', import.meta.url), 'latin1'));
}

mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true, filter: file => {
  const name = relative(source, file).split(/[\\/]/)[0];
  return name !== 'OBJ' && !basename(file).endsWith('.log');
} });
for (const [file, contents] of changes) writeFileSync(join(output, file), contents, 'latin1');
mkdirSync(join(output, 'OBJ'));
console.log(join(output, 'USER', 'WHEELTEC.uvprojx'));
