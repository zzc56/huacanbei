import { parseReplayPackets } from './bundledReplay';

self.onmessage = async ({ data }: MessageEvent<{ files: File[]; annotated: boolean }>) => {
  try {
    const contents = await Promise.all(data.files.map((file) => file.text()));
    self.postMessage({ packets: parseReplayPackets(contents, data.annotated) });
  } catch (error) {
    self.postMessage({
      error: error instanceof SyntaxError ? 'fusion.jsonl 包含无法解析的 JSON 记录。'
        : error instanceof Error ? error.message : '回放数据解析失败。',
    });
  }
};
