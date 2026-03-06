function spawnProcess(command: string[], label: string): Deno.ChildProcess {
  const process = new Deno.Command(command[0], {
    args: command.slice(1),
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();

  const output = async (stream: ReadableStream<Uint8Array>, type: 'log' | 'error') => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk).trim();
      if (!text) continue;
      if (type === 'log') {
        console.log(`[${label}] ${text}`);
      } else {
        console.error(`[${label}] ${text}`);
      }
    }
  };

  output(process.stdout, 'log');
  output(process.stderr, 'error');
  return process;
}

const api = spawnProcess(['deno', 'task', 'api:dev'], 'api');
const web = spawnProcess(['deno', 'task', 'web:dev'], 'web');

console.log('Dev servers started: API http://localhost:8000 | Web http://localhost:5173');

const stop = async () => {
  api.kill();
  web.kill();
  Deno.exit(0);
};

// register appropriate signals based on platform (SIGTERM isn't available on Windows)
if (Deno.build.os === 'windows') {
  Deno.addSignalListener('SIGINT', stop);
  // on Windows use SIGBREAK (Ctrl-Break) instead of SIGTERM
  Deno.addSignalListener('SIGBREAK', stop);
} else {
  Deno.addSignalListener('SIGINT', stop);
  Deno.addSignalListener('SIGTERM', stop);
}

await Promise.all([api.status, web.status]);
