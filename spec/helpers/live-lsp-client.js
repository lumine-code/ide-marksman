const childProcess = require("child_process");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node");

const TIMEOUT_MS = 10000;

const withTimeout = (promise, label, timeout = TIMEOUT_MS) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};

const capabilities = () => ({
  workspace: {
    applyEdit: true,
    configuration: true,
    workspaceFolders: true,
    workspaceEdit: {
      documentChanges: true,
      resourceOperations: ["create", "rename", "delete"],
    },
    didChangeWatchedFiles: {
      dynamicRegistration: true,
      relativePatternSupport: true,
    },
    fileOperations: {
      dynamicRegistration: false,
      didCreate: true,
      didRename: true,
      didDelete: true,
    },
  },
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true },
    completion: {
      dynamicRegistration: true,
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
      },
    },
    hover: {
      dynamicRegistration: true,
      contentFormat: ["markdown", "plaintext"],
    },
    definition: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentSymbol: {
      dynamicRegistration: true,
      hierarchicalDocumentSymbolSupport: true,
    },
    rename: { dynamicRegistration: true, prepareSupport: true },
    codeAction: { dynamicRegistration: true, dataSupport: true },
    codeLens: { dynamicRegistration: true },
    semanticTokens: {
      dynamicRegistration: true,
      requests: { range: true, full: { delta: true } },
      tokenTypes: [],
      tokenModifiers: [],
      formats: ["relative"],
    },
    publishDiagnostics: {
      relatedInformation: true,
      tagSupport: { valueSet: [1, 2] },
      versionSupport: true,
      codeDescriptionSupport: true,
      dataSupport: true,
    },
  },
  window: { workDoneProgress: true, showDocument: { support: true } },
  general: { positionEncodings: ["utf-16"] },
});

class LiveLspClient {
  constructor(adapter, rootPath) {
    this.adapter = adapter;
    this.rootPath = rootPath;
    this.notifications = [];
    this.appliedEdits = [];
    this.stderr = "";
  }

  async start() {
    const launch = await this.adapter.resolveServer({ rootPath: this.rootPath });
    if (!launch) throw new Error("Marksman is not installed on PATH");
    this.child = childProcess.spawn(launch.command, launch.args || [], {
      cwd: launch.cwd || this.rootPath,
      env: { ...process.env, ...(launch.env || {}) },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", (chunk) => (this.stderr += chunk.toString()));
    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin),
      {
        error: (message) => (this.stderr += `${message}\n`),
        warn: (message) => (this.stderr += `${message}\n`),
        info() {},
        log() {},
      },
    );
    this.connection.onNotification((method, params) => this.notifications.push({ method, params }));
    this.connection.onRequest("workspace/workspaceFolders", () => this.workspaceFolders);
    this.connection.onRequest("workspace/applyEdit", ({ label, edit }) => {
      this.appliedEdits.push({ label, edit });
      return { applied: true };
    });
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("window/showDocument", () => ({ success: true }));
    this.connection.listen();

    const rootUri = pathToFileURL(this.rootPath).href;
    this.workspaceFolders = [{ uri: rootUri, name: path.basename(this.rootPath) }];
    this.initializeResult = await this.request("initialize", {
      processId: process.pid,
      clientInfo: { name: "Lumine adapter integration specs", version: "1.0.0" },
      rootUri,
      workspaceFolders: this.workspaceFolders,
      capabilities: capabilities(),
    });
    this.connection.sendNotification("initialized", {});
    return this.initializeResult;
  }

  request(method, params, timeout) {
    return withTimeout(
      this.connection.sendRequest(method, params),
      `${this.adapter.displayName} ${method}; stderr: ${this.stderr}`,
      timeout,
    );
  }

  notify(method, params) {
    return this.connection.sendNotification(method, params);
  }

  open(uri, text, version = 1) {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "markdown", version, text },
    });
  }

  change(uri, text, version = 2) {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  close(uri) {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  messages(method) {
    return this.notifications.filter((message) => message.method === method);
  }

  async waitFor(check, label, timeout = TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${label} timed out; stderr: ${this.stderr}`);
  }

  async stop() {
    if (!this.connection) return;
    try {
      await withTimeout(this.connection.sendRequest("shutdown"), "shutdown", 2000);
      this.connection.sendNotification("exit");
    } catch {
      this.child?.kill();
    }
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      new Promise((resolve) =>
        setTimeout(() => {
          this.child.kill();
          resolve();
        }, 1000),
      ),
    ]);
    this.connection.dispose();
  }
}

exports.LiveLspClient = LiveLspClient;
exports.fileUri = (filePath) => pathToFileURL(filePath).href;
exports.positionParams = (uri, line, character) => ({
  textDocument: { uri },
  position: { line, character },
});
