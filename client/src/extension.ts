import * as path from 'path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

import {
  GENERATE_COMMAND_ID,
  StepDefinitionCodeActionProvider,
  generateStepDefinitionCommand,
} from './codeActions';

let client: LanguageClient;

/**
 * Build the `.feature` file watchers honouring `stepwise.featurePaths`. When the
 * setting is empty we watch the whole workspace; otherwise we watch only the
 * configured directories so large monorepos aren't scanned end-to-end.
 */
function createFeatureWatchers(): vscode.FileSystemWatcher[] {
  const featurePaths = vscode.workspace
    .getConfiguration('stepwise')
    .get<string[]>('featurePaths', []);

  if (!featurePaths || featurePaths.length === 0) {
    return [vscode.workspace.createFileSystemWatcher('**/*.feature')];
  }

  const watchers: vscode.FileSystemWatcher[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const p of featurePaths) {
    if (path.isAbsolute(p)) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(p), '**/*.feature');
      watchers.push(vscode.workspace.createFileSystemWatcher(pattern));
    } else {
      for (const folder of folders) {
        const pattern = new vscode.RelativePattern(folder, `${p}/**/*.feature`);
        watchers.push(vscode.workspace.createFileSystemWatcher(pattern));
      }
    }
  }
  return watchers;
}

function createClient(context: vscode.ExtensionContext): LanguageClient {
  // The compiled language server entry point
  const serverModule = context.asAbsolutePath(
    path.join('out', 'server', 'server.js')
  );

  // Debug config: attach Node debugger on port 6009 when running under --extensionDevelopmentPath
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: {
        execArgv: ['--nolazy', '--inspect=6009'],
      },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Activate for Gherkin feature files
    documentSelector: [
      { scheme: 'file', language: 'gherkin' },
    ],
    synchronize: {
      // Notify the server when .feature or .py files change on disk
      fileEvents: [
        ...createFeatureWatchers(),
        vscode.workspace.createFileSystemWatcher('**/*.py'),
      ],
      configurationSection: 'stepwise',
    },
    initializationOptions: {
      extensionPath: context.extensionPath,
    },
  };

  return new LanguageClient(
    'stepwise',
    'StepWise BDD Language Server',
    serverOptions,
    clientOptions
  );
}

export function activate(context: vscode.ExtensionContext): void {
  client = createClient(context);
  client.start();

  context.subscriptions.push({
    dispose: () => {
      client.stop();
    },
  });

  // The feature watchers are fixed when the client is constructed, so changing
  // `stepwise.featurePaths` requires rebuilding the client to apply the new scope.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('stepwise.featurePaths')) return;
      await client.stop();
      client = createClient(context);
      await client.start();
    }),
  );

  // Code-action provider and its command are registered behind try/catches so
  // a failure here can't take the language client (and hence diagnostics) down
  // with it.
  try {
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { language: 'gherkin' },
        new StepDefinitionCodeActionProvider(),
        {
          providedCodeActionKinds:
            StepDefinitionCodeActionProvider.providedCodeActionKinds,
        },
      ),
    );
  } catch (err) {
    console.error('[stepwise] Failed to register code action provider:', err);
  }

  try {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        GENERATE_COMMAND_ID,
        generateStepDefinitionCommand,
      ),
    );
  } catch (err) {
    console.error('[stepwise] Failed to register generate command:', err);
  }
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
