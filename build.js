// @ts-check
const esbuild = require('esbuild');
const { version } = require('./package.json');

const isDev = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: isDev ? 'linked' : false,
  minify: !isDev,
};

async function main() {
  const client = await esbuild.context({
    ...shared,
    entryPoints: ['client/src/extension.ts'],
    outfile: 'out/client/extension.js',
  });

  const server = await esbuild.context({
    ...shared,
    entryPoints: ['server/src/server.ts'],
    outfile: 'out/server/server.js',
    define: { __VERSION__: JSON.stringify(version) },
  });

  if (isDev) {
    await Promise.all([client.watch(), server.watch()]);
    console.log('[esbuild] watching for changes…');
  } else {
    await Promise.all([client.rebuild(), server.rebuild()]);
    await Promise.all([client.dispose(), server.dispose()]);
    console.log('[esbuild] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
