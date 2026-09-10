export {};

const command = process.argv[2];

if (command === 'editor') {
  const projectName = process.argv[3];
  if (!projectName) throw new Error('Usage: pnpm medavatar editor <project> [--port <port>]');
  const portIndex = process.argv.indexOf('--port');
  const rawPort = portIndex >= 0 ? process.argv[portIndex + 1] : undefined;
  const port = rawPort === undefined ? 4173 : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid editor port: ${rawPort}`);
  const {startEditorServer} = await import('./editor/server.js');
  await startEditorServer(projectName, port);
} else if (command === 'render') {
  const projectName = process.argv[3];
  if (!projectName) throw new Error('Usage: pnpm medavatar render <project>');
  const {renderProject} = await import('./production/renderCommand.js');
  await renderProject(projectName);
} else if (command === '--version' || command === '-V') {
  console.log('0.4.1');
} else {
  await import('./cli.js');
}
